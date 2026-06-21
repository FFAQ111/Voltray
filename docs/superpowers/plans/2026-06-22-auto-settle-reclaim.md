# Auto settle + reclaim on the daemon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hosted oracle daemon automatically settle all pending responders and reclaim the leftover vault balance to the utility once an event's window closes — no manual `pnpm close` step.

**Architecture:** Extract `close.ts`'s existing atomic settle-all-then-reclaim PTB into a reusable `closeEvent()` in a new `closer.ts`, plus a `closeAllEnded()` daemon sweep that finds this oracle's ended, not-yet-closed events and closes each one. The daemon loop calls `closeAllEnded()` instead of the old settle-only pass. Idempotency reuses existing signals — `remaining_units === 0` (vault drained) or a `Reclaimed` event (already returned) — so no new on-chain reads of the vault balance are needed. No contract changes.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), `tsx` runner, `@mysten/sui` SDK, Sui testnet. No test framework (the oracle is operational scripts).

## Global Constraints

- All in-repo files (docs, code comments, commit messages) in **English**.
- `moveCall` targets use `fqAt(...)` (PACKAGE_AT, the v2 published-at code); `queryEvents` filters and type arguments use `fq(...)` (PACKAGE_ID, the original type/event identity). Never swap them.
- **No new dependencies.** Every import below already exists in `oracle/src`.
- MVP-first. The one tradeoff introduced (immediate reclaim, no grace window) is recorded in `docs/ARCHITECTURE.md §5` **and** an inline `// TODO(post-MVP)` in `oracle/src/closer.ts` (the repo's two-places rule, CLAUDE.md).
- **Per-task gate:** from `oracle/`, run `pnpm typecheck` (`tsc --noEmit`). Expected: no output, exit code 0. This is the verification gate — there is no unit-test harness, and the refactor's only real risk is type/signature drift, which `tsc --noEmit` catches. Runtime behavior is verified once at the end against testnet (see Final Verification).
- Commit messages are subject-only with a `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. **Never push.**

---

### Task 1: `queryReclaimed` read helper

**Files:**
- Modify: `oracle/src/chain.ts` (add one exported function after `querySettled`, ~line 45)

**Interfaces:**
- Consumes: existing `client`, `fq` from `./config`.
- Produces: `queryReclaimed(eventId: string): Promise<{ amount: number }[]>` — the `Reclaimed` events for one event (caller checks `.length` for "already reclaimed").

- [ ] **Step 1: Add the helper to `chain.ts`**

Insert immediately after the `querySettled` function (after the line `}` closing it, ~line 45):

```typescript
// Events whose leftover has already been returned to the utility. Lets the daemon tell a
// still-open vault from one already closed out — the same idempotency role querySettled plays
// for paid pairs, and the same signal the frontend uses (web EventDetail "isReclaimed").
export async function queryReclaimed(
  eventId: string,
): Promise<{ amount: number }[]> {
  const res = await client.queryEvents({
    query: { MoveEventType: fq("Reclaimed") },
    order: "descending",
    limit: 50,
  });
  return res.data
    .map((e) => e.parsedJson as Record<string, string>)
    .filter((j) => j.event_id === eventId)
    .map((j) => ({ amount: Number(j.amount) }));
}
```

- [ ] **Step 2: Typecheck**

Run (from `oracle/`): `pnpm typecheck`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add oracle/src/chain.ts
git commit -m "feat(oracle): queryReclaimed read helper for closed-vault detection" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `closer.ts` (reusable atomic close) + rewire `close.ts`

**Files:**
- Create: `oracle/src/closer.ts`
- Modify: `oracle/src/close.ts` (replace its body with a thin CLI wrapper over `closeEvent`)

**Interfaces:**
- Consumes: `queryReclaimed` (Task 1); existing `fetchEvent`, `findVault`, `queryResponded`, `querySettled` from `./chain`; `signReading` from `./signer`; `loadSessionInput` from `./settler`; `USDC_TYPE`, `client`, `fq`, `fqAt` from `./config`.
- Produces:
  - `closeEvent(oracle: Ed25519Keypair, charger: Ed25519Keypair, eventId: string): Promise<{ settled: number; digest: string }>`
  - `closeAllEnded(oracle: Ed25519Keypair, charger: Ed25519Keypair): Promise<{ closed: number; settled: number }>`

- [ ] **Step 1: Create `oracle/src/closer.ts`**

```typescript
// Reusable "close out an event" logic, shared by the CLI (close.ts) and the hosted daemon
// (daemon.ts). closeEvent atomically settles every still-pending responder and reclaims the
// leftover in ONE programmable transaction (PTB); closeAllEnded runs it over every ended event
// this oracle owns that still needs closing. The contract stores no participant list, so the
// settle-before-reclaim ordering can only be enforced here, off-chain, by bundling the calls —
// the PTB makes it atomic, so reclaim can never race ahead of a pledged-but-unsettled payout
// (docs/TRUST.md §3.3, ARCHITECTURE §3.5).
import { Transaction } from "@mysten/sui/transactions";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { USDC_TYPE, client, fq, fqAt } from "./config";
import {
  fetchEvent,
  findVault,
  queryReclaimed,
  queryResponded,
  querySettled,
} from "./chain";
import { signReading } from "./signer";
import { loadSessionInput } from "./settler";

// The shared Clock object has a fixed, well-known id on every Sui network.
const CLOCK_ID = "0x6";

// Settle all still-pending responders for one ended event, then reclaim the leftover to the
// utility — bundled in a single PTB. Aborts if the window has not closed (reclaim_remaining is
// gated on it, and an abort would revert the whole PTB), so callers must only pass ended events.
export async function closeEvent(
  oracle: Ed25519Keypair,
  charger: Ed25519Keypair,
  eventId: string,
): Promise<{ settled: number; digest: string }> {
  const [ev, vaultId] = await Promise.all([fetchEvent(eventId), findVault(eventId)]);
  // reclaim_remaining aborts inside the window (E_EVENT_NOT_ENDED), which would revert the
  // whole PTB — fail fast with a clear message instead.
  if (ev.endTime >= Date.now())
    throw new Error(
      `Event window has not closed yet (ends ${new Date(ev.endTime).toISOString()}). ` +
        `Close after the window so reclaim is allowed.`,
    );

  const responders = await queryResponded(eventId);
  const paid = new Set(
    (await querySettled(eventId)).map((s) => `${s.responder}:${s.meterId}`),
  );
  const pending = responders.filter((r) => !paid.has(`${r.responder}:${r.meterId}`));
  const input = loadSessionInput();

  const tx = new Transaction();
  for (let i = 0; i < pending.length; i++) {
    const r = pending[i];
    const savedUnits = Math.floor(input[i]?.energyKwh ?? 12 + ((i * 7) % 19));
    const signature = await signReading(charger, {
      eventId,
      meterId: r.meterId,
      responder: r.responder,
      savedUnits,
    });
    tx.moveCall({
      target: fqAt("settle"),
      typeArguments: [USDC_TYPE],
      arguments: [
        tx.object(eventId),
        tx.object(vaultId),
        tx.pure.address(r.responder),
        tx.pure.id(r.meterId),
        tx.pure.u64(savedUnits),
        tx.pure.vector("u8", Array.from(signature)),
      ],
    });
  }
  // Reclaim last, so it only takes what is left after the settles above are applied.
  tx.moveCall({
    target: fqAt("reclaim_remaining"),
    typeArguments: [USDC_TYPE],
    arguments: [tx.object(eventId), tx.object(vaultId), tx.object(CLOCK_ID)],
  });

  const res = await client.signAndExecuteTransaction({
    signer: oracle,
    transaction: tx,
    options: { showEffects: true },
  });
  return { settled: pending.length, digest: res.digest };
}

// The daemon close pass: find this oracle's events whose window has closed and that still need
// closing, and run closeEvent for each. Idempotent — an ended event is skipped once its vault is
// drained (remaining_units === 0, the same signal settler.ts uses) or its leftover has already
// been returned (a Reclaimed event exists). Returns how many events were closed and how many
// responders were settled across them.
//
// TODO(post-MVP): reclaim fires on the first tick after the window closes (no grace/finality
// window). Safe for the MVP because a closed window freezes the pledge set, but a real OCPI CDR
// feed that can arrive late would want a grace delay before reclaim — see reclaim_remaining in
// contracts/sources/voltray.move and docs/ARCHITECTURE.md §5.
export async function closeAllEnded(
  oracle: Ed25519Keypair,
  charger: Ed25519Keypair,
): Promise<{ closed: number; settled: number }> {
  const oracleAddr = oracle.getPublicKey().toSuiAddress();
  const res = await client.queryEvents({
    query: { MoveEventType: fq("EventCreated") },
    order: "descending",
    limit: 10,
  });
  let closed = 0;
  let settled = 0;
  for (const e of res.data) {
    const j = e.parsedJson as Record<string, string>;
    if (j.utility !== oracleAddr) continue;
    const eventId = j.event_id;
    // One bad event (e.g. a transient RPC error) must not block the rest of the sweep.
    try {
      const ev = await fetchEvent(eventId);
      if (ev.endTime >= Date.now()) continue; // window still open
      if (ev.remainingUnits === 0) continue; // vault drained: nothing to pay or reclaim
      if ((await queryReclaimed(eventId)).length > 0) continue; // leftover already returned
      const r = await closeEvent(oracle, charger, eventId);
      closed += 1;
      settled += r.settled;
      console.log(
        `  closed event ${eventId.slice(0, 12)}…  settled ${r.settled} + reclaimed  ->  tx ${r.digest}`,
      );
    } catch (err) {
      console.error(
        `  event ${eventId.slice(0, 12)}… close failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  return { closed, settled };
}
```

- [ ] **Step 2: Replace `oracle/src/close.ts` with a thin CLI wrapper**

Replace the **entire** contents of `oracle/src/close.ts` with:

```typescript
// Atomically close out one ended event: settle every still-pending responder and reclaim the
// leftover to the utility, in a single PTB (see closeEvent in closer.ts and docs/TRUST.md §3.3).
//
// Usage: pnpm close <eventId>   (only after the event window has closed)
import "dotenv/config";
import { chargerKeypair, oracleKeypair } from "./config";
import { closeEvent } from "./closer";

async function main() {
  const eventId = process.argv[2];
  if (!eventId) throw new Error("usage: pnpm close <eventId>");

  const { settled, digest } = await closeEvent(
    oracleKeypair(),
    chargerKeypair(),
    eventId,
  );
  console.log(
    `Closed event ${eventId.slice(0, 12)}… — settled ${settled} pending + reclaimed leftover in one PTB -> tx ${digest}`,
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck**

Run (from `oracle/`): `pnpm typecheck`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add oracle/src/closer.ts oracle/src/close.ts
git commit -m "feat(oracle): closer.ts reusable atomic settle+reclaim; close.ts uses it" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: daemon auto-closes ended events + remove orphaned `onlyEnded`

**Files:**
- Modify: `oracle/src/daemon.ts` (header comment line 1, import line 5, startup log line 18, the loop body lines 22–29)
- Modify: `oracle/src/settler.ts` (remove the `onlyEnded` option from `settleAllPending`: signature ~lines 70–74, guard ~lines 92–95)

**Interfaces:**
- Consumes: `closeAllEnded` (Task 2).
- Produces: nothing new. `settleAllPending(oracle, charger): Promise<number>` loses its third `opts` argument; `run.ts` already calls it with two args, so it is unaffected.

- [ ] **Step 1: Point the daemon at `closeAllEnded`**

In `oracle/src/daemon.ts`, change the header comment (line 1):

```typescript
// Hosted auto-settlement worker: the settle pass from settler.ts on a poll loop.
```
to:
```typescript
// Hosted auto-close worker: closes ended events (settle pending + reclaim leftover) on a poll loop.
```

Change the import (line 5):

```typescript
import { settleAllPending } from "./settler";
```
to:
```typescript
import { closeAllEnded } from "./closer";
```

Change the startup log line (line 18):

```typescript
  console.log(`  settles  events after their window closes\n`);
```
to:
```typescript
  console.log(`  closes   events after their window: settle pending + reclaim leftover\n`);
```

Replace the `try { ... }` block inside the loop (lines 22–29):

```typescript
    try {
      // Only settle events whose window has closed (real reduction is known only then, and it
      // avoids per-tick gas on active events). `pnpm settle` can still force a settle for demos.
      const settled = await settleAllPending(oracle, charger, { onlyEnded: true });
      if (settled > 0) console.log(`tick: settled ${settled} response(s)`);
    } catch (e) {
      console.error(`tick failed: ${e instanceof Error ? e.message : e}`);
    }
```
with:
```typescript
    try {
      // Close every event whose window has closed: settle all still-pending responders and
      // reclaim the leftover to the utility, atomically per event. Reclaim is gated on the
      // window being over, so active events are read-only and cost no gas. `pnpm settle` can
      // still force a mid-window settle for demos.
      const { closed, settled } = await closeAllEnded(oracle, charger);
      if (closed > 0)
        console.log(`tick: closed ${closed} event(s), settled ${settled} response(s)`);
    } catch (e) {
      console.error(`tick failed: ${e instanceof Error ? e.message : e}`);
    }
```

- [ ] **Step 2: Remove the now-orphaned `onlyEnded` option from `settler.ts`**

In `oracle/src/settler.ts`, change the `settleAllPending` signature (lines 70–74):

```typescript
export async function settleAllPending(
  oracle: Ed25519Keypair,
  charger: Ed25519Keypair,
  opts: { onlyEnded?: boolean } = {},
): Promise<number> {
```
to:
```typescript
export async function settleAllPending(
  oracle: Ed25519Keypair,
  charger: Ed25519Keypair,
): Promise<number> {
```

Then delete the `onlyEnded` guard (lines 92–95) — these four lines:

```typescript
      // Production policy: only settle once the event window has closed — the real reduction
      // is only known after the window, and it avoids paying (and spending gas) mid-event. The
      // one-shot CLI (`pnpm settle`) leaves this off so a demo can force settlement early.
      if (opts.onlyEnded && ev.endTime > Date.now()) continue;
```

Leave the `remaining_units === 0` skip just above it (`if (ev.remainingUnits === 0) continue;`) and every use of `ev` below intact.

- [ ] **Step 3: Typecheck**

Run (from `oracle/`): `pnpm typecheck`
Expected: no output, exit code 0. (Confirms `run.ts`'s two-arg `settleAllPending` call still satisfies the trimmed signature, and `daemon.ts` no longer references `settleAllPending`.)

- [ ] **Step 4: Commit**

```bash
git add oracle/src/daemon.ts oracle/src/settler.ts
git commit -m "feat(oracle): daemon auto-closes ended events (settle + reclaim)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Documentation

**Files:**
- Modify: `oracle/README.md` (Run section ~line 41; the `pnpm close` paragraph ~lines 49–53; the Files table ~lines 71–73)
- Modify: `docs/ARCHITECTURE.md` (§5 MVP Decisions table — add one row after the "Unspent vault funds" row, ~line 249)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `oracle/README.md` Run section**

Change the `pnpm daemon` line (~line 41):

```
pnpm daemon                 # poll loop: settle pending after each event's window closes (Fly.io)
```
to:
```
pnpm daemon                 # poll loop: auto-close (settle + reclaim) each event after its window closes (Fly.io)
```

- [ ] **Step 2: Update the `pnpm close` paragraph in `oracle/README.md`**

Replace this paragraph (~lines 49–53):

```
`pnpm close` bundles, in a **single PTB**, a `settle` for every still-pending responder followed
by `reclaim_remaining`, so the leftover can never be reclaimed ahead of a pledged-but-unsettled
payout. Run it once the window has closed; it returns the unspent USDC to the utility. The daemon
settles but does **not** reclaim — returning leftover funds is a manual step (`pnpm close` or the
frontend Reclaim button).
```
with:

```
`pnpm close` bundles, in a **single PTB**, a `settle` for every still-pending responder followed
by `reclaim_remaining`, so the leftover can never be reclaimed ahead of a pledged-but-unsettled
payout. The hosted **daemon now runs this same atomic close automatically** once a window ends —
settling any stragglers and returning the unspent USDC to the utility on the first poll tick. It
is idempotent: an ended event is skipped once its vault is drained or a `Reclaimed` event exists.
`pnpm close <eventId>` and the frontend Reclaim button remain for manual/one-off use.
```

- [ ] **Step 3: Update the Files table in `oracle/README.md`**

Replace the `src/daemon.ts` and `src/close.ts` rows (~lines 71–72):

```
| `src/daemon.ts` | Poll loop (`pnpm daemon`, deployed on Fly.io) |
| `src/close.ts` | Atomic settle-all + reclaim in one PTB (`pnpm close <eventId>`) |
```
with:

```
| `src/closer.ts` | Atomic settle-all + reclaim in one PTB: `closeEvent` (one event) + `closeAllEnded` (daemon sweep of ended events) |
| `src/daemon.ts` | Poll loop: auto-close ended events (`pnpm daemon`, deployed on Fly.io) |
| `src/close.ts` | CLI wrapper over `closeEvent` (`pnpm close <eventId>`) |
```

- [ ] **Step 4: Add the MVP-decision row in `docs/ARCHITECTURE.md`**

In the §5 table, insert this row immediately **after** the existing "Unspent vault funds" row (~line 249):

```
| Reclaim trigger | The hosted daemon auto-closes each event on the first poll tick after its window ends — atomic settle-all + `reclaim_remaining` in one PTB (`oracle/src/closer.ts` `closeAllEnded`). Immediate, no grace window; idempotent via `remaining_units == 0` or a `Reclaimed` event. `pnpm close` + the frontend button remain for manual use | Settlement-finality / grace window before auto-reclaim for late real-CPO CDRs (see §3.5 TODO and the `TODO(post-MVP)` in `closer.ts`) |
```

- [ ] **Step 5: Commit**

```bash
git add oracle/README.md docs/ARCHITECTURE.md
git commit -m "docs(oracle): record daemon auto-reclaim (README + ARCHITECTURE §5)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final Verification (testnet, manual)

The per-task `pnpm typecheck` gates prove the code compiles and signatures line up. This holistic
check proves the runtime behavior. Requires `oracle/.env` populated (utility `ORACLE_SECRET_KEY` +
demo `CHARGER_SECRET_KEY`) per `oracle/README.md`.

- [ ] **Step 1:** In the web app, create a DR event with a **short window** (e.g. ends in ~2–3 min) and respond to it from a registered meter so there is at least one pending pledge.
- [ ] **Step 2:** Start the daemon from `oracle/`: `pnpm daemon`. Confirm the startup banner now reads `closes ... settle pending + reclaim leftover`.
- [ ] **Step 3:** Wait for the window to close. Within one poll interval (≤30s) the daemon should log: `tick: closed 1 event(s), settled N response(s)` and a per-event `closed event …  settled N + reclaimed  -> tx <digest>`.
- [ ] **Step 4:** Confirm on-chain (Sui explorer for the digest, or the app): the responder(s) were paid, the vault balance is now 0, and a `Reclaimed` event was emitted to the utility.
- [ ] **Step 5:** In the web app's Event Detail, confirm the Reclaim card shows **"Funds reclaimed"** (the daemon beat the manual button — expected).
- [ ] **Step 6:** Leave the daemon running for another poll interval and confirm it does **not** re-close the same event (no new `closed event …` line, no wasted gas) — idempotency holds.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-22-auto-settle-reclaim-design.md`):
- `queryReclaimed` → Task 1. ✓
- `closer.ts` (`closeEvent` + `closeAllEnded`) → Task 2. ✓
- `close.ts` thin wrapper → Task 2 Step 2. ✓
- `daemon.ts` → `closeAllEnded` → Task 3 Step 1. ✓
- `settler.ts` remove `onlyEnded` → Task 3 Step 2. ✓
- Docs (README + ARCHITECTURE §5 + inline TODO) → Task 4 + the `TODO(post-MVP)` in Task 2's `closer.ts`. ✓
- Idempotency (`remaining_units === 0` / `Reclaimed`) → Task 2 `closeAllEnded`. ✓
- Success criteria (typecheck + testnet end-to-end) → per-task gate + Final Verification. ✓

**Placeholder scan:** No TBD/TODO-as-placeholder. The two `TODO(post-MVP)` strings are intentional code/doc content per the repo convention, not plan gaps. All code steps show complete code; all command steps show exact commands + expected output.

**Type consistency:** `queryReclaimed` returns `{ amount: number }[]` (Task 1) and is consumed only via `.length` (Task 2) — consistent. `closeEvent` returns `{ settled, digest }`, used by both `close.ts` (destructures `settled`, `digest`) and `closeAllEnded` (uses `r.settled`, `r.digest`) — consistent. `closeAllEnded` returns `{ closed, settled }`, destructured identically in `daemon.ts` — consistent. `settleAllPending` drops its third arg; the only remaining caller (`run.ts`) passes two args — consistent.
