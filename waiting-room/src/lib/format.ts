import { useEffect, useState } from "react";

export const inr = (n: number, digits = 0) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Short, friendly handle for an anonymous ID. */
export const handle = (anonId: string) => `human·${anonId.slice(2, 6)}`;

export function hapticTap() {
  try {
    navigator.vibrate?.(8);
  } catch {
    // not supported
  }
}
