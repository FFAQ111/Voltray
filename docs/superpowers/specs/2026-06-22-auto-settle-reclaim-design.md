# Auto settle + reclaim on the settlement daemon

**Date:** 2026-06-22
**Status:** Design approved — pending implementation plan

## Problem / Goal

The hosted oracle daemon (`oracle/src/daemon.ts`) settles pending responders after an
event's window closes, but it never reclaims the unspent vault balance back to the utility.
Returning the leftover is a manual step today (`pnpm close <eventId>` or the frontend
Reclaim button).

**Goal:** make "window closes → leftover auto-refunded to the funder" real. Once an event's
window has ended, the daemon should automatically settle every still-pending responder **and**
return the unspent vault balance to the utility, with no manual step.

## Constraints / Decisions

- **Reclaim timing: immediate.** As soon as the daemon's next poll tick (≤ `POLL_INTERVAL_MS`,
  default 30s) observes a window has ended, it closes the event. No grace window. Safe for the
  MVP because a closed window freezes the pledge set (see Idempotency). A settlement-finality /
  grace window for real OCPI feeds is post-MVP — already a `TODO` on `reclaim_remaining`.
- **Trigger: continuous polling daemon** (the existing always-on Fly.io worker), not a
  scheduler. Read-only polls cost no gas; gas is spent only on the one close transaction after
  a window ends. The smart contract is passive and never spends gas on its own.
- **No contract changes.** `DREvent` already carries `start_time` / `end_time`; the daemon keys
  off `end_time`. Sui contracts cannot self-execute, so the off-chain daemon is the trigger.
  Adding lifetime / self-clean state to the contract is rejected: contracts cannot self-clean,
  and it violates the "DREvent stays minimal, no accumulating state" rule (CLAUDE.md).
- **Atomic settle + reclaim** reuses `close.ts`'s existing single-PTB approach (settle all
  pending, then reclaim, in one transaction) so reclaim can never race ahead of a
  pledged-but-unsettled payout (TRUST.md §3.3).

## Idempotency (the crux)

The daemon polls every tick; it must not re-submit a no-op close every 30s forever. Skip an
ended event when **either**:

- `remaining_units == 0` — vault drained, nothing to pay or reclaim (mirrors `settler.ts:91`), or
- a `Reclaimed` event already exists for it — leftover already returned (the same signal the
  frontend uses, `EventDetail.tsx:144`).

Because the frontend funds each vault at exactly `target_reduction × reward_per_unit`,
`remaining_units > 0 && !reclaimed` ⟺ "there is leftover to pull." A successful reclaim emits
`Reclaimed`, so the next tick skips. No vault-balance read is needed.

Closed window ⇒ no new `MeterResponded` (respond asserts `ts ≤ end_time`) ⇒ pledge set frozen
⇒ settle-then-reclaim in one PTB returns exactly the post-payout leftover. Coexists safely with
a manual `pnpm close` / frontend Reclaim (contract `E_ALREADY_SETTLED` dedup + reclaim's empty
no-op).

## Components / Changes

1. **`oracle/src/chain.ts`** — add `queryReclaimed(eventId)`, mirroring `querySettled` but
   filtering the `Reclaimed` event. ~10 lines.

2. **`oracle/src/closer.ts` (new)** — reusable close logic:
   - `closeEvent(oracle, charger, eventId)`: body extracted from `close.ts` — fetch event +
     vault, assert ended, compute pending (responders − settled), build PTB =
     `[settle each pending, charger-signed]` + `[reclaim_remaining]`, execute, return a summary.
   - `closeAllEnded(oracle, charger)`: the daemon close pass. Scan recent `EventCreated` owned
     by this oracle; per event: `fetchEvent`; skip if not ended (`endTime >= now`), skip if
     `remaining_units === 0`, skip if `queryReclaimed(id)` is non-empty; else
     `await closeEvent(...)`. Per-event try/catch so one bad event can't break the sweep.
     Returns `{ closed, settled }`.

3. **`oracle/src/close.ts`** — thin CLI wrapper: parse argv `eventId`, call `closeEvent`, log.

4. **`oracle/src/daemon.ts`** — replace `settleAllPending(…, { onlyEnded: true })` with
   `closeAllEnded(…)`; update startup + per-tick log text (settles → settles + reclaims).

5. **`oracle/src/settler.ts`** — remove the now-orphaned `onlyEnded` option (the daemon was its
   only caller). `settleAllPending` stays for `pnpm settle` (mid-window force-settle for demos);
   the `loadSessionInput` export is unchanged.

6. **Docs** — `oracle/README.md`'s "daemon settles but does not reclaim" paragraph →
   "daemon auto-closes (settle + reclaim) after each window closes"; `docs/ARCHITECTURE.md §5`
   gains an MVP-decision row + an inline `// TODO(post-MVP): grace/finality window before
   auto-reclaim` (cross-referencing the existing `reclaim_remaining` TODO).

## Success criteria

1. `tsc` typechecks (the oracle is scripts; there is no unit-test harness).
2. Testnet end-to-end: create an event in the app → wait for the window to close → the daemon
   logs `closed event … settled N + reclaimed` → on-chain the vault is emptied and a `Reclaimed`
   event is emitted → the frontend Reclaim card flips to "Funds reclaimed."

## Out of scope / post-MVP

- Grace / finality window before reclaim (for real OCPI CDR lag).
- Scheduler-based trigger (vs. continuous polling) to avoid the always-on machine.
- Scanning beyond the most recent ~10 events (current MVP bound shared with `pendingEvents`).
