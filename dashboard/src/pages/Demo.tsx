import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { admin, type Drop } from "../lib/api";
import { useLive, useTick, type Backend, type Stats } from "../lib/live";
import { LineChart } from "../ui/charts";
import { inr, LogStream } from "../ui/console";
import { FloodControl } from "../ui/flood";
import { LogPanel } from "../ui/logpanel";

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
  // Real people and their agents: World ID verified, entered, won, booked with a pass. Pinned so a bot flood can't scroll them away.
  const people = live.people;
  // Full-screen "With SurgePass": people and bot decisions together, in time order.
  const gateAll = [...new Map([...live.people, ...live.events.filter((e) => e.side !== "direct" && (e.trace || e.kind === "human" || e.kind === "agent" || e.kind === "pass"))].map((e) => [e._id ?? `${e.ts}${e.note}`, e])).values()].sort((a, b) => a.ts - b.ts);
  // Hedera activity: from both buffers, so a flood can't hide it.
  const hedera = [...new Map([...live.people, ...live.events].filter((e) => e.hcsSeq || e.txId || e.kind === "draw").map((e) => [e._id ?? `${e.ts}${e.note}`, e])).values()].sort((a, b) => a.ts - b.ts);
  const price = Math.max(0, ...Object.values(last?.prices ?? {}));

  return (
    <div className="flex h-screen flex-col gap-4 bg-gray-50 p-5">
      <div className="flex items-center justify-between gap-4">
        <a href="#overview" className="text-sm font-semibold text-gray-500 hover:text-gray-900">
          ← SurgePass console
        </a>
        <FloodControl />
      </div>
      <div className="grid grid-cols-2 gap-4">
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

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.25fr_0.75fr] gap-4">
        <LogPanel title="Without SurgePass · what bots get from QuickBook B" tone="error" events={live.events.filter((e) => e.side === "direct")} />
        <LogPanel
          title="With SurgePass · what the gate does"
          tone="success"
          traces
          events={live.events.filter((e) => e.side !== "direct" && e.trace && e.kind !== "human" && e.kind !== "agent")}
          modalEvents={gateAll}
        >
          {people.length > 0 && (
            <div className="mb-3 rounded-xl bg-success-100/50 p-2">
              <div className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-success-700">People & agents · World ID, entries, passes (pinned)</div>
              <LogStream events={people} max={2} dense traces />
            </div>
          )}
        </LogPanel>
        <LogPanel title="Hedera" events={hedera} />
      </div>

    </div>
  );
}

function Side({ title, sub, b, stats, pick, times, protectedSide }: { title: string; sub: string; b?: Backend; stats: Stats[]; pick: (s: Stats) => Backend; times: number[]; protectedSide?: boolean }) {
  const failing = !b?.reachable || b.crashed || b.errorRate > 0.3;
  return (
    <div className={`flex flex-col rounded-3xl px-5 py-4 transition-colors duration-500 ${failing ? "bg-error-100" : "bg-gray-0"}`}>
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
      <div className="mt-2 grid grid-cols-3 gap-4">
        <Metric label="errors (503)" value={`${Math.round((b?.errorRate ?? 0) * 100)}%`} bad={(b?.errorRate ?? 0) > 0.05} />
        <Metric label="p95 latency" value={`${b?.p95Ms ?? 0} ms`} bad={(b?.p95Ms ?? 0) > 800} />
        <Metric label={protectedSide ? "bookings (pass holders)" : "seats grabbed by bots"} value={String(b?.bookings ?? 0)} bad={!protectedSide && (b?.bookings ?? 0) > 0} />
      </div>
      <div className="mt-auto pt-1">
        <LineChart
          series={[{ name: protectedSide ? "Errors · behind SurgePass" : "Errors · direct", color: protectedSide ? "var(--series-1)" : "var(--series-2)", values: stats.map((s) => Math.round(pick(s).errorRate * 100)) }]}
          times={times}
          height={70}
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
      <div className={`text-3xl font-semibold tabular tracking-[-0.02em] ${bad ? "text-error-600" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}

function Big({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warning" }) {
  return (
    <div className="rounded-2xl bg-gray-0 px-4 py-2">
      <div className="truncate text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold tabular tracking-[-0.01em] ${tone === "warning" ? "text-warning-700" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
