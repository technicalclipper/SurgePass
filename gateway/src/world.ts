import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { sha256Hex } from "@surgepass/shared";
import { config } from "./config.ts";
import { redis } from "./redis.ts";

// World ID on the server: issue signed RP contexts (one-time nonces), verify proofs with the
// Developer Portal, pin the environment, bind the action and signal, and derive the anonymous ID.

const NONCE_TTL = 300;

export interface RpContextOut {
  app_id: string;
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
  action: string;
  signal?: string;
  environment: string;
  allow_legacy_proofs: boolean;
  dev: boolean;
}

const ALLOW_LEGACY = process.env.WORLD_ALLOW_LEGACY === "true";

/** Issues the signed context the IDKit widget needs. The nonce is remembered so only proofs we asked for are accepted. */
export async function issueRpContext(action: string, signal?: string): Promise<RpContextOut> {
  if (!config.world.configured) {
    const nonce = crypto.randomUUID();
    await redis.set(`wnonce:${nonce}`, JSON.stringify({ action, signal }), "EX", NONCE_TTL);
    const now = Math.floor(Date.now() / 1000);
    return {
      app_id: "dev",
      rp_context: { rp_id: "dev", nonce, created_at: now, expires_at: now + NONCE_TTL, signature: "dev" },
      action,
      signal,
      environment: "dev",
      allow_legacy_proofs: false,
      dev: true,
    };
  }
  const sig = signRequest({ signingKeyHex: config.world.signingKey, action, ttl: NONCE_TTL });
  await redis.set(`wnonce:${sig.nonce}`, JSON.stringify({ action, signal }), "EX", NONCE_TTL);
  return {
    app_id: config.world.appId,
    rp_context: { rp_id: config.world.rpId, nonce: sig.nonce, created_at: sig.createdAt, expires_at: sig.expiresAt, signature: sig.sig },
    action,
    signal,
    environment: config.world.environment,
    allow_legacy_proofs: ALLOW_LEGACY,
    dev: false,
  };
}

export type VerifyFailure =
  | "unknown_nonce"
  | "action_mismatch"
  | "signal_mismatch"
  | "environment_mismatch"
  | "malformed"
  | "rejected_by_world";

export type VerifyOutcome = { ok: true; anonId: string; nullifier: string } | { ok: false; reason: VerifyFailure };

/** Normalizes a nullifier (decimal or hex) so "0x01" and "1" map to the same value. */
function normalizeNullifier(n: string): string {
  return BigInt(n).toString(16);
}

/** Anonymous ID shown and stored everywhere: a hash of the RP-scoped nullifier and the action. */
export const anonIdFor = (nullifier: string, action: string) => `h_${sha256Hex(`${action}:${normalizeNullifier(nullifier)}`).slice(0, 20)}`;

/**
 * Verifies an IDKit result for `expectedAction` (and `expectedSignal`, when the request bound one).
 * The nonce is consumed atomically, so a proof can only ever be used once.
 */
export async function verifyProof(result: any, expectedAction: string, expectedSignal?: string): Promise<VerifyOutcome> {
  if (!result || typeof result !== "object" || typeof result.nonce !== "string" || !Array.isArray(result.responses) || !result.responses.length) {
    return { ok: false, reason: "malformed" };
  }
  const issued = await redis.getdel(`wnonce:${result.nonce}`);
  if (!issued) return { ok: false, reason: "unknown_nonce" };
  const ctx = JSON.parse(issued) as { action: string; signal?: string };
  if (ctx.action !== expectedAction || (result.action && result.action !== expectedAction)) return { ok: false, reason: "action_mismatch" };
  if ((expectedSignal ?? undefined) !== (ctx.signal ?? undefined)) return { ok: false, reason: "signal_mismatch" };

  const item = result.responses[0];

  if (!config.world.configured) {
    // Local development without a World app: a stand-in "nullifier" derived from a dev user name.
    if (result.environment !== "dev" || typeof item?.nullifier !== "string") return { ok: false, reason: "malformed" };
    const nullifier = BigInt("0x" + sha256Hex(`${item.nullifier}:${expectedAction}`)).toString();
    return { ok: true, nullifier, anonId: anonIdFor(nullifier, expectedAction) };
  }

  if (result.environment !== config.world.environment) return { ok: false, reason: "environment_mismatch" };
  if (typeof item?.nullifier !== "string") return { ok: false, reason: "malformed" };
  if (expectedSignal !== undefined && item.signal_hash && item.signal_hash.toLowerCase() !== hashSignal(expectedSignal).toLowerCase()) {
    return { ok: false, reason: "signal_mismatch" };
  }

  const res = await fetch(`https://developer.world.org/api/v4/verify/${config.world.rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...result, environment: config.world.environment }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) return { ok: false, reason: "rejected_by_world" };
  const v = (await res.json().catch(() => null)) as { success?: boolean; environment?: string } | null;
  if (v?.success !== true || (v.environment && v.environment !== config.world.environment)) return { ok: false, reason: "rejected_by_world" };

  return { ok: true, nullifier: item.nullifier, anonId: anonIdFor(item.nullifier, expectedAction) };
}

export const enterAction = (dropId: string) => `enter:${dropId}`;
export const linkAction = (agentAccount: string) => `agent-link:${agentAccount}`;
