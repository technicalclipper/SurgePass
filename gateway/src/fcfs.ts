import { Hono } from "hono";
import { drops } from "./drops.ts";
import { enqueue } from "./hcsqueue.ts";
import { who } from "./identity.ts";
import { broadcastPublic, emit } from "./live.ts";
import { redis } from "./redis.ts";
import { issuePass, passFor, releasedCount } from "./passes.ts";

// Fair first come, for seats released when the waitlist is empty (cancellations, unbooked seats).
// Every claim is written to HCS and ordered by its Hedera consensus timestamp, not by our clock.
// Claims are gathered for a short window after the first one, then resolved in consensus order.

export const fcfs = new Hono();

const BATCH_MS = 3000;
const K = {
  claimed: (d: string) => `claimed:${d}`,
  claims: (d: string) => `claims:${d}`,
  released: (d: string) => `released:${d}`,
  pending: (d: string) => `fcfs:pending:${d}`,
};

/** "seconds.nanos" (or local microseconds) → a sortable bigint. */
function consensusKey(ts: string): bigint {
  if (!ts.includes(".")) return BigInt(ts) * 1000n;
  const [s, n = "0"] = ts.split(".");
  return BigInt(s!) * 1_000_000_000n + BigInt(n.padEnd(9, "0").slice(0, 9));
}

fcfs.post("/drops/:id/claim-released", async (c) => {
  const d = drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  const r = await who(c, d.id);
  if (r.kind === "anonymous") return c.json({ error: "human_approval_required" }, 401);
  if ((await releasedCount(d.id)) <= 0) return c.json({ error: "nothing_released" }, 409);
  const existing = await passFor(d.id, r.anonId);
  if (existing && existing.status === "issued") return c.json({ error: "already_has_pass" }, 409);
  if (!(await redis.sadd(K.claimed(d.id), r.anonId))) return c.json({ error: "already_claimed" }, 409);
  const { seats = 1 } = (await c.req.json().catch(() => ({}))) as { seats?: number };
  const want = Math.max(1, Math.min(d.maxSeatsPerEntry, r.kind === "agent" ? r.seats : d.maxSeatsPerEntry, Number(seats)));

  const s = await enqueue(d.hcsTopicId!, { t: "claim", drop: d.id, anon_id: r.anonId, seats: want }, true);
  await redis.hset(K.claims(d.id), r.anonId, JSON.stringify({ anonId: r.anonId, seats: want, consensusAt: s.consensusAt, seq: s.seq, txId: s.txId }));
  emit({ kind: r.kind, drop: d.id, note: `claim · consensus ${s.consensusAt}`, hcsSeq: s.seq, txId: s.txId });
  broadcastPublic({ type: "claim", drop: d.id, anonId: r.anonId, consensusAt: s.consensusAt, seq: s.seq });

  if (await redis.set(K.pending(d.id), "1", "PX", BATCH_MS + 5000, "NX")) setTimeout(() => void resolve(d.id), BATCH_MS);
  return c.json({ ok: true, consensusAt: s.consensusAt, seq: s.seq, resolvesInMs: BATCH_MS });
});

async function resolve(dropId: string) {
  const d = drops.get(dropId);
  if (!d) return;
  const claims = (await redis.hvals(K.claims(dropId))).map((v) => JSON.parse(v) as { anonId: string; seats: number; consensusAt: string; seq: number });
  claims.sort((a, b) => (consensusKey(a.consensusAt) < consensusKey(b.consensusAt) ? -1 : 1));
  let left = await releasedCount(dropId);
  const order: { anonId: string; seats: number; consensusAt: string; got: number }[] = [];
  for (const cl of claims) {
    const got = Math.min(cl.seats, left);
    order.push({ ...cl, got });
    if (got > 0) {
      left -= got;
      await issuePass(d, { anonId: cl.anonId, requested: cl.seats, seats: got });
    }
  }
  await redis.multi().set(K.released(dropId), String(left)).del(K.claims(dropId)).del(K.pending(dropId)).exec();
  broadcastPublic({ type: "fcfs_result", drop: dropId, order, released: left });
  emit({ kind: "draw", drop: dropId, note: `fair first come: ${order.filter((o) => o.got).length} claim(s) served in consensus order` });
}
