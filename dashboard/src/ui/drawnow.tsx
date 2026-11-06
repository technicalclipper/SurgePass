import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { admin, GATEWAY, type Drop } from "../lib/api";
import { useLive } from "../lib/live";

// "End now": confirm in an in-app window, then watch the draw happen on Hedera, step by step.

const COPY = {
  normal: {
    button: "End now & draw",
    title: "End entries and draw now?",
    steps: ["Entries close", "Cutoff written to Hedera", "Random seed from Hedera", "Winners drawn · passes issued"],
    go: "Draw now",
  },
  premium: {
    button: "End bidding now",
    title: "End bidding now?",
    steps: ["Bidding closes", "Sealed bids revealed (about 15 s)", "Tie-break seed from Hedera", "Clearing price set · passes issued"],
    go: "End bidding",
  },
  partner: {
    button: "Close partner quota",
    title: "Close the partner quota now?",
    steps: ["Partners can no longer hold seats", "Seats already handed out stay valid until their deadline", "Unused seats return to the public draw"],
    go: "Close quota",
  },
} as const;

/** The button only opens the window; the window lives on the card so it survives the drop changing status. */
export function EndNowButton({ pool, onClick }: { pool: Drop["pool"]; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full bg-gray-900 pl-3.5 pr-5 text-sm font-semibold text-gray-0 shadow-sm transition hover:bg-gray-700 active:scale-[0.98]"
    >
      <span className="grid size-6 place-items-center rounded-full bg-gray-0/15">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <rect x="5" y="5" width="14" height="14" rx="2.5" />
        </svg>
      </span>
      {COPY[pool].button}
    </button>
  );
}

export function EndNow({ open, drop, onClose }: { open: boolean; drop: Drop; onClose: () => void }) {
  return <AnimatePresence>{open && <EndNowModal drop={drop} onClose={onClose} />}</AnimatePresence>;
}

type Phase = "confirm" | "running" | "done" | "error";

function EndNowModal({ drop, onClose }: { drop: Drop; onClose: () => void }) {
  const live = useLive();
  const c = COPY[drop.pool];
  const [phase, setPhase] = useState<Phase>("confirm");
  const [startedAt, setStartedAt] = useState(0);
  const [entries, setEntries] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(drop.entries ?? 0);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && phase !== "running" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  // Draw progress for this drop, as broadcast by the gateway.
  const msgs = useMemo(() => live.other.filter((m) => m.drop === drop.id && m.ts >= startedAt && (m.type === "draw" || m.type === "drop")), [live.other, startedAt, drop.id]);
  const has = (p: string) => msgs.some((m) => m.type === "draw" && m.phase === p);
  const seed = msgs.find((m) => m.phase === "seed")?.seed as string | undefined;
  const result = msgs.find((m) => m.phase === "result");
  const reached =
    drop.pool === "partner"
      ? phase === "done"
        ? 3
        : 1
      : result
        ? 4
        : has("seed")
          ? 3
          : has("closed") || has("revealing")
            ? 2
            : phase === "running"
              ? 1
              : 0;

  useEffect(() => {
    if (phase === "running" && (result || (drop.pool === "partner" && msgs.length))) setPhase("done");
  }, [result, msgs.length, phase]);

  async function go() {
    setStartedAt(Date.now() - 500);
    setPhase("running");
    try {
      await admin(`/drops/${drop.id}/close`, { method: "POST" });
      if (drop.pool === "partner") setTimeout(() => setPhase("done"), 800);
    } catch (e: any) {
      setError(e.message);
      setPhase("error");
    }
  }

  const winners = (result?.winners as unknown[] | undefined)?.length ?? 0;

  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-gray-900/50 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => phase !== "running" && onClose()}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.96, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 10 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        className="w-[min(520px,94vw)] rounded-3xl bg-gray-0 p-7 shadow-lifted"
      >
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">{drop.label}</div>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.01em]">
          {phase === "confirm" ? c.title : phase === "done" ? (drop.pool === "partner" ? "Partner quota closed" : `${winners} winner${winners === 1 ? "" : "s"} drawn`) : phase === "error" ? "Couldn't end it" : "Ending now…"}
        </h2>
        {phase === "confirm" && (
          <p className="mt-2 text-sm text-gray-500">
            {drop.pool === "partner"
              ? "Partners stop holding seats immediately."
              : `${entries ?? "…"} ${entries === 1 ? "entry" : "entries"} for ${drop.seats} seat${drop.seats === 1 ? "" : "s"}. The scheduled end was ${new Date(drop.closesAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST.`}
          </p>
        )}

        <ol className="mt-6 flex flex-col gap-3">
          {c.steps.map((s, i) => {
            const state = phase === "confirm" ? "todo" : i < reached ? "done" : i === reached && phase === "running" ? "active" : phase === "done" ? "done" : "todo";
            return (
              <li key={s} className="flex items-center gap-3">
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors ${
                    state === "done" ? "bg-success-600 text-gray-0" : state === "active" ? "bg-gray-900 text-gray-0" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {state === "done" ? "✓" : state === "active" ? <span className="size-3 animate-spin rounded-full border-2 border-gray-0/30 border-t-gray-0" /> : i + 1}
                </span>
                <span className={`text-sm ${state === "todo" ? "text-gray-500" : "font-medium text-gray-900"}`}>
                  {s}
                  {i === 2 && seed && drop.pool !== "partner" && <span className="ml-2 font-mono text-xs text-gray-500">0x{seed.slice(0, 16)}…</span>}
                </span>
              </li>
            );
          })}
        </ol>

        {error && <div className="mt-4 rounded-xl bg-error-100 px-4 py-3 text-sm text-error-700">{error}</div>}

        <div className="mt-7 flex items-center justify-end gap-3">
          {phase === "confirm" && (
            <>
              <button onClick={onClose} className="h-11 rounded-full px-5 text-sm font-semibold text-gray-700 hover:bg-gray-100">
                Cancel
              </button>
              <button onClick={go} className="h-11 whitespace-nowrap rounded-full bg-gray-900 px-6 text-sm font-semibold text-gray-0 hover:bg-gray-700 active:scale-[0.98]">
                {c.go}
              </button>
            </>
          )}
          {phase === "running" && <span className="text-sm text-gray-500">Writing to Hedera…</span>}
          {(phase === "done" || phase === "error") && (
            <>
              {phase === "done" && drop.pool !== "partner" && (
                <a href={`${GATEWAY}/_sp/room/verify/${drop.id}`} target="_blank" rel="noreferrer" className="h-11 whitespace-nowrap rounded-full px-5 text-sm font-semibold leading-[44px] text-info-600 hover:bg-info-100">
                  Check the result ↗
                </a>
              )}
              <button onClick={onClose} className="h-11 rounded-full bg-gray-900 px-6 text-sm font-semibold text-gray-0 hover:bg-gray-700">
                Done
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
