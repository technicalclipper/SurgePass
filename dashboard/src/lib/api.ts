// Admin API on the gateway (bearer ADMIN_TOKEN, entered once and kept in this browser).

export const GATEWAY: string = (import.meta.env.VITE_GATEWAY_ORIGIN as string | undefined) ?? "http://localhost:8080";

export function getToken() {
  try {
    return localStorage.getItem("sp_admin_token") || ((import.meta.env.VITE_DEV_ADMIN_TOKEN as string | undefined) ?? "");
  } catch {
    return "";
  }
}
export function setToken(t: string) {
  try {
    localStorage.setItem("sp_admin_token", t);
  } catch {
    // session only
  }
}

export async function admin<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${GATEWAY}/_sp/admin${path}`, {
    ...init,
    headers: { authorization: `Bearer ${getToken()}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error ?? `HTTP ${r.status}`), { status: r.status, body });
  return body as T;
}

export async function publicApi<T>(path: string): Promise<T> {
  return (await fetch(`${GATEWAY}/_sp/api${path}`)).json() as Promise<T>;
}

export interface Drop {
  id: string;
  label: string;
  subtitle?: string;
  pool: "normal" | "premium";
  host?: string;
  pattern: string;
  values: Record<string, string>;
  conditions: { location: string; key: string; operator: string; value?: string | string[] }[];
  exactUrl?: string;
  readPatterns: string[];
  finalStepPattern: string;
  finalStepMethod: string;
  confirmedSeatsField?: string;
  bookingUrl: string;
  seats: number;
  maxSeatsPerEntry: number;
  priceInr?: number;
  opensAt: number;
  closesAt: number;
  passTtlSec: number;
  peak: { mode: "auto" | "on" | "off"; schedule: { start: number; end: number }[]; loadTrigger?: { p95Ms: number; errorRate: number } };
  readPricing: { freePerWindow: number; windowSec: number; minInr: number; maxInr: number };
  premium?: { floorInr: number; ceilingInr: number; depositInr: number; revealSec: number };
  hcsTopicId?: string;
  status: "scheduled" | "open" | "revealing" | "drawing" | "results";
  peakOn: boolean;
  createdAt: number;
}

export const hashscanTopic = (id?: string) => (id && !id.startsWith("local-") ? `https://hashscan.io/testnet/topic/${id}` : undefined);
export const hashscanTx = (id?: string) => (id && !id.startsWith("local") ? `https://hashscan.io/testnet/transaction/${id}` : undefined);
