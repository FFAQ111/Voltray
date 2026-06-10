# Deploy

## Current deployment

| Field | Value |
|---|---|
| Network | **Sui Testnet** |
| Package ID | `0x4e211bfc5f344f541a235372cd9e22ef8a2947b5bfb4020a19858fbaaa25e964` |
| UpgradeCap ID | `0xb8178f29c5418017d41bdef3378b081db6a7ef2399b757f50287b309d14e4997` |
| Publisher | `0x45f4536afa601c9800ede4e0132eaa35bafaf2d4a5cb7aed51342c7efaf5e61d` |
| Reward coin | Circle USDC (testnet) `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` — contract is generic over `Coin<T>`, so this is a type argument, not a dependency |
| Publish tx | `AWAZ4Kvg3afo7MZDeP2uQb435CMJKvhDxeA7sDEEZtWM` |
| Publish date | 2026-06-11 |

Explorer: https://suiscan.xyz/testnet/object/0x4e211bfc5f344f541a235372cd9e22ef8a2947b5bfb4020a19858fbaaa25e964

The `UpgradeCap` is owned by the publisher address and is required for any future `sui client upgrade` call.

> **Superseded:** the previous publish (`0xb2c0ba…2bebb`) settled on the operator's word alone. This publish adds **charger-signed settlement** (TRUST.md §5.1): `DREvent` carries an authorised `charger_pubkey` set at `create_event`, and `settle` verifies an ed25519 signature over `(event_id, meter_id, responder, saved_units)` with `sui::ed25519::ed25519_verify` before paying. Adding a struct field and changing the `create_event`/`settle` signatures is **upgrade-incompatible**, so a fresh publish was required, not a `sui client upgrade`. Old events under the prior ID are left orphaned — the frontend and oracle point at a single Package ID.

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
  --upgrade-capability 0xb8178f29c5418017d41bdef3378b081db6a7ef2399b757f50287b309d14e4997 \
  --gas-budget 100000000
```

## Frontend wiring

The Package ID lives in two mirrored constants: `web/src/lib/config.ts` (`PACKAGE_ID`) and `oracle/src/config.ts` (`PACKAGE_ID`). Update both after every fresh publish that changes the ID. The reward coin type argument (`USDC_TYPE`) is mirrored in the same two files. Upgrades keep the same ID, so no change needed.
