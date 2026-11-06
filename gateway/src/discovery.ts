import { Hono } from "hono";
import { config } from "./config.ts";
import { drops } from "./drops.ts";
import { NETWORK } from "./x402.ts";

// How agents find out the rules without an SDK: /.well-known/fair-access.json, /llms.txt, OpenAPI.

export const discovery = new Hono();
const O = config.origin;

discovery.get("/.well-known/fair-access.json", (c) =>
  c.json({
    name: "SurgePass",
    version: 1,
    description: "Fair access gate. At peak, booking routes need a one-time pass won in a draw open to verified humans and human-backed agents. Availability reads are free within a per-human quota and paid via x402 beyond it.",
    drops: `${O}/_sp/api/drops`,
    enter: `${O}/_sp/api/drops/{id}/enter`,
    approvals: `${O}/_sp/api/approvals`,
    agent_link: `${O}/_sp/api/agent/link`,
    token_endpoint: `${O}/_sp/api/token`,
    status: `${O}/_sp/api/drops/{id}/status`,
    pass: `${O}/_sp/api/drops/{id}/pass`,
    verify_draw: `${O}/_sp/api/drops/{id}/verify`,
    human_approval: { scheme: "HumanApproval", flow: "device_code", identity: "World ID", one_entry_per_human_per_drop: true },
    payments: { protocol: "x402", version: 2, scheme: "exact", network: NETWORK, asset: config.x402.asset, header: "PAYMENT-SIGNATURE" },
    pass_header: "X-SurgePass-Pass",
    openapi: `${O}/_sp/openapi.json`,
    mcp: process.env.AGENT_MCP_URL ?? `http://localhost:${process.env.AGENT_MCP_PORT ?? 8090}/mcp`,
    jwks: `${O}/.well-known/jwks.json`,
  }),
);

discovery.get("/llms.txt", (c) => {
  const active = drops
    .all()
    .filter((d) => d.status !== "results")
    .map((d) => `- ${d.label} (${d.pool}) id=${d.id} · ${d.seats} seats · max ${d.maxSeatsPerEntry} per entry`)
    .join("\n");
  return c.text(`# SurgePass

This site uses SurgePass for high-demand drops. Rules for agents:

1. One entry per human per drop. You may enter only on behalf of a verified human.
2. List drops: GET ${O}/_sp/api/drops
3. Enter: POST ${O}/_sp/api/drops/{id}/enter with {"seats": n} and header X-Agent-Account: <your Hedera account>.
   Without a token you get 401 HumanApproval with approval_url, user_code and device_code.
   Show approval_url to your human. They approve with one World ID tap.
4. Poll POST ${O}/_sp/api/token {"device_code": "..."} until you get access_tokens. Use them as Authorization: Bearer.
5. Availability reads are free within your human's quota. Beyond it you get 402 Payment Required (x402 v2, ${NETWORK}). Pay and retry with PAYMENT-SIGNATURE.
6. After the draw: GET ${O}/_sp/api/drops/{id}/status. If you won, GET ${O}/_sp/api/drops/{id}/pass and send the pass as X-SurgePass-Pass to the booking URL.
7. Paying never buys an entry. Unbacked requests are rejected.

Active drops:
${active || "- none"}
`);
});

discovery.get("/_sp/openapi.json", (c) =>
  c.json({
    openapi: "3.1.0",
    info: { title: "SurgePass", version: "1.0.0" },
    servers: [{ url: O }],
    paths: {
      "/_sp/api/drops": { get: { summary: "List drops" } },
      "/_sp/api/drops/{id}": { get: { summary: "Drop details" } },
      "/_sp/api/drops/{id}/enter": { post: { summary: "Enter a drop", description: "401 HumanApproval without a token" } },
      "/_sp/api/approvals": { post: { summary: "Request human approval for one or more drops" } },
      "/_sp/api/agent/link": { post: { summary: "Connect an agent to a human (World ID), with a budget" } },
      "/_sp/api/token": { post: { summary: "Device-code token exchange" } },
      "/_sp/api/drops/{id}/status": { get: { summary: "Your entry, result, pass or waitlist position" } },
      "/_sp/api/drops/{id}/pass": { get: { summary: "Pass token for a winner (agents)" } },
      "/_sp/api/drops/{id}/verify": { get: { summary: "Everything needed to recompute the draw" } },
      "/_sp/api/drops/{id}/bid/commit": { post: { summary: "Premium: sealed bid commitment (deposit via x402)" } },
      "/_sp/api/drops/{id}/bid/reveal": { post: { summary: "Premium: reveal amount and secret" } },
      "/_sp/api/drops/{id}/claim-released": { post: { summary: "Fair first come: claim released seats" } },
    },
  }),
);
