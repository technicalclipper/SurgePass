import type { Drop, MatchCondition } from "./types.ts";

export interface RequestShape {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  /** Parsed JSON or form body, only when a drop needs a body condition. */
  body?: Record<string, unknown>;
}

/**
 * Matches `path` against a route pattern such as /tatkal/book/:trainNo/:date/:class.
 * With `prefix`, extra trailing segments are allowed (the later steps of a booking flow).
 * Returns the captured params, or null.
 */
export function matchPattern(pattern: string, path: string, prefix = false): Record<string, string> | null {
  const p = split(pattern);
  const s = split(path);
  if (s.length < p.length || (!prefix && s.length !== p.length)) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    const val = decodeURIComponent(s[i]!);
    if (seg.startsWith(":")) params[seg.slice(1)] = val;
    else if (seg === "*") continue;
    else if (seg !== val) return null;
  }
  return params;
}

function split(path: string): string[] {
  return path.split("?")[0]!.split("/").filter(Boolean);
}

function valuesMatch(params: Record<string, string>, values: Record<string, string>): boolean {
  return Object.entries(values).every(([k, v]) => params[k] === v);
}

export function conditionMatches(c: MatchCondition, req: RequestShape, params: Record<string, string>): boolean {
  const actual = lookup(c, req, params);
  switch (c.operator) {
    case "exists":
      return actual !== undefined && actual !== "";
    case "equals":
      return actual !== undefined && actual === String(c.value ?? "");
    case "in": {
      const list = Array.isArray(c.value) ? c.value : String(c.value ?? "").split(",").map((x) => x.trim());
      return actual !== undefined && list.includes(actual);
    }
  }
}

function lookup(c: MatchCondition, req: RequestShape, params: Record<string, string>): string | undefined {
  switch (c.location) {
    case "query":
      return req.query.get(c.key) ?? undefined;
    case "path":
      return params[c.key];
    case "header":
      return req.headers[c.key.toLowerCase()];
    case "body": {
      const v = getPath(req.body, c.key);
      return v === undefined || v === null ? undefined : String(v);
    }
  }
}

export function getPath(obj: unknown, dotPath: string): unknown {
  let cur: unknown = obj;
  for (const part of dotPath.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (part === "length" && Array.isArray(cur)) return cur.length;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export type RouteKind = "booking" | "final" | "read";

export interface DropMatch {
  drop: Drop;
  kind: RouteKind;
  params: Record<string, string>;
}

function exactMatches(drop: Drop, req: RequestShape): boolean {
  if (!drop.exactUrl) return true;
  const want = new URL(drop.exactUrl, "http://x");
  if (want.pathname !== req.path) return false;
  for (const [k, v] of want.searchParams) if (req.query.get(k) !== v) return false;
  return true;
}

/** Finds which registered drop (if any) a request belongs to, and which kind of route it hit. */
export function matchDrop(drops: Drop[], req: RequestShape): DropMatch | null {
  for (const drop of drops) {
    const conds = (params: Record<string, string>) => drop.conditions.every((c) => conditionMatches(c, req, params));

    for (const rp of drop.readPatterns) {
      const params = matchPattern(rp, req.path);
      if (params && valuesMatch(params, drop.values) && conds(params)) return { drop, kind: "read", params };
    }

    const final = matchPattern(drop.finalStepPattern, req.path);
    if (final && req.method.toUpperCase() === drop.finalStepMethod.toUpperCase() && valuesMatch(final, drop.values) && conds(final)) {
      return { drop, kind: "final", params: final };
    }

    const booking = matchPattern(drop.pattern, req.path, true);
    if (booking && valuesMatch(booking, drop.values) && conds(booking) && exactMatches(drop, req)) {
      return { drop, kind: "booking", params: booking };
    }
  }
  return null;
}

/** True when a drop needs the request body to decide a match (so the gateway only buffers bodies when it must). */
export function needsBody(drops: Drop[]): boolean {
  return drops.some((d) => d.conditions.some((c) => c.location === "body"));
}

/** Splits a pasted URL into pieces the dashboard builder can render as tappable segments. */
export function parseUrlForBuilder(raw: string): {
  host: string;
  segments: string[];
  query: { key: string; value: string }[];
} {
  const u = new URL(raw);
  return {
    host: u.host,
    segments: u.pathname.split("/").filter(Boolean).map(decodeURIComponent),
    query: [...u.searchParams].map(([key, value]) => ({ key, value })),
  };
}
