import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Hono } from "hono";
import { REPO_ROOT } from "@surgepass/shared/env";
import { config } from "./config.ts";
import { broadcast, emit } from "./live.ts";

// The console's "Launch bot flood" button. The flood runs as its own process (so the gateway's
// CPU figure stays honest) and hits both sites with the same traffic: QuickBook B directly, and
// QuickBook A through this gateway. Responses from the direct site are streamed into the live log
// tagged side "direct"; the gate logs its own decisions for the other half as usual.

let child: ChildProcess | null = null;
let state: { running: boolean; rps: number; duration: number; endsAt: number; startedAt: number } = { running: false, rps: 0, duration: 0, endsAt: 0, startedAt: 0 };

function publish(extra: Record<string, unknown> = {}) {
  broadcast({ type: "flood", ...state, ...extra });
}

export function registerFloodAdmin(admin: Hono) {
  admin.get("/flood", (c) => c.json(state));

  admin.post("/flood", async (c) => {
    if (child) return c.json({ error: "already_running", ...state }, 409);
    const { rps = 1500, duration = 45 } = (await c.req.json().catch(() => ({}))) as { rps?: number; duration?: number };
    const r = Math.max(100, Math.min(4000, Math.round(rps)));
    const d = Math.max(5, Math.min(180, Math.round(duration)));
    child = spawn(process.execPath, ["--import", "tsx", "loadgen/flood.ts", "--json", "--rps", String(r), "--duration", String(d), "--gated", `http://localhost:${config.port}`, "--direct", config.directProvider], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    state = { running: true, rps: r, duration: d, startedAt: Date.now(), endsAt: Date.now() + d * 1000 };
    emit({ kind: "system", note: `bot flood launched · ${r} req/s to each site for ${d}s` });
    publish();

    createInterface({ input: child.stdout! }).on("line", (line) => {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.t === "req" && m.side === "direct") {
        const status = Number(m.status) || 0;
        emit({ kind: "bot", side: "direct", method: m.method, path: m.path, status, note: status === 0 ? "connection failed" : status >= 500 ? `site down · ${m.ms} ms` : `${m.ms} ms` });
      } else if (m.t === "stats") {
        publish({ last: { gated: m.gated, direct: m.direct, p95: m.p95 }, remainingSec: m.remainingSec });
      }
    });
    child.on("exit", () => {
      child = null;
      state = { ...state, running: false };
      emit({ kind: "system", note: "bot flood finished" });
      publish();
    });
    return c.json(state, 201);
  });

  admin.post("/flood/stop", (c) => {
    if (!child) return c.json({ ok: true, running: false });
    child.kill("SIGTERM");
    return c.json({ ok: true, stopping: true });
  });
}
