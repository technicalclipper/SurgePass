import { AccountId, Client, PrivateKey, TokenAssociateTransaction } from "@hiero-ledger/sdk";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner } from "@x402/hedera";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { env, isConfigured, REPO_ROOT } from "@surgepass/shared/env";

// Reference partner (a travel app, an agent's back office, a reseller) using the partner lane.
// Every call is signed with the partner's Hedera key; deposits and lookups are paid via x402.
//   npm run partner -- --as tripnest whoami
//   npm run partner -- --as tripnest associate <drop>     (live: associate the seat token)
//   npm run partner -- --as tripnest join <drop>
//   npm run partner -- --as tripnest look <drop>
//   npm run partner -- --as tripnest hold <drop> 2
//   npm run partner -- --as tripnest wait <drop>
//   npm run partner -- --as tripnest book <drop> Asha Ravi
//   npm run partner -- --as tripnest holds <drop>

const GATEWAY = env("GATEWAY_ORIGIN", "http://localhost:8080");
const NETWORK = env("HEDERA_NETWORK", "testnet");

const args = process.argv.slice(2);
const asIdx = args.indexOf("--as");
const NAME = (asIdx >= 0 ? args.splice(asIdx, 2)[1] : "tripnest")!.toLowerCase();
const [cmd, dropQuery, ...rest] = args;

function parseKey(k: string): PrivateKey {
  const hex = k.startsWith("0x") ? k.slice(2) : k;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? PrivateKey.fromStringECDSA(hex) : PrivateKey.fromStringDer(k);
}

/** Live partner keys from .env (PARTNER_<NAME>_ACCOUNT_ID / _PRIVATE_KEY), otherwise a local key on disk. */
function identity() {
  const idVar = `PARTNER_${NAME.toUpperCase()}_ACCOUNT_ID`;
  const keyVar = `PARTNER_${NAME.toUpperCase()}_PRIVATE_KEY`;
  if (isConfigured(idVar, keyVar)) {
    const key = parseKey(env(keyVar));
    return { account: env(idVar), key, live: true };
  }
  const dir = resolve(REPO_ROOT, ".surgepass");
  const file = resolve(dir, `partner-${NAME}.json`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ account: `0.0.local-${NAME}`, key: PrivateKey.generateED25519().toStringDer() }, null, 2));
  }
  const j = JSON.parse(readFileSync(file, "utf8"));
  return { account: j.account as string, key: PrivateKey.fromStringDer(j.key), live: false };
}

const me = identity();
const keyType = me.key.type === "secp256k1" ? "ECDSA" : "ED25519";
const scheme = me.live ? new ExactHederaScheme(createClientHederaSigner(me.account, me.key, { network: `hedera:${NETWORK}` })) : null;

async function call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const method = init.method ?? "GET";
  const body = init.body === undefined ? "" : JSON.stringify(init.body);
  const ts = String(Date.now());
  const msg = `${ts}\n${method}\n${path}\n${createHash("sha256").update(body).digest("hex")}`;
  const sig = Buffer.from(me.key.sign(Buffer.from(msg))).toString("hex");
  const r = await fetch(new URL(path, GATEWAY), {
    method,
    body: method === "GET" ? undefined : body,
    headers: { "content-type": "application/json", "x-partner-account": me.account, "x-partner-timestamp": ts, "x-partner-signature": sig, ...(init.headers ?? {}) },
  });
  return { status: r.status, headers: r.headers, body: (await r.json().catch(() => ({}))) as any };
}

/** Signed call that pays a 402 (lookup fee or deposit) and retries once. */
async function paid(path: string, init: { method?: string; body?: unknown } = {}) {
  let r = await call(path, init);
  if (r.status !== 402) return r;
  const req = r.body.accepts?.[0] as PaymentRequirements;
  const payload = req.extra?.mode === "local" || !scheme ? { transaction: "local", payer: me.account } : (await scheme.createPaymentPayload(2, req)).payload;
  const header = encodePaymentSignatureHeader({ x402Version: 2, resource: r.body.resource, accepted: req, payload } as any);
  console.log(`  paying ₹${r.body.priceInr} via x402 (${r.body.resource?.description ?? path})`);
  r = await call(path, { ...init, headers: { "PAYMENT-SIGNATURE": header } });
  return r;
}

async function findDrop(q?: string, needDetails = false): Promise<any> {
  if (!needDetails && q && /-partner-[a-z0-9]+$/.test(q)) return { id: q }; // a full drop id: no need to list first
  const r = await call("/_sp/api/partner/drops");
  if (r.status !== 200) {
    console.log(`${r.status} ${JSON.stringify(r.body)}`);
    process.exit(1);
  }
  const d = (r.body.drops as any[]).find((x) => x.id === q) ?? (r.body.drops as any[]).find((x) => !q || `${x.label} ${x.id}`.toLowerCase().includes(q.toLowerCase()));
  if (!d) throw new Error(`no partner drop matches "${q}"`);
  return d;
}

const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));

switch (cmd) {
  case "whoami":
    out({ name: NAME, account: me.account, publicKey: me.key.publicKey.toStringRaw(), keyType, live: me.live });
    break;
  case "drops":
    out((await call("/_sp/api/partner/drops")).body);
    break;
  case "associate": {
    const d = await findDrop(dropQuery, true);
    if (!me.live) {
      console.log("local mode: no association needed");
      break;
    }
    const client = NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet();
    client.setOperator(AccountId.fromString(me.account), me.key);
    try {
      const tx = await new TokenAssociateTransaction().setAccountId(me.account).setTokenIds([d.tokenId]).freezeWith(client).sign(me.key);
      await (await tx.execute(client)).getReceipt(client);
      console.log(`associated ${d.tokenId}`);
    } catch (e) {
      console.log(String(e).includes("TOKEN_ALREADY_ASSOCIATED") ? "already associated" : String(e));
    }
    client.close();
    break;
  }
  case "join":
    out((await call(`/_sp/api/partner/drops/${(await findDrop(dropQuery)).id}/join`, { method: "POST", body: {} })).body);
    break;
  case "look":
    out((await paid(`/_sp/api/partner/drops/${(await findDrop(dropQuery)).id}/availability`)).body);
    break;
  case "hold": {
    const d = await findDrop(dropQuery);
    const r = await paid(`/_sp/api/partner/drops/${d.id}/hold`, { method: "POST", body: { seats: Number(rest[0] ?? 1) } });
    console.log(r.status);
    out(r.body);
    break;
  }
  case "holds":
    out((await call(`/_sp/api/partner/drops/${(await findDrop(dropQuery)).id}/holds`)).body);
    break;
  case "wait": {
    const d = await findDrop(dropQuery);
    for (let i = 0; i < 30; i++) {
      const r = await call(`/_sp/api/partner/drops/${d.id}/holds`);
      const pending = (r.body.holds as any[]).filter((h) => h.status === "queued");
      if (!pending.length) {
        out(r.body.holds);
        break;
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    break;
  }
  case "book": {
    const d = await findDrop(dropQuery);
    const holds = (await call(`/_sp/api/partner/drops/${d.id}/holds`)).body.holds as any[];
    const h = holds.reverse().find((x) => x.status === "issued");
    if (!h) {
      console.log("no issued hold to book");
      break;
    }
    const p = await call(`/_sp/api/partner/drops/${d.id}/holds/${h.id}/pass`);
    if (p.status !== 200) {
      out(p.body);
      break;
    }
    const u = new URL(p.body.bookingUrl);
    const confirm = `${u.pathname}/confirm${u.search}`;
    const r = await fetch(new URL(confirm, GATEWAY), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-surgepass-pass": p.body.pass },
      body: JSON.stringify({ passengers: rest.map((name) => ({ name })) }),
    });
    console.log(`booking on the provider for seat token(s) #${h.serials.join(", #")} → ${r.status}`);
    out(await r.json().catch(() => ({})));
    break;
  }
  default:
    console.log("commands: whoami | drops | associate | join | look | hold | holds | wait | book   (--as <name>)");
}
