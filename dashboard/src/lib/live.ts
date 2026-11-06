import { useEffect, useState, useSyncExternalStore } from "react";
import { GATEWAY, getToken } from "./api";

// One WebSocket to the gateway's live feed. Keeps 120 s of per-second stats and the last 400 events.

export interface Backend {
  name: string;
  rps: number;
  p95Ms: number;
  errorRate: number;
  load: number;
  crashed: boolean;
  reachable: boolean;
  bookings?: number;
}

export interface FloodState {
  running: boolean;
  rps: number;
  duration: number;
  endsAt: number;
  startedAt: number;
  remainingSec?: number;
  last?: { gated: Record<string, number>; direct: Record<string, number>; p95: { gated: number; direct: number } };
}

export interface Stats {
  ts: number;
  perSecond: Record<string, number>;
  totals: Record<string, number>;
  revenueInr: number;
  gateway: { cpu: number; rssMb: number };
  backends: { upstream: Backend; direct: Backend };
  prices: Record<string, number>;
  drops: { id: string; status: string; peakOn: boolean }[];
}

export interface LiveEvent {
  ts: number;
  kind: "bot" | "agent" | "human" | "surge" | "draw" | "pass" | "system" | "forward";
  method?: string;
  path?: string;
  status?: number;
  note?: string;
  drop?: string;
  txId?: string;
  hcsSeq?: number;
  side?: "direct";
  /** Unique id assigned by this console, for list keys. */
  _id?: number;
  trace?: TraceStep[];
  us?: number;
}

export interface TraceStep {
  step: "request" | "match" | "peak" | "identity" | "pass" | "quota" | "payment" | "budget" | "decision" | "upstream";
  detail: string;
  ok?: boolean;
}

const state = { stats: [] as Stats[], events: [] as LiveEvent[], people: [] as LiveEvent[], connected: false, other: [] as any[], flood: null as FloodState | null, version: 0 };
const isPerson = (e: LiveEvent) => e.side !== "direct" && (e.kind === "human" || e.kind === "agent" || e.kind === "pass");
const subs = new Set<() => void>();
const bump = () => {
  state.version++;
  for (const s of subs) s();
};
let ws: WebSocket | null = null;
let lastMessageAt = 0;
let nextId = 1;
const tag = (e: LiveEvent): LiveEvent => ({ ...e, _id: nextId++ });

// Watchdog: the gateway sends stats every second; if nothing arrives for 5 s, reconnect.
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > 5000) ws.close();
}, 2000);
if (import.meta.hot) import.meta.hot.dispose(() => ws?.close());

function connect() {
  const url = new URL("/_sp/live", GATEWAY);
  url.protocol = url.protocol.replace("http", "ws");
  url.searchParams.set("token", getToken());
  ws = new WebSocket(url);
  ws.onopen = () => {
    lastMessageAt = Date.now();
    state.connected = true;
    bump();
  };
  ws.onclose = () => {
    state.connected = false;
    bump();
    setTimeout(connect, 1000);
  };
  ws.onmessage = (e) => {
    lastMessageAt = Date.now();
    const m = JSON.parse(e.data);
    if (m.type === "stats") {
      state.stats = [...state.stats.slice(-119), m];
    } else if (m.type === "event") {
      const ev = tag(m.event);
      state.events = [...state.events.slice(-399), ev];
      if (isPerson(ev)) state.people = [...state.people.slice(-99), ev];
    } else if (m.type === "flood") {
      state.flood = m;
    } else if (m.type === "hello") {
      state.events = (m.recent ?? []).map(tag);
      state.people = (m.people ?? []).map(tag);
    } else {
      state.other = [...state.other.slice(-199), { ...m, ts: Date.now() }];
    }
    bump();
  };
}

export function useLive() {
  useEffect(() => {
    if (!ws) connect();
  }, []);
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    () => state.version,
  );
  return state;
}

export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
