// Voltray on-chain references. Update PACKAGE_ID after every fresh publish that
// changes the ID (see docs/DEPLOY.md). Upgrades keep the same ID — no change needed.
export const PACKAGE_ID =
  "0xb2c0ba4ad08c558e5eb10625638ddb2ca102a1417990270c40885b9f1592bebb";

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

// Fully-qualified `package::module::name` for move calls and event filters.
export const fq = (name: string) => `${PACKAGE_ID}::${MODULE}::${name}`;

// Public repo, linked from the landing page.
export const GITHUB_URL = "https://github.com/FFAQ111/SuiWatt";
export const TRUST_DOC_URL = `${GITHUB_URL}/blob/main/docs/TRUST.md`;
