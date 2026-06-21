# Voltray Operating Model

> How Voltray would actually run as a live service — who funds it, how a user joins
> with minimal friction, what regulation it sits under, and why any of it belongs
> on-chain. `TRUST.md` covers what we have to trust; this covers how the thing operates
> as a business. None of this is built in the MVP — the MVP is the testnet demo of the
> settlement rail. This document is the vision the rail is designed to slot into.

---

## 1. Who is who when it's live

The three contract roles map onto real entities:

| Contract role | Live entity | Why they show up |
|---|---|---|
| **Utility** (funds the vault) | A grid operator (e.g. Taipower) **or an aggregator / VPP acting for it** | Demand response is paid for by the grid: it is cheaper to pay people to use less than to fire up a peaker plant. The money originates here. |
| **User** (responds, gets paid) | An EV driver, home battery, or any flexible load | They own the load that can shift. They are paid in USDC for the reduction. |
| **Oracle** (settles) | Initially the aggregator itself; later decentralized | Produces the verified kWh and submits `settle`. See `TRUST.md §5` for the path off a single hot key. |

**The key positioning:** Voltray is *not* the aggregator and *not* the licensed market
participant. It is the **settlement layer the aggregator runs underneath itself**. The
aggregator keeps its market license and its customer relationship; Voltray replaces the
opaque spreadsheet-and-invoice settlement step with a public, programmable one.

The hard part of aggregation has never been the load — it is paying thousands of small,
mutually distrusting participants fairly, provably, and without a reconciliation cycle.
That is the specific job Voltray does.

---

## 2. Onboarding with minimal friction

Web3's friction is wallets, seed phrases, and gas. A demand-response participant will
not tolerate any of it. Sui has first-party answers, and naming them is part of the
"why on-chain" argument, not an afterthought:

- **zkLogin — no seed phrase.** The user signs in with an existing account (e.g. Google).
  Sui derives a real on-chain address from the OAuth credential. The user never sees a
  mnemonic; the experience matches a web2 login.
- **Sponsored transactions — no gas for the user.** The aggregator pays gas via a gas
  station, so a participant never needs to hold SUI before getting paid. They receive
  USDC; they never fund anything.
- **No hardware to install.** The reduction reading rides on rails the participant's
  charge point operator already has — an OCPP / OCPI session record (`TRUST.md §6`).
  Onboarding is "authorize an account that already holds your charging history," not
  "mount a new meter."

Together these put the join cost at roughly that of a web2 app, which is the bar a
consumer-facing energy product has to clear.

**Implementation status (testnet).** zkLogin is live: "Sign in with Google" via Enoki's
`registerEnokiWallets` shows up in the wallet picker and derives a real address — no seed phrase.
Sponsored gas is **built but gated**: the path (build → Enoki-sponsor → zkLogin-sign → execute) is
wired behind the `SPONSORED_GAS_ENABLED` flag in `web/src/lib/sponsored.ts`, off by default.
Enoki's sponsor API needs a **published (paid) plan** — a sandbox account returns `403 "upgrade
your plan to publish apps"` — so for the MVP demo a zkLogin user funds gas from the testnet faucet,
and the "zero SUI" path is enabled later by upgrading the Enoki plan and flipping the flag. Cheaper/free routes exist and are decoupled from login (keep Enoki for zkLogin, swap only the
sponsor backend): **Shinami**'s gas station seeds a testnet pool for free and is pay-as-you-go on
mainnet (~0.002 SUI per sponsorship, no subscription); or self-host the open-source
**MystenLabs/sui-gas-pool** (no service fee, but you run Redis + a funded sponsor key). The
sponsored flow in `web/src/lib/sponsored.ts` is provider-agnostic — only the sponsor API client
changes.

---

## 3. Compliance posture

Naming the regulation is not optional; the "settlement layer" framing is largely a way
to put each obligation on the party already licensed to carry it.

- **Energy-market participation.** Demand response is regulated. Bidding aggregated
  reduction into a grid program requires registration as a qualified participant
  (Taiwan's 需量反應 program; FERC Order 2222 opening DER aggregators into US wholesale
  markets; the EU's demand-side flexibility rules). Voltray sits *under* a licensed
  aggregator and does not itself hold this license.
- **Payments / stablecoin.** Paying users in USDC touches money-transmission and
  e-money rules, with KYC/AML on payouts above local thresholds. As a settlement rail,
  Voltray lets the licensed counterparty own KYC; the chain moves the value.
- **Data privacy.** Consumption data is personal data (GDPR / local equivalents).
  Raw meter readings therefore **do not go on-chain** — only the settled payout and its
  proof do. Encrypting the underlying report (Seal) is on the roadmap, not the MVP.

---

## 4. Why this is on-chain at all

The honest test: *could a Postgres table plus a bank transfer do this?* If yes, skip the
chain. Voltray's "no" rests on three things, and the pitch must hold to exactly these:

1. **Programmable payouts to many strangers.** Instant, auditable settlement to thousands
   of small participants with no invoice cycle and no need to trust the aggregator's
   books.
2. **A public, enforceable payout rule.** Who gets paid what is in Move, not in a black
   box the aggregator could quietly change.
3. **Composability.** The USDC payout is live capital that can flow straight into other
   on-chain uses.

Strip multi-party trust-minimization, auditability, and programmable money to strangers
out of the story and the chain stops being load-bearing. Those three are the whole
reason for it.

---

## 5. MVP vs. this document

The deployed MVP demonstrates the rail end-to-end on testnet: a funded event, a metered
response, charger-signed settlement, and reclaim of the remainder. zkLogin, sponsored
gas, real OCPP/OCPI ingestion, aggregator licensing, and KYC are described here as the
operating model the rail is built to fit — they are deliberately out of MVP scope
(`CLAUDE.md`, `ARCHITECTURE.md §5`).
