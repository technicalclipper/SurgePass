// npm install jose
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(new URL("https://gate.example.com/.well-known/jwks.json"));
const AUDIENCE = "tickets.example.com"; // your own host

/** Pass details, or null when the request wasn't gated. Throws if the header is forged or expired. */
export async function surgePass(headers) {
  const token = headers["x-surgepass-assertion"];
  if (!token) return null;
  const { payload, protectedHeader } = await jwtVerify(token, JWKS, { issuer: "surgepass", audience: AUDIENCE, algorithms: ["EdDSA"] });
  if (protectedHeader.typ !== "assertion") throw new Error("not a SurgePass assertion");
  return payload; // { drop, pool, seats, price, partner, pass_id }
}
