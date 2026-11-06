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

const app = new Hono();

app.route("/_sp/admin", admin);

app.get("/_sp/api/drops", (c) =>
  c.json({
    drops: drops.all().map((d) => ({
      id: d.id,
      label: d.label,
      subtitle: d.subtitle,
      pool: d.pool,
      status: d.status,
      opensAt: d.opensAt,
      closesAt: d.closesAt,
      seats: d.seats,
      maxSeatsPerEntry: d.maxSeatsPerEntry,
      priceInr: d.priceInr,
      premium: d.premium,
      peakOn: isPeak(d),
    })),
  }),
);

app.all("/_sp/room", serveRoom);
app.all("/_sp/room/*", serveRoom);

app.all("*", gate);

setStatsSource(() => ({ backends: health, drops: drops.all().map((d) => ({ id: d.id, status: d.status, peakOn: isPeak(d) })) }));

await watchDrops();
startModeController();

const server = serve({ fetch: app.fetch, port: config.port }) as Server;
attachLive(server);
console.log(`SurgePass gateway on ${config.origin} → upstream ${config.upstream}`);
