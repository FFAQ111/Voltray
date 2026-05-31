# Deploy

## Current deployment

| Field | Value |
|---|---|
| Network | **Sui Testnet** |
| Package ID | `0x6a0f654529672473e14d2e17303570a075841562db176bbfc8b097b7362c2927` |
| UpgradeCap ID | `0xd9fece6c1749a15576344b1f6a8c325427c46e04428a7ee59054eb91ba44045d` |
| Publisher | `0x45f4536afa601c9800ede4e0132eaa35bafaf2d4a5cb7aed51342c7efaf5e61d` |
| Publish tx | `CetiM5d4TxXELHG5UMFrp7kqiwLSmr4M17bmSNS5doGN` |
| Publish date | 2026-05-31 |

Explorer: https://suiscan.xyz/testnet/object/0x6a0f654529672473e14d2e17303570a075841562db176bbfc8b097b7362c2927

The `UpgradeCap` is owned by the publisher address and is required for any future `sui client upgrade` call.

> **Superseded:** the previous publish (`0x1c34bd…92585f`) predates on-chain double-settle dedup. `settle` now records a per-meter marker on the `RewardVault`, so the same response cannot be paid twice (E_ALREADY_SETTLED). The function signatures did not change, so this could have been an upgrade; a fresh publish was used instead to keep a single Package ID for both move calls and event filters, which is simpler than the upgrade dual-ID wiring for a testnet MVP. Old events under the prior ID are left orphaned.

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
