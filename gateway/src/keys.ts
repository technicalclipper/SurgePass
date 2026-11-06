import { exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { config } from "./config.ts";

// One Ed25519 key signs sessions, agent tokens, passes and the X-SurgePass-Assertion header.
// Each token type has its own `typ`, so one can never be replayed as another.

if (!config.passSigningKey || !config.passPublicKey) {
  throw new Error("PASS_SIGNING_KEY / PASS_PUBLIC_KEY missing. Run `npm run setup:keys`.");
}
const pem = (b64: string) => Buffer.from(b64, "base64").toString("utf8");
const privateKey = await importPKCS8(pem(config.passSigningKey), "EdDSA");
const publicKey = await importSPKI(pem(config.passPublicKey), "EdDSA", { extractable: true });

export type TokenType = "session" | "agent" | "pass" | "assertion" | "approval";

export async function sign(typ: TokenType, claims: JWTPayload, ttlSec: number, audience?: string): Promise<string> {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", kid: config.passKeyId, typ })
    .setIssuer("surgepass")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSec);
  if (audience) jwt.setAudience(audience);
  return jwt.sign(privateKey);
}

export async function verify<T extends JWTPayload>(typ: TokenType, token: string | undefined | null, audience?: string): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload, protectedHeader } = await jwtVerify(token, publicKey, { issuer: "surgepass", audience });
    return protectedHeader.typ === typ ? (payload as T) : null;
  } catch {
    return null;
  }
}

export async function jwks() {
  const jwk = await exportJWK(publicKey);
  return { keys: [{ ...jwk, kid: config.passKeyId, alg: "EdDSA", use: "sig" }] };
}
