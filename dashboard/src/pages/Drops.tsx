import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { admin, GATEWAY, hashscanTopic, type Drop } from "../lib/api";
import { EndNow, EndNowButton } from "../ui/drawnow";
import { useLive, useTick } from "../lib/live";
import { ago, Btn, Field, inputCls, inr, Panel, Pill, Segmented } from "../ui/console";
import { Rolling } from "../ui/rolling";

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
  useEffect(() => {
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [pool]);

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

      {drops.length === 0 && (
        <Panel>
          <div className="py-10 text-center text-sm text-gray-400">No {pool} drops yet</div>
        </Panel>
      )}
      <div className="flex flex-col gap-4">
        {drops.map((d) => (
          <DropCard key={d.id} d={d} onChange={() => void load()} />
        ))}
      </div>

      <AnimatePresence>{building && <Builder pool={pool} onClose={() => setBuilding(false)} onCreated={() => void load()} />}</AnimatePresence>
    </div>
  );
}

function DropCard({ d, onChange }: { d: Drop; onChange: () => void }) {
  useTick(1000);
  const entries = d.entries ?? null;
  const [ending, setEnding] = useState(false);
  const now = Date.now();
  const left = (d.status === "scheduled" ? d.opensAt : d.closesAt) - now;
  const clock = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${m}:${ss}` : `${m}:${ss}`;
  };
  const topic = hashscanTopic(d.hcsTopicId);

  return (
    <div className="grid overflow-hidden rounded-2xl bg-gray-0 shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:grid-cols-[1fr_280px]">
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill kind={d.status}>{d.status}</Pill>
          {d.peakOn ? <Pill kind="peak">● peak on</Pill> : <Pill kind="passthrough">passthrough</Pill>}
          <span className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            Peak
            <Segmented
              value={d.peak.mode}
              options={[
                { value: "auto", label: "Auto" },
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ]}
              onChange={async (mode) => {
                await admin(`/drops/${d.id}/peak`, { method: "POST", body: JSON.stringify({ mode }) });
                onChange();
              }}
            />
          </span>
        </div>
        <a href={`${GATEWAY}/_sp/room/${d.id}`} target="_blank" rel="noreferrer" className="mt-3 block text-xl font-semibold tracking-[-0.01em] hover:underline">
          {d.label}
        </a>
        {d.subtitle && <div className="text-sm text-gray-500">{d.subtitle}</div>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-gray-50 px-2 py-1 font-mono text-xs">{fill(d.pattern, d.values)}</code>
          {d.conditions.map((c, i) => (
            <code key={i} className="rounded-lg bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700">
              {c.location}.{c.key} {c.operator} {Array.isArray(c.value) ? c.value.join("|") : c.value}
            </code>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Stat label="Seats" value={`${d.seats}`} sub={`max ${d.maxSeatsPerEntry} per ${d.pool === "partner" ? "hold" : "entry"}`} />
          {d.pool === "premium" && d.premium ? (
            <Stat label="Price range" value={`${inr(d.premium.floorInr)}–${inr(d.premium.ceilingInr)}`} sub={`deposit ${inr(d.premium.depositInr)}`} />
          ) : d.pool === "partner" && d.partner ? (
            <Stat label="Partner rules" value={`cap ${d.partner.capPerPartner}`} sub={`${inr(d.partner.depositInr)}/seat deposit · book in ${Math.round(d.partner.bookWithinSec / 60)}m`} />
          ) : (
            <Stat label="Price" value={d.priceInr ? inr(d.priceInr) : "—"} sub="per seat, on the provider's site" />
          )}
          <Stat
            label="Hedera topic"
            value={
              topic ? (
                <a href={topic} target="_blank" rel="noreferrer" className="text-info-600">
                  {d.hcsTopicId} ↗
                </a>
              ) : (
                (d.hcsTopicId ?? "—")
              )
            }
            sub="entries, cutoff, seed, result"
          />
          {d.partner?.tokenId && <Stat label="Seat token" value={d.partner.tokenId} sub="HTS · KYC, freeze, wipe" />}
        </div>
      </div>

      <div className="flex flex-col justify-between gap-4 border-t border-gray-100 bg-gray-50/60 p-5 md:border-l md:border-t-0">
        {d.status === "open" || d.status === "scheduled" ? (
          <>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">{d.status === "scheduled" ? "Opens in" : "Closes in"}</div>
              <div className="mt-1 text-4xl font-semibold tabular tracking-[-0.02em]">
                <Rolling value={clock(left)} />
              </div>
              <div className="mt-1 text-sm text-gray-500">
                {entries ?? "…"} {d.pool === "premium" ? "sealed bid" : d.pool === "partner" ? "hold" : "entr"}
                {d.pool === "normal" ? (entries === 1 ? "y" : "ies") : entries === 1 ? "" : "s"} · {d.seats} seats
              </div>
            </div>
            <EndNowButton pool={d.pool} onClick={() => setEnding(true)} />
          </>
        ) : d.status === "results" ? (
          <>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-success-700">{d.pool === "partner" ? "Closed" : "Draw complete"}</div>
              <div className="mt-1 text-2xl font-semibold">{entries ?? "…"} {d.pool === "premium" ? (entries === 1 ? "bid" : "bids") : d.pool === "partner" ? (entries === 1 ? "hold" : "holds") : entries === 1 ? "entry" : "entries"}</div>
              <div className="mt-1 text-sm text-gray-500">closed {ago(Date.now() - d.closesAt)} ago</div>
            </div>
            {d.pool !== "partner" && (
              <a href={`${GATEWAY}/_sp/room/verify/${d.id}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full border border-gray-200 bg-gray-0 px-5 text-sm font-semibold hover:bg-gray-50">
                Check the result ↗
              </a>
            )}
          </>
        ) : (
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-info-700">{d.status === "revealing" ? "Revealing bids" : "Drawing"}</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-medium">
              <span className="size-4 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
              Writing to Hedera…
            </div>
          </div>
        )}
      </div>
      <EndNow
        open={ending}
        drop={d}
        onClose={() => {
          setEnding(false);
          onChange();
        }}
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="truncate font-semibold tabular">{value}</div>
      {sub && <div className="truncate text-2xs text-gray-500">{sub}</div>}
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
