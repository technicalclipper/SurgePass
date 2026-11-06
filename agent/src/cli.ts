import * as sp from "./surgepass.ts";

// Reference agent from the terminal, for scripted demos:
//   npm run cli -w agent -- connect 50
//   npm run cli -w agent -- request "12007" 2
//   npm run cli -w agent -- wait
//   npm run cli -w agent -- enter "12007"
//   npm run cli -w agent -- check "12007" /availability/12007/2026-11-06/CC?quota=TQ
//   npm run cli -w agent -- status "12007"
//   npm run cli -w agent -- book "12007" Asha Ravi
//   npm run cli -w agent -- rogue "12007"      (no human behind it: denied path)

const [cmd, a, b, ...rest] = process.argv.slice(2);
const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));

async function drop(q: string) {
  const d = sp.findDrop(await sp.listDrops(), q);
  if (!d) throw new Error(`no drop matches ${q}`);
  return d;
}

switch (cmd) {
  case "connect":
    out(await sp.connect(a ? Number(a) : undefined));
    break;
  case "request": {
    const d = await drop(a!);
    out(await sp.requestDrops([{ id: d.id, seats: Number(b ?? 1), maxBid: rest[0] ? Number(rest[0]) : undefined }]));
    break;
  }
  case "wait":
    out(await sp.waitForApproval());
    break;
  case "enter": {
    await sp.pollApprovals();
    const d = await drop(a!);
    out(d.pool === "premium" ? await sp.bid(d.id) : await sp.enter(d.id, b ? Number(b) : undefined));
    break;
  }
  case "check": {
    await sp.pollApprovals();
    const d = await drop(a!);
    out(await sp.paidGet(b!, d.id));
    break;
  }
  case "flood": {
    // Checks availability repeatedly, paying beyond the quota, until the budget is reached.
    const d = await drop(a!);
    for (let i = 0; i < Number(rest[0] ?? 10); i++) {
      const r = await sp.paidGet(b!, d.id);
      console.log(r.status, r.paid ? `paid ₹${r.paid.amountInr} ${r.paid.txId}` : (r.body.error ?? "free"));
      if (r.status === 402) break;
    }
    out(sp.spending());
    break;
  }
  case "status": {
    const d = await drop(a!);
    if (d.pool === "premium" && d.status === "revealing") await sp.reveal(d.id);
    out(await sp.status(d.id));
    break;
  }
  case "reveal":
    out(await sp.reveal((await drop(a!)).id));
    break;
  case "book":
    out(await sp.book((await drop(a!)).id, [b, ...rest].filter(Boolean).map((name) => ({ name: name! }))));
    break;
  case "rogue": {
    // A script with no human behind it tries to enter: always rejected, even if it pays.
    const d = await drop(a!);
    const path = d.pool === "premium" ? `/_sp/api/drops/${d.id}/bid/commit` : `/_sp/api/drops/${d.id}/enter`;
    const body = d.pool === "premium" ? JSON.stringify({ commit_hash: "0".repeat(64), seats: 1 }) : '{"seats":1}';
    const r = await fetch(new URL(path, sp.GATEWAY), { method: "POST", headers: { "content-type": "application/json" }, body });
    console.log(r.status, r.headers.get("www-authenticate"), (await r.json()).error);
    break;
  }
  default:
    console.log("commands: connect | request | wait | enter | check | flood | status | reveal | book | rogue");
}
