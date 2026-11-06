import type { Context } from "hono";
import { matchDrop, needsBody, type RequestShape } from "@surgepass/shared";
import { drops } from "./drops.ts";
import { isPeak } from "./mode.ts";
import { count, emit } from "./live.ts";
import { forward } from "./proxy.ts";
import { roomUrl } from "./room.ts";

// The gate: every provider request comes through here. Cheapest checks first.

export async function gate(c: Context): Promise<Response> {
  count("requests");
  const req = c.req.raw;
  const url = new URL(req.url);
  const all = drops.all();

  let body: ArrayBuffer | undefined;
  const shape: RequestShape = {
    method: req.method,
    path: url.pathname,
    query: url.searchParams,
    headers: Object.fromEntries(req.headers),
  };
  if (req.method !== "GET" && req.method !== "HEAD" && needsBody(all)) {
    body = await req.arrayBuffer();
    shape.body = parseBody(body, req.headers.get("content-type"));
  }

  const m = all.length ? matchDrop(all, shape) : null;
  if (!m || !isPeak(m.drop)) {
    count("forwarded");
    return forward(req, { body });
  }

  if (m.kind === "read") {
    count("forwarded");
    return forward(req, { body });
  }

  // Booking route at peak without a pass → the waiting room.
  count("waitingRoom");
  emit({ kind: "bot", method: req.method, path: url.pathname, status: 302, drop: m.drop.id, note: "no pass → waiting room" });
  return c.redirect(roomUrl(m.drop.id, url.pathname + url.search), 302);
}

function parseBody(buf: ArrayBuffer, type: string | null): Record<string, unknown> | undefined {
  const text = new TextDecoder().decode(buf);
  try {
    if (type?.includes("json")) return JSON.parse(text);
    if (type?.includes("form")) return Object.fromEntries(new URLSearchParams(text));
  } catch {
    return undefined;
  }
  return undefined;
}
