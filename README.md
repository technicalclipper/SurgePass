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
| 6 | **Authorised partners back in at peak**: a partner quota whose seats only allowlisted partners can hold | HTS seat tokens (KYC, freeze, wipe), x402 deposits, scheduled refunds |

Each drop is built from up to three **pools**, switched on per drop in the dashboard:

| Pool | For | Payment |
|---|---|---|
| **Public draw** | Verified humans and their agents | On the provider's site, as today |
| **Premium sealed bid** (optional) | People who'll pay more, with a ceiling | Clearing price on the provider's site |
| **Partner lane** (optional) | Authorised partners: travel apps, agents, resellers | Fares off-chain as today; deposits and seat tokens on Hedera |

Seats flow between pools: partner seats that go unused are added to the public draw, or to its waitlist after the draw.

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

**Provider side (optional, ~10 lines):** verify the header and cap the booking at `seats` (and charge `price` for premium). Ready-to-paste versions for Node.js, Python, Java and Go are in [`docs/integration/`](docs/integration/), and the console's **Integrate** page shows them with your own keys URL and audience filled in, plus test headers to try them with.

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
- **The bid is the per-seat ticket price.** The ticket is paid on the provider's site. Agents pay the small, identical deposit on Hedera via x402.
- **Sealed with commit–reveal:**
  - During the window: `hash(amount ‖ secret)` goes to HCS. Nobody can see the amount.
  - After close: `amount ‖ secret` is revealed and checked against the commitment.
- **Clearing:** the top bids win, and **every winner pays the same price: the highest losing bid.** Bidding your true maximum is the best strategy, so an agent simply bids its human's max.
- **Ties** are broken with the Hedera random number. Seats follow the same strict-order, partial-seats rule.
- **Deposits** are refunded automatically to losers (Hedera scheduled transactions) and to winners after booking.
- The signed header carries `pool: "premium"`, `seats` and `price`.

---

## Partner lane: authorised partners

Providers sell through partners (travel apps, licensed agents, resellers, agent platforms), but at peak some partners grab seats in bulk and resell them, so providers often ban partners from the opening minutes. The partner lane lets them back in, under rules Hedera enforces.

```
Provider allowlists a partner's Hedera account (console)
Partner ─ join ─▶ KYC grant on the drop's seat token (HTS)        only allowlisted accounts can ever hold a seat
        ─ look ─▶ x402 fee per availability check                  look-to-book is paid for
        ─ hold ─▶ x402 refundable deposit per seat → HCS            ordered by consensus timestamp, capped per partner
                  ◀─ seat tokens transferred to the partner
        ─ book ─▶ provider's normal booking site with the pass      X-SurgePass-Assertion names the partner
                  → used tokens retired (wipe) → deposit refunded by a scheduled transaction
Not booked in time → tokens wiped back, deposit kept, seats go to the public draw / waitlist
Cheating partner  → frozen on every seat token in one click
```

- **Allowlist = the partner's Hedera key.** Every partner API call is signed with it (timestamped, replay-protected). On testnet the public key is read from the mirror node.
- **Seat tokens** are an HTS NFT collection per partner drop. SurgePass, for the provider, holds the treasury and the KYC, freeze, wipe and supply keys. Sending a seat to an account without KYC fails at the network: `ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN`.
- **Cap per partner** and an optional **start delay** (e.g. partners only after the first 30 minutes) are set per drop and logged to HCS.
- **Fares stay off-chain**, paid the way partners pay today. Hedera carries the rules: who may hold seats, deposits, seat tokens, and the public record.
- **The console** shows each partner's holds, seats issued, booked and reclaimed, look-to-book ratio, and deposits paid, refunded and kept, with links to the seat token and transfers.

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
  Agent shows approval_url to its human through its own channel (chat, bot, app notification)
  Human taps whenever they see it, up to the moment the drop closes → World App confirm
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
  "user_code": "K7XP-29QD", "token_endpoint": "https://gate.example/token",
  "expires_in": 41400, "expires_at": "2026-11-06T04:30:00Z" }
```

The approval link stays open until the drop's entry window closes, so the agent can ask early
and the human can tap whenever they see the message. SurgePass doesn't contact the human itself:
the agent delivers the link, the same way a TV shows a sign-in code.

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

### Settled transactions (Hedera testnet)

From an end-to-end run on testnet: SurgePass account `0.0.11336236`, reference agent `0.0.11336726`, partners TripNest `0.0.11336728` and Ravi Travels `0.0.11336729`.

| What | Transaction / entity | HashScan |
|---|---|---|
| **Agent paid a surge-priced availability check by itself (x402, ₹0.10)** | `0.0.9185802@1793955572.241691814` | [view](https://hashscan.io/testnet/transaction/1793955578.055780318) |
| Partner paid a lookup fee (x402) | `0.0.9185802@1793955175.340670217` | [view](https://hashscan.io/testnet/transaction/1793955180.571991447) |
| Partner paid a refundable seat deposit (x402, ₹40) | `0.0.9185802@1793955534.116514961` | [view](https://hashscan.io/testnet/transaction/1793955540.669533580) |
| Partner allowlisted on the seat token (HTS KYC grant) | `0.0.11336236@1793955523.397521431` | [view](https://hashscan.io/testnet/transaction/1793955531.675773442) |
| Seat tokens delivered to the partner (HTS NFT transfer) | `0.0.11336236@1793955540.134634029` | [view](https://hashscan.io/testnet/transaction/1793955544.698434500) |
| Deposit refunded automatically (scheduled transaction, executed) | schedule `0.0.11336798` | [view](https://hashscan.io/testnet/schedule/0.0.11336798) |
| Partner seat token (KYC, freeze, wipe, supply keys) | token `0.0.11336790` | [view](https://hashscan.io/testnet/token/0.0.11336790) |
| Draw seed from Hedera's random number service | `0.0.11336236@1793955861.432279639` | [view](https://hashscan.io/testnet/transaction/1793955870.387207651) |
| Drop topic: entries, cutoff (committing to the seed tx), result, passes | topic `0.0.11336787` | [view](https://hashscan.io/testnet/topic/0.0.11336787) |
| Audit topic | topic `0.0.11336732` | [view](https://hashscan.io/testnet/topic/0.0.11336732) |

On the drop topic, `window_closed` (#9) names the seed transaction and reached consensus **before** that random-number transaction ran; the result (#10) uses its seed. The "Check it yourself" page rebuilds the draw from the mirror node and matches.

---|---|---|
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
| **HCS** | One topic per drop: entries, cutoff, seeds, results, seat releases, bid commitments, partner holds and seat movements |
| **HTS seat tokens** | Partner quota as an NFT collection with KYC (allowlist), freeze (cut off a partner), wipe (retire used seats, reclaim unused ones) and supply keys |
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
partner_allowed { drop, partner, token }                     partner lane
partner_hold    { drop, partner, seats, hold }                (ordered by consensus timestamp)
seats_allocated { drop, partner, serials, hold }
seats_redeemed  { drop, partner, serials }
seats_reclaimed { drop, partner, serials, to }
partner_frozen  { partner, frozen }
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

SurgePass's own routes live under `/_sp/` so they never collide with the provider's paths.

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/fair-access.json` | Machine-readable rules for agents |
| `GET /.well-known/jwks.json` | Public key for passes and `X-SurgePass-Assertion` |
| `GET /llms.txt` | Plain-language rules for LLM agents |
| `GET /_sp/openapi.json` | OpenAPI description |
| `GET /_sp/api/drops` · `/_sp/api/drops/:id` | Active and upcoming drops |
| `POST /_sp/api/world/context` | Signed World ID request context (one-time nonce) |
| `POST /_sp/api/world/verify` | World ID proof → human session for that drop |
| `POST /_sp/api/drops/:id/enter` | Enter a normal drop with `{ seats }`; 401 HumanApproval without a human behind it |
| `POST /_sp/api/drops/:id/bid/commit` · `/bid/reveal` | Premium sealed bid (agents pay the deposit via x402) |
| `POST /_sp/api/drops/:id/claim-released` | Fair first come for released seats |
| `GET /_sp/api/partner/drops` | Partner lane: partner drops, seats left, your cap and usage (signed partner request) |
| `POST /_sp/api/partner/drops/:id/join` | KYC grant on the drop's seat token |
| `GET /_sp/api/partner/drops/:id/availability` | Seats left, paid per lookup via x402 |
| `POST /_sp/api/partner/drops/:id/hold` | Hold seats with a refundable x402 deposit; served in consensus order |
| `GET /_sp/api/partner/drops/:id/holds` · `/holds/:hold/pass` | Hold status, seat-token serials, and the pass for booking |
| `GET /_sp/api/drops/:id/status` | Your entry, result, seats, pass, waitlist position |
| `GET /_sp/api/drops/:id/claim` | Winner in a browser: sets the pass cookie and redirects to the booking page |
| `GET /_sp/api/drops/:id/pass` | Winner's agent: pass token to send as `X-SurgePass-Pass` |
| `GET /_sp/api/drops/:id/verify` | Everything needed to recompute the draw or clearing price |
| `POST /_sp/api/agent/link` | Connect an agent to a human with a budget (401 HumanApproval → one tap) |
| `POST /_sp/api/approvals` | Ask the human to approve one or more drops in one go |
| `POST /_sp/api/token` | Device-code exchange → bearer tokens |
| `/_sp/room/...` | Waiting room, agent approval page (`/_sp/room/approve/:code`), recompute page (`/_sp/room/verify/:id`) |
| `/_sp/admin/...` | Provider console API (bearer admin token) |
| `ws /_sp/live` | Live feed for the waiting room and console |
| Remote MCP (`:8090/mcp`) | `connect`, `list_drops`, `request_drop`, `check_availability`, `enter`, `status`, `book` |

---

## Repository layout

```
/packages/shared  drop types, URL matching, Fisher–Yates draw, allocation, premium clearing (Node + browser)
/gateway          reverse proxy: matching, peak mode, World ID, entries, HCS, draw, passes, x402, agents, premium
/waiting-room     human UI (World UI kit): drops, verify, draw reveal, sealed bids, approvals, recompute
/dashboard        provider console: drops, rule builder, routes, traffic, proofs, demo screen
/agent            remote MCP server + CLI reference agent (pays x402 on Hedera)
/provider-mock    QuickBook: an ordinary booking site with a deliberately small backend
/loadgen          k6 and Node bot floods, simulated humans
/scripts          key generation, Hedera setup, demo drops, one-command reset
/config           demo catalog (trains, shows, events)
```

## Tech stack

| Part | Tech |
|---|---|
| Gateway | Node.js + TypeScript, Hono |
| State | Redis |
| World | IDKit 4 (`@worldcoin/idkit`, `@worldcoin/idkit-core`), Developer Portal v4 verify |
| Hedera | `@hiero-ledger/sdk` (HCS, PRNG, scheduled transactions, token association), `@x402/core`, `@x402/hedera` |
| Agent | `@modelcontextprotocol/sdk` (Streamable HTTP), x402 Hedera client signer |
| Waiting room + console | React 19, Vite, Tailwind, `@worldcoin/mini-apps-ui-kit-react`, Framer Motion |
| Load | k6, undici |

---

## Getting started

### Prerequisites
- Node.js 20+ and Redis (`brew install redis && brew services start redis`)
- Hedera testnet accounts from [portal.hedera.com](https://portal.hedera.com): an operator, a receiving account, and an agent account
- A World app from [developer.world.org](https://developer.world.org) (`app_id`, `rp_id`, signing key)

Without Hedera or World credentials everything still runs in **local mode**: HCS messages are kept in Redis, payments are quoted and accepted locally, and the waiting room shows a labelled World ID simulator. Add the credentials and the same flows run on testnet.

### Setup
```bash
npm install
cp .env.example .env          # fill in World and Hedera values
npm run setup:keys            # Ed25519 pass/header keys + admin token
npm run setup:hedera          # checks accounts, creates the audit topic, associates the payment token
```

### Run
```bash
npm run dev                   # providers A (4000) + B (4001), gateway (8080), waiting room, console (5174), agent MCP (8090)
npm run seed                  # demo drops: Tatkal (TQ), Premium Tatkal (PT), a movie show
```

- Waiting room: `http://localhost:8080/_sp/room/` (or open a gated booking URL such as `/tatkal/book/12007/2026-11-06/CC?quota=TQ`)
- Console: `http://localhost:5174` · demo screen at `#demo`
- Agent: add `http://localhost:8090/mcp` to Claude as a remote MCP server, or use the CLI: `npm run agent -- connect 50`

### Demo helpers
```bash
WINDOW_SEC=60 npm run reset   # clear everything and recreate drops with a 60-second window
npm run flood -- --rps 1500 --duration 60     # same bot flood to both sites
k6 run -e RATE=2000 loadgen/bots.js           # the same with k6
npm run humans -- --count 40                  # simulated verified humans (local mode)
npm run agent -- rogue 12007                  # an agent with no human behind it: rejected
npm run partner -- --as tripnest whoami       # partner account + public key, to allowlist in the console
npm run partner -- --as tripnest join partner # then: look partner · hold partner 2 · wait partner · book partner Asha
npm run partner -- --as tout join partner     # not allowlisted: refused
```

### Tests
```bash
npm test                      # draw, allocation, matching, premium clearing
npm run typecheck
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

## Built with AI assistance

Per ETHGlobal's rules: this project was built during the event with Claude Code (Anthropic) as a coding assistant. It helped write code in `gateway/`, `packages/shared/`, `provider-mock/`, `agent/`, `waiting-room/`, `dashboard/`, `loadgen/` and `scripts/`, and the documents `README.md`, `ARCHITECTURE.md`, `DESIGN.md` and `WORLD_DEBRIEF.md`. Commits it contributed to carry a `Co-Authored-By: Claude` trailer. Product decisions, design direction and testing were done by the team.

---

## Why SurgePass

1. **Rate limiting by human, not by IP.**
2. **Floods pay for themselves:** surge-priced x402 turns attack traffic into revenue.
3. **Agents welcome, but bounded:** one human, one entry, a capped budget.
4. **Provable fairness:** HCS cutoff, ordering, seed and results that anyone can recompute.
5. **Partners back in at peak:** only allowlisted partners can hold seats, holds cost a deposit, unused seats go back to the public.
6. **Drop-in:** DNS and a dashboard. The booking site doesn't change.

> *The gate that keeps booking platforms up in the age of AI agents: every place in line is one real human, and it's provable.*
