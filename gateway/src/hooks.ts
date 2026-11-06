import type { Drop } from "@surgepass/shared";

// Lifecycle hooks other modules register into, so admin/drops stay free of Hedera/World imports.

type DropHook = (d: Drop) => Promise<void> | void;
const created: DropHook[] = [];

export function registerDropCreated(fn: DropHook) {
  created.push(fn);
}

export async function onDropCreated(d: Drop) {
  for (const fn of created) await fn(d);
}
