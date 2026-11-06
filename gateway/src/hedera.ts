import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  PrngTransaction,
  ScheduleCreateTransaction,
  Timestamp,
  TokenId,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransactionId,
  TransactionRecordQuery,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { randomBytes } from "node:crypto";
import type { HcsMessage } from "@surgepass/shared";
import { config, hashscan } from "./config.ts";
import { redis } from "./redis.ts";

// Hedera services used by SurgePass, through the SDK only (no Solidity):
// HCS topics/messages, the random number service (PRNG), and scheduled transfers for refunds.
// Without operator keys it runs in local mode: same interface, messages kept in Redis.

export const hederaLive = config.hedera.configured;

export function parseKey(k: string): PrivateKey {
  const hex = k.startsWith("0x") ? k.slice(2) : k;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? PrivateKey.fromStringECDSA(hex) : PrivateKey.fromStringDer(k);
}

let client: Client | null = null;
let operatorId: AccountId | null = null;
let operatorKey: PrivateKey | null = null;
if (hederaLive) {
  client = config.hedera.network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  operatorId = AccountId.fromString(config.hedera.operatorId);
  operatorKey = parseKey(config.hedera.operatorKey);
  client.setOperator(operatorId, operatorKey);
}

/** The live SDK client and operator, or null in local mode. */
export const live = () => (client && operatorId && operatorKey ? { client, operatorId, operatorKey } : null);

export interface Submitted {
  seq: number;
  txId: string;
  consensusAt?: string;
  link?: string;
}

export async function createTopic(memo: string): Promise<string> {
  if (!client) return `local-${randomBytes(4).toString("hex")}`;
  const tx = await new TopicCreateTransaction().setTopicMemo(memo.slice(0, 100)).setSubmitKey(operatorKey!.publicKey).setMaxTransactionFee(new Hbar(5)).execute(client);
  return (await tx.getReceipt(client)).topicId!.toString();
}

/** Writes a message to a topic. With `withTimestamp`, also returns the consensus timestamp (needed for fair-first-come ordering). */
export async function submit(topicId: string, msg: HcsMessage, withTimestamp = false): Promise<Submitted> {
  const body = JSON.stringify(msg);
  if (!client || topicId.startsWith("local-")) {
    const seq = await redis.incr(`hcsseq:${topicId}`);
    const consensusAt = `${(process.hrtime.bigint() / 1000n).toString()}`;
    await redis.rpush(`hcs:${topicId}`, JSON.stringify({ seq, consensusAt, message: msg }));
    return { seq, txId: `local-${topicId}-${seq}`, consensusAt };
  }
  const resp = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(body).execute(client);
  const txId = resp.transactionId.toString();
  if (withTimestamp) {
    const record = await resp.getRecord(client);
    return {
      seq: Number(record.receipt.topicSequenceNumber),
      txId,
      consensusAt: record.consensusTimestamp.toString(),
      link: hashscan(`transaction/${txId}`),
    };
  }
  const receipt = await resp.getReceipt(client);
  return { seq: Number(receipt.topicSequenceNumber), txId, link: hashscan(`transaction/${txId}`) };
}

/** Pre-generates the transaction ID for the seed, so it can be committed to HCS before the seed exists. */
export function newSeedTxId(): string {
  if (!operatorId) return `local-seed-${Date.now()}-${randomBytes(3).toString("hex")}`;
  return TransactionId.generate(operatorId).toString();
}

/** Runs Hedera's random number transaction under the committed transaction ID and returns its 32 random bytes. */
export async function prngSeed(txIdStr: string): Promise<{ seed: string; txId: string; link?: string }> {
  if (!client) return { seed: randomBytes(32).toString("hex"), txId: txIdStr };
  const id = TransactionId.fromString(txIdStr);
  let record;
  try {
    const tx = await new PrngTransaction().setTransactionId(id).freezeWith(client).execute(client);
    record = await tx.getRecord(client);
  } catch (e) {
    // A retry after the transaction already reached consensus: read its record instead of rolling again.
    if (!String(e).includes("DUPLICATE_TRANSACTION")) throw e;
    record = await new TransactionRecordQuery().setTransactionId(id).execute(client);
  }
  const bytes = record.prngBytes;
  if (!bytes || bytes.length === 0) throw new Error("PRNG returned no bytes");
  return { seed: Buffer.from(bytes).toString("hex"), txId: txIdStr, link: hashscan(`transaction/${txIdStr}`) };
}

/**
 * Schedules a refund from the receiving account, executing at `executeAt` (long-term scheduled
 * transaction). Needs SURGEPASS_PAY_TO_KEY. Returns the schedule id.
 */
export async function scheduleRefund(to: string, amountUnits: bigint, executeAt: Date, memo: string): Promise<{ scheduleId: string; link?: string } | null> {
  const payToKey = process.env.SURGEPASS_PAY_TO_KEY;
  if (!client || !payToKey || !config.hedera.payTo) return null;
  const from = AccountId.fromString(config.hedera.payTo);
  const transfer = new TransferTransaction();
  if (config.x402.asset === "0.0.0") {
    transfer.addHbarTransfer(from, Hbar.fromTinybars((-amountUnits).toString())).addHbarTransfer(to, Hbar.fromTinybars(amountUnits.toString()));
  } else {
    const token = TokenId.fromString(config.x402.asset);
    transfer.addTokenTransfer(token, from, -amountUnits).addTokenTransfer(token, to, amountUnits);
  }
  const schedule = await new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    .setScheduleMemo(memo.slice(0, 100))
    .setExpirationTime(Timestamp.fromDate(executeAt))
    .setWaitForExpiry(true)
    .freezeWith(client)
    .sign(parseKey(payToKey));
  const resp = await schedule.execute(client);
  const receipt = await resp.getReceipt(client);
  const scheduleId = receipt.scheduleId!.toString();
  return { scheduleId, link: hashscan(`schedule/${scheduleId}`) };
}

/** Reads a topic's messages back: from the public mirror node when live, from Redis in local mode. */
export async function readTopic(topicId: string): Promise<{ seq: number; consensusAt: string; message: HcsMessage }[]> {
  if (!client || topicId.startsWith("local-")) {
    const rows = await redis.lrange(`hcs:${topicId}`, 0, -1);
    return rows.map((r) => JSON.parse(r));
  }
  const out: { seq: number; consensusAt: string; message: HcsMessage }[] = [];
  let next: string | null = `/api/v1/topics/${topicId}/messages?limit=100&order=asc`;
  while (next) {
    const r = await fetch(new URL(next, config.hedera.mirrorNode));
    const j = (await r.json()) as { messages: { sequence_number: number; consensus_timestamp: string; message: string }[]; links: { next: string | null } };
    for (const m of j.messages) {
      try {
        out.push({ seq: m.sequence_number, consensusAt: m.consensus_timestamp, message: JSON.parse(Buffer.from(m.message, "base64").toString("utf8")) });
      } catch {
        // not one of ours
      }
    }
    next = j.links.next;
  }
  return out;
}

export const topicLink = (topicId?: string) => (topicId && !topicId.startsWith("local-") ? hashscan(`topic/${topicId}`) : undefined);
