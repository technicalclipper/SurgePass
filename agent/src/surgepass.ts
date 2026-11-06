import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner } from "@x402/hedera";
import { PrivateKey } from "@hiero-ledger/sdk";
import { randomBytes } from "node:crypto";
import { bidCommitment } from "@surgepass/shared";
import { env, envNum, isConfigured } from "@surgepass/shared/env";
import { load, save, type AgentState } from "./state.ts";

// Reference agent client. Uses only open standards: the drops API, 401 HumanApproval with a
// device code, bearer tokens, and x402 v2 payments on Hedera, paid autonomously within a budget.

export const GATEWAY = env("GATEWAY_ORIGIN", "http://localhost:8080");
export const ACCOUNT = isConfigured("AGENT_ACCOUNT_ID") ? env("AGENT_ACCOUNT_ID") : "0.0.local-agent";
const BUDGET = envNum("AGENT_BUDGET_INR", 50);

function parseKey(k: string): PrivateKey {
  const hex = k.startsWith("0x") ? k.slice(2) : k;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? PrivateKey.fromStringECDSA(hex) : PrivateKey.fromStringDer(k);
}

const live = isConfigured("AGENT_ACCOUNT_ID", "AGENT_PRIVATE_KEY");
const scheme = live
  ? new ExactHederaScheme(createClientHederaSigner(env("AGENT_ACCOUNT_ID"), parseKey(env("AGENT_PRIVATE_KEY")), { network: `hedera:${env("HEDERA_NETWORK", "testnet")}` }))
  : null;

let state: AgentState = load();
const persist = () => save(state);

async function call(path: string, init: RequestInit = {}, dropId?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-agent-account", ACCOUNT);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const tok = dropId ? state.tokens[dropId] : undefined;
  if (tok && !headers.has("authorization")) headers.set("authorization", `Bearer ${tok.token}`);
  return fetch(new URL(path, GATEWAY), { ...init, headers });
}

const json = async (r: Response) => (await r.json().catch(() => ({}))) as any;

export async function listDrops() {
  return (await json(await call("/_sp/api/drops"))).drops as any[];
}

export function findDrop(all: any[], query: string) {
  const q = query.toLowerCase();
  return all.find((d) => d.id === query) ?? all.find((d) => `${d.label} ${d.subtitle ?? ""} ${d.pool}`.toLowerCase().includes(q));
}

/** Connects the agent to its human (one World ID tap, ~30 days), with a budget. */
export async function connect(budgetInr = BUDGET) {
  const r = await call("/_sp/api/agent/link", { method: "POST", body: JSON.stringify({ agent_account: ACCOUNT, budget_inr: budgetInr }) });
  const b = await json(r);
  if (r.ok && b.linked) {
    state.linked = { budgetInr: b.budgetInr, linkedAt: b.linkedAt, expiresAt: b.expiresAt };
    persist();
    return { linked: true, ...state.linked, spentInr: b.spentInr };
  }
  state.pending.push({ userCode: b.user_code, deviceCode: b.device_code, approvalUrl: b.approval_url, drops: [], kind: "link", createdAt: Date.now() });
  persist();
  return { linked: false, approval_url: b.approval_url, user_code: b.user_code, message: "Ask your human to open the link and approve with World ID." };
}

/** Asks the human to approve one or more drops in one go. Returns the approval link to show them. */
export async function requestDrops(items: { id: string; seats: number; maxBid?: number }[]) {
  const r = await call("/_sp/api/approvals", { method: "POST", body: JSON.stringify({ agent_account: ACCOUNT, drops: items }) });
  const b = await json(r);
  if (r.status !== 401) return { error: b.error ?? `unexpected ${r.status}`, details: b };
  state.pending = state.pending.filter((p) => Date.now() - p.createdAt < 300_000); // approvals expire after 5 min
  state.pending.push({ userCode: b.user_code, deviceCode: b.device_code, approvalUrl: b.approval_url, drops: items.map((i) => i.id), kind: "drop", createdAt: Date.now() });
  persist();
  return { approval_url: b.approval_url, user_code: b.user_code, expires_in: b.expires_in, label: b.label };
}

/** Polls every pending approval once; stores tokens for approved ones. */
export async function pollApprovals() {
  const out: any[] = [];
  for (const p of [...state.pending]) {
    const b = await json(await call("/_sp/api/token", { method: "POST", body: JSON.stringify({ device_code: p.deviceCode }) }));
    if (b.error === "authorization_pending") {
      out.push({ code: p.userCode, status: "pending", approval_url: p.approvalUrl });
      continue;
    }
    state.pending = state.pending.filter((x) => x !== p);
    if (b.linked) {
      state.linked = { budgetInr: b.budgetInr, linkedAt: b.linkedAt, expiresAt: b.expiresAt };
      out.push({ code: p.userCode, status: "linked", budgetInr: b.budgetInr });
    } else if (b.access_tokens) {
      for (const t of b.access_tokens) state.tokens[t.drop] = { token: t.access_token, seats: t.seats, maxBid: t.maxBid, expiresAt: Date.now() + t.expires_in * 1000 };
      out.push({ code: p.userCode, status: "approved", drops: b.access_tokens.map((t: any) => t.drop) });
    } else {
      out.push({ code: p.userCode, status: b.error === "access_denied" ? "declined" : b.error === "expired_token" ? "expired" : b.error });
    }
  }
  persist();
  return out;
}

/** Waits for the human to approve (polling the token endpoint). */
export async function waitForApproval(timeoutMs = 300_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await pollApprovals();
    if (r.some((x) => x.status !== "pending") || !state.pending.length) return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  return pollApprovals();
}

/** GET with automatic x402 payment, within the budget. */
export async function paidGet(path: string, dropId?: string) {
  let r = await call(path, {}, dropId);
  if (r.status !== 402) return { status: r.status, body: await json(r), paid: null };
  const challenge = await json(r);
  const req = challenge.accepts?.[0] as PaymentRequirements | undefined;
  if (!req) return { status: 402, body: challenge, paid: null };
  const priceInr = Number(challenge.priceInr ?? 0);
  const budget = state.linked?.budgetInr ?? BUDGET;
  if (state.spentInr + priceInr > budget) return { status: 402, body: { error: "budget_reached", spentInr: state.spentInr, budgetInr: budget }, paid: null };

  let payload: Record<string, unknown>;
  if (req.extra?.mode === "local" || !scheme) payload = { transaction: "local", payer: ACCOUNT };
  else payload = (await scheme.createPaymentPayload(2, req)).payload;
  const header = encodePaymentSignatureHeader({ x402Version: 2, resource: challenge.resource, accepted: req, payload } as any);
  r = await call(path, { headers: { "PAYMENT-SIGNATURE": header } }, dropId);
  const resp = r.headers.get("payment-response");
  let txId: string | undefined;
  if (resp) txId = JSON.parse(Buffer.from(resp, "base64").toString("utf8")).transaction;
  if (r.ok && txId) {
    state.spentInr = Math.round((state.spentInr + priceInr) * 100) / 100;
    state.payments.push({ at: Date.now(), amountInr: priceInr, txId, url: path });
    persist();
  }
  return { status: r.status, body: await json(r), paid: r.ok ? { amountInr: priceInr, txId, hashscan: txId && !txId.startsWith("local") ? `https://hashscan.io/${env("HEDERA_NETWORK", "testnet")}/transaction/${txId}` : undefined, spentInr: state.spentInr, budgetInr: budget } : null };
}

export async function enter(dropId: string, seats?: number) {
  const tok = state.tokens[dropId];
  const r = await call(`/_sp/api/drops/${dropId}/enter`, { method: "POST", body: JSON.stringify({ seats: seats ?? tok?.seats ?? 1 }) }, dropId);
  const b = await json(r);
  if (r.status === 401) {
    state.pending.push({ userCode: b.user_code, deviceCode: b.device_code, approvalUrl: b.approval_url, drops: [dropId], kind: "drop", createdAt: Date.now() });
    persist();
    return { status: 401, approval_required: true, approval_url: b.approval_url, user_code: b.user_code };
  }
  return { status: r.status, ...b };
}

/** Premium: sealed bid at the human's approved max. Pays the deposit via x402 if asked. */
export async function bid(dropId: string, amount?: number, seats?: number) {
  const tok = state.tokens[dropId];
  const value = amount ?? tok?.maxBid;
  if (!value) return { error: "no approved max bid for this drop" };
  const secret = randomBytes(16).toString("hex");
  const commit = bidCommitment(value, secret);
  const body = JSON.stringify({ commit_hash: commit, seats: seats ?? tok?.seats ?? 1 });
  let r = await call(`/_sp/api/drops/${dropId}/bid/commit`, { method: "POST", body }, dropId);
  if (r.status === 402) {
    const challenge = await json(r);
    const req = challenge.accepts[0] as PaymentRequirements;
    const payload = req.extra?.mode === "local" || !scheme ? { transaction: "local", payer: ACCOUNT } : (await scheme.createPaymentPayload(2, req)).payload;
    const header = encodePaymentSignatureHeader({ x402Version: 2, resource: challenge.resource, accepted: req, payload } as any);
    r = await call(`/_sp/api/drops/${dropId}/bid/commit`, { method: "POST", body, headers: { "PAYMENT-SIGNATURE": header } }, dropId);
  }
  const b = await json(r);
  if (r.ok) {
    state.bids[dropId] = { amount: value, secret, seats: seats ?? tok?.seats ?? 1 };
    persist();
  }
  return { status: r.status, ...b };
}

export async function reveal(dropId: string) {
  const b = state.bids[dropId];
  if (!b) return { error: "no sealed bid" };
  const r = await call(`/_sp/api/drops/${dropId}/bid/reveal`, { method: "POST", body: JSON.stringify({ amount: b.amount, secret: b.secret }) }, dropId);
  return { status: r.status, ...(await json(r)) };
}

export async function status(dropId: string) {
  return json(await call(`/_sp/api/drops/${dropId}/status`, {}, dropId));
}

/** Books on the provider's normal page with the pass. */
export async function book(dropId: string, passengers: { name: string; age?: string }[]) {
  const p = await call(`/_sp/api/drops/${dropId}/pass`, {}, dropId);
  const pass = await json(p);
  if (!p.ok) return { error: pass.error ?? "no pass", status: pass.status };
  const u = new URL(pass.bookingUrl);
  const confirm = `${u.pathname}/confirm${u.search}`;
  const r = await call(confirm, { method: "POST", body: JSON.stringify({ passengers: passengers.slice(0, pass.seats) }), headers: { "x-surgepass-pass": pass.pass, accept: "application/json" } });
  return { status: r.status, seatsAllowed: pass.seats, ...(await json(r)) };
}

export const spending = () => ({ spentInr: state.spentInr, budgetInr: state.linked?.budgetInr ?? BUDGET, payments: state.payments.slice(-10), linked: !!state.linked });
export const tokens = () => Object.keys(state.tokens);
export const reload = () => (state = load());
