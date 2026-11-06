import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env, envNum, REPO_ROOT } from "@surgepass/shared/env";
import { Capacity } from "./capacity.ts";
import { verifyAssertion, type Assertion } from "./assertion.ts";
import { page, bookingPage, homePage, successPage } from "./pages.ts";

// QuickBook: an ordinary booking site with a deliberately small backend.
// It knows nothing about SurgePass except the optional X-SurgePass-Assertion check.

const PORT = envNum("PROVIDER_PORT", 4000);
const NAME = env("PROVIDER_NAME", "A");
const GATEWAY_ORIGIN = env("GATEWAY_ORIGIN", "http://localhost:8080");
const AUDIENCE = env("PROVIDER_AUDIENCE", new URL(GATEWAY_ORIGIN).host);

const catalog = JSON.parse(readFileSync(resolve(REPO_ROOT, "config/catalog.json"), "utf8"));
type Train = (typeof catalog.trains)[number];
type Movie = (typeof catalog.movies)[number];

const capacity = new Capacity({
  workers: envNum("PROVIDER_WORKERS", 24),
  queueLimit: envNum("PROVIDER_QUEUE", 48),
  dbMs: [40, 120],
  crashAfterOverloadMs: 1500,
  crashCooldownMs: 15_000,
});

// Inventory: trains by trainNo:quota, movies by movieId:showId.
let inventory = new Map<string, number>();
function resetInventory() {
  inventory = new Map();
  for (const t of catalog.trains as Train[]) for (const [q, n] of Object.entries(t.seats)) inventory.set(`${t.trainNo}:${q}`, n as number);
  for (const m of catalog.movies as Movie[]) inventory.set(`${m.movieId}:${m.showId}`, m.seats);
}
resetInventory();

const bookings: { pnr: string; item: string; seats: number; amount: number; pool: string; at: number }[] = [];

const app = new Hono();

/** Runs a handler inside the limited backend; a rejected request becomes a 503. */
function guarded(handler: (c: Context) => Promise<Response> | Response) {
  return async (c: Context) => {
    const res = await capacity.run(() => handler(c));
    if (res) return res;
    return c.html(page("Service unavailable", `<div class="card"><h2>We're experiencing heavy traffic</h2><p>Please try again later.</p></div>`), 503);
  };
}

const assertionOf = (c: Context) => verifyAssertion(c.req.header("x-surgepass-assertion"), GATEWAY_ORIGIN, AUDIENCE);

app.get("/", guarded((c) => c.html(homePage(catalog))));

// ── Trains ─────────────────────────────────────────────────────────────────
const findTrain = (no: string): Train | undefined => (catalog.trains as Train[]).find((t) => t.trainNo === no);

app.get(
  "/availability/:trainNo/:date/:class",
  guarded((c) => {
    const t = findTrain(c.req.param("trainNo")!);
    if (!t) return c.json({ error: "unknown train" }, 404);
    const quota = c.req.query("quota") ?? "TQ";
    return c.json({ trainNo: t.trainNo, date: t.date, class: t.class, quota, seats_left: inventory.get(`${t.trainNo}:${quota}`) ?? 0, fare_inr: t.fareInr });
  }),
);

app.get(
  "/tatkal/book/:trainNo/:date/:class",
  guarded(async (c) => {
    const t = findTrain(c.req.param("trainNo")!);
    if (!t) return c.html(page("Not found", "<p>Unknown train</p>"), 404);
    const quota = c.req.query("quota") ?? "TQ";
    const a = await assertionOf(c);
    const fare = a?.pool === "premium" && a.price ? a.price : quota === "PT" ? t.fareInr * 2 : t.fareInr;
    return c.html(
      bookingPage({
        kind: "train",
        title: `${t.trainNo} · ${t.name}`,
        subtitle: `${t.from} → ${t.to} · ${t.date} · ${t.class} · ${quota === "PT" ? "Premium Tatkal" : quota === "AG" ? "Partner quota" : "Tatkal"}`,
        fare,
        maxSeats: a ? a.seats : 6,
        assertion: a,
        confirmUrl: `${c.req.path}/confirm?quota=${quota}`,
        seatsLeft: inventory.get(`${t.trainNo}:${quota}`) ?? 0,
      }),
    );
  }),
);

app.post(
  "/tatkal/book/:trainNo/:date/:class/confirm",
  guarded(async (c) => {
    const t = findTrain(c.req.param("trainNo")!);
    if (!t) return c.json({ error: "unknown train" }, 404);
    const quota = c.req.query("quota") ?? "TQ";
    const a = await assertionOf(c);
    const fare = a?.pool === "premium" && a.price ? a.price : quota === "PT" ? t.fareInr * 2 : t.fareInr;
    return confirm(c, `${t.trainNo}:${quota}`, `${t.trainNo} ${t.class} ${quota}`, fare, a, 6);
  }),
);

// ── Movies ─────────────────────────────────────────────────────────────────
const findMovie = (id: string, show: string): Movie | undefined => (catalog.movies as Movie[]).find((m) => m.movieId === id && m.showId === show);

app.get(
  "/availability/movie/:movieId/:showId",
  guarded((c) => {
    const m = findMovie(c.req.param("movieId")!, c.req.param("showId")!);
    if (!m) return c.json({ error: "unknown show" }, 404);
    return c.json({ movieId: m.movieId, showId: m.showId, seats_left: inventory.get(`${m.movieId}:${m.showId}`) ?? 0, price_inr: m.priceInr });
  }),
);

app.get(
  "/book/:movieId/:showId",
  guarded(async (c) => {
    const m = findMovie(c.req.param("movieId")!, c.req.param("showId")!);
    if (!m) return c.html(page("Not found", "<p>Unknown show</p>"), 404);
    const a = await assertionOf(c);
    return c.html(
      bookingPage({
        kind: "movie",
        title: m.title,
        subtitle: `${m.theatre} · ${m.time}`,
        fare: m.priceInr,
        maxSeats: a ? a.seats : 10,
        assertion: a,
        confirmUrl: `${c.req.path}/confirm`,
        seatsLeft: inventory.get(`${m.movieId}:${m.showId}`) ?? 0,
      }),
    );
  }),
);

app.post(
  "/book/:movieId/:showId/confirm",
  guarded(async (c) => {
    const m = findMovie(c.req.param("movieId")!, c.req.param("showId")!);
    if (!m) return c.json({ error: "unknown show" }, 404);
    const a = await assertionOf(c);
    return confirm(c, `${m.movieId}:${m.showId}`, `${m.title} ${m.time}`, m.priceInr, a, 10);
  }),
);

app.get("/booking/:pnr", (c) => {
  const b = bookings.find((x) => x.pnr === c.req.param("pnr")!);
  return b ? c.html(successPage(b)) : c.html(page("Not found", "<p>Unknown booking</p>"), 404);
});

async function confirm(c: Context, key: string, item: string, fare: number, a: Assertion | null, defaultMax: number) {
  const body = (await c.req.json().catch(() => ({}))) as { passengers?: { name: string }[] };
  const passengers = (body.passengers ?? []).filter((p) => p?.name?.trim());
  const max = a ? a.seats : defaultMax;
  if (passengers.length === 0) return c.json({ ok: false, error: "Add at least one passenger" }, 400);
  if (passengers.length > max) {
    return c.json({ ok: false, error: a ? `Your SurgePass pass allows ${a.seats} seat(s)` : `At most ${max} seats per booking` }, 403);
  }
  if (a?.pool === "premium" && !a.price) return c.json({ ok: false, error: "Premium price missing" }, 400);
  const left = inventory.get(key) ?? 0;
  if (left < passengers.length) return c.json({ ok: false, error: "Not enough seats left" }, 409);
  inventory.set(key, left - passengers.length);
  const pnr = `QB${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`;
  const amount = fare * passengers.length;
  bookings.push({ pnr, item, seats: passengers.length, amount, pool: a?.partner ? `partner ${a.partner}` : (a?.pool ?? "direct"), at: Date.now() });
  return c.json({ ok: true, pnr, seats_booked: passengers.length, amount_inr: amount, fare_inr: fare, pool: a?.pool ?? null, redirect: `/booking/${pnr}` });
}

// ── Internal endpoints (not part of the public site) ───────────────────────
app.get("/__provider/metrics", (c) => c.json({ name: NAME, ...capacity.metrics(), bookings: bookings.length }));
app.post("/__provider/reset", (c) => {
  resetInventory();
  bookings.length = 0;
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: PORT });
console.log(`QuickBook provider ${NAME} on http://localhost:${PORT}`);
