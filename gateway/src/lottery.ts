import { runDraw, winnersHash, type Allocation, type Drop, type DrawResult, type Entry } from "@surgepass/shared";
import { drops, saveDrop, setStatus } from "./drops.ts";
import { createTopic, newSeedTxId, prngSeed, topicLink } from "./hedera.ts";
import { drain, enqueue } from "./hcsqueue.ts";
import { registerDropCreated } from "./hooks.ts";
import { broadcastPublic, count, emit } from "./live.ts";
import { onPeakChange } from "./mode.ts";
import { getJson, redis, setJson } from "./redis.ts";

// Normal drops: one entry per human, written to the drop's HCS topic, then at close:
// window_closed (with the seed's transaction ID committed in advance) → Hedera random seed →
// Fisher–Yates over the HCS-ordered entries → strict-order partial-seat allocation.

const K = {
  entered: (d: string) => `entered:${d}`,
  entries: (d: string) => `entries:${d}`,
  result: (d: string) => `result:${d}`,
  waitlist: (d: string) => `waitlist:${d}`,
  lock: (d: string) => `lock:draw:${d}`,
  seedTx: (d: string) => `seedtx:${d}`,
};

type WinnersHandler = (drop: Drop, winners: Allocation[]) => Promise<void>;
let onWinners: WinnersHandler = async () => {};
export function setWinnersHandler(fn: WinnersHandler) {
  onWinners = fn;
}

// ── Topic per drop ──────────────────────────────────────────────────────────
registerDropCreated(async (d) => {
  if (d.hcsTopicId) return;
  const topic = await createTopic(`SurgePass · ${d.label} · ${d.pool}`);
  await saveDrop({ ...d, hcsTopicId: topic });
  await enqueue(topic, { t: "drop_created", drop: d.id, pool: d.pool, seats: d.seats, opensAt: d.opensAt, closesAt: d.closesAt });
  emit({ kind: "system", drop: d.id, note: `HCS topic ${topic}` });
});

onPeakChange((d, on) => {
  if (d.hcsTopicId) void enqueue(d.hcsTopicId, { t: on ? "peak_on" : "peak_off", drop: d.id, ts: Date.now() }).catch(() => {});
});

// ── Entries ────────────────────────────────────────────────────────────────
export type EnterError = "not_open" | "already_entered" | "bad_seats" | "premium_uses_bids";

export async function enter(
  drop: Drop,
  who: { anonId: string; kind: "human" | "agent"; agentAccount?: string; maxSeats?: number },
  seats: number,
): Promise<{ ok: true; entry: Entry } | { ok: false; error: EnterError }> {
  if (drop.pool === "premium") return { ok: false, error: "premium_uses_bids" };
  const now = Date.now();
  if (drop.status !== "open" || now < drop.opensAt || now > drop.closesAt) return { ok: false, error: "not_open" };
  const cap = Math.min(drop.maxSeatsPerEntry, who.maxSeats ?? drop.maxSeatsPerEntry);
  if (!Number.isInteger(seats) || seats < 1 || seats > cap) return { ok: false, error: "bad_seats" };

  if (!(await redis.sadd(K.entered(drop.id), who.anonId))) {
    count("rejectedEntries");
    return { ok: false, error: "already_entered" };
  }
  const entry: Entry = { anonId: who.anonId, kind: who.kind, seats, agentAccount: who.agentAccount, seq: 0, ts: now };
  await redis.hset(K.entries(drop.id), who.anonId, JSON.stringify(entry));
  count(who.kind === "agent" ? "entriesAgent" : "entriesHuman");

  const total = await redis.scard(K.entered(drop.id));
  broadcastPublic({ type: "drop", drop: drop.id, entries: total });

  if (drop.hcsTopicId) {
    enqueue(drop.hcsTopicId, { t: "entry", drop: drop.id, anon_id: who.anonId, kind: who.kind, seats, agent_account: who.agentAccount })
      .then(async (s) => {
        const updated: Entry = { ...entry, seq: s.seq, consensusAt: s.consensusAt };
        await redis.hset(K.entries(drop.id), who.anonId, JSON.stringify(updated));
        emit({ kind: who.kind, drop: drop.id, note: `entered · ${seats} seat(s)`, hcsSeq: s.seq, txId: s.txId });
        broadcastPublic({ type: "entry", drop: drop.id, anonId: who.anonId, seq: s.seq, txId: s.txId });
      })
      .catch((e) => emit({ kind: "system", drop: drop.id, note: `HCS entry failed: ${String(e).slice(0, 80)}` }));
  }
  return { ok: true, entry };
}

export async function getEntry(dropId: string, anonId: string): Promise<Entry | null> {
  const v = await redis.hget(K.entries(dropId), anonId);
  return v ? JSON.parse(v) : null;
}

export async function entryCount(dropId: string) {
  return redis.scard(K.entered(dropId));
}

export async function allEntries(dropId: string): Promise<Entry[]> {
  const all = await redis.hvals(K.entries(dropId));
  return all.map((v) => JSON.parse(v) as Entry).sort((a, b) => a.seq - b.seq);
}

export const getResult = (dropId: string) => getJson<DrawResult>(K.result(dropId));

// ── Close and draw ─────────────────────────────────────────────────────────
export async function closeAndDraw(drop: Drop) {
  if (!(await redis.set(K.lock(drop.id), "1", "EX", 600, "NX"))) return;
  await setStatus(drop.id, "drawing");
  broadcastPublic({ type: "draw", drop: drop.id, phase: "closing" });
  emit({ kind: "draw", drop: drop.id, note: "window closed" });

  const topic = drop.hcsTopicId!;
  await drain(topic);
  const entries = (await allEntries(drop.id)).filter((e) => e.seq > 0);
  const lastSeq = entries.at(-1)?.seq ?? 0;

  // Commit to the exact transaction that will produce the seed before it exists. A retry reuses
  // the same committed ID, so a failed draw can never become a re-roll.
  let seedTxId = await redis.get(K.seedTx(drop.id));
  let closedTx: string | undefined;
  if (!seedTxId) {
    seedTxId = newSeedTxId();
    await redis.set(K.seedTx(drop.id), seedTxId);
    closedTx = (await enqueue(topic, { t: "window_closed", drop: drop.id, entry_count: entries.length, last_seq: lastSeq, seed_tx_id: seedTxId })).txId;
  }
  const closed = { txId: closedTx };
  broadcastPublic({ type: "draw", drop: drop.id, phase: "closed", entryCount: entries.length, lastSeq, seedTxId, closedTx: closed.txId });

  const { seed, link: seedLink } = await prngSeed(seedTxId);
  broadcastPublic({ type: "draw", drop: drop.id, phase: "seed", seed, seedTxId, seedLink });
  emit({ kind: "draw", drop: drop.id, note: `seed ${seed.slice(0, 12)}…`, txId: seedTxId });

  const r = runDraw(entries, seed, drop.seats);
  const result: DrawResult = {
    dropId: drop.id,
    policy: "fisher-yates",
    seed,
    seedTxId,
    entryCount: entries.length,
    lastSeq,
    order: r.order,
    winners: r.winners,
    waitlist: r.waitlist,
    winnersHash: winnersHash(r.winners),
    computedAt: Date.now(),
  };
  await setJson(K.result(drop.id), result);
  await redis.del(K.waitlist(drop.id));
  if (r.waitlist.length) await redis.rpush(K.waitlist(drop.id), ...r.waitlist.map((w) => JSON.stringify(w)));

  const published = await enqueue(topic, { t: "result", drop: drop.id, policy: "fisher-yates", seed, winners_hash: result.winnersHash });
  await onWinners(drop, r.winners);
  await setStatus(drop.id, "results");

  broadcastPublic({
    type: "draw",
    drop: drop.id,
    phase: "result",
    seed,
    order: r.order,
    winners: r.winners,
    waitlist: r.waitlist.map((w) => w.anonId),
    resultTx: published.txId,
  });
  emit({ kind: "draw", drop: drop.id, note: `${r.winners.length} winners · ${r.waitlist.length} waitlisted`, hcsSeq: published.seq });
}

/** Everything needed to recompute the draw independently. */
export async function verifyBundle(drop: Drop) {
  const result = await getResult(drop.id);
  const entries = await allEntries(drop.id);
  return {
    drop: drop.id,
    method: "Fisher–Yates over entries sorted by HCS sequence; j = sha256(seed ‖ uint32BE(counter)) mod (i+1), counter from 0; then seats = min(requested, left) in order",
    hcsTopicId: drop.hcsTopicId,
    topicLink: topicLink(drop.hcsTopicId),
    entries: entries.filter((e) => e.seq > 0).map((e) => ({ anonId: e.anonId, seats: e.seats, seq: e.seq })),
    seats: drop.seats,
    result,
  };
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
type CloseHandler = (d: Drop) => Promise<void>;
let premiumClose: CloseHandler = async () => {};
export function setPremiumCloseHandler(fn: CloseHandler) {
  premiumClose = fn;
}

export function startLifecycle() {
  setInterval(() => {
    const now = Date.now();
    for (const d of drops.all()) {
      if (d.status === "scheduled" && now >= d.opensAt) void setStatus(d.id, "open").then(() => broadcastPublic({ type: "drop", drop: d.id, status: "open" }));
      else if (d.status === "open" && now >= d.closesAt) {
        const run = d.pool === "premium" ? premiumClose(d) : d.pool === "partner" ? setStatus(d.id, "results") : closeAndDraw(d);
        run.catch(async (e) => {
          emit({ kind: "system", drop: d.id, note: `draw failed, retrying: ${String(e).slice(0, 120)}` });
          await setStatus(d.id, "open");
          setTimeout(() => void redis.del(K.lock(d.id)), 3000);
        });
      }
    }
  }, 250).unref();
}
