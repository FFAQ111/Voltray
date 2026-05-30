# SuiWatt Oracle

Off-chain settlement oracle for SuiWatt. It replaces the manual "settle" button in the
frontend: instead of a human typing how many kWh a driver shifted, the oracle reads
charging-session evidence and settles each eligible driver on-chain automatically.

## Why this exists

`settle()` on-chain pays `saved_units * reward_per_unit` from the vault to a driver. The
honest question is _where does `saved_units` come from?_ For EV charging the answer is
clean: a single metered charging session inside the off-peak window — not a fuzzy
whole-home baseline. The oracle:

1. scans `MeterResponded` events — who **pledged** on-chain;
2. reads OCPP charging **sessions** — who actually **charged off-peak**;
3. calls `settle()` only for drivers in **both** sets.

For the MVP the sessions come from a simulator (`src/simulator.ts`) standing in for a
Charge Point Operator's OCPP backend. Swapping in a real charger/CPO feed is the only
change needed for the mainnet pilot.

## Setup

```bash
cd oracle
pnpm install
cp .env.example .env        # then paste the utility's suiprivkey1... key
```

`settle()` is restricted to the event's utility address, so `ORACLE_SECRET_KEY` must be
that address's key. Export it with `sui keytool export --key-identity <utility-address>`.

## Run (against a testnet event)

```bash
pnpm simulate <eventId>     # writes oracle/sessions.json from the on-chain pledge set
pnpm settle   <eventId>     # verifies sessions and settles eligible drivers on-chain
```

`pnpm settle` is idempotent — already-settled drivers are skipped, so it is safe to re-run.

## Files

| File | Role |
|---|---|
| `src/config.ts` | Package ID, Sui client, oracle keypair |
| `src/chain.ts` | Event-log reads: pledges, settled set, event window, vault lookup |
| `src/simulator.ts` | OCPP session generator (CPO backend stand-in) |
| `src/oracle.ts` | Join pledges + sessions, verify, call `settle()` |
