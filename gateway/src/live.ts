import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { LiveEvent } from "@surgepass/shared";
import { config } from "./config.ts";

// Live feed for the dashboard and demo screen: individual log events (sampled under load)
// plus one stats snapshot per second.

export type CounterName =
  | "requests"
  | "forwarded"
  | "waitingRoom"
  | "blocked"
  | "challenged402"
  | "paid"
  | "freeReads"
  | "entriesHuman"
  | "entriesAgent"
  | "rejectedEntries";

const counters: Record<CounterName, number> = {
  requests: 0,
  forwarded: 0,
  waitingRoom: 0,
  blocked: 0,
  challenged402: 0,
  paid: 0,
  freeReads: 0,
  entriesHuman: 0,
  entriesAgent: 0,
  rejectedEntries: 0,
};
const totals: Record<CounterName, number> = { ...counters };
let revenueInr = 0;

export function count(name: CounterName, n = 1) {
  counters[name] += n;
  totals[name] += n;
}

export function addRevenue(inr: number) {
  revenueInr += inr;
}

const clients = new Map<WebSocket, { admin: boolean }>();
const recent: LiveEvent[] = [];
const sentThisSecond = { gate: 0, direct: 0 };
const MAX_EVENTS_PER_SEC = { gate: 40, direct: 15 };

/** Publishes a log line. Under a flood only a sample of bot lines is sent (separately for the gate and
 *  the direct demo site); important events always go out. */
export function emit(e: Omit<LiveEvent, "ts">) {
  const ev: LiveEvent = { ts: Date.now(), ...e };
  const important = e.kind !== "bot" && e.kind !== "forward";
  const lane = e.side === "direct" ? "direct" : "gate";
  if (!important && sentThisSecond[lane] >= MAX_EVENTS_PER_SEC[lane]) return;
  sentThisSecond[lane]++;
  recent.push(ev);
  if (recent.length > 300) recent.shift();
  broadcast({ type: "event", event: ev });
}

/** Sends to dashboard clients only (admin token). */
export function broadcast(msg: unknown) {
  const s = JSON.stringify(msg);
  for (const [c, m] of clients) if (m.admin && c.readyState === 1) c.send(s);
}

/** Sends to everyone, including waiting rooms (drop state, entry counts, draw progress). */
export function broadcastPublic(msg: unknown) {
  const s = JSON.stringify(msg);
  for (const [c] of clients) if (c.readyState === 1) c.send(s);
}

type StatsExtra = () => Promise<Record<string, unknown>> | Record<string, unknown>;
let extra: StatsExtra = () => ({});
export function setStatsSource(fn: StatsExtra) {
  extra = fn;
}

let lastCpu = process.cpuUsage();
let lastAt = Date.now();

function gatewayCpu() {
  const now = Date.now();
  const cpu = process.cpuUsage(lastCpu);
  const pct = ((cpu.user + cpu.system) / 1000 / (now - lastAt)) * 100;
  lastCpu = process.cpuUsage();
  lastAt = now;
  return Math.round(pct);
}

setInterval(async () => {
  const snapshot = {
    type: "stats",
    ts: Date.now(),
    perSecond: { ...counters },
    totals: { ...totals },
    revenueInr: Math.round(revenueInr * 100) / 100,
    gateway: { cpu: gatewayCpu(), rssMb: Math.round(process.memoryUsage().rss / 1e6) },
    ...(await extra()),
  };
  for (const k of Object.keys(counters) as CounterName[]) counters[k] = 0;
  sentThisSecond.gate = 0;
  sentThisSecond.direct = 0;
  broadcast(snapshot);
}, 1000).unref();

export function attachLive(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/_sp/live") return socket.destroy();
    const isAdmin = url.searchParams.get("token") === config.adminToken;
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.set(ws, { admin: isAdmin });
      ws.send(JSON.stringify({ type: "hello", admin: isAdmin, recent: isAdmin ? recent : [] }));
      ws.on("close", () => clients.delete(ws));
    });
  });
}
