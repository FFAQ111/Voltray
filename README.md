# Voltray

When the grid is about to peak, paying people to use less power is cheaper than firing up another plant. That payment is called Demand Response, and grid operators already spend billions on it each year. Today it runs through aggregators with slow, opaque payouts.

Voltray turns that payment into code. A utility funds a reward pool, a participant responds, and the reward settles on-chain the moment a verified meter reading proves the reduction. There is no aggregator deciding who gets paid and no invoice cycle to wait through. The settlement rule is the contract itself.

We start with EV charging. An electric car is a large, flexible load: when the grid operator calls a Demand Response event, a driver can hold the charge until the event window passes — or shift it outside — without really noticing, and that avoided load is worth real money to the operator. This is event-driven and paid at a premium, which is what makes it different from a standing peak/off-peak tariff: the tariff nudges routine load on a fixed schedule, a DR event pays you to respond to an acute, real-time shortage. EV charging also keeps the measurement honest: one metered session over a known window is far easier to verify than estimating what a whole house would otherwise have used, which is where Demand Response usually loses people's trust.

One EV holding its charge is noise to the grid. Ten thousand of them, called together, are a power plant the operator never had to build — this is what a virtual power plant (VPP) is, and aggregators exist precisely to bundle many small, flexible loads into one dispatchable block. The hard part of aggregation has never been the load; it is paying thousands of strangers fairly, provably, and without an invoice cycle. That is the part Voltray replaces. A transparent settlement rule that anyone can audit and that pays the moment evidence arrives is exactly what makes aggregating participants who don't trust each other — or the operator — economical at scale.

Voltray is the *settlement layer*, not a meter. It consumes a signed energy reading and turns a verified reduction into an on-chain payout; the contract checks the signature before it pays. Where that reading comes from — a charge point operator's billing record, or a meter that signs its own readings in hardware — is a standard integration (see [docs/TRUST.md](docs/TRUST.md)), not something we have to build to prove the rail works.

Why Sui: the reward is a real on-chain payment, released against verifiable evidence and sent to many small participants who never have to trust the operator. One PTB funds the vault and pays out in a single atomic step, and the rule that decides who gets paid lives in Move rather than a billing department.

Built for Sui Overflow 2026, DeFi & Payments track.

## How it works

There are three roles:

- **Utility** posts a DR event and pre-funds the reward pool.
- **User** registers a smart meter, responds to an event, and gets paid.
- **Oracle** reports how much each user actually saved and triggers settlement.

The flow:

```
Utility  ──create_event───▶  DREvent + RewardVault  (shared, pre-funded)
User     ──register_meter─▶  SmartMeter             (owned by the user)
User     ──respond────────▶  emits MeterResponded
Oracle   ──settle─────────▶  scans the event log, pays out from the vault
```

One design choice is worth calling out. The shared `DREvent` never keeps a growing list of participants. Each `respond` call just emits an event, and the oracle reads the log at settlement time. Writing accumulating state into a shared object would route every response through consensus and raise the gas cost on each call. There is more on this in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Reward model

A unit is one kWh saved below the user's baseline. The utility sets a price per unit and a target reduction for the whole event. The vault is funded up front to cover the worst case (price times target), so the contract never owes more than it holds. Settlement is first come, first served until the pool runs out.

Rewards are paid in USDC (Circle's testnet USDC), so a fixed price per kWh stays a stable incentive. The contract is generic over the coin type (`Coin<T>`), so the reward asset is just a type argument — swapping it needs no contract change.

## Oracle

`settle` pays each user for the kWh they saved, so something has to produce that number and send the transaction. The `oracle/` package does it, and it runs against the deployed contract.

It works in three steps:

1. Read the `MeterResponded` log to find who pledged to an event.
2. Read each meter's charging session. For the MVP these come from an editable feed (`oracle/sessions.input.json`) shaped like a charge point operator's OCPP/OCPI record; [docs/TRUST.md §6](docs/TRUST.md) covers how real signed data plugs in.
3. Submit `settle` for every user who pledged and whose session shows a reduction inside the event's called window.

The payout number is never typed in by hand: the charger signs the reading (ed25519) and the contract verifies that signature on-chain against the event's authorised key before paying, so the operator cannot settle an arbitrary number ([TRUST.md §5.1](docs/TRUST.md)). A polling daemon (`oracle/src/daemon.ts`, deployed on Fly.io) runs this loop automatically — respond in the app and the USDC payout lands within a poll tick, no keyboard required.

Run it against a testnet event:

```bash
cd oracle
pnpm install
cp .env.example .env        # paste the utility and charger keys
pnpm settle                 # one-shot: settle every pending response now
pnpm daemon                 # or run the auto-settlement loop (this is what Fly.io runs)
```

## Contract

Four entry functions (`create_event`, `register_meter`, `respond`, `settle`) over three objects (`SmartMeter`, `DREvent`, `RewardVault`). The whole package is under 200 lines, on purpose.

Deployed to Sui Testnet:

- Package ID: `0x4e211bfc5f344f541a235372cd9e22ef8a2947b5bfb4020a19858fbaaa25e964`
- Explorer: https://suiscan.xyz/testnet/object/0x4e211bfc5f344f541a235372cd9e22ef8a2947b5bfb4020a19858fbaaa25e964

## Stack

- Contracts: Sui Move
- Frontend: React + TypeScript + Vite, @mysten/dapp-kit, Tailwind + shadcn/ui
- Wallet: Slush
- Network: Sui Testnet

## Running locally

```bash
git clone https://github.com/FFAQ111/Voltray
cd Voltray

# Contracts
cd contracts
sui move build
sui move test

# Frontend (in a separate shell, from the repo root)
cd web
pnpm install
pnpm dev
```

The frontend reads the deployed Package ID from `web/src/lib/config.ts`. If you publish your own copy of the contract, update the constant there (and the mirror in `oracle/src/config.ts`).

## Demo

Watch the demo: https://youtu.be/KE_Q6yOQJ_A

## Status

In progress for Sui Overflow 2026 (May 7 to June 21), DeFi & Payments track.
