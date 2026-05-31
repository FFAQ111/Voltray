// SuiWatt on-chain references. Update PACKAGE_ID after every fresh publish that
// changes the ID (see docs/DEPLOY.md). Upgrades keep the same ID — no change needed.
export const PACKAGE_ID =
  "0x6a0f654529672473e14d2e17303570a075841562db176bbfc8b097b7362c2927";

export const MODULE = "suiwatt";
export const NETWORK = "testnet";

// Shared system Clock object, required by `respond`.
export const CLOCK_ID = "0x6";

// Fully-qualified `package::module::name` for move calls and event filters.
export const fq = (name: string) => `${PACKAGE_ID}::${MODULE}::${name}`;
