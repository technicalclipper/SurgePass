import { Hono, type Context } from "hono";
import { randomBytes } from "node:crypto";
import type { Drop } from "@surgepass/shared";
import { config } from "./config.ts";
import { drops } from "./drops.ts";
import { sign } from "./keys.ts";
import { broadcast, emit } from "./live.ts";
import { redis } from "./redis.ts";
import { enterAction, issueRpContext, linkAction, verifyProof } from "./world.ts";
import { agentSpent } from "./spend.ts";

// Agents act for verified humans. Two approvals, both one World ID tap by the human:
//   1. Agent link (once, ~30 days): binds the agent's Hedera account to a human, with a budget.
//   2. Drop approval (per request, ahead of time): the agent gets a bearer token scoped to that
//      drop, seat count and (for premium) max bid. Uses the same `enter:<drop>` action as a human
//      entering directly, so one human is one entry whichever way they come in.
// Flow is device-code style: the agent gets a 401 with an approval link + user code, shows it to
// its human, and polls the token endpoint with its secret device code.

export const agents = new Hono();

const APPROVAL_TTL = 300;
const LINK_DAYS = 30;

interface ApprovalItem {
  drop: string;
  seats: number;
  maxBid?: number;
  anonId?: string;
}

interface Approval {
  code: string;
  deviceCode: string;
  kind: "drop" | "link";
  agent: string;
  budgetInr?: number;
  items: ApprovalItem[];
  status: "pending" | "approved" | "declined";
  createdAt: number;
  expiresAt: number;
}

const K = {
  approval: (code: string) => `approval:${code}`,
  device: (dc: string) => `device:${dc}`,
  link: (acct: string) => `agentlink:${acct}`,
};

const userCode = () => {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () => Array.from(randomBytes(4), (b) => A[b % A.length]).join("");
  return `${pick()}-${pick()}`;
};

/** Signal bound into the World proof, so an approval can't be reused with other parameters. */
const signalFor = (a: Approval, it: ApprovalItem) => `agent:${a.agent}|seats:${it.seats}|maxbid:${it.maxBid ?? 0}`;

async function createApproval(kind: Approval["kind"], agent: string, items: ApprovalItem[], budgetInr?: number): Promise<Approval> {
  const a: Approval = {
    code: userCode(),
    deviceCode: randomBytes(24).toString("base64url"),
    kind,
    agent,
    budgetInr,
    items,
    status: "pending",
    createdAt: Date.now(),
    expiresAt: Date.now() + APPROVAL_TTL * 1000,
  };
  await redis.multi().set(K.approval(a.code), JSON.stringify(a), "EX", APPROVAL_TTL + 600).set(K.device(a.deviceCode), a.code, "EX", APPROVAL_TTL + 600).exec();
  emit({ kind: "agent", note: `${kind === "link" ? "link" : "approval"} requested · ${agent} · code ${a.code}`, drop: items[0]?.drop });
  return a;
}

async function getApproval(code: string): Promise<Approval | null> {
  const v = await redis.get(K.approval(code.toUpperCase()));
  return v ? JSON.parse(v) : null;
}

async function saveApproval(a: Approval) {
  await redis.set(K.approval(a.code), JSON.stringify(a), "KEEPTTL");
}

function challengeBody(a: Approval, label: string) {
  return {
    error: "human_approval_required",
    drop: a.items[0]?.drop,
    label,
    approval_url: `${config.origin}/_sp/room/approve/${a.code}`,
    user_code: a.code,
    device_code: a.deviceCode,
    token_endpoint: `${config.origin}/_sp/api/token`,
    expires_in: APPROVAL_TTL,
    interval: 2,
  };
}

/** 401 HumanApproval for an agent that tries to enter without a token. */
export async function approvalChallenge(c: Context, d: Drop): Promise<Response> {
  const body = (await c.req.json().catch(() => ({}))) as { seats?: number; maxBid?: number; agent_account?: string };
  const agent = c.req.header("x-agent-account") ?? body.agent_account ?? "unknown";
  const seats = Math.min(d.maxSeatsPerEntry, Math.max(1, Number(body.seats ?? 1)));
  const a = await createApproval("drop", agent, [{ drop: d.id, seats, maxBid: body.maxBid }]);
  c.header("WWW-Authenticate", `HumanApproval realm="${d.id}"`);
  return c.json(challengeBody(a, d.label), 401);
}

// ── Agent-facing ───────────────────────────────────────────────────────────

/** Request approval for one or more drops at once (shown on one screen). */
agents.post("/approvals", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { agent_account?: string; drops?: { id: string; seats?: number; maxBid?: number }[] };
  const agent = c.req.header("x-agent-account") ?? body.agent_account;
  if (!agent) return c.json({ error: "agent_account required" }, 400);
  const items: ApprovalItem[] = [];
  for (const x of body.drops ?? []) {
    const d = drops.get(x.id);
    if (!d) return c.json({ error: "unknown_drop", drop: x.id }, 404);
    if (d.pool === "premium" && d.premium && x.maxBid !== undefined && (x.maxBid < d.premium.floorInr || x.maxBid > d.premium.ceilingInr)) {
      return c.json({ error: "max_bid_out_of_range", drop: d.id, floorInr: d.premium.floorInr, ceilingInr: d.premium.ceilingInr }, 400);
    }
    items.push({ drop: d.id, seats: Math.min(d.maxSeatsPerEntry, Math.max(1, Number(x.seats ?? 1))), maxBid: x.maxBid });
  }
  if (!items.length) return c.json({ error: "drops required" }, 400);
  const a = await createApproval("drop", agent, items);
  c.header("WWW-Authenticate", `HumanApproval realm="${items.map((i) => i.drop).join(",")}"`);
  return c.json(challengeBody(a, items.map((i) => drops.get(i.drop)!.label).join(" · ")), 401);
});

/** Agent link: connect once, with a spending budget. */
agents.post("/agent/link", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { agent_account?: string; budget_inr?: number };
  const agent = c.req.header("x-agent-account") ?? body.agent_account;
  if (!agent) return c.json({ error: "agent_account required" }, 400);
  const existing = await redis.get(K.link(agent));
  if (existing) return c.json({ linked: true, ...JSON.parse(existing), spentInr: await agentSpent(agent) });
  const a = await createApproval("link", agent, [], Math.max(1, Number(body.budget_inr ?? 50)));
  c.header("WWW-Authenticate", `HumanApproval realm="agent-link"`);
  return c.json({ ...challengeBody(a, `Connect agent ${agent}`), error: "human_approval_required" }, 401);
});

agents.get("/agent/link/:account", async (c) => {
  const v = await redis.get(K.link(c.req.param("account")));
  if (!v) return c.json({ linked: false }, 404);
  return c.json({ linked: true, ...JSON.parse(v), spentInr: await agentSpent(c.req.param("account")) });
});

/** Device-code token endpoint. */
agents.post("/token", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { device_code?: string };
  const code = body.device_code ? await redis.get(K.device(body.device_code)) : null;
  const a = code ? await getApproval(code) : null;
  if (!a) return c.json({ error: "invalid_grant" }, 400);
  if (a.status === "declined") return c.json({ error: "access_denied" }, 400);
  if (a.status === "pending") {
    if (Date.now() > a.expiresAt) return c.json({ error: "expired_token" }, 400);
    return c.json({ error: "authorization_pending" }, 400);
  }
  await redis.del(K.device(a.deviceCode)); // one exchange only
  if (a.kind === "link") return c.json({ linked: true, agent: a.agent, ...JSON.parse((await redis.get(K.link(a.agent))) ?? "{}") });
  const tokens = [];
  for (const it of a.items) {
    const d = drops.get(it.drop);
    if (!d || !it.anonId) continue;
    const ttl = Math.max(600, Math.ceil((d.closesAt - Date.now()) / 1000) + d.passTtlSec + 3600);
    const token = await sign("agent", { sub: it.anonId, drop: d.id, agent: a.agent, seats: it.seats, maxBid: it.maxBid }, ttl);
    tokens.push({ drop: d.id, token_type: "Bearer", access_token: token, seats: it.seats, maxBid: it.maxBid, expires_in: ttl });
  }
  emit({ kind: "agent", note: `token issued · ${a.agent} · ${tokens.length} drop(s)` });
  return c.json({ access_tokens: tokens });
});

// ── Human-facing (approval page) ───────────────────────────────────────────
agents.get("/approvals/:code", async (c) => {
  const a = await getApproval(c.req.param("code"));
  if (!a) return c.json({ error: "not_found" }, 404);
  const expired = a.status === "pending" && Date.now() > a.expiresAt;
  const link = await redis.get(K.link(a.agent));
  return c.json({
    code: a.code,
    kind: a.kind,
    agent: a.agent,
    status: expired ? "expired" : a.status,
    expiresAt: a.expiresAt,
    budgetInr: a.budgetInr ?? (link ? JSON.parse(link).budgetInr : undefined),
    spentInr: await agentSpent(a.agent),
    linked: !!link,
    items: a.items.map((it) => {
      const d = drops.get(it.drop);
      return { drop: it.drop, label: d?.label, subtitle: d?.subtitle, pool: d?.pool, seats: it.seats, maxBid: it.maxBid, approved: !!it.anonId };
    }),
  });
});

/** World ID context for one item of the approval (or the link). */
agents.post("/approvals/:code/context", async (c) => {
  const a = await getApproval(c.req.param("code"));
  if (!a || a.status !== "pending" || Date.now() > a.expiresAt) return c.json({ error: "not_pending" }, 400);
  const { drop } = (await c.req.json().catch(() => ({}))) as { drop?: string };
  if (a.kind === "link") return c.json(await issueRpContext(linkAction(a.agent), `budget:${a.budgetInr}`));
  const it = a.items.find((i) => i.drop === drop && !i.anonId);
  if (!it) return c.json({ error: "unknown_item" }, 400);
  return c.json(await issueRpContext(enterAction(it.drop), signalFor(a, it)));
});

agents.post("/approvals/:code/verify", async (c) => {
  const a = await getApproval(c.req.param("code"));
  if (!a || a.status !== "pending") return c.json({ error: "not_pending" }, 400);
  if (Date.now() > a.expiresAt) return c.json({ error: "expired" }, 400);
  const { drop, result } = (await c.req.json().catch(() => ({}))) as { drop?: string; result?: unknown };

  if (a.kind === "link") {
    const v = await verifyProof(result, linkAction(a.agent), `budget:${a.budgetInr}`);
    if (!v.ok) return c.json({ error: "verification_failed", reason: v.reason }, 401);
    const link = { agent: a.agent, human: v.anonId, budgetInr: a.budgetInr, linkedAt: Date.now(), expiresAt: Date.now() + LINK_DAYS * 86_400_000 };
    await redis.set(K.link(a.agent), JSON.stringify(link), "EX", LINK_DAYS * 86_400);
    a.status = "approved";
    await saveApproval(a);
    emit({ kind: "agent", note: `agent linked · ${a.agent} · budget ₹${a.budgetInr}` });
    broadcast({ type: "agent_link", agent: a.agent, budgetInr: a.budgetInr });
    return c.json({ ok: true, status: a.status });
  }

  const it = a.items.find((i) => i.drop === drop && !i.anonId);
  if (!it) return c.json({ error: "unknown_item" }, 400);
  const v = await verifyProof(result, enterAction(it.drop), signalFor(a, it));
  if (!v.ok) return c.json({ error: "verification_failed", reason: v.reason }, 401);
  it.anonId = v.anonId;
  if (a.items.every((i) => i.anonId)) a.status = "approved";
  await saveApproval(a);
  emit({ kind: "agent", drop: it.drop, note: `approved by human · ${a.agent} · ${it.seats} seat(s)${it.maxBid ? ` · max ₹${it.maxBid}` : ""}` });
  return c.json({ ok: true, status: a.status });
});

agents.post("/approvals/:code/decline", async (c) => {
  const a = await getApproval(c.req.param("code"));
  if (!a || a.status !== "pending") return c.json({ error: "not_pending" }, 400);
  a.status = "declined";
  await saveApproval(a);
  emit({ kind: "agent", note: `approval declined · ${a.agent}`, drop: a.items[0]?.drop });
  return c.json({ ok: true, status: a.status });
});

/** Budget check before settling an agent's payment. */
export async function withinBudget(account: string | undefined, amountInr: number): Promise<boolean> {
  if (!account) return true;
  const v = await redis.get(K.link(account));
  if (!v) return true;
  const { budgetInr } = JSON.parse(v) as { budgetInr?: number };
  if (!budgetInr) return true;
  return (await agentSpent(account)) + amountInr <= budgetInr + 1e-9;
}
