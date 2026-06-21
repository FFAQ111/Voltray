# Voltray Oracle

Off-chain settlement oracle for Voltray. It replaces the manual "settle" button in the
frontend: instead of a human typing how many kWh a driver shifted, the oracle reads
charging-session evidence and settles each eligible driver on-chain automatically.

## Why this exists

`settle()` on-chain pays `saved_units * reward_per_unit` in USDC from the vault to a
driver. The honest question is _where does `saved_units` come from?_ For EV charging the
answer is clean: a single metered charging session inside the event's called window — not a
fuzzy whole-home baseline. The oracle:

1. scans `MeterResponded` events — who **pledged** on-chain;
2. reads charging **sessions** for those drivers — the energy each one shifted;
3. has the event's **charger key sign** each reading and calls `settle()`, which verifies
   that ed25519 signature on-chain before paying — so the operator cannot fabricate the
   number (TRUST.md §5.1).

For the MVP the sessions come from an editable feed (`sessions.input.json`, shaped like a
CPO's OCPP/OCPI record) with a deterministic fallback; `src/settler.ts` runs the loop.
Swapping in a real charger/CPO feed is the only change a mainnet pilot needs — see
[../docs/TRUST.md §6.5](../docs/TRUST.md) for the integration tiers.

## Setup

```bash
cd oracle
pnpm install
cp .env.example .env        # then paste the utility's suiprivkey1... key
```

`settle()` is restricted to the event's utility address, so `ORACLE_SECRET_KEY` must be
that address's key. Export it with `sui keytool export --key-identity <utility-address>`.

## Run

```bash
pnpm settle                 # one-shot: settle every pending response now, then exit
pnpm daemon                 # poll loop: auto-close (settle + reclaim) each event after its window closes (Fly.io)
pnpm close <eventId>        # close out one ended event: settle all pending + reclaim, atomically
```

Both `settle` and `daemon` are idempotent and safe to re-run: already-settled `(event, meter)`
pairs are skipped off-chain and rejected on-chain (`E_ALREADY_SETTLED`). The daemon only sends a
transaction when something is pending — idle ticks are read-only and cost no gas. Deployment and
the `POLL_INTERVAL_MS` / `PACKAGE_ID` env overrides are in [../docs/DEPLOY.md](../docs/DEPLOY.md).

`pnpm close` bundles, in a **single PTB**, a `settle` for every still-pending responder followed
by `reclaim_remaining`, so the leftover can never be reclaimed ahead of a pledged-but-unsettled
payout. The hosted **daemon now runs this same atomic close automatically** once a window ends —
settling any stragglers and returning the unspent USDC to the utility on the first poll tick. It
is idempotent: an ended event is skipped once its vault is drained or a `Reclaimed` event exists.
`pnpm close <eventId>` and the frontend Reclaim button remain for manual/one-off use.

To target a specific event with the older two-step form:

```bash
pnpm simulate <eventId>     # writes oracle/sessions.json from the on-chain pledge set
pnpm settle:event <eventId> # verifies sessions and settles eligible drivers on-chain
```

## Files

| File | Role |
|---|---|
| `src/config.ts` | Package addresses (`PACKAGE_ID` for queries, `PACKAGE_AT` for v2 move calls), Sui client, oracle + charger keypairs |
| `src/chain.ts` | Event-log reads: pledges, settled set, event window, vault lookup |
| `src/signer.ts` | Charger ed25519 signature over the reading (TRUST.md §5.1) |
| `src/settler.ts` | Core settle pass: find pending, read the feed, sign, call `settle()` |
| `src/run.ts` | One-shot wrapper (`pnpm settle`) |
| `src/closer.ts` | Atomic settle-all + reclaim in one PTB: `closeEvent` (one event) + `closeAllEnded` (daemon sweep of ended events) |
| `src/daemon.ts` | Poll loop: auto-close ended events (`pnpm daemon`, deployed on Fly.io) |
| `src/close.ts` | CLI wrapper over `closeEvent` (`pnpm close <eventId>`) |
| `src/simulator.ts` / `src/oracle.ts` | Older per-event two-step path (`pnpm simulate` / `settle:event`) |
