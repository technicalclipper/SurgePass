import { useState } from "react";
import { admin } from "../lib/api";
import { useLive, useTick } from "../lib/live";

// "Launch bot flood": the same bot traffic to the site behind SurgePass and the one without it.

const sum = (o?: Record<string, number>, pred: (k: string) => boolean = () => true) =>
  Object.entries(o ?? {}).reduce((s, [k, v]) => (pred(k) ? s + v : s), 0);

export function FloodControl({ compact = false }: { compact?: boolean }) {
  const live = useLive();
  useTick(500);
  const f = live.flood;
  const [rps, setRps] = useState(1500);
  const [duration, setDuration] = useState(45);
  const [busy, setBusy] = useState(false);
  const running = !!f?.running;
  const left = running ? Math.max(0, Math.ceil((f!.endsAt - Date.now()) / 1000)) : 0;
  const d = f?.last?.direct;
  const g = f?.last?.gated;

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-2xl ${running ? "bg-error-100" : "bg-gray-0"} px-4 py-2.5 transition-colors`}>
      {running ? (
        <>
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-error-700">
            <span className="size-2.5 animate-pulse rounded-full bg-error-600" />
            Bot flood · {f!.rps.toLocaleString("en-IN")} req/s to each site · {left}s left
          </span>
          {!compact && (
            <span className="text-xs text-gray-700 tabular">
              No gate: <b>{sum(d, (k) => k === "503" || k === "err").toLocaleString("en-IN")}</b> failed/s · Gate: <b>{sum(g, (k) => k !== "200").toLocaleString("en-IN")}</b> blocked/s
            </span>
          )}
          <button
            className="ml-auto h-9 rounded-full bg-gray-900 px-4 text-sm font-semibold text-gray-0 active:scale-95"
            onClick={async () => {
              await admin("/flood/stop", { method: "POST" });
            }}
          >
            Stop
          </button>
        </>
      ) : (
        <>
          <span className="text-sm font-semibold">Bot flood</span>
          <select value={rps} onChange={(e) => setRps(+e.target.value)} className="h-9 rounded-full border border-gray-200 bg-gray-0 px-3 text-sm">
            {[800, 1500, 2500, 3500].map((r) => (
              <option key={r} value={r}>
                {r.toLocaleString("en-IN")} req/s
              </option>
            ))}
          </select>
          <select value={duration} onChange={(e) => setDuration(+e.target.value)} className="h-9 rounded-full border border-gray-200 bg-gray-0 px-3 text-sm">
            {[20, 45, 60, 90].map((s) => (
              <option key={s} value={s}>
                {s}s
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            className="h-9 rounded-full bg-error-600 px-4 text-sm font-semibold text-gray-0 transition active:scale-95 disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              try {
                await admin("/flood", { method: "POST", body: JSON.stringify({ rps, duration }) });
              } finally {
                setBusy(false);
              }
            }}
          >
            ▶ Launch bot flood
          </button>
          {!compact && <span className="text-xs text-gray-500">Same bots hit both sites: QuickBook B directly, QuickBook A through SurgePass.</span>}
        </>
      )}
    </div>
  );
}
