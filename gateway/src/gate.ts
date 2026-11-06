import type { Context } from "hono";
import { matchDrop, needsBody, type RequestShape } from "@surgepass/shared";
import { drops } from "./drops.ts";
import { isPeak } from "./mode.ts";
import { addRevenue, count, emit } from "./live.ts";
import { forward } from "./proxy.ts";
import { roomUrl } from "./room.ts";
import { assertionFor, checkPass, onFinalStep } from "./passes.ts";
import { who } from "./identity.ts";
import { slidingCount } from "./ratelimit.ts";
import { surgePriceInr } from "./pricing.ts";
import { paymentHeader, paymentRequired, settle } from "./x402.ts";
import { onAgentSpend } from "./spend.ts";
import { withinBudget } from "./agents.ts";

// The gate: every provider request comes through here. Cheapest checks first.

export async function gate(c: Context): Promise<Response> {
  count("requests");
  const req = c.req.raw;
  const url = new URL(req.url);
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
    count("forwarded");
    return forward(req, { body });
  }

  if (m.kind === "read") return readRoute(c, m.drop, url, body);

  // Booking route at peak: only pass holders get through.
  const pass = await checkPass(c, m.drop);
  if (pass.ok) {
    count("forwarded");
    const r = await who(c, m.drop.id);
    emit({ kind: r.kind === "agent" ? "agent" : "human", method: req.method, path: url.pathname, status: 200, drop: m.drop.id, note: `pass ✓ ${pass.rec.seats} seat(s) → provider` });
    const res = await forward(req, { body, assertion: await assertionFor(pass.rec) });
    return m.kind === "final" ? onFinalStep(m.drop, pass.rec, res) : res;
  }

  count("waitingRoom");
  emit({ kind: "bot", method: req.method, path: url.pathname, status: 302, drop: m.drop.id, note: pass.reason === "missing" ? "no pass → waiting room" : `pass ${pass.reason} → waiting room` });
  if (req.method !== "GET" || c.req.header("accept")?.includes("application/json")) {
    return c.json({ error: "pass_required", reason: pass.reason, waitingRoom: roomUrl(m.drop.id) }, 403);
  }
  return c.redirect(roomUrl(m.drop.id, url.pathname + url.search), 302);
}

/** Reads at peak: free within the human's quota (shared with their agents), otherwise paid via x402. */
async function readRoute(c: Context, drop: import("@surgepass/shared").Drop, url: URL, body?: ArrayBuffer): Promise<Response> {
  const req = c.req.raw;
  const r = await who(c, drop.id);
  const price = surgePriceInr(drop);
  const pay = paymentHeader((n) => c.req.header(n));

  if (!pay && r.kind !== "anonymous") {
    const used = await slidingCount(`q:${drop.id}:${r.anonId}`, drop.readPricing.windowSec);
    if (used <= drop.readPricing.freePerWindow) {
      count("freeReads");
      count("forwarded");
      return forward(req, { body });
    }
  }

  if (pay) {
    if (r.kind === "agent" && !(await withinBudget(r.agent, price))) {
      emit({ kind: "agent", method: req.method, path: url.pathname, status: 402, drop: drop.id, note: `budget reached · ${r.agent}` });
      return new Response(JSON.stringify({ error: "budget_exceeded" }), { status: 402, headers: { "content-type": "application/json" } });
    }
    const out = await settle(pay, price);
    if (!out.ok) {
      count("blocked");
      emit({ kind: r.kind === "anonymous" ? "bot" : r.kind, method: req.method, path: url.pathname, status: 402, drop: drop.id, note: `payment rejected: ${out.reason}` });
      return paymentRequired(url.toString(), price, `${drop.label} availability`);
    }
    count("paid");
    addRevenue(out.amountInr);
    emit({ kind: r.kind === "anonymous" ? "bot" : r.kind, method: req.method, path: url.pathname, status: 200, drop: drop.id, note: `paid ₹${out.amountInr.toFixed(2)}`, txId: out.txId });
    void onAgentSpend(r.kind === "agent" ? r.agent : (out.payer ?? ""), out.amountInr, out.txId);
    const res = await forward(req, { body });
    const h = new Headers(res.headers);
    h.set("PAYMENT-RESPONSE", out.responseHeader);
    return new Response(res.body, { status: res.status, headers: h });
  }

  count("challenged402");
  count("blocked");
  emit({ kind: r.kind === "anonymous" ? "bot" : r.kind, method: req.method, path: url.pathname, status: 402, drop: drop.id, note: `402 ₹${price.toFixed(2)}${r.kind === "anonymous" ? "" : " (over quota)"}` });
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
