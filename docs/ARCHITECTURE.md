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

---

## 2. Object Schema

### 2.1 `SmartMeter` (Owned)

Represents a user's smart meter. Held by the user.

```move
struct SmartMeter has key, store {
    id: UID,
    owner: address,
    label: String,  // hardware identifier; on-chain verification deferred (see §5)
    // TODO: baseline_consumption, registered_at, ...
}
```

**Why Owned:** No consensus overhead, cheap reads/writes, single owner by nature.

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
public entry fun create_event(
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
public entry fun register_meter(
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
public entry fun respond(
    event: &DREvent,
    meter: &SmartMeter,
    ctx: &mut TxContext,
)
```

- Caller: user
- **Writes nothing to any Shared Object field.** Only emits an event.
- Emits: `MeterResponded { event_id, meter_id, responder, timestamp }`
- Checks: timestamp within `[start_time, end_time]`, `meter.owner == sender`

---

### 3.4 `settle`

```move
public entry fun settle(
    event: &mut DREvent,
    vault: &mut RewardVault,
    responder: address,
    saved_units: u64,
    // MVP: admin-only — assert ctx.sender == event.utility
    // TODO(post-MVP): replace with oracle signature verification / multisig
    ctx: &mut TxContext,
)
```

- Caller: **MVP — `event.utility` only** (admin-only oracle).
- Allocation: **first-come-first-served**. Pays `min(saved_units, event.remaining_units) × reward_per_unit` from `vault`, then decrements `event.remaining_units`. Late responders may get partial or nothing.
- Emits: `Settled { event_id, responder, amount, units_paid }`
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

---

## 6. Open Questions

- [ ] Can a user `respond` multiple times to the same event? MVP plan: off-chain dedup when the oracle scans the event log before calling `settle`.
- [ ] Provide a PTB example bundling `create_event` + fund vault + share into one transaction? (Likely low-cost, high-demo-value — revisit after contracts compile.)
- [ ] Frontend page count: MVP is Dashboard + Event List + Create + Detail (4 pages) — keep all, or drop Dashboard?

---

## 7. Out of MVP Scope

- Seal-encrypted consumption data
- Full oracle network (single simulated server for MVP)
- Cross-event reputation system
- Marketing landing page
