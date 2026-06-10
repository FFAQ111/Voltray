// Voltray on-chain references. Update PACKAGE_ID after every fresh publish that
// changes the ID (see docs/DEPLOY.md). Upgrades keep the same ID — no change needed.
export const PACKAGE_ID =
  "0x4e211bfc5f344f541a235372cd9e22ef8a2947b5bfb4020a19858fbaaa25e964";

export const MODULE = "voltray";
export const NETWORK = "testnet";

// Shared system Clock object, required by `respond` and `reclaim_remaining`.
export const CLOCK_ID = "0x6";

// Reward coin. The contract is generic over Coin<T>; on testnet we settle in Circle USDC
// (6 decimals). Mainnet USDC lives at a different package address — only this constant
// changes, not the contract. Get testnet USDC from https://faucet.circle.com.
export const USDC_TYPE =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";
export const USDC_DECIMALS = 6;
export const USDC_SYMBOL = "USDC";

// ed25519 public key (32 bytes, hex) of the demo charger authorised to sign this event's
// session readings. create_event registers it on the DREvent; settle() verifies the oracle's
// charger signature against it (docs/TRUST.md §5.1). Public by design — only the matching
// private key (held by the oracle) can sign. Regenerate the pair with `pnpm gen:charger`.
export const DEMO_CHARGER_PUBKEY =
  "0x963724ddaae3bd8b2a4c9a3421f8d676575b15f1a8113892bd5bbcdba8ec1175";

// Fully-qualified `package::module::name` for move calls and event filters.
export const fq = (name: string) => `${PACKAGE_ID}::${MODULE}::${name}`;

// Public repo, linked from the landing page.
export const GITHUB_URL = "https://github.com/FFAQ111/Voltray";
export const TRUST_DOC_URL = `${GITHUB_URL}/blob/main/docs/TRUST.md`;
