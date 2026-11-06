import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { Redis } from "ioredis";
import { env, REPO_ROOT } from "@surgepass/shared/env";

// Back to the start of the demo in a few seconds: clear gateway state, reset both mock
// providers' inventory, forget the reference agent's tokens, and recreate the demo drops.

const redis = new Redis(env("REDIS_URL", "redis://localhost:6379"));
await redis.flushdb();
await redis.publish("sp:drops", "reset");
redis.disconnect();
console.log("✓ gateway state cleared");

for (const url of [env("UPSTREAM_URL", "http://localhost:4000"), env("DIRECT_PROVIDER_URL", "http://localhost:4001")]) {
  const r = await fetch(`${url}/__provider/reset`, { method: "POST" }).catch(() => null);
  console.log(r?.ok ? `✓ provider ${url} reset` : `✗ provider ${url} not reachable`);
}

rmSync(resolve(REPO_ROOT, ".surgepass/agent-state.json"), { force: true });
console.log("✓ agent state cleared");

await import("./seed-drops.ts");
