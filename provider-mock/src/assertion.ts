import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

// The ~10-line provider-side check from the README: verify X-SurgePass-Assertion with the
// gateway's published key, then cap seats (and charge the premium price) from it.

export interface Assertion extends JWTPayload {
  drop: string;
  pool: "normal" | "premium";
  seats: number;
  requested: number;
  price: number | null;
  pass_id: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function verifyAssertion(header: string | undefined, gatewayOrigin: string, audience: string): Promise<Assertion | null> {
  if (!header) return null;
  jwks ??= createRemoteJWKSet(new URL("/.well-known/jwks.json", gatewayOrigin));
  try {
    const { payload } = await jwtVerify(header, jwks, { issuer: "surgepass", audience });
    return payload as Assertion;
  } catch {
    return null;
  }
}
