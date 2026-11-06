import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useLive, type LiveEvent, type Stats } from "../lib/live";
import { Rolling } from "./rolling";

// "Watch the gate": a globe of incoming traffic, the SurgePass gate, and the protected site.
// Driven by the gateway's real per-second counts: turned-away traffic is drawn at the real rate
// (scaled, with the scale shown) and split exactly as the gate split it (blocked, waiting room,
// asked to pay). Grey dots are requests passed straight through (route not gated at that moment).
// Coloured dots are only real actors, from their events as they happen: green World ID people,
// purple their agents, blue partner companies. A refused one is drawn red and stops at the gate.

const CW = 1120;
const CH = 500;
const GLOBE = { x: 230, y: 250, r: 185 };
const GATE = { x: 640, w: 64, top: 95, bottom: 405 };
const SITE = { x: 900, y: 150, w: 190, h: 200 };
const MAX_BOT_DOTS = 140; // per second on screen
const MAX_GOOD_DOTS = 24;

const C = {
  bot: "#F2280D",
  wait: "#FFAE00",
  human: "#00C230",
  agent: "#8600FF",
  partner: "#005CFF",
  ink: "#181818",
  line: "#EBECEF",
  faint: "#D6D9DD",
  muted: "#9BA3AE",
};

// Where requests come from: busy cities and cloud regions, as [lat, lon] in degrees.
const SOURCES: [number, number][] = [
  [19.1, 72.9], [28.6, 77.2], [12.97, 77.6], [13.1, 80.3], [22.6, 88.4], [1.35, 103.8], [35.7, 139.7], [37.6, 127], [22.3, 114.2], [31.2, 121.5],
  [-33.9, 151.2], [50.1, 8.7], [51.5, -0.1], [48.9, 2.35], [52.4, 4.9], [59.3, 18.1], [55.8, 37.6], [41, 29], [25.2, 55.3], [30, 31.2],
  [6.5, 3.4], [-1.3, 36.8], [-26.2, 28], [39, -77.5], [40.7, -74], [37.4, -122], [47.6, -122.3], [43.7, -79.4], [19.4, -99.1], [-23.5, -46.6],
  [-34.6, -58.4], [4.7, -74.1], [-12, -77], [64.1, -21.9], [53.3, -6.3], [45.5, 9.2], [24.7, 46.7], [33.7, 73], [23.8, 90.4], [14.6, 121],
];

type Kind = "blocked" | "waiting" | "pay" | "through" | "human" | "agent" | "partner";
interface Dot {
  kind: Kind;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  gy: number;
  t: number;
  speed: number;
  phase: 0 | 1;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Bots per second split the way the gate split them, plus requests it let through. */
function rates(s?: Stats) {
  const p = s?.perSecond ?? {};
  const waiting = p.waitingRoom ?? 0;
  const pay = p.challenged402 ?? 0;
  const blocked = (p.blocked ?? 0) + (p.rejectedEntries ?? 0);
  const through = (p.forwarded ?? 0) + (p.paid ?? 0) + (p.freeReads ?? 0);
  return { waiting, pay, blocked, bots: waiting + pay + blocked, through, requests: p.requests ?? 0 };
}

export function FloodViz({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <AnimatePresence>{open && <Modal onClose={onClose} />}</AnimatePresence>;
}

function Modal({ onClose }: { onClose: () => void }) {
  const live = useLive();
  const last = live.stats.at(-1);
  const r = rates(last);
  const site = last?.backends.upstream;
  const flood = live.flood;
  const scale = r.bots > MAX_BOT_DOTS ? Math.ceil(r.bots / MAX_BOT_DOTS) : 1;

  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-gray-900/55 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.97, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 12 }}
        transition={{ type: "spring", damping: 30, stiffness: 320 }}
        className="flex max-h-[94vh] w-[min(1200px,96vw)] flex-col overflow-hidden rounded-[28px] bg-gray-0 shadow-lifted"
      >
        <div className="flex items-start justify-between gap-4 px-7 pb-2 pt-6">
          <div>
            <div className="flex items-center gap-2.5">
              <span className={`size-2.5 rounded-full ${flood?.running ? "animate-pulse bg-error-600" : "bg-gray-300"}`} />
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">{flood?.running ? `Bot flood · ${flood.rps.toLocaleString("en-IN")} req/s · ${flood.remainingSec ?? Math.max(0, Math.ceil((flood.endsAt - Date.now()) / 1000))}s left` : "Live gate"}</span>
            </div>
            <h2 className="mt-1.5 text-3xl font-semibold tracking-[-0.02em]">Bots stop at the gate. People get through.</h2>
          </div>
          <button onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200" title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="px-4">
          <Scene last={last} people={live.people} />
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-gray-100 bg-gray-100 md:grid-cols-5">
          <Count label="Hitting the gate" value={r.requests} unit="/s" />
          <Count label="Blocked" value={r.blocked} unit="/s" dot="bg-error-600" />
          <Count label="Sent to waiting room" value={r.waiting} unit="/s" dot="bg-warning-600" />
          <Count label="Asked to pay (x402)" value={r.pay} unit="/s" dot="bg-warning-600" />
          <Count label="Passed straight through" value={r.through} unit="/s" dot="bg-gray-400" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-7 py-3.5 text-xs text-gray-500">
          <span>
            QuickBook A behind SurgePass: <b className="text-gray-900">{site ? `${Math.round(site.errorRate * 100)}% errors · ${site.p95Ms} ms p95` : "…"}</b>
          </span>
          <span>Live counts from the gateway{scale > 1 ? ` · 1 dot ≈ ${scale} requests` : ""} · grey: route not gated at that moment · green: World ID people · purple: their agents · blue: partner companies, as they happen</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Count({ label, value, unit, dot }: { label: string; value: number; unit: string; dot?: string }) {
  return (
    <div className="bg-gray-0 px-6 py-4">
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
        {dot && <span className={`size-2 rounded-full ${dot}`} />}
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tracking-[-0.02em]">
        <Rolling value={value.toLocaleString("en-IN")} />
        <span className="ml-1 text-base font-medium text-gray-400">{unit}</span>
      </div>
    </div>
  );
}

function Scene({ last, people }: { last?: Stats; people: LiveEvent[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(last);
  latest.current = last;
  const openedAt = useRef(Date.now());
  const seenPeople = useRef<Set<string>>(new Set());
  const pending = useRef<Kind[]>([]);

  // Each new real person or agent event becomes a dot of its own. Matched by content and time, not
  // by the console's ids: a reconnect replays recent history with fresh ids, and those are not new.
  useEffect(() => {
    for (const p of people) {
      if (p.ts < openedAt.current || (p.kind !== "human" && p.kind !== "agent")) continue;
      const key = `${p.ts}|${p.kind}|${p.path ?? ""}|${p.note ?? ""}`;
      if (seenPeople.current.has(key)) continue;
      seenPeople.current.add(key);
      // Refused people and agents stop at the gate like any other refused request.
      const refused = p.outcome ? !p.outcome.ok : (p.status ?? 0) >= 400;
      pending.current.push(refused ? "blocked" : p.outcome?.actor === "partner" ? "partner" : p.kind === "agent" ? "agent" : "human");
    }
  }, [people]);

  useEffect(() => {
    const el = canvas.current!;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    el.width = CW * dpr;
    el.height = CH * dpr;
    const g = el.getContext("2d", { alpha: true })!;
    g.scale(dpr, dpr);
    const FONT = getComputedStyle(el).fontFamily || "system-ui, sans-serif";

    // The parts that never change (globe body, gate, site card, labels) are drawn once, off screen.
    const still = document.createElement("canvas");
    still.width = CW * dpr;
    still.height = CH * dpr;
    const s0 = still.getContext("2d")!;
    s0.scale(dpr, dpr);
    {
      const grd = s0.createRadialGradient(GLOBE.x - 60, GLOBE.y - 70, 20, GLOBE.x, GLOBE.y, GLOBE.r);
      grd.addColorStop(0, "#FFFFFF");
      grd.addColorStop(1, "#F3F4F5");
      s0.beginPath();
      s0.arc(GLOBE.x, GLOBE.y, GLOBE.r, 0, Math.PI * 2);
      s0.fillStyle = grd;
      s0.fill();
      s0.strokeStyle = C.line;
      s0.lineWidth = 1.5;
      s0.stroke();
      // site card
      s0.fillStyle = "#FFFFFF";
      s0.beginPath();
      s0.roundRect(SITE.x, SITE.y, SITE.w, SITE.h, 22);
      s0.fill();
      s0.stroke();
      s0.textAlign = "left";
      s0.fillStyle = C.ink;
      s0.font = `600 16px ${FONT}`;
      s0.fillText("QuickBook A", SITE.x + 18, SITE.y + 34);
      s0.fillStyle = C.muted;
      s0.font = `500 12px ${FONT}`;
      s0.fillText("booking site", SITE.x + 18, SITE.y + 52);
      s0.fillText("Load", SITE.x + 18, SITE.y + SITE.h - 46);
      s0.fillStyle = "#F3F4F5";
      s0.beginPath();
      s0.roundRect(SITE.x + 18, SITE.y + SITE.h - 34, SITE.w - 36, 8, 4);
      s0.fill();
      // labels for where turned-away traffic goes
      s0.textAlign = "center";
      s0.fillStyle = C.muted;
      s0.font = `600 11px ${FONT}`;
      s0.fillText("WAITING ROOM · PAY", GATE.x - 120, GATE.bottom + 52);
      s0.fillText("BLOCKED", GATE.x - 120, GATE.top - 40);
    }
    const gate = document.createElement("canvas");
    gate.width = (GATE.w + 4) * dpr;
    gate.height = (GATE.bottom - GATE.top + 4) * dpr;
    {
      const c = gate.getContext("2d")!;
      c.scale(dpr, dpr);
      c.fillStyle = C.ink;
      c.beginPath();
      c.roundRect(2, 2, GATE.w, GATE.bottom - GATE.top, 24);
      c.fill();
      const sx = GATE.w / 2 + 2;
      const sy = (GATE.bottom - GATE.top) / 2 - 6;
      c.beginPath();
      c.moveTo(sx, sy - 18);
      c.lineTo(sx + 15, sy - 11);
      c.lineTo(sx + 15, sy + 2);
      c.quadraticCurveTo(sx + 15, sy + 15, sx, sy + 22);
      c.quadraticCurveTo(sx - 15, sy + 15, sx - 15, sy + 2);
      c.lineTo(sx - 15, sy - 11);
      c.closePath();
      c.fillStyle = "#FFFFFF";
      c.fill();
      c.fillStyle = C.ink;
      c.font = `600 15px ${FONT}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("S", sx, sy + 2);
      c.fillStyle = "rgba(255,255,255,0.7)";
      c.font = `600 11px ${FONT}`;
      c.fillText("SurgePass", sx, GATE.bottom - GATE.top - 20);
    }

    const dots: Dot[] = [];
    const sparks: Spark[] = [];
    const owed: Record<Kind, number> = { blocked: 0, waiting: 0, pay: 0, through: 0, human: 0, agent: 0, partner: 0 };
    let rot = 0;
    let gateFlash = 0;
    let siteGlow = 0;
    let prev = performance.now();
    let raf = 0;
    const tilt = rad(-12);
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);

    const project = (lat: number, lon: number) => {
      const la = rad(lat);
      const lo = rad(lon) + rot;
      const cl = Math.cos(la);
      const x = cl * Math.sin(lo);
      const y0 = Math.sin(la);
      const z0 = cl * Math.cos(lo);
      return { x: GLOBE.x + GLOBE.r * x, y: GLOBE.y - GLOBE.r * (y0 * cosT - z0 * sinT), z: y0 * sinT + z0 * cosT };
    };

    // Visible traffic sources, refreshed a few times a second rather than on every spawn.
    let visible: { x: number; y: number }[] = [];
    let visibleAt = 0;
    const spawn = (kind: Kind) => {
      const p = visible.length ? visible[(Math.random() * visible.length) | 0]! : { x: GLOBE.x, y: GLOBE.y };
      const gy = GATE.top + 30 + Math.random() * (GATE.bottom - GATE.top - 60);
      const good = kind === "human" || kind === "agent" || kind === "partner" || kind === "through";
      dots.push({
        kind,
        x0: p.x,
        y0: p.y,
        cx: (p.x + GATE.x) / 2,
        cy: Math.min(p.y, gy) - 60 - Math.random() * 90,
        gy: good ? 250 + (Math.random() - 0.5) * 40 : gy,
        t: 0,
        speed: good ? 0.55 + Math.random() * 0.15 : 0.75 + Math.random() * 0.45,
        phase: 0,
      });
    };

    const burst = (x: number, y: number, color: string, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        const v = 40 + Math.random() * 90;
        sparks.push({ x, y, vx: -Math.abs(Math.cos(a)) * v, vy: Math.sin(a) * v * (Math.random() < 0.5 ? -1 : 1), life: 1, color });
      }
    };

    const remove = <T,>(arr: T[], i: number) => {
      arr[i] = arr[arr.length - 1]!;
      arr.pop();
    };

    // One path per colour per frame instead of one draw call per dot.
    const buckets = new Map<string, number[]>();
    const add = (color: string, x: number, y: number, r: number) => {
      let b = buckets.get(color);
      if (!b) buckets.set(color, (b = []));
      b.push(x, y, r);
    };
    const flush = (alpha = 1) => {
      g.globalAlpha = alpha;
      for (const [color, b] of buckets) {
        if (!b.length) continue;
        g.beginPath();
        for (let i = 0; i < b.length; i += 3) {
          g.moveTo(b[i]! + b[i + 2]!, b[i + 1]!);
          g.arc(b[i]!, b[i + 1]!, b[i + 2]!, 0, Math.PI * 2);
        }
        g.fillStyle = color;
        g.fill();
        b.length = 0;
      }
      g.globalAlpha = 1;
    };

    const drawGrid = () => {
      g.beginPath();
      for (let lon = -180; lon < 180; lon += 30) {
        let pen = false;
        for (let lat = -90; lat <= 90; lat += 10) {
          const p = project(lat, lon);
          if (p.z < 0) {
            pen = false;
            continue;
          }
          if (pen) g.lineTo(p.x, p.y);
          else g.moveTo(p.x, p.y);
          pen = true;
        }
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        let pen = false;
        for (let lon = -180; lon <= 180; lon += 10) {
          const p = project(lat, lon);
          if (p.z < 0) {
            pen = false;
            continue;
          }
          if (pen) g.lineTo(p.x, p.y);
          else g.moveTo(p.x, p.y);
          pen = true;
        }
      }
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      g.stroke();
      for (const [a, b] of SOURCES) {
        const p = project(a, b);
        if (p.z > 0) add(p.z > 0.5 ? "rgba(113,118,128,0.75)" : "rgba(113,118,128,0.4)", p.x, p.y, 2 + p.z * 1.2);
      }
      flush();
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      rot += dt * 0.18;
      gateFlash = Math.max(0, gateFlash - dt * 2.5);
      siteGlow = Math.max(0, siteGlow - dt * 1.5);
      if (now - visibleAt > 250) {
        visibleAt = now;
        visible = [];
        for (const [a, b] of SOURCES) {
          const p = project(a, b);
          if (p.z > 0.15) visible.push(p);
        }
      }

      // spawn at the gate's real rates (turned-away traffic scaled to stay readable)
      const r = rates(latest.current);
      const k = r.bots > MAX_BOT_DOTS ? MAX_BOT_DOTS / r.bots : 1;
      owed.blocked += r.blocked * k * dt;
      owed.waiting += r.waiting * k * dt;
      owed.pay += r.pay * k * dt;
      owed.through += Math.min(MAX_GOOD_DOTS, r.through * k) * dt;
      for (const kind of ["blocked", "waiting", "pay", "through"] as Kind[]) {
        while (owed[kind] >= 1) {
          owed[kind] -= 1;
          spawn(kind);
        }
      }
      while (pending.current.length) spawn(pending.current.shift()!);

      g.clearRect(0, 0, CW, CH);
      g.drawImage(still, 0, 0, CW, CH);
      drawGrid();

      // site load bar and glow
      const s = latest.current?.backends.upstream;
      const failing = !!s && (s.crashed || s.errorRate > 0.3);
      g.fillStyle = failing ? C.bot : C.human;
      g.beginPath();
      g.roundRect(SITE.x + 18, SITE.y + SITE.h - 34, Math.max(8, (SITE.w - 36) * Math.max(0.06, Math.min(1, s?.load ?? 0))), 8, 4);
      g.fill();
      g.textAlign = "right";
      g.font = `500 12px ${FONT}`;
      g.fillText(failing ? "failing" : "steady", SITE.x + SITE.w - 18, SITE.y + SITE.h - 46);
      if (siteGlow > 0.02) {
        g.strokeStyle = `rgba(0,194,48,${0.35 * siteGlow})`;
        g.lineWidth = 6;
        g.beginPath();
        g.roundRect(SITE.x - 3, SITE.y - 3, SITE.w + 6, SITE.h + 6, 25);
        g.stroke();
      }

      // dots
      const halos: number[] = [];
      for (let i = dots.length - 1; i >= 0; i--) {
        const d = dots[i]!;
        d.t += dt * d.speed;
        const person = d.kind === "human" || d.kind === "agent" || d.kind === "partner";
        const good = person || d.kind === "through";
        let x: number;
        let y: number;
        if (d.phase === 0) {
          const t = Math.min(1, d.t);
          const u = 1 - t;
          const ex = GATE.x - GATE.w / 2 - 4;
          x = u * u * d.x0 + 2 * u * t * d.cx + t * t * ex;
          y = u * u * d.y0 + 2 * u * t * d.cy + t * t * d.gy;
          if (d.t >= 1) {
            if (good) {
              d.phase = 1;
              d.t = 0;
            } else {
              gateFlash = Math.min(1, gateFlash + 0.08);
              if (d.kind === "blocked") burst(x, y, C.bot, 3);
              else sparks.push({ x, y, vx: -60 - Math.random() * 50, vy: d.kind === "pay" ? 70 + Math.random() * 40 : 90 + Math.random() * 50, life: 1.2, color: C.wait });
              remove(dots, i);
              continue;
            }
          }
        } else {
          const f = Math.min(1, d.t * 1.8);
          const sx = GATE.x + GATE.w / 2;
          x = sx + (SITE.x - sx) * f;
          y = d.gy + (SITE.y + SITE.h / 2 - d.gy) * f;
          if (f >= 1) {
            if (person) siteGlow = 1;
            remove(dots, i);
            continue;
          }
        }
        const color = d.kind === "human" ? C.human : d.kind === "agent" ? C.agent : d.kind === "partner" ? C.partner : d.kind === "through" ? C.muted : d.kind === "blocked" ? C.bot : C.wait;
        add(color, x, y, person ? 5.5 : 2.6);
        if (person) halos.push(x, y);
      }
      flush(0.9);
      if (halos.length) {
        g.globalAlpha = 0.18;
        g.beginPath();
        for (let i = 0; i < halos.length; i += 2) {
          g.moveTo(halos[i]! + 11, halos[i + 1]!);
          g.arc(halos[i]!, halos[i + 1]!, 11, 0, Math.PI * 2);
        }
        g.fillStyle = C.human;
        g.fill();
        g.globalAlpha = 1;
      }

      // sparks: blocked bots shatter, the rest drift off to the waiting room / pay
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i]!;
        sp.life -= dt * 1.6;
        if (sp.life <= 0) {
          remove(sparks, i);
          continue;
        }
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.vy += (sp.color === C.bot ? -30 : 40) * dt;
        add(sp.color, sp.x, sp.y, sp.color === C.bot ? 1.8 : 2.4);
      }
      flush(0.7);

      // gate, with a red rim that brightens as bots hit it
      if (gateFlash > 0.02) {
        g.strokeStyle = `rgba(242,40,13,${0.45 * gateFlash})`;
        g.lineWidth = 8;
        g.beginPath();
        g.roundRect(GATE.x - GATE.w / 2 - 4, GATE.top - 4, GATE.w + 8, GATE.bottom - GATE.top + 8, 28);
        g.stroke();
      }
      g.drawImage(gate, GATE.x - GATE.w / 2 - 2, GATE.top - 2, GATE.w + 4, GATE.bottom - GATE.top + 4);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvas} style={{ width: "100%", aspectRatio: `${CW} / ${CH}` }} className="block" aria-label="Animated view of bot traffic stopped at the SurgePass gate while people pass through" />;
}

export function ShieldIcon(p: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={p.className} aria-hidden>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V6Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
