import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { envNum } from "@surgepass/shared/env";
import * as sp from "./surgepass.ts";

// Remote MCP server: add it to Claude (or any MCP client) by URL. It is the reference agent:
// it holds a Hedera wallet, asks its human for one-tap approvals, and pays x402 reads by itself.

const PORT = envNum("AGENT_MCP_PORT", 8090);

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

function build() {
  const server = new McpServer({ name: "surgepass-agent", version: "1.0.0" });

  server.registerTool(
    "connect",
    {
      title: "Connect agent",
      description: "Connect this agent to its human once (World ID, ~30 days) with a spending budget in INR. Returns an approval link to show the human, or the current link.",
      inputSchema: { budget_inr: z.number().positive().max(10_000).optional() },
    },
    async ({ budget_inr }) => text(await sp.connect(budget_inr)),
  );

  server.registerTool(
    "list_drops",
    { title: "List drops", description: "List high-demand drops (trains, shows, events) currently gated by SurgePass.", inputSchema: {} },
    async () => text((await sp.listDrops()).map((d) => ({ id: d.id, label: d.label, subtitle: d.subtitle, pool: d.pool, status: d.status, seats: d.seats, maxSeatsPerEntry: d.maxSeatsPerEntry, opensAt: new Date(d.opensAt).toISOString(), closesAt: new Date(d.closesAt).toISOString(), premium: d.premium }))),
  );

  server.registerTool(
    "request_drop",
    {
      title: "Request drops",
      description:
        "Ask the human to approve entering one or more drops (one approval screen). Use when the human asks, e.g. the night before. For premium drops pass max_bid in INR (the human's maximum per seat). Show the returned approval_url to the human as a button.",
      inputSchema: {
        drops: z.array(z.object({ query: z.string().describe("drop id or words from its name"), seats: z.number().int().min(1).max(10), max_bid: z.number().optional() })).min(1),
      },
    },
    async ({ drops }) => {
      const all = await sp.listDrops();
      const items = [];
      for (const d of drops) {
        const found = sp.findDrop(all, d.query);
        if (!found) return text({ error: `No drop matches "${d.query}"`, available: all.map((x) => x.label) });
        items.push({ id: found.id, seats: d.seats, maxBid: d.max_bid });
      }
      const r = await sp.requestDrops(items);
      return text({ ...r, next: "Show approval_url to the human. Then call status or enter; approval is picked up automatically." });
    },
  );

  server.registerTool(
    "check_availability",
    {
      title: "Check availability",
      description: "Check seats left for a drop. Free within the human's quota; beyond it pays the surge price on Hedera automatically (x402), within budget.",
      inputSchema: { query: z.string(), path: z.string().optional().describe("availability path, if known") },
    },
    async ({ query, path }) => {
      await sp.pollApprovals();
      const d = sp.findDrop(await sp.listDrops(), query);
      if (!d) return text({ error: "unknown drop" });
      const p = path ?? availabilityPath(d);
      if (!p) return text({ error: "no availability route known for this drop; pass `path`" });
      return text(await sp.paidGet(p, d.id));
    },
  );

  server.registerTool(
    "enter",
    {
      title: "Enter drop",
      description: "Enter the draw (normal drop) or place the sealed bid (premium drop) with the human's approval. If approval is missing, returns an approval link.",
      inputSchema: { query: z.string(), seats: z.number().int().min(1).max(10).optional() },
    },
    async ({ query, seats }) => {
      await sp.pollApprovals();
      const d = sp.findDrop(await sp.listDrops(), query);
      if (!d) return text({ error: "unknown drop" });
      return text(d.pool === "premium" ? await sp.bid(d.id, undefined, seats) : await sp.enter(d.id, seats));
    },
  );

  server.registerTool(
    "status",
    { title: "Status", description: "Approvals, entry, draw result, pass and waitlist position for a drop, plus spending so far.", inputSchema: { query: z.string().optional() } },
    async ({ query }) => {
      const approvals = await sp.pollApprovals();
      const all = await sp.listDrops();
      const targets = query ? [sp.findDrop(all, query)].filter(Boolean) : all.filter((d) => sp.tokens().includes(d.id));
      const out = [];
      for (const d of targets) {
        if (d.pool === "premium" && d.status === "revealing") await sp.reveal(d.id);
        out.push({ drop: d.label, id: d.id, ...(await sp.status(d.id)) });
      }
      return text({ approvals, drops: out, spending: sp.spending() });
    },
  );

  server.registerTool(
    "book",
    {
      title: "Book",
      description: "After winning: book on the provider's normal booking page with the pass. Pass passenger names (up to the seats won).",
      inputSchema: { query: z.string(), passengers: z.array(z.object({ name: z.string(), age: z.string().optional() })).min(1) },
    },
    async ({ query, passengers }) => {
      const d = sp.findDrop(await sp.listDrops(), query);
      if (!d) return text({ error: "unknown drop" });
      return text(await sp.book(d.id, passengers));
    },
  );

  return server;
}

function availabilityPath(d: { id: string; label: string }): string | null {
  const m = d.label.match(/\b(\d{5})\b/);
  if (m) return `/availability/${m[1]}/2026-11-06/${/3A/.test(d.label) ? "3A" : "CC"}?quota=${/premium/i.test(d.id) ? "PT" : "TQ"}`;
  return null;
}

const transports = new Map<string, StreamableHTTPServerTransport>();

createServer(async (req, res) => {
  if (!req.url?.startsWith("/mcp")) {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
  const sid = req.headers["mcp-session-id"] as string | undefined;

  let transport = sid ? transports.get(sid) : undefined;
  if (!transport && req.method === "POST" && isInitializeRequest(body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => void transports.set(id, transport!),
    });
    transport.onclose = () => transport!.sessionId && transports.delete(transport!.sessionId);
    await build().connect(transport);
  }
  if (!transport) {
    res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "no session" }));
    return;
  }
  await transport.handleRequest(req, res, body);
}).listen(PORT, () => console.log(`SurgePass agent MCP on http://localhost:${PORT}/mcp (account ${sp.ACCOUNT})`));
