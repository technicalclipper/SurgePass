import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { JWTPayload } from "jose";
import { sign, verify } from "./keys.ts";
import { SESSION_COOKIE } from "./proxy.ts";

// Who sent a request: a verified human (session cookie), a human-backed agent (bearer token),
// or nobody we know of. Local signature checks only, no network calls.

export interface SessionClaims extends JWTPayload {
  sub: string; // anonId for this drop
  drop: string;
}

export interface AgentTokenClaims extends JWTPayload {
  sub: string; // anonId of the human behind the agent, for this drop
  drop: string;
  agent: string; // agent's Hedera account
  seats: number;
  maxBid?: number;
}

export type Requester =
  | { kind: "human"; anonId: string; drop: string }
  | { kind: "agent"; anonId: string; drop: string; agent: string; seats: number; maxBid?: number }
  | { kind: "anonymous" };

/** Session cookies are per drop: sp_session holds a small JSON map of dropId → token. */
export function sessionTokens(c: Context): Record<string, string> {
  try {
    return JSON.parse(decodeURIComponent(getCookie(c, SESSION_COOKIE) ?? "{}"));
  } catch {
    return {};
  }
}

export async function who(c: Context, dropId?: string): Promise<Requester> {
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) {
    const t = await verify<AgentTokenClaims>("agent", auth.slice(7));
    if (t && (!dropId || t.drop === dropId)) return { kind: "agent", anonId: t.sub, drop: t.drop, agent: t.agent, seats: t.seats, maxBid: t.maxBid };
  }
  const tokens = sessionTokens(c);
  const candidates = dropId ? [tokens[dropId]] : Object.values(tokens);
  for (const tok of candidates) {
    const s = await verify<SessionClaims>("session", tok);
    if (s && (!dropId || s.drop === dropId)) return { kind: "human", anonId: s.sub, drop: s.drop };
  }
  return { kind: "anonymous" };
}

export async function issueSession(c: Context, anonId: string, dropId: string, ttlSec: number) {
  const token = await sign("session", { sub: anonId, drop: dropId }, ttlSec);
  const tokens = sessionTokens(c);
  tokens[dropId] = token;
  c.header(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(JSON.stringify(tokens))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSec}${new URL(c.req.url).protocol === "https:" ? "; Secure" : ""}`,
    { append: true },
  );
  return token;
}
