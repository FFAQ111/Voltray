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

> **Upgraded to v2 (2026-06-14, compatible upgrade).** `published-at = 0x60c0218ddcefc0cf4c315bb1dff92c4e85233a69b235ee021578f9a2cbc5f539`; `original-id` stays `0x4e211bfc…e964` (see `contracts/Published.toml`). Body-only change, so the same UpgradeCap and object/event identities carry over. **The fix:** `settle` now marks the meter settled and emits `Settled` *before* the zero-payout branch, so a pledge that arrives after the FCFS pool is drained (`units_paid == 0`) is recorded once instead of looping an automated settler forever (regression test `settle_zero_payout_is_recorded_not_skipped`). **Adoption note (Sui upgrade semantics):** object/event *types* keep the `original-id`, so every query and type filter still uses `0x4e211bfc…`; to *execute* v2 code, a caller points its `moveCall` target at `published-at` (`0x60c0218…`). The **oracle now runs v2**: `oracle/src/config.ts` splits the address into `PACKAGE_ID` (original-id, used by `fq()` for event filters / type args) and `PACKAGE_AT` (published-at, used by `fqAt()` for every `moveCall`), so `settle`/`reclaim_remaining` execute the fixed code while queries still resolve. Redeploy Fly (`fly deploy --remote-only`) to pick it up. The **frontend stays on `original-id`** — it never calls `settle`, so the fix doesn't affect it. A future upgrade only needs `fly secrets set PACKAGE_AT=0x...`, mirroring `PACKAGE_ID` after a republish.

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

## Oracle deployment (Fly.io)

The settlement daemon (`oracle/src/daemon.ts`) runs as an always-on Fly.io worker: it polls the
Sui RPC every 30 s (`POLL_INTERVAL_MS` to change) and settles any pending response on events owned
by the oracle address. No public URL — `fly.toml` declares no services. Cost is ~US$2/month for a
shared-cpu-1x / 256 MB machine.

One-time setup (from `oracle/`):

```bash
# 1. Install flyctl and log in (new accounts need payment info; $5 trial credit)
curl -L https://fly.io/install.sh | sh
fly auth login

# 2. Create the app (fly.toml already exists — do not let launch rewrite it)
fly launch --no-deploy --copy-config --name voltray-oracle

# 3. Secrets — never in fly.toml or the image (.dockerignore excludes .env)
fly secrets set ORACLE_SECRET_KEY=suiprivkey1... CHARGER_SECRET_KEY=suiprivkey1...

# 4. Build remotely and deploy (no local Docker needed)
fly deploy --remote-only

# 5. Watch it run
fly logs
```

Operational notes:

- **Gas:** the oracle (utility) address pays gas for every `settle` — keep it topped up with
  testnet SUI (`sui client faucet`).
- **After a fresh publish / project rename:** the deployed daemon follows a new Package ID with
  one command — `fly secrets set PACKAGE_ID=0x<new id>` (the machine restarts itself). No
  rebuild, no fly.toml change. The Fly app *name* never needs to change; it is an internal label
  with no public URL.
- **Manual settles still work:** running `pnpm settle` locally while the daemon is up is
  harmless — the contract's per-meter dedup (`E_ALREADY_SETTLED`) rejects the loser of the race.
- **Session data (demo):** the kWh each responder is paid for comes from
  `oracle/sessions.input.json` (shaped like an OCPP StopTransaction / OCPI CDR), applied in order
  to an event's responders; if the file is absent or shorter than the responder count, a
  deterministic formula fills the rest. Edit it to control the on-screen numbers. Local
  `pnpm settle` / `pnpm daemon` pick it up immediately; the Fly daemon uses the copy baked into the
  image, so run `fly deploy --remote-only` to apply edits there. This only sets the *source* of the
  number — it is not an anti-forgery measure (see TRUST.md §3.2).
