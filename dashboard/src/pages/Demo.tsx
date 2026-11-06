import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { admin, type Drop } from "../lib/api";
import { useLive, useTick, type Backend, type Stats } from "../lib/live";
import { LineChart } from "../ui/charts";
import { inr, LogStream } from "../ui/console";

// Projector view: same flood, two identical sites. Left is hit directly, right is behind SurgePass.

export function Demo() {
  const live = useLive();
  useTick(500);
  const last = live.stats.at(-1);
  const [drop, setDrop] = useState<Drop | null>(null);
  useEffect(() => {
    void admin<{ drops: Drop[] }>("/drops").then((r) => setDrop(r.drops.find((d) => d.pool === "normal" && d.status !== "results") ?? r.drops[0] ?? null));
  }, [last?.drops.map((d) => d.status).join()]);
  const times = live.stats.map((s) => s.ts);
  const t = last?.totals ?? {};
  const price = Math.max(0, ...Object.values(last?.prices ?? {}));
  const drawMsg = [...live.other].reverse().find((m) => m.type === "draw" && m.drop === drop?.id);
  const [takeover, setTakeover] = useState<any>(null);
  useEffect(() => {
    if (drawMsg?.phase === "result") {
      setTakeover(drawMsg);
      const tm = setTimeout(() => setTakeover(null), 9000);
      return () => clearTimeout(tm);
    }
  }, [drawMsg?.phase, drawMsg?.ts]);

  return (
    <div className="flex h-screen flex-col gap-4 bg-gray-50 p-5">
      <div className="grid flex-[1.1] grid-cols-2 gap-4">
        <Side title="Without SurgePass" sub="QuickBook B · hit directly" b={last?.backends.direct} stats={live.stats} pick={(s) => s.backends.direct} times={times} />
        <Side title="With SurgePass" sub="QuickBook A · behind the gate" b={last?.backends.upstream} stats={live.stats} pick={(s) => s.backends.upstream} times={times} protectedSide />
      </div>

      <div className="grid grid-cols-6 gap-4">
        <Big label="Requests / s at the gate" value={(last?.perSecond.requests ?? 0).toLocaleString("en-IN")} />
        <Big label="Gateway CPU" value={`${last?.gateway.cpu ?? 0}%`} />
        <Big label="Kept off backend" value={(((t.waitingRoom ?? 0) + (t.challenged402 ?? 0)) as number).toLocaleString("en-IN")} />
        <Big label="Paid reads" value={(t.paid ?? 0).toLocaleString("en-IN")} sub={inr(last?.revenueInr ?? 0, 2)} />
        <Big label="Surge price" value={price ? inr(price, 2) : "—"} tone={price > 1 ? "warning" : undefined} />
        <Big label={drop ? `${drop.label.split("·")[0]}· closes in` : "Window"} value={drop && drop.status === "open" ? clock(drop.closesAt - Date.now()) : drop?.status ?? "—"} />
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-4">
        <div className="flex gap-6 rounded-2xl bg-gray-0 px-5 py-3 text-sm">
          <span>
            <span className="mr-1.5 inline-block size-2 rounded-full bg-success-600" /> Humans <b className="tabular">{t.entriesHuman ?? 0}</b>
          </span>
          <span>
            <span className="mr-1.5 inline-block size-2 rounded-full bg-purple" /> Agents <b className="tabular">{t.entriesAgent ?? 0}</b>
          </span>
          <span>
            <span className="mr-1.5 inline-block size-2 rounded-full bg-error-600" /> Rejected <b className="tabular">{(t.rejectedEntries ?? 0) + (t.waitingRoom ?? 0)}</b>
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[3fr_2fr] gap-4">
        <div className="min-h-0 overflow-hidden rounded-2xl bg-gray-0 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Live log</div>
          <div className="h-full overflow-hidden">
            <LogStream events={live.events} max={14} dense />
          </div>
        </div>
        <div className="min-h-0 overflow-hidden rounded-2xl bg-gray-0 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Hedera</div>
          <LogStream events={live.events.filter((e) => e.hcsSeq || e.txId || e.kind === "draw")} max={12} dense />
        </div>
      </div>

      <AnimatePresence>
        {takeover && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-gray-0/95 backdrop-blur">
            <div className="text-center">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">Draw · {drop?.label}</div>
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2 }} className="mt-4 font-mono text-4xl">
                seed 0x{String(takeover.seed).slice(0, 24)}…
              </motion.div>
              <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8 }} className="mt-8 text-8xl font-semibold tracking-[-0.03em]">
                {takeover.winners?.length ?? 0} winners
              </motion.div>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }} className="mt-4 text-2xl text-gray-500">
                {(takeover.order?.length ?? 0).toLocaleString("en-IN")} verified entries · Fisher–Yates · {takeover.waitlist?.length ?? 0} on the waitlist
              </motion.div>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }} className="mx-auto mt-10 grid max-w-3xl grid-cols-5 gap-2">
                {(takeover.winners ?? []).slice(0, 15).map((w: any, i: number) => (
                  <motion.div key={w.anonId} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 2 + i * 0.08 }} className="rounded-xl bg-success-100 px-2 py-2 text-xs font-semibold text-success-700">
                    human·{w.anonId.slice(2, 6)} · {w.seats < w.requested ? `${w.seats}/${w.requested}` : w.seats}
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Side({ title, sub, b, stats, pick, times, protectedSide }: { title: string; sub: string; b?: Backend; stats: Stats[]; pick: (s: Stats) => Backend; times: number[]; protectedSide?: boolean }) {
  const failing = !b?.reachable || b.crashed || b.errorRate > 0.3;
  return (
    <div className={`flex flex-col rounded-3xl p-5 transition-colors duration-500 ${failing ? "bg-error-100" : "bg-gray-0"}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-2xl font-semibold tracking-[-0.01em]">{title}</div>
          <div className="text-sm text-gray-500">{sub}</div>
        </div>
        <motion.span
          key={String(failing)}
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          className={`inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold ${failing ? "bg-error-600 text-gray-0" : "bg-success-100 text-success-700"}`}
        >
          {failing ? (b?.crashed ? "● CRASHED" : "● FAILING") : "● Healthy"}
        </motion.span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <Metric label="p95 latency" value={`${b?.p95Ms ?? 0} ms`} bad={(b?.p95Ms ?? 0) > 800} />
        <Metric label="errors (503)" value={`${Math.round((b?.errorRate ?? 0) * 100)}%`} bad={(b?.errorRate ?? 0) > 0.05} />
        <Metric label="load" value={`${Math.round((b?.load ?? 0) * 100)}%`} bad={(b?.load ?? 0) > 0.8} />
      </div>
      <div className="mt-auto pt-3">
        <LineChart
          series={[{ name: protectedSide ? "Errors · behind SurgePass" : "Errors · direct", color: protectedSide ? "var(--series-1)" : "var(--series-2)", values: stats.map((s) => Math.round(pick(s).errorRate * 100)) }]}
          times={times}
          height={150}
          max={100}
          format={(v) => `${Math.round(v)}%`}
        />
      </div>
    </div>
  );
}

function Metric({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-4xl font-semibold tabular tracking-[-0.02em] ${bad ? "text-error-600" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}

function Big({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warning" }) {
  return (
    <div className="rounded-2xl bg-gray-0 px-4 py-3">
      <div className="truncate text-xs text-gray-500">{label}</div>
      <div className={`text-3xl font-semibold tabular tracking-[-0.01em] ${tone === "warning" ? "text-warning-700" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
