import { Agent, request } from "undici";

// Node bot flood (no k6 needed). Sends the same mix to the gated site and the direct one.
//   npx tsx loadgen/flood.ts --rps 1500 --duration 60
//   --only gated|direct   --enter (also hammer the entry API)

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
const BOOK = "/tatkal/book/12007/2026-11-06/CC?quota=TQ";
const AVAIL = "/availability/12007/2026-11-06/CC?quota=TQ";

const dispatcher = new Agent({ connections: 512, pipelining: 1, keepAliveTimeout: 10_000 });
const counts: Record<string, Record<string, number>> = { gated: {}, direct: {} };

async function hit(side: "gated" | "direct") {
  const base = side === "gated" ? GATED : DIRECT;
  const r = Math.random();
  let status = "err";
  try {
    let res;
    if (ENTER && side === "gated" && r < 0.1) {
      const drops = dropId ? `/_sp/api/drops/${dropId}/enter` : BOOK;
      res = await request(base + drops, { method: "POST", dispatcher, body: '{"seats":4}', headers: { "content-type": "application/json" } });
    } else if (r < 0.5) res = await request(base + BOOK, { dispatcher });
    else if (r < 0.9) res = await request(base + AVAIL, { dispatcher });
    else res = await request(base + BOOK.replace("?", "/confirm?"), { method: "POST", dispatcher, body: '{"passengers":[{"name":"bot"}]}', headers: { "content-type": "application/json" } });
    status = String(res.statusCode);
    await res.body.dump();
  } catch {
    // connection refused / reset
  }
  counts[side]![status] = (counts[side]![status] ?? 0) + 1;
}

let dropId: string | null = null;
if (ENTER) {
  const j = (await (await fetch(`${GATED}/_sp/api/drops`)).json()) as { drops: { id: string; pool: string; status: string }[] };
  dropId = j.drops.find((d) => d.pool === "normal" && d.status === "open")?.id ?? null;
}

const sides = ONLY === "both" ? (["gated", "direct"] as const) : ([ONLY] as ("gated" | "direct")[]);
const end = Date.now() + DURATION * 1000;
const tickMs = 20;
const perTick = Math.max(1, Math.round((RPS * tickMs) / 1000));
console.log(`Flooding ${sides.join(" + ")} at ${RPS} req/s each for ${DURATION}s`);

const timer = setInterval(() => {
  if (Date.now() > end) return;
  for (const s of sides) for (let i = 0; i < perTick; i++) void hit(s);
}, tickMs);

const report = setInterval(() => {
  const fmt = (o: Record<string, number>) => Object.entries(o).sort().map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`gated  ${fmt(counts.gated!)}\ndirect ${fmt(counts.direct!)}\n`);
  counts.gated = {};
  counts.direct = {};
  if (Date.now() > end + 2000) {
    clearInterval(timer);
    clearInterval(report);
    void dispatcher.close();
  }
}, 1000);
