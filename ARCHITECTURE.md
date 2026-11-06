# SurgePass architecture

How the code is organised and how a request moves through it. For the product overview see [README.md](README.md); for the visual system see [DESIGN.md](DESIGN.md).

## Processes

| Process | Port | Code |
|---|---|---|
| Gateway (reverse proxy + SurgePass APIs + live feed) | 8080 | `gateway/src` |
| Provider A, behind the gateway | 4000 | `provider-mock/src` |
| Provider B, hit directly (demo baseline) | 4001 | `provider-mock/src` |
| Waiting room (served by the gateway at `/_sp/room/`) | 5173 in dev | `waiting-room/src` |
| Provider console | 5174 | `dashboard/src` |
| Reference agent, remote MCP | 8090 | `agent/src` |
| Redis | 6379 | — |

The gateway keeps no state of its own beyond in-memory caches: drops, sessions' one-time markers, quotas, entries, passes, approvals and bids live in Redis, and every token is a self-verifying Ed25519 JWT. Any number of gateway instances can run behind a load balancer.

## Gateway modules

| Module | Responsibility |
|---|---|
| `index.ts` | Wires routes, background loops and hooks |
| `gate.ts` | Every provider request: match a drop → peak? → read route (quota / x402) or booking route (pass) → forward |
| `proxy.ts` | Forwarding; strips SurgePass cookies and any client-sent assertion/pass headers |
| `drops.ts` | Drop store in Redis with an in-memory copy, reloaded over pub/sub |
| `mode.ts` | Polls provider metrics; peak = manual, schedule, or load trigger (held 60 s) |
| `world.ts` | RP context signing, nonce bookkeeping, Developer Portal v4 verification, anonymous IDs |
| `identity.ts` | Human sessions (per-drop cookie) and agent bearer tokens |
| `lottery.ts` | Entries, HCS topic per drop, window close, committed seed transaction, Fisher–Yates draw, lifecycle |
| `passes.ts` | Pass issue/claim/check, `X-SurgePass-Assertion`, final-step handling, seat release, expiry |
| `x402.ts`, `pricing.ts` | x402 v2 Hedera `exact` scheme (quote, verify, settle) and the load-based surge price |
| `agents.ts`, `spend.ts` | Agent link, 401 HumanApproval device-code flow, approvals, tokens, budgets, spend audit |
| `premium.ts` | Sealed bids (commit–reveal), deposits, reveal window, uniform-price clearing, refunds |
| `fcfs.ts` | Fair first come for released seats, ordered by HCS consensus timestamp |
| `partners.ts` | Partner lane: allowlist (Hedera keys), signed requests, join (KYC), paid lookups, deposit holds, consensus-ordered allocation, booking, reclaim, freeze |
| `hts.ts` | Seat tokens on HTS: create, mint, KYC grant, freeze, transfer, wipe (Redis simulation in local mode) |
| `hedera.ts`, `hcsqueue.ts` | HCS topics/messages, PRNG, scheduled refunds, mirror-node reads; async submit queue |
| `discovery.ts` | `fair-access.json`, `llms.txt`, OpenAPI |
| `live.ts` | WebSocket feed: sampled decision log (admin), drop/draw updates (public), per-second stats |
| `admin.ts` | Console API: drops CRUD, peak control, test-url, parse-url, health |

`packages/shared` holds the logic that must be identical everywhere: route matching, the seeded Fisher–Yates shuffle, strict-order partial-seat allocation, premium clearing and bid commitments. It runs in Node and in the browser, which is what makes the recompute page possible.

## Request path at peak

```
request ─▶ match drop (in-memory) ─▶ not gated ────────────────────────────▶ forward
                │
                ├─ read route ─▶ human/agent within quota ─────────────────▶ forward
                │              └▶ PAYMENT-SIGNATURE? verify + settle ──────▶ forward + PAYMENT-RESPONSE
                │              └▶ otherwise 402 (x402 v2, hedera:testnet)
                │
                └─ booking route ─▶ valid pass? ─▶ + X-SurgePass-Assertion ─▶ forward
                                   │                 final step → mark used, release unbooked seats
                                   └─▶ 302 to /_sp/room/:drop (403 JSON for API clients)
```

The expensive steps (World verification, payment settlement, HCS writes) happen once per human, only for requests that paid, and asynchronously, respectively.

## Draw sequence

1. Entries are accepted while the window is open and queued to the drop's HCS topic; each gets its HCS sequence number.
2. At close the queue is drained, a transaction ID for the seed is generated and written inside `window_closed` together with `entry_count` and `last_seq`.
3. Hedera's PRNG runs under exactly that transaction ID. A retry reuses the same ID, so there is no second roll.
4. Entries are sorted by sequence, shuffled with Fisher–Yates using `sha256(seed ‖ uint32BE(counter)) mod (i+1)`, and allocated `min(requested, left)` in order.
5. `result` (seed, winners hash) goes to HCS; winners get passes; the rest form the waitlist.

Premium uses the same commit-then-seed pattern, with bids revealed against their commitments and ties broken by the seed.

## Data in Redis

| Key | Holds |
|---|---|
| `drop:{id}`, `drops` | Drop config |
| `wnonce:{nonce}` | Issued World ID request contexts (consumed once) |
| `entered:{drop}`, `entries:{drop}` | One entry per anonymous ID, with seats and HCS sequence |
| `result:{drop}`, `waitlist:{drop}`, `seedtx:{drop}` | Draw result, ordered waitlist, committed seed transaction |
| `pass:{jti}`, `passby:{drop}:{anon}`, `passexp` | Passes, owner index, expiry schedule |
| `released:{drop}`, `claims:{drop}` | Released seats and first-come claims |
| `bids:{drop}`, `refunds:{drop}` | Sealed bids, deposits, refunds |
| `approval:{code}`, `device:{code}`, `agentlink:{acct}`, `agentspend:{acct}` | Agent approvals, links, spend |
| `q:{drop}:{anon}`, `quote:{units}` | Read quotas, recent x402 quotes |
| `partner:{acct}`, `partners`, `pstats:{acct}` | Allowlisted partners and their stats |
| `pallowed:{drop}`, `pfree:{drop}`, `pused:{drop}:{acct}` | KYC'd partners, free seat serials, seats used against each cap |
| `phold:{id}`, `pholds:{drop}:{acct}`, `pqueue:{drop}` | Partner holds and the consensus-ordered queue |
| `hcs:{topic}`, `hts:{token}:*` | HCS messages and HTS state in local mode only |
