# SuiWatt

Utilities pay people to use less electricity when the grid is under stress. The program is called Demand Response, and today it mostly runs through intermediaries with slow, manual payouts. SuiWatt puts it on Sui: a utility funds a reward pool, users respond from a registered smart meter, and payment settles on-chain once the reduction is verified.

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

Rewards are paid in SUI for now because that needs no extra setup to demo. The honest weakness is that SUI's price floats, so a fixed price per kWh is not a stable incentive in the real world. The planned fix is to denominate rewards in USDC. See [ARCHITECTURE §1.1](docs/ARCHITECTURE.md#11-economic-model).

## Oracle

`settle` pays each user for the kWh they saved, so something has to produce that number and send the transaction. The `oracle/` package does it, and it runs against the deployed contract.

It works in three steps:

1. Read the `MeterResponded` log to find who pledged to an event.
2. Read each meter's charging sessions. For the MVP these come from a simulator that stands in for a charge point operator's OCPP feed.
3. Call `settle` for every user who both pledged and actually charged off-peak, inside the event window.

The payout number is checked against session evidence instead of being typed in by hand. EV charging is what keeps that evidence clean: one metered session over a known window, rather than a guess at a whole-home baseline. For the MVP the oracle holds the utility's key and signs `settle` itself; replacing that with verified oracle signatures is the post-MVP path.

Run it against a testnet event:

```bash
cd oracle
pnpm install
cp .env.example .env        # paste the utility's exported key
pnpm simulate <eventId>     # write sessions from the on-chain pledge set
pnpm settle <eventId>       # verify and pay out
```

## Contract

Four entry functions (`create_event`, `register_meter`, `respond`, `settle`) over three objects (`SmartMeter`, `DREvent`, `RewardVault`). The whole package is under 200 lines, on purpose.

Deployed to Sui Testnet:

- Package ID: `0x6a0f654529672473e14d2e17303570a075841562db176bbfc8b097b7362c2927`
- Explorer: https://suiscan.xyz/testnet/object/0x6a0f654529672473e14d2e17303570a075841562db176bbfc8b097b7362c2927

## Stack

- Contracts: Sui Move
- Frontend: React + TypeScript + Vite, @mysten/dapp-kit, Tailwind + shadcn/ui
- Wallet: Slush
- Network: Sui Testnet

## Running locally

```bash
git clone https://github.com/FFAQ111/SuiWatt
cd SuiWatt

# Contracts
cd contracts
sui move build
sui move test

# Frontend (in a separate shell, from the repo root)
cd web
pnpm install
pnpm dev
```

The frontend reads the deployed Package ID from `web/src/lib/sui.ts`. If you publish your own copy of the contract, update the constant there.

## Demo

Video link goes here before submission.

## Status

In progress for Sui Overflow 2026 (May 27 to June 21), DeFi & Payments track.
