import { CircularState } from "@worldcoin/mini-apps-ui-kit-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { api, type PublicDrop, type Status } from "../lib/api";
import { clock, inr, useNow } from "../lib/format";
import { useLive } from "../lib/live";
import { navigate } from "../App";
import { Card, Chip, GhostButton, Header, Mark, Num, PrimaryButton, Row, Screen, Sheet, Spinner } from "../ui/kit";
import { WorldVerify } from "../ui/WorldVerify";
import { DrawReveal, type DrawFeed } from "./DrawReveal";
import { Rolling } from "../ui/rolling";

export function DropPage({ drop: initial }: { drop: PublicDrop }) {
  const [drop, setDrop] = useState(initial);
  const [status, setStatus] = useState<Status | null>(null);
  const [seats, setSeats] = useState(1);
  const [verifying, setVerifying] = useState(false);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<DrawFeed | null>(null);
  const [revealDone, setRevealDone] = useState(false);
  const [entries, setEntries] = useState<{ anonId: string; seats: number; seq: number }[]>([]);
  const [howOpen, setHowOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const now = useNow();

  const refresh = useCallback(async () => {
    const [d, s] = await Promise.all([api.drop(drop.id), api.status(drop.id)]);
    setDrop(d);
    setStatus(s);
    return { d, s };
  }, [drop.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLive(drop.id, (m) => {
    if (m.type === "drop" && typeof m.entries === "number") setDrop((d) => ({ ...d, entries: m.entries }));
    if (m.type === "drop" && m.status) void refresh();
    if (m.type === "entry" && status?.you?.anonId === m.anonId) void refresh();
    if (m.type === "draw") {
      if (m.phase === "closing") void api.entries(drop.id).then((r) => setEntries(r.entries.filter((e) => e.seq > 0)));
      setFeed((f) => ({ ...(f ?? {}), ...m }));
      if (m.phase === "result") setTimeout(() => void refresh(), 300);
    }
    if (m.type === "pass" || m.type === "booked" || m.type === "released" || m.type === "fcfs_result") void refresh();
  });

  const you = status?.you;
  const entered = !!status?.entry;
  const isOpen = drop.status === "open" && now < drop.closesAt;
  const showReveal = feed && !revealDone && (drop.status === "drawing" || drop.status === "results" || feed.phase !== "closing");

  // ── Bottom action ────────────────────────────────────────────────────────
  let bottom: React.ReactNode = null;
  if (drop.status === "results" && (!feed || revealDone)) {
    const o = status?.outcome;
    if (o?.result === "won" && status?.pass?.status === "issued")
      bottom = <PrimaryButton tone="success" href={`/_sp/api/drops/${drop.id}/claim`}>Book now</PrimaryButton>;
    else if ((status?.released ?? 0) > 0 && you && o?.result !== "booked")
      bottom = (
        <PrimaryButton
          loading={claiming}
          onClick={async () => {
            setClaiming(true);
            try {
              await api.claimReleased(drop.id, status?.entry?.seats ?? 1);
              setTimeout(() => void refresh(), 3500);
            } catch (e: any) {
              setError(e.message);
            } finally {
              setTimeout(() => setClaiming(false), 3500);
            }
          }}
        >
          Claim a released seat
        </PrimaryButton>
      );
  } else if (!you && (isOpen || drop.status === "scheduled")) {
    bottom = <PrimaryButton onClick={() => setVerifying(true)}>Verify with World ID</PrimaryButton>;
  } else if (you && !entered && isOpen) {
    bottom = (
      <PrimaryButton
        loading={entering}
        onClick={async () => {
          setEntering(true);
          setError(null);
          try {
            await api.enter(drop.id, seats);
            await refresh();
          } catch (e: any) {
            setError(e.message === "already_entered" ? "You've already entered this drop." : e.message);
          } finally {
            setEntering(false);
          }
        }}
      >
        Enter draw · {seats} seat{seats > 1 ? "s" : ""}
      </PrimaryButton>
    );
  } else if (you && !entered && drop.status === "scheduled") {
    bottom = <PrimaryButton disabled>Opens in {clock(drop.opensAt - now)}</PrimaryButton>;
  }

  return (
    <Screen bottom={bottom}>
      <Header onBack={() => navigate("/_sp/room/")} right={<Mark />} />

      <AnimatePresence mode="wait">
        {showReveal ? (
          <motion.div key="reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <DrawReveal feed={feed!} entries={entries} me={you?.anonId} seats={drop.seats} onDone={() => setRevealDone(true)} />
          </motion.div>
        ) : drop.status === "results" || drop.status === "drawing" ? (
          <motion.div key="result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <DropTitle drop={drop} />
            <ResultCard drop={drop} status={status} now={now} />
            <div className="mt-4 flex flex-col gap-3">
              <Row label="Verify this draw" sub="Seed, method and entries from Hedera" value="Recompute →" accent="info" onClick={() => navigate(`/_sp/room/verify/${drop.id}`)} />
              {drop.topicLink && <Row label="Audit log on Hedera" sub={`Topic ${drop.hcsTopicId}`} value="HashScan ↗" accent="info" onClick={() => window.open(drop.topicLink, "_blank")} />}
              {feed === null && drop.status === "results" && <GhostButton onClick={() => replay(drop.id, setEntries, setFeed, setRevealDone)}>Replay the draw</GhostButton>}
            </div>
          </motion.div>
        ) : (
          <motion.div key="lobby" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <DropTitle drop={drop} />

            <div className="mt-8 text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">{drop.status === "scheduled" ? "Opens in" : "Closes in"}</div>
              <div className="mt-2 text-7xl font-semibold tabular tracking-[-0.02em]">
                <Rolling value={clock((drop.status === "scheduled" ? drop.opensAt : drop.closesAt) - now)} />
              </div>
              <div className="mt-3 text-sm text-gray-500">
                <Num value={drop.seats} /> seats · <Num value={drop.entries ?? 0} /> entered
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-4">
              {entered ? (
                <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                  <Card className="flex items-center gap-4 bg-success-100">
                    <CircularState value="success" size="md" />
                    <div>
                      <div className="text-lg font-semibold">You're in.</div>
                      <div className="text-sm text-gray-700">
                        {status!.entry!.seats} seat{status!.entry!.seats > 1 ? "s" : ""} · {status!.entry!.seq ? `entry #${status!.entry!.seq} on Hedera` : "recording on Hedera…"}
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ) : (
                <div>
                  <div className="mb-3 text-sm font-medium text-gray-700">Seats</div>
                  <div className="flex gap-2">
                    {Array.from({ length: drop.maxSeatsPerEntry }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        onClick={() => setSeats(n)}
                        className={`h-11 min-w-11 rounded-full px-4 text-sm font-semibold transition-colors ${seats === n ? "bg-gray-900 text-gray-0" : "bg-gray-100 text-gray-900"}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-gray-500">Up to {drop.maxSeatsPerEntry} per person{drop.priceInr ? ` · ${inr(drop.priceInr)} each` : ""}</div>
                </div>
              )}
              <Row label="Fair draw" sub="Equal odds for everyone who enters" value="How it works" accent="info" onClick={() => setHowOpen(true)} />
              {you && !entered && <div className="text-center text-sm text-gray-500">Verified · one entry per person</div>}
              {error && <div className="text-center text-sm text-error-600">{error}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <WorldVerify
        open={verifying}
        onOpenChange={setVerifying}
        getContext={() => api.worldContext(drop.id)}
        verify={async (result) => {
          await api.worldVerify(drop.id, result);
        }}
        onDone={() => {
          setVerifying(false);
          void refresh();
        }}
      />

      <Sheet open={howOpen} onClose={() => setHowOpen(false)}>
        <div className="flex flex-col gap-4 pb-2">
          <div className="text-xl font-semibold">How the draw works</div>
          {[
            ["One person, one entry", "World ID proves you're a unique human. Agents enter only for a verified person."],
            ["Timing doesn't matter", "Entering at the first or last second gives the same odds."],
            ["Locked before the roll", "The cutoff and the seed's transaction ID are written to Hedera before the seed exists."],
            ["Shuffled by Hedera", "A random seed from Hedera shuffles every entry (Fisher–Yates)."],
            ["Seats in order", `Each person in the shuffled order gets the seats they asked for, or what's left.`],
            ["Anyone can check", "Seed, entries and method are public. Recompute the result yourself."],
          ].map(([t, d]) => (
            <div key={t} className="flex gap-3">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gray-900" />
              <div>
                <div className="text-base font-semibold">{t}</div>
                <div className="text-sm text-gray-500">{d}</div>
              </div>
            </div>
          ))}
          <PrimaryButton onClick={() => setHowOpen(false)}>Got it</PrimaryButton>
        </div>
      </Sheet>
    </Screen>
  );
}

export function DropTitle({ drop }: { drop: PublicDrop }) {
  return (
    <div className="pt-2">
      <div className="flex items-center gap-2">
        {drop.peakOn ? <Chip tone="warning">● Peak · fair draw on</Chip> : <Chip>Normal traffic</Chip>}
        {drop.pool === "premium" && <Chip tone="dark">Premium</Chip>}
      </div>
      <h1 className="mt-4 text-3xl font-semibold leading-narrow tracking-[-0.01em]">{drop.label}</h1>
      {drop.subtitle && <div className="mt-1 text-base text-gray-500">{drop.subtitle}</div>}
    </div>
  );
}

function ResultCard({ drop, status, now }: { drop: PublicDrop; status: Status | null; now: number }) {
  if (!status) return <div className="grid h-48 place-items-center"><Spinner /></div>;
  const o = status.outcome;
  const pass = status.pass;
  let state: "success" | "warning" | "error" | "pending" = "pending";
  let title = "Draw complete";
  let sub = status.you ? "You didn't enter this drop." : "Verify to see your result.";
  if (o?.result === "won" && pass?.status === "issued") {
    state = "success";
    title = "You're in";
    sub = o.partial ? `${o.seats} of ${o.requested} seats · only ${o.seats} were left in your turn` : `${o.seats} seat${(o.seats ?? 1) > 1 ? "s" : ""}${o.price ? ` · ${inr(o.price)} per seat` : ""}`;
  } else if (o?.result === "booked") {
    state = "success";
    title = "Booked";
    sub = `${pass?.booked ?? o.seats} seat(s) confirmed on the booking site`;
  } else if (o?.result === "expired") {
    state = "error";
    title = "Pass expired";
    sub = "Your seats went to the next person in line.";
  } else if (o?.result === "waitlist") {
    state = "warning";
    title = `Waitlist #${o.position}`;
    sub = "If seats free up, you're next in this order.";
  }
  return (
    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", damping: 22, stiffness: 260 }} className="mt-8 rounded-[28px] bg-gray-0 p-6 text-center shadow-card">
      <div className="flex justify-center">
        <CircularState value={state} size="xl" />
      </div>
      <div className="mt-5 text-5xl font-semibold tracking-[-0.02em]">{title}</div>
      <div className="mt-2 text-base text-gray-500">{sub}</div>
      {o?.result === "won" && pass?.status === "issued" && (
        <div className="mt-5 inline-flex h-9 items-center rounded-full bg-gray-100 px-4 text-sm font-semibold tabular">Pass valid for {clock(pass.expiresAt - now)}</div>
      )}
      {(status.released ?? 0) > 0 && o?.result !== "won" && o?.result !== "booked" && (
        <div className="mt-4 text-sm text-gray-500">{status.released} released seat(s) open · first come, ordered by Hedera</div>
      )}
    </motion.div>
  );
}

async function replay(
  dropId: string,
  setEntries: (e: { anonId: string; seats: number; seq: number }[]) => void,
  setFeed: (f: DrawFeed) => void,
  setRevealDone: (b: boolean) => void,
) {
  const r = await api.entries(dropId);
  if (!r.result) return;
  setEntries(r.entries.filter((e) => e.seq > 0));
  setRevealDone(false);
  setFeed({ phase: "closed", entryCount: r.result.entryCount, seedTxId: r.result.seedTxId });
  setTimeout(() => setFeed({ phase: "result", seed: r.result.seed, order: r.result.order, winners: r.result.winners, seedTxId: r.result.seedTxId }), 900);
}
