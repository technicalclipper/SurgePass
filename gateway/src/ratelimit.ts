import { redis } from "./redis.ts";

/** Fixed-window counter. Returns true when the call is within `limit` per `windowSec`. */
export async function allow(key: string, limit: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSec + 1);
  return n <= limit;
}

/** Sliding-window log in a sorted set. Returns how many calls are in the window, including this one. */
export async function slidingCount(key: string, windowSec: number): Promise<number> {
  const now = Date.now();
  const k = `sw:${key}`;
  const res = await redis
    .multi()
    .zremrangebyscore(k, 0, now - windowSec * 1000)
    .zadd(k, now, `${now}:${Math.random().toString(36).slice(2, 8)}`)
    .zcard(k)
    .expire(k, windowSec + 1)
    .exec();
  return Number(res?.[2]?.[1] ?? 0);
}
