# Deploy

## Current deployment

| Field | Value |
|---|---|
| Network | **Sui Testnet** |
| Package ID | `0xdbcd522332065af749ffb871d4ee54fe2681752f190dcf50c33427ece55596a4` |
| UpgradeCap ID | `0x66f7d75a57897e00e7486c19ff4aefee29964705d1a54f4815f340c1ccef82b0` |
| Publisher | `0x45f4536afa601c9800ede4e0132eaa35bafaf2d4a5cb7aed51342c7efaf5e61d` |
| Reward coin | Circle USDC (testnet) `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` — contract is generic over `Coin<T>`, so this is a type argument, not a dependency |
| Publish tx | `7J5pvf9b5fsLWzRdeNKSV1nsmWaYf9ehAbqAw2WfBHcZ` |
| Publish date | 2026-06-06 |

Explorer: https://suiscan.xyz/testnet/object/0xdbcd522332065af749ffb871d4ee54fe2681752f190dcf50c33427ece55596a4

The `UpgradeCap` is owned by the publisher address and is required for any future `sui client upgrade` call.

> **Superseded:** the previous publish (`0x6a0f65…2c2927`) denominated rewards in SUI. This publish makes `RewardVault` / `create_event` / `settle` generic over `Coin<T>` (so testnet/mainnet USDC gives a stable per-kWh price) and adds `reclaim_remaining`. Adding a struct type parameter and changing public function signatures is **upgrade-incompatible**, so a fresh publish was required, not a `sui client upgrade`. Old events under the prior ID are left orphaned — the frontend and oracle point at a single Package ID.

## Re-publishing (creates a brand-new package, new ID)

From repo root:

```bash
cd contracts
sui client publish --gas-budget 100000000
```

A successful first publish on testnet costs roughly 0.02 SUI in net storage and computation. Bump `--gas-budget` if you add significant code.

## Upgrading the existing package (post-MVP)

Keeps the same Package ID and preserves shared objects (`DREvent`, `RewardVault`) created from the old version.

```bash
cd contracts
sui client upgrade \
  --upgrade-capability 0x66f7d75a57897e00e7486c19ff4aefee29964705d1a54f4815f340c1ccef82b0 \
  --gas-budget 100000000
```

## Frontend wiring

The Package ID lives in two mirrored constants: `web/src/lib/config.ts` (`PACKAGE_ID`) and `oracle/src/config.ts` (`PACKAGE_ID`). Update both after every fresh publish that changes the ID. The reward coin type argument (`USDC_TYPE`) is mirrored in the same two files. Upgrades keep the same ID, so no change needed.
