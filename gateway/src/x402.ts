import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { config, hashscan } from "./config.ts";
import { redis } from "./redis.ts";

// x402 (v2, Hedera `exact` scheme). SurgePass is the resource server: it quotes a price in a 402,
// then verifies and settles the client's signed Hedera transfer through a facilitator.
// Without a receiving account configured it runs locally: same 402s, payments accepted as "local".

export const x402Live = config.x402.configured && config.hedera.payTo.startsWith("0.0.") && config.hedera.payTo.length > 4;
export const NETWORK = `hedera:${config.hedera.network}` as const;

let server: x402ResourceServer | null = null;
let ready: Promise<void> | null = null;

function getServer() {
  if (!server) {
    server = new x402ResourceServer(new HTTPFacilitatorClient({ url: config.x402.facilitatorUrl }));
    server.register(
      NETWORK,
      new ExactHederaScheme({ defaultAssets: { [NETWORK]: { asset: config.x402.asset, decimals: config.x402.decimals } } }),
    );
    ready = server.initialize().catch((e) => {
      console.error("x402 facilitator init failed:", String(e));
      ready = null;
      server = null;
      throw e;
    });
  }
  return { server, ready: ready! };
}

export const inrToUnits = (inr: number) => BigInt(Math.max(1, Math.round(inr * config.x402.unitsPerInr)));
export const unitsToInr = (units: string | bigint) => Number(BigInt(units)) / config.x402.unitsPerInr;

async function requirementsFor(units: bigint): Promise<PaymentRequirements[]> {
  if (!x402Live) {
    return [
      {
        scheme: "exact",
        network: NETWORK,
        asset: config.x402.asset,
        amount: units.toString(),
        payTo: "0.0.local",
        maxTimeoutSeconds: 180,
        extra: { feePayer: "0.0.local", mode: "local" },
      },
    ];
  }
  const s = getServer();
  await s.ready;
  return s.server.buildPaymentRequirements({
    scheme: "exact",
    network: NETWORK,
    payTo: config.hedera.payTo,
    price: { asset: config.x402.asset, amount: units.toString() },
    maxTimeoutSeconds: 180,
  });
}

/** Builds the 402 response for a read route at the current surge price. Quotes stay honoured for 3 minutes. */
export async function paymentRequired(resourceUrl: string, priceInr: number, description: string): Promise<Response> {
  const units = inrToUnits(priceInr);
  const accepts = await requirementsFor(units);
  await redis.set(`quote:${units}`, "1", "EX", 180);
  const body = {
    x402Version: 2,
    error: "payment_required",
    resource: { url: resourceUrl, description, mimeType: "application/json" },
    accepts,
    priceInr,
  };
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: { "content-type": "application/json", "PAYMENT-REQUIRED": encodePaymentRequiredHeader(body), "cache-control": "no-store" },
  });
}

export type PaymentOutcome =
  | { ok: true; txId: string; payer?: string; amountInr: number; link?: string; responseHeader: string }
  | { ok: false; reason: string };

/** Verifies and settles a PAYMENT-SIGNATURE / X-PAYMENT header against the current price (or a recent quote). */
export async function settle(header: string, currentPriceInr: number): Promise<PaymentOutcome> {
  let payload: PaymentPayload;
  try {
    payload = decodePaymentSignatureHeader(header);
  } catch {
    return { ok: false, reason: "malformed_payment" };
  }
  const accepted = payload.accepted;
  if (!accepted || accepted.network !== NETWORK || accepted.asset !== config.x402.asset) return { ok: false, reason: "wrong_network_or_asset" };
  const amount = BigInt(accepted.amount);
  const current = inrToUnits(currentPriceInr);
  if (amount < current && !(await redis.get(`quote:${amount}`))) return { ok: false, reason: "price_changed" };

  if (!x402Live) {
    if (payload.payload?.transaction !== "local") return { ok: false, reason: "invalid_payment" };
    const txId = `local-pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const settled = { success: true, transaction: txId, network: NETWORK, payer: String(payload.payload.payer ?? "local") };
    return { ok: true, txId, payer: settled.payer, amountInr: unitsToInr(amount), responseHeader: encodePaymentResponseHeader(settled) };
  }

  const s = getServer();
  await s.ready;
  const [requirements] = await requirementsFor(amount);
  if (!requirements || accepted.payTo !== requirements.payTo) return { ok: false, reason: "wrong_pay_to" };
  const v = await s.server.verifyPayment(payload, requirements);
  if (!v.isValid) return { ok: false, reason: v.invalidReason ?? "invalid_payment" };
  const r = await s.server.settlePayment(payload, requirements);
  if (!r.success) return { ok: false, reason: r.errorReason ?? "settle_failed" };
  return {
    ok: true,
    txId: r.transaction,
    payer: r.payer ?? v.payer,
    amountInr: unitsToInr(amount),
    link: hashscan(`transaction/${r.transaction}`),
    responseHeader: encodePaymentResponseHeader(r),
  };
}

export const paymentHeader = (h: (name: string) => string | undefined) => h("payment-signature") ?? h("x-payment");
