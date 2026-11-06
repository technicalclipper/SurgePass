import { Hono } from "hono";
import { cors } from "hono/cors";
import { matchDrop, parseUrlForBuilder, type Drop } from "@surgepass/shared";
import { config } from "./config.ts";
import { deleteDrop, drops, normalizeDrop, saveDrop } from "./drops.ts";
import { isPeak, health } from "./mode.ts";
import { onDropCreated } from "./hooks.ts";
import { broadcastPublic, dropHistory, emit, recentOutcomes } from "./live.ts";
import { redis } from "./redis.ts";

// Provider dashboard API. Bearer ADMIN_TOKEN.

export const admin = new Hono();

admin.use("*", cors({ origin: config.dashboardOrigin, allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "POST", "PUT", "DELETE"] }));
admin.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  if (c.req.header("authorization") !== `Bearer ${config.adminToken}`) return c.json({ error: "unauthorized" }, 401);
  return next();
});

const view = (d: Drop) => ({ ...d, peakOn: isPeak(d) });

/** Entries (normal), sealed bids (premium) or seats handed out (partner) for each drop. */
async function participation(d: Drop): Promise<number> {
  if (d.pool === "premium") return redis.hlen(`bids:${d.id}`);
  if (d.pool === "partner") return d.seats - (await redis.llen(`pfree:${d.id}`));
  return redis.scard(`entered:${d.id}`);
}

admin.get("/drops", async (c) => c.json({ drops: await Promise.all(drops.all().map(async (d) => ({ ...view(d), entries: await participation(d) }))) }));
admin.get("/drops/:id", (c) => {
  const d = drops.get(c.req.param("id"));
  return d ? c.json(view(d)) : c.json({ error: "not found" }, 404);
});

admin.post("/drops", async (c) => {
  const body = (await c.req.json()) as Partial<Drop> & { label: string; pattern: string };
  if (!body.label || !body.pattern) return c.json({ error: "label and pattern are required" }, 400);
  const d = normalizeDrop(body);
  await saveDrop(d);
  await onDropCreated(d);
  return c.json(view(drops.get(d.id) ?? d), 201);
});

admin.put("/drops/:id", async (c) => {
  const cur = drops.get(c.req.param("id"));
  if (!cur) return c.json({ error: "not found" }, 404);
  const patch = (await c.req.json()) as Partial<Drop>;
  const next = normalizeDrop({ ...cur, ...patch, id: cur.id, createdAt: cur.createdAt });
  await saveDrop(next);
  return c.json(view(next));
});

admin.post("/drops/:id/peak", async (c) => {
  const cur = drops.get(c.req.param("id"));
  if (!cur) return c.json({ error: "not found" }, 404);
  const { mode } = (await c.req.json()) as { mode: Drop["peak"]["mode"] };
  await saveDrop({ ...cur, peak: { ...cur.peak, mode } });
  return c.json(view(drops.get(cur.id)!));
});

/** End a drop's window now: a normal drop draws immediately, premium starts revealing, a partner quota stops taking holds. */
admin.post("/drops/:id/close", async (c) => {
  const cur = drops.get(c.req.param("id"));
  if (!cur) return c.json({ error: "not found" }, 404);
  if (cur.status !== "open" && cur.status !== "scheduled") return c.json({ error: "already_closed", status: cur.status }, 409);
  const now = Date.now();
  await saveDrop({ ...cur, opensAt: Math.min(cur.opensAt, now - 1000), closesAt: now, status: "open" });
  broadcastPublic({ type: "drop", drop: cur.id, status: "open", closesAt: now });
  emit({ kind: "system", drop: cur.id, note: `${cur.label}: closed early by the provider → ${cur.pool === "normal" ? "drawing now" : cur.pool === "premium" ? "revealing bids" : "holds closed"}` });
  return c.json({ ok: true, closesAt: now });
});

admin.delete("/drops/:id", async (c) => {
  await deleteDrop(c.req.param("id"));
  return c.json({ ok: true });
});

/** "Test a URL": which drop (and route kind) a URL hits, or "passes through". */
admin.post("/test-url", async (c) => {
  const { url, method = "GET" } = (await c.req.json()) as { url: string; method?: string };
  let u: URL;
  try {
    u = new URL(url, config.origin);
  } catch {
    return c.json({ error: "invalid url" }, 400);
  }
  const m = matchDrop(drops.all(), { method, path: u.pathname, query: u.searchParams, headers: {} });
  if (!m) return c.json({ match: false, result: "passes through" });
  return c.json({ match: true, drop: m.drop.id, label: m.drop.label, pool: m.drop.pool, kind: m.kind, params: m.params, peakOn: isPeak(m.drop) });
});

admin.post("/parse-url", async (c) => {
  const { url } = (await c.req.json()) as { url: string };
  try {
    return c.json(parseUrlForBuilder(url));
  } catch {
    return c.json({ error: "invalid url" }, 400);
  }
});

admin.get("/health", (c) => c.json(health));
admin.get("/outcomes", async (c) => c.json({ outcomes: await recentOutcomes() }));
admin.get("/drops/:id/log", async (c) => c.json({ events: await dropHistory(c.req.param("id")) }));
