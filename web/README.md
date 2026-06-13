# Voltray — Web (dApp)

The Voltray frontend: a React + TypeScript single-page app that talks **directly to the Sui
testnet RPC** (no backend of its own). Utilities create and fund DR events, users register a
meter and respond, and everyone watches settlements land on-chain. See the
[root README](../README.md) for what Voltray is and
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for the contract.

## Stack

- React + TypeScript, built with **Vite** (the dev server / bundler — see below)
- [@mysten/dapp-kit](https://sdk.mystenlabs.com/dapp-kit) + `@mysten/sui` — wallet connection and Sui RPC
- `@tanstack/react-query` — on-chain data fetching and polling
- Tailwind CSS + shadcn/ui components

## Run

```bash
pnpm install
pnpm dev          # start the Vite dev server (hot reload)
pnpm build        # type-check (tsc -b) + production build
pnpm lint         # eslint
```

The deployed Package ID and reward-coin type live in
[`src/lib/config.ts`](src/lib/config.ts). After a fresh contract publish, update them there
(and the mirror in [`../oracle/src/config.ts`](../oracle/src/config.ts)).

## Pages

- **Dashboard** — your activity, plus register / list your smart meters
- **Events** — browse DR events
- **Create Event** — fund a reward vault and post an event in one PTB
- **Event Detail** — respond with a meter; utilities reclaim unspent funds after the window
