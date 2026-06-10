# Deploy

## Current deployment

| Field | Value |
|---|---|
| Network | **Sui Testnet** |
| Package ID | `0xb2c0ba4ad08c558e5eb10625638ddb2ca102a1417990270c40885b9f1592bebb` |
| UpgradeCap ID | `0xc35d613fe8ca1c72483809a93c82980cd9d5d381a15296407037c744fc1ceb7d` |
| Publisher | `0x45f4536afa601c9800ede4e0132eaa35bafaf2d4a5cb7aed51342c7efaf5e61d` |
| Reward coin | Circle USDC (testnet) `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` — contract is generic over `Coin<T>`, so this is a type argument, not a dependency |
| Publish tx | `D6Hbrs8JyQV4MeTB9rXxZ17gwu4YhcAxPkQfEsGKnVtS` |
| Publish date | 2026-06-11 |

Explorer: https://suiscan.xyz/testnet/object/0xb2c0ba4ad08c558e5eb10625638ddb2ca102a1417990270c40885b9f1592bebb

The `UpgradeCap` is owned by the publisher address and is required for any future `sui client upgrade` call.

> **Superseded:** the previous publish (`0xdbcd52…5596a4`) used the module name `suiwatt`. This publish renames the package/module to `voltray` (project rebrand) and adds `create_event` input validation (vault must cover the worst-case payout; `start_time < end_time`). Renaming a module changes every fully-qualified type and function identifier, which is **upgrade-incompatible**, so a fresh publish was required, not a `sui client upgrade`. Old events under the prior ID are left orphaned — the frontend and oracle point at a single Package ID.

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
  --upgrade-capability 0xc35d613fe8ca1c72483809a93c82980cd9d5d381a15296407037c744fc1ceb7d \
  --gas-budget 100000000
```

## Frontend wiring

The Package ID lives in two mirrored constants: `web/src/lib/config.ts` (`PACKAGE_ID`) and `oracle/src/config.ts` (`PACKAGE_ID`). Update both after every fresh publish that changes the ID. The reward coin type argument (`USDC_TYPE`) is mirrored in the same two files. Upgrades keep the same ID, so no change needed.
