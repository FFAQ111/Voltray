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

## Contract

Four entry functions (`create_event`, `register_meter`, `respond`, `settle`) over three objects (`SmartMeter`, `DREvent`, `RewardVault`). The whole package is under 200 lines, on purpose.

Deployed to Sui Testnet:

- Package ID: `0x1c34bd5411ea26efc74e9526bbdb727a3bdd0c0fde8eb60582b77a24af92585f`
- Explorer: https://suiscan.xyz/testnet/object/0x1c34bd5411ea26efc74e9526bbdb727a3bdd0c0fde8eb60582b77a24af92585f

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
