import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { admin, GATEWAY, hashscanTopic, type Drop } from "../lib/api";
import { useLive, useTick } from "../lib/live";
import { ago, Btn, Field, inputCls, inr, Panel, Pill, Segmented } from "../ui/console";

// Drops (Normal) and Drops (Premium) are separate sections, each with its own URL gating,
// seats and settings, because every platform marks premium differently.

export function DropsPage({ pool }: { pool: "normal" | "premium" | "partner" }) {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [building, setBuilding] = useState(false);
  const live = useLive();
  useTick(1000);
  const load = () => admin<{ drops: Drop[] }>("/drops").then((r) => setDrops(r.drops.filter((d) => d.pool === pool)));
  useEffect(() => {
    void load();
  }, [pool]);
  useEffect(() => {
    void load();
  }, [live.stats.at(-1)?.drops.map((d) => d.status + d.peakOn).join()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.01em]">{pool === "normal" ? "Drops · Normal" : pool === "premium" ? "Drops · Premium" : "Drops · Partner"}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {pool === "normal"
              ? "Fair draw at the normal price. One entry per verified human."
              : pool === "premium"
                ? "Sealed-bid pool with a floor and a ceiling. Everyone who wins pays the highest losing bid."
                : "A quota for authorised partners. Seats are HTS tokens only allowlisted accounts can hold; unused seats go back to the public."}
          </p>
        </div>
        <Btn onClick={() => setBuilding(true)}>+ New {pool} drop</Btn>
      </div>

      <Panel>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="pb-3 font-medium">Drop</th>
              <th className="pb-3 font-medium">Route</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Seats</th>
              <th className="pb-3 font-medium">Window</th>
              <th className="pb-3 font-medium">Peak</th>
              <th className="pb-3 font-medium">Proof</th>
            </tr>
          </thead>
          <tbody>
            {drops.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-gray-400">
                  No {pool} drops yet
                </td>
              </tr>
            )}
            {drops.map((d) => (
              <tr key={d.id} className="border-b border-gray-50 align-middle">
                <td className="py-3 pr-4">
                  <a href={`${GATEWAY}/_sp/room/${d.id}`} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                    {d.label}
                  </a>
                  <div className="text-xs text-gray-500">{d.subtitle ?? d.id}</div>
                </td>
                <td className="py-3 pr-4">
                  <code className="rounded-md bg-gray-50 px-1.5 py-0.5 font-mono text-xs">{fill(d.pattern, d.values)}</code>
                  <div className="mt-1 font-mono text-2xs text-gray-500">{d.conditions.map((c) => `${c.location}.${c.key} ${c.operator} ${c.value ?? ""}`).join(" · ") || "no conditions"}</div>
                </td>
                <td className="py-3 pr-4">
                  <Pill kind={d.status}>{d.status}</Pill>
                </td>
                <td className="py-3 pr-4 tabular">
                  {d.seats} <span className="text-gray-400">· max {d.maxSeatsPerEntry}</span>
                  {d.premium && <div className="text-2xs text-gray-500">{inr(d.premium.floorInr)}–{inr(d.premium.ceilingInr)} · dep {inr(d.premium.depositInr)}</div>}
                  {d.partner && <div className="text-2xs text-gray-500">cap {d.partner.capPerPartner}/partner · dep {inr(d.partner.depositInr)}/seat · book in {Math.round(d.partner.bookWithinSec / 60)}m</div>}
                </td>
                <td className="py-3 pr-4 text-xs tabular text-gray-700">{d.status === "scheduled" ? `opens in ${ago(d.opensAt - Date.now())}` : d.status === "open" ? `closes in ${ago(d.closesAt - Date.now())}` : `closed ${ago(Date.now() - d.closesAt)} ago`}</td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${d.peakOn ? "bg-warning-600" : "bg-gray-300"}`} />
                    <Segmented
                      value={d.peak.mode}
                      options={[
                        { value: "auto", label: "Auto" },
                        { value: "on", label: "On" },
                        { value: "off", label: "Off" },
                      ]}
                      onChange={async (mode) => {
                        await admin(`/drops/${d.id}/peak`, { method: "POST", body: JSON.stringify({ mode }) });
                        void load();
                      }}
                    />
                  </div>
                </td>
                <td className="py-3">
                  {hashscanTopic(d.hcsTopicId) ? (
                    <a href={hashscanTopic(d.hcsTopicId)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-info-600">
                      {d.hcsTopicId} ↗
                    </a>
                  ) : (
                    <span className="font-mono text-2xs text-gray-400">{d.hcsTopicId ?? "—"}</span>
                  )}
                  {d.partner?.tokenId && <div className="font-mono text-2xs text-gray-500">seat token {d.partner.tokenId}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <AnimatePresence>{building && <Builder pool={pool} onClose={() => setBuilding(false)} onCreated={() => void load()} />}</AnimatePresence>
    </div>
  );
}

const fill = (pattern: string, values: Record<string, string>) => pattern.replace(/:([A-Za-z_]\w*)/g, (m, k) => values[k] ?? m);

interface Seg {
  text: string;
  param: string | null;
}
interface Q {
  key: string;
  value: string;
  mode: "match" | "ignore";
}

const guessName = (seg: string, i: number, prev?: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(seg)) return "date";
  if (/^\d{5}$/.test(seg)) return "trainNo";
  if (/^[A-Z0-9]{2,3}$/.test(seg)) return "class";
  if (prev === "book" || prev === "events" || prev === "movie") return prev === "events" ? "eventId" : "id";
  return `p${i}`;
};

function Builder({ pool, onClose, onCreated }: { pool: "normal" | "premium" | "partner"; onClose: () => void; onCreated: () => void }) {
  const [url, setUrl] = useState(`${GATEWAY}/tatkal/book/12951/2026-11-06/3A?quota=${pool === "premium" ? "PT" : pool === "partner" ? "AG" : "TQ"}&lang=en`);
  const [segs, setSegs] = useState<Seg[]>([]);
  const [qs, setQs] = useState<Q[]>([]);
  const [exact, setExact] = useState(false);
  const [label, setLabel] = useState(`Train 12951 · 3A · ${pool === "premium" ? "Premium Tatkal" : pool === "partner" ? "Partner quota" : "Tatkal"}`);
  const [cap, setCap] = useState(4);
  const [pDeposit, setPDeposit] = useState(20);
  const [bookWithin, setBookWithin] = useState(10);
  const [openDelay, setOpenDelay] = useState(0);
  const [spillTo, setSpillTo] = useState("");
  const [publicDrops, setPublicDrops] = useState<Drop[]>([]);
  useEffect(() => {
    if (pool === "partner") void admin<{ drops: Drop[] }>("/drops").then((r) => setPublicDrops(r.drops.filter((d) => d.pool === "normal")));
  }, [pool]);
  const [subtitle, setSubtitle] = useState("Mumbai Central → New Delhi · 6 Nov");
  const [seats, setSeats] = useState(pool === "premium" ? 4 : 20);
  const [maxPer, setMaxPer] = useState(pool === "premium" ? 2 : 4);
  const [opensIn, setOpensIn] = useState(0);
  const [duration, setDuration] = useState(120);
  const [price, setPrice] = useState(2800);
  const [floor, setFloor] = useState(2800);
  const [ceiling, setCeiling] = useState(5600);
  const [deposit, setDeposit] = useState(200);
  const [readPattern, setReadPattern] = useState("/availability/:trainNo/:date/:class");
  const [seatsField, setSeatsField] = useState("seats_booked");
  const [test, setTest] = useState("");
  const [testRes, setTestRes] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      setSegs(parts.map((t, i) => ({ text: t, param: i >= 2 ? guessName(t, i, parts[i - 1]) : null })));
      setQs([...u.searchParams].map(([key, value]) => ({ key, value, mode: key === "quota" ? "match" : "ignore" })));
      setErr(null);
    } catch {
      setErr("Paste a full URL, starting with http:// or https://");
    }
  }, [url]);

  const pattern = "/" + segs.map((s) => (s.param ? `:${s.param}` : s.text)).join("/");
  const values = Object.fromEntries(segs.filter((s) => s.param).map((s) => [s.param!, s.text]));
  const conditions = qs.filter((q) => q.mode === "match").map((q) => ({ location: "query", key: q.key, operator: "equals", value: q.value }));
  const matchPreview = useMemo(() => [pattern, conditions.map((c) => `${c.key}=${c.value}`).join("&")].filter(Boolean).join("?"), [pattern, conditions]);

  async function runTest(u: string) {
    if (!u) return setTestRes(null);
    try {
      const r = await admin<any>("/test-url", { method: "POST", body: JSON.stringify({ url: u }) });
      setTestRes(r.match ? `Matches "${r.label}" (${r.kind} route${r.peakOn ? ", peak on" : ""})` : "Passes through");
    } catch {
      setTestRes("Invalid URL");
    }
  }

  async function create() {
    setSaving(true);
    setErr(null);
    try {
      const opensAt = Date.now() + opensIn * 60_000;
      const closesAt = opensAt + duration * 1000;
      const u = new URL(url);
      await admin("/drops", {
        method: "POST",
        body: JSON.stringify({
          label,
          subtitle,
          pool,
          host: u.host,
          pattern,
          values,
          conditions,
          exactUrl: exact ? u.pathname + u.search : undefined,
          readPatterns: readPattern ? [readPattern] : [],
          finalStepPattern: `${pattern}/confirm`,
          bookingUrl: pattern,
          confirmedSeatsField: seatsField,
          seats,
          maxSeatsPerEntry: maxPer,
          priceInr: pool === "normal" ? price : undefined,
          premium: pool === "premium" ? { floorInr: floor, ceilingInr: ceiling, depositInr: deposit, revealSec: 15 } : undefined,
          partner: pool === "partner" ? { capPerPartner: cap, depositInr: pDeposit, bookWithinSec: bookWithin * 60, openDelaySec: openDelay * 60, spillTo: spillTo || undefined } : undefined,
          opensAt,
          closesAt,
          peak: { mode: "auto", schedule: [{ start: opensAt - 60_000, end: closesAt + 30 * 60_000 }], loadTrigger: { p95Ms: 800, errorRate: 0.05 } },
        }),
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div className="fixed inset-0 z-50 flex justify-end bg-gray-900/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 320 }}
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-gray-50 p-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">New {pool} drop</h2>
          <button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-gray-0 text-gray-500">
            ✕
          </button>
        </div>

        <Panel title="1 · Gate a URL" className="mt-5">
          <Field label="Paste a booking URL" hint="Tap path segments to make them drop values, and choose which query parameters must match.">
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={`${inputCls} font-mono text-xs`} />
          </Field>
          {!err && (
            <>
              <div className="mt-4 text-xs font-medium text-gray-700">Path</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {segs.map((s, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className="text-gray-300">/</span>
                    <button
                      onClick={() => setSegs(segs.map((x, j) => (j === i ? { ...x, param: x.param ? null : guessName(x.text, i, segs[i - 1]?.text) } : x)))}
                      className={`h-8 rounded-full px-3 font-mono text-xs font-semibold transition ${s.param ? "bg-gray-900 text-gray-0" : "bg-gray-100 text-gray-700"}`}
                    >
                      {s.text}
                    </button>
                    {s.param && (
                      <input
                        value={s.param}
                        onChange={(e) => setSegs(segs.map((x, j) => (j === i ? { ...x, param: e.target.value.replace(/\W/g, "") || "p" } : x)))}
                        className="h-8 w-20 rounded-full border border-gray-200 px-2 font-mono text-2xs"
                        aria-label="parameter name"
                      />
                    )}
                  </span>
                ))}
              </div>
              {qs.length > 0 && (
                <>
                  <div className="mt-4 text-xs font-medium text-gray-700">Query</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {qs.map((q, i) => (
                      <button
                        key={q.key}
                        onClick={() => setQs(qs.map((x, j) => (j === i ? { ...x, mode: x.mode === "match" ? "ignore" : "match" } : x)))}
                        className={`inline-flex h-8 items-center gap-2 rounded-full px-3 font-mono text-xs ${q.mode === "match" ? "bg-gray-900 text-gray-0" : "bg-gray-100 text-gray-500 line-through"}`}
                      >
                        {q.key}={q.value}
                        <span className="font-sans text-2xs font-semibold not-italic no-underline opacity-80">{q.mode}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} /> Match this exact URL only
              </label>
              <div className="mt-4 rounded-xl bg-gray-50 p-3">
                <div className="text-2xs font-medium uppercase tracking-wide text-gray-500">Gated pattern</div>
                <code className="mt-1 block font-mono text-sm">{matchPreview}</code>
                <div className="mt-1 font-mono text-2xs text-gray-500">{Object.entries(values).map(([k, v]) => `${k}=${v}`).join(" · ")}</div>
              </div>
            </>
          )}
          {err && <div className="mt-3 text-sm text-error-600">{err}</div>}
        </Panel>

        <Panel title="2 · Seats and window" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Label">
              <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Subtitle">
              <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Seats (N)" hint="How many seats this drop allocates">
              <input type="number" min={1} value={seats} onChange={(e) => setSeats(+e.target.value)} className={inputCls} />
            </Field>
            <Field label="Max seats per entry">
              <input type="number" min={1} max={10} value={maxPer} onChange={(e) => setMaxPer(+e.target.value)} className={inputCls} />
            </Field>
            <Field label="Opens in (minutes)">
              <input type="number" min={0} value={opensIn} onChange={(e) => setOpensIn(+e.target.value)} className={inputCls} />
            </Field>
            <Field label="Window (seconds)">
              <input type="number" min={10} value={duration} onChange={(e) => setDuration(+e.target.value)} className={inputCls} />
            </Field>
            {pool === "partner" ? (
              <>
                <Field label="Max seats per partner">
                  <input type="number" min={1} value={cap} onChange={(e) => setCap(+e.target.value)} className={inputCls} />
                </Field>
                <Field label="Deposit per seat (₹)" hint="Refunded when booked; kept if not">
                  <input type="number" min={0} value={pDeposit} onChange={(e) => setPDeposit(+e.target.value)} className={inputCls} />
                </Field>
                <Field label="Book within (minutes)" hint="After receiving seat tokens">
                  <input type="number" min={1} value={bookWithin} onChange={(e) => setBookWithin(+e.target.value)} className={inputCls} />
                </Field>
                <Field label="Partners start after (minutes)" hint="e.g. 30 keeps the opening for the public">
                  <input type="number" min={0} value={openDelay} onChange={(e) => setOpenDelay(+e.target.value)} className={inputCls} />
                </Field>
                <Field label="Unused seats go to" hint="A public draw: its seats or waitlist">
                  <select value={spillTo} onChange={(e) => setSpillTo(e.target.value)} className={inputCls}>
                    <option value="">— none —</option>
                    {publicDrops.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : pool === "normal" ? (
              <Field label="Price per seat (₹)">
                <input type="number" value={price} onChange={(e) => setPrice(+e.target.value)} className={inputCls} />
              </Field>
            ) : (
              <>
                <Field label="Floor (₹)" hint="Normal fare">
                  <input type="number" value={floor} onChange={(e) => setFloor(+e.target.value)} className={inputCls} />
                </Field>
                <Field label="Ceiling (₹)" hint="Maximum anyone can pay">
                  <input type="number" value={ceiling} onChange={(e) => setCeiling(+e.target.value)} className={inputCls} />
                </Field>
                <Field label="Deposit (₹)" hint="Same for everyone; refunded">
                  <input type="number" value={deposit} onChange={(e) => setDeposit(+e.target.value)} className={inputCls} />
                </Field>
              </>
            )}
          </div>
        </Panel>

        <Panel title="3 · Routes" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Read route (availability)" hint="Free within quota, x402 beyond it">
              <input value={readPattern} onChange={(e) => setReadPattern(e.target.value)} className={`${inputCls} font-mono text-xs`} />
            </Field>
            <Field label="Confirmed-seats field" hint="In the final step's JSON response">
              <input value={seatsField} onChange={(e) => setSeatsField(e.target.value)} className={`${inputCls} font-mono text-xs`} />
            </Field>
          </div>
          <div className="mt-2 font-mono text-2xs text-gray-500">Final step: POST {pattern}/confirm</div>
        </Panel>

        <Panel title="Test a URL" className="mt-4">
          <input
            value={test}
            onChange={(e) => {
              setTest(e.target.value);
              void runTest(e.target.value);
            }}
            placeholder={`${GATEWAY}/tatkal/book/…`}
            className={`${inputCls} w-full font-mono text-xs`}
          />
          {testRes && <div className={`mt-2 rounded-xl px-3 py-2 text-sm ${testRes.startsWith("Matches") ? "bg-success-100 text-success-700" : "bg-gray-100 text-gray-700"}`}>{testRes}</div>}
        </Panel>

        <div className="sticky bottom-0 mt-6 flex justify-end gap-3 bg-gray-50 py-2">
          <Btn kind="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn onClick={create} disabled={saving || !!err}>
            {saving ? "Creating…" : "Create drop"}
          </Btn>
        </div>
      </motion.div>
    </motion.div>
  );
}
