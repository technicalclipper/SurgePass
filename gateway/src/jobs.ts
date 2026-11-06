import { spawn } from "node:child_process";
import { Client, PrivateKey, TokenAssociateTransaction } from "@hiero-ledger/sdk";
import type { Hono } from "hono";
import { REPO_ROOT } from "@surgepass/shared/env";
import type { Drop } from "@surgepass/shared";
import { config } from "./config.ts";
import { drops } from "./drops.ts";
import { broadcast, emit } from "./live.ts";

// The console's scenario buttons. Each job runs the real agent / partner clients (agent/src/cli.ts,
// agent/src/partner.ts) step by step as child processes, exactly as a third party would run them,
// and streams progress to the console. The gate's own allow/refuse decisions land in the Compare
// columns as usual; a job only drives the client side.

type Step = { label: string; script?: "cli" | "partner"; args?: string[]; fn?: () => Promise<{ code: number; out: string }>; expect?: RegExp; /** The point of this step is to be turned away: matching `expect` means it was refused. */ refused?: boolean; approval?: boolean; repeatUntil?: RegExp; everyMs?: number; maxMs?: number };
/** `expect`: what should happen to this actor at the gate. A "refused" case passes when it is blocked. */
type Scenario = { title: string; who: string; expect: "allowed" | "refused"; pools: Drop["pool"][]; build: (d: Drop) => Step[] | string };

export interface Job {
  id: string;
  scenario: string;
  title: string;
  who: string;
  /** done: let through as expected · blocked: turned away as expected · failed: something else happened. */
  status: "running" | "waiting_approval" | "done" | "blocked" | "failed";
  expect: "allowed" | "refused";
  drop: string;
  dropLabel: string;
  steps: { label: string; status: "pending" | "running" | "ok" | "refused" | "failed"; out?: string }[];
  approvalUrl?: string;
  startedAt: number;
  endedAt?: number;
}

/** Seconds until a drop closes: how long an agent job keeps waiting for its human. */
const untilClose = (d: Drop) => String(Math.max(60, Math.ceil((d.closesAt - Date.now()) / 1000)));

const SCRIPTS = { cli: "agent/src/cli.ts", partner: "agent/src/partner.ts" };
const AVAIL = "/availability/12007/2026-11-06/CC?quota=TQ";

const SCENARIOS: Record<string, Scenario> = {
  "agent-normal": {
    title: "Agent enters the draw",
    expect: "allowed",
    who: "Your agent",
    pools: ["normal"],
    build: (d) => {
      const seats = String(Math.min(2, d.maxSeatsPerEntry));
      return [
        { label: `Ask its human for approval · ${seats} seat(s)`, script: "cli", args: ["request", d.id, seats], approval: true },
        { label: "Wait for the human's World ID tap (open until the drop closes)", script: "cli", args: ["wait", untilClose(d)] },
        { label: `Enter the draw for ${seats} seat(s)`, script: "cli", args: ["enter", d.id, seats], expect: /"ok": true/ },
        ...(/12007/.test(d.label) ? [{ label: "Check availability (x402 beyond the free quota)", script: "cli" as const, args: ["check", d.id, AVAIL] }] : []),
      ];
    },
  },
  "agent-premium": {
    title: "Agent bids in the auction",
    expect: "allowed",
    who: "Your agent",
    pools: ["premium"],
    build: (d) => {
      const max = String(Math.min(d.premium?.ceilingInr ?? 3000, Math.max(d.premium?.floorInr ?? 0, 3000)));
      return [
        { label: `Ask its human for approval · max bid ₹${Number(max).toLocaleString("en-IN")}`, script: "cli", args: ["request", d.id, "1", max], approval: true },
        { label: "Wait for the human's World ID tap (open until bidding closes)", script: "cli", args: ["wait", untilClose(d)] },
        { label: "Seal a bid · pay the deposit via x402", script: "cli", args: ["enter", d.id], expect: /"ok": true/ },
        { label: "Reveal the bid when bidding closes, then read the result", script: "cli", args: ["status", d.id], repeatUntil: /"status": "(results|closed)"/, everyMs: 5000, maxMs: 40 * 60_000 },
      ];
    },
  },
  rogue: {
    title: "Rogue agent, no human behind it",
    expect: "refused",
    who: "Script with no World ID",
    pools: ["normal", "premium"],
    build: (d) => [{ label: d.pool === "premium" ? "Place a sealed bid with no approval" : "Enter the draw with no approval", script: "cli", args: ["rogue", d.id], expect: /^401/m, refused: true }],
  },
  "partner-tripnest": {
    title: "Allowlisted partner books seats",
    expect: "allowed",
    who: "TripNest",
    pools: ["partner"],
    build: (d) => [
      { label: "Provider allowlists TripNest's Hedera account", fn: () => allowlist("TripNest", process.env.PARTNER_TRIPNEST_ACCOUNT_ID) },
      { label: "TripNest associates the seat token", script: "partner", args: ["--as", "tripnest", "associate", d.id], expect: /associated|ALREADY_ASSOCIATED/ },
      { label: "KYC granted on the seat token (Hedera)", script: "partner", args: ["--as", "tripnest", "join", d.id], expect: /"ok": true/ },
      { label: "Paid look at partner availability", script: "partner", args: ["--as", "tripnest", "look", d.id] },
      { label: "Hold 1 seat · refundable deposit via x402", script: "partner", args: ["--as", "tripnest", "hold", d.id, "1"], expect: /^202/m },
      { label: "Wait for the seat token on Hedera", script: "partner", args: ["--as", "tripnest", "wait", d.id] },
      { label: "Book on the provider site · deposit refunded (or quota full → deposit refunded)", script: "partner", args: ["--as", "tripnest", "book", d.id, "Asha"], expect: /"ok": true|no issued hold/ },
    ],
  },
  "partner-unlisted": {
    title: "Company that isn't allowlisted",
    expect: "refused",
    who: "BulkSeats",
    pools: ["partner"],
    build: (d) => [
      { label: "Look at partner availability", script: "partner", args: ["--as", "bulkseats", "look", d.id], expect: /403|not_allowlisted/, refused: true },
      { label: "Try to hold 4 seats", script: "partner", args: ["--as", "bulkseats", "hold", d.id, "4"], expect: /403|not_allowlisted/, refused: true },
    ],
  },
  "hedera-probe": {
    title: "Slip a seat token to a non-partner",
    expect: "refused",
    who: "Account without KYC",
    pools: ["partner"],
    build: (d) => {
      const account = process.env.AGENT_ACCOUNT_ID;
      const tokenId = d.partner?.tokenId;
      if (!tokenId) return "this drop has no seat token yet";
      if (!account) return "AGENT_ACCOUNT_ID not set";
      return [
        { label: `${account} associates the seat token (but has no KYC)`, fn: () => associate(account, process.env.AGENT_PRIVATE_KEY, tokenId) },
        {
          label: `Send seat token ${tokenId} to ${account} on Hedera`,
          refused: true,
          fn: async () => {
            const r = await fetch(`http://localhost:${config.port}/_sp/admin/partners/probe`, { method: "POST", headers: { authorization: `Bearer ${config.adminToken}`, "content-type": "application/json" }, body: JSON.stringify({ drop: d.id, account }) });
            const b = (await r.json()) as { refused?: boolean; code?: string; error?: string };
            if (b.error) return { code: 1, out: b.error === "no_free_seat_to_probe" ? "Not sent: every partner seat is already handed out (reset the drops for free seats)" : `Not sent: ${b.error}` };
            return { code: b.refused ? 0 : 1, out: b.refused ? `Refused by Hedera, as expected: ${b.code} (this account has no KYC on the seat token)` : "⚠ Hedera accepted the transfer: this account had KYC on the seat token" };
          },
        },
      ];
    },
  },
};

/** Lets an ordinary account accept the seat token type, so Hedera's refusal is about KYC, not association. */
async function associate(account: string, rawKey: string | undefined, tokenId: string): Promise<{ code: number; out: string }> {
  if (!rawKey) return { code: 1, out: "no key for that account" };
  const key = /^(0x)?[0-9a-fA-F]{64}$/.test(rawKey) ? PrivateKey.fromStringECDSA(rawKey) : PrivateKey.fromStringDer(rawKey);
  const client = Client.forName(config.hedera.network).setOperator(account, key);
  try {
    const tx = await new TokenAssociateTransaction().setAccountId(account).setTokenIds([tokenId]).execute(client);
    return { code: 0, out: `${(await tx.getReceipt(client)).status} · ${tx.transactionId}` };
  } catch (e) {
    const msg = String((e as Error).message);
    return /ALREADY_ASSOCIATED/.test(msg) ? { code: 0, out: "already associated" } : { code: 1, out: msg.slice(0, 200) };
  } finally {
    client.close();
  }
}

/** The provider's allowlist step, done through the same admin API as the Partners page. */
async function allowlist(name: string, account?: string): Promise<{ code: number; out: string }> {
  if (!account) return { code: 1, out: `no Hedera account configured for ${name}` };
  const h = { authorization: `Bearer ${config.adminToken}`, "content-type": "application/json" };
  const base = `http://localhost:${config.port}/_sp/admin/partners`;
  const list = (await (await fetch(base, { headers: h })).json()) as { partners: { account: string }[] };
  if (list.partners.some((p) => p.account === account)) return { code: 0, out: `${name} (${account}) is already allowlisted` };
  const r = await fetch(base, { method: "POST", headers: h, body: JSON.stringify({ name, account }) });
  return { code: r.ok ? 0 : 1, out: `${r.status} ${await r.text()}` };
}

const jobs: Job[] = [];
const publish = (j: Job) => broadcast({ type: "job", job: j });

function runOnce(s: Step): Promise<{ code: number; out: string }> {
  if (s.fn) return s.fn().catch((e) => ({ code: 1, out: String(e) }));
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", "tsx", SCRIPTS[s.script!], ...s.args!], { cwd: REPO_ROOT, env: { ...process.env, GATEWAY_ORIGIN: `http://localhost:${config.port}` }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (out += b));
    p.on("exit", (code) => resolve({ code: code ?? 1, out: out.trim() }));
  });
}

async function run(j: Job, steps: Step[]) {
  for (const [i, s] of steps.entries()) {
    const st = j.steps[i]!;
    st.status = "running";
    publish(j);
    let r = await runOnce(s);
    if (s.repeatUntil) {
      const end = Date.now() + (s.maxMs ?? 60_000);
      while (!s.repeatUntil.test(r.out) && Date.now() < end) {
        st.out = r.out.slice(-1500);
        publish(j);
        await new Promise((res) => setTimeout(res, s.everyMs ?? 3000));
        r = await runOnce(s);
      }
    }
    st.out = r.out.slice(-1500);
    if (s.approval) {
      j.approvalUrl = /"approval_url":\s*"([^"]+)"/.exec(r.out)?.[1];
      j.status = "waiting_approval";
    } else if (j.status === "waiting_approval" && i > 0 && steps[i - 1]!.approval) j.status = "running";
    // A step with an expected result passes on that result (a refusal we want is a non-zero exit for the CLIs).
    const ok = (s.expect ? s.expect.test(r.out) : r.code === 0) && (!s.repeatUntil || s.repeatUntil.test(r.out));
    st.status = !ok ? "failed" : s.refused ? "refused" : "ok";
    publish(j);
    if (!ok) {
      j.status = "failed";
      break;
    }
  }
  if (j.status !== "failed") j.status = j.steps.some((x) => x.status === "refused") ? "blocked" : "done";
  j.endedAt = Date.now();
  emit({ kind: "system", drop: j.drop, note: `job ${j.status}: ${j.title} · ${j.who}` });
  publish(j);
}

export function registerJobsAdmin(admin: Hono) {
  admin.get("/jobs", (c) => c.json({ jobs, scenarios: Object.entries(SCENARIOS).map(([id, s]) => ({ id, title: s.title, who: s.who, expect: s.expect, pools: s.pools })) }));

  /** Start a scenario against one drop: body { drop }. */
  admin.post("/jobs/:scenario", async (c) => {
    const id = c.req.param("scenario");
    const sc = SCENARIOS[id];
    if (!sc) return c.json({ error: "unknown_scenario" }, 404);
    const { drop } = (await c.req.json().catch(() => ({}))) as { drop?: string };
    const d = drop ? drops.get(drop) : undefined;
    if (!d) return c.json({ error: "Pick a drop first" }, 400);
    if (!sc.pools.includes(d.pool)) return c.json({ error: `${sc.title} needs a ${sc.pools.join(" or ")} drop` }, 400);
    const busy = (sid: string) => jobs.some((j) => j.scenario === sid && (j.status === "running" || j.status === "waiting_approval"));
    if (busy(id)) return c.json({ error: `"${sc.title}" is already running` }, 409);
    if (id.startsWith("agent-") && Object.keys(SCENARIOS).some((x) => x.startsWith("agent-") && busy(x))) return c.json({ error: "One agent job at a time: they share the agent's wallet and approvals" }, 409);
    const steps = sc.build(d);
    if (typeof steps === "string") return c.json({ error: steps }, 400);
    const j: Job = { id: Math.random().toString(36).slice(2, 10), scenario: id, title: sc.title, who: sc.who, expect: sc.expect, drop: d.id, dropLabel: d.label, status: "running", steps: steps.map((s) => ({ label: s.label, status: "pending" })), startedAt: Date.now() };
    jobs.unshift(j);
    if (jobs.length > 50) jobs.pop();
    emit({ kind: "system", drop: d.id, note: `job started: ${j.title} · ${j.who}` });
    void run(j, steps);
    return c.json(j, 201);
  });
}
