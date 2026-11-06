import { Hono, type Context } from "hono";
import type { Drop } from "@surgepass/shared";
import { drops } from "./drops.ts";
import { issueSession, who } from "./identity.ts";
import { count, emit } from "./live.ts";
import { allEntries, enter, entryCount, getEntry, getResult, verifyBundle } from "./lottery.ts";
import { isPeak } from "./mode.ts";
import { allow } from "./ratelimit.ts";
import { enterAction, issueRpContext, verifyProof } from "./world.ts";
import { topicLink } from "./hedera.ts";
import { addStatusExtra, personalStatus } from "./status.ts";
import { bookingLink, claimIntoCookie, passFor, passToken, releasedCount } from "./passes.ts";
import { config } from "./config.ts";
import { premiumPublic } from "./premium.ts";
import { envNum } from "@surgepass/shared/env";

const CTX_PER_MIN = envNum("WORLD_CONTEXT_PER_MIN", 30);
const VERIFY_PER_MIN = envNum("WORLD_VERIFY_PER_MIN", 20);

// Public SurgePass API used by the waiting room and agents. Mounted at /_sp/api.

export const api = new Hono();

export function clientIp(c: Context): string {
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}

export function publicDrop(d: Drop) {
  return {
    id: d.id,
    label: d.label,
    subtitle: d.subtitle,
    pool: d.pool,
    status: d.status,
    opensAt: d.opensAt,
    closesAt: d.closesAt,
    seats: d.seats,
    maxSeatsPerEntry: d.maxSeatsPerEntry,
    priceInr: d.priceInr,
    premium: d.premium,
    bookingUrl: d.bookingUrl,
    passTtlSec: d.passTtlSec,
    hcsTopicId: d.hcsTopicId,
    topicLink: topicLink(d.hcsTopicId),
    peakOn: isPeak(d),
  };
}

api.get("/drops", (c) => c.json({ drops: drops.all().filter((d) => d.pool !== "partner").map(publicDrop) }));

api.get("/drops/:id", async (c) => {
  const d = drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  return c.json({ ...publicDrop(d), entries: await entryCount(d.id) });
});

// ── World ID for humans ────────────────────────────────────────────────────
api.post("/world/context", async (c) => {
  const { dropId } = (await c.req.json().catch(() => ({}))) as { dropId?: string };
  const d = dropId ? drops.get(dropId) : undefined;
  if (!d) return c.json({ error: "not_found" }, 404);
  if (!(await allow(`ctx:${clientIp(c)}`, CTX_PER_MIN, 60))) return c.json({ error: "rate_limited" }, 429);
  return c.json(await issueRpContext(enterAction(d.id)));
});

api.post("/world/verify", async (c) => {
  const { dropId, result } = (await c.req.json().catch(() => ({}))) as { dropId?: string; result?: unknown };
  const d = dropId ? drops.get(dropId) : undefined;
  if (!d) return c.json({ error: "not_found" }, 404);
  if (!(await allow(`verify:${clientIp(c)}`, VERIFY_PER_MIN, 60))) return c.json({ error: "rate_limited" }, 429);
  const v = await verifyProof(result, enterAction(d.id));
  if (!v.ok) {
    emit({ kind: "bot", drop: d.id, path: "/_sp/api/world/verify", status: 401, note: `World ID rejected: ${v.reason}` });
    return c.json({ error: "verification_failed", reason: v.reason }, 401);
  }
  const ttl = Math.max(600, Math.ceil((d.closesAt - Date.now()) / 1000) + d.passTtlSec + 3600);
  await issueSession(c, v.anonId, d.id, ttl);
  emit({ kind: "human", drop: d.id, note: "World ID verified" });
  return c.json({ ok: true, anonId: v.anonId, entered: !!(await getEntry(d.id, v.anonId)) });
});

// ── Entries ────────────────────────────────────────────────────────────────
api.post("/drops/:id/enter", async (c) => {
  const d = drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  const { seats = 1 } = (await c.req.json().catch(() => ({}))) as { seats?: number };
  const r = await who(c, d.id);
  if (r.kind === "anonymous") {
    count("rejectedEntries");
    emit({ kind: "bot", method: "POST", path: c.req.path, status: 401, drop: d.id, note: "no human approval → rejected" });
    return humanApprovalRequired(c, d);
  }
  const out = await enter(d, { anonId: r.anonId, kind: r.kind, agentAccount: r.kind === "agent" ? r.agent : undefined, maxSeats: r.kind === "agent" ? r.seats : undefined }, Number(seats));
  if (!out.ok) return c.json({ error: out.error }, out.error === "already_entered" ? 409 : 400);
  return c.json({ ok: true, entry: out.entry });
});

/** Replaced by the agent module with the full 401 HumanApproval challenge. */
let challenge: (c: Context, d: Drop) => Promise<Response> | Response = (c) => c.json({ error: "human_approval_required" }, 401);
export function setApprovalChallenge(fn: typeof challenge) {
  challenge = fn;
}
const humanApprovalRequired = (c: Context, d: Drop) => challenge(c, d);

api.get("/drops/:id/status", async (c) => {
  const d = drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  const r = await who(c, d.id);
  return c.json(await personalStatus(d, r));
});

api.get("/drops/:id/verify", async (c) => {
  const d = drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  return c.json({ ...(await verifyBundle(d)), premium: await premiumPublic(d) });
});

api.get("/drops/:id/entries", async (c) => {
  const d = drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  const entries = await allEntries(d.id);
  return c.json({ entries: entries.map((e) => ({ anonId: e.anonId, seats: e.seats, seq: e.seq, kind: e.kind })), result: await getResult(d.id) });
});

// ── Passes ─────────────────────────────────────────────────────────────────
addStatusExtra(async (d, anonId) => {
  const rec = await passFor(d.id, anonId);
  const released = await releasedCount(d.id);
  if (!rec) return { released };
  return {
    released,
    pass: { seats: rec.seats, requested: rec.requested, price: rec.price, status: rec.status, expiresAt: rec.expiresAt, booked: rec.booked },
    outcome: { result: rec.status === "used" ? "booked" : rec.status === "expired" ? "expired" : "won", seats: rec.seats, requested: rec.requested, partial: rec.seats < rec.requested, price: rec.price },
  };
});

/** Winner (browser) → sets the pass cookie on this domain → the provider's normal booking page. */
api.get("/drops/:id/claim", async (c) => {
  const d = drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  const r = await who(c, d.id);
  if (r.kind === "anonymous") return c.redirect(`/_sp/room/${d.id}`);
  const rec = await passFor(d.id, r.anonId);
  if (!rec || rec.status !== "issued" || Date.now() > rec.expiresAt) return c.redirect(`/_sp/room/${d.id}`);
  await claimIntoCookie(c, rec);
  return c.redirect(bookingLink(d));
});

/** Agents fetch their pass token and booking URL; they send it as X-SurgePass-Pass. */
api.get("/drops/:id/pass", async (c) => {
  const d = drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  const r = await who(c, d.id);
  if (r.kind === "anonymous") return c.json({ error: "unauthorized" }, 401);
  const rec = await passFor(d.id, r.anonId);
  if (!rec || rec.status !== "issued") return c.json({ error: "no_active_pass", status: rec?.status ?? null }, 404);
  return c.json({ pass: await passToken(rec), header: "X-SurgePass-Pass", seats: rec.seats, expiresAt: rec.expiresAt, bookingUrl: new URL(bookingLink(d), config.origin).toString() });
});
