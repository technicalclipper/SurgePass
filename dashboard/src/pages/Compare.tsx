import { useEffect, useMemo, useState } from "react";
import { admin, GATEWAY, hashscanTx, type Drop } from "../lib/api";
import type { LiveEvent } from "../lib/live";
import { ago, Segmented } from "../ui/console";

interface Job {
  id: string;
  scenario: string;
  title: string;
  who: string;
  status: "running" | "waiting_approval" | "done" | "failed";
  steps: { label: string; status: "pending" | "running" | "ok" | "failed"; out?: string }[];
  approvalUrl?: string;
  startedAt: number;
}

/** Scenario buttons per column. People are you, in the waiting room with your World App. */
const ACTIONS: Record<Actor, string[]> = { person: [], agent: ["agent-normal", "agent-premium", "rogue"], partner: ["partner-tripnest", "partner-unlisted", "hedera-probe"] };
const actorOf = (scenario: string): Actor => (scenario.startsWith("partner") || scenario.startsWith("hedera") ? "partner" : "agent");

// Side by side: who the gate let through and who it turned away, for people (World ID),
// agents (human approval) and partner companies (allowlist + Hedera KYC).

type Actor = "person" | "agent" | "partner";
type PoolFilter = "all" | Drop["pool"];

const COLUMNS: { actor: Actor; title: string; sub: string; ok: string; no: string }[] = [
  { actor: "person", title: "People", sub: "World ID, one entry per human", ok: "Verified", no: "Not verified" },
  { actor: "agent", title: "Agents", sub: "Only with their human's World ID approval", ok: "Approved", no: "Refused" },
  { actor: "partner", title: "Partner companies", sub: "Allowlisted + KYC on the Hedera seat token", ok: "Allowlisted", no: "Not allowed" },
];

export function Compare() {
  const [rows, setRows] = useState<LiveEvent[]>([]);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [pool, setPool] = useState<PoolFilter>("all");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scenarios, setScenarios] = useState<{ id: string; title: string; who: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const loadJobs = () =>
    void admin<{ jobs: Job[]; scenarios: { id: string; title: string; who: string }[] }>("/jobs").then(
      (r) => {
        setJobs(r.jobs);
        setScenarios(r.scenarios);
      },
      () => {},
    );
  async function start(id: string) {
    setErr(null);
    try {
      await admin(`/jobs/${id}`, { method: "POST" });
    } catch (e: any) {
      setErr(e.message);
    }
    loadJobs();
  }

  useEffect(() => {
    let stop = false;
    const load = () =>
      void admin<{ outcomes: LiveEvent[] }>("/outcomes").then(
        (r) => !stop && setRows(r.outcomes),
        () => {},
      );
    load();
    loadJobs();
    void admin<{ drops: Drop[] }>("/drops").then((r) => setDrops(r.drops));
    const t = setInterval(() => {
      load();
      loadJobs();
    }, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const byId = useMemo(() => new Map(drops.map((d) => [d.id, d])), [drops]);
  const shown = rows.filter((e) => pool === "all" || byId.get(e.drop ?? "")?.pool === pool);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.01em]">Compare</h1>
          <p className="mt-1 text-sm text-gray-500">Everyone who tried to get a seat, side by side: who the gate let through and who it turned away.</p>
        </div>
        <Segmented
          value={pool}
          onChange={setPool}
          options={[
            { value: "all", label: "All drops" },
            { value: "normal", label: "Normal" },
            { value: "premium", label: "Premium" },
            { value: "partner", label: "Partner" },
          ]}
        />
      </div>
      {err && <div className="rounded-xl bg-error-100 px-4 py-3 text-sm text-error-700">{err}</div>}
      <div className="grid gap-5 xl:grid-cols-3">
        {COLUMNS.map((col) => {
          const mine = shown.filter((e) => e.outcome?.actor === col.actor);
          return (
            <section key={col.actor} className="flex min-w-0 flex-col rounded-2xl bg-gray-0 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="text-lg font-semibold">{col.title}</div>
              <div className="text-xs text-gray-500">{col.sub}</div>
              {col.actor === "person" ? (
                <PeopleLinks drops={drops} />
              ) : (
                <div className="mt-4 flex flex-col gap-2">
                  {ACTIONS[col.actor].map((id) => {
                    const s = scenarios.find((x) => x.id === id);
                    const busy = jobs.some((j) => j.scenario === id && (j.status === "running" || j.status === "waiting_approval"));
                    return s ? (
                      <button key={id} disabled={busy} onClick={() => void start(id)} className="flex items-center justify-between gap-3 rounded-xl bg-gray-900 px-4 py-2.5 text-left text-gray-0 transition hover:bg-gray-700 disabled:bg-gray-300">
                        <span>
                          <span className="block text-sm font-semibold">{s.title}</span>
                          <span className="block text-2xs text-gray-0/70">{s.who}</span>
                        </span>
                        <span className="text-xs font-semibold">{busy ? "Running…" : "Run ▶"}</span>
                      </button>
                    ) : null;
                  })}
                  {jobs
                    .filter((j) => actorOf(j.scenario) === col.actor)
                    .slice(0, 3)
                    .map((j) => (
                      <JobCard key={j.id} j={j} />
                    ))}
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Lane title={col.ok} ok events={mine.filter((e) => e.outcome!.ok)} byId={byId} />
                <Lane title={col.no} ok={false} events={mine.filter((e) => !e.outcome!.ok)} byId={byId} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Lane({ title, ok, events, byId }: { title: string; ok: boolean; events: LiveEvent[]; byId: Map<string, Drop> }) {
  return (
    <div className={`flex min-w-0 flex-col rounded-xl p-3 ${ok ? "bg-success-100/50" : "bg-error-100/50"}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-xs font-bold uppercase tracking-wide ${ok ? "text-success-700" : "text-error-700"}`}>
          {ok ? "✓" : "✕"} {title}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ok ? "bg-success-600 text-gray-0" : "bg-error-600 text-gray-0"}`}>{events.length}</span>
      </div>
      <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto">
        {events.length === 0 && <div className="py-6 text-center text-xs text-gray-400">Nothing yet</div>}
        {events.map((e, i) => {
          const d = byId.get(e.drop ?? "");
          const link = hashscanTx(e.txId);
          return (
            <div key={`${e.ts}-${i}`} className="rounded-lg bg-gray-0 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs font-semibold text-gray-900">{e.outcome!.who}</span>
                <span className="shrink-0 text-2xs text-gray-400">{ago(Date.now() - e.ts)} ago</span>
              </div>
              <div className="mt-0.5 text-xs text-gray-700">{e.outcome!.action}</div>
              <div className="mt-1 flex items-center gap-2 text-2xs text-gray-500">
                {d && <span className="rounded bg-gray-100 px-1.5 py-0.5 font-semibold uppercase">{d.pool}</span>}
                {d && <span className="truncate">{d.label}</span>}
                {link && (
                  <a href={link} target="_blank" rel="noreferrer" className="ml-auto shrink-0 font-semibold text-info-600">
                    Hedera ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JobCard({ j }: { j: Job }) {
  const [open, setOpen] = useState(false);
  const tone = j.status === "done" ? "border-success-600/40" : j.status === "failed" ? "border-error-600/40" : "border-gray-200";
  return (
    <div className={`rounded-xl border bg-gray-0 p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">
          {j.title} · {j.who}
        </span>
        <span className={`text-2xs font-bold uppercase ${j.status === "done" ? "text-success-700" : j.status === "failed" ? "text-error-700" : "text-warning-700"}`}>
          {j.status === "waiting_approval" ? "needs your World ID" : j.status}
        </span>
      </div>
      {j.status === "waiting_approval" && j.approvalUrl && (
        <a href={j.approvalUrl} target="_blank" rel="noreferrer" className="mt-2 block rounded-lg bg-info-600 px-3 py-2 text-center text-sm font-semibold text-gray-0 hover:opacity-90">
          Open approval page · scan with World App ↗
        </a>
      )}
      <ol className="mt-2 flex flex-col gap-1">
        {j.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className={`mt-px grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold ${s.status === "ok" ? "bg-success-600 text-gray-0" : s.status === "failed" ? "bg-error-600 text-gray-0" : s.status === "running" ? "bg-gray-900 text-gray-0" : "bg-gray-100 text-gray-500"}`}>
              {s.status === "ok" ? "✓" : s.status === "failed" ? "✕" : s.status === "running" ? "…" : i + 1}
            </span>
            <span className={s.status === "pending" ? "text-gray-500" : "text-gray-900"}>{s.label}</span>
          </li>
        ))}
      </ol>
      <button onClick={() => setOpen(!open)} className="mt-2 text-2xs font-semibold text-info-600">
        {open ? "Hide output" : "Show output"}
      </button>
      {open && (
        <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-gray-900 p-2 font-mono text-[10px] leading-snug text-gray-0">
          {j.steps.map((s) => (s.out ? `▸ ${s.label}\n${s.out}\n\n` : "")).join("")}
        </pre>
      )}
    </div>
  );
}

/** People are real: you open the waiting room and scan with your World App. */
function PeopleLinks({ drops }: { drops: Drop[] }) {
  const open = drops.filter((d) => (d.status === "open" || d.status === "scheduled") && d.pool !== "partner");
  return (
    <div className="mt-4 flex flex-col gap-2">
      {open.map((d) => (
        <a key={d.id} href={`${GATEWAY}/_sp/room/${d.id}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl bg-gray-100 px-4 py-2.5 hover:bg-gray-200">
          <span>
            <span className="block text-sm font-semibold">{d.pool === "premium" ? "Sealed bid" : "Enter the draw"} · {d.label}</span>
            <span className="block text-2xs text-gray-500">Open the waiting room, scan with World App</span>
          </span>
          <span className="text-xs font-semibold text-info-600">Open ↗</span>
        </a>
      ))}
      {!open.length && <div className="text-xs text-gray-400">No open drops</div>}
    </div>
  );
}
