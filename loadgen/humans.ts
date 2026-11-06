export {};

// Simulated humans (local World ID simulator only): each verifies once and enters a drop.
//   npx tsx loadgen/humans.ts --count 40 --drop <id>     (defaults to the open normal drop)

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const G = arg("gateway", "http://localhost:8080");
const COUNT = Number(arg("count", "40"));
const SPREAD = Number(arg("spread", "10")) * 1000;

const j = (await (await fetch(`${G}/_sp/api/drops`)).json()) as { drops: { id: string; pool: string; status: string; maxSeatsPerEntry: number }[] };
const drop = j.drops.find((d) => d.id === arg("drop", "")) ?? j.drops.find((d) => d.pool === "normal" && d.status === "open");
if (!drop) throw new Error("no open normal drop");
console.log(`${COUNT} humans entering ${drop.id} over ${SPREAD / 1000}s`);

const post = (p: string, b: unknown, h: Record<string, string> = {}) =>
  fetch(G + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(b) });

let ok = 0;
await Promise.all(
  Array.from({ length: COUNT }, async (_, i) => {
    await new Promise((r) => setTimeout(r, Math.random() * SPREAD));
    const ctx = (await (await post("/_sp/api/world/context", { dropId: drop.id })).json()) as any;
    if (!ctx.dev) throw new Error("humans.ts only works with the local World ID simulator");
    const v = await post("/_sp/api/world/verify", { dropId: drop.id, result: { nonce: ctx.rp_context.nonce, action: ctx.action, environment: "dev", responses: [{ nullifier: `sim-${Date.now()}-${i}` }] } });
    const cookie = v.headers.getSetCookie()[0]!.split(";")[0]!;
    const seats = 1 + Math.floor(Math.random() * drop.maxSeatsPerEntry);
    const e = await post(`/_sp/api/drops/${drop.id}/enter`, { seats }, { cookie });
    if (e.ok) ok++;
  }),
);
console.log(`${ok} entered`);
