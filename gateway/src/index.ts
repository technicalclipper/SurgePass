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
import { setWinnersHandler, startLifecycle } from "./lottery.ts";
import { issuePass, startPassExpiry } from "./passes.ts";
import { currentPrices } from "./pricing.ts";
import { agents, approvalChallenge } from "./agents.ts";
import { setApprovalChallenge } from "./api.ts";
import { discovery } from "./discovery.ts";
import { bidStatus, premium, premiumClose, refundWinner } from "./premium.ts";
import { addStatusExtra } from "./status.ts";
import { setPremiumCloseHandler } from "./lottery.ts";
import { onBooked } from "./passes.ts";
import { fcfs } from "./fcfs.ts";
import { partnerApi, registerPartnerAdmin, startPartnerQueue } from "./partners.ts";

const app = new Hono();

registerPartnerAdmin(admin);
app.route("/_sp/admin", admin);
app.route("/_sp/api", agents);
app.route("/_sp/api", premium);
app.route("/_sp/api", fcfs);
app.route("/_sp/api/partner", partnerApi);
app.route("/_sp/api", api);
app.route("/", discovery);
setApprovalChallenge(approvalChallenge);
setPremiumCloseHandler(premiumClose);
addStatusExtra(bidStatus);
onBooked(async (d, rec) => {
  if (d.pool === "premium") await refundWinner(d, rec.sub);
});
app.get("/.well-known/jwks.json", async (c) => c.json(await jwks()));

app.all("/_sp/room", serveRoom);
app.all("/_sp/room/*", serveRoom);

app.all("*", gate);

setStatsSource(() => ({ backends: health, prices: currentPrices(), drops: drops.all().map((d) => ({ id: d.id, status: d.status, peakOn: isPeak(d) })) }));

await watchDrops();
startModeController();
startLifecycle();
startPassExpiry();
startPartnerQueue();
setWinnersHandler(async (drop, winners) => {
  for (const w of winners) await issuePass(drop, w);
});

const server = serve({ fetch: app.fetch, port: config.port }) as Server;
attachLive(server);
console.log(`SurgePass gateway on ${config.origin} → upstream ${config.upstream}`);
