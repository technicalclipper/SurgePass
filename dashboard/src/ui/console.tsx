import { useState, type ReactNode } from "react";
import { hashscanTx } from "../lib/api";
import type { LiveEvent } from "../lib/live";
import { Rolling } from "./rolling";

// Console primitives: same World tokens as the waiting room, denser, for a desktop operator.

export function Panel({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-gray-0 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="shrink-0 whitespace-nowrap text-sm font-semibold text-gray-900">{title}</h2>
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
      <div className={`mt-1 text-3xl font-semibold tabular tracking-[-0.01em] ${c}`}>{typeof value === "string" || typeof value === "number" ? <Rolling value={value} /> : value}</div>
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
  match: "Route",
  peak: "Peak",
  identity: "Who",
  world: "World ID",
  entry: "Entry",
  pass: "Pass",
  quota: "Quota",
  payment: "x402",
  budget: "Budget",
  decision: "Decision",
  upstream: "Provider",
};

const gateTime = (us: number) => (us < 1000 ? `${us} µs` : `${(us / 1000).toFixed(1)} ms`);

/** How the gate handled a request, as a vertical timeline with every detail in full. */
export function TraceSteps({ e }: { e: LiveEvent }) {
  const steps = (e.trace ?? []).filter((s) => s.step !== "request");
  if (!steps.length) return null;
  return (
    <ol className="relative flex flex-col">
      {steps.map((s, i) => {
        const decision = s.step === "decision";
        const mark = decision ? "bg-gray-900 text-gray-0" : s.ok === false ? "bg-error-600 text-gray-0" : s.ok === true ? "bg-success-600 text-gray-0" : "bg-gray-200 text-gray-700";
        return (
          <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
            {i < steps.length - 1 && <span className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-gray-200" />}
            <span className={`z-10 mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full text-[10px] font-bold ${mark}`}>{decision ? "→" : s.ok === false ? "✕" : s.ok === true ? "✓" : "·"}</span>
            <div className="min-w-0 flex-1">
              <div className={`text-2xs font-semibold uppercase tracking-[0.08em] ${s.ok === false ? "text-error-700" : "text-gray-400"}`}>{STEP[s.step] ?? s.step}</div>
              <div className={`text-sm leading-snug [overflow-wrap:anywhere] ${decision ? "font-semibold text-gray-900" : "text-gray-700"}`}>{s.detail}</div>
            </div>
          </li>
        );
      })}
      {e.us !== undefined && <li className="mt-3 pl-8 font-mono text-xs text-gray-400">Gate decided in {gateTime(e.us)}</li>}
    </ol>
  );
}

/** Outcome colour for a log line: green let through, amber redirected or asked to pay, red refused or failing. */
function tone(e: LiveEvent): "ok" | "wait" | "bad" | "info" {
  const st = e.status ?? 0;
  if (e.outcome) return e.outcome.ok ? "ok" : "bad";
  if (e.side === "direct") return st === 0 || st >= 500 ? "bad" : "info";
  if (st >= 400 && st !== 402) return "bad";
  if (st === 302 || st === 402) return "wait";
  if (st >= 200) return "ok";
  return "info";
}
const DOT = { ok: "bg-success-600", wait: "bg-warning-600", bad: "bg-error-600", info: "bg-gray-300" };
const STATUS_TEXT = { ok: "text-success-700", wait: "text-warning-700", bad: "text-error-700", info: "text-gray-500" };

function statusWord(st?: number) {
  if (!st) return "";
  return st === 302 ? "waiting room" : st === 402 ? "pay" : st === 401 ? "not allowed" : st === 403 ? "blocked" : st === 409 ? "duplicate" : st === 429 ? "too many" : st >= 500 ? "site down" : st < 300 ? "ok" : "";
}

interface Row {
  e: LiveEvent;
  n: number;
}

/** Newest first, with identical consecutive lines (a bot hammering one URL) folded into one row with a count. */
function rowsOf(events: LiveEvent[], max: number): Row[] {
  const out: Row[] = [];
  const sig = (e: LiveEvent) => (e.txId || e.hcsSeq || e.outcome ? `u${e._id ?? e.ts}` : `${e.kind}|${e.side}|${e.status}|${e.method}|${e.path}|${e.note}`);
  for (let i = events.length - 1; i >= 0 && out.length < max; i--) {
    const e = events[i]!;
    const last = out[out.length - 1];
    if (last && sig(last.e) === sig(e)) last.n++;
    else out.push({ e, n: 1 });
  }
  return out;
}

const timeOf = (ts: number) => new Date(ts).toLocaleTimeString("en-IN", { hour12: false });

/**
 * A log: one compact row per request (time · outcome · who · status · route · what happened).
 * Rows with a trace open in place to show how the gate decided. In `onSelect` mode a click selects
 * the row instead (the full-screen view shows the trace beside the list).
 */
export function LogStream({
  events,
  max = 60,
  dense = false,
  traces = false,
  selectedId,
  onSelect,
}: {
  events: LiveEvent[];
  max?: number;
  dense?: boolean;
  traces?: boolean;
  selectedId?: number;
  onSelect?: (e: LiveEvent) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const rows = rowsOf(events, max);
  return (
    <div className="flex flex-col">
      {rows.length === 0 && <div className="py-10 text-center text-sm text-gray-400">Waiting for traffic…</div>}
      {rows.map(({ e, n }, i) => {
        const id = e._id ?? e.ts + i;
        const t = tone(e);
        const k = kindChip(e);
        const tx = hashscanTx(e.txId);
        const canOpen = traces && !!e.trace?.length;
        const isOpen = onSelect ? selectedId === e._id : open === id;
        const main = e.path ? (
          <code className="min-w-0 truncate font-mono text-[13px] text-gray-900">
            {e.method && <span className="text-gray-400">{e.method} </span>}
            {e.path}
          </code>
        ) : (
          <span className="min-w-0 truncate text-sm text-gray-900">{e.note}</span>
        );
        return (
          <div key={id} className={`border-b border-gray-100 last:border-0 ${isOpen ? "bg-gray-50" : ""}`}>
            <button
              type="button"
              disabled={!canOpen && !onSelect}
              onClick={() => (onSelect ? onSelect(e) : setOpen(isOpen ? null : id))}
              className={`flex w-full min-w-0 items-center gap-3 px-2.5 py-2 text-left transition ${canOpen || onSelect ? "hover:bg-gray-50" : "cursor-default"} ${isOpen && onSelect ? "shadow-[inset_3px_0_0_rgb(var(--gray-900))]" : ""}`}
            >
              <span className={`shrink-0 font-mono text-[11px] tabular text-gray-400 ${dense ? "" : "w-[58px]"}`}>{timeOf(e.ts)}</span>
              <span className={`size-2 shrink-0 rounded-full ${DOT[t]}`} />
              <span className={`shrink-0 truncate rounded px-1.5 py-0.5 text-center text-[10px] font-bold tracking-[0.06em] ${k.cls} ${dense ? "max-w-[96px]" : "w-[92px]"}`}>{k.label}</span>
              {e.status ? (
                <span className={`shrink-0 font-mono text-xs font-semibold ${STATUS_TEXT[t]} ${dense ? "" : "w-[128px] truncate"}`}>
                  {e.status}
                  {!dense && <span className="font-sans font-medium"> {statusWord(e.status)}</span>}
                </span>
              ) : (
                !dense && e.path && <span className="w-[128px] shrink-0" />
              )}
              {main}
              <span className="ml-auto flex shrink-0 items-center gap-2 pl-1">
                {!dense && e.path && e.note && <span className="hidden max-w-[260px] truncate text-xs text-gray-500 xl:inline">{e.note}</span>}
                {n > 1 && <span className="rounded-full bg-gray-900 px-2 py-0.5 font-mono text-[11px] font-semibold text-gray-0">×{n}</span>}
                {tx && (
                  <a href={tx} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} title="View on HashScan" className="text-xs font-semibold text-info-600 hover:underline">
                    {dense ? "↗" : "HashScan ↗"}
                  </a>
                )}
                {(canOpen || onSelect) && (
                  <svg width="12" height="12" viewBox="0 0 24 24" className={`text-gray-400 transition ${isOpen && !onSelect ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                )}
              </span>
            </button>
            {isOpen && !onSelect && (
              <div className={`px-2.5 pb-3 pt-1 ${dense ? "pl-6" : "pl-[86px]"}`}>
                {e.path && e.note && <div className="mb-3 text-sm text-gray-700">{e.note}</div>}
                <TraceSteps e={e} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Everything about one log line, for the full-screen view. */
export function LogDetail({ e }: { e: LiveEvent | undefined }) {
  if (!e) return <div className="grid h-full place-items-center text-sm text-gray-400">Pick a line to see how the gate decided.</div>;
  const k = kindChip(e);
  const t = tone(e);
  const tx = hashscanTx(e.txId);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold tracking-[0.06em] ${k.cls}`}>{k.label}</span>
        {e.status ? (
          <span className={`font-mono text-sm font-semibold ${STATUS_TEXT[t]}`}>
            {e.status} <span className="font-sans font-medium">{statusWord(e.status)}</span>
          </span>
        ) : null}
        <span className="ml-auto font-mono text-xs text-gray-400">{new Date(e.ts).toLocaleString("en-IN", { hour12: false })}</span>
      </div>
      {e.path && (
        <code className="block rounded-xl bg-gray-50 px-3 py-2.5 font-mono text-[13px] text-gray-900 [overflow-wrap:anywhere]">
          {e.method && <span className="text-gray-400">{e.method} </span>}
          {e.path}
        </code>
      )}
      {e.note && <p className="text-base leading-snug text-gray-900">{e.note}</p>}
      {(tx || e.hcsSeq) && (
        <div className="flex flex-wrap gap-3 text-sm">
          {e.hcsSeq ? <span className="rounded-full bg-info-100 px-3 py-1 font-semibold text-info-700">HCS message #{e.hcsSeq}</span> : null}
          {tx && (
            <a href={tx} target="_blank" rel="noreferrer" className="rounded-full bg-info-100 px-3 py-1 font-semibold text-info-700 hover:underline">
              View on HashScan ↗
            </a>
          )}
        </div>
      )}
      {e.trace?.length ? (
        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-gray-400">How the gate decided</div>
          <TraceSteps e={e} />
        </div>
      ) : null}
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
