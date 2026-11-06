import type { Drop } from "@surgepass/shared";
import { config } from "./config.ts";
import { drops } from "./drops.ts";
import { emit } from "./live.ts";

// Decides, per drop, whether its peak period is on: manual override, schedule, or the
// backend crossing its load trigger (kept on for a hold period once tripped).

export interface BackendHealth {
  name: string;
  rps: number;
  p95Ms: number;
  errorRate: number;
  load: number;
  crashed: boolean;
  reachable: boolean;
  /** Bookings the backend has confirmed (on the direct demo site these are bots grabbing seats). */
  bookings?: number;
}

const unreachable = (name: string): BackendHealth => ({ name, rps: 0, p95Ms: 0, errorRate: 1, load: 1, crashed: true, reachable: false });

export const health: { upstream: BackendHealth; direct: BackendHealth } = {
  upstream: unreachable("A"),
  direct: unreachable("B"),
};

async function poll(url: string, name: string): Promise<BackendHealth> {
  try {
    const r = await fetch(`${url}/__provider/metrics`, { signal: AbortSignal.timeout(800) });
    const j = (await r.json()) as Omit<BackendHealth, "reachable">;
    return { ...j, name, reachable: true };
  } catch {
    return unreachable(name);
  }
}

const LOAD_HOLD_MS = 60_000;
const loadTrippedAt = new Map<string, number>();
const peakState = new Map<string, boolean>();
const peakListeners = new Set<(drop: Drop, on: boolean) => void>();

export function onPeakChange(fn: (drop: Drop, on: boolean) => void) {
  peakListeners.add(fn);
}

export function isPeak(drop: Drop, now = Date.now()): boolean {
  if (drop.peak.mode === "on") return true;
  if (drop.peak.mode === "off") return false;
  if (drop.peak.schedule.some((w) => now >= w.start && now <= w.end)) return true;
  const tripped = loadTrippedAt.get(drop.id);
  return tripped !== undefined && now - tripped < LOAD_HOLD_MS;
}

function evaluate() {
  const now = Date.now();
  const h = health.upstream;
  for (const d of drops.all()) {
    const t = d.peak.loadTrigger;
    if (t && h.reachable && (h.p95Ms > t.p95Ms || h.errorRate > t.errorRate)) loadTrippedAt.set(d.id, now);
    const on = isPeak(d, now);
    if (peakState.get(d.id) !== on) {
      const first = !peakState.has(d.id);
      peakState.set(d.id, on);
      if (first && !on) continue;
      emit({ kind: "system", drop: d.id, note: on ? "peak on" : "peak off" });
      for (const fn of peakListeners) fn(d, on);
    }
  }
}

export function startModeController() {
  setInterval(async () => {
    [health.upstream, health.direct] = await Promise.all([poll(config.upstream, "A"), poll(config.directProvider, "B")]);
    evaluate();
  }, 500).unref();
}
