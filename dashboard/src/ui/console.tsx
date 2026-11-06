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

const KIND: Record<LiveEvent["kind"], { label: string; cls: string }> = {
  bot: { label: "BOT", cls: "bg-error-100 text-error-700" },
  agent: { label: "AGENT", cls: "bg-purple-soft text-purple" },
  human: { label: "HUMAN", cls: "bg-success-100 text-success-700" },
  surge: { label: "SURGE", cls: "bg-warning-100 text-warning-700" },
  draw: { label: "DRAW", cls: "bg-info-100 text-info-700" },
  pass: { label: "PASS", cls: "bg-gray-900 text-gray-0" },
  system: { label: "SYSTEM", cls: "bg-gray-100 text-gray-700" },
  forward: { label: "PASS-THROUGH", cls: "bg-gray-100 text-gray-500" },
};

/** Chip for who/what a log line is about. World ID attempts get their own label, green if allowed, red if refused. */
export function kindChip(e: LiveEvent): { label: string; cls: string } {
  if (e.side === "direct") return { label: "BOT → SITE B", cls: "bg-error-100 text-error-700" };
  if (e.path?.includes("/world/verify")) return { label: "WORLD ID", cls: (e.status ?? 0) >= 400 ? "bg-error-100 text-error-700" : "bg-success-100 text-success-700" };
  return KIND[e.kind];
}

function statusChip(status?: number) {
  if (!status) return null;
  const cls =
    status >= 500 ? "bg-error-600 text-gray-0" : status >= 400 ? "bg-error-100 text-error-700" : status >= 300 ? "bg-warning-100 text-warning-700" : "bg-success-100 text-success-700";
  const word = status === 302 ? "→ waiting room" : status === 402 ? "pay" : status === 401 ? "not allowed" : status === 403 ? "blocked" : status === 409 ? "duplicate" : status === 429 ? "too many" : status >= 500 ? "site down" : status < 300 ? "ok" : "";
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 font-mono text-xs font-semibold ${cls}`}>
      {status}
      {word && <span className="font-sans font-medium opacity-80">{word}</span>}
    </span>
  );
}

const STEP: Record<string, string> = {
  match: "match",
  peak: "peak",
  identity: "who",
  world: "World ID",
  entry: "entry",
  pass: "pass",
  quota: "quota",
  payment: "x402",
  budget: "budget",
  decision: "decision",
  upstream: "provider",
};

/** How the gate handled a request: each deciding step with ✓ / ✗, and the gate's time. */
export function TraceLine({ e }: { e: LiveEvent }) {
  if (!e.trace?.length) return null;
  const shown = e.trace.filter((s) => s.step !== "request");
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {shown.map((s, i) => (
        <span
          key={i}
          title={s.detail}
          className={`inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-xs ${
            s.step === "decision" ? "bg-gray-900 text-gray-0" : s.ok === false ? "bg-error-100 text-error-700" : s.ok === true ? "bg-success-100 text-success-700" : "bg-gray-100 text-gray-700"
          }`}
        >
          <span className="shrink-0 font-semibold">
            {s.step === "decision" ? "⇒" : s.ok === false ? "✗" : s.ok === true ? "✓" : "•"} {STEP[s.step] ?? s.step}
          </span>
          <span className="truncate">{short(s.detail)}</span>
        </span>
      ))}
      {e.us !== undefined && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">gate {e.us < 1000 ? `${e.us} µs` : `${(e.us / 1000).toFixed(1)} ms`}</span>}
    </div>
  );
}

const short = (d: string) => (d.length > 64 ? d.slice(0, 62) + "…" : d);

export function LogStream({ events, max = 60, dense = false, traces = false }: { events: LiveEvent[]; max?: number; dense?: boolean; traces?: boolean }) {
  const rows = events.slice(-max).reverse();
  return (
    <div className="flex flex-col gap-1.5">
      {rows.length === 0 && <div className="py-8 text-center text-sm text-gray-400">Waiting for traffic…</div>}
      {rows.map((e, i) => {
        const tx = hashscanTx(e.txId);
        const k = kindChip(e);
        const bad = (e.status ?? 0) >= 400 || e.trace?.some((s) => s.ok === false && s.step !== "quota" && s.step !== "payment");
        return (
          <div
            key={e._id ?? `${e.ts}-${i}`}
            className={`rounded-xl border-l-4 bg-gray-50 px-3 ${dense ? "py-1.5" : "py-2"} ${
              e.kind === "human" || e.kind === "agent" ? (bad ? "border-error-600" : "border-success-600") : e.side === "direct" ? "border-error-600" : (e.status ?? 0) >= 300 ? "border-warning-600" : "border-gray-200"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 font-mono text-xs tabular text-gray-400">{new Date(e.ts).toLocaleTimeString("en-IN", { hour12: false })}</span>
              <span className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-bold tracking-wide ${k.cls}`}>{k.label}</span>
              {statusChip(e.status)}
              {e.path && (
                <code className="min-w-0 truncate font-mono text-sm text-gray-900">
                  {e.method && <span className="text-gray-500">{e.method} </span>}
                  {e.path}
                </code>
              )}
              {tx && (
                <a href={tx} target="_blank" rel="noreferrer" className="ml-auto shrink-0 text-xs font-semibold text-info-600">
                  HashScan ↗
                </a>
              )}
            </div>
            {e.note && <div className={`mt-0.5 text-sm ${bad ? "text-error-700" : "text-gray-700"}`}>{e.note}{e.hcsSeq ? <span className="text-gray-500"> · HCS #{e.hcsSeq}</span> : null}</div>}
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
