import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "@surgepass/shared/env";

// The agent remembers its link, pending approvals and per-drop tokens between tool calls.

const FILE = resolve(REPO_ROOT, ".surgepass/agent-state.json");

export interface PendingApproval {
  userCode: string;
  deviceCode: string;
  approvalUrl: string;
  drops: string[];
  kind: "drop" | "link";
  createdAt: number;
}

export interface AgentState {
  linked?: { budgetInr: number; linkedAt: number; expiresAt: number };
  pending: PendingApproval[];
  tokens: Record<string, { token: string; seats: number; maxBid?: number; expiresAt: number }>;
  spentInr: number;
  payments: { at: number; amountInr: number; txId: string; url: string }[];
  bids: Record<string, { amount: number; secret: string; seats: number }>;
}

export function load(): AgentState {
  if (!existsSync(FILE)) return { pending: [], tokens: {}, spentInr: 0, payments: [], bids: {} };
  return { bids: {}, ...JSON.parse(readFileSync(FILE, "utf8")) };
}

export function save(s: AgentState) {
  const dir = resolve(REPO_ROOT, ".surgepass");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}
