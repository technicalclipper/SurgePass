# SurgePass

**A fair gate in front of any booking platform.**
At peak times, SurgePass decides who is allowed to reach the booking server: only real humans (and the agents acting for them), picked fairly, and only as many as there are seats.

> **World decides who gets in. Hedera makes floods pay and proves the draw was fair. Providers change nothing.**

Built at **ETHGlobal Mumbai 2026** for the **World** and **Hedera** tracks.

---

## The problem

When something scarce goes on sale at a fixed moment (Tatkal train tickets at 10 AM, concert drops, first-day movie shows, visa and exam slots):

1. **Everyone arrives in the same second.** Millions of requests hit the booking site at once.
2. **The site crashes.** Load balancers spread traffic but can't tell a real buyer from 10,000 bot requests, and every booking request is expensive (database, seat locks, payment setup).
3. **Bots win.** First come, first served rewards speed. Bots are fastest, so touts take the stock and resell it.
4. **AI agents make it harder.** People increasingly book through agents, so "block all bots" no longer works: many of them act for a real person.

**Root cause:** a scarce item sold first come, first served, with no way to tell **one human** from **10,000 requests**.

---

## What SurgePass does

SurgePass is a **reverse proxy** that sits in front of the provider's load balancer. The provider points its domain at SurgePass and registers its high-demand items (**drops**) in a dashboard.

- **Normal times:** SurgePass is invisible. All traffic passes straight through.
- **Peak times, for gated drops only:**
  - **Bots and floods never reach the server.** They are sent to the waiting room, rejected, or charged per request.
  - **Real humans** enter once each, verified with **World ID**. Agents enter only on behalf of a verified human.
  - SurgePass runs a **provably fair draw** and picks exactly as many winners as the provider has seats.
  - **Only winners reach the server**, carrying a one-time pass and a signed header that says how many seats they may book.
- **Everything else on the platform** (other trains, other shows, other pages) passes straight through, even at peak.

The provider's booking flow (login, payment, ticketing) is **unchanged**.

### Five building blocks

| | What | Powered by |
|---|---|---|
| 1 | **One human, one entry**: anonymous, per-drop identity | World ID |
| 2 | **A draw instead of a race**: equal odds for everyone who enters in the window | Fisher–Yates shuffle, Hedera random number |
| 3 | **Floods pay**: availability checks are free within a per-human quota, then cost a small, load-based surge price | x402 on Hedera |
| 4 | **Provably fair**: entries, cutoff, seed and results are public and recomputable | Hedera Consensus Service (HCS) |
| 5 | **Winners book normally**: a one-time pass to the provider's existing booking page | Signed pass + signed header |

---

## Architecture

```
Users / Agents / Bots
        │  provider's domain → CNAME → SurgePass (serves the provider's TLS certificate)
        ▼
┌──────────────────────────────── SURGEPASS (reverse proxy) ─────────────────────────────────┐
│ 1  Edge router + mode controller   match route pattern → drop? peak on?                    │
│ 2  Waiting room (hosted UI)        pick drop, verify, enter, see results                   │
│ 3  Identity (World)                human sessions, agent links, drop approvals             │
│ 4  Read shaping (x402 on Hedera)   free per-human quota → 402 surge price beyond           │
│ 5  Pricing engine                  backend load → surge price                              │
│ 6  Allocation engine               draw | premium | fair first come                        │
│ 7  Proof layer (Hedera)            HCS topic per drop, random number seed                  │
│ 8  Pass issuer + enforcer          signed one-time pass, signed seat/price header          │
│ 9  Agent interface                 drops API, 401 approval link, remote MCP, discovery     │
│ 10 Provider dashboard              URL gating, drops, schedules, analytics, proof links    │
│ State: Redis                                                                               │
└────────────────────────────────────────────────────────────────────────────────────────────┘
        │ forwarded only: non-matching traffic · normal-period traffic · allowed/paid reads · pass holders
        ▼
Provider's load balancer → provider's backend (unchanged)
```

### Who touches what

| Party | World | Hedera | Changes needed |
|---|---|---|---|
| Human | One-tap World ID | Never | None |
| Agent | One approval from its human | Wallet + x402 client | None (open standards) |
| SurgePass | Server-side proof verification | Receiving account, facilitator, HCS, random number | — |
| Provider | Never | Never | DNS + dashboard |

### Request routing

```
Request arrives
 │
 ├─ Matches a registered drop (route pattern + values + match conditions)?
 │     no ───────────────────────────────────────────────▶ forward untouched
 │
 ├─ Is that drop's peak period on (schedule or load trigger)?
 │     no ───────────────────────────────────────────────▶ forward untouched
 │
 ├─ Read route (availability / status)?
 │     human or agent within quota ──────────────────────▶ forward (free)
 │     otherwise → 402 (x402, Hedera, surge price)
 │                   paid and settled ───────────────────▶ forward
 │                   unpaid ─────────────────────────────▶ stop (cheap 402)
 │
 ├─ Booking route?
 │     valid pass (signature · right drop · not expired · not used)
 │        → strip pass cookie → add signed header → forward → provider books normally
 │        → final step succeeds → pass marked USED, unbooked seats released
 │     no / invalid pass ────────────────────────────────▶ redirect to the waiting room
 │
 └─ SurgePass APIs (waiting room, enter, approve, token, drops, status)
```

### Built for the flood

Every bot request costs SurgePass **microseconds** and costs the backend **nothing**. Checks run cheapest first:

1. Network DDoS protection and CDN cache absorb raw volume and serve the waiting-room redirect.
2. No pass on a gated drop → static redirect. Session or pass → local signature check, no network call. Over quota → static 402.
3. Quota counters and one-time markers live in Redis.
4. Expensive work happens rarely: World verification **once per human**, payment verification **only for requests that paid**, HCS writes asynchronously.

The gateway is stateless (state in Redis, self-verifying tokens), so it scales out horizontally. The draw itself removes the reason to retry: entering at 10:00:00 or 10:04:59 gives the same odds.

---

## Provider dashboard

### One-time setup
1. **Domain:** CNAME to SurgePass.
2. **Route patterns:** booking flow (all steps), the final-step route, and read routes.
3. **Peak defaults:** a schedule (e.g. 10:00–10:15 IST daily) and/or a load trigger (e.g. p95 latency > 800 ms or error rate > 5%).
4. **Read pricing:** a free quota per human and a surge range (e.g. ₹0.10–₹5).

### Gating a URL
Normal drops and premium drops are **two separate sections**, each with its own URL gating and its own settings, because every platform marks premium differently (a query parameter, a different path, a header).

- **Paste a full URL**, e.g. `https://booking.example.com/tatkal/book/12007/2026-11-06/CC?quota=TQ&lang=en`
  - Tap path segments to turn them into drop values → `/tatkal/book/:trainNo/:date/:class`
  - Tap query parameters to **match** (`quota=TQ`) or **ignore** (`lang`)
  - Or toggle **"Match this exact URL"**
- **Or use the builder:** domain, saved route pattern, path values, and match conditions `[location][key][operator][value]` on query, path, body field or header, with `equals`, `in`, `exists`.
- **Helpers:** a live **"Test a URL"** box, bulk add by CSV or pasted URLs, `POST /drops`, and recurring drops (e.g. daily Tatkal for a list of trains).

### Drop settings

| Setting | Normal drop | Premium drop |
|---|---|---|
| URL gating | Own builder / pasted URL | Own builder / pasted URL |
| Seats (N) | e.g. 60 | e.g. 12 |
| Max seats per entry | e.g. 4 | e.g. 4 |
| Window | e.g. 10:00–10:05 | e.g. 10:00–10:05 |
| Price | Provider's normal price | Floor, ceiling, fixed deposit |
| Confirmed-seats field | Where the booking response reports seats booked | Same |

### Analytics
Entries (humans vs agents), bots blocked, paid reads and surge revenue, backend load vs baseline, winners, waitlist, passes used vs expired, seats released, premium clearing price, and **HCS / HashScan links** for every drop.

---

## How the draw works

### 1. Entry
- A human verifies with World ID in the waiting room (one tap; on a phone it opens World App).
- They choose how many seats they need, from 1 up to the drop's **max seats per entry**.
- One entry per anonymous ID per drop. Each entry is written to the drop's HCS topic, which gives it a consensus timestamp and sequence number.

### 2. Cutoff
When the window closes, `window_closed { drop, entry_count, last_seq }` is written to HCS. Its consensus timestamp proves the cutoff, and `last_seq` fixes exactly which entries count.

### 3. Shuffle
- SurgePass requests a random seed from **Hedera's random number service**.
- The seed drives a **Fisher–Yates shuffle** of the HCS-ordered entry list. Random values are derived as `sha256(seed ‖ counter)`.
- Same entries + same seed + same code = the same order, for anyone who recomputes it.

### 4. Allocation: strict order, partial seats
Walk the shuffled list in order. Each person gets **`min(seats requested, seats left)`**. Stop when the seats run out.

```
N = 10
Divya  wants 4 → gets 4   (6 left)
Neha   wants 3 → gets 3   (3 left)
Karan  wants 4 → gets 3   (0 left)  ← partial; it's his choice to book them
Ravi   wants 2 → waitlist #1
Arjun  wants 1 → waitlist #2
```

Nobody with a better position is ever skipped.

### 5. Result
`result { drop, policy, seed, winners_hash }` is published to HCS. `GET /drops/:id/verify` returns everything needed to recompute the draw.

### 6. Seats flow back
A pass allows **up to** its seat count:
- **Booked fewer seats** → the unbooked seats are released immediately when the final step succeeds.
- **Pass expires** (~10 minutes) → all its seats are released.

Released seats go to the waitlist using the same rule (strict order, `min(requested, left)`), and each release is logged to HCS as `seats_released`.

---

## Passes and the signed header

A winner receives a **signed, one-time pass** (cookie on the provider's domain), bound to the drop, the anonymous ID, the seat count, and a ~10-minute expiry.

```json
{ "drop": "train-12007-2026-11-06-CC", "sub": "<anonId>", "pool": "normal",
  "seats": 3, "requested": 4, "exp": "2026-11-06T10:16:00+05:30", "jti": "<unique>" }
```

When the winner's booking request passes through, SurgePass **deletes any client-sent assertion header** and adds a fresh **Ed25519-signed JWT**:

```
X-SurgePass-Assertion: <jwt>
```
```json
{ "iss": "surgepass", "aud": "booking.example.com",
  "drop": "train-12007-2026-11-06-CC", "pool": "normal",
  "seats": 3, "requested": 4, "price": null,
  "pass_id": "p_8f2…", "exp": 1762400000 }
```

- The public key is published at `/.well-known/jwks.json` (with `kid` for rotation).
- The header only exists on the SurgePass → provider hop, so users never see it, and any change breaks the signature.
- The provider can verify it but can't forge it.

**Provider side (optional, ~10 lines):** verify the header and cap the booking at `seats` (and charge `price` for premium).

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(new URL("https://gate.example/.well-known/jwks.json"));

const { payload } = await jwtVerify(req.headers["x-surgepass-assertion"], JWKS, {
  issuer: "surgepass",
  audience: "booking.example.com",
});
if (payload.drop !== dropOf(req)) throw new Error("drop mismatch");
limitPassengers(payload.seats);
if (payload.pool === "premium") charge(payload.price);
```

Without that check, SurgePass still reads the confirmed seat count from the booking response, releases unbooked seats, and flags any overbooking on the dashboard.

---

## Premium: fair sealed-bid pool

A separate drop for a share of the seats, in the spirit of Premium Tatkal: **a fair premium with a ceiling.**

- **Provider sets:** pool size, floor (normal price), ceiling, fixed deposit, max seats per entry.
- **One bid per human** (World ID). For agents, the human's max bid is bound inside the World approval.
- **The bid is the per-seat ticket price.** Only the small, identical deposit is paid on Hedera via x402; the ticket is paid on the provider's site.
- **Sealed with commit–reveal:**
  - During the window: `hash(amount ‖ secret)` goes to HCS. Nobody can see the amount.
  - After close: `amount ‖ secret` is revealed and checked against the commitment.
- **Clearing:** the top bids win, and **every winner pays the same price: the highest losing bid.** Bidding your true maximum is the best strategy, so an agent simply bids its human's max.
- **Ties** are broken with the Hedera random number. Seats follow the same strict-order, partial-seats rule.
- **Deposits** are refunded automatically to losers (Hedera scheduled transactions) and to winners after booking.
- The signed header carries `pool: "premium"`, `seats` and `price`.

---

## Agents

SurgePass welcomes agents and binds each one to a verified human. No SDK required: everything uses open standards.

```
SETUP (once, ~30 days, revocable)
  Human connects agent → one World ID tap → AGENT LINK (anonymous ID ↔ agent's Hedera account)
  Agent's Hedera account is funded with a capped spending budget

REQUEST (when the human asks, e.g. the night before)
  Human: "Get me Train 12007, 6 Nov, CC, 2 seats"
  Agent → GET /drops → POST /drops/{id}/enter
  SurgePass → 401 HumanApproval { approval_url, user_code, token_endpoint, expires_in }
  Human → approval card in chat or a push → one tap → World App confirm
  Agent polls token_endpoint → bearer token scoped to that drop (+ max bid for premium)

PEAK (zero human interaction)
  Availability within its human's quota → free
  Over quota → 402 → agent pays on Hedera by itself → retries → data
  Agent enters with its bearer token → one entry per human → HCS
  Result → pass + booking link → books on the provider's page
```

**401 HumanApproval**
```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: HumanApproval realm="train-12007-2026-11-06-CC"
Content-Type: application/json

{ "error": "human_approval_required", "drop": "train-12007-2026-11-06-CC",
  "label": "Train 12007 · 6 Nov · CC", "approval_url": "https://gate.example/approve/K7XP-29QD",
  "user_code": "K7XP-29QD", "token_endpoint": "https://gate.example/token", "expires_in": 300 }
```

**Supported agent types**
- **API agents:** read the 401, show the link, poll for a token, pay 402s with any x402 client.
- **MCP agents (Claude, ChatGPT):** a hosted **remote MCP server**, added by URL.
- **Browser agents:** land in the same waiting room; the human taps to approve.

**Discovery:** `/.well-known/fair-access.json`, `/llms.txt`, and an OpenAPI spec.

**Who pays what**

| | Availability checks | Draw entry | Premium | Ticket |
|---|---|---|---|---|
| Human | Free within quota | Free, one per drop | Small refundable deposit | Provider's site |
| Human-backed agent | Shares its human's quota, then pays per request | Its human's single entry | Same as human, max bid bound in approval | Provider's site |
| Unbacked bot | Always pays the surge price | Rejected | Rejected | — |

> **Money buys reads. Only humans get entries. Tickets are always paid on the provider's site.**

---

## Payment flow: x402 on Hedera

Availability and status routes for a gated drop are free within each human's quota. Beyond it, or for any request with no human behind it, SurgePass answers **402 Payment Required** at the current surge price, which rises with backend load.

```
1. Client  → GET /availability/12007
2. Gateway → 402 Payment Required + PaymentRequirements
3. Client  → builds and signs a Hedera TransferTransaction to payTo, Base64-encodes it,
             retries with the payment payload
4. Gateway → facilitator /verify → /settle (facilitator is the fee payer and submits)
5. Gateway → 200 + data, settlement transaction ID logged
```

**402 response (x402 v2, Hedera `exact` scheme)**
```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{ "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "hedera:testnet",
    "amount": "<amount in smallest unit>",
    "asset": "<HTS token ID, or 0.0.0 for HBAR>",
    "payTo": "<SurgePass receiving account>",
    "maxTimeoutSeconds": 180,
    "extra": { "feePayer": "<facilitator fee payer account>" }
  }] }
```

- Settles in **HBAR** or an **HTS token** (test USDC).
- Facilitator: the official x402 facilitator or Blocky402 on Hedera testnet.
- Surge pricing: e.g. ₹0.10 → ₹1 → ₹5 as backend load rises.
- Every paid request is visible on HashScan.

### Settled transactions

| What | Transaction ID | HashScan |
|---|---|---|
| Agent paid surge-priced availability check | _added after the demo run_ | — |
| Premium deposit | _added after the demo run_ | — |
| HCS topic for the demo drop | _added after the demo run_ | — |

---

## Hedera services used

No Solidity anywhere. Everything uses the Hedera SDK and native services.

| Service | Use |
|---|---|
| **x402 settlement** | Surge-priced reads beyond the free quota, premium deposits |
| **HTS** | Payment token (test USDC) |
| **HCS** | One topic per drop: entries, cutoff, seeds, results, seat releases, bid commitments |
| **Random number service** | Draw seed and tie-breaks |
| **Scheduled transactions** | Automatic premium deposit refunds |
| **Mirror Node** | Public read-back of HCS messages for independent verification |

### HCS message types (one topic per drop, no real identities)
```
peak_on         { drop, ts }
entry           { drop, anon_id, kind: human|agent, seats, agent_account? }
claim           { drop, anon_id, unit_id }                   fair first come
bid_commit      { drop, anon_id, commit_hash }               premium
bid_reveal      { drop, anon_id, amount, secret }            premium
window_closed   { drop, entry_count, last_seq }
result          { drop, policy, seed, winners_hash, price? }
pass_issued     { drop, jti_hash, seats }
seats_released  { drop, jti_hash, count }
```

### Fair first come
For seats released one at a time (cancellations, returns): verified humans and agents submit claims, each written to HCS, and they are ordered by **Hedera consensus timestamp**, not SurgePass's clock.

---

## World ID

- **Humans:** one-tap World ID in the waiting room. The anonymous ID (nullifier) for action `enter:<drop>` enforces one entry per human per drop without revealing identity.
- **Agents:** a human-in-the-loop approval per drop. The agent pauses, the human approves with World ID, the backend verifies the proof server-side, binds it to the drop (and max bid), and consumes the nullifier once.
- **Denied paths:** no approval, an expired approval, or a declined approval → the entry never happens.
- Proofs are always verified on the server; the client's response is never treated as authorization.

See [`WORLD_DEBRIEF.md`](WORLD_DEBRIEF.md) for the integration debrief.

---

## API

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/fair-access.json` | Machine-readable rules for agents |
| `GET /.well-known/jwks.json` | Public keys for the signed header |
| `GET /llms.txt` | Plain-language rules for LLM agents |
| `GET /drops` | Active and upcoming drops |
| `GET /waiting-room/:dropId` | Hosted human UI |
| `POST /world/verify` | World proof → human session |
| `POST /agent/link` | Connect an agent (World proof → agent link) |
| `POST /drops/:id/enter` | Enter a drop (seats); 401 HumanApproval if not approved |
| `POST /drops/:id/bid/commit` · `/bid/reveal` | Premium sealed bid |
| `GET /approve/:code` | Approval page (opens World App) |
| `POST /token` | Agent polls → bearer token after approval |
| `GET /drops/:id/status` | Window state, entry count, result, pass, booking link, HCS link |
| `GET /drops/:id/verify` | Everything needed to recompute the draw |
| `POST /drops` | Create a drop (dashboard API) |
| Remote MCP | `connect`, `list_drops`, `request_drop`, `check_availability`, `enter`, `status`, `book` |

---

## Repository layout

```
/gateway        router, mode controller, identity, quota, pricing, x402, allocation, HCS, passes, agent APIs
/waiting-room   human UI
/dashboard      provider console: URL gating, drops, analytics, proof links
/agent          remote MCP server + reference agent
/provider-mock  a normal booking site with deliberately limited capacity
/loadgen        bot flood + human simulators (k6)
/config         sample drops (train, movie, concert)
```

## Tech stack

| Part | Tech |
|---|---|
| Gateway | Node.js + TypeScript |
| State | Redis |
| World | IDKit, Human-in-the-Loop |
| Hedera | Hedera SDK (HCS, HTS, random number, scheduled transactions), `@x402/core`, `@x402/hedera` |
| Agent | Remote MCP server, x402 client, Hedera wallet |
| Waiting room + dashboard | React with live updates |
| Load generator | k6 |

---

## Getting started

### Prerequisites
- Node.js 20+
- Redis
- A Hedera testnet account (portal.hedera.com) and a funded agent account
- A World developer portal app

### Environment
```bash
# World
WORLD_APP_ID=app_...
WORLD_RP_ID=...
WORLD_SIGNING_KEY=...

# Hedera
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=0.0.xxxx
HEDERA_OPERATOR_KEY=...
SURGEPASS_PAY_TO=0.0.xxxx
X402_FACILITATOR_URL=https://x402.org/facilitator
PAYMENT_ASSET=0.0.xxxx

# Agent
AGENT_ACCOUNT_ID=0.0.xxxx
AGENT_PRIVATE_KEY=...

# Gateway
REDIS_URL=redis://localhost:6379
PASS_SIGNING_KEY=...        # Ed25519 private key for passes and the signed header
UPSTREAM_URL=http://localhost:4000
```

Never commit keys. Copy `.env.example` to `.env` and fill it in.

### Run
```bash
npm install
npm run dev
```

---

## Demo

Two identical mock booking sites receive the **same bot flood** at the same moment: one directly, one through SurgePass.

1. **The flood:** 10,000 bots hit both. The unprotected site crashes; the protected one stays flat, and the gateway stays well within capacity.
2. **Gate a URL:** in the dashboard, gate `/tatkal/book/:trainNo/:date/:class`, set N seats and max seats per entry.
3. **Bots blocked:** redirects, 401 rejections, 402 payments and the surge price climbing live. Ungated pages load normally.
4. **Human:** waiting room → World ID tap → enters for 2 seats → entry appears on HCS.
5. **Agent:** "Get me Train 12007, 2 seats" → one approval tap → the agent pays 402s on Hedera by itself → HashScan.
6. **Denied path:** a script with no approval is rejected, even when it pays.
7. **The draw:** the window closes on HCS, the Hedera seed arrives, the Fisher–Yates shuffle runs live, seats are allocated (including a partial allocation), and **"Recompute it yourself"** matches the published winners.
8. **Booking:** the winner lands on the normal booking page, capped at their seats by the signed header. Booking fewer releases the rest to the waitlist.

---

## Why SurgePass

1. **Rate limiting by human, not by IP.**
2. **Floods pay for themselves:** surge-priced x402 turns attack traffic into revenue.
3. **Agents welcome, but bounded:** one human, one entry, a capped budget.
4. **Provable fairness:** HCS cutoff, ordering, seed and results that anyone can recompute.
5. **Drop-in:** DNS and a dashboard. The booking site doesn't change.

> *The gate that keeps booking platforms up in the age of AI agents: every place in line is one real human, and it's provable.*
