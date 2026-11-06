import { AccountCreateTransaction, AccountId, Client, Hbar, PrivateKey } from "@hiero-ledger/sdk";
import { env, isConfigured } from "@surgepass/shared/env";
import { setEnv } from "./envfile.ts";

// Creates the demo accounts on Hedera testnet from the operator account (ECDSA keys) and writes
// them to .env: the reference agent and two partners. Accounts already in .env are kept.
//   npm run setup:accounts

if (!isConfigured("HEDERA_OPERATOR_ID", "HEDERA_OPERATOR_KEY")) {
  console.error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env first.");
  process.exit(1);
}

function parseKey(k: string): PrivateKey {
  const hex = k.startsWith("0x") ? k.slice(2) : k;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? PrivateKey.fromStringECDSA(hex) : PrivateKey.fromStringDer(k);
}

const client = env("HEDERA_NETWORK", "testnet") === "mainnet" ? Client.forMainnet() : Client.forTestnet();
client.setOperator(AccountId.fromString(env("HEDERA_OPERATOR_ID")), parseKey(env("HEDERA_OPERATOR_KEY")));

const wanted: { idVar: string; keyVar: string; hbar: number; label: string }[] = [
  { idVar: "AGENT_ACCOUNT_ID", keyVar: "AGENT_PRIVATE_KEY", hbar: 50, label: "reference agent" },
  { idVar: "PARTNER_TRIPNEST_ACCOUNT_ID", keyVar: "PARTNER_TRIPNEST_PRIVATE_KEY", hbar: 30, label: "partner TripNest" },
  { idVar: "PARTNER_RAVI_ACCOUNT_ID", keyVar: "PARTNER_RAVI_PRIVATE_KEY", hbar: 30, label: "partner Ravi Travels" },
];

for (const w of wanted) {
  if (isConfigured(w.idVar, w.keyVar)) {
    console.log(`${w.label.padEnd(22)} ${env(w.idVar)} (already set)`);
    continue;
  }
  const key = PrivateKey.generateECDSA();
  const tx = await new AccountCreateTransaction()
    .setKeyWithoutAlias(key.publicKey)
    .setInitialBalance(new Hbar(w.hbar))
    .setAccountMemo(`SurgePass ${w.label}`)
    .execute(client);
  const id = (await tx.getReceipt(client)).accountId!.toString();
  setEnv({ [w.idVar]: id, [w.keyVar]: `0x${key.toStringRaw()}` });
  console.log(`${w.label.padEnd(22)} ${id} · ${w.hbar} HBAR · https://hashscan.io/testnet/account/${id}`);
}

client.close();
