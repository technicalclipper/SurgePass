import { env, envNum, isConfigured } from "@surgepass/shared/env";

const origin = env("GATEWAY_ORIGIN", "http://localhost:8080");

export const config = {
  port: envNum("GATEWAY_PORT", 8080),
  origin,
  /** Audience for X-SurgePass-Assertion: the provider's own host (its domain points at us). */
  audience: env("PROVIDER_AUDIENCE", new URL(origin).host),
  upstream: env("UPSTREAM_URL", "http://localhost:4000"),
  directProvider: env("DIRECT_PROVIDER_URL", "http://localhost:4001"),
  redisUrl: env("REDIS_URL", "redis://localhost:6379"),
  adminToken: env("ADMIN_TOKEN", "change-me"),
  dashboardOrigin: env("DASHBOARD_ORIGIN", "http://localhost:5174"),
  waitingRoomDevUrl: process.env.WAITING_ROOM_DEV_URL ?? "http://localhost:5173",

  passKeyId: env("PASS_KEY_ID", "sp-1"),
  passSigningKey: process.env.PASS_SIGNING_KEY ?? "",
  passPublicKey: process.env.PASS_PUBLIC_KEY ?? "",

  world: {
    configured: isConfigured("WORLD_APP_ID", "WORLD_RP_ID", "WORLD_SIGNING_KEY"),
    appId: env("WORLD_APP_ID", "app_"),
    rpId: env("WORLD_RP_ID", ""),
    signingKey: env("WORLD_SIGNING_KEY", ""),
    environment: env("WORLD_ENVIRONMENT", "staging") as "production" | "staging",
  },

  hedera: {
    configured: isConfigured("HEDERA_OPERATOR_ID", "HEDERA_OPERATOR_KEY"),
    network: env("HEDERA_NETWORK", "testnet") as "testnet" | "mainnet",
    operatorId: env("HEDERA_OPERATOR_ID", ""),
    operatorKey: env("HEDERA_OPERATOR_KEY", ""),
    payTo: env("SURGEPASS_PAY_TO", ""),
    auditTopicId: env("HCS_TOPIC_ID", ""),
    mirrorNode: env("MIRROR_NODE_URL", "https://testnet.mirrornode.hedera.com"),
  },

  x402: {
    configured: isConfigured("SURGEPASS_PAY_TO", "X402_FACILITATOR_URL"),
    facilitatorUrl: env("X402_FACILITATOR_URL", "https://x402.org/facilitator"),
    asset: env("PAYMENT_ASSET", "0.0.0"),
    decimals: envNum("PAYMENT_ASSET_DECIMALS", 8),
    unitsPerInr: envNum("ASSET_UNITS_PER_INR", 1_000_000),
  },
};

export const hashscan = (path: string) => `https://hashscan.io/${config.hedera.network}/${path}`;
