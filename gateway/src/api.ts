import { Hono, type Context } from "hono";
import type { Drop, TraceStep } from "@surgepass/shared";
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
  const trace: TraceStep[] = [{ step: "request", detail: `POST /_sp/api/world/verify · ${d.label}` }];
  if (!(await allow(`verify:${clientIp(c)}`, VERIFY_PER_MIN, 60))) {
    trace.push({ step: "world", detail: `too many verification attempts from this address (limit ${VERIFY_PER_MIN}/min)`, ok: false }, { step: "decision", detail: "429 not allowed · no session" });
    emit({ kind: "human", drop: d.id, method: "POST", path: "/_sp/api/world/verify", status: 429, note: "World ID: rate limited → not allowed", trace });
    return c.json({ error: "rate_limited" }, 429);
  }
  const v = await verifyProof(result, enterAction(d.id));
  const env = config.world.configured ? config.world.environment : "local simulator";
  if (!v.ok) {
    const at: Record<string, number> = { malformed: 0, unknown_nonce: 1, action_mismatch: 2, signal_mismatch: 2, environment_mismatch: 3, rejected_by_world: 4 };
    const checks = [
      "looks like a World ID proof",
      "proof was requested by SurgePass (one-time nonce, never used before)",
      `bound to this drop (action enter:${d.id})`,
      `environment ${env}, pinned on the server`,
      config.world.configured ? "verified by the World Developer Portal" : "accepted by the local simulator",
    ];
    const failAt = at[v.reason] ?? 4;
    checks.slice(0, failAt).forEach((detail) => trace.push({ step: "world", detail, ok: true }));
    trace.push({ step: "world", detail: WORLD_FAIL[v.reason] ?? v.reason, ok: false });
    trace.push({ step: "decision", detail: "401 not allowed · no session, cannot enter the draw" });
    emit({ kind: "human", drop: d.id, method: "POST", path: "/_sp/api/world/verify", status: 401, note: `World ID verification failed: ${WORLD_FAIL[v.reason] ?? v.reason} → not allowed`, trace });
    return c.json({ error: "verification_failed", reason: v.reason }, 401);
  }
  const ttl = Math.max(600, Math.ceil((d.closesAt - Date.now()) / 1000) + d.passTtlSec + 3600);
  await issueSession(c, v.anonId, d.id, ttl);
  const already = !!(await getEntry(d.id, v.anonId));
  trace.push(
    { step: "world", detail: "proof was requested by SurgePass (one-time nonce, now consumed)", ok: true },
    { step: "world", detail: `bound to this drop (action enter:${d.id})`, ok: true },
    { step: "world", detail: `environment ${env}, pinned on the server`, ok: true },
    { step: "world", detail: config.world.configured ? "verified by the World Developer Portal" : "accepted by the local simulator", ok: true },
    { step: "identity", detail: `anonymous ID ${v.anonId.slice(0, 12)}… (one per human for this drop; no personal data)` },
    { step: "decision", detail: already ? "allowed · session issued (this human has already entered)" : "allowed · session issued, can now enter the draw" },
  );
  emit({ kind: "human", drop: d.id, method: "POST", path: "/_sp/api/world/verify", status: 200, note: "World ID verified → allowed", trace });
  return c.json({ ok: true, anonId: v.anonId, entered: already });
});

const WORLD_FAIL: Record<string, string> = {
  malformed: "not a valid World ID proof",
  unknown_nonce: "proof wasn't requested by SurgePass, or was already used (replay)",
  action_mismatch: "proof is for a different drop",
  signal_mismatch: "proof doesn't match the approved parameters",
  environment_mismatch: "proof is from the wrong World ID environment",
  rejected_by_world: "the World Developer Portal rejected the proof",
};

// ── Entries ────────────────────────────────────────────────────────────────
api.post("/drops/:id/enter", async (c) => {
  const d = drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  const { seats = 1 } = (await c.req.json().catch(() => ({}))) as { seats?: number };
  const r = await who(c, d.id);
  const trace: TraceStep[] = [{ step: "request", detail: `POST /_sp/api/drops/${d.id}/enter · ${seats} seat(s)` }];
  if (r.kind === "anonymous") {
    count("rejectedEntries");
    trace.push({ step: "identity", detail: "no World ID session and no agent token", ok: false }, { step: "decision", detail: "401 HumanApproval · not allowed to enter" });
    emit({ kind: "bot", method: "POST", path: c.req.path, status: 401, drop: d.id, note: "no human behind it → entry rejected", trace });
    return humanApprovalRequired(c, d);
  }
  trace.push({ step: "identity", detail: r.kind === "agent" ? `agent ${r.agent} for ${r.anonId.slice(0, 12)}… (approved by its human with World ID)` : `verified human ${r.anonId.slice(0, 12)}… (World ID session)`, ok: true });
  const out = await enter(d, { anonId: r.anonId, kind: r.kind, agentAccount: r.kind === "agent" ? r.agent : undefined, maxSeats: r.kind === "agent" ? r.seats : undefined }, Number(seats));
  if (!out.ok) {
    const why: Record<string, string> = {
      already_entered: "this human has already entered (one entry per human per drop)",
      not_open: "the draw window is not open",
      bad_seats: `seats must be 1–${r.kind === "agent" ? Math.min(r.seats, d.maxSeatsPerEntry) : d.maxSeatsPerEntry}`,
      premium_uses_bids: "this is a premium drop: place a sealed bid instead",
    };
    const status = out.error === "already_entered" ? 409 : 400;
    trace.push({ step: "entry", detail: why[out.error] ?? out.error, ok: false }, { step: "decision", detail: `${status} not allowed` });
    emit({ kind: r.kind, method: "POST", path: c.req.path, status, drop: d.id, note: `entry rejected: ${why[out.error] ?? out.error}`, trace });
    return c.json({ error: out.error }, status);
  }
  trace.push(
    { step: "entry", detail: "first entry for this human in this drop", ok: true },
    { step: "entry", detail: `${out.entry.seats} seat(s), within the limit of ${d.maxSeatsPerEntry}`, ok: true },
    { step: "decision", detail: "entered · being written to the drop's Hedera topic (HCS)" },
  );
  emit({ kind: r.kind, method: "POST", path: c.req.path, status: 200, drop: d.id, note: `entered the draw · ${out.entry.seats} seat(s)`, trace });
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
