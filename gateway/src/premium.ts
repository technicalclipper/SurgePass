import { Hono } from "hono";
import { bidCommitment, clearPremium, winnersHash, type Drop, type DrawResult } from "@surgepass/shared";
import { drops, setStatus } from "./drops.ts";
import { enqueue, drain } from "./hcsqueue.ts";
import { hederaLive, newSeedTxId, prngSeed, scheduleRefund } from "./hedera.ts";
import { who } from "./identity.ts";
import { broadcastPublic, emit } from "./live.ts";
import { getJson, redis, setJson } from "./redis.ts";
import { issuePass } from "./passes.ts";
import { inrToUnits, paymentHeader, paymentRequired, settle } from "./x402.ts";

// Premium: a separate drop with its own seats, floor, ceiling and fixed deposit.
// Sealed bids (commit–reveal on HCS): during the window only sha256("amount:secret") is public.
// After close, bids are revealed and checked; the top bids win and every winner pays the same
// price, the highest losing bid. Ties are broken by the Hedera seed. Agents pay the deposit via
// x402; it is refunded by a Hedera scheduled transaction to losers, unrevealed bidders, and
// winners once they book.

export const premium = new Hono();

interface Bid {
  anonId: string;
  kind: "human" | "agent";
  agent?: string;
  maxBid?: number;
  commit: string;
  seats: number;
  seq: number;
  deposit?: { payer: string; txId: string; amountInr: number };
  amount?: number;
  revealedAt?: number;
}

const K = {
  bids: (d: string) => `bids:${d}`,
  result: (d: string) => `result:${d}`,
  waitlist: (d: string) => `waitlist:${d}`,
  lock: (d: string) => `lock:draw:${d}`,
  seedTx: (d: string) => `seedtx:${d}`,
  refunds: (d: string) => `refunds:${d}`,
};

async function getBid(dropId: string, anonId: string): Promise<Bid | null> {
  const v = await redis.hget(K.bids(dropId), anonId);
  return v ? JSON.parse(v) : null;
}

async function putBid(dropId: string, b: Bid) {
  await redis.hset(K.bids(dropId), b.anonId, JSON.stringify(b));
}

async function allBids(dropId: string): Promise<Bid[]> {
  return (await redis.hvals(K.bids(dropId))).map((v) => JSON.parse(v) as Bid);
}

premium.post("/drops/:id/bid/commit", async (c) => {
  const d = drops.get(c.req.param("id"));
  if (!d || d.pool !== "premium" || !d.premium) return c.json({ error: "not_a_premium_drop" }, 404);
  if (d.status !== "open" || Date.now() > d.closesAt) return c.json({ error: "not_open" }, 400);
  const r = await who(c, d.id);
  if (r.kind === "anonymous") {
    emit({ kind: "bot", method: "POST", path: c.req.path, status: 401, drop: d.id, note: "bid without human → rejected" });
    return c.json({ error: "human_approval_required" }, 401);
  }
  const { commit_hash, seats = 1 } = (await c.req.json().catch(() => ({}))) as { commit_hash?: string; seats?: number };
  if (!commit_hash || !/^[0-9a-f]{64}$/.test(commit_hash)) return c.json({ error: "commit_hash must be sha256 hex" }, 400);
  const cap = Math.min(d.maxSeatsPerEntry, r.kind === "agent" ? r.seats : d.maxSeatsPerEntry);
  if (!Number.isInteger(seats) || seats < 1 || seats > cap) return c.json({ error: "bad_seats" }, 400);
  if (await getBid(d.id, r.anonId)) return c.json({ error: "already_bid" }, 409);

  // Agents pay the fixed deposit through x402; the same amount for everyone, so it reveals nothing.
  let deposit: Bid["deposit"];
  if (r.kind === "agent") {
    const pay = paymentHeader((n) => c.req.header(n));
    if (!pay) return paymentRequired(new URL(c.req.url).toString(), d.premium.depositInr, `${d.label} premium deposit`);
    const out = await settle(pay, d.premium.depositInr);
    if (!out.ok) return c.json({ error: "deposit_failed", reason: out.reason }, 402);
    deposit = { payer: out.payer ?? r.agent, txId: out.txId, amountInr: out.amountInr };
    emit({ kind: "agent", drop: d.id, note: `deposit ₹${out.amountInr} paid`, txId: out.txId });
  }

  const bid: Bid = { anonId: r.anonId, kind: r.kind, agent: r.kind === "agent" ? r.agent : undefined, maxBid: r.kind === "agent" ? r.maxBid : undefined, commit: commit_hash, seats, seq: 0, deposit };
  await putBid(d.id, bid);
  const n = await redis.hlen(K.bids(d.id));
  broadcastPublic({ type: "bids", drop: d.id, sealed: n });
  if (d.hcsTopicId) {
    enqueue(d.hcsTopicId, { t: "bid_commit", drop: d.id, anon_id: r.anonId, commit_hash, seats })
      .then(async (s) => {
        const cur = await getBid(d.id, r.anonId);
        if (cur) await putBid(d.id, { ...cur, seq: s.seq });
        emit({ kind: r.kind, drop: d.id, note: `bid sealed · ${seats} seat(s)`, hcsSeq: s.seq, txId: s.txId });
        broadcastPublic({ type: "bid_sealed", drop: d.id, anonId: r.anonId, seq: s.seq, txId: s.txId });
      })
      .catch(() => {});
  }
  return c.json({ ok: true, sealed: true, seats, deposit: deposit ?? null });
});

premium.post("/drops/:id/bid/reveal", async (c) => {
  const d = drops.get(c.req.param("id"));
  if (!d || d.pool !== "premium" || !d.premium) return c.json({ error: "not_a_premium_drop" }, 404);
  if (d.status !== "revealing") return c.json({ error: "not_revealing", status: d.status }, 400);
  const r = await who(c, d.id);
  if (r.kind === "anonymous") return c.json({ error: "unauthorized" }, 401);
  const bid = await getBid(d.id, r.anonId);
  if (!bid) return c.json({ error: "no_bid" }, 404);
  if (bid.amount !== undefined) return c.json({ ok: true, amount: bid.amount, already: true });
  const { amount, secret } = (await c.req.json().catch(() => ({}))) as { amount?: number; secret?: string };
  if (typeof amount !== "number" || typeof secret !== "string") return c.json({ error: "amount and secret required" }, 400);
  if (bidCommitment(amount, secret) !== bid.commit) return c.json({ error: "does_not_match_commitment" }, 400);
  if (amount < d.premium.floorInr || amount > d.premium.ceilingInr) return c.json({ error: "out_of_range" }, 400);
  if (bid.maxBid !== undefined && amount > bid.maxBid) return c.json({ error: "above_approved_max" }, 400);
  await putBid(d.id, { ...bid, amount, revealedAt: Date.now() });
  if (d.hcsTopicId) void enqueue(d.hcsTopicId, { t: "bid_reveal", drop: d.id, anon_id: r.anonId, amount, secret }).catch(() => {});
  const revealed = (await allBids(d.id)).filter((b) => b.amount !== undefined).length;
  broadcastPublic({ type: "bid_revealed", drop: d.id, anonId: r.anonId, amount, seats: bid.seats, revealed });
  emit({ kind: r.kind, drop: d.id, note: `bid revealed ₹${amount}` });
  return c.json({ ok: true, amount });
});

/** Called by the lifecycle when the premium window closes: open the reveal phase, then clear. */
export async function premiumClose(d: Drop) {
  if (!(await redis.set(K.lock(d.id), "1", "EX", 900, "NX"))) return;
  await setStatus(d.id, "revealing");
  const revealMs = (d.premium?.revealSec ?? 15) * 1000;
  broadcastPublic({ type: "draw", drop: d.id, phase: "revealing", until: Date.now() + revealMs, sealed: await redis.hlen(K.bids(d.id)) });
  emit({ kind: "draw", drop: d.id, note: `bidding closed · revealing for ${revealMs / 1000}s` });
  if (d.hcsTopicId) await drain(d.hcsTopicId);
  setTimeout(() => void clear(d.id).catch((e) => emit({ kind: "system", drop: d.id, note: `clearing failed: ${String(e).slice(0, 100)}` })), revealMs);
}

async function clear(dropId: string) {
  const d = drops.get(dropId)!;
  const p = d.premium!;
  await setStatus(d.id, "drawing");
  const topic = d.hcsTopicId!;
  await drain(topic);
  const bids = await allBids(d.id);
  const revealed = bids.filter((b) => b.amount !== undefined && b.seq > 0);
  const lastSeq = Math.max(0, ...bids.map((b) => b.seq));

  let seedTxId = await redis.get(K.seedTx(d.id));
  if (!seedTxId) {
    seedTxId = newSeedTxId();
    await redis.set(K.seedTx(d.id), seedTxId);
    await enqueue(topic, { t: "window_closed", drop: d.id, entry_count: revealed.length, last_seq: lastSeq, seed_tx_id: seedTxId });
  }
  const { seed, link } = await prngSeed(seedTxId);
  broadcastPublic({ type: "draw", drop: d.id, phase: "seed", seed, seedTxId, seedLink: link });

  const r = clearPremium(
    revealed.map((b) => ({ anonId: b.anonId, amount: b.amount!, seats: b.seats, seq: b.seq })),
    d.seats,
    p.floorInr,
    p.ceilingInr,
    seed,
  );
  const result: DrawResult = {
    dropId: d.id,
    policy: "premium-clearing",
    seed,
    seedTxId,
    entryCount: revealed.length,
    lastSeq,
    order: r.ranked,
    winners: r.winners.map(({ anonId, requested, seats }) => ({ anonId, requested, seats })),
    waitlist: r.waitlist,
    clearingPriceInr: r.clearingPriceInr,
    winnersHash: winnersHash(r.winners),
    computedAt: Date.now(),
  };
  await setJson(K.result(d.id), result);
  await redis.del(K.waitlist(d.id));
  if (r.waitlist.length) await redis.rpush(K.waitlist(d.id), ...r.waitlist.map((w) => JSON.stringify(w)));
  await enqueue(topic, { t: "result", drop: d.id, policy: "premium-clearing", seed, winners_hash: result.winnersHash, price: r.clearingPriceInr });

  for (const w of result.winners) await issuePass(d, w, r.clearingPriceInr);
  await setStatus(d.id, "results");

  const ranked = r.ranked.map((id) => {
    const b = revealed.find((x) => x.anonId === id)!;
    return { anonId: id, amount: b.amount!, seats: b.seats };
  });
  broadcastPublic({ type: "draw", drop: d.id, phase: "result", policy: "premium", seed, ranked, winners: result.winners, clearingPriceInr: r.clearingPriceInr, unrevealed: bids.length - revealed.length });
  emit({ kind: "draw", drop: d.id, note: `premium cleared at ₹${r.clearingPriceInr} · ${result.winners.length} winners` });

  // Refund deposits to everyone who didn't win (including unrevealed bids). Winners are refunded after booking.
  const winners = new Set(result.winners.map((w) => w.anonId));
  for (const b of bids) if (b.deposit && !winners.has(b.anonId)) await refund(d, b, "not winning");
}

async function refund(d: Drop, b: Bid, why: string) {
  if (!b.deposit || (await redis.sismember(K.refunds(d.id), b.anonId))) return;
  await redis.sadd(K.refunds(d.id), b.anonId);
  const at = new Date(Date.now() + 60_000);
  try {
    const s = await scheduleRefund(b.deposit.payer, inrToUnits(b.deposit.amountInr), at, `SurgePass refund ${d.id}`);
    emit({ kind: "system", drop: d.id, txId: s?.txId, note: s ? `refund ₹${b.deposit.amountInr} scheduled (${why}) · ${s.scheduleId}` : hederaLive ? `⚠ refund not scheduled: set SURGEPASS_PAY_TO_KEY` : `refund ₹${b.deposit.amountInr} recorded (${why}, local)` });
    broadcastPublic({ type: "refund", drop: d.id, anonId: b.anonId, amountInr: b.deposit.amountInr, scheduleId: s?.scheduleId, link: s?.link });
  } catch (e) {
    emit({ kind: "system", drop: d.id, note: `refund scheduling failed: ${String(e).slice(0, 80)}` });
    await redis.srem(K.refunds(d.id), b.anonId);
  }
}

/** A premium winner booked: refund their deposit. */
export async function refundWinner(d: Drop, anonId: string) {
  const b = await getBid(d.id, anonId);
  if (b) await refund(d, b, "booked");
}

export async function bidStatus(d: Drop, anonId: string) {
  if (d.pool !== "premium") return {};
  const b = await getBid(d.id, anonId);
  const result = await getJson<DrawResult>(K.result(d.id));
  return {
    sealedBids: await redis.hlen(K.bids(d.id)),
    bid: b ? { seats: b.seats, sealed: true, seq: b.seq, revealed: b.amount !== undefined, amount: b.amount, deposit: b.deposit ?? null } : null,
    clearingPriceInr: result?.clearingPriceInr,
  };
}

export async function premiumPublic(d: Drop) {
  if (d.pool !== "premium") return null;
  const bids = await allBids(d.id);
  return {
    sealed: bids.length,
    revealed: bids.filter((b) => b.amount !== undefined).map((b) => ({ anonId: b.anonId, amount: b.amount, seats: b.seats, seq: b.seq })),
    commits: bids.map((b) => ({ anonId: b.anonId, commit: b.commit, seq: b.seq })),
  };
}
