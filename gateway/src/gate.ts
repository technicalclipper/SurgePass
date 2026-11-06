import type { Context } from "hono";
import { matchDrop, needsBody, type Drop, type DropMatch, type RequestShape, type TraceStep } from "@surgepass/shared";
import { drops } from "./drops.ts";
import { isPeak, peakReason } from "./mode.ts";
import { addRevenue, count, emit } from "./live.ts";
import { forward } from "./proxy.ts";
import { roomUrl } from "./room.ts";
import { assertionFor, checkPass, onFinalStep } from "./passes.ts";
import { who, type Requester } from "./identity.ts";
import { slidingCount } from "./ratelimit.ts";
import { surgePriceInr } from "./pricing.ts";
import { paymentHeader, paymentRequired, settle } from "./x402.ts";
import { onAgentSpend } from "./spend.ts";
import { withinBudget } from "./agents.ts";
import { config } from "./config.ts";

// The gate: every provider request comes through here. Cheapest checks first.
// Each request carries a decision trace (what came in, which drop it matched, whether peak is on,
// who sent it, which check passed or failed, and what the gate did) for the live console.

class Trace {
  steps: TraceStep[] = [];
  private t0 = process.hrtime.bigint();
  private decidedAt: bigint | null = null;
  add(step: TraceStep["step"], detail: string, ok?: boolean) {
    this.steps.push(ok === undefined ? { step, detail } : { step, detail, ok });
    return this;
  }
  /** Marks the moment the gate has decided; time after this is the provider's, not ours. */
  decided() {
    this.decidedAt ??= process.hrtime.bigint();
    return this;
  }
  get us() {
    return Number(((this.decidedAt ?? process.hrtime.bigint()) - this.t0) / 1000n);
  }
}

const who_ = (r: Requester): string =>
  r.kind === "human"
    ? `verified human ${r.anonId.slice(0, 10)}… (World ID session for this drop)`
    : r.kind === "agent"
      ? `agent ${r.agent} acting for ${r.anonId.slice(0, 10)}… (bearer token, ${r.seats} seat(s) approved)`
      : "anonymous: no World ID session, no agent token, no pass";

const kindOf = (r: Requester): "human" | "agent" | "bot" => (r.kind === "anonymous" ? "bot" : r.kind);

function describeMatch(m: DropMatch): string {
  const conds = m.drop.conditions.map((c) => `${c.location}.${c.key}=${Array.isArray(c.value) ? c.value.join("|") : (c.value ?? "*")}`).join(" ");
  return `"${m.drop.label}" · ${m.kind} route · ${m.kind === "read" ? m.drop.readPatterns[0] : m.kind === "final" ? m.drop.finalStepPattern : m.drop.pattern}${conds ? ` · ${conds}` : ""}`;
}

export async function gate(c: Context): Promise<Response> {
  count("requests");
  const req = c.req.raw;
  const url = new URL(req.url);
  const t = new Trace().add("request", `${req.method} ${url.pathname}${url.search}`);
  const all = drops.all();

  let body: ArrayBuffer | undefined;
  const shape: RequestShape = {
    method: req.method,
    path: url.pathname,
    query: url.searchParams,
    headers: Object.fromEntries(req.headers),
  };
  if (req.method !== "GET" && req.method !== "HEAD" && needsBody(all)) {
    body = await req.arrayBuffer();
    shape.body = parseBody(body, req.headers.get("content-type"));
  }

  const m = all.length ? matchDrop(all, shape) : null;
  if (!m || !isPeak(m.drop)) {
    if (m) t.add("match", describeMatch(m), true).add("peak", peakReason(m.drop), false);
    else t.add("match", "no registered drop matches this URL", false);
    t.add("decision", `forward untouched → ${config.upstream}`).decided();
    count("forwarded");
    const started = Date.now();
    const res = await forward(req, { body });
    t.add("upstream", `${res.status} from the provider in ${Date.now() - started} ms`, res.status < 500);
    emit({ kind: "forward", method: req.method, path: url.pathname, status: res.status, drop: m?.drop.id, note: m ? "not peak → passed through" : "not a drop → passed through", trace: t.steps, us: t.us });
    return res;
  }

  t.add("match", describeMatch(m), true).add("peak", peakReason(m.drop), true);
  if (m.kind === "read") return readRoute(c, m.drop, url, t, body);

  // Booking route at peak: only pass holders get through.
  const r = await who(c, m.drop.id);
  t.add("identity", who_(r));
  const pass = await checkPass(c, m.drop);
  if (pass.ok) {
    const rec = pass.rec;
    t.add("pass", `valid · ${rec.seats} seat(s)${rec.partner ? ` · partner ${rec.partner}` : ""} · signature, drop, expiry and single use checked`, true);
    t.add("decision", `forward to the provider with a signed X-SurgePass-Assertion (seats ${rec.seats}${rec.price ? `, price ₹${rec.price}` : ""}); SurgePass cookies stripped`).decided();
    count("forwarded");
    const started = Date.now();
    const res = await forward(req, { body, assertion: await assertionFor(rec) });
    const out = m.kind === "final" ? await onFinalStep(m.drop, rec, res) : res;
    t.add("upstream", `${out.status} from the provider in ${Date.now() - started} ms${m.kind === "final" && out.ok ? " · final step: pass marked used, unbooked seats released" : ""}`, out.status < 400);
    emit({
      kind: r.kind === "agent" || rec.partner ? "agent" : "human",
      method: req.method,
      path: url.pathname,
      status: out.status,
      drop: m.drop.id,
      note: `${rec.partner ? `partner ${rec.partner} · ` : ""}pass ✓ ${rec.seats} seat(s) → provider`,
      trace: t.steps,
      us: t.us,
    });
    return out;
  }

  const reasons: Record<string, string> = {
    missing: "no pass (no sp_pass cookie, no X-SurgePass-Pass header)",
    invalid: "pass signature invalid",
    wrong_drop: "pass is for a different drop",
    expired: "pass expired",
    used: "pass already used",
    blocked: "pass holder is frozen",
  };
  t.add("pass", reasons[pass.reason] ?? pass.reason, false);
  count("waitingRoom");
  const json = req.method !== "GET" || c.req.header("accept")?.includes("application/json");
  const room = roomUrl(m.drop.id, json ? undefined : url.pathname + url.search);
  t.add("decision", json ? `403 pass_required (API call) → points to the waiting room ${roomUrl(m.drop.id)}` : `302 redirect → waiting room ${roomUrl(m.drop.id)}`).decided();
  t.add("upstream", "not contacted: the provider never sees this request", true);
  emit({ kind: kindOf(r), method: req.method, path: url.pathname, status: json ? 403 : 302, drop: m.drop.id, note: pass.reason === "missing" ? "no pass → waiting room" : `pass ${pass.reason} → waiting room`, trace: t.steps, us: t.us });
  if (json) return c.json({ error: "pass_required", reason: pass.reason, waitingRoom: roomUrl(m.drop.id) }, 403);
  return c.redirect(room, 302);
}

/** Reads at peak: free within the human's quota (shared with their agents), otherwise paid via x402. */
async function readRoute(c: Context, drop: Drop, url: URL, t: Trace, body?: ArrayBuffer): Promise<Response> {
  const req = c.req.raw;
  const r = await who(c, drop.id);
  t.add("identity", who_(r));
  const price = surgePriceInr(drop);
  const pay = paymentHeader((n) => c.req.header(n));

  if (!pay && r.kind !== "anonymous") {
    const used = await slidingCount(`q:${drop.id}:${r.anonId}`, drop.readPricing.windowSec);
    const free = drop.readPricing.freePerWindow;
    if (used <= free) {
      t.add("quota", `free read ${used} of ${free} per ${drop.readPricing.windowSec}s for this human`, true);
      t.add("decision", `forward to the provider (free)`).decided();
      count("freeReads");
      count("forwarded");
      const started = Date.now();
      const res = await forward(req, { body });
      t.add("upstream", `${res.status} from the provider in ${Date.now() - started} ms`, res.status < 500);
      emit({ kind: kindOf(r), method: req.method, path: url.pathname, status: res.status, drop: drop.id, note: "free read within quota", trace: t.steps, us: t.us });
      return res;
    }
    t.add("quota", `over quota: read ${used} of ${free} per ${drop.readPricing.windowSec}s`, false);
  } else if (!pay) {
    t.add("quota", "no free quota: free reads are only for verified humans and their agents", false);
  }

  if (pay) {
    if (r.kind === "agent" && !(await withinBudget(r.agent, price))) {
      t.add("budget", `agent ${r.agent} has reached its human's budget`, false).add("decision", "402 budget_exceeded").decided();
      emit({ kind: "agent", method: req.method, path: url.pathname, status: 402, drop: drop.id, note: `budget reached · ${r.agent}`, trace: t.steps, us: t.us, outcome: { actor: "agent", ok: false, who: `agent ${r.agent}`, action: "paid read · budget reached" } });
      return new Response(JSON.stringify({ error: "budget_exceeded" }), { status: 402, headers: { "content-type": "application/json" } });
    }
    const out = await settle(pay, price);
    if (!out.ok) {
      t.add("payment", `PAYMENT-SIGNATURE rejected: ${out.reason}`, false).add("decision", `402 Payment Required · ₹${price.toFixed(2)} (x402)`).decided();
      count("blocked");
      emit({ kind: kindOf(r), method: req.method, path: url.pathname, status: 402, drop: drop.id, note: `payment rejected: ${out.reason}`, trace: t.steps, us: t.us });
      return paymentRequired(url.toString(), price, `${drop.label} availability`);
    }
    t.add("payment", `x402 verified and settled on Hedera · ₹${out.amountInr.toFixed(2)} · tx ${out.txId}`, true);
    t.add("decision", "forward to the provider (paid)").decided();
    count("paid");
    addRevenue(out.amountInr);
    void onAgentSpend(r.kind === "agent" ? r.agent : (out.payer ?? ""), out.amountInr, out.txId);
    const started = Date.now();
    const res = await forward(req, { body });
    t.add("upstream", `${res.status} from the provider in ${Date.now() - started} ms`, res.status < 500);
    emit({ kind: kindOf(r), method: req.method, path: url.pathname, status: res.status, drop: drop.id, note: `paid ₹${out.amountInr.toFixed(2)}`, txId: out.txId, trace: t.steps, us: t.us, outcome: r.kind === "agent" ? { actor: "agent", ok: true, who: `agent ${r.agent}`, action: `paid read · ₹${out.amountInr.toFixed(2)} via x402` } : undefined });
    const h = new Headers(res.headers);
    h.set("PAYMENT-RESPONSE", out.responseHeader);
    return new Response(res.body, { status: res.status, headers: h });
  }

  t.add("payment", "no PAYMENT-SIGNATURE header", false);
  t.add("decision", `402 Payment Required · surge price ₹${price.toFixed(2)} per read (x402 v2, Hedera)`).decided();
  t.add("upstream", "not contacted: the provider never sees this request", true);
  count("challenged402");
  count("blocked");
  emit({ kind: kindOf(r), method: req.method, path: url.pathname, status: 402, drop: drop.id, note: `402 ₹${price.toFixed(2)}${r.kind === "anonymous" ? "" : " (over quota)"}`, trace: t.steps, us: t.us });
  return paymentRequired(url.toString(), price, `${drop.label} availability`);
}

function parseBody(buf: ArrayBuffer, type: string | null): Record<string, unknown> | undefined {
  const text = new TextDecoder().decode(buf);
  try {
    if (type?.includes("json")) return JSON.parse(text);
    if (type?.includes("form")) return Object.fromEntries(new URLSearchParams(text));
  } catch {
    return undefined;
  }
  return undefined;
}
