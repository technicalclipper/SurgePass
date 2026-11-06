import { useEffect, useMemo, useState, type ReactNode } from "react";
import { admin, GATEWAY, hashscanTx, type Drop } from "../lib/api";
import type { LiveEvent } from "../lib/live";
import { ago, Segmented } from "../ui/console";
import { LogPanel } from "../ui/logpanel";
import { PlayIcon } from "../ui/icons";

// Per drop: run agents and companies against it (left), and see who the gate let through and who it
// turned away (right), with the drop's full log underneath. People are you, in the waiting room.

type Actor = "person" | "agent" | "partner";

interface Job {
  id: string;
  scenario: string;
  title: string;
  who: string;
  drop: string;
  dropLabel: string;
  /** done: let through as expected · blocked: turned away as expected · failed: something else happened. */
  status: "running" | "waiting_approval" | "done" | "blocked" | "failed";
  expect: "allowed" | "refused";
  steps: { label: string; status: "pending" | "running" | "ok" | "refused" | "failed"; out?: string }[];
  approvalUrl?: string;
  startedAt: number;
  endedAt?: number;
}

interface Scenario {
  id: string;
  title: string;
  who: string;
  expect: "allowed" | "refused";
  pools: Drop["pool"][];
}

const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Agents", ids: ["agent-normal", "agent-premium", "rogue"] },
  { title: "Partner companies", ids: ["partner-tripnest", "partner-unlisted", "hedera-probe"] },
];

const ACTORS: { actor: Actor; title: string; sub: string }[] = [
  { actor: "person", title: "People", sub: "World ID, one entry per human" },
  { actor: "agent", title: "Agents", sub: "Need their human's World ID approval" },
  { actor: "partner", title: "Partner companies", sub: "Allowlist + KYC on the seat token" },
];

const isLive = (d: Drop) => (d.status === "open" || d.status === "scheduled") && d.closesAt > Date.now();
const timeLeft = (d: Drop) => {
  const ms = d.closesAt - Date.now();
  if (ms <= 0) return d.status === "results" ? "Results out" : d.status === "revealing" ? "Revealing" : d.status === "drawing" ? "Drawing" : "Closed";
  const m = Math.floor(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}s left`;
};

const remember = (k: string, v?: string) => {
  try {
    if (v === undefined) return localStorage.getItem(k) ?? undefined;
    localStorage.setItem(k, v);
  } catch {
    // a per-viewer convenience only
  }
  return undefined;
};

const card = "rounded-3xl bg-gray-0 shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

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

  // A selected drop that no longer exists (after a reset) falls back to "All drops".
  const drop = drops.find((d) => d.id === selected);
  useEffect(() => {
    if (selected !== "all" && drops.length && !drop) setSelected("all");
  }, [drops.length, drop, selected]);

  // A picked drop: its own history plus the latest decisions for it, without duplicates.
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

  const tally = (list: LiveEvent[]) => ({ ok: list.filter((e) => e.outcome!.ok).length, no: list.filter((e) => !e.outcome!.ok).length });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Compare</h1>
        <p className="mt-1 text-sm text-gray-500">Run agents and companies against a drop and see who gets through.</p>
      </header>

      <DropBar drops={drops} selected={selected} onSelect={setSelected} count={(id) => tally(id === "all" ? outcomes : outcomes.filter((e) => e.drop === id))} />

      <RunPanel drops={drops} selected={drop} scenarios={scenarios} jobs={jobs} />

      <section className={`${card} p-6`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Results</h2>
          <span className="text-sm text-gray-500">{drop ? drop.label : "All drops"}</span>
        </div>
        <div className="mt-5 grid gap-x-8 gap-y-8 xl:grid-cols-3">
          {ACTORS.map((a) => {
            const list = decisions.filter((e) => e.outcome?.actor === a.actor);
            return <ResultColumn key={a.actor} title={a.title} sub={a.sub} events={list} t={tally(list)} drops={drops} showDrop={!drop} />;
          })}
        </div>
      </section>

      <DropLog drop={drop} events={drop ? log : outcomes} />
    </div>
  );
}

// ── Drop bar ───────────────────────────────────────────────────────────────

function DropBar({ drops, selected, onSelect, count }: { drops: Drop[]; selected: string; onSelect: (id: string) => void; count: (id: string) => { ok: number; no: number } }) {
  const item = (id: string, body: ReactNode) => {
    const active = selected === id;
    return (
      <button
        key={id}
        onClick={() => onSelect(id)}
        className={`flex shrink-0 items-center gap-3 rounded-full py-2 pl-4 pr-2 text-sm transition ${active ? "bg-gray-900 text-gray-0" : "bg-gray-0 text-gray-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-gray-100"}`}
      >
        {body}
        <Tally {...count(id)} inverted={active} />
      </button>
    );
  };
  return (
    <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {item("all", <span className="font-semibold">All drops</span>)}
      {drops.map((d) =>
        item(
          d.id,
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span className={`size-2 rounded-full ${isLive(d) ? "bg-success-600" : "bg-gray-300"}`} />
            <span className="font-semibold">{d.label}</span>
            <span className={selected === d.id ? "text-gray-0/60" : "text-gray-500"}>{timeLeft(d)}</span>
          </span>,
        ),
      )}
    </nav>
  );
}

function Tally({ ok, no, inverted = false }: { ok: number; no: number; inverted?: boolean }) {
  return (
    <span className="flex items-center gap-1 text-xs font-semibold tabular">
      <span className={`rounded-full px-2 py-0.5 ${inverted ? "bg-gray-0/15 text-gray-0" : "bg-success-100 text-success-700"}`}>✓ {ok}</span>
      <span className={`rounded-full px-2 py-0.5 ${inverted ? "bg-gray-0/15 text-gray-0" : "bg-error-100 text-error-700"}`}>✕ {no}</span>
    </span>
  );
}

// ── Left: run a test ───────────────────────────────────────────────────────

function RunPanel({ drops, selected, scenarios, jobs }: { drops: Drop[]; selected?: Drop; scenarios: Scenario[]; jobs: Job[] }) {
  const live = drops.filter(isLive);
  const [target, setTarget] = useState<string>(selected && isLive(selected) ? selected.id : live[0]?.id ?? "");
  // Follow the drop bar; fall back to the first open drop when the target closes.
  useEffect(() => {
    if (selected && isLive(selected)) setTarget(selected.id);
  }, [selected?.id]);
  useEffect(() => {
    if (!live.some((d) => d.id === target)) setTarget(live[0]?.id ?? "");
  }, [live.length]);
  const d = live.find((x) => x.id === target);
  const [err, setErr] = useState<string | null>(null);

  async function run(id: string) {
    setErr(null);
    try {
      await admin(`/jobs/${id}`, { method: "POST", body: JSON.stringify({ drop: target }) });
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
      <section className={`${card} p-5`}>
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Run a test</h2>
        <label className="mt-4 block text-xs font-medium text-gray-500" htmlFor="sp-target">
          Target drop
        </label>
        {live.length ? (
          <select id="sp-target" value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1.5 h-11 w-full rounded-2xl border border-gray-200 bg-gray-0 px-3 text-sm font-medium outline-none focus:border-gray-400">
            {live.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label} · {x.pool} · {timeLeft(x)}
              </option>
            ))}
          </select>
        ) : (
          <div className="mt-1.5 rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-500">Every drop has closed. Reseed the drops to run tests.</div>
        )}

        {d && d.pool !== "partner" && (
          <Group title="You">
            <Row
              title={d.pool === "premium" ? "Place a sealed bid" : "Enter the draw"}
              sub="Waiting room · scan with World App"
              action={
                <a href={`${GATEWAY}/_sp/room/${d.id}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-full bg-gray-100 px-4 text-xs font-semibold text-gray-900 hover:bg-gray-200">
                  Open ↗
                </a>
              }
            />
          </Group>
        )}

        {GROUPS.map((g) => (
          <Group key={g.title} title={g.title}>
            {g.ids.map((id) => {
              const s = scenarios.find((x) => x.id === id);
              if (!s) return null;
              const fits = !!d && s.pools.includes(d.pool);
              const busy = jobs.some((j) => j.scenario === id && (j.status === "running" || j.status === "waiting_approval"));
              return (
                <Row
                  key={id}
                  title={s.title}
                  sub={
                    <>
                      {s.who} · <span className={s.expect === "refused" ? "text-error-700" : "text-success-700"}>should be {s.expect === "refused" ? "turned away" : "let through"}</span>
                    </>
                  }
                  dim={!fits}
                  action={
                    fits ? (
                      <button disabled={busy} onClick={() => void run(id)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gray-900 px-4 text-xs font-semibold text-gray-0 transition hover:bg-gray-700 active:scale-[0.98] disabled:bg-gray-200 disabled:text-gray-500">
                        {busy ? <span className="size-3 animate-spin rounded-full border-2 border-gray-500/30 border-t-gray-500" /> : <PlayIcon width={11} height={11} />} {busy ? "Running" : "Run"}
                      </button>
                    ) : (
                      <span className="text-2xs text-gray-400">{s.pools.join(" / ")} drops</span>
                    )
                  }
                />
              );
            })}
          </Group>
        ))}
        {err && <div className="mt-4 rounded-2xl bg-error-100 px-4 py-3 text-sm text-error-700">{err}</div>}
      </section>

      <section className={`${card} flex max-h-[640px] min-w-0 flex-col p-5`}>
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Runs</h2>
        {jobs.length ? (
          <div className="mt-1 flex min-h-0 flex-col divide-y divide-gray-100 overflow-y-auto pr-1">
            {jobs.slice(0, 12).map((j) => (
              <JobRow key={j.id} j={j} />
            ))}
          </div>
        ) : (
          <div className="grid flex-1 place-items-center py-12 text-center text-sm text-gray-400">Press Run on a test. Its steps show here as it goes.</div>
        )}
      </section>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-1 text-2xs font-bold uppercase tracking-[0.08em] text-gray-400">{title}</div>
      <div className="flex flex-col divide-y divide-gray-100">{children}</div>
    </div>
  );
}

function Row({ title, sub, action, dim = false }: { title: string; sub: ReactNode; action: ReactNode; dim?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-2.5 ${dim ? "opacity-50" : ""}`}>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{title}</div>
        <div className="truncate text-xs text-gray-500">{sub}</div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

const JOB_CHIP: Record<Job["status"], string> = {
  running: "bg-warning-100 text-warning-700",
  waiting_approval: "bg-info-100 text-info-700",
  done: "bg-success-100 text-success-700",
  blocked: "bg-error-100 text-error-700",
  failed: "bg-warning-100 text-warning-700",
};

function JobRow({ j }: { j: Job }) {
  const active = j.status === "running" || j.status === "waiting_approval";
  const [open, setOpen] = useState(active);
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const label =
    j.status === "waiting_approval" ? "Needs World ID" : j.status === "running" ? "Running" : j.status === "done" ? "✓ Let through" : j.status === "blocked" ? "✕ Blocked" : j.expect === "refused" ? "⚠ Not blocked" : "⚠ Didn't get through";
  return (
    <div className="py-3">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{j.title}</span>
          <span className="block truncate text-xs text-gray-500">
            {j.who} · {j.dropLabel} · {ago(Date.now() - j.startedAt)} ago
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-2xs font-bold ${JOB_CHIP[j.status]}`}>{label}</span>
      </button>

      {j.status === "waiting_approval" && j.approvalUrl && (
        <a href={j.approvalUrl} target="_blank" rel="noreferrer" className="mt-3 flex h-11 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-gray-0 hover:bg-gray-700">
          Approve with World ID ↗
        </a>
      )}

      {open && (
        <>
          <ol className="mt-3 flex flex-col gap-2">
            {j.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs">
                <StepMark s={s.status} n={i + 1} />
                <span className={s.status === "pending" ? "text-gray-400" : "text-gray-900"}>
                  {s.label}
                  {s.status === "refused" && <span className="text-error-700"> · refused, as expected</span>}
                  {s.status === "failed" && <span className="text-warning-700"> · not what should happen</span>}
                </span>
              </li>
            ))}
          </ol>
          <button onClick={() => setRaw(!raw)} className="mt-2.5 text-2xs font-semibold text-gray-500 hover:text-gray-900">
            {raw ? "Hide raw output" : "Raw output"}
          </button>
          {raw && (
            <pre className="mt-2 max-h-64 overflow-auto rounded-2xl bg-gray-900 p-3 font-mono text-[10px] leading-snug text-gray-0">
              {j.steps.map((s) => (s.out ? `▸ ${s.label}\n${s.out}\n\n` : "")).join("") || "No output yet"}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function StepMark({ s, n }: { s: Job["steps"][number]["status"]; n: number }) {
  const cls = {
    ok: "bg-success-600 text-gray-0",
    refused: "bg-error-600 text-gray-0",
    failed: "bg-warning-600 text-gray-0",
    running: "bg-gray-900 text-gray-0",
    pending: "bg-gray-100 text-gray-500",
  }[s];
  return (
    <span className={`mt-px grid size-[18px] shrink-0 place-items-center rounded-full text-[10px] font-bold ${cls}`}>
      {s === "ok" ? "✓" : s === "refused" ? "✕" : s === "failed" ? "!" : s === "running" ? <span className="size-2.5 animate-spin rounded-full border-2 border-gray-0/30 border-t-gray-0" /> : n}
    </span>
  );
}

// ── Right: results ─────────────────────────────────────────────────────────

function ResultColumn({ title, sub, events, t, drops, showDrop }: { title: string; sub: string; events: LiveEvent[]; t: { ok: number; no: number }; drops: Drop[]; showDrop: boolean }) {
  const [only, setOnly] = useState<"all" | "ok" | "no">("all");
  const shown = events.filter((e) => only === "all" || (only === "ok") === e.outcome!.ok);
  const label = (id?: string) => drops.find((d) => d.id === id)?.label;
  const tab = (v: "ok" | "no", body: string, cls: string) => (
    <button onClick={() => setOnly(only === v ? "all" : v)} title={only === v ? "Show all" : `Show only ${v === "ok" ? "let through" : "turned away"}`} className={`rounded-full px-2 py-0.5 transition ${only === v ? "ring-2 ring-gray-900/70" : ""} ${cls}`}>
      {body}
    </button>
  );
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          <div className="truncate text-xs text-gray-500">{sub}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular">
          {tab("ok", `✓ ${t.ok}`, "bg-success-100 text-success-700")}
          {tab("no", `✕ ${t.no}`, "bg-error-100 text-error-700")}
        </div>
      </div>
      <div className="max-h-[440px] overflow-y-auto">
        {shown.length === 0 && <div className="py-10 text-center text-sm text-gray-400">Nothing yet</div>}
        {shown.map((e, i) => {
          const ok = e.outcome!.ok;
          const link = hashscanTx(e.txId);
          return (
            <div key={`${e.ts}-${i}`} className="flex gap-3 border-b border-gray-50 py-3 last:border-0">
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${ok ? "bg-success-100 text-success-700" : "bg-error-100 text-error-700"}`}>{ok ? "✓" : "✕"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-mono text-xs font-semibold text-gray-900">{e.outcome!.who}</span>
                  <span className="shrink-0 text-2xs text-gray-400">{ago(Date.now() - e.ts)}</span>
                </div>
                <div className="mt-0.5 text-sm leading-snug text-gray-700 [overflow-wrap:anywhere]">{e.outcome!.action}</div>
                {(link || (showDrop && label(e.drop))) && (
                  <div className="mt-1 flex items-center gap-3 text-2xs text-gray-500">
                    {showDrop && label(e.drop) && <span className="truncate">{label(e.drop)}</span>}
                    {link && (
                      <a href={link} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-info-600 hover:underline">
                        View on Hedera ↗
                      </a>
                    )}
                  </div>
                )}
              </div>
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
          <h2 className="text-lg font-semibold tracking-[-0.01em]">{drop ? "Full log" : "Latest decisions"}</h2>
          <p className="text-xs text-gray-500">{drop ? `Everything that happened to ${drop.label}, kept across reloads. Bot traffic left out.` : "Pick a drop above for its complete history."}</p>
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
      <LogPanel title={`${shown.length} line${shown.length === 1 ? "" : "s"}`} events={shown} traces inlineMax={300} className="h-[560px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]" />
    </section>
  );
}
