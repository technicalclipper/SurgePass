import { env, envNum } from "@surgepass/shared/env";

// Creates the demo drops through the admin API (the same calls the dashboard makes).
//   npm run seed                 → windows open now, close in WINDOW_SEC (default 120)
//   WINDOW_SEC=60 npm run seed   → 60-second demo windows

const G = env("GATEWAY_ORIGIN", "http://localhost:8080");
const TOKEN = env("ADMIN_TOKEN");
const WINDOW = envNum("WINDOW_SEC", 120) * 1000;
const DELAY = envNum("OPEN_IN_SEC", 0) * 1000;

async function create(body: Record<string, unknown>) {
  const r = await fetch(`${G}/_sp/admin/drops`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  console.log(`${d.pool.padEnd(7)} ${d.id}  →  ${G}/_sp/room/${d.id}`);
  return d;
}

const opensAt = Date.now() + DELAY;
const closesAt = opensAt + WINDOW;
const peak = { mode: "auto", schedule: [{ start: opensAt - 60_000, end: closesAt + 30 * 60_000 }], loadTrigger: { p95Ms: 800, errorRate: 0.05 } };
const train = {
  pattern: "/tatkal/book/:trainNo/:date/:class",
  values: { trainNo: "12007", date: "2026-11-06", class: "CC" },
  readPatterns: ["/availability/:trainNo/:date/:class"],
  finalStepPattern: "/tatkal/book/:trainNo/:date/:class/confirm",
  confirmedSeatsField: "seats_booked",
  bookingUrl: "/tatkal/book/:trainNo/:date/:class",
  host: new URL(G).host,
  opensAt,
  closesAt,
  peak,
};

const tatkal = await create({
  ...train,
  label: "Train 12007 · CC · Tatkal",
  subtitle: "Mumbai CSMT → Pune · 6 Nov · 06:40",
  pool: "normal",
  conditions: [{ location: "query", key: "quota", operator: "equals", value: "TQ" }],
  seats: envNum("TRAIN_SEATS", 10),
  maxSeatsPerEntry: 4,
  priceInr: 1000,
  readPricing: { freePerWindow: 1, windowSec: 10, minInr: 0.1, maxInr: 5 },
});

await create({
  ...train,
  label: "Train 12007 · CC · Premium Tatkal",
  subtitle: "Mumbai CSMT → Pune · 6 Nov · 06:40",
  pool: "premium",
  conditions: [{ location: "query", key: "quota", operator: "equals", value: "PT" }],
  seats: envNum("PREMIUM_SEATS", 3),
  maxSeatsPerEntry: 2,
  premium: { floorInr: 1000, ceilingInr: 2000, depositInr: 200, revealSec: 15 },
  readPricing: { freePerWindow: 1, windowSec: 10, minInr: 0.1, maxInr: 5 },
});

await create({
  ...train,
  label: "Train 12007 · CC · Partner quota",
  subtitle: "Authorised partners · Mumbai CSMT → Pune · 6 Nov",
  pool: "partner",
  conditions: [{ location: "query", key: "quota", operator: "equals", value: "AG" }],
  readPatterns: [],
  seats: envNum("PARTNER_SEATS", 6),
  maxSeatsPerEntry: 4,
  priceInr: 1000,
  partner: {
    capPerPartner: envNum("PARTNER_CAP", 4),
    depositInr: 20,
    bookWithinSec: envNum("PARTNER_BOOK_WITHIN_SEC", 120),
    openDelaySec: envNum("PARTNER_OPEN_DELAY_SEC", 0),
    spillTo: tatkal.id,
  },
});

await create({
  label: "Monsoon Heist · 9 AM",
  subtitle: "Juhu Screens · Audi 2 · first day",
  pool: "normal",
  pattern: "/book/:movieId/:showId",
  values: { movieId: "a", showId: "juhu-9am" },
  conditions: [],
  readPatterns: ["/availability/movie/:movieId/:showId"],
  finalStepPattern: "/book/:movieId/:showId/confirm",
  bookingUrl: "/book/:movieId/:showId",
  host: new URL(G).host,
  seats: envNum("MOVIE_SEATS", 40),
  maxSeatsPerEntry: 6,
  priceInr: 350,
  opensAt,
  closesAt,
  peak,
  readPricing: { freePerWindow: 1, windowSec: 10, minInr: 0.1, maxInr: 5 },
});
