import { Hono, type Context, type Next } from "hono";
import { PublicKey } from "@hiero-ledger/sdk";
import { randomBytes } from "node:crypto";
import { sha256Hex, type Drop, type PassRecord } from "@surgepass/shared";
import { config } from "./config.ts";
import { drops, saveDrop } from "./drops.ts";
import { enqueue } from "./hcsqueue.ts";
import { hederaLive, scheduleRefund, topicLink } from "./hedera.ts";
import { registerDropCreated } from "./hooks.ts";
import { createSeatToken, grantKyc, HtsError, mintSeats, probeUnapproved, setFrozen, tokenLink, transferSeats, wipeSeats } from "./hts.ts";
import { addRevenue, broadcast, emit } from "./live.ts";
import { surgePriceInr } from "./pricing.ts";
import { redis } from "./redis.ts";
import { getPass, issuePass, passFor, passToken, releaseSeats, bookingLink, onBooked, setPartnerRelease, setPassGuard } from "./passes.ts";
import { inrToUnits, paymentHeader, paymentRequired, settle } from "./x402.ts";

// Partner lane: allowlisted partners (travel agents, apps, resellers, agent platforms) get a
// separate quota. Their Hedera account key is the allowlist entry; only allowlisted accounts can
// hold the drop's seat tokens (HTS KYC). Flow:
//   join → KYC on the seat token · look → x402 fee · hold → x402 deposit, ordered by HCS consensus
//   → seat tokens sent within the partner's cap → book on the provider's normal site with the pass
//   → used seats retired, deposit refunded by a Hedera scheduled transaction.
// Not booked in time: seats wiped back, deposit kept, seats go to the public waitlist.
// Fares stay off-chain, paid the way partners pay today.

interface Partner {
  account: string;
  name: string;
  publicKey: string;
  keyType: "ED25519" | "ECDSA";
  status: "active" | "frozen";
  createdAt: number;
}

interface Hold {
  id: string;
  drop: string;
  partner: string;
  seats: number;
  perSeatInr: number;
  deposit: { payer: string; txId: string; amountInr: number };
  status: "queued" | "issued" | "booked" | "partially_booked" | "expired" | "unfilled" | "refused";
  consensusAt?: string;
  seq?: number;
  serials: number[];
  transferTx?: string;
  booked?: number;
  createdAt: number;
}

const K = {
  partner: (a: string) => `partner:${a}`,
  partners: "partners",
  allowed: (d: string) => `pallowed:${d}`,
  free: (d: string) => `pfree:${d}`,
  used: (d: string, a: string) => `pused:${d}:${a}`,
  hold: (id: string) => `phold:${id}`,
  holdsBy: (d: string, a: string) => `pholds:${d}:${a}`,
  queue: (d: string) => `pqueue:${d}`,
  stats: (a: string) => `pstats:${a}`,
  sig: (s: string) => `psig:${s}`,
  lock: (d: string) => `lock:pqueue:${d}`,
};

async function getPartner(account: string): Promise<Partner | null> {
  const v = await redis.get(K.partner(account));
  return v ? JSON.parse(v) : null;
}
async function getHold(id: string): Promise<Hold | null> {
  const v = await redis.get(K.hold(id));
  return v ? JSON.parse(v) : null;
}
async function putHold(h: Hold) {
  await redis.set(K.hold(h.id), JSON.stringify(h), "EX", 7 * 86_400);
}
const stat = (a: string, field: string, n = 1) => redis.hincrbyfloat(K.stats(a), field, n);

function log(d: Drop, msg: Parameters<typeof enqueue>[1], withTimestamp = false) {
  return d.hcsTopicId ? enqueue(d.hcsTopicId, msg, withTimestamp) : Promise.resolve({ seq: 0, txId: "" } as Awaited<ReturnType<typeof enqueue>>);
}

// ── Seat tokens for every partner drop ─────────────────────────────────────
registerDropCreated(async (created) => {
  if (created.pool !== "partner" || created.partner?.tokenId) return;
  const d = drops.get(created.id) ?? created;
  const tokenId = await createSeatToken(`SurgePass seats · ${d.label}`, "SEAT", d.seats);
  const serials = await mintSeats(tokenId, d.seats, d.id);
  await redis.del(K.free(d.id));
  if (serials.length) await redis.rpush(K.free(d.id), ...serials.map(String));
  await saveDrop({ ...d, partner: { ...d.partner!, tokenId } });
  emit({ kind: "system", drop: d.id, note: `seat token ${tokenId} · ${serials.length} seats minted` });
});

// ── Signed partner requests ────────────────────────────────────────────────
// Headers: X-Partner-Account, X-Partner-Timestamp (ms), X-Partner-Signature (hex) over
//   `${timestamp}\n${METHOD}\n${path+query}\n${sha256(body)}` with the partner's Hedera key.
type Env = { Variables: { partner: Partner } };

export function partnerMessage(ts: string, method: string, pathAndQuery: string, body: string) {
  return `${ts}\n${method.toUpperCase()}\n${pathAndQuery}\n${sha256Hex(body)}`;
}

async function requirePartner(c: Context<Env>, next: Next) {
  const account = c.req.header("x-partner-account");
  const ts = c.req.header("x-partner-timestamp");
  const sig = c.req.header("x-partner-signature");
  if (!account || !ts || !sig) return c.json({ error: "partner_signature_required" }, 401);
  const p = await getPartner(account);
  if (!p) {
    emit({ kind: "bot", method: c.req.method, path: c.req.path, status: 403, note: `not an allowlisted partner · ${account}`, outcome: { actor: "partner", ok: false, who: account, action: `${c.req.path.endsWith("/hold") ? "hold seats" : c.req.path.endsWith("/availability") ? "look at availability" : c.req.path.endsWith("/drops") ? "list partner drops" : "partner API"} · 403 not allowlisted` } });
    return c.json({ error: "not_allowlisted" }, 403);
  }
  if (Math.abs(Date.now() - Number(ts)) > 60_000) return c.json({ error: "stale_signature" }, 401);
  const u = new URL(c.req.url);
  const body = c.req.method === "GET" ? "" : await c.req.text();
  const msg = Buffer.from(partnerMessage(ts, c.req.method, u.pathname + u.search, body));
  let ok = false;
  try {
    const key = p.keyType === "ECDSA" ? PublicKey.fromStringECDSA(p.publicKey) : PublicKey.fromStringED25519(p.publicKey);
    ok = key.verify(msg, Buffer.from(sig, "hex"));
  } catch {
    ok = false;
  }
  if (!ok) return c.json({ error: "bad_signature" }, 401);
  if (!(await redis.set(K.sig(sha256Hex(sig)), "1", "EX", 120, "NX"))) return c.json({ error: "replayed" }, 401);
  if (p.status === "frozen") return c.json({ error: "partner_frozen" }, 403);
  c.set("partner", p);
  return next();
}

export const partnerApi = new Hono<Env>();
partnerApi.use("*", requirePartner);

const partnerDrop = (id: string) => {
  const d = drops.get(id);
  return d && d.pool === "partner" && d.partner ? d : null;
};

async function seatsLeft(d: Drop) {
  return redis.llen(K.free(d.id));
}

partnerApi.get("/drops", async (c) => {
  const p = c.get("partner");
  const out = [];
  for (const d of drops.all().filter((x) => x.pool === "partner")) {
    out.push({
      id: d.id,
      label: d.label,
      subtitle: d.subtitle,
      status: d.status,
      seats: d.seats,
      seatsLeft: await seatsLeft(d),
      capPerPartner: d.partner!.capPerPartner,
      depositInrPerSeat: d.partner!.depositInr,
      bookWithinSec: d.partner!.bookWithinSec,
      partnersFrom: d.opensAt + d.partner!.openDelaySec * 1000,
      closesAt: d.closesAt,
      tokenId: d.partner!.tokenId,
      allowed: !!(await redis.sismember(K.allowed(d.id), p.account)),
      used: Number((await redis.get(K.used(d.id, p.account))) ?? 0),
    });
  }
  return c.json({ partner: { name: p.name, account: p.account }, drops: out });
});

/** Joining a drop = KYC grant on its seat token, so this partner's account can receive seats. */
partnerApi.post("/drops/:id/join", async (c) => {
  const d = partnerDrop(c.req.param("id"));
  const p = c.get("partner");
  if (!d) return c.json({ error: "not_a_partner_drop" }, 404);
  if (await redis.sismember(K.allowed(d.id), p.account)) return c.json({ ok: true, already: true, tokenId: d.partner!.tokenId });
  try {
    const r = await grantKyc(d.partner!.tokenId!, p.account);
    await redis.sadd(K.allowed(d.id), p.account);
    void log(d, { t: "partner_allowed", drop: d.id, partner: p.account, token: d.partner!.tokenId! }).catch(() => {});
    emit({ kind: "agent", drop: d.id, note: `${p.name} allowlisted on seat token (KYC)`, txId: r.txId, outcome: { actor: "partner", ok: true, who: p.name, action: "KYC granted on the seat token" } });
    return c.json({ ok: true, tokenId: d.partner!.tokenId, kycTx: r.txId, link: r.link });
  } catch (e) {
    return c.json({ error: e instanceof HtsError ? e.code : "kyc_failed", message: String((e as Error).message) }, 400);
  }
});

/** Availability for partners: every look is metered via x402. */
partnerApi.get("/drops/:id/availability", async (c) => {
  const d = partnerDrop(c.req.param("id"));
  const p = c.get("partner");
  if (!d) return c.json({ error: "not_a_partner_drop" }, 404);
  const price = surgePriceInr(d);
  const pay = paymentHeader((n) => c.req.header(n));
  if (!pay) return paymentRequired(new URL(c.req.url).toString(), price, `${d.label} partner availability`);
  const out = await settle(pay, price);
  if (!out.ok) return c.json({ error: "payment_failed", reason: out.reason }, 402);
  addRevenue(out.amountInr);
  await stat(p.account, "looks");
  await stat(p.account, "lookFeesInr", out.amountInr);
  emit({ kind: "agent", drop: d.id, note: `${p.name} looked · paid ₹${out.amountInr.toFixed(2)}`, txId: out.txId });
  c.header("PAYMENT-RESPONSE", out.responseHeader);
  return c.json({
    seatsLeft: await seatsLeft(d),
    yourUsed: Number((await redis.get(K.used(d.id, p.account))) ?? 0),
    cap: d.partner!.capPerPartner,
    partnersFrom: d.opensAt + d.partner!.openDelaySec * 1000,
    paid: { amountInr: out.amountInr, txId: out.txId },
  });
});

/** Hold seats: refundable deposit via x402, then queued and ordered by Hedera consensus time. */
partnerApi.post("/drops/:id/hold", async (c) => {
  const d = partnerDrop(c.req.param("id"));
  const p = c.get("partner");
  if (!d) return c.json({ error: "not_a_partner_drop" }, 404);
  const pc = d.partner!;
  const now = Date.now();
  if (d.status !== "open" || now > d.closesAt) return c.json({ error: "not_open" }, 400);
  if (now < d.opensAt + pc.openDelaySec * 1000) return c.json({ error: "partners_not_yet", partnersFrom: d.opensAt + pc.openDelaySec * 1000 }, 400);
  if (!(await redis.sismember(K.allowed(d.id), p.account))) return c.json({ error: "join_first" }, 400);
  const { seats = 1 } = (await c.req.json().catch(() => ({}))) as { seats?: number };
  const used = Number((await redis.get(K.used(d.id, p.account))) ?? 0);
  if (!Number.isInteger(seats) || seats < 1 || used + seats > pc.capPerPartner) {
    return c.json({ error: "over_cap", cap: pc.capPerPartner, used }, 400);
  }
  const depositInr = pc.depositInr * seats;
  const pay = paymentHeader((n) => c.req.header(n));
  if (!pay) return paymentRequired(new URL(c.req.url).toString(), depositInr, `${d.label} · refundable deposit for ${seats} seat(s)`);
  const out = await settle(pay, depositInr);
  if (!out.ok) return c.json({ error: "deposit_failed", reason: out.reason }, 402);

  // Reserve against the cap now; released again if the hold isn't filled.
  const after = await redis.incrby(K.used(d.id, p.account), seats);
  if (after > pc.capPerPartner) {
    await redis.decrby(K.used(d.id, p.account), seats);
    await refund(d, p.account, out.payer ?? p.account, out.amountInr, "over cap");
    return c.json({ error: "over_cap", cap: pc.capPerPartner }, 400);
  }

  const hold: Hold = {
    id: `h_${randomBytes(6).toString("base64url")}`,
    drop: d.id,
    partner: p.account,
    seats,
    perSeatInr: pc.depositInr,
    deposit: { payer: out.payer ?? p.account, txId: out.txId, amountInr: out.amountInr },
    status: "queued",
    serials: [],
    createdAt: now,
  };
  await putHold(hold);
  await redis.rpush(K.holdsBy(d.id, p.account), hold.id);
  await stat(p.account, "holds");
  await stat(p.account, "depositsInr", out.amountInr);

  const s = await log(d, { t: "partner_hold", drop: d.id, partner: p.account, seats, hold: hold.id }, true);
  hold.consensusAt = s.consensusAt ?? String(Date.now() * 1000);
  hold.seq = s.seq;
  await putHold(hold);
  await redis.hset(K.queue(d.id), hold.id, hold.consensusAt);
  emit({ kind: "agent", drop: d.id, note: `${p.name} holds ${seats} seat(s) · deposit ₹${out.amountInr} · consensus ${hold.consensusAt}`, hcsSeq: s.seq, txId: out.txId, outcome: { actor: "partner", ok: true, who: p.name, action: `held ${seats} seat(s) · deposit ₹${out.amountInr} via x402` } });
  broadcast({ type: "partner_hold", drop: d.id, partner: p.name, seats, hold: hold.id });
  return c.json({ ok: true, hold: publicHold(hold) }, 202);
});

partnerApi.get("/drops/:id/holds", async (c) => {
  const p = c.get("partner");
  const d = partnerDrop(c.req.param("id"));
  if (!d) return c.json({ error: "not_a_partner_drop" }, 404);
  const ids = await redis.lrange(K.holdsBy(d.id, p.account), 0, -1);
  const holds = (await Promise.all(ids.map(getHold))).filter(Boolean) as Hold[];
  const out = [];
  for (const h of holds) {
    const rec = await passFor(d.id, h.id);
    out.push({ ...publicHold(h), pass: rec ? { status: rec.status, seats: rec.seats, expiresAt: rec.expiresAt } : null });
  }
  return c.json({ holds: out });
});

/** Pass for a filled hold: send as X-SurgePass-Pass to the provider's booking route. */
partnerApi.get("/drops/:id/holds/:hold/pass", async (c) => {
  const p = c.get("partner");
  const d = partnerDrop(c.req.param("id"));
  const h = await getHold(c.req.param("hold"));
  if (!d || !h || h.partner !== p.account) return c.json({ error: "not_found" }, 404);
  const rec = await passFor(d.id, h.id);
  if (!rec || rec.status !== "issued") return c.json({ error: "no_active_pass", status: rec?.status ?? h.status }, 404);
  return c.json({ pass: await passToken(rec), header: "X-SurgePass-Pass", seats: rec.seats, expiresAt: rec.expiresAt, bookingUrl: new URL(bookingLink(d), config.origin).toString(), serials: h.serials });
});

const publicHold = (h: Hold) => ({ id: h.id, seats: h.seats, status: h.status, serials: h.serials, consensusAt: h.consensusAt, seq: h.seq, deposit: h.deposit, booked: h.booked, transferTx: h.transferTx });

// ── Consensus-ordered allocation ───────────────────────────────────────────
function consensusKey(ts: string): bigint {
  if (!ts.includes(".")) return BigInt(ts) * 1000n;
  const [s, n = "0"] = ts.split(".");
  return BigInt(s!) * 1_000_000_000n + BigInt(n.padEnd(9, "0").slice(0, 9));
}

async function resolveQueue(d: Drop) {
  if (!(await redis.set(K.lock(d.id), "1", "PX", 20_000, "NX"))) return;
  try {
    const q = await redis.hgetall(K.queue(d.id));
    const ordered = Object.entries(q).sort(([, a], [, b]) => (consensusKey(a) < consensusKey(b) ? -1 : 1));
    for (const [holdId] of ordered) {
      await redis.hdel(K.queue(d.id), holdId);
      const h = await getHold(holdId);
      if (!h || h.status !== "queued") continue;
      const p = await getPartner(h.partner);
      const serials: number[] = [];
      for (let i = 0; i < h.seats; i++) {
        const s = await redis.lpop(K.free(d.id));
        if (!s) break;
        serials.push(Number(s));
      }
      if (!serials.length || !p || p.status === "frozen") {
        if (serials.length) await redis.lpush(K.free(d.id), ...serials.map(String));
        h.status = p?.status === "frozen" ? "refused" : "unfilled";
        await redis.decrby(K.used(d.id, h.partner), h.seats);
        await putHold(h);
        await refund(d, h.partner, h.deposit.payer, h.deposit.amountInr, h.status);
        emit({ kind: "agent", drop: d.id, note: `${p?.name ?? h.partner} hold ${h.status} · deposit refunded`, outcome: { actor: "partner", ok: false, who: p?.name ?? h.partner, action: h.status === "refused" ? "frozen by the provider · deposit refunded" : "partner quota full · no seats · deposit refunded" } });
        continue;
      }
      try {
        const t = await transferSeats(d.partner!.tokenId!, serials, h.partner);
        h.status = "issued";
        h.serials = serials;
        h.transferTx = t.txId;
        if (serials.length < h.seats) {
          const short = h.seats - serials.length;
          await redis.decrby(K.used(d.id, h.partner), short);
          await refund(d, h.partner, h.deposit.payer, short * h.perSeatInr, "seats ran out");
        }
        await putHold(h);
        await stat(h.partner, "seatsIssued", serials.length);
        await issuePass(d, { anonId: h.id, requested: h.seats, seats: serials.length }, null, h.partner);
        void log(d, { t: "seats_allocated", drop: d.id, partner: h.partner, serials, hold: h.id }).catch(() => {});
        emit({ kind: "agent", drop: d.id, note: `${p.name} ← ${serials.length} seat token(s) #${serials.join(", #")}`, txId: t.txId, outcome: { actor: "partner", ok: true, who: p.name, action: `received ${serials.length} seat token(s) on Hedera` } });
        broadcast({ type: "partner_allocated", drop: d.id, partner: p.name, serials });
      } catch (e) {
        await redis.lpush(K.free(d.id), ...serials.map(String));
        h.status = "refused";
        await redis.decrby(K.used(d.id, h.partner), h.seats);
        await putHold(h);
        await refund(d, h.partner, h.deposit.payer, h.deposit.amountInr, "refused by Hedera");
        emit({ kind: "system", drop: d.id, note: `Hedera refused seats for ${p.name}: ${e instanceof HtsError ? e.code : String(e).slice(0, 80)}`, outcome: { actor: "partner", ok: false, who: p.name, action: `Hedera refused the seat tokens · ${e instanceof HtsError ? e.code : "error"}` } });
      }
    }
  } finally {
    await redis.del(K.lock(d.id));
  }
}

export function startPartnerQueue() {
  setInterval(() => {
    for (const d of drops.all()) if (d.pool === "partner" && d.partner?.tokenId) void resolveQueue(d).catch((e) => emit({ kind: "system", drop: d.id, note: `partner queue: ${String(e).slice(0, 80)}` }));
  }, 1500).unref();
}

// ── Booking, refunds, reclaim ──────────────────────────────────────────────
async function refund(d: Drop, partner: string, payer: string, amountInr: number, why: string) {
  if (amountInr <= 0) return;
  await stat(partner, "refundsInr", amountInr);
  try {
    const s = await scheduleRefund(payer, inrToUnits(amountInr), new Date(Date.now() + 60_000), `SurgePass deposit ${d.id}`);
    emit({ kind: "system", drop: d.id, txId: s?.txId, note: s ? `deposit ₹${amountInr} refund scheduled (${why}) · ${s.scheduleId}` : hederaLive ? `⚠ refund not scheduled: set SURGEPASS_PAY_TO_KEY` : `deposit ₹${amountInr} refunded (${why}, local)` });
  } catch (e) {
    emit({ kind: "system", drop: d.id, note: `refund scheduling failed: ${String(e).slice(0, 80)}` });
  }
}

/** Partner booked on the provider: retire the used seat tokens, refund the deposit for them. */
onBooked(async (d, rec, booked) => {
  if (d.pool !== "partner" || !rec.partner) return;
  const h = await getHold(rec.sub);
  if (!h) return;
  const used = h.serials.slice(0, Math.min(booked, h.serials.length));
  if (used.length) await wipeSeats(d.partner!.tokenId!, h.partner, used);
  h.booked = used.length;
  h.status = used.length < h.serials.length ? "partially_booked" : "booked";
  await putHold(h);
  await stat(h.partner, "seatsBooked", used.length);
  void log(d, { t: "seats_redeemed", drop: d.id, partner: h.partner, serials: used }).catch(() => {});
  await refund(d, h.partner, h.deposit.payer, used.length * h.perSeatInr, "booked");
  const p = await getPartner(h.partner);
  emit({ kind: "agent", drop: d.id, note: `${p?.name ?? h.partner} booked ${used.length} seat(s) · tokens retired · deposit back`, outcome: { actor: "partner", ok: true, who: p?.name ?? h.partner, action: `booked ${used.length} seat(s) · deposit refunded` } });
});

/** Unused partner seats (not booked, or the pass expired): wipe them back, keep the deposit, give them to the public. */
setPartnerRelease(async (d: Drop, rec: PassRecord, count: number) => {
  const h = await getHold(rec.sub);
  if (!h) return;
  const unused = h.serials.slice(h.booked ?? 0).slice(0, count);
  if (unused.length) await wipeSeats(d.partner!.tokenId!, h.partner, unused).catch((e) => emit({ kind: "system", drop: d.id, note: `wipe failed: ${String(e).slice(0, 80)}` }));
  if (rec.status === "expired" || h.status === "issued") h.status = h.booked ? "partially_booked" : "expired";
  await putHold(h);
  await redis.decrby(K.used(d.id, h.partner), unused.length);
  await stat(h.partner, "seatsReclaimed", unused.length);
  await stat(h.partner, "forfeitedInr", unused.length * h.perSeatInr);
  const target = d.partner?.spillTo ? drops.get(d.partner.spillTo) : undefined;
  void log(d, { t: "seats_reclaimed", drop: d.id, partner: h.partner, serials: unused, to: target?.id }).catch(() => {});
  const p = await getPartner(h.partner);
  emit({ kind: "system", drop: d.id, note: `${unused.length} unused seat(s) reclaimed from ${p?.name ?? h.partner} · deposit kept${target ? ` · → ${target.label} waitlist` : ""}`, outcome: { actor: "partner", ok: false, who: p?.name ?? h.partner, action: `${unused.length} unused seat(s) taken back · deposit kept` } });
  if (target && unused.length) {
    // Before the public draw: the draw simply gets more seats. After it: the waitlist gets them.
    const fresh = drops.get(target.id)!;
    if (fresh.status === "open" || fresh.status === "scheduled") await saveDrop({ ...fresh, seats: fresh.seats + unused.length });
    else await releaseSeats(fresh, { ...rec, jti: `spill-${rec.jti}`, price: null, pool: fresh.pool }, unused.length);
  }
});

/** A frozen partner can't use passes it already has. */
setPassGuard(async (rec) => {
  if (!rec.partner) return true;
  const p = await getPartner(rec.partner);
  return !!p && p.status === "active";
});

// ── Provider console ───────────────────────────────────────────────────────
export function registerPartnerAdmin(admin: Hono) {
  admin.get("/partners", async (c) => {
    const accounts = await redis.smembers(K.partners);
    const out = [];
    for (const a of accounts) {
      const p = await getPartner(a);
      if (!p) continue;
      const s = await redis.hgetall(K.stats(a));
      out.push({ ...p, stats: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)])) });
    }
    return c.json({ partners: out.sort((x, y) => x.createdAt - y.createdAt) });
  });

  /** Allowlist a partner by its Hedera account. The public key comes from the mirror node when live. */
  admin.post("/partners", async (c) => {
    const { name, account, publicKey, keyType } = (await c.req.json()) as { name?: string; account?: string; publicKey?: string; keyType?: string };
    if (!name || !account) return c.json({ error: "name and account required" }, 400);
    let key = publicKey;
    let type: Partner["keyType"] = keyType === "ECDSA" ? "ECDSA" : "ED25519";
    if (!key && config.hedera.configured) {
      const r = await fetch(`${config.hedera.mirrorNode}/api/v1/accounts/${account}`).catch(() => null);
      const j = (await r?.json().catch(() => null)) as { key?: { _type: string; key: string } } | null;
      if (!j?.key) return c.json({ error: "account_not_found_on_hedera" }, 400);
      key = j.key.key;
      type = j.key._type.startsWith("ECDSA") ? "ECDSA" : "ED25519";
    }
    if (!key) return c.json({ error: "publicKey required in local mode" }, 400);
    const p: Partner = { account, name, publicKey: key, keyType: type, status: "active", createdAt: Date.now() };
    await redis.multi().set(K.partner(account), JSON.stringify(p)).sadd(K.partners, account).exec();
    emit({ kind: "system", note: `partner allowlisted · ${name} · ${account}` });
    return c.json(p, 201);
  });

  /** Freeze (or unfreeze) a partner everywhere: registry and every seat token it holds. */
  admin.post("/partners/:account/freeze", async (c) => {
    const p = await getPartner(c.req.param("account"));
    if (!p) return c.json({ error: "not_found" }, 404);
    const { frozen = true } = (await c.req.json().catch(() => ({}))) as { frozen?: boolean };
    p.status = frozen ? "frozen" : "active";
    await redis.set(K.partner(p.account), JSON.stringify(p));
    const txs: string[] = [];
    for (const d of drops.all().filter((x) => x.pool === "partner" && x.partner?.tokenId)) {
      if (!(await redis.sismember(K.allowed(d.id), p.account))) continue;
      const r = await setFrozen(d.partner!.tokenId!, p.account, frozen).catch(() => null);
      if (r) txs.push(r.txId);
      void log(d, { t: "partner_frozen", partner: p.account, frozen }).catch(() => {});
    }
    emit({ kind: "system", note: `${p.name} ${frozen ? "frozen" : "unfrozen"} on ${txs.length} seat token(s)`, txId: txs[0] });
    return c.json({ ok: true, partner: p, txs });
  });

  /** Proof for the demo: hand a seat to an account that isn't allowlisted and show Hedera's answer. */
  admin.post("/partners/probe", async (c) => {
    const { drop, account } = (await c.req.json()) as { drop: string; account: string };
    const d = partnerDrop(drop);
    if (!d?.partner?.tokenId) return c.json({ error: "not_a_partner_drop" }, 404);
    const serial = await redis.lindex(K.free(d.id), 0);
    if (!serial) return c.json({ error: "no_free_seat_to_probe" }, 400);
    const r = await probeUnapproved(d.partner.tokenId, Number(serial), account);
    if (!r.refused) {
      await redis.lrem(K.free(d.id), 1, serial);
      emit({ kind: "system", drop: d.id, note: `probe: seat #${serial} sent to ${account} (it was allowlisted)` });
    } else emit({ kind: "system", drop: d.id, note: `Hedera refused seat #${serial} → ${account}: ${r.code}`, outcome: { actor: "partner", ok: false, who: account, action: `Hedera refused a seat token · ${r.code}` } });
    return c.json(r);
  });

  admin.get("/partners/holds/:drop", async (c) => {
    const d = partnerDrop(c.req.param("drop"));
    if (!d) return c.json({ error: "not_a_partner_drop" }, 404);
    const accounts = await redis.smembers(K.allowed(d.id));
    const holds: (Hold & { partnerName?: string })[] = [];
    for (const a of accounts) {
      const p = await getPartner(a);
      const ids = await redis.lrange(K.holdsBy(d.id, a), 0, -1);
      for (const id of ids) {
        const h = await getHold(id);
        if (h) holds.push({ ...h, partnerName: p?.name });
      }
    }
    return c.json({
      drop: d.id,
      tokenId: d.partner?.tokenId,
      tokenLink: tokenLink(d.partner?.tokenId),
      topicLink: topicLink(d.hcsTopicId),
      seatsLeft: await seatsLeft(d),
      holds: holds.sort((a, b) => (consensusKey(a.consensusAt ?? "0") < consensusKey(b.consensusAt ?? "0") ? -1 : 1)),
    });
  });
}

export { getPass };
