import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";

// Layout and small building blocks on top of the World UI kit (see DESIGN.md).

export function Screen({ children, bottom }: { children: ReactNode; bottom?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-gray-0">
      <div className="flex-1 px-6 pb-8">{children}</div>
      {bottom && (
        <div className="sticky bottom-0 bg-gradient-to-t from-gray-0 via-gray-0 to-gray-0/0 px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-4">{bottom}</div>
      )}
    </div>
  );
}

export function Header({ title, onBack, right }: { title?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="flex h-[4.5rem] items-center justify-between gap-4 pt-6">
      <div className="w-10">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="grid size-10 place-items-center rounded-full bg-gray-100 text-gray-900 active:scale-95">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
        )}
      </div>
      <div className="text-sm font-semibold text-gray-900">{title}</div>
      <div className="flex w-10 justify-end">{right}</div>
    </div>
  );
}

export function Mark() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="grid size-6 place-items-center rounded-full bg-gray-900 text-[11px] font-semibold text-gray-0">S</span>
      <span className="text-sm font-semibold tracking-[-0.01em]">SurgePass</span>
    </div>
  );
}

export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`rounded-2xl bg-gray-50 p-4 ${onClick ? "cursor-pointer active:scale-[0.99] transition-transform" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function Row({ label, value, sub, onClick, accent }: { label: ReactNode; value?: ReactNode; sub?: ReactNode; onClick?: () => void; accent?: "info" }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="flex min-h-[4.75rem] w-full items-center justify-between gap-3 rounded-2xl bg-gray-50 p-4 text-left disabled:cursor-default enabled:active:scale-[0.99] transition-transform"
    >
      <div className="min-w-0">
        <div className="text-base font-medium leading-narrow text-gray-900">{label}</div>
        {sub && <div className="mt-1 text-sm leading-compact text-gray-500">{sub}</div>}
      </div>
      <div className={`shrink-0 text-sm font-semibold ${accent === "info" ? "text-info-600" : "text-gray-900"}`}>{value}</div>
    </button>
  );
}

export function PrimaryButton({ children, onClick, disabled, loading, tone = "dark", href }: { children: ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean; tone?: "dark" | "success"; href?: string }) {
  const cls = `flex h-14 w-full items-center justify-center gap-2 rounded-full text-base font-semibold transition-all active:scale-[0.98] disabled:bg-gray-100 disabled:text-gray-300 ${
    tone === "success" ? "bg-success-600 text-gray-0" : "bg-gray-900 text-gray-0"
  }`;
  const inner = loading ? <span className="size-5 animate-spin rounded-full border-2 border-gray-0/30 border-t-gray-0" /> : children;
  if (href) return <a href={href} className={cls} onClick={() => navigator.vibrate?.(8)}>{inner}</a>;
  return (
    <button className={cls} disabled={disabled || loading} onClick={() => { navigator.vibrate?.(8); onClick?.(); }}>
      {inner}
    </button>
  );
}

export function GhostButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="h-12 w-full rounded-full text-sm font-semibold text-gray-500 active:scale-[0.98]">
      {children}
    </button>
  );
}

export function Chip({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "success" | "warning" | "error" | "info" | "purple" | "dark" }) {
  const t = {
    gray: "bg-gray-100 text-gray-700",
    success: "bg-success-100 text-success-700",
    warning: "bg-warning-100 text-warning-700",
    error: "bg-error-100 text-error-700",
    info: "bg-info-100 text-info-700",
    purple: "bg-purple-soft text-purple",
    dark: "bg-gray-900 text-gray-0",
  }[tone];
  return <span className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${t}`}>{children}</span>;
}

/** A number that counts smoothly to its new value. */
export function Num({ value, format = (n: number) => Math.round(n).toLocaleString("en-IN"), className = "" }: { value: number; format?: (n: number) => string; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.6, ease: "easeOut" });
    return c.stop;
  }, [value, mv]);
  return <motion.span className={`tabular ${className}`}>{text}</motion.span>;
}

/** Hex digits spin like a slot reel and settle left to right on the real seed. */
export function SeedReel({ seed, className = "" }: { seed?: string; className?: string }) {
  const len = 16;
  const [shown, setShown] = useState("".padEnd(len, "·"));
  useEffect(() => {
    const H = "0123456789abcdef";
    let settled = 0;
    const start = Date.now();
    const t = setInterval(() => {
      if (seed) settled = Math.min(len, Math.floor((Date.now() - start) / 70));
      setShown(Array.from({ length: len }, (_, i) => (seed && i < settled ? seed[i]! : H[Math.floor(Math.random() * 16)]!)).join(""));
      if (seed && settled >= len) clearInterval(t);
    }, 40);
    return () => clearInterval(t);
  }, [seed]);
  return <span className={`font-mono tabular tracking-[0.08em] ${className}`}>0x{shown}</span>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block size-5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900 ${className}`} />;
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <motion.div className="absolute inset-0 bg-gray-900/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-sheet bg-gray-0 px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-lifted"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 320 }}
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-gray-200" />
        {children}
      </motion.div>
    </div>
  );
}

export function HumanBadge() {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-gray-100 px-2 text-2xs font-semibold text-gray-700">
      <span className="size-2 rounded-full bg-gray-900" /> human
    </span>
  );
}
