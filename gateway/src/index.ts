import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Server } from "node:http";
import { config } from "./config.ts";
import { admin } from "./admin.ts";
import { drops, watchDrops } from "./drops.ts";
import { gate } from "./gate.ts";
import { attachLive, setStatsSource } from "./live.ts";
import { health, isPeak, startModeController } from "./mode.ts";
import { serveRoom } from "./room.ts";
import { api } from "./api.ts";
import { jwks } from "./keys.ts";
import { startLifecycle } from "./lottery.ts";

const app = new Hono();

app.route("/_sp/admin", admin);
app.route("/_sp/api", api);
app.get("/.well-known/jwks.json", async (c) => c.json(await jwks()));

app.all("/_sp/room", serveRoom);
app.all("/_sp/room/*", serveRoom);

app.all("*", gate);

setStatsSource(() => ({ backends: health, drops: drops.all().map((d) => ({ id: d.id, status: d.status, peakOn: isPeak(d) })) }));

await watchDrops();
startModeController();
startLifecycle();

const server = serve({ fetch: app.fetch, port: config.port }) as Server;
attachLive(server);
console.log(`SurgePass gateway on ${config.origin} → upstream ${config.upstream}`);
