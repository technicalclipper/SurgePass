import { Redis } from "ioredis";
import { config } from "./config.ts";

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
/** Separate connection for pub/sub (a subscribed connection can't run other commands). */
export const redisSub = new Redis(config.redisUrl);

export async function getJson<T>(key: string): Promise<T | null> {
  const v = await redis.get(key);
  return v ? (JSON.parse(v) as T) : null;
}

export async function setJson(key: string, value: unknown, ttlSec?: number) {
  const s = JSON.stringify(value);
  if (ttlSec) await redis.set(key, s, "EX", ttlSec);
  else await redis.set(key, s);
}
