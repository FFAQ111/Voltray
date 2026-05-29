# SuiWatt Architecture

> On-chain design for a decentralized energy Demand Response (DR) system.
> This document is a working skeleton — the source of truth is `contracts/`.

---

## 1. Overview

SuiWatt moves the traditional DR flow — "the utility pays users to reduce consumption" — onto Sui as a conditional, auto-settled payment.

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

SuiWatt is a **pay-per-reduction bounty with a capped pool** — the same shape as a real-world DR capacity payment.

- **1 unit = 1 kWh of consumption reduced below the user's baseline.** This is the physical meaning of a "unit" everywhere in the contract.
- **`reward_per_unit`** — the price (in MIST) the utility offers per kWh saved.
- **`target_reduction`** — the total kWh the utility wants shaved across *all* participants in this event.
- **Vault = `reward_per_unit × target_reduction`** — pre-funded to cover the worst case (everyone hits target), so the contract never promises money it cannot pay. Settlement draws down `remaining_units` first-come-first-served until the pool is exhausted.

**Why pay in SUI for MVP (and the volatility caveat).** Rewards are denominated in native SUI/MIST because it needs zero extra setup to demo. The honest weakness: SUI's price floats, so a fixed `reward_per_unit` is an unstable real-world incentive. The clean fix is to denominate rewards in a stablecoin (USDC on Sui) — see §5. That is a post-MVP change, not a demo blocker.

**Reward sizing is the oracle's input, not an on-chain model.** `saved_units` is supplied at `settle` time by the trusted utility/oracle. A production system would derive it from a baseline-vs-actual measurement & verification (M&V) pipeline; that pipeline is explicitly out of MVP scope (§7).

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
struct RewardVault has key {
    id: UID,
    event_id: ID,        // links to the DREvent
    balance: Balance<SUI>,
    // TODO: settled flag, remaining caps, ...
}
```

**Why Shared:** Multiple `settle()` calls need to withdraw from it.

---

## 3. Function Signatures & Flow

### 3.1 `create_event`

```move
public fun create_event(
    reward_coin: Coin<SUI>,
    reward_per_unit: u64,
    target_reduction: u64,
    start_time: u64,
    end_time: u64,
    ctx: &mut TxContext,
)
```

- Caller: utility
- Creates a `DREvent` and a matching `RewardVault` funded by `reward_coin`; both are shared.
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
public fun settle(
    event: &mut DREvent,
    vault: &mut RewardVault,
    responder: address,
    meter_id: ID,         // for audit only; emitted into Settled event, not validated on-chain
    saved_units: u64,
    // MVP: admin-only — assert ctx.sender == event.utility
    // TODO(post-MVP): replace with oracle signature verification / multisig
    ctx: &mut TxContext,
)
```

- Caller: **MVP — `event.utility` only** (admin-only oracle). Asserts `ctx.sender() == event.utility` (E_NOT_UTILITY).
- **Vault/event binding check (required):** `assert!(vault.event_id == object::id(event), E_WRONG_VAULT)` — without this, the utility could drain any vault by passing a mismatched pair.
- Allocation: **first-come-first-served**. Pays `min(saved_units, event.remaining_units) × reward_per_unit` from `vault`, then decrements `event.remaining_units`. Late responders may get partial or nothing.
- `meter_id` is passed in by the oracle (read from the `MeterResponded` event log) purely so it can be re-emitted in `Settled` for downstream audit / Dashboard joins. The contract does **not** look up the meter object — `settle` cannot touch the user's Owned `SmartMeter`.
- Emits: `Settled { event_id, meter_id, responder, amount, units_paid }`
- **TODO(post-MVP):** Verified oracle signatures, possibly Seal-encrypted consumption reports.

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
  │            │◀───────── transfer SUI ───┴─────────────┘           │
```

---

## 5. MVP Decisions

Resolved tradeoffs for the hackathon. Each one has a matching `TODO(post-MVP)` in the code.

| Decision | MVP choice | Post-MVP upgrade path |
|---|---|---|
| Oracle trust | Admin-only: only `event.utility` can call `settle` | Verified oracle signatures, multisig, or TEE/Seal attestation |
| Reward allocation | First-come-first-served, capped by `remaining_units` | Pro-rata split, or auction-style bidding |
| Meter hardware ID | Free-form `label: String`, no on-chain verification | Hardware-signed serials, TEE attestation, Seal-bound identity |
| Vault topology | One `RewardVault` per `DREvent` (1:1) | Shared pool across events |
| Reward denomination | Native SUI (`Balance<SUI>`) — zero setup to demo, but price-volatile | Generic `Coin<T>` / USDC-pegged rewards so the per-kWh price is stable (see §1.1) |
| Reward aggregates (per-meter totals, response counts) | Not stored on-chain; derived in the frontend via `suix_queryEvents` filtered on `Settled` events | Off-chain indexer / Subgraph if RPC pagination becomes the bottleneck |
| Double-response dedup | On-chain: a dynamic field keyed by `event_id` on the Owned `SmartMeter` (E_ALREADY_RESPONDED). Lives on the meter, not the shared `DREvent`, so it adds no shared-lock contention | Move the set off-chain only if meter storage cost ever matters; otherwise on-chain is the source of truth |

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
