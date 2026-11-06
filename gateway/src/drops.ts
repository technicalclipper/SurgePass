import type { Drop, DropStatus } from "@surgepass/shared";
import { redis, redisSub } from "./redis.ts";

// Drops live in Redis; every gateway instance keeps an in-memory copy for microsecond matching
// and reloads it when another instance publishes a change.

const KEY = (id: string) => `drop:${id}`;
const INDEX = "drops";
const CHANNEL = "sp:drops";

let cache: Drop[] = [];
const listeners = new Set<(drops: Drop[]) => void>();

export const drops = {
  all: () => cache,
  get: (id: string) => cache.find((d) => d.id === id),
  onChange: (fn: (drops: Drop[]) => void) => listeners.add(fn),
};

export async function loadDrops() {
  const ids = await redis.smembers(INDEX);
  const raw = ids.length ? await redis.mget(ids.map(KEY)) : [];
  cache = raw.filter(Boolean).map((r) => JSON.parse(r!) as Drop).sort((a, b) => a.opensAt - b.opensAt);
  for (const fn of listeners) fn(cache);
}

export async function watchDrops() {
  await loadDrops();
  await redisSub.subscribe(CHANNEL);
  redisSub.on("message", (ch) => ch === CHANNEL && void loadDrops());
}

export async function saveDrop(d: Drop) {
  await redis.multi().set(KEY(d.id), JSON.stringify(d)).sadd(INDEX, d.id).exec();
  await redis.publish(CHANNEL, d.id);
  await loadDrops();
}

export async function setStatus(id: string, status: DropStatus) {
  const d = drops.get(id);
  if (!d || d.status === status) return;
  await saveDrop({ ...d, status });
}

export async function deleteDrop(id: string) {
  await redis.multi().del(KEY(id)).srem(INDEX, id).exec();
  await redis.publish(CHANNEL, id);
  await loadDrops();
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

/** Fills defaults for a drop created from the dashboard or `POST /drops`. */
export function normalizeDrop(input: Partial<Drop> & { label: string; pattern: string }): Drop {
  const now = Date.now();
  const opensAt = input.opensAt ?? now;
  const closesAt = input.closesAt ?? opensAt + 60_000;
  const pool = input.pool ?? "normal";
  const d: Drop = {
    id: input.id ?? `${slug(input.label)}-${pool}-${now.toString(36).slice(-4)}`,
    label: input.label,
    subtitle: input.subtitle,
    pool,
    host: input.host,
    pattern: input.pattern,
    values: input.values ?? {},
    conditions: input.conditions ?? [],
    exactUrl: input.exactUrl,
    readPatterns: input.readPatterns ?? [],
    finalStepPattern: input.finalStepPattern ?? `${input.pattern}/confirm`,
    finalStepMethod: input.finalStepMethod ?? "POST",
    confirmedSeatsField: input.confirmedSeatsField ?? "seats_booked",
    bookingUrl: input.bookingUrl ?? input.pattern,
    seats: Math.max(1, input.seats ?? 10),
    maxSeatsPerEntry: Math.max(1, input.maxSeatsPerEntry ?? 4),
    priceInr: input.priceInr,
    opensAt,
    closesAt,
    passTtlSec: input.passTtlSec ?? 600,
    peak: input.peak ?? { mode: "auto", schedule: [{ start: opensAt - 5 * 60_000, end: closesAt + 30 * 60_000 }] },
    readPricing: input.readPricing ?? { freePerWindow: 1, windowSec: 10, minInr: 0.1, maxInr: 5 },
    premium:
      pool === "premium"
        ? { floorInr: 1000, ceilingInr: 2000, depositInr: 200, revealSec: 15, ...input.premium }
        : undefined,
    hcsTopicId: input.hcsTopicId,
    status: input.status ?? (opensAt > now ? "scheduled" : "open"),
    createdAt: input.createdAt ?? now,
  };
  return d;
}
