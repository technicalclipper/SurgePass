import { useEffect, useMemo, useState } from "react";
import { admin, GATEWAY, hashscanTx, type Drop } from "../lib/api";
import type { LiveEvent } from "../lib/live";
import { ago, Pill, Segmented } from "../ui/console";
import { LogPanel } from "../ui/logpanel";

// Side by side, per drop: who the gate let through and who it turned away, for people (World ID),
// agents (human approval) and partner companies (allowlist + Hedera KYC). Agents and companies are
// started from here as jobs against the drop you pick; people are you, in the waiting room.

type Actor = "person" | "agent" | "partner";

interface Job {
  id: string;
  scenario: string;
  title: string;
  who: string;
  drop: string;
  dropLabel: string;
  status: "running" | "waiting_approval" | "done" | "failed";
  steps: { label: string; status: "pending" | "running" | "ok" | "failed"; out?: string }[];
  approvalUrl?: string;
  startedAt: number;
  endedAt?: number;
}

interface Scenario {
  id: string;
  title: string;
  who: string;
  pools: Drop["pool"][];
}

const COLUMNS: { actor: Actor; title: string; sub: string; ok: string; no: string; scenarios: string[] }[] = [
  { actor: "person", title: "People", sub: "World ID · one entry per human", ok: "Verified", no: "Not verified", scenarios: [] },
  { actor: "agent", title: "Agents", sub: "Only with their human's World ID approval", ok: "Let through", no: "Turned away", scenarios: ["agent-normal", "agent-premium", "rogue"] },
  { actor: "partner", title: "Partner companies", sub: "Allowlist + KYC on the Hedera seat token", ok: "Let through", no: "Turned away", scenarios: ["partner-tripnest", "partner-unlisted", "hedera-probe"] },
];

const actorOf = (scenario: string): Actor => (scenario.startsWith("partner") || scenario.startsWith("hedera") ? "partner" : "agent");
const isLive = (d: Drop) => (d.status === "open" || d.status === "scheduled") && d.closesAt > Date.now();
const timeLeft = (d: Drop) => {
  const ms = d.closesAt - Date.now();
  if (ms <= 0) return d.status === "results" ? "results out" : d.status;
  const m = Math.floor(ms / 60_000);
  return m >= 60 ? `closes in ${Math.floor(m / 60)}h ${m % 60}m` : `closes in ${m}m ${Math.floor((ms % 60_000) / 1000)}s`;
};

const remember = (k: string, v?: string) => {
  try {
    if (v === undefined) return localStorage.getItem(k) ?? undefined;
    localStorage.setItem(k, v);
  } catch {
    // per-viewer convenience only
  }
  return undefined;
};

export function Compare() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [outcomes, setOutcomes] = useState<LiveEvent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [log, setLog] = useState<LiveEvent[]>([]);
  const [selected, setSelected] = useState<string>(() => remember("sp_compare_drop") ?? "all");
  const [, tick] = useState(0);

  useEffect(() => {
    let stop = false;
    const load = () => {
      void admin<{ drops: Drop[] }>("/drops").then((r) => !stop && setDrops(r.drops), () => {});
      void admin<{ outcomes: LiveEvent[] }>("/outcomes").then((r) => !stop && setOutcomes(r.outcomes), () => {});
      void admin<{ jobs: Job[]; scenarios: Scenario[] }>("/jobs").then(
        (r) => {
          if (stop) return;
          setJobs(r.jobs);
          setScenarios(r.scenarios);
        },
        () => {},
      );
    };
    load();
    const t = setInterval(() => {
      load();
      tick((n) => n + 1);
    }, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    remember("sp_compare_drop", selected);
    if (selected === "all") return setLog([]);
    let stop = false;
    const load = () => void admin<{ events: LiveEvent[] }>(`/drops/${selected}/log`).then((r) => !stop && setLog(r.events), () => {});
    load();
    const t = setInterval(load, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [selected]);

  const drop = drops.find((d) => d.id === selected);
  const byId = useMemo(() => new Map(drops.map((d) => [d.id, d])), [drops]);
  // A picked drop: its own history plus any of the latest decisions for it, without duplicates.
  const decisions = useMemo(() => {
    if (!drop) return outcomes;
    const seen = new Set<string>();
    return [...log.filter((e) => e.outcome), ...outcomes.filter((e) => e.drop === drop.id)]
      .filter((e) => {
        const k = `${e.ts}|${e.note}`;
        return seen.has(k) ? false : (seen.add(k), true);
      })
      .sort((a, b) => b.ts - a.ts);
  }, [drop, log, outcomes]);
  const counts = (id: string) => {
    const o = outcomes.filter((e) => e.drop === id);
    return { ok: o.filter((e) => e.outcome!.ok).length, no: o.filter((e) => !e.outcome!.ok).length };
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Compare</h1>
        <p className="mt-1 text-sm text-gray-500">Pick a drop, run agents and companies against it, and see who the gate let through and who it turned away. Every drop keeps its own history.</p>
      </div>

      <DropTabs drops={drops} selected={selected} onSelect={setSelected} counts={counts} total={{ ok: outcomes.filter((e) => e.outcome!.ok).length, no: outcomes.filter((e) => !e.outcome!.ok).length }} />

      <div className="grid gap-5 xl:grid-cols-3">
        {COLUMNS.map((col) => {
          const mine = decisions.filter((e) => e.outcome?.actor === col.actor);
          const colJobs = jobs.filter((j) => actorOf(j.scenario) === col.actor && (!drop || j.drop === drop.id));
          return (
            <section key={col.actor} className="flex min-w-0 flex-col gap-4 rounded-3xl bg-gray-0 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div>
                <div className="text-lg font-semibold tracking-[-0.01em]">{col.title}</div>
                <div className="text-xs text-gray-500">{col.sub}</div>
              </div>
              {col.actor === "person" ? (
                <PeopleLinks drops={drop ? [drop] : drops} />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {col.scenarios.map((id) => {
                    const s = scenarios.find((x) => x.id === id);
                    return s ? <RunCard key={id} s={s} drops={drops} selected={drop} jobs={jobs} /> : null;
                  })}
                </div>
              )}
              {colJobs.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-2xs font-bold uppercase tracking-wide text-gray-400">Recent runs</div>
                  {colJobs.slice(0, 3).map((j) => (
                    <JobCard key={j.id} j={j} showDrop={!drop} />
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                <Lane title={col.ok} ok events={mine.filter((e) => e.outcome!.ok)} byId={byId} showDrop={!drop} />
                <Lane title={col.no} ok={false} events={mine.filter((e) => !e.outcome!.ok)} byId={byId} showDrop={!drop} />
              </div>
            </section>
          );
        })}
      </div>

      <DropLog drop={drop} events={drop ? log : outcomes} />
    </div>
  );
}

function DropTabs({ drops, selected, onSelect, counts, total }: { drops: Drop[]; selected: string; onSelect: (id: string) => void; counts: (id: string) => { ok: number; no: number }; total: { ok: number; no: number } }) {
  const tab = (active: boolean) => `flex min-w-[210px] shrink-0 flex-col gap-2 rounded-2xl p-4 text-left transition ${active ? "bg-gray-900 text-gray-0 shadow-lifted" : "bg-gray-0 text-gray-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-gray-50"}`;
  const tally = (c: { ok: number; no: number }, active: boolean) => (
    <div className="flex items-center gap-3 text-xs font-semibold tabular">
      <span className={active ? "text-success-100" : "text-success-700"}>✓ {c.ok}</span>
      <span className={active ? "text-error-100" : "text-error-700"}>✕ {c.no}</span>
    </div>
  );
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      <button onClick={() => onSelect("all")} className={tab(selected === "all")}>
        <span className="text-sm font-semibold">All drops</span>
        <span className={`text-xs ${selected === "all" ? "text-gray-0/60" : "text-gray-500"}`}>Latest decisions everywhere</span>
        {tally(total, selected === "all")}
      </button>
      {drops.map((d) => {
        const active = selected === d.id;
        return (
          <button key={d.id} onClick={() => onSelect(d.id)} className={tab(active)}>
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-md px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wide ${active ? "bg-gray-0/15" : "bg-gray-100 text-gray-700"}`}>{d.pool}</span>
              <span className={`text-2xs font-semibold ${isLive(d) ? (active ? "text-success-100" : "text-success-700") : active ? "text-gray-0/60" : "text-gray-500"}`}>{timeLeft(d)}</span>
            </div>
            <span className="truncate text-sm font-semibold">{d.label}</span>
            {tally(counts(d.id), active)}
          </button>
        );
      })}
    </div>
  );
}

function RunCard({ s, drops, selected, jobs }: { s: Scenario; drops: Drop[]; selected?: Drop; jobs: Job[] }) {
  const eligible = drops.filter((d) => s.pools.includes(d.pool) && isLive(d));
  const fallback = selected && eligible.some((d) => d.id === selected.id) ? selected.id : eligible[0]?.id ?? "";
  const [pick, setPick] = useState(fallback);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Follow the drop tab when it changes; keep the user's own pick otherwise.
  useEffect(() => setPick(fallback), [selected?.id, eligible.length]);
  const target = eligible.some((d) => d.id === pick) ? pick : fallback;
  const busy = jobs.some((j) => j.scenario === s.id && (j.status === "running" || j.status === "waiting_approval"));

  async function run() {
    setErr(null);
    setStarting(true);
    try {
      await admin(`/jobs/${s.id}`, { method: "POST", body: JSON.stringify({ drop: target }) });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{s.title}</div>
          <div className="text-2xs text-gray-500">{s.who}</div>
        </div>
        <button
          disabled={busy || starting || !target}
          onClick={() => void run()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-gray-900 px-4 text-xs font-semibold text-gray-0 transition hover:bg-gray-700 active:scale-[0.98] disabled:bg-gray-200 disabled:text-gray-500"
        >
          {busy ? (
            <>
              <span className="size-3 animate-spin rounded-full border-2 border-gray-500/30 border-t-gray-500" /> Running
            </>
          ) : (
            <>Run ▶</>
          )}
        </button>
      </div>
      {eligible.length ? (
        <select value={target} onChange={(e) => setPick(e.target.value)} className="mt-2.5 h-9 w-full rounded-xl border border-gray-200 bg-gray-0 px-2.5 text-xs font-medium outline-none focus:border-gray-400">
          {eligible.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} · {timeLeft(d)}
            </option>
          ))}
        </select>
      ) : (
        <div className="mt-2.5 rounded-xl bg-gray-100 px-3 py-2 text-2xs text-gray-500">No open {s.pools.join(" or ")} drop</div>
      )}
      {err && <div className="mt-2 rounded-lg bg-error-100 px-2.5 py-1.5 text-2xs font-medium text-error-700">{err}</div>}
    </div>
  );
}

function JobCard({ j, showDrop }: { j: Job; showDrop: boolean }) {
  const [open, setOpen] = useState(false);
  const done = j.steps.filter((s) => s.status === "ok").length;
  const tone = j.status === "done" ? "text-success-700 bg-success-100" : j.status === "failed" ? "text-error-700 bg-error-100" : "text-warning-700 bg-warning-100";
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-0 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">
            {j.title} · {j.who}
          </div>
          <div className="text-2xs text-gray-500">
            {showDrop && `${j.dropLabel} · `}
            {ago(Date.now() - j.startedAt)} ago · {done}/{j.steps.length} steps
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold uppercase ${tone}`}>{j.status === "waiting_approval" ? "needs World ID" : j.status}</span>
      </div>
      {j.status === "waiting_approval" && j.approvalUrl && (
        <a href={j.approvalUrl} target="_blank" rel="noreferrer" className="mt-2.5 flex items-center justify-center gap-2 rounded-xl bg-info-600 px-3 py-2.5 text-sm font-semibold text-gray-0 hover:opacity-90">
          Open approval page · scan with World App ↗
        </a>
      )}
      <ol className="mt-2.5 flex flex-col gap-1.5">
        {j.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span
              className={`mt-px grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold ${
                s.status === "ok" ? "bg-success-600 text-gray-0" : s.status === "failed" ? "bg-error-600 text-gray-0" : s.status === "running" ? "bg-gray-900 text-gray-0" : "bg-gray-100 text-gray-500"
              }`}
            >
              {s.status === "ok" ? "✓" : s.status === "failed" ? "✕" : s.status === "running" ? <span className="size-2 animate-spin rounded-full border border-gray-0/30 border-t-gray-0" /> : i + 1}
            </span>
            <span className={s.status === "pending" ? "text-gray-400" : "text-gray-900"}>{s.label}</span>
          </li>
        ))}
      </ol>
      <button onClick={() => setOpen(!open)} className="mt-2 text-2xs font-semibold text-info-600">
        {open ? "Hide raw output" : "Show raw output"}
      </button>
      {open && (
        <pre className="mt-1.5 max-h-64 overflow-auto rounded-xl bg-gray-900 p-3 font-mono text-[10px] leading-snug text-gray-0">
          {j.steps.map((s) => (s.out ? `▸ ${s.label}\n${s.out}\n\n` : "")).join("") || "No output yet"}
        </pre>
      )}
    </div>
  );
}

function Lane({ title, ok, events, byId, showDrop }: { title: string; ok: boolean; events: LiveEvent[]; byId: Map<string, Drop>; showDrop: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col rounded-2xl p-2.5 ${ok ? "bg-success-100/60" : "bg-error-100/60"}`}>
      <div className="mb-2 flex items-center justify-between px-1">
        <span className={`text-2xs font-bold uppercase tracking-wide ${ok ? "text-success-700" : "text-error-700"}`}>
          {ok ? "✓" : "✕"} {title}
        </span>
        <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-2xs font-bold tabular ${ok ? "bg-success-600 text-gray-0" : "bg-error-600 text-gray-0"}`}>{events.length}</span>
      </div>
      <div className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto">
        {events.length === 0 && <div className="py-6 text-center text-2xs text-gray-400">Nothing yet</div>}
        {events.map((e, i) => {
          const d = byId.get(e.drop ?? "");
          const link = hashscanTx(e.txId);
          return (
            <div key={`${e.ts}-${i}`} className="rounded-xl bg-gray-0 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[11px] font-semibold text-gray-900">{e.outcome!.who}</span>
                <span className="shrink-0 text-2xs text-gray-400">{ago(Date.now() - e.ts)}</span>
              </div>
              <div className="mt-0.5 break-words text-xs leading-snug text-gray-700 [overflow-wrap:anywhere]">{e.outcome!.action}</div>
              {(link || (showDrop && d)) && (
                <div className="mt-1 flex items-center gap-2 text-2xs text-gray-500">
                  {showDrop && d && <span className="truncate">{d.label}</span>}
                  {link && (
                    <a href={link} target="_blank" rel="noreferrer" className="ml-auto shrink-0 font-semibold text-info-600">
                      Hedera ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type LogFilter = "all" | "ok" | "no" | "hedera";

function DropLog({ drop, events }: { drop?: Drop; events: LiveEvent[] }) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const shown = events
    .filter((e) => (filter === "ok" ? e.outcome?.ok === true : filter === "no" ? e.outcome?.ok === false || (e.status ?? 0) >= 400 : filter === "hedera" ? !!(e.txId || e.hcsSeq) : true))
    .slice()
    .reverse();
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.01em]">{drop ? `${drop.label} · full log` : "Latest decisions · all drops"}</h2>
          <p className="text-xs text-gray-500">
            {drop ? (
              <>
                Everything that happened to this drop, newest first, kept across reloads (bot traffic left out).{" "}
                <Pill kind={drop.status}>{drop.status}</Pill>
              </>
            ) : (
              "Pick a drop above for its complete history: entries, approvals, payments, the draw and Hedera writes."
            )}
          </p>
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Everything" },
            { value: "ok", label: "Let through" },
            { value: "no", label: "Turned away" },
            { value: "hedera", label: "On Hedera" },
          ]}
        />
      </div>
      <LogPanel title={`${shown.length} line${shown.length === 1 ? "" : "s"}`} events={shown} traces inlineMax={300} className="h-[620px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]" />
    </section>
  );
}

/** People are real: you open the waiting room and scan with your World App. */
function PeopleLinks({ drops }: { drops: Drop[] }) {
  const open = drops.filter((d) => isLive(d) && d.pool !== "partner");
  return (
    <div className="flex flex-col gap-2.5">
      {open.map((d) => (
        <a key={d.id} href={`${GATEWAY}/_sp/room/${d.id}`} target="_blank" rel="noreferrer" className="group flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3 transition hover:bg-gray-100">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{d.pool === "premium" ? "Place a sealed bid" : "Enter the draw"}</span>
            <span className="block truncate text-2xs text-gray-500">
              {d.label} · {timeLeft(d)}
            </span>
          </span>
          <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-gray-0 px-4 text-xs font-semibold text-gray-900 shadow-sm group-hover:bg-gray-900 group-hover:text-gray-0">Open ↗</span>
        </a>
      ))}
      {!open.length && <div className="rounded-2xl bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">{drops.length === 1 ? "This drop is for partners only, or it has closed" : "No open drops"}</div>}
      <div className="px-1 text-2xs text-gray-400">Opens the waiting room. Scan with your World App there.</div>
    </div>
  );
}
