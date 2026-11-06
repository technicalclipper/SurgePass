// Same-origin calls to the gateway (the room is served on the provider's domain).

export interface PublicDrop {
  id: string;
  label: string;
  subtitle?: string;
  pool: "normal" | "premium" | "partner";
  status: "scheduled" | "open" | "revealing" | "drawing" | "results";
  opensAt: number;
  closesAt: number;
  seats: number;
  maxSeatsPerEntry: number;
  priceInr?: number;
  premium?: { floorInr: number; ceilingInr: number; depositInr: number; revealSec: number };
  bookingUrl: string;
  passTtlSec: number;
  hcsTopicId?: string;
  topicLink?: string;
  peakOn: boolean;
  entries?: number;
}

export interface Status {
  drop: string;
  status: PublicDrop["status"];
  entries: number;
  topicLink?: string;
  you: { kind: "human" | "agent"; anonId: string } | null;
  entry?: { seats: number; seq: number; ts: number } | null;
  outcome?: { result: "won" | "waitlist" | "booked" | "expired" | "promoted_or_done"; seats?: number; requested?: number; partial?: boolean; position?: number; price?: number | null } | null;
  pass?: { seats: number; requested: number; price: number | null; status: string; expiresAt: number; booked?: number };
  released?: number;
  sealedBids?: number;
  bid?: { seats: number; sealed: boolean; seq: number; revealed: boolean; amount?: number } | null;
  clearingPriceInr?: number;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error ?? `HTTP ${r.status}`), { status: r.status, body });
  return body as T;
}

export const api = {
  drops: () => req<{ drops: PublicDrop[] }>("/_sp/api/drops").then((r) => r.drops),
  drop: (id: string) => req<PublicDrop>(`/_sp/api/drops/${id}`),
  status: (id: string) => req<Status>(`/_sp/api/drops/${id}/status`),
  worldContext: (dropId: string) => req<WorldContext>("/_sp/api/world/context", { method: "POST", body: JSON.stringify({ dropId }) }),
  worldVerify: (dropId: string, result: unknown) =>
    req<{ ok: true; anonId: string; entered: boolean }>("/_sp/api/world/verify", { method: "POST", body: JSON.stringify({ dropId, result }) }),
  enter: (id: string, seats: number) => req<{ ok: true }>(`/_sp/api/drops/${id}/enter`, { method: "POST", body: JSON.stringify({ seats }) }),
  entries: (id: string) => req<{ entries: { anonId: string; seats: number; seq: number; kind: string }[]; result: any }>(`/_sp/api/drops/${id}/entries`),
  verify: (id: string) => req<any>(`/_sp/api/drops/${id}/verify`),
  commit: (id: string, commit_hash: string, seats: number) =>
    req<{ ok: true }>(`/_sp/api/drops/${id}/bid/commit`, { method: "POST", body: JSON.stringify({ commit_hash, seats }) }),
  reveal: (id: string, amount: number, secret: string) => req<{ ok: true }>(`/_sp/api/drops/${id}/bid/reveal`, { method: "POST", body: JSON.stringify({ amount, secret }) }),
  claimReleased: (id: string, seats: number) => req<{ ok: true; consensusAt: string }>(`/_sp/api/drops/${id}/claim-released`, { method: "POST", body: JSON.stringify({ seats }) }),
  approval: (code: string) => req<Approval>(`/_sp/api/approvals/${code}`),
  approvalContext: (code: string, drop?: string) => req<WorldContext>(`/_sp/api/approvals/${code}/context`, { method: "POST", body: JSON.stringify({ drop }) }),
  approvalVerify: (code: string, drop: string | undefined, result: unknown) =>
    req<{ ok: true; status: string }>(`/_sp/api/approvals/${code}/verify`, { method: "POST", body: JSON.stringify({ drop, result }) }),
  approvalDecline: (code: string) => req<{ ok: true }>(`/_sp/api/approvals/${code}/decline`, { method: "POST", body: "{}" }),
};

export interface WorldContext {
  app_id: string;
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
  action: string;
  signal?: string;
  environment: string;
  allow_legacy_proofs: boolean;
  dev: boolean;
}

export interface Approval {
  code: string;
  kind: "drop" | "link";
  agent: string;
  status: "pending" | "approved" | "declined" | "expired";
  expiresAt: number;
  budgetInr?: number;
  spentInr: number;
  linked: boolean;
  items: { drop: string; label?: string; subtitle?: string; pool?: string; seats: number; maxBid?: number; approved: boolean }[];
}
