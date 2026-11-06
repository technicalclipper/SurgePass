import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { getPath, sha256Hex, type Allocation, type Drop, type PassClaims, type PassRecord } from "@surgepass/shared";
import { config } from "./config.ts";
import { drops } from "./drops.ts";
import { enqueue } from "./hcsqueue.ts";
import { sign, verify } from "./keys.ts";
import { broadcastPublic, emit } from "./live.ts";
import { PASS_COOKIE } from "./proxy.ts";
import { redis } from "./redis.ts";

// One-time passes: issued to winners, checked at the gateway on booking routes, marked used when
// the final step succeeds. A pass is a ceiling, not a hold: unbooked seats go straight back to
// the waitlist, and an expired pass releases all of its seats.

export const PASS_HEADER = "x-surgepass-pass";

type BookedHook = (drop: Drop, rec: PassRecord, booked: number) => Promise<void>;
const bookedHooks: BookedHook[] = [];
export function onBooked(fn: BookedHook) {
  bookedHooks.push(fn);
}

const K = {
  pass: (jti: string) => `pass:${jti}`,
  byOwner: (drop: string, anon: string) => `passby:${drop}:${anon}`,
  expiry: "passexp",
  waitlist: (d: string) => `waitlist:${d}`,
  released: (d: string) => `released:${d}`,
  lock: (d: string) => `lock:realloc:${d}`,
};

type PartnerRelease = (drop: Drop, rec: PassRecord, count: number) => Promise<void>;
let partnerRelease: PartnerRelease | null = null;
export function setPartnerRelease(fn: PartnerRelease) {
  partnerRelease = fn;
}

type PassGuard = (rec: PassRecord) => Promise<boolean>;
let passGuard: PassGuard = async () => true;
export function setPassGuard(fn: PassGuard) {
  passGuard = fn;
}

export async function issuePass(drop: Drop, a: Allocation, price: number | null = null, partner?: string): Promise<PassRecord> {
  const jti = `p_${randomBytes(9).toString("base64url")}`;
  const now = Date.now();
  const rec: PassRecord = {
    drop: drop.id,
    sub: a.anonId,
    pool: drop.pool,
    seats: a.seats,
    requested: a.requested,
    price,
    jti,
    partner,
    issuedAt: now,
    expiresAt: now + drop.passTtlSec * 1000,
    status: "issued",
  };
  await redis
    .multi()
    .set(K.pass(jti), JSON.stringify(rec), "EX", drop.passTtlSec + 86_400)
    .set(K.byOwner(drop.id, a.anonId), jti, "EX", drop.passTtlSec + 86_400)
    .zadd(K.expiry, rec.expiresAt, jti)
    .exec();
  if (drop.hcsTopicId) void enqueue(drop.hcsTopicId, { t: "pass_issued", drop: drop.id, jti_hash: sha256Hex(jti).slice(0, 32), seats: a.seats }).catch(() => {});
  emit({ kind: "pass", drop: drop.id, note: `pass issued · ${a.seats} seat(s)${a.seats < a.requested ? ` of ${a.requested}` : ""}` });
  broadcastPublic({ type: "pass", drop: drop.id, anonId: a.anonId, seats: a.seats, requested: a.requested, expiresAt: rec.expiresAt });
  return rec;
}

export async function getPass(jti: string): Promise<PassRecord | null> {
  const v = await redis.get(K.pass(jti));
  return v ? JSON.parse(v) : null;
}

export async function passFor(dropId: string, anonId: string): Promise<PassRecord | null> {
  const jti = await redis.get(K.byOwner(dropId, anonId));
  return jti ? getPass(jti) : null;
}

/** The signed token a winner (or their agent) presents to the gateway. */
export async function passToken(rec: PassRecord) {
  const claims: PassClaims = { drop: rec.drop, sub: rec.sub, pool: rec.pool, seats: rec.seats, requested: rec.requested, price: rec.price, jti: rec.jti, partner: rec.partner };
  return sign("pass", claims, Math.max(60, Math.ceil((rec.expiresAt - Date.now()) / 1000)));
}

/** Booking link with the drop's path values and matched query values filled in. */
export function bookingLink(d: Drop): string {
  let path = d.bookingUrl.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (m, k) => d.values[k] ?? m);
  const q = new URLSearchParams();
  for (const c of d.conditions) if (c.location === "query" && c.operator === "equals" && typeof c.value === "string") q.set(c.key, c.value);
  const qs = q.toString();
  if (qs && !path.includes("?")) path += `?${qs}`;
  return path;
}

/** Sets the pass cookie on the provider's domain (first party) and returns where to go. */
export async function claimIntoCookie(c: Context, rec: PassRecord) {
  const token = await passToken(rec);
  const map = passCookieMap(c);
  map[rec.drop] = token;
  const ttl = Math.max(60, Math.ceil((rec.expiresAt - Date.now()) / 1000));
  c.header(
    "set-cookie",
    `${PASS_COOKIE}=${encodeURIComponent(JSON.stringify(map))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}${new URL(c.req.url).protocol === "https:" ? "; Secure" : ""}`,
    { append: true },
  );
}

function passCookieMap(c: Context): Record<string, string> {
  try {
    return JSON.parse(decodeURIComponent(getCookie(c, PASS_COOKIE) ?? "{}"));
  } catch {
    return {};
  }
}

export type PassCheck = { ok: true; rec: PassRecord } | { ok: false; reason: "missing" | "invalid" | "wrong_drop" | "expired" | "used" | "blocked" };

/** Signature ✔ right drop ✔ not expired ✔ not used. Header (agents) or cookie (browsers). */
export async function checkPass(c: Context, drop: Drop): Promise<PassCheck> {
  const token = c.req.header(PASS_HEADER) ?? passCookieMap(c)[drop.id];
  if (!token) return { ok: false, reason: "missing" };
  const claims = await verify<PassClaims & { exp: number }>("pass", token);
  if (!claims) return { ok: false, reason: "invalid" };
  if (claims.drop !== drop.id) return { ok: false, reason: "wrong_drop" };
  const rec = await getPass(claims.jti);
  if (!rec) return { ok: false, reason: "invalid" };
  if (rec.status === "used") return { ok: false, reason: "used" };
  if (rec.status === "expired" || Date.now() > rec.expiresAt) return { ok: false, reason: "expired" };
  if (!(await passGuard(rec))) return { ok: false, reason: "blocked" };
  return { ok: true, rec };
}

/** X-SurgePass-Assertion for the gateway → provider hop. */
export function assertionFor(rec: PassRecord) {
  return sign("assertion", { drop: rec.drop, pool: rec.pool, seats: rec.seats, requested: rec.requested, price: rec.price, pass_id: rec.jti, partner: rec.partner }, 300, config.audience);
}

/** Called after the final booking step returns. Marks the pass used and releases unbooked seats. */
export async function onFinalStep(drop: Drop, rec: PassRecord, res: Response): Promise<Response> {
  if (!res.ok) return res;
  const text = await res.text();
  let booked = rec.seats;
  try {
    const n = Number(getPath(JSON.parse(text), drop.confirmedSeatsField ?? "seats_booked"));
    if (Number.isFinite(n) && n >= 0) booked = n;
  } catch {
    // Response wasn't JSON; assume the full pass was used.
  }
  const used: PassRecord = { ...rec, status: "used", booked };
  await redis.multi().set(K.pass(rec.jti), JSON.stringify(used), "KEEPTTL").zrem(K.expiry, rec.jti).exec();
  emit({ kind: "pass", drop: drop.id, note: `booked ${booked} of ${rec.seats} seat(s)` });
  if (booked > rec.seats) emit({ kind: "system", drop: drop.id, note: `⚠ overbooked: ${booked} booked on a ${rec.seats}-seat pass` });
  // Record the booking first (partner lane retires the used seat tokens here), then release the rest.
  for (const fn of bookedHooks) await fn(drop, used, booked).catch((e) => emit({ kind: "system", drop: drop.id, note: `booking hook failed: ${String(e).slice(0, 100)}` }));
  if (booked < rec.seats) await releaseSeats(drop, used, rec.seats - booked);
  broadcastPublic({ type: "booked", drop: drop.id, anonId: rec.sub, booked });
  return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Gives freed seats to the waitlist in order (min(requested, left)); any left over go to fair first come. */
export async function releaseSeats(drop: Drop, rec: PassRecord, count: number) {
  if (count <= 0) return;
  if (drop.pool === "partner" && partnerRelease) return partnerRelease(drop, rec, count);
  if (drop.hcsTopicId) void enqueue(drop.hcsTopicId, { t: "seats_released", drop: drop.id, jti_hash: sha256Hex(rec.jti).slice(0, 32), count }).catch(() => {});
  emit({ kind: "pass", drop: drop.id, note: `${count} seat(s) released` });

  while (!(await redis.set(K.lock(drop.id), "1", "PX", 5000, "NX"))) await new Promise((r) => setTimeout(r, 50));
  try {
    let left = count;
    while (left > 0) {
      const raw = await redis.lpop(K.waitlist(drop.id));
      if (!raw) break;
      const w = JSON.parse(raw) as { anonId: string; requested: number };
      const seats = Math.min(w.requested, left);
      left -= seats;
      await issuePass(drop, { anonId: w.anonId, requested: w.requested, seats }, rec.price);
      emit({ kind: "pass", drop: drop.id, note: `waitlist → ${seats} seat(s)` });
    }
    if (left > 0) {
      await redis.incrby(K.released(drop.id), left);
      broadcastPublic({ type: "released", drop: drop.id, seats: await releasedCount(drop.id) });
    }
  } finally {
    await redis.del(K.lock(drop.id));
  }
}

export async function releasedCount(dropId: string) {
  return Number((await redis.get(K.released(dropId))) ?? 0);
}

/** Expires passes past their time and hands their seats on. */
export function startPassExpiry() {
  setInterval(async () => {
    const due = await redis.zrangebyscore(K.expiry, 0, Date.now(), "LIMIT", 0, 100);
    for (const jti of due) {
      if (!(await redis.zrem(K.expiry, jti))) continue;
      const rec = await getPass(jti);
      if (!rec || rec.status !== "issued") continue;
      await redis.set(K.pass(jti), JSON.stringify({ ...rec, status: "expired" }), "KEEPTTL");
      const d = drops.get(rec.drop);
      emit({ kind: "pass", drop: rec.drop, note: `pass expired · ${rec.seats} seat(s) back` });
      if (d) await releaseSeats(d, rec, rec.seats);
    }
  }, 1000).unref();
}
