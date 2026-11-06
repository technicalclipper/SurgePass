import { env, envNum } from "@surgepass/shared/env";

// Adds drops for the 4 trains and 4 movies added to config/catalog.json, without resetting anything.
//   npx tsx scripts/seed-catalog.ts                  → open now, close in 24 hours
//   WINDOW_SEC=3600 npx tsx scripts/seed-catalog.ts  → 1-hour windows

const G = env("GATEWAY_ORIGIN", "http://localhost:8080");
const TOKEN = env("ADMIN_TOKEN");
const WINDOW = envNum("WINDOW_SEC", 24 * 3600) * 1000;

async function create(body: Record<string, unknown>) {
  const r = await fetch(`${G}/_sp/admin/drops`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  console.log(`${d.pool.padEnd(7)} ${d.label.padEnd(44)} ${G}/_sp/room/${d.id}`);
  return d;
}

const opensAt = Date.now();
const closesAt = opensAt + WINDOW;
const peak = { mode: "auto", schedule: [{ start: opensAt - 60_000, end: closesAt + 30 * 60_000 }], loadTrigger: { p95Ms: 800, errorRate: 0.05 } };
const reads = { freePerWindow: 1, windowSec: 10, minInr: 0.1, maxInr: 5 };
const DATE = "2026-11-07";
const quota = (q: string) => [{ location: "query", key: "quota", operator: "equals", value: q }];

const train = (trainNo: string, cls: string) => ({
  pattern: "/tatkal/book/:trainNo/:date/:class",
  values: { trainNo, date: DATE, class: cls },
  readPatterns: ["/availability/:trainNo/:date/:class"],
  finalStepPattern: "/tatkal/book/:trainNo/:date/:class/confirm",
  confirmedSeatsField: "seats_booked",
  bookingUrl: "/tatkal/book/:trainNo/:date/:class",
  host: new URL(G).host,
  opensAt,
  closesAt,
  peak,
  readPricing: reads,
});

const movie = (movieId: string, showId: string) => ({
  pattern: "/book/:movieId/:showId",
  values: { movieId, showId },
  conditions: [],
  readPatterns: ["/availability/movie/:movieId/:showId"],
  finalStepPattern: "/book/:movieId/:showId/confirm",
  bookingUrl: "/book/:movieId/:showId",
  host: new URL(G).host,
  opensAt,
  closesAt,
  peak,
  readPricing: reads,
});

// ── Trains ─────────────────────────────────────────────────────────────────
await create({ ...train("12123", "CC"), label: "Train 12123 · CC · Tatkal", subtitle: "Deccan Queen · Mumbai CSMT → Pune · 7 Nov · 17:10", pool: "normal", conditions: quota("TQ"), seats: 10, maxSeatsPerEntry: 4, priceInr: 900 });

await create({
  ...train("12009", "CC"),
  label: "Train 12009 · CC · Premium Tatkal",
  subtitle: "Shatabdi · Mumbai Central → Ahmedabad · 7 Nov · 06:20",
  pool: "premium",
  conditions: quota("PT"),
  seats: 3,
  maxSeatsPerEntry: 2,
  premium: { floorInr: 1500, ceilingInr: 3000, depositInr: 200, revealSec: 15 },
});

const rajdhani = await create({ ...train("22691", "3A"), label: "Train 22691 · 3A · Tatkal", subtitle: "Rajdhani · KSR Bengaluru → Hazrat Nizamuddin · 7 Nov · 20:00", pool: "normal", conditions: quota("TQ"), seats: 8, maxSeatsPerEntry: 4, priceInr: 4200 });

await create({
  ...train("22691", "3A"),
  label: "Train 22691 · 3A · Partner quota",
  subtitle: "Authorised partners · Rajdhani · KSR Bengaluru → Hazrat Nizamuddin · 7 Nov",
  pool: "partner",
  conditions: quota("AG"),
  readPatterns: [],
  seats: 6,
  maxSeatsPerEntry: 4,
  priceInr: 4200,
  partner: { capPerPartner: 4, depositInr: 20, bookWithinSec: 600, openDelaySec: 0, spillTo: rajdhani.id },
});

await create({ ...train("12627", "SL"), label: "Train 12627 · SL · Tatkal", subtitle: "Karnataka Express · KSR Bengaluru → New Delhi · 7 Nov · 19:20", pool: "normal", conditions: quota("TQ"), seats: 12, maxSeatsPerEntry: 4, priceInr: 950 });

// ── Movies ─────────────────────────────────────────────────────────────────
await create({ ...movie("c", "bandra-1030"), label: "Neon Tide · 10:30 AM", subtitle: "Bandra Talkies · Screen 1 · first day", pool: "normal", seats: 40, maxSeatsPerEntry: 6, priceInr: 400 });
await create({ ...movie("d", "parel-1315"), label: "The Last Monsoon · 1:15 PM", subtitle: "Lower Parel Cinemas · Audi 4 · first day", pool: "normal", seats: 30, maxSeatsPerEntry: 6, priceInr: 380 });
await create({ ...movie("e", "juhu-1800"), label: "Paper Kites · 6 PM", subtitle: "Juhu Screens · Audi 3 · first day", pool: "normal", seats: 30, maxSeatsPerEntry: 6, priceInr: 350 });
await create({ ...movie("f", "thane-2145"), label: "Midnight Line · 9:45 PM", subtitle: "Thane Picture House · Screen 2 · first day", pool: "normal", seats: 30, maxSeatsPerEntry: 6, priceInr: 320 });
