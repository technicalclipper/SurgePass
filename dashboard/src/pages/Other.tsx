import { useEffect, useMemo, useState } from "react";
import { admin, GATEWAY, hashscanTopic, hashscanTx, type Drop } from "../lib/api";
import { useLive } from "../lib/live";
import { LineChart, Legend, StackedArea } from "../ui/charts";
import { Field, inputCls, inr, Panel, Pill } from "../ui/console";
import { LogPanel, mergedEvents } from "../ui/logpanel";
import { latency, trafficSeries } from "./Overview";

export function Traffic() {
  const live = useLive();
  const times = live.stats.map((s) => s.ts);
  const traffic = trafficSeries(live.stats);
  const priceSeries = useMemo(() => {
    const ids = [...new Set(live.stats.flatMap((s) => Object.keys(s.prices ?? {})))].slice(0, 2);
    return ids.map((id, i) => ({ name: id.slice(0, 22), color: i ? "var(--series-2)" : "var(--series-1)", values: live.stats.map((s) => s.prices?.[id] ?? 0) }));
  }, [live.stats]);
  const errors = [
    { name: "A · behind SurgePass", color: "var(--series-1)", values: live.stats.map((s) => s.backends.upstream.errorRate * 100) },
    { name: "B · direct", color: "var(--series-2)", values: live.stats.map((s) => s.backends.direct.errorRate * 100) },
  ];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-[-0.01em]">Traffic</h1>
      <Panel title="Requests at the gate · per second" right={<Legend series={traffic} format={(v) => Math.round(v).toLocaleString("en-IN")} />}>
        <StackedArea series={traffic} times={times} height={220} />
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Backend p95 latency (ms)" right={<Legend series={latency(live.stats)} format={(v) => `${Math.round(v)}`} />}>
          <LineChart series={latency(live.stats)} times={times} />
        </Panel>
        <Panel title="Backend error rate (%)" right={<Legend series={errors} format={(v) => `${Math.round(v)}%`} />}>
          <LineChart series={errors} times={times} max={100} format={(v) => `${Math.round(v)}`} />
        </Panel>
        <Panel title="Surge price per paid read (₹)" right={priceSeries.length ? <Legend series={priceSeries} format={(v) => inr(v, 2)} /> : null}>
          {priceSeries.length ? <LineChart series={priceSeries} times={times} format={(v) => v.toFixed(2)} /> : <div className="py-10 text-center text-sm text-gray-400">No paid reads yet</div>}
        </Panel>
        <Panel title="Gateway CPU (%)">
          <LineChart series={[{ name: "Gateway CPU", color: "var(--series-1)", values: live.stats.map((s) => s.gateway.cpu) }]} times={times} max={100} />
        </Panel>
      </div>
      <LogPanel title="Decision log" events={mergedEvents(live.people, live.events)} traces inlineMax={200} className="h-[560px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]" />
    </div>
  );
}

export function Routes() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [test, setTest] = useState(`${GATEWAY}/tatkal/book/12007/2026-11-06/CC?quota=PT`);
  const [res, setRes] = useState<any>(null);
  useEffect(() => {
    void admin<{ drops: Drop[] }>("/drops").then((r) => setDrops(r.drops));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void admin<any>("/test-url", { method: "POST", body: JSON.stringify({ url: test }) }).then(setRes, () => setRes(null)), 150);
    return () => clearTimeout(t);
  }, [test]);
  const rows = drops.flatMap((d) => [
    { kind: "booking", pattern: d.pattern, d },
    ...d.readPatterns.map((p) => ({ kind: "read", pattern: p, d })),
    { kind: "final", pattern: `${d.finalStepMethod} ${d.finalStepPattern}`, d },
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Routes</h1>
        <p className="mt-1 text-sm text-gray-500">Only requests matching a drop's route and values are gated, and only during its peak. Everything else passes straight through.</p>
      </div>
      <Panel title="Test a URL">
        <Field label="Any URL on your domain">
          <input value={test} onChange={(e) => setTest(e.target.value)} className={`${inputCls} font-mono text-xs`} />
        </Field>
        {res && (
          <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${res.match ? "bg-success-100 text-success-700" : "bg-gray-100 text-gray-700"}`}>
            {res.match ? (
              <>
                Matches <b>{res.label}</b> · {res.kind} route · {res.pool} · peak {res.peakOn ? "on → gated" : "off → passes through"}
              </>
            ) : (
              "No drop matches · passes through to the provider untouched"
            )}
          </div>
        )}
      </Panel>
      <Panel title="Gated routes">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="pb-3 font-medium">Kind</th>
              <th className="pb-3 font-medium">Pattern</th>
              <th className="pb-3 font-medium">Values & conditions</th>
              <th className="pb-3 font-medium">Drop</th>
              <th className="pb-3 font-medium">At peak</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-2.5">
                  <Pill kind={r.kind === "read" ? "revealing" : r.kind === "final" ? "results" : "scheduled"}>{r.kind}</Pill>
                </td>
                <td className="py-2.5 font-mono text-xs">{r.pattern}</td>
                <td className="py-2.5 font-mono text-2xs text-gray-500">
                  {Object.entries(r.d.values).map(([k, v]) => `${k}=${v}`).join(" ")} {r.d.conditions.map((c) => `${c.location}.${c.key} ${c.operator} ${c.value}`).join(" ")}
                </td>
                <td className="py-2.5 text-xs">{r.d.label}</td>
                <td className="py-2.5 text-xs text-gray-700">{r.kind === "read" ? `free ${r.d.readPricing.freePerWindow}/${r.d.readPricing.windowSec}s, then x402 ${inr(r.d.readPricing.minInr, 2)}–${inr(r.d.readPricing.maxInr)}` : r.kind === "final" ? "marks pass used, releases seats" : "pass required"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

export function Proofs() {
  const live = useLive();
  const [drops, setDrops] = useState<Drop[]>([]);
  useEffect(() => {
    void admin<{ drops: Drop[] }>("/drops").then((r) => setDrops(r.drops));
  }, []);
  const hcs = mergedEvents(live.people, live.events).filter((e) => e.hcsSeq || e.txId);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Proofs</h1>
        <p className="mt-1 text-sm text-gray-500">Every drop writes entries, the cutoff, the seed transaction and the result to its own Hedera topic. Anyone can recompute.</p>
      </div>
      <Panel title="Topics">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="pb-3 font-medium">Drop</th>
              <th className="pb-3 font-medium">HCS topic</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Verify</th>
            </tr>
          </thead>
          <tbody>
            {drops.map((d) => (
              <tr key={d.id} className="border-b border-gray-50">
                <td className="py-2.5 font-semibold">{d.label}</td>
                <td className="py-2.5 font-mono text-xs">
                  {hashscanTopic(d.hcsTopicId) ? (
                    <a className="text-info-600" href={hashscanTopic(d.hcsTopicId)} target="_blank" rel="noreferrer">
                      {d.hcsTopicId} ↗
                    </a>
                  ) : (
                    <span className="text-gray-400">{d.hcsTopicId}</span>
                  )}
                </td>
                <td className="py-2.5">
                  <Pill kind={d.status}>{d.status}</Pill>
                </td>
                <td className="py-2.5">
                  <a className="text-xs font-semibold text-info-600" href={`${GATEWAY}/_sp/room/verify/${d.id}`} target="_blank" rel="noreferrer">
                    Recompute ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <LogPanel title="Hedera activity" events={hcs} inlineMax={200} className="h-[560px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]" />
    </div>
  );
}
