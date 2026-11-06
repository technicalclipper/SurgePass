import { config } from "./config.ts";

// Forwards a request to the provider unchanged, except for SurgePass's own cookies and headers.

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer", "host"]);
export const PASS_COOKIE = "sp_pass";
export const SESSION_COOKIE = "sp_session";
export const ASSERTION_HEADER = "x-surgepass-assertion";

/** Removes SurgePass cookies from a Cookie header so the provider never sees them. */
export function stripOurCookies(cookie: string | null): string | null {
  if (!cookie) return null;
  const kept = cookie
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(`${PASS_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=`));
  return kept.length ? kept.join("; ") : null;
}

export async function forward(
  req: Request,
  opts: { assertion?: string; body?: ArrayBuffer; clientIp?: string } = {},
): Promise<Response> {
  const url = new URL(req.url);
  const target = new URL(url.pathname + url.search, config.upstream);
  const headers = new Headers();
  for (const [k, v] of req.headers) if (!HOP_BY_HOP.has(k)) headers.set(k, v);

  const cookie = stripOurCookies(req.headers.get("cookie"));
  if (cookie) headers.set("cookie", cookie);
  else headers.delete("cookie");

  // Never let a client supply its own assertion.
  headers.delete(ASSERTION_HEADER);
  headers.delete("x-surgepass-pass");
  if (opts.assertion) headers.set(ASSERTION_HEADER, opts.assertion);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  if (opts.clientIp) headers.set("x-forwarded-for", opts.clientIp);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const res = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? (opts.body ?? req.body) : undefined,
    redirect: "manual",
    // @ts-expect-error duplex is required by Node for streamed request bodies
    duplex: hasBody && !opts.body ? "half" : undefined,
  });
  const out = new Headers(res.headers);
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
