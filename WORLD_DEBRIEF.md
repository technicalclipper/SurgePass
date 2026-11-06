# World ID integration debrief

SurgePass uses World ID in two places: humans verify once in the waiting room to enter a drop, and agents act only after their human approves with World ID (agent link and per-drop approval). Both bind the proof to the action `enter:<drop>` (or `agent-link:<account>`), verify on our backend, and consume the result once.

## What we built on

- `@worldcoin/idkit` 4.x `IDKitRequestWidget` with the `proofOfHuman({ signal })` preset in the waiting room and on the agent approval page.
- `@worldcoin/idkit-core/signing` `signRequest` on the gateway to issue RP contexts; every nonce is stored and consumed atomically, so only proofs we asked for are accepted, once.
- `POST https://developer.world.org/api/v4/verify/{rp_id}` for verification, with the environment pinned server-side.
- `@worldcoin/idkit-core/hashing` `hashSignal` to check that an agent approval's signal (agent account, seats, max bid) matches what the proof committed to.
- The RP-scoped nullifier, normalised and hashed with the action, as the anonymous ID. A human entering directly and their agent entering with approval produce the same ID, so it is one entry per human per drop.

## Protected action and failure paths

| Path | Result |
|---|---|
| Human verifies → enters | Entry accepted, written to HCS |
| Agent without approval enters | 401 HumanApproval; entry not created |
| Human declines the approval | Token endpoint returns `access_denied`; no entry |
| Approval not acted on in 5 minutes | `expired_token`; no entry |
| Proof replayed (same nonce) | Rejected: `unknown_nonce` |
| Proof for another drop or action | Rejected: `action_mismatch` |
| Agent approval with different seats or max bid | Rejected: `signal_mismatch` |
| Same human enters twice (browser or agent) | 409 `already_entered` |

## Time to first success

About an hour of integration work (RP signing, verify call, nonce bookkeeping, IDKit widget), built against a local stand-in first. Once the Developer Portal app, RP ID and signing key were in place, the first staging proof verified on the first attempt: IDKit widget → "Use the simulator" → World ID 4.0 "Unique Human" → our backend's `POST /api/v4/verify/{rp_id}` → session → entry accepted.

The simulator link inside the IDKit widget made the first test much faster than setting up a phone.

## Friction

- **"Agent Pass" is not named anywhere in the docs.** The closest match is Human-in-the-Loop. We had to infer the intended flow from its docs and the IDKit integration guide.
- **Human-in-the-Loop assumes the agent runs inside your own app** (Vercel Workflow and AI SDK). Our agents are external (Claude through a remote MCP server, scripts, other platforms), so we used IDKit directly with our own device-code approval flow (401 HumanApproval → approval link → token endpoint). The binding and consume-once rules from the Human-in-the-Loop guide carried over unchanged.
- **Nullifier formats differ between 3.0 (hex) and 4.0 (decimal).** We normalise before storing. Allowing legacy proofs means tracking both nullifier spaces for the same person, so we keep legacy proofs off by default.
- **Choosing the environment safely** took a careful read: the backend must pin `production` or `staging` itself rather than trust the result's `environment`.

## Missing capabilities or docs

- A documented pattern for **out-of-band approvals for third-party agents** (an agent you don't host asks a human to approve one action), similar to OAuth device flow.
- Approving **several actions in one World App interaction**. Today each action needs its own proof, so approving three drops means three taps.
- A short reference for **checking `signal_hash` on the server** (which hash, which encoding) next to the verify API.

## Single highest-impact improvement

A first-class "approve this action for my agent" flow: the agent receives a link or push, the human approves in World App, and the relying party gets a proof bound to the action and parameters. This works for agents the relying party doesn't host, without needing a workflow runtime.
