import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { Context } from "hono";
import { REPO_ROOT } from "@surgepass/shared/env";
import { config } from "./config.ts";

// Serves the waiting-room app on the provider's own domain (so the pass cookie is first-party).
// In production it serves the built files; in development it proxies to the Vite dev server.

const DIST = resolve(REPO_ROOT, "waiting-room/dist");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

export async function serveRoom(c: Context): Promise<Response> {
  const path = new URL(c.req.url).pathname;
  if (existsSync(DIST) && !process.env.WAITING_ROOM_DEV) {
    const rel = path.replace(/^\/_sp\/room\/?/, "");
    const file = resolve(DIST, rel);
    if (rel && file.startsWith(DIST) && existsSync(file) && !file.endsWith("/")) {
      return new Response(readFileSync(file), { headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "public, max-age=3600" } });
    }
    return new Response(readFileSync(resolve(DIST, "index.html")), { headers: { "content-type": TYPES[".html"]!, "cache-control": "no-cache" } });
  }
  const url = new URL(c.req.url);
  try {
    const r = await fetch(new URL(url.pathname + url.search, config.waitingRoomDevUrl), { headers: c.req.raw.headers });
    const h = new Headers(r.headers);
    h.delete("content-encoding");
    h.delete("content-length");
    return new Response(r.body, { status: r.status, headers: h });
  } catch {
    return c.text("Waiting room is not running. Start it with `npm run dev:waiting-room` or build it.", 503);
  }
}

export const roomUrl = (dropId: string, from?: string) =>
  `/_sp/room/${encodeURIComponent(dropId)}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
