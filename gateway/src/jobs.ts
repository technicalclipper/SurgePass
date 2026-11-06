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

type Step = { label: string; script?: "cli" | "partner"; args?: string[]; fn?: () => Promise<{ code: number; out: string }>; expect?: RegExp; approval?: boolean; repeatUntil?: RegExp; everyMs?: number; maxMs?: number };
type Scenario = { title: string; who: string; build: (d: Targets) => Step[] | string };
type Targets = { normal?: Drop; premium?: Drop; partner?: Drop };

export interface Job {
  id: string;
  scenario: string;
  title: string;
  who: string;
  status: "running" | "waiting_approval" | "done" | "failed";
  steps: { label: string; status: "pending" | "running" | "ok" | "failed"; out?: string }[];
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
    title: "Agent enters the normal draw",
    who: "Your agent",
    build: ({ normal }) =>
      normal
        ? [
            { label: "Ask its human for approval", script: "cli", args: ["request", normal.id, "2"], approval: true },
            { label: "Wait for the human's World ID tap (open until the drop closes)", script: "cli", args: ["wait", untilClose(normal)] },
            { label: "Enter the draw for 2 seats", script: "cli", args: ["enter", normal.id, "2"], expect: /"ok": true/ },
            { label: "Check availability (x402 beyond the free quota)", script: "cli", args: ["check", normal.id, AVAIL] },
          ]
        : "no open normal drop",
  },
  "agent-premium": {
    title: "Agent bids in the premium auction",
    who: "Your agent",
    build: ({ premium }) =>
      premium
        ? [
            { label: "Ask its human for approval (max bid ₹3,000)", script: "cli", args: ["request", premium.id, "1", "3000"], approval: true },
            { label: "Wait for the human's World ID tap (open until bidding closes)", script: "cli", args: ["wait", untilClose(premium)] },
            { label: "Seal a bid · pay the deposit via x402", script: "cli", args: ["enter", premium.id], expect: /"ok": true/ },
            { label: "Reveal the bid when bidding closes, then read the result", script: "cli", args: ["status", premium.id], repeatUntil: /"status": "(results|closed)"/, everyMs: 5000, maxMs: 40 * 60_000 },
          ]
        : "no open premium drop",
  },
  rogue: {
    title: "Rogue agent, no human behind it",
    who: "Script with no World ID",
    build: ({ normal, premium }) => [
      ...(normal ? [{ label: `Enter ${normal.label}`, script: "cli" as const, args: ["rogue", normal.id], expect: /^401/m }] : []),
      ...(premium ? [{ label: `Bid in ${premium.label}`, script: "cli" as const, args: ["rogue", premium.id], expect: /^401/m }] : []),
    ],
  },
  "partner-tripnest": {
    title: "Allowlisted partner books seats",
    who: "TripNest",
    build: ({ partner }) =>
      partner
        ? [
            { label: "Provider allowlists TripNest's Hedera account", fn: () => allowlist("TripNest", process.env.PARTNER_TRIPNEST_ACCOUNT_ID) },
            { label: "TripNest associates the seat token", script: "partner", args: ["--as", "tripnest", "associate", partner.id], expect: /associated|ALREADY_ASSOCIATED/ },
            { label: "KYC granted on the seat token (Hedera)", script: "partner", args: ["--as", "tripnest", "join", partner.id], expect: /"ok": true/ },
            { label: "Paid look at partner availability", script: "partner", args: ["--as", "tripnest", "look", partner.id] },
            { label: "Hold 1 seat · refundable deposit via x402", script: "partner", args: ["--as", "tripnest", "hold", partner.id, "1"], expect: /^202/m },
            { label: "Wait for the seat token on Hedera", script: "partner", args: ["--as", "tripnest", "wait", partner.id] },
            { label: "Book on the provider site · deposit refunded (or quota full → deposit refunded)", script: "partner", args: ["--as", "tripnest", "book", partner.id, "Asha"], expect: /"ok": true|no issued hold/ },
          ]
        : "no partner drop",
  },
  "hedera-probe": {
    title: "Slip a seat token to a non-partner",
    who: "Account without KYC",
    build: ({ partner }) => {
      const account = process.env.AGENT_ACCOUNT_ID;
      if (!partner?.partner?.tokenId) return "no partner seat token yet";
      if (!account) return "AGENT_ACCOUNT_ID not set";
      return [
        { label: `${account} associates the seat token (but has no KYC)`, fn: () => associate(account, process.env.AGENT_PRIVATE_KEY, partner.partner!.tokenId!) },
        {
          label: `Send seat token ${partner.partner.tokenId} to ${account} on Hedera`,
          fn: async () => {
            const r = await fetch(`http://localhost:${config.port}/_sp/admin/partners/probe`, { method: "POST", headers: { authorization: `Bearer ${config.adminToken}`, "content-type": "application/json" }, body: JSON.stringify({ drop: partner.id, account }) });
            const b = (await r.json()) as { refused?: boolean; code?: string; error?: string };
            if (b.error) return { code: 1, out: b.error === "no_free_seat_to_probe" ? "Not sent: every partner seat is already handed out (reset the drops for free seats)" : `Not sent: ${b.error}` };
            return { code: b.refused ? 0 : 1, out: b.refused ? `Hedera refused: ${b.code}` : "Hedera accepted the transfer: this account was allowlisted" };
          },
        },
      ];
    },
  },
  "partner-unlisted": {
    title: "Company that isn't allowlisted",
    who: "BulkSeats",
    build: ({ partner }) =>
      partner
        ? [
            { label: "Look at partner availability", script: "partner", args: ["--as", "bulkseats", "look", partner.id], expect: /403/ },
            { label: "Try to hold 4 seats", script: "partner", args: ["--as", "bulkseats", "hold", partner.id, "4"], expect: /403/ },
          ]
        : "no partner drop",
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

function targets(): Targets {
  const open = drops.all().filter((d) => d.status === "open" || d.status === "scheduled");
  return {
    normal: open.find((d) => d.pool === "normal" && /tatkal/i.test(d.label)) ?? open.find((d) => d.pool === "normal"),
    premium: open.find((d) => d.pool === "premium"),
    partner: drops.all().find((d) => d.pool === "partner" && d.status === "open") ?? drops.all().find((d) => d.pool === "partner"),
  };
}

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
    st.status = ok ? "ok" : "failed";
    publish(j);
    if (!ok) {
      j.status = "failed";
      break;
    }
  }
  if (j.status !== "failed") j.status = "done";
  j.endedAt = Date.now();
  emit({ kind: "system", note: `job ${j.status}: ${j.title} · ${j.who}` });
  publish(j);
}

export function registerJobsAdmin(admin: Hono) {
  admin.get("/jobs", (c) => c.json({ jobs, scenarios: Object.entries(SCENARIOS).map(([id, s]) => ({ id, title: s.title, who: s.who })) }));

  admin.post("/jobs/:scenario", (c) => {
    const sc = SCENARIOS[c.req.param("scenario")];
    if (!sc) return c.json({ error: "unknown_scenario" }, 404);
    if (jobs.some((j) => j.scenario === c.req.param("scenario") && (j.status === "running" || j.status === "waiting_approval"))) return c.json({ error: "already_running" }, 409);
    const busy = (id: string) => jobs.some((j) => j.scenario === id && (j.status === "running" || j.status === "waiting_approval"));
    if (c.req.param("scenario").startsWith("agent-") && Object.keys(SCENARIOS).some((id) => id.startsWith("agent-") && busy(id)))
      return c.json({ error: "one agent job at a time (they share the agent's wallet and approvals)" }, 409);
    const steps = sc.build(targets());
    if (typeof steps === "string" || !steps.length) return c.json({ error: typeof steps === "string" ? steps : "nothing_to_run" }, 400);
    const j: Job = { id: Math.random().toString(36).slice(2, 10), scenario: c.req.param("scenario"), title: sc.title, who: sc.who, status: "running", steps: steps.map((s) => ({ label: s.label, status: "pending" })), startedAt: Date.now() };
    jobs.unshift(j);
    if (jobs.length > 30) jobs.pop();
    emit({ kind: "system", note: `job started: ${j.title} · ${j.who}` });
    void run(j, steps);
    return c.json(j, 201);
  });
}
