import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TokenId,
  TopicCreateTransaction,
} from "@hiero-ledger/sdk";
import { env, isConfigured } from "@surgepass/shared/env";
import { setEnv } from "./envfile.ts";

/** Portal keys come as raw ECDSA hex (0x…) or DER-encoded strings. */
function parseKey(k: string): PrivateKey {
  const hex = k.startsWith("0x") ? k.slice(2) : k;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? PrivateKey.fromStringECDSA(hex) : PrivateKey.fromStringDer(k);
}

// Checks the Hedera testnet accounts, creates the SurgePass audit topic, and associates the
// payment token with the receiving and agent accounts when an HTS token is used.

if (!isConfigured("HEDERA_OPERATOR_ID", "HEDERA_OPERATOR_KEY")) {
  console.error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env first (portal.hedera.com, testnet).");
  process.exit(1);
}

const network = env("HEDERA_NETWORK", "testnet");
const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
const operatorId = AccountId.fromString(env("HEDERA_OPERATOR_ID"));
const operatorKey = parseKey(env("HEDERA_OPERATOR_KEY"));
client.setOperator(operatorId, operatorKey);

async function balance(id: string) {
  const r = await fetch(`${env("MIRROR_NODE_URL", "https://testnet.mirrornode.hedera.com")}/api/v1/accounts/${id}`);
  const j = (await r.json()) as { balance?: { balance: number } };
  return j.balance ? `${j.balance.balance / 1e8} ℏ` : "not found";
}

console.log(`Network:  ${network}`);
console.log(`Operator: ${operatorId} (${await balance(operatorId.toString())})`);

for (const name of ["SURGEPASS_PAY_TO", "AGENT_ACCOUNT_ID", "PARTNER_TRIPNEST_ACCOUNT_ID", "PARTNER_RAVI_ACCOUNT_ID"]) {
  if (isConfigured(name)) console.log(`${name.padEnd(28)} ${env(name)} (${await balance(env(name))})`);
  else console.log(`${name.padEnd(28)} not set`);
}

if (!isConfigured("HCS_TOPIC_ID")) {
  const tx = await new TopicCreateTransaction()
    .setTopicMemo("SurgePass audit log")
    .setSubmitKey(operatorKey.publicKey)
    .setMaxTransactionFee(new Hbar(5))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  setEnv({ HCS_TOPIC_ID: receipt.topicId!.toString() });
  console.log(`Created audit topic ${receipt.topicId} → https://hashscan.io/${network}/topic/${receipt.topicId}`);
} else {
  console.log(`Audit topic ${env("HCS_TOPIC_ID")}`);
}

const asset = env("PAYMENT_ASSET", "0.0.0");
if (asset !== "0.0.0") {
  const pairs: [string, string][] = [
    ["SURGEPASS_PAY_TO", "SURGEPASS_PAY_TO_KEY"],
    ["AGENT_ACCOUNT_ID", "AGENT_PRIVATE_KEY"],
  ];
  for (const [idVar, keyVar] of pairs) {
    if (!isConfigured(idVar, keyVar)) {
      console.log(`Skipping token association for ${idVar} (needs ${idVar} and ${keyVar})`);
      continue;
    }
    const key = parseKey(env(keyVar));
    try {
      const tx = await new TokenAssociateTransaction()
        .setAccountId(env(idVar))
        .setTokenIds([TokenId.fromString(asset)])
        .freezeWith(client)
        .sign(key);
      await (await tx.execute(client)).getReceipt(client);
      console.log(`Associated ${asset} with ${env(idVar)}`);
    } catch (e) {
      const msg = String(e);
      console.log(msg.includes("TOKEN_ALREADY_ASSOCIATED") ? `${env(idVar)} already associated with ${asset}` : msg);
    }
  }
}

client.close();
