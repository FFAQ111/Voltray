// SuiWatt on-chain references. Update PACKAGE_ID after every fresh publish that
// changes the ID (see docs/DEPLOY.md). Upgrades keep the same ID — no change needed.
export const PACKAGE_ID =
  "0x1c34bd5411ea26efc74e9526bbdb727a3bdd0c0fde8eb60582b77a24af92585f";

export const MODULE = "suiwatt";
export const NETWORK = "testnet";

// Shared system Clock object, required by `respond`.
export const CLOCK_ID = "0x6";

// Fully-qualified `package::module::name` for move calls and event filters.
export const fq = (name: string) => `${PACKAGE_ID}::${MODULE}::${name}`;
