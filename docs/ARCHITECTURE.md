# Voltray Architecture

> On-chain design for a decentralized energy Demand Response (DR) system.
> This document is a working skeleton — the source of truth is `contracts/`.

---

## 1. Overview

Voltray moves the traditional DR flow — "the utility pays users to reduce consumption" — onto Sui as a conditional, auto-settled payment.

**Roles**
- **Utility** — publishes DR events and funds the reward pool
- **User** — registers a smart meter, responds to events, receives rewards
- **Oracle** — reports actual consumption and triggers settlement

**High-level flow**

```
Utility ──create_event──▶ DREvent (Shared)
                              │
User ──register_meter──▶ SmartMeter (Owned)
                              │
User ──respond──▶ emit MeterResponded event
                              │
Oracle ──settle──▶ scan event log → pay out from RewardVault
```

### 1.1 Economic model

Voltray is a **pay-per-reduction bounty with a capped pool** — the same shape as a real-world DR capacity payment.

- **1 unit = 1 kWh of consumption reduced below the user's baseline.** This is the physical meaning of a "unit" everywhere in the contract.
- **`reward_per_unit`** — the price (in µUSDC, 6 decimals) the utility offers per kWh saved.
- **`target_reduction`** — the total kWh the utility wants shaved across *all* participants in this event.
- **Vault = `reward_per_unit × target_reduction`** — pre-funded to cover the worst case (everyone hits target), so the contract never promises money it cannot pay. Settlement draws down `remaining_units` first-come-first-served until the pool is exhausted.

**Why pay in USDC (stablecoin-denominated).** Rewards are denominated in USDC so a fixed `reward_per_unit` is a stable real-world incentive — a floating-price coin like SUI would make the per-kWh price drift. The contract is **generic over the reward coin `Coin<T>`**, so the package itself depends on no specific coin package; the frontend and oracle pass Circle USDC as the type argument (testnet USDC for the demo, mainnet USDC needs no contract change). Amounts are in µUSDC (6 decimals). See §5.

**Reward sizing is the charger's signed input, not an on-chain model.** `saved_units` is supplied at `settle` time, but it must carry an ed25519 signature from the event's authorised charger, verified on-chain before payout (`sui::ed25519::ed25519_verify`; see TRUST.md §5.1) — the operator can't fabricate the number. A production system would derive `saved_units` from a baseline-vs-actual measurement & verification (M&V) pipeline behind that same signature; that pipeline is explicitly out of MVP scope (§7).

---

## 2. Object Schema

### 2.1 `SmartMeter` (Owned)

Represents a user's smart meter. Held by the user.

```move
struct SmartMeter has key, store {
    id: UID,
    owner: address,
    label: String,  // hardware identifier; on-chain verification deferred (see §5)
}
```

**Why Owned:** No consensus overhead, cheap reads/writes, single owner by nature.

**No aggregate fields (e.g. `total_rewards_earned`, `response_count`).** `settle` is admin-only and cannot mutate the user's Owned `SmartMeter`. Aggregates are derived off-chain by scanning `Settled` events filtered on `responder == owner`. See §5.

---

### 2.2 `DREvent` (Shared)

The DR event itself. Must be readable by everyone.

```move
struct DREvent has key {
    id: UID,
    utility: address,
    reward_per_unit: u64,
    target_reduction: u64,    // original cap (immutable, for display / audit)
    remaining_units: u64,     // decremented by settle() under FCFS (see §5)
    start_time: u64,
    end_time: u64,
    // TODO: status (Active/Settled), ...
}
```

**⚠️ Anti-pattern: do NOT store `vector<address>` of participants here.**

Reasons:
- `DREvent` is a Shared Object — every write goes through consensus
- All concurrent `respond()` calls would contend on the same object lock → parallelism lost
- A growing vector means rising gas per write

**Correct approach:** `respond()` emits an event; off-chain / oracle reads the event log to enumerate participants.

---

### 2.3 `RewardVault` (Shared)

Holds the reward funds the utility pre-deposited.

```move
struct RewardVault<phantom T> has key {
    id: UID,
    event_id: ID,        // links to the DREvent
    balance: Balance<T>, // T = reward coin (Circle USDC on testnet/mainnet); see §1.1, §5
}
```

**Why Shared:** Multiple `settle()` calls need to withdraw from it.

---

## 3. Function Signatures & Flow

### 3.1 `create_event`

```move
public fun create_event<T>(
    reward_coin: Coin<T>,
    reward_per_unit: u64,
    target_reduction: u64,
    start_time: u64,
    end_time: u64,
    charger_pubkey: vector<u8>, // 32-byte ed25519 key authorised to sign this event's readings
    ctx: &mut TxContext,
)
```

- Caller: utility
- Creates a `DREvent` and a matching `RewardVault` funded by `reward_coin`; both are shared.
- Stores `charger_pubkey` on the event (asserts length 32, E_BAD_PUBKEY); `settle` verifies session signatures against it (§3.4, TRUST.md §5.1).
- Also asserts the vault covers the worst case (`reward_coin.value() >= reward_per_unit * target_reduction`, E_UNDERFUNDED) and `start_time < end_time` (E_INVALID_WINDOW).
- Emits: `EventCreated { event_id, utility, reward_per_unit }`

---

### 3.2 `register_meter`

```move
public fun register_meter(
    // TODO: initial meter params
    ctx: &mut TxContext,
)
```

- Caller: user
- Creates a `SmartMeter` and transfers it to the sender.
- Emits: `MeterRegistered { meter_id, owner }`

---

### 3.3 `respond`

```move
public fun respond(
    event: &DREvent,
    meter: &mut SmartMeter,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

- Caller: user
- **Writes nothing to any Shared Object field.** Only emits an event and records dedup state on the caller's own meter.
- Emits: `MeterResponded { event_id, meter_id, responder, timestamp }`
- Checks:
  - `meter.owner == ctx.sender()` (E_NOT_METER_OWNER)
  - `clock.timestamp_ms()` within `[event.start_time, event.end_time]` (E_OUTSIDE_WINDOW)
  - Not already responded: a dynamic field keyed by `event_id` on the **Owned** `SmartMeter` (E_ALREADY_RESPONDED). Owned-object writes do not contend on a shared lock, so `event` stays `&DREvent` and per-event single-response is enforced on-chain without violating the no-accumulating-state-in-shared-objects rule.
- `timestamp` in the emitted event is `clock.timestamp_ms()` — used by the oracle to order responders for FCFS settlement.

---

### 3.4 `settle`

```move
public fun settle<T>(
    event: &mut DREvent,
    vault: &mut RewardVault<T>,
    responder: address,
    meter_id: ID,
    saved_units: u64,
    signature: vector<u8>, // charger ed25519 sig over event_id ‖ meter_id ‖ responder ‖ saved_units
    ctx: &mut TxContext,
)
```

- **Charger-signature gate (required):** rebuilds `event_id ‖ meter_id ‖ responder ‖ saved_units` and asserts `ed25519_verify(signature, event.charger_pubkey, msg)` (E_BAD_SIGNATURE) before any payout — so the submitter cannot fabricate `saved_units`, and `meter_id`/`responder` are bound by the signature rather than trusted blindly. See TRUST.md §5.1.
- Caller: the `event.utility` submits the tx (asserts `ctx.sender() == event.utility`, E_NOT_UTILITY), but the value it pays is fixed by the charger signature, not its word.
- **Vault/event binding check (required):** `assert!(vault.event_id == object::id(event), E_WRONG_VAULT)` — without this, the utility could drain any vault by passing a mismatched pair.
- **Double-settle dedup (required):** a dynamic field keyed by `meter_id` on the Shared `RewardVault` marks a paid response, so the same `(event, meter)` cannot be paid twice (E_ALREADY_SETTLED). The vault is 1:1 with the event and `settle` already mutates it, so the marker adds no extra shared-lock contention. It lives on the vault rather than the Owned `SmartMeter` because `settle` cannot touch the responder's meter.
- Allocation: **first-come-first-served**. Pays `min(saved_units, event.remaining_units) × reward_per_unit` from `vault`, then decrements `event.remaining_units`. Late responders may get partial or nothing.
- `meter_id` is passed in by the oracle (read from the `MeterResponded` event log) and is part of the signed message, so it is bound by the charger signature, not trusted blindly. The contract does **not** look up the meter object — `settle` cannot touch the user's Owned `SmartMeter`.
- Emits: `Settled { event_id, meter_id, responder, amount, units_paid }`
- **TODO(post-MVP):** authorise a *set* of charger keys per event; bind a meter to its charger (TRUST.md §3.1); M-of-N / multisig settlement (§5.2).

---

### 3.5 `reclaim_remaining`

```move
public fun reclaim_remaining<T>(
    event: &DREvent,
    vault: &mut RewardVault<T>,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

- Caller: **`event.utility` only** (E_NOT_UTILITY).
- Returns the vault's unspent balance to the utility once the window has closed. The vault is pre-funded for the worst case (every participant hits target); in practice responders rarely claim all of it, so this recovers the surplus instead of stranding it on-chain.
- Checks: utility-only; `vault.event_id == object::id(event)` (E_WRONG_VAULT); `clock.timestamp_ms() > event.end_time` (E_EVENT_NOT_ENDED) so funds can't be pulled out from under active responders.
- No-op (early return) if the balance is already zero. Emits: `Reclaimed { event_id, amount }`.
- **TODO(post-MVP):** with a decentralised settler, gate reclaim behind a settlement-finality / grace window so leftovers can't precede pledged-but-unsettled payouts. Under MVP admin-only settlement the utility already controls payouts, so reclaim grants no new power.

---

## 4. Happy Path Sequence

```
Utility       User         SmartMeter   DREvent     RewardVault   Oracle
  │            │               │           │             │           │
  │─create_event─────────────▶│ create  │ create        │           │
  │            │               │           │             │           │
  │            │─register_meter▶  create  │             │           │
  │            │               │           │             │           │
  │            │─respond──────────────────▶│             │           │
  │            │               │      emit MeterResponded│           │
  │            │               │           │             │           │
  │            │               │           │             │  read evt │
  │            │               │           │             │◀──────────│
  │            │               │           │─────settle──────────────│
  │            │               │           │             │           │
  │            │◀───────── transfer USDC ──┴─────────────┘           │
```

---

## 5. MVP Decisions

Resolved tradeoffs for the hackathon. Each one has a matching `TODO(post-MVP)` in the code.

| Decision | MVP choice | Post-MVP upgrade path |
|---|---|---|
| Oracle trust | `settle` / `reclaim_remaining` are callable by the `event.utility` **or** a single hardcoded `ORACLE` address, so the hosted daemon (one key) can close out events created by any wallet — a judge's zkLogin event included. Neither can name an arbitrary `saved_units`: the reading must carry the event charger's ed25519 signature (E_BAD_SIGNATURE); reclaim always pays back to `event.utility` | M-of-N / multisig settlement so no single submitter key can settle a lie (TRUST.md §5.2); stake-and-slash (§5.3); replace the hardcoded `ORACLE` with oracle-signature verification |
| Session authenticity (charger signature) | **Done — TRUST.md §5.1.** `create_event` registers a 32-byte authorised `charger_pubkey`; `settle` verifies an ed25519 signature over `event_id ‖ meter_id ‖ responder ‖ saved_units` with `sui::ed25519::ed25519_verify` before paying. The oracle holds the charger key server-side and signs the (simulated) OCPP session | Authorise a *set* of charger keys per event; bind a meter to its charger (§3.1); TEE-attested signing (§5.4) |
| Reward allocation | First-come-first-served, capped by `remaining_units` | Pro-rata split, or auction-style bidding |
| Meter hardware ID | Free-form `label: String`, no on-chain verification | Hardware-signed serials, TEE attestation, Seal-bound identity |
| Vault topology | One `RewardVault` per `DREvent` (1:1) | Shared pool across events |
| Reward denomination | **Done — generic `Coin<T>`, settled in Circle USDC** (testnet for the demo). Stable per-kWh price; the package depends on no coin package, since the coin is a type argument | Multi-stablecoin support / per-event choice of reward coin |
| Reward aggregates (per-meter totals, response counts) | Not stored on-chain; derived in the frontend via `suix_queryEvents` filtered on `Settled` events | Off-chain indexer / Subgraph if RPC pagination becomes the bottleneck |
| Double-response dedup | On-chain: a dynamic field keyed by `event_id` on the Owned `SmartMeter` (E_ALREADY_RESPONDED). Lives on the meter, not the shared `DREvent`, so it adds no shared-lock contention | Move the set off-chain only if meter storage cost ever matters; otherwise on-chain is the source of truth |
| Double-settle dedup | On-chain: a dynamic field keyed by `meter_id` on the Shared `RewardVault` (E_ALREADY_SETTLED). `settle` already mutates the vault, so the marker adds no extra contention. Off-chain the oracle also skips already-settled pairs | Fold into a richer settlement record if per-payout metadata is ever needed |
| Unspent vault funds | `reclaim_remaining<T>` returns the leftover to the utility once `now > end_time` (admin-only, same trust as `settle`) | Settlement-finality / grace window before reclaim (see §3.5 TODO) |
| Reclaim trigger | The hosted daemon auto-closes each event on the first poll tick after its window ends — atomic settle-all + `reclaim_remaining` in one PTB (`oracle/src/closer.ts` `closeAllEnded`). Immediate, no grace window; idempotent via `remaining_units == 0` or a `Reclaimed` event. `pnpm close` + the frontend button remain for manual use | Settlement-finality / grace window before auto-reclaim for late real-CPO CDRs (see §3.5 TODO and the `TODO(post-MVP)` in `closer.ts`) |

---

## 6. Open Questions

- [x] Can a user `respond` multiple times to the same event? **Resolved: no — enforced on-chain** via a per-`event_id` dynamic field on the Owned `SmartMeter` (E_ALREADY_RESPONDED). On-chain is the single source of truth; the frontend only disables the button for UX.
- [x] Provide a PTB example bundling `create_event` + fund vault + share into one transaction? **Resolved: yes** — the frontend `create_event` flow is a single PTB (split gas coin → `create_event`), demonstrating Sui transaction composability.
- [x] Frontend page count: **Resolved: keep all 4** (Dashboard + Event List + Create + Detail). Dashboard ships in a reduced form (user-view summary) rather than being dropped, to preserve the user perspective in the demo.

---

## 7. Out of MVP Scope

- Seal-encrypted consumption data
- Full oracle network (single simulated server for MVP)
- Cross-event reputation system
- Marketing landing page

---

## 8. Off-chain oracle

`settle` takes `saved_units` as an input (see §1.1 and §3.4). The `oracle/` package produces that number and submits the transaction. It is a small TypeScript program that runs against the deployed package. It is not a network, and for the MVP it is trusted: it holds the utility's key (§5, oracle trust row).

### 8.1 Settlement flow

1. **Read pledges.** Scan `MeterResponded` for the event to get the `(responder, meter_id)` pairs that committed on-chain.
2. **Read session evidence.** Load each driver's charging session. For the MVP these come from an editable feed (`oracle/sessions.input.json`, shaped like a CPO's OCPP/OCPI record) with a deterministic fallback; `oracle/src/settler.ts` runs the pass. Each session carries the energy delivered inside the event's called window.
3. **Sign, then settle.** For each matching pledge, the event's charger key signs the reading and `settle` verifies that ed25519 signature on-chain before paying `saved_units` (the session's kWh) — the submitter cannot fabricate the number (§3.4, TRUST.md §5.1). Pairs already in the `Settled` log are skipped, so a run is idempotent and safe to repeat.

### 8.2 Why tie payout to a session

§1.1 leaves an honest gap: where does `saved_units` come from? Reading it from a metered session makes it verifiable instead of hand-entered. EV charging is what keeps the measurement clean. A charging session is a single load over a known window, so there is no counterfactual whole-home baseline to estimate.

### 8.3 MVP boundaries

- The oracle signs `settle` as the utility because it holds that key. Post-MVP: oracle signatures or a multisig (§5).
- Session data is simulated. Post-MVP: a real OCPP 1.6 / 2.0.1 feed from a charger or a CPO API. This is the one change a mainnet pilot needs.
- The simulator writes a driver's Sui address into each session. A real CPO would resolve that from its own account-to-wallet mapping.
