import { sha256Hex, seededInt } from "./draw.ts";
import type { Allocation } from "./types.ts";

/** Sealed-bid commitment: sha256("<amountInr>:<secret>"). The secret stops brute-forcing the small bid range. */
export function bidCommitment(amountInr: number, secret: string): string {
  return sha256Hex(`${amountInr}:${secret}`);
}

export interface RevealedBid {
  anonId: string;
  amount: number;
  seats: number;
  /** Order key for tie-breaking (HCS sequence of the commit). */
  seq: number;
}

/**
 * Uniform-price clearing.
 * Bids are ranked high → low (ties broken by the Hedera seed). Seats are given in that order
 * with min(requested, left). Every winner pays the same price: the highest losing bid,
 * or the floor when there is no losing bid.
 */
export function clearPremium(bids: RevealedBid[], seats: number, floorInr: number, ceilingInr: number, seedHex: string) {
  const valid = bids.filter((b) => b.amount >= floorInr && b.amount <= ceilingInr);
  const tiebreak = new Map(valid.map((b, i) => [b.anonId, seededInt(seedHex, 1_000_000 + i, 2 ** 31)]));
  const ranked = [...valid].sort((a, b) => b.amount - a.amount || tiebreak.get(a.anonId)! - tiebreak.get(b.anonId)!);

  let left = seats;
  const winners: (Allocation & { bid: number })[] = [];
  const losers: RevealedBid[] = [];
  for (const b of ranked) {
    if (left > 0) {
      const got = Math.min(b.seats, left);
      winners.push({ anonId: b.anonId, requested: b.seats, seats: got, bid: b.amount });
      left -= got;
    } else {
      losers.push(b);
    }
  }
  const clearingPriceInr = losers.length ? losers[0]!.amount : floorInr;
  return {
    ranked: ranked.map((b) => b.anonId),
    winners,
    waitlist: losers.map((b) => ({ anonId: b.anonId, requested: b.seats })),
    clearingPriceInr,
  };
}
