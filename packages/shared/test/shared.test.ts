import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, fisherYates, runDraw, matchDrop, matchPattern, clearPremium, bidCommitment } from "../src/index.ts";
import type { Drop } from "../src/index.ts";

const SEED = "9f3a5c0e1b7d4a2f8e6c9b0a1d3f5e7c9a2b4d6f8e0c1a3b5d7f9e1c3a5b7d9f";

test("fisher-yates is deterministic and a permutation", () => {
  const items = Array.from({ length: 50 }, (_, i) => `p${i}`);
  const a = fisherYates(items, SEED);
  const b = fisherYates(items, SEED);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [...items].sort());
  assert.notDeepEqual(a, items);
  assert.notDeepEqual(fisherYates(items, SEED.replace("9f", "00")), a);
});

test("allocation is strict order with partial seats", () => {
  const r = allocate(
    [
      { anonId: "Divya", requested: 4 },
      { anonId: "Neha", requested: 3 },
      { anonId: "Karan", requested: 4 },
      { anonId: "Ravi", requested: 2 },
      { anonId: "Arjun", requested: 1 },
    ],
    10,
  );
  assert.deepEqual(r.winners, [
    { anonId: "Divya", requested: 4, seats: 4 },
    { anonId: "Neha", requested: 3, seats: 3 },
    { anonId: "Karan", requested: 4, seats: 3 },
  ]);
  assert.deepEqual(r.waitlist.map((w) => w.anonId), ["Ravi", "Arjun"]);
});

test("runDraw sorts by HCS sequence before shuffling", () => {
  const entries = [
    { anonId: "b", seats: 1, seq: 2 },
    { anonId: "a", seats: 1, seq: 1 },
    { anonId: "c", seats: 1, seq: 3 },
  ];
  const shuffledInput = [entries[2]!, entries[0]!, entries[1]!];
  assert.deepEqual(runDraw(entries, SEED, 2), runDraw(shuffledInput, SEED, 2));
});

test("route patterns and drop matching", () => {
  assert.deepEqual(matchPattern("/tatkal/book/:trainNo/:date/:class", "/tatkal/book/12007/2026-11-06/CC"), {
    trainNo: "12007",
    date: "2026-11-06",
    class: "CC",
  });
  assert.equal(matchPattern("/book/:movieId", "/book/a/seats"), null);
  assert.ok(matchPattern("/book/:movieId", "/book/a/seats", true));

  const drop = {
    id: "t",
    pool: "normal",
    pattern: "/tatkal/book/:trainNo/:date/:class",
    values: { trainNo: "12007" },
    conditions: [{ location: "query", key: "quota", operator: "equals", value: "TQ" }],
    readPatterns: ["/availability/:trainNo"],
    finalStepPattern: "/tatkal/book/:trainNo/:date/:class/confirm",
    finalStepMethod: "POST",
  } as unknown as Drop;
  const req = (method: string, url: string) => {
    const u = new URL(url, "http://x");
    return { method, path: u.pathname, query: u.searchParams, headers: {} };
  };
  assert.equal(matchDrop([drop], req("GET", "/tatkal/book/12007/2026-11-06/CC?quota=TQ"))?.kind, "booking");
  assert.equal(matchDrop([drop], req("GET", "/tatkal/book/12007/2026-11-06/CC?quota=PT")), null);
  assert.equal(matchDrop([drop], req("GET", "/tatkal/book/12008/2026-11-06/CC?quota=TQ")), null);
  assert.equal(matchDrop([drop], req("POST", "/tatkal/book/12007/2026-11-06/CC/confirm?quota=TQ"))?.kind, "final");
  assert.equal(matchDrop([drop], req("GET", "/availability/12007?quota=TQ"))?.kind, "read");
});

test("premium clears at the highest losing bid", () => {
  const bids = [
    { anonId: "a", amount: 1900, seats: 1, seq: 1 },
    { anonId: "b", amount: 1500, seats: 1, seq: 2 },
    { anonId: "c", amount: 1450, seats: 1, seq: 3 },
    { anonId: "d", amount: 1200, seats: 1, seq: 4 },
  ];
  const r = clearPremium(bids, 2, 1000, 2000, SEED);
  assert.deepEqual(r.winners.map((w) => w.anonId), ["a", "b"]);
  assert.equal(r.clearingPriceInr, 1450);
  assert.equal(clearPremium(bids, 10, 1000, 2000, SEED).clearingPriceInr, 1000);
  assert.equal(bidCommitment(1450, "s"), bidCommitment(1450, "s"));
  assert.notEqual(bidCommitment(1450, "s"), bidCommitment(1451, "s"));
});
