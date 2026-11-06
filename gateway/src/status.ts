import type { Drop } from "@surgepass/shared";
import type { Requester } from "./identity.ts";
import { entryCount, getEntry, getResult } from "./lottery.ts";
import { topicLink } from "./hedera.ts";
import { redis } from "./redis.ts";

// What one person sees for a drop: their entry, and after the draw their seats, pass, or
// waitlist position. Pass and premium details are filled in by those modules.

type Extra = (d: Drop, anonId: string) => Promise<Record<string, unknown>>;
const extras: Extra[] = [];
export function addStatusExtra(fn: Extra) {
  extras.push(fn);
}

export async function personalStatus(d: Drop, r: Requester) {
  const base = {
    drop: d.id,
    status: d.status,
    opensAt: d.opensAt,
    closesAt: d.closesAt,
    entries: await entryCount(d.id),
    topicLink: topicLink(d.hcsTopicId),
    you: r.kind === "anonymous" ? null : { kind: r.kind, anonId: r.anonId },
  };
  if (r.kind === "anonymous") return base;

  const entry = await getEntry(d.id, r.anonId);
  const result = await getResult(d.id);
  let outcome: Record<string, unknown> | null = null;
  if (result) {
    const w = result.winners.find((x) => x.anonId === r.anonId);
    if (w) outcome = { result: "won", seats: w.seats, requested: w.requested, partial: w.seats < w.requested };
    else {
      const list = await redis.lrange(`waitlist:${d.id}`, 0, -1);
      const pos = list.findIndex((x) => JSON.parse(x).anonId === r.anonId);
      outcome = pos >= 0 ? { result: "waitlist", position: pos + 1 } : entry ? { result: "promoted_or_done" } : null;
    }
  }
  const more = Object.assign({}, ...(await Promise.all(extras.map((fn) => fn(d, r.anonId)))));
  return { ...base, entry, outcome, ...more };
}
