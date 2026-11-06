import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Allocation, Entry } from "./types.ts";

// Runs identically in Node and the browser, so anyone can recompute a draw.

export function stripHex(h: string): string {
  return h.startsWith("0x") ? h.slice(2) : h;
}

/**
 * Deterministic random integer in [0, bound) derived from the seed.
 * value = sha256(seed ‖ uint32BE(counter)) read as a 256-bit integer, mod bound.
 * With a 256-bit value the modulo bias is far below 2^-200 for any realistic bound.
 */
export function seededInt(seedHex: string, counter: number, bound: number): number {
  const seed = hexToBytes(stripHex(seedHex));
  const msg = new Uint8Array(seed.length + 4);
  msg.set(seed);
  new DataView(msg.buffer).setUint32(seed.length, counter, false);
  return Number(BigInt("0x" + bytesToHex(sha256(msg))) % BigInt(bound));
}

/**
 * Fisher–Yates shuffle driven by the Hedera seed.
 * Input must already be in HCS sequence order; the same input + seed always yields the same order.
 */
export function fisherYates<T>(items: readonly T[], seedHex: string): T[] {
  const a = [...items];
  let counter = 0;
  for (let i = a.length - 1; i > 0; i--) {
    const j = seededInt(seedHex, counter++, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Strict order, partial seats: each person gets min(requested, seats left). Nobody is skipped. */
export function allocate(
  ordered: { anonId: string; requested: number }[],
  seats: number,
): { winners: Allocation[]; waitlist: { anonId: string; requested: number }[] } {
  let left = seats;
  const winners: Allocation[] = [];
  const waitlist: { anonId: string; requested: number }[] = [];
  for (const e of ordered) {
    if (left > 0) {
      const got = Math.min(e.requested, left);
      winners.push({ anonId: e.anonId, requested: e.requested, seats: got });
      left -= got;
    } else {
      waitlist.push(e);
    }
  }
  return { winners, waitlist };
}

export function sortBySeq(entries: Pick<Entry, "seq">[]): typeof entries {
  return [...entries].sort((a, b) => a.seq - b.seq);
}

/** Runs the full normal draw: HCS order → Fisher–Yates(seed) → allocation. */
export function runDraw(entries: Pick<Entry, "anonId" | "seats" | "seq">[], seedHex: string, seats: number) {
  const ordered = [...entries].sort((a, b) => a.seq - b.seq);
  const shuffled = fisherYates(ordered, seedHex);
  const { winners, waitlist } = allocate(
    shuffled.map((e) => ({ anonId: e.anonId, requested: e.seats })),
    seats,
  );
  return { order: shuffled.map((e) => e.anonId), winners, waitlist, lastSeq: ordered.at(-1)?.seq ?? 0 };
}

export function sha256Hex(s: string): string {
  return bytesToHex(sha256(utf8ToBytes(s)));
}

export function winnersHash(winners: Pick<Allocation, "anonId" | "seats">[]): string {
  return sha256Hex(winners.map((w) => `${w.anonId}:${w.seats}`).join(","));
}
