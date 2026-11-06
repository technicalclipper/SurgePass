import { CircularState } from "@worldcoin/mini-apps-ui-kit-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { bidCommitment } from "@surgepass/shared";
import { api, type PublicDrop, type Status } from "../lib/api";
import { clock, handle, inr, useNow } from "../lib/format";
import { useLive } from "../lib/live";
import { navigate } from "../App";
import { Card, Header, Mark, Num, PrimaryButton, Row, Screen, SeedReel, Spinner } from "../ui/kit";
import { WorldVerify } from "../ui/WorldVerify";
import { DropTitle } from "./DropPage";
import { Rolling } from "../ui/rolling";

// Premium sealed bid. Your amount never leaves this device until the reveal: only
// sha256("amount:secret") goes to Hedera. Everyone who wins pays the same price, the highest losing bid.

const store = {
  get: (id: string) => {
    try {
      return JSON.parse(localStorage.getItem(`sp_bid_${id}`) ?? "null") as { amount: number; secret: string; seats: number } | null;
    } catch {
      return null;
    }
  },
  set: (id: string, v: { amount: number; secret: string; seats: number }) => {
    try {
      localStorage.setItem(`sp_bid_${id}`, JSON.stringify(v));
    } catch {
      // private mode: the bid can still be revealed while this tab stays open
    }
  },
};

const randomSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export function PremiumPage({ drop: initial }: { drop: PublicDrop }) {
  const p = initial.premium!;
  const [drop, setDrop] = useState(initial);
  const [status, setStatus] = useState<Status | null>(null);
  const [amount, setAmount] = useState(Math.round((p.floorInr + p.ceilingInr) / 2 / 50) * 50);
  const [seats, setSeats] = useState(1);
  const [verifying, setVerifying] = useState(false);
  const [sealing, setSealing] = useState<"idle" | "hashing" | "sealed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sealedCount, setSealedCount] = useState(0);
  const [revealed, setRevealed] = useState<{ anonId: string; amount: number; seats: number }[]>([]);
  const [result, setResult] = useState<{ ranked: { anonId: string; amount: number; seats: number }[]; winners: { anonId: string; seats: number }[]; clearingPriceInr: number; seed: string } | null>(null);
  const [local] = useState(() => store.get(initial.id));
  const now = useNow();

  const refresh = useCallback(async () => {
    const [d, s] = await Promise.all([api.drop(drop.id), api.status(drop.id)]);
    setDrop(d);
    setStatus(s);
    setSealedCount(s.sealedBids ?? 0);
    if (s.bid) setSealing("sealed");
    return { d, s };
  }, [drop.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load the full picture after the fact (opened late, or reloaded).
  useEffect(() => {
    if (drop.status !== "results" || result) return;
    void api.verify(drop.id).then((v) => {
      if (!v.result) return;
      const ranked = (v.result.order as string[]).map((id) => v.premium.revealed.find((b: any) => b.anonId === id)).filter(Boolean);
      setRevealed(v.premium.revealed);
      setResult({ ranked, winners: v.result.winners, clearingPriceInr: v.result.clearingPriceInr, seed: v.result.seed });
    });
  }, [drop.status]);

  // Reveal automatically when the window closes.
  const mine = store.get(drop.id) ?? local;
  useEffect(() => {
    if (drop.status === "revealing" && status?.bid && !status.bid.revealed && mine) {
      void api.reveal(drop.id, mine.amount, mine.secret).then(refresh, (e) => setError(e.message));
    }
  }, [drop.status, status?.bid?.revealed]);

  useLive(drop.id, (m) => {
    if (m.type === "bids") setSealedCount(m.sealed);
    if (m.type === "bid_revealed") setRevealed((r) => (r.some((x) => x.anonId === m.anonId) ? r : [...r, { anonId: m.anonId, amount: m.amount, seats: m.seats }]));
    if (m.type === "draw" && m.phase === "revealing") void refresh();
    if (m.type === "draw" && m.phase === "result") {
      setResult({ ranked: m.ranked, winners: m.winners, clearingPriceInr: m.clearingPriceInr, seed: m.seed });
      setTimeout(() => void refresh(), 400);
    }
    if (m.type === "drop" && m.status) void refresh();
    if (m.type === "bid_sealed" && m.anonId === status?.you?.anonId) void refresh();
  });

  const you = status?.you;
  const isOpen = drop.status === "open" && now < drop.closesAt;
  const sealed = !!status?.bid;

  async function seal() {
    setError(null);
    setSealing("hashing");
    const secret = randomSecret();
    const commit = bidCommitment(amount, secret);
    store.set(drop.id, { amount, secret, seats });
    try {
      await new Promise((r) => setTimeout(r, 900));
      await api.commit(drop.id, commit, seats);
      setSealing("sealed");
      navigator.vibrate?.([6, 40, 12]);
      await refresh();
    } catch (e: any) {
      setSealing("idle");
      setError(e.message === "already_bid" ? "You've already placed a sealed bid." : e.message);
    }
  }

  let bottom: React.ReactNode = null;
  const o = status?.outcome;
  if (drop.status === "results" && o?.result === "won" && status?.pass?.status === "issued") bottom = <PrimaryButton tone="success" href={`/_sp/api/drops/${drop.id}/claim`}>Book now · {inr(o.price ?? 0)} per seat</PrimaryButton>;
  else if (!you && isOpen) bottom = <PrimaryButton onClick={() => setVerifying(true)}>Verify with World ID</PrimaryButton>;
  else if (you && !sealed && isOpen) bottom = <PrimaryButton loading={sealing === "hashing"} onClick={seal}>Seal my bid · {inr(amount)}</PrimaryButton>;

  return (
    <Screen bottom={bottom}>
      <Header onBack={() => navigate("/_sp/room/")} right={<Mark />} />
      <DropTitle drop={drop} />

      {(drop.status === "open" || drop.status === "scheduled") && (
        <>
          <div className="mt-6 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Bidding closes in</div>
            <div className="mt-2 text-6xl font-semibold tabular tracking-[-0.02em]">
              <Rolling value={clock(drop.closesAt - now)} />
            </div>
            <div className="mt-2 text-sm text-gray-500">
              {drop.seats} premium seats · <Num value={sealedCount} /> sealed bids
            </div>
          </div>

          <EnvelopeStack count={sealedCount} />

          {sealed || sealing === "hashing" ? (
            <SealCard amount={mine?.amount ?? amount} stage={sealing === "hashing" ? "hashing" : "sealed"} seq={status?.bid?.seq} />
          ) : (
            <div className="mt-6 flex flex-col gap-5">
              <Card>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-gray-700">Your max per seat</span>
                  <span className="text-xs text-gray-500">
                    {inr(p.floorInr)} – {inr(p.ceilingInr)}
                  </span>
                </div>
                <div className="mt-3 text-center text-5xl font-semibold tabular tracking-[-0.02em]">{inr(amount)}</div>
                <input
                  type="range"
                  min={p.floorInr}
                  max={p.ceilingInr}
                  step={50}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="mt-4 w-full accent-gray-900"
                  aria-label="Max bid per seat"
                />
                <div className="mt-3 text-xs leading-compact text-gray-500">If you win, you pay the highest losing bid, never more than this. Bid what the seat is worth to you.</div>
              </Card>
              <div>
                <div className="mb-3 text-sm font-medium text-gray-700">Seats</div>
                <div className="flex gap-2">
                  {Array.from({ length: drop.maxSeatsPerEntry }, (_, i) => i + 1).map((n) => (
                    <button key={n} onClick={() => setSeats(n)} className={`h-11 min-w-11 rounded-full px-4 text-sm font-semibold ${seats === n ? "bg-gray-900 text-gray-0" : "bg-gray-100"}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <Row label="Sealed on Hedera" sub="Only a fingerprint is public until the reveal" value="Private" />
            </div>
          )}
        </>
      )}

      {drop.status === "revealing" && <RevealPhase sealed={sealedCount} revealed={revealed} me={you?.anonId} />}
      {drop.status === "drawing" && (
        <div className="mt-16 text-center">
          <SeedReel className="text-3xl font-semibold" />
          <div className="mt-3 text-sm text-gray-500">Breaking ties with a Hedera seed</div>
        </div>
      )}
      {drop.status === "results" && result && <ClearingChart result={result} me={you?.anonId} floor={p.floorInr} ceiling={p.ceilingInr} status={status} />}
      {drop.status === "results" && !result && <div className="grid h-48 place-items-center"><Spinner /></div>}

      {error && <div className="mt-4 text-center text-sm text-error-600">{error}</div>}

      <WorldVerify
        open={verifying}
        onOpenChange={setVerifying}
        getContext={() => api.worldContext(drop.id)}
        verify={async (r) => {
          await api.worldVerify(drop.id, r);
        }}
        onDone={() => {
          setVerifying(false);
          void refresh();
        }}
      />
    </Screen>
  );
}

function EnvelopeStack({ count }: { count: number }) {
  const shown = Math.min(count, 7);
  return (
    <div className="relative mx-auto mt-6 h-16 w-40">
      <AnimatePresence>
        {Array.from({ length: shown }, (_, i) => (
          <motion.div
            key={i}
            initial={{ y: -30, opacity: 0, rotate: -8 }}
            animate={{ y: 0, opacity: 1, rotate: (i - shown / 2) * 3 }}
            transition={{ type: "spring", damping: 18, stiffness: 220 }}
            className="absolute left-1/2 top-2 -ml-7"
            style={{ marginLeft: -28 + (i - shown / 2) * 10, zIndex: i }}
          >
            <Envelope />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Envelope({ open = false, amount }: { open?: boolean; amount?: number }) {
  return (
    <div className={`relative grid h-11 w-14 place-items-center overflow-hidden rounded-lg border ${open ? "border-gray-200 bg-gray-0" : "border-gray-900 bg-gray-900"} shadow-card`}>
      {!open && <svg viewBox="0 0 56 44" className="absolute inset-0"><path d="M1 2 L28 24 L55 2" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5" /></svg>}
      {open && amount !== undefined && <span className="text-xs font-semibold tabular">{inr(amount)}</span>}
    </div>
  );
}

function SealCard({ amount, stage, seq }: { amount: number; stage: "hashing" | "sealed"; seq?: number }) {
  const hash = useMemo(() => Array.from({ length: 24 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""), [stage]);
  return (
    <Card className="mt-6 overflow-hidden text-center">
      <AnimatePresence mode="wait">
        {stage === "hashing" ? (
          <motion.div key="h" exit={{ opacity: 0, scale: 0.8 }} className="py-4">
            <motion.div initial={{ filter: "blur(0px)" }} animate={{ filter: "blur(6px)", opacity: 0.2 }} transition={{ duration: 0.6 }} className="text-5xl font-semibold tabular">
              {inr(amount)}
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="-mt-9 font-mono text-sm tracking-wider text-gray-700">
              {hash}
            </motion.div>
          </motion.div>
        ) : (
          <motion.div key="s" initial={{ scale: 0.6, opacity: 0, rotate: -6 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: "spring", damping: 14, stiffness: 200 }} className="flex flex-col items-center gap-3 py-2">
            <Envelope />
            <div className="text-lg font-semibold">Bid sealed</div>
            <div className="text-sm text-gray-500">{seq ? `Commitment #${seq} on Hedera · amount hidden` : "Writing the commitment to Hedera…"}</div>
            <div className="text-xs text-gray-400">Your amount stays on this device until the reveal.</div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function RevealPhase({ sealed, revealed, me }: { sealed: number; revealed: { anonId: string; amount: number }[]; me?: string }) {
  const slots = Math.max(sealed, revealed.length);
  return (
    <div className="mt-8">
      <div className="text-center">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Revealing</div>
        <div className="mt-2 text-3xl font-semibold">
          <Num value={revealed.length} /> of {slots} opened
        </div>
      </div>
      <div className="mt-6 grid grid-cols-4 gap-3">
        {Array.from({ length: Math.min(slots, 16) }, (_, i) => {
          const b = revealed[i];
          return (
            <motion.div key={i} animate={{ rotateY: b ? 0 : 0 }} className="flex flex-col items-center gap-1">
              <motion.div initial={false} animate={b ? { scale: [1, 1.12, 1] } : {}} transition={{ duration: 0.35 }}>
                <Envelope open={!!b} amount={b?.amount} />
              </motion.div>
              <span className={`text-2xs ${b?.anonId === me ? "font-semibold text-gray-900" : "text-gray-400"}`}>{b ? (b.anonId === me ? "You" : handle(b.anonId)) : "sealed"}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function ClearingChart({
  result,
  me,
  floor,
  ceiling,
  status,
}: {
  result: { ranked: { anonId: string; amount: number; seats: number }[]; winners: { anonId: string; seats: number }[]; clearingPriceInr: number };
  me?: string;
  floor: number;
  ceiling: number;
  status: Status | null;
}) {
  const winners = new Set(result.winners.map((w) => w.anonId));
  const rows = result.ranked.slice(0, 10);
  const pct = (v: number) => 12 + ((v - floor) / Math.max(1, ceiling - floor)) * 88;
  const myBid = result.ranked.find((r) => r.anonId === me);
  const won = me && winners.has(me);
  return (
    <div className="mt-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="flex justify-center">{me && myBid && <CircularState value={won ? "success" : "warning"} size="lg" />}</div>
        <div className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Everyone who won pays</div>
        <div className="mt-1 text-6xl font-semibold tabular tracking-[-0.02em]">{inr(result.clearingPriceInr)}</div>
        {me && myBid && (
          <div className="mt-2 text-base text-gray-500">
            {won ? `You bid ${inr(myBid.amount)} · you pay ${inr(result.clearingPriceInr)}` : `You bid ${inr(myBid.amount)} · ${status?.outcome?.result === "waitlist" ? `waitlist #${status.outcome.position}` : "not this time"}`}
          </div>
        )}
      </motion.div>

      <div className="relative mt-8 flex flex-col gap-2">
        {rows.map((r, i) => {
          const win = winners.has(r.anonId);
          const isClearing = !win && i === result.winners.length;
          return (
            <motion.div key={r.anonId} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}>
              <div className="flex items-center gap-3">
                <span className={`w-16 shrink-0 text-xs ${r.anonId === me ? "font-semibold text-gray-900" : "text-gray-500"}`}>{r.anonId === me ? "You" : handle(r.anonId)}</span>
                <div className="relative h-9 flex-1 overflow-hidden rounded-full bg-gray-50">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct(r.amount)}%` }}
                    transition={{ delay: 0.2 + i * 0.08, duration: 0.6, ease: "easeOut" }}
                    className={`flex h-full items-center justify-end rounded-full pr-3 ${win ? "bg-success-600 text-gray-0" : isClearing ? "bg-gray-900 text-gray-0" : "bg-gray-200 text-gray-700"}`}
                  >
                    <span className="text-xs font-semibold tabular">{inr(r.amount)}</span>
                  </motion.div>
                </div>
              </div>
              {i === result.winners.length - 1 && (
                <motion.div initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} transition={{ delay: 0.4 + rows.length * 0.08, duration: 0.5 }} className="my-2 flex origin-left items-center gap-2 pl-[76px]">
                  <div className="h-px flex-1 bg-gray-900" />
                  <span className="text-2xs font-semibold uppercase tracking-wide">clearing price · {inr(result.clearingPriceInr)}</span>
                  <div className="h-px flex-1 bg-gray-900" />
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>
      <div className="mt-6 flex flex-col gap-3">
        <Row label="Verify this auction" sub="Commitments, reveals and seed from Hedera" value="Recompute →" accent="info" onClick={() => navigate(`/_sp/room/verify/${status?.drop}`)} />
      </div>
    </div>
  );
}
