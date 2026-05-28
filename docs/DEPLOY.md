# Deploy

## Current deployment

| Field | Value |
|---|---|
| Network | **Sui Testnet** |
| Package ID | `0x462c3621667480fe1085edee11da162fbb55951f31b6f44e8f71f71379080d36` |
| UpgradeCap ID | `0xfac98866a42735e3030d1287e7f9213f5c9492f8249f4121434ccfc01fa51da8` |
| Publisher | `0x45f4536afa601c9800ede4e0132eaa35bafaf2d4a5cb7aed51342c7efaf5e61d` |
| First publish tx | `3xqwcRdp4a6veH1SDyRAKnvCNfpkgk3wE25xTmPVzPVZ` |
| First publish date | 2026-05-29 |

Explorer: https://suiscan.xyz/testnet/object/0x462c3621667480fe1085edee11da162fbb55951f31b6f44e8f71f71379080d36

The package is `Immutable`. The `UpgradeCap` is owned by the publisher address and is required for any future `sui client upgrade` call.

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
