import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import type { LiveEvent } from "../lib/live";
import { LogDetail, LogStream } from "./console";
import { PauseIcon, PlayIcon } from "./icons";

// A log box that scrolls instead of cutting off, with "Expand" to read it full screen:
// a large centered window with every recent line, traces, and Pause so a flood stops moving.

export function LogPanel({
  title,
  tone = "gray",
  events,
  modalEvents,
  traces = false,
  inlineMax = 40,
  className = "",
  children,
}: {
  title: string;
  tone?: "gray" | "success" | "error";
  events: LiveEvent[];
  /** What the full-screen view lists (defaults to `events`). */
  modalEvents?: LiveEvent[];
  traces?: boolean;
  inlineMax?: number;
  className?: string;
  /** Extra content above the log (e.g. the pinned people box). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const color = tone === "success" ? "text-success-700" : tone === "error" ? "text-error-700" : "text-gray-500";
  return (
    <>
      <div className={`flex min-h-0 flex-col overflow-hidden rounded-2xl bg-gray-0 p-4 ${className}`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className={`text-sm font-bold uppercase tracking-wide ${color}`}>{title}</div>
          <button
            onClick={() => setOpen(true)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-3 text-xs font-semibold text-gray-900 hover:bg-gray-200"
            title="Open full screen"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
            Expand
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {children}
          <LogStream events={events} max={inlineMax} dense traces={traces} />
        </div>
      </div>
      <AnimatePresence>{open && <LogModal title={title} color={color} events={modalEvents ?? events} traces={traces} onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  );
}

function LogModal({ title, color, events, traces, onClose }: { title: string; color: string; events: LiveEvent[]; traces: boolean; onClose: () => void }) {
  const [frozen, setFrozen] = useState<LiveEvent[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number | undefined>();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const source = frozen ?? events;
  const q = query.trim().toLowerCase();
  const shown = q ? source.filter((e) => `${e.kind} ${e.method ?? ""} ${e.path ?? ""} ${e.status ?? ""} ${e.note ?? ""} ${e.trace?.map((t) => t.detail).join(" ") ?? ""}`.toLowerCase().includes(q)) : source;
  // The picked line, or the newest one, so the right side is never empty while there's traffic.
  const selected = shown.find((e) => e._id === picked) ?? shown.at(-1);

  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-gray-900/50 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.97, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 10 }}
        transition={{ type: "spring", damping: 30, stiffness: 340 }}
        className="flex h-[88vh] w-[min(1320px,96vw)] flex-col overflow-hidden rounded-3xl bg-gray-0 shadow-lifted"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-6 py-4">
          <div>
            <div className={`text-sm font-bold uppercase tracking-wide ${color}`}>{title}</div>
            <div className="mt-0.5 text-xs text-gray-500">
              {shown.length} line{shown.length === 1 ? "" : "s"} · newest first · {frozen ? "paused" : "live"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter: 402, waiting room, World ID…" className="h-10 w-72 rounded-full border border-gray-200 pl-10 pr-4 text-sm outline-none focus:border-gray-400" />
            </div>
            <button
              onClick={() => setFrozen(frozen ? null : [...events])}
              className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold ${frozen ? "bg-warning-100 text-warning-700" : "bg-gray-900 text-gray-0"}`}
            >
              {frozen ? (
                <>
                  <PlayIcon /> Resume
                </>
              ) : (
                <>
                  <PauseIcon /> Pause
                </>
              )}
            </button>
            <button onClick={onClose} className="grid size-10 place-items-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200" title="Close (Esc)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]">
          <div className="min-h-0 overflow-y-auto px-3 py-2">
            <LogStream events={shown} max={400} traces={traces} selectedId={selected?._id} onSelect={(e) => setPicked(e._id)} />
          </div>
          <aside className="hidden min-h-0 overflow-y-auto border-l border-gray-100 bg-gray-50/60 p-6 lg:block">
            <LogDetail e={selected} />
          </aside>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Two event lists merged without duplicates, in time order (people are kept apart from bot lines upstream). */
export function mergedEvents(a: LiveEvent[], b: LiveEvent[]): LiveEvent[] {
  return [...new Map([...a, ...b].map((e) => [e._id ?? `${e.ts}${e.note}`, e])).values()].sort((x, y) => x.ts - y.ts);
}
