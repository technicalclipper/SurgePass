import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { hashscanTx } from "../lib/api";
import { useLive, type LiveEvent, type TraceStep } from "../lib/live";
import { Panel, Segmented } from "../ui/console";
import { FloodControl } from "../ui/flood";

// Every request the reverse proxy handled, step by step: what came in, which drop it matched,
// whether peak was on, who sent it, which check decided it, and what happened.

const LABEL: Record<TraceStep["step"], string> = {
  request: "Request",
  match: "Route match",
  peak: "Peak mode",
  identity: "Who sent it",
  pass: "Pass check",
  quota: "Free quota",
  payment: "x402 payment",
  budget: "Agent budget",
  decision: "Decision",
  upstream: "Provider",
};

type Filter = "all" | "blocked" | "forwarded" | "people";

const blocked = (e: LiveEvent) => e.status === 302 || e.status === 402 || e.status === 403 || e.status === 401;

export function LiveGate() {
  const live = useLive();
  const [paused, setPaused] = useState<LiveEvent[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const source = paused ?? live.events;
  const rows = useMemo(() => {
    const traced = source.filter((e) => e.trace && e.side !== "direct");
    const f = traced.filter((e) =>
      filter === "all" ? true : filter === "blocked" ? blocked(e) : filter === "forwarded" ? !blocked(e) : e.kind === "human" || e.kind === "agent",
    );
    return f.slice(-24).reverse();
  }, [source, filter]);

  const recent = live.events.filter((e) => e.trace && e.side !== "direct").slice(-200);
  const avgUs = recent.length ? Math.round(recent.reduce((s, e) => s + (e.us ?? 0), 0) / recent.length) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.01em]">Live gate</h1>
          <p className="mt-1 text-sm text-gray-500">
            How the reverse proxy handled each request, step by step. Sampled under heavy load. Gate decision time averages{" "}
            <b className="tabular text-gray-900">{avgUs < 1000 ? `${avgUs} µs` : `${(avgUs / 1000).toFixed(1)} ms`}</b> over the last {recent.length} traced requests.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "blocked", label: "Blocked" },
              { value: "forwarded", label: "Reached provider" },
              { value: "people", label: "Humans & agents" },
            ]}
          />
          <button onClick={() => setPaused(paused ? null : [...live.events])} className={`h-10 rounded-full px-4 text-sm font-semibold ${paused ? "bg-warning-100 text-warning-700" : "bg-gray-900 text-gray-0"}`}>
            {paused ? "▶ Resume" : "❚❚ Pause"}
          </button>
        </div>
      </div>

      <FloodControl />

      <Pipeline />

      {rows.length === 0 && (
        <Panel>
          <div className="py-10 text-center text-sm text-gray-400">No traffic yet. Launch a bot flood, or open a gated booking URL.</div>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <AnimatePresence initial={false}>
          {rows.map((e) => (
            <motion.div key={`${e.ts}-${e.path}-${e.us}`} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <TraceCard e={e} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function TraceCard({ e }: { e: LiveEvent }) {
  const tone = blocked(e) ? "border-error-600" : e.status && e.status >= 500 ? "border-warning-600" : "border-success-600";
  const who = e.kind === "bot" ? "bg-error-100 text-error-700" : e.kind === "agent" ? "bg-purple-soft text-purple" : e.kind === "human" ? "bg-success-100 text-success-700" : "bg-gray-100 text-gray-700";
  const tx = hashscanTx(e.txId);
  return (
    <div className={`rounded-2xl border-l-4 bg-gray-0 p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2 text-2xs font-semibold uppercase ${who}`}>{e.kind === "forward" ? "pass-through" : e.kind}</span>
          <code className="truncate font-mono text-xs">
            {e.method} {e.trace?.[0]?.detail.replace(/^\S+\s/, "") ?? e.path}
          </code>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ${blocked(e) ? "bg-error-100 text-error-700" : "bg-success-100 text-success-700"}`}>{e.status}</span>
          {e.us !== undefined && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-xs">{e.us < 1000 ? `${e.us} µs` : `${(e.us / 1000).toFixed(1)} ms`}</span>}
          <span className="text-2xs tabular text-gray-400">{new Date(e.ts).toLocaleTimeString("en-IN", { hour12: false })}</span>
        </div>
      </div>
      <ol className="mt-3 flex flex-col gap-1.5">
        {e.trace!
          .filter((s) => s.step !== "request")
          .map((s, i) => (
            <li key={i} className="grid grid-cols-[18px_96px_1fr] items-start gap-2 text-xs">
              <span className={`mt-px text-center font-semibold ${s.ok === false ? "text-error-600" : s.ok === true ? "text-success-700" : "text-gray-400"}`}>{s.ok === false ? "✗" : s.ok === true ? "✓" : "•"}</span>
              <span className="font-medium text-gray-500">{LABEL[s.step]}</span>
              <span className={s.step === "decision" ? "font-semibold text-gray-900" : "text-gray-700"}>{s.detail}</span>
            </li>
          ))}
      </ol>
      {tx && (
        <a href={tx} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-info-600">
          View payment on HashScan ↗
        </a>
      )}
    </div>
  );
}

/** The fixed order the gate checks things in: cheapest first. */
function Pipeline() {
  const steps = [
    ["Request", "arrives on the provider's domain"],
    ["Route match", "URL against registered drops (in memory)"],
    ["Peak mode", "schedule, manual, or backend load"],
    ["Who sent it", "World ID session, agent token, or nobody"],
    ["Check", "pass for booking · free quota or x402 for reads"],
    ["Decision", "forward · waiting room · 402 · 403"],
  ];
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {steps.map(([t, d], i) => (
        <div key={t} className="flex items-center gap-2">
          <div className="rounded-xl bg-gray-0 px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="text-xs font-semibold">
              {i + 1}. {t}
            </div>
            <div className="text-2xs text-gray-500">{d}</div>
          </div>
          {i < steps.length - 1 && <span className="text-gray-300">→</span>}
        </div>
      ))}
    </div>
  );
}
