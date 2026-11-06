export type Pool = "normal" | "premium" | "partner";

export type MatchLocation = "query" | "path" | "header" | "body";
export type MatchOperator = "equals" | "in" | "exists";

/** One match condition, e.g. query.quota equals TQ. All conditions on a drop are ANDed. */
export interface MatchCondition {
  location: MatchLocation;
  key: string;
  operator: MatchOperator;
  value?: string | string[];
}

export type PeakMode = "auto" | "on" | "off";

export interface PeakConfig {
  mode: PeakMode;
  /** Absolute windows (epoch ms) during which the drop is gated. */
  schedule: { start: number; end: number }[];
  /** Turn peak on automatically when the backend crosses either threshold. */
  loadTrigger?: { p95Ms: number; errorRate: number };
}

export interface ReadPricing {
  /** Free availability checks per human per window. */
  freePerWindow: number;
  windowSec: number;
  /** Surge range in INR per paid request. */
  minInr: number;
  maxInr: number;
}

export interface PremiumConfig {
  floorInr: number;
  ceilingInr: number;
  depositInr: number;
  /** Seconds after close during which sealed bids are revealed. */
  revealSec: number;
}

/** Partner lane: only allowlisted partner accounts can hold this drop's seat tokens. */
export interface PartnerConfig {
  /** Max seats one partner can hold or use in this drop. */
  capPerPartner: number;
  /** Refundable deposit per seat, in INR, paid via x402 when holding. */
  depositInr: number;
  /** Seconds a partner has to book on the provider after receiving seat tokens. */
  bookWithinSec: number;
  /** Seconds after opening before partners may hold (e.g. keep the first minutes for the public). */
  openDelaySec: number;
  /** Public drop that receives unused partner seats (its waitlist). */
  spillTo?: string;
  /** HTS token id of this drop's seat tokens. */
  tokenId?: string;
}

export type DropStatus = "scheduled" | "open" | "revealing" | "drawing" | "results";

export interface Drop {
  id: string;
  label: string;
  subtitle?: string;
  pool: Pool;
  /** Provider host this drop belongs to (informational; the gateway fronts one provider). */
  host?: string;
  /** Booking route pattern covering every step of the flow, e.g. /tatkal/book/:trainNo/:date/:class */
  pattern: string;
  /** Values the path params must have. A param left out matches any value. */
  values: Record<string, string>;
  conditions: MatchCondition[];
  /** When set, only this exact path + query is gated. */
  exactUrl?: string;
  /** Read (availability / status) route patterns. Params share names with `pattern`. */
  readPatterns: string[];
  /** Final booking step, e.g. /tatkal/book/:trainNo/:date/:class/confirm */
  finalStepPattern: string;
  finalStepMethod: string;
  /** Dot path in the final step's JSON response holding the confirmed seat count. */
  confirmedSeatsField?: string;
  /** Where winners are sent to book. */
  bookingUrl: string;
  seats: number;
  maxSeatsPerEntry: number;
  priceInr?: number;
  opensAt: number;
  closesAt: number;
  passTtlSec: number;
  peak: PeakConfig;
  readPricing: ReadPricing;
  premium?: PremiumConfig;
  partner?: PartnerConfig;
  hcsTopicId?: string;
  status: DropStatus;
  createdAt: number;
}

export type EntrantKind = "human" | "agent";

export interface Entry {
  anonId: string;
  kind: EntrantKind;
  seats: number;
  agentAccount?: string;
  /** Order key: HCS sequence number (or local sequence in local mode). */
  seq: number;
  consensusAt?: string;
  ts: number;
}

export interface Allocation {
  anonId: string;
  requested: number;
  seats: number;
}

export interface DrawResult {
  dropId: string;
  policy: "fisher-yates" | "premium-clearing";
  seed: string;
  seedTxId?: string;
  entryCount: number;
  lastSeq: number;
  order: string[];
  winners: Allocation[];
  waitlist: { anonId: string; requested: number }[];
  clearingPriceInr?: number;
  winnersHash: string;
  computedAt: number;
}

export interface PassClaims {
  [key: string]: unknown;
  /** Set for partner-lane passes: the partner's Hedera account. */
  partner?: string;
  drop: string;
  sub: string;
  pool: Pool;
  seats: number;
  requested: number;
  price: number | null;
  jti: string;
}

export interface PassRecord extends PassClaims {
  issuedAt: number;
  expiresAt: number;
  status: "issued" | "used" | "expired";
  booked?: number;
}

/** Messages written to a drop's HCS topic. */
export type HcsMessage =
  | { t: "drop_created"; drop: string; pool: Pool; seats: number; opensAt: number; closesAt: number }
  | { t: "peak_on"; drop: string; ts: number }
  | { t: "peak_off"; drop: string; ts: number }
  | { t: "entry"; drop: string; anon_id: string; kind: EntrantKind; seats: number; agent_account?: string }
  | { t: "claim"; drop: string; anon_id: string; seats: number }
  | { t: "bid_commit"; drop: string; anon_id: string; commit_hash: string; seats: number }
  | { t: "bid_reveal"; drop: string; anon_id: string; amount: number; secret: string }
  | { t: "window_closed"; drop: string; entry_count: number; last_seq: number; seed_tx_id: string; seats?: number }
  | { t: "result"; drop: string; policy: string; seed: string; winners_hash: string; price?: number }
  | { t: "pass_issued"; drop: string; jti_hash: string; seats: number }
  | { t: "seats_released"; drop: string; jti_hash: string; count: number }
  | { t: "agent_spend"; agent_account: string; amount_inr: number; tx_id: string }
  | { t: "partner_allowed"; drop: string; partner: string; token: string }
  | { t: "partner_hold"; drop: string; partner: string; seats: number; hold: string }
  | { t: "seats_allocated"; drop: string; partner: string; serials: number[]; hold: string }
  | { t: "seats_redeemed"; drop: string; partner: string; serials: number[] }
  | { t: "seats_reclaimed"; drop: string; partner: string; serials: number[]; to?: string }
  | { t: "partner_frozen"; partner: string; frozen: boolean };

/** Live events streamed to the dashboard and demo screen. */
export interface LiveEvent {
  ts: number;
  kind: "bot" | "agent" | "human" | "surge" | "draw" | "pass" | "system" | "forward";
  method?: string;
  path?: string;
  status?: number;
  note?: string;
  drop?: string;
  txId?: string;
  hcsSeq?: number;
  /** "direct": a response from the site that is NOT behind SurgePass (demo baseline). */
  side?: "direct";
  /** How the gate handled the request, step by step. */
  trace?: TraceStep[];
  /** Time the gate itself spent deciding, in microseconds (excludes the provider's response time). */
  us?: number;
  /** Set on the decisions the Compare page lists: who tried what, and whether they got through. */
  outcome?: Outcome;
}

export interface Outcome {
  actor: "person" | "agent" | "partner";
  ok: boolean;
  who: string;
  action: string;
}

export interface TraceStep {
  step: "request" | "match" | "peak" | "identity" | "world" | "entry" | "pass" | "quota" | "payment" | "budget" | "decision" | "upstream";
  detail: string;
  /** true = check passed, false = check failed, undefined = informational. */
  ok?: boolean;
}
