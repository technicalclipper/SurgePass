import type { ReactNode } from "react";
import { hashscanTx } from "../lib/api";
import type { LiveEvent } from "../lib/live";

// Console primitives: same World tokens as the waiting room, denser, for a desktop operator.

export function Panel({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-gray-0 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "success" | "error" | "warning" }) {
  const c = tone === "success" ? "text-success-700" : tone === "error" ? "text-error-600" : tone === "warning" ? "text-warning-700" : "text-gray-900";
  return (
    <div className="rounded-2xl bg-gray-0 p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular tracking-[-0.01em] ${c}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

const PILL: Record<string, string> = {
  peak: "bg-warning-100 text-warning-700",
  open: "bg-success-100 text-success-700",
  scheduled: "bg-gray-100 text-gray-700",
  revealing: "bg-info-100 text-info-700",
  drawing: "bg-info-100 text-info-700",
  results: "bg-gray-900 text-gray-0",
  passthrough: "bg-gray-100 text-gray-500",
  crashed: "bg-error-100 text-error-700",
  healthy: "bg-success-100 text-success-700",
};

export function Pill({ kind, children }: { kind: keyof typeof PILL | string; children: ReactNode }) {
  return <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${PILL[kind] ?? PILL.scheduled}`}>{children}</span>;
}

export function Btn({ children, onClick, kind = "primary", disabled, type = "button" }: { children: ReactNode; onClick?: () => void; kind?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; type?: "button" | "submit" }) {
  const k = {
    primary: "bg-gray-900 text-gray-0",
    secondary: "bg-gray-0 text-gray-900 border border-gray-200",
    ghost: "bg-gray-100 text-gray-900",
    danger: "bg-error-100 text-error-700",
  }[kind];
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40 ${k}`}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="text-2xs text-gray-500">{hint}</span>}
    </label>
  );
}

export const inputCls = "h-10 rounded-xl border border-gray-200 bg-gray-0 px-3 text-sm outline-none focus:border-gray-400";

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full bg-gray-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-full px-3 text-xs font-semibold transition ${value === o.value ? "bg-gray-0 text-gray-900 shadow-sm" : "text-gray-500"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const DOT: Record<LiveEvent["kind"], string> = {
  bot: "bg-error-600",
  agent: "bg-purple",
  human: "bg-success-600",
  surge: "bg-warning-600",
  draw: "bg-info-600",
  pass: "bg-gray-900",
  system: "bg-gray-400",
  forward: "bg-gray-300",
};
const LABEL: Record<LiveEvent["kind"], string> = { bot: "BOT", agent: "AGENT", human: "HUMAN", surge: "SURGE", draw: "DRAW", pass: "PASS", system: "SYS", forward: "FWD" };

/** One-line summary of how the gate handled a request: the steps that decided it, ✓ / ✗, and the gate's time. */
export function TraceLine({ e }: { e: LiveEvent }) {
  if (!e.trace?.length) return null;
  const shown = e.trace.filter((s) => s.step !== "request" && s.step !== "upstream");
  return (
    <div className="col-span-4 -mt-0.5 mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-[152px] font-sans text-2xs text-gray-500">
      {shown.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-gray-300">→</span>}
          <span className={s.ok === false ? "text-error-600" : s.ok === true ? "text-success-700" : "text-gray-700"}>
            {s.ok === false ? "✗ " : s.ok === true ? "✓ " : ""}
            {s.step === "decision" ? <b className="text-gray-900">{short(s.detail)}</b> : short(s.detail)}
          </span>
        </span>
      ))}
      {e.us !== undefined && <span className="ml-1 rounded bg-gray-100 px-1 font-mono text-gray-700">{e.us < 1000 ? `${e.us} µs` : `${(e.us / 1000).toFixed(1)} ms`}</span>}
    </div>
  );
}

const short = (d: string) => (d.length > 70 ? d.slice(0, 68) + "…" : d);

export function LogStream({ events, max = 60, dense = false, traces = false }: { events: LiveEvent[]; max?: number; dense?: boolean; traces?: boolean }) {
  const rows = events.slice(-max).reverse();
  return (
    <div className="flex flex-col font-mono text-xs">
      {rows.length === 0 && <div className="py-8 text-center font-sans text-sm text-gray-400">Waiting for traffic…</div>}
      {rows.map((e, i) => {
        const tx = hashscanTx(e.txId);
        return (
          <div key={e._id ?? `${e.ts}-${i}`} className={`grid grid-cols-[76px_64px_1fr_auto] items-center gap-x-3 border-b border-gray-100 ${dense ? "py-1" : "py-1.5"}`}>
            <span className="tabular text-gray-400">{new Date(e.ts).toLocaleTimeString("en-IN", { hour12: false })}</span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-gray-700">
              <span className={`size-2 rounded-full ${DOT[e.kind]}`} />
              {e.side === "direct" ? "BOT→B" : LABEL[e.kind]}
            </span>
            <span className="truncate text-gray-900">
              {e.method && <span className="text-gray-500">{e.method} </span>}
              {e.path && <span>{e.path} </span>}
              {e.status && <span className="text-gray-500">→ {e.status} </span>}
              <span className="text-gray-700">{e.note}</span>
              {e.hcsSeq ? <span className="text-gray-500"> · HCS #{e.hcsSeq}</span> : null}
            </span>
            <span>
              {tx && (
                <a href={tx} target="_blank" rel="noreferrer" className="font-sans font-semibold text-info-600">
                  tx ↗
                </a>
              )}
            </span>
            {traces && <TraceLine e={e} />}
          </div>
        );
      })}
    </div>
  );
}

export const inr = (n: number, d = 0) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const ago = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (Math.abs(s) < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return Math.abs(m) < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};
