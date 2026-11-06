import type { Drop } from "@surgepass/shared";
import { emit } from "./live.ts";
import { health } from "./mode.ts";

// Surge price for paid reads: the floor while the backend is calm, rising geometrically with load
// up to the drop's ceiling. Floods make themselves expensive.

let lastLoad = 0;

/** Backend load in [0, 1], smoothed so the price doesn't flicker. */
export function backendLoad(): number {
  const h = health.upstream;
  const raw = h.reachable ? Math.max(h.load, Math.min(1, h.p95Ms / 2000), h.errorRate) : 1;
  lastLoad = lastLoad * 0.7 + raw * 0.3;
  return lastLoad;
}

const lastPrice = new Map<string, number>();

export function surgePriceInr(d: Drop): number {
  const { minInr, maxInr } = d.readPricing;
  const load = backendLoad();
  const p = load < 0.15 ? minInr : minInr * Math.pow(maxInr / minInr, Math.min(1, (load - 0.15) / 0.75));
  const price = Math.round(p * 100) / 100;
  const prev = lastPrice.get(d.id);
  if (prev !== undefined && Math.abs(prev - price) >= Math.max(0.05, prev * 0.1)) {
    emit({ kind: "surge", drop: d.id, note: `surge ₹${prev.toFixed(2)} → ₹${price.toFixed(2)} (backend load ${Math.round(load * 100)}%)` });
  }
  if (prev === undefined || Math.abs(prev - price) >= Math.max(0.05, prev * 0.1)) lastPrice.set(d.id, price);
  return price;
}

export const currentPrices = () => Object.fromEntries(lastPrice);
