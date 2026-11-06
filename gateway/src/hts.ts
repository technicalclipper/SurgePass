import {
  AccountId,
  Hbar,
  NftId,
  TokenCreateTransaction,
  TokenFreezeTransaction,
  TokenGrantKycTransaction,
  TokenId,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
  TokenUnfreezeTransaction,
  TokenWipeTransaction,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { randomBytes } from "node:crypto";
import { hashscan } from "./config.ts";
import { live } from "./hedera.ts";
import { redis } from "./redis.ts";

// Seat tokens for the partner lane, on the Hedera Token Service (no Solidity).
// One NFT collection per partner drop; SurgePass (for the provider) holds the treasury and the
// KYC, freeze, wipe and supply keys. Only accounts granted KYC can receive a seat: the network
// itself refuses anyone else. In local mode the same rules are simulated in Redis.

export interface HtsResult {
  txId: string;
  link?: string;
}

const L = {
  meta: (t: string) => `hts:${t}:meta`,
  kyc: (t: string) => `hts:${t}:kyc`,
  frozen: (t: string) => `hts:${t}:frozen`,
  owner: (t: string) => `hts:${t}:owner`,
  next: (t: string) => `hts:${t}:next`,
};

const localTx = (what: string) => ({ txId: `local-${what}-${Date.now()}-${randomBytes(2).toString("hex")}` });
const result = (txId: string): HtsResult => ({ txId, link: hashscan(`transaction/${txId}`) });
export const tokenLink = (tokenId?: string) => (tokenId && !tokenId.startsWith("local-") ? hashscan(`token/${tokenId}`) : undefined);

export class HtsError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

/** Creates the seat-token collection for a partner drop. */
export async function createSeatToken(name: string, symbol: string, maxSupply: number): Promise<string> {
  const h = live();
  if (!h) {
    const id = `local-tok-${randomBytes(3).toString("hex")}`;
    await redis.set(L.meta(id), JSON.stringify({ name, symbol, maxSupply }));
    return id;
  }
  const pub = h.operatorKey.publicKey;
  const tx = await new TokenCreateTransaction()
    .setTokenName(name.slice(0, 100))
    .setTokenSymbol(symbol.slice(0, 100))
    .setTokenType(TokenType.NonFungibleUnique)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(maxSupply)
    .setDecimals(0)
    .setInitialSupply(0)
    .setTreasuryAccountId(h.operatorId)
    .setAdminKey(pub)
    .setSupplyKey(pub)
    .setKycKey(pub)
    .setFreezeKey(pub)
    .setWipeKey(pub)
    .setFreezeDefault(false)
    .setTokenMemo("SurgePass partner seats")
    .setMaxTransactionFee(new Hbar(30))
    .execute(h.client);
  return (await tx.getReceipt(h.client)).tokenId!.toString();
}

/** Mints `count` seats into the treasury. Returns their serial numbers. */
export async function mintSeats(tokenId: string, count: number, label: string): Promise<number[]> {
  const h = live();
  if (!h || tokenId.startsWith("local-")) {
    const start = await redis.incrby(L.next(tokenId), count);
    const serials = Array.from({ length: count }, (_, i) => start - count + i + 1);
    if (serials.length) await redis.hset(L.owner(tokenId), Object.fromEntries(serials.map((s) => [String(s), "treasury"])));
    return serials;
  }
  const serials: number[] = [];
  for (let i = 0; i < count; i += 10) {
    const n = Math.min(10, count - i);
    const metadata = Array.from({ length: n }, (_, j) => Buffer.from(`${label}#${i + j + 1}`.slice(0, 100)));
    const tx = await new TokenMintTransaction().setTokenId(tokenId).setMetadata(metadata).setMaxTransactionFee(new Hbar(20)).execute(h.client);
    const receipt = await tx.getReceipt(h.client);
    serials.push(...receipt.serials.map((s) => Number(s.toString())));
  }
  return serials;
}

/** Allowlists a partner on this token (KYC grant). The partner must have associated the token. */
export async function grantKyc(tokenId: string, account: string): Promise<HtsResult> {
  const h = live();
  if (!h || tokenId.startsWith("local-")) {
    await redis.sadd(L.kyc(tokenId), account);
    return localTx("kyc");
  }
  try {
    const tx = await new TokenGrantKycTransaction().setTokenId(tokenId).setAccountId(account).execute(h.client);
    await tx.getReceipt(h.client);
    return result(tx.transactionId.toString());
  } catch (e) {
    const msg = String(e);
    if (msg.includes("TOKEN_NOT_ASSOCIATED_TO_ACCOUNT")) throw new HtsError("not_associated", "Associate the seat token from your partner account first");
    throw new HtsError("kyc_failed", msg);
  }
}

export async function setFrozen(tokenId: string, account: string, frozen: boolean): Promise<HtsResult> {
  const h = live();
  if (!h || tokenId.startsWith("local-")) {
    if (frozen) await redis.sadd(L.frozen(tokenId), account);
    else await redis.srem(L.frozen(tokenId), account);
    return localTx(frozen ? "freeze" : "unfreeze");
  }
  const tx = frozen
    ? await new TokenFreezeTransaction().setTokenId(tokenId).setAccountId(account).execute(h.client)
    : await new TokenUnfreezeTransaction().setTokenId(tokenId).setAccountId(account).execute(h.client);
  await tx.getReceipt(h.client);
  return result(tx.transactionId.toString());
}

/** Moves seats from the treasury to a partner. Hedera refuses it unless the partner has KYC and isn't frozen. */
export async function transferSeats(tokenId: string, serials: number[], to: string): Promise<HtsResult> {
  const h = live();
  if (!h || tokenId.startsWith("local-")) {
    if (!(await redis.sismember(L.kyc(tokenId), to))) throw new HtsError("ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN");
    if (await redis.sismember(L.frozen(tokenId), to)) throw new HtsError("ACCOUNT_FROZEN_FOR_TOKEN");
    await redis.hset(L.owner(tokenId), Object.fromEntries(serials.map((s) => [String(s), to])));
    return localTx("transfer");
  }
  const tx = new TransferTransaction();
  for (const s of serials) tx.addNftTransfer(new NftId(TokenId.fromString(tokenId), s), h.operatorId, AccountId.fromString(to));
  try {
    const resp = await tx.execute(h.client);
    await resp.getReceipt(h.client);
    return result(resp.transactionId.toString());
  } catch (e) {
    const msg = String(e);
    const code = ["ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN", "ACCOUNT_FROZEN_FOR_TOKEN", "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT"].find((c) => msg.includes(c));
    throw new HtsError(code ?? "transfer_failed", msg);
  }
}

/** Retires seats held by a partner (used, or reclaimed after the deadline). Wiped NFTs are burned. */
export async function wipeSeats(tokenId: string, account: string, serials: number[]): Promise<HtsResult> {
  if (!serials.length) return localTx("wipe-none");
  const h = live();
  if (!h || tokenId.startsWith("local-")) {
    await redis.hdel(L.owner(tokenId), ...serials.map(String));
    return localTx("wipe");
  }
  const tx = await new TokenWipeTransaction().setTokenId(tokenId).setAccountId(account).setSerials(serials).execute(h.client);
  await tx.getReceipt(h.client);
  return result(tx.transactionId.toString());
}

/** For the console: try to hand a seat to an account that isn't allowlisted and show Hedera's answer. */
export async function probeUnapproved(tokenId: string, serial: number, to: string): Promise<{ refused: boolean; code: string; txId?: string; link?: string }> {
  try {
    const r = await transferSeats(tokenId, [serial], to);
    return { refused: false, code: "SUCCESS", ...r };
  } catch (e) {
    return { refused: true, code: e instanceof HtsError ? e.code : String(e) };
  }
}

export const localOwners = async (tokenId: string) => redis.hgetall(L.owner(tokenId));
