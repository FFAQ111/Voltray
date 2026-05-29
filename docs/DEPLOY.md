# Deploy

## Current deployment

| Field | Value |
|---|---|
| Network | **Sui Testnet** |
| Package ID | `0x1c34bd5411ea26efc74e9526bbdb727a3bdd0c0fde8eb60582b77a24af92585f` |
| UpgradeCap ID | `0x837f7388fc7806a0ca42c8b3b11ea0e1222ea95bd44a33d5a4338b170983cb71` |
| Publisher | `0x45f4536afa601c9800ede4e0132eaa35bafaf2d4a5cb7aed51342c7efaf5e61d` |
| Publish tx | `8Tyjf2vZZAzLqWVPFgSU2i3P8yCdhmz7zj4BpkcMLHoH` |
| Publish date | 2026-05-29 |

Explorer: https://suiscan.xyz/testnet/object/0x1c34bd5411ea26efc74e9526bbdb727a3bdd0c0fde8eb60582b77a24af92585f

The `UpgradeCap` is owned by the publisher address and is required for any future `sui client upgrade` call.

> **Superseded:** the first publish (`0x462c36…080d36`) predates on-chain double-response dedup. The `respond` signature changed (`&SmartMeter` → `&mut SmartMeter`), which is not an upgrade-compatible change, so this was a fresh publish with a new Package ID. Use the ID above.

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
  --upgrade-capability 0xfac98866a42735e3030d1287e7f9213f5c9492f8249f4121434ccfc01fa51da8 \
  --gas-budget 100000000
```

## Frontend wiring

The frontend reads the Package ID from `web/src/lib/sui.ts` (created in the next phase). Update the constant there after every fresh publish that changes the ID. Upgrades keep the same ID, so no frontend change needed.
