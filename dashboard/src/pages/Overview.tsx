import { useEffect, useState } from "react";
import { admin, GATEWAY, type Drop } from "../lib/api";
import { useLive, type Stats } from "../lib/live";
import { LineChart, Legend, StackedArea, Spark, type Series } from "../ui/charts";
import { inr, Kpi, LogStream, Panel, Pill } from "../ui/console";

export const SERIES = {
  forwarded: { name: "Forwarded", color: "var(--series-1)" },
  waitingRoom: { name: "Waiting room", color: "var(--series-2)" },
  challenged402: { name: "402 challenged", color: "var(--series-3)" },
  paid: { name: "Paid reads", color: "var(--series-4)" },
};

export function trafficSeries(stats: Stats[]): Series[] {
  return (Object.keys(SERIES) as (keyof typeof SERIES)[]).map((k) => ({ ...SERIES[k], values: stats.map((s) => s.perSecond[k] ?? 0) }));
}

export function Overview() {
  const live = useLive();
  const last = live.stats.at(-1);
  const t = last?.totals ?? {};
  const blockedPct = t.requests ? Math.round(((t.waitingRoom ?? 0) + (t.challenged402 ?? 0)) / t.requests * 1000) / 10 : 0;
  const [drops, setDrops] = useState<Drop[]>([]);
  useEffect(() => {
    void admin<{ drops: Drop[] }>("/drops").then((r) => setDrops(r.drops));
  }, [last?.drops.map((d) => d.status).join()]);
  const times = live.stats.map((s) => s.ts);
  const traffic = trafficSeries(live.stats);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Overview</h1>
        <p className="mt-1 text-sm text-gray-500">
          Fronting <span className="font-mono">{new URL(GATEWAY).host}</span> · upstream health, gated drops and every decision the gate makes.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Kpi label="Requests / s" value={(last?.perSecond.requests ?? 0).toLocaleString("en-IN")} sub={<Spark values={live.stats.map((s) => s.perSecond.requests ?? 0)} />} />
        <Kpi label="Kept off backend" value={`${blockedPct}%`} sub="waiting room + 402" />
        <Kpi label="Paid reads" value={(t.paid ?? 0).toLocaleString("en-IN")} sub={inr(last?.revenueInr ?? 0, 2) + " surge revenue"} />
        <Kpi label="Human entries" value={(t.entriesHuman ?? 0).toLocaleString("en-IN")} tone="success" />
        <Kpi label="Agent entries" value={(t.entriesAgent ?? 0).toLocaleString("en-IN")} />
        <Kpi label="Rejected entries" value={(t.rejectedEntries ?? 0).toLocaleString("en-IN")} tone="error" sub="no human / duplicate" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Panel title="Traffic at the gate · per second" right={<Legend series={traffic} format={(v) => Math.round(v).toLocaleString("en-IN")} />}>
          <StackedArea series={traffic} times={times} />
        </Panel>
        <Panel title="Backends">
          <BackendRow name="Provider A · behind SurgePass" b={last?.backends.upstream} />
          <div className="my-4 h-px bg-gray-100" />
          <BackendRow name="Provider B · direct (baseline)" b={last?.backends.direct} />
          <div className="my-4 h-px bg-gray-100" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Gateway CPU</span>
            <span className="font-semibold tabular">{last?.gateway.cpu ?? 0}%</span>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel title="Gated drops">
          <div className="flex flex-col divide-y divide-gray-100">
            {drops.map((d) => (
              <div key={d.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{d.label}</div>
                  <div className="font-mono text-2xs text-gray-500">{d.pattern}</div>
                </div>
                <div className="flex items-center gap-2">
                  {d.peakOn ? <Pill kind="peak">● peak</Pill> : <Pill kind="passthrough">passthrough</Pill>}
                  <Pill kind={d.status}>{d.status}</Pill>
                </div>
              </div>
            ))}
            {drops.length === 0 && <div className="py-6 text-center text-sm text-gray-400">No drops</div>}
          </div>
        </Panel>
        <Panel title="Live decisions">
          <div className="max-h-72 overflow-y-auto">
            <LogStream events={live.events} max={40} dense />
          </div>
        </Panel>
      </div>

      <Panel title="Backend p95 latency (ms)" right={<Legend series={latency(live.stats)} format={(v) => `${Math.round(v)} ms`} />}>
        <LineChart series={latency(live.stats)} times={times} format={(v) => `${Math.round(v)}`} />
      </Panel>
    </div>
  );
}

export const latency = (stats: Stats[]): Series[] => [
  { name: "A · behind SurgePass", color: "var(--series-1)", values: stats.map((s) => s.backends.upstream.p95Ms) },
  { name: "B · direct", color: "var(--series-2)", values: stats.map((s) => s.backends.direct.p95Ms) },
];

function BackendRow({ name, b }: { name: string; b?: Stats["backends"]["upstream"] }) {
  const state = !b?.reachable ? "crashed" : b.crashed || b.errorRate > 0.3 ? "crashed" : "healthy";
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{name}</span>
        <Pill kind={state}>{!b?.reachable ? "unreachable" : state === "crashed" ? "● failing" : "● healthy"}</Pill>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-gray-500">req/s</div>
          <div className="text-base font-semibold tabular">{b?.rps ?? 0}</div>
        </div>
        <div>
          <div className="text-gray-500">p95</div>
          <div className="text-base font-semibold tabular">{b?.p95Ms ?? 0} ms</div>
        </div>
        <div>
          <div className="text-gray-500">errors</div>
          <div className="text-base font-semibold tabular">{Math.round((b?.errorRate ?? 0) * 100)}%</div>
        </div>
      </div>
    </div>
  );
}
