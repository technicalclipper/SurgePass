import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { randomBytes } from "node:crypto";
import { setEnv } from "./envfile.ts";

// Ed25519 key pair for passes and the X-SurgePass-Assertion header, plus an admin token.
const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
const b64 = (pem: string) => Buffer.from(pem).toString("base64");

const values: Record<string, string> = {
  PASS_SIGNING_KEY: b64(await exportPKCS8(privateKey)),
  PASS_PUBLIC_KEY: b64(await exportSPKI(publicKey)),
  PASS_KEY_ID: `sp-${Date.now().toString(36)}`,
};
if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN === "change-me") {
  values.ADMIN_TOKEN = randomBytes(18).toString("base64url");
}
setEnv(values);
console.log(`Wrote PASS_SIGNING_KEY, PASS_PUBLIC_KEY, PASS_KEY_ID=${values.PASS_KEY_ID}${values.ADMIN_TOKEN ? ", ADMIN_TOKEN" : ""} to .env`);
