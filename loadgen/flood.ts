import { Agent, request } from "undici";

// Bot flood (no k6 needed). Sends the same mix to the gated site and the direct one.
//   npx tsx loadgen/flood.ts --rps 1500 --duration 60
//   --only gated|direct   --enter (also hammer the entry API)
//   --json  one JSON line per second with per-side status counts, plus a sample of individual
//           requests per side (used by the console's "Launch bot flood" button)

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const RPS = Number(arg("rps", "1500"));
const DURATION = Number(arg("duration", "60"));
const ONLY = arg("only", "both");
const GATED = arg("gated", "http://localhost:8080");
const DIRECT = arg("direct", "http://localhost:4001");
const ENTER = process.argv.includes("--enter");
const JSON_MODE = process.argv.includes("--json");
const SAMPLE_PER_SEC = 8;
const BOOK = "/tatkal/book/12007/2026-11-06/CC?quota=TQ";
const AVAIL = "/availability/12007/2026-11-06/CC?quota=TQ";

type Side = "gated" | "direct";
const dispatcher = new Agent({ connections: 512, pipelining: 1, keepAliveTimeout: 10_000 });
const counts: Record<Side, Record<string, number>> = { gated: {}, direct: {} };
const latency: Record<Side, number[]> = { gated: [], direct: [] };
const sampled: Record<Side, number> = { gated: 0, direct: 0 };
let dropId: string | null = null;

async function hit(side: Side) {
  const base = side === "gated" ? GATED : DIRECT;
  const r = Math.random();
  let method = "GET";
  let path = BOOK;
  let body: string | undefined;
  if (ENTER && side === "gated" && r < 0.1 && dropId) {
    method = "POST";
    path = `/_sp/api/drops/${dropId}/enter`;
    body = '{"seats":4}';
  } else if (r < 0.5) path = BOOK;
  else if (r < 0.9) path = AVAIL;
  else {
    method = "POST";
    path = BOOK.replace("?", "/confirm?");
    body = '{"passengers":[{"name":"bot"}]}';
  }
  const start = Date.now();
  let status = "err";
  try {
    const res = await request(base + path, { method: method as "GET" | "POST", dispatcher, body, headers: body ? { "content-type": "application/json" } : undefined });
    status = String(res.statusCode);
    await res.body.dump();
  } catch {
    // connection refused / reset
  }
  const ms = Date.now() - start;
  counts[side][status] = (counts[side][status] ?? 0) + 1;
  latency[side].push(ms);
  if (JSON_MODE && sampled[side] < SAMPLE_PER_SEC) {
    sampled[side]++;
    console.log(JSON.stringify({ t: "req", side, method, path: path.split("?")[0], status, ms }));
  }
}

if (ENTER) {
  const j = (await (await fetch(`${GATED}/_sp/api/drops`)).json()) as { drops: { id: string; pool: string; status: string }[] };
  dropId = j.drops.find((d) => d.pool === "normal" && d.status === "open")?.id ?? null;
}

const sides: Side[] = ONLY === "both" ? ["gated", "direct"] : [ONLY as Side];
const startedAt = Date.now();
const end = startedAt + DURATION * 1000;
const tickMs = 20;
const perTick = Math.max(1, Math.round((RPS * tickMs) / 1000));
if (JSON_MODE) console.log(JSON.stringify({ t: "start", rps: RPS, duration: DURATION, sides, endsAt: end }));
else console.log(`Flooding ${sides.join(" + ")} at ${RPS} req/s each for ${DURATION}s`);

const timer = setInterval(() => {
  if (Date.now() > end) return;
  for (const s of sides) for (let i = 0; i < perTick; i++) void hit(s);
}, tickMs);

const p95 = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!;
};

const report = setInterval(() => {
  if (JSON_MODE) {
    console.log(JSON.stringify({ t: "stats", gated: counts.gated, direct: counts.direct, p95: { gated: p95(latency.gated), direct: p95(latency.direct) }, remainingSec: Math.max(0, Math.ceil((end - Date.now()) / 1000)) }));
  } else {
    const fmt = (o: Record<string, number>) => Object.entries(o).sort().map(([k, v]) => `${k}:${v}`).join(" ");
    console.log(`gated  ${fmt(counts.gated)}\ndirect ${fmt(counts.direct)}\n`);
  }
  counts.gated = {};
  counts.direct = {};
  latency.gated = [];
  latency.direct = [];
  sampled.gated = 0;
  sampled.direct = 0;
  if (Date.now() > end + 2000) {
    clearInterval(timer);
    clearInterval(report);
    if (JSON_MODE) console.log(JSON.stringify({ t: "end" }));
    void dispatcher.close().then(() => process.exit(0));
  }
}, 1000);

const stop = () => {
  clearInterval(timer);
  if (JSON_MODE) console.log(JSON.stringify({ t: "end", stopped: true }));
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
