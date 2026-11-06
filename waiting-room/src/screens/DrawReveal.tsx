import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { handle } from "../lib/format";
import { SeedReel } from "../ui/kit";

// The draw, played out: window closes → seed transaction committed → Hedera seed spins in →
// entries shuffle from HCS order into Fisher–Yates order → winners light up → cutoff drops.

export interface DrawFeed {
  phase: "closing" | "closed" | "seed" | "result";
  entryCount?: number;
  seedTxId?: string;
  seed?: string;
  seedLink?: string;
  order?: string[];
  winners?: { anonId: string; seats: number; requested: number }[];
}

type Stage = "closing" | "committed" | "seed" | "shuffle" | "winners" | "done";

const VISIBLE = 8;

export function DrawReveal({
  feed,
  entries,
  me,
  seats,
  onDone,
}: {
  feed: DrawFeed;
  entries: { anonId: string; seats: number; seq: number }[];
  me?: string;
  seats: number;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<Stage>("closing");
  const [lit, setLit] = useState(0);

  useEffect(() => {
    if (feed.phase === "closed" && stage === "closing") setStage("committed");
    if (feed.phase === "seed" && (stage === "closing" || stage === "committed")) setStage("seed");
    if (feed.phase === "result" && feed.order && (stage === "closing" || stage === "committed" || stage === "seed")) {
      setStage("seed");
      const t1 = setTimeout(() => setStage("shuffle"), 1500);
      const t2 = setTimeout(() => setStage("winners"), 2700);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [feed.phase]);

  const byId = useMemo(() => new Map(entries.map((e) => [e.anonId, e])), [entries]);
  const winners = feed.winners ?? [];
  const winSeats = new Map(winners.map((w) => [w.anonId, w]));

  // Which rows are on screen: the first few, plus you if you're further down.
  const rows = useMemo(() => {
    const base = stage === "shuffle" || stage === "winners" || stage === "done" ? feed.order ?? [] : [...entries].sort((a, b) => a.seq - b.seq).map((e) => e.anonId);
    const top = base.slice(0, VISIBLE);
    const myIdx = me ? base.indexOf(me) : -1;
    return { top, mine: myIdx >= VISIBLE ? { id: me!, rank: myIdx + 1 } : null, total: base.length };
  }, [stage, feed.order, entries, me]);

  useEffect(() => {
    if (stage !== "winners") return;
    const count = rows.top.filter((id) => winSeats.has(id)).length;
    let i = 0;
    const t = setInterval(() => {
      i++;
      setLit(i);
      navigator.vibrate?.(4);
      if (i >= count) {
        clearInterval(t);
        setTimeout(() => {
          setStage("done");
          setTimeout(onDone, 900);
        }, 500);
      }
    }, 160);
    return () => clearInterval(t);
  }, [stage]);

  const winnerRowsShown = rows.top.filter((id) => winSeats.has(id)).length;
  const cutoffAfter = stage === "done" ? rows.top.reduce((last, id, i) => (winSeats.has(id) ? i : last), -1) : -1;

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div className="text-center">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">{caption(stage)}</div>
        <div className="mt-3 text-3xl font-semibold tracking-[-0.01em]">
          {stage === "closing" && "Window closed"}
          {stage === "committed" && "Draw locked"}
          {(stage === "seed" || stage === "shuffle") && <SeedReel seed={feed.seed} />}
          {stage === "winners" && "Drawing winners"}
          {stage === "done" && `${winners.length} winners`}
        </div>
        <div className="mt-2 min-h-5 text-sm text-gray-500">
          {stage === "closing" && `${(feed.entryCount ?? entries.length).toLocaleString("en-IN")} entries · writing the cutoff to Hedera`}
          {stage === "committed" && feed.seedTxId && <span className="font-mono text-xs">seed tx {short(feed.seedTxId)}</span>}
          {(stage === "seed" || stage === "shuffle") && "Random seed from Hedera"}
          {stage === "winners" && `${seats} seats · strict order`}
          {stage === "done" && `Fisher–Yates · ${rows.total.toLocaleString("en-IN")} entries`}
        </div>
      </div>

      <LayoutGroup>
        <div className="relative flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {rows.top.map((id, i) => {
              const w = winSeats.get(id);
              const isLit = (stage === "winners" && w && rows.top.filter((x) => winSeats.has(x)).indexOf(id) < lit) || (stage === "done" && w);
              const isMe = id === me;
              const e = byId.get(id);
              return (
                <motion.div
                  key={id}
                  layout
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ layout: { type: "spring", damping: 26, stiffness: 260 }, duration: 0.25 }}
                >
                  <div
                    className={`flex h-12 items-center justify-between rounded-2xl px-4 transition-colors duration-300 ${
                      isLit ? "bg-success-100" : "bg-gray-50"
                    } ${isMe ? "ring-2 ring-gray-900" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 text-xs font-semibold tabular text-gray-400">{stage === "shuffle" || stage === "winners" || stage === "done" ? i + 1 : ""}</span>
                      <span className={`size-2 rounded-full transition-colors ${isLit ? "bg-success-600" : "bg-gray-300"}`} />
                      <span className="text-sm font-medium">{isMe ? "You" : handle(id)}</span>
                    </div>
                    <span className={`text-xs font-semibold tabular ${isLit ? "text-success-700" : "text-gray-500"}`}>
                      {isLit && w ? (w.seats < w.requested ? `${w.seats} / ${w.requested} seats` : `${w.seats} seat${w.seats > 1 ? "s" : ""}`) : `${e?.seats ?? 1} wanted`}
                    </span>
                  </div>
                  {i === cutoffAfter && (
                    <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.5, ease: "easeOut" }} className="my-2 flex origin-left items-center gap-2">
                      <div className="h-px flex-1 bg-gray-900" />
                      <span className="text-2xs font-semibold uppercase tracking-wide text-gray-900">seats full</span>
                      <div className="h-px flex-1 bg-gray-900" />
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {rows.mine && (
            <motion.div layout className="mt-1 flex flex-col gap-2">
              <div className="text-center text-xs text-gray-400">···</div>
              <div className="flex h-12 items-center justify-between rounded-2xl bg-gray-50 px-4 ring-2 ring-gray-900">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-xs font-semibold tabular text-gray-400">{stage === "shuffle" || stage === "winners" || stage === "done" ? rows.mine.rank : ""}</span>
                  <span className={`size-2 rounded-full ${winSeats.has(rows.mine.id) && (stage === "done" || stage === "winners") ? "bg-success-600" : "bg-gray-300"}`} />
                  <span className="text-sm font-semibold">You</span>
                </div>
              </div>
            </motion.div>
          )}
          {stage !== "done" && winnerRowsShown === 0 && rows.total === 0 && <div className="py-8 text-center text-sm text-gray-500">No entries</div>}
        </div>
      </LayoutGroup>
    </div>
  );
}

const caption = (s: Stage) =>
  ({ closing: "Step 1 · Cutoff", committed: "Step 2 · Commit", seed: "Step 3 · Seed", shuffle: "Step 4 · Shuffle", winners: "Step 5 · Seats", done: "Result" })[s];

const short = (tx: string) => (tx.length > 28 ? `${tx.slice(0, 14)}…${tx.slice(-8)}` : tx);
