// Voltray package references and signer for the settlement oracle.
//
// Source of truth for PACKAGE_ID is web/src/lib/config.ts and docs/DEPLOY.md. The oracle
// is a self-contained package (no workspace — see CLAUDE.md), so the ID is mirrored here;
// keep it in sync after any fresh publish that changes the ID. A hosted daemon can override
// it via env (`fly secrets set PACKAGE_ID=0x...`) instead of needing a rebuild — this is the
// whole upgrade path after a republish/rename (docs/DEPLOY.md).
// Loaded here (not only in the entrypoints) because PACKAGE_ID is read at module-eval time.
import "dotenv/config";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export const PACKAGE_ID =
  process.env.PACKAGE_ID ??
  "0x4e211bfc5f344f541a235372cd9e22ef8a2947b5bfb4020a19858fbaaa25e964";
// Address of the latest published *code* (published-at after the v2 upgrade). A Sui upgrade puts
// new bytecode at a new address while object/event *types* keep the original PACKAGE_ID. So move
// calls target PACKAGE_AT to run the fixed v2 logic, but event filters and type arguments must
// stay on PACKAGE_ID or they match nothing (docs/DEPLOY.md, Sui upgrade semantics). Override via
// `fly secrets set PACKAGE_AT=0x...` after a future upgrade, same as PACKAGE_ID after a republish.
export const PACKAGE_AT =
  process.env.PACKAGE_AT ??
  "0x60c0218ddcefc0cf4c315bb1dff92c4e85233a69b235ee021578f9a2cbc5f539";
export const MODULE = "voltray";
export const NETWORK = "testnet" as const;

// Reward coin type argument for settle()/reclaim. The contract is generic over Coin<T>;
// on testnet that is Circle USDC. Keep in sync with web/src/lib/config.ts USDC_TYPE.
export const USDC_TYPE =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

// Fully-qualified `package::module::name` for event filters and type origins — uses PACKAGE_ID
// (the original-id), which is where Move type/event identity lives even after an upgrade.
export const fq = (name: string) => `${PACKAGE_ID}::${MODULE}::${name}`;
// Same, but for move-call targets: PACKAGE_AT runs the latest published code. Use this for
// every moveCall; use fq() for queryEvents filters and type arguments.
export const fqAt = (name: string) => `${PACKAGE_AT}::${MODULE}::${name}`;

export const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

// The contract restricts settle() to the event's utility address, so the oracle signs
// as the utility. For the MVP it holds that key directly.
// TODO(post-MVP): replace the admin-only check with oracle-signature verification or a
// multisig so the oracle is not the utility (see contracts/sources/voltray.move settle()).
export function oracleKeypair(): Ed25519Keypair {
  const secret = process.env.ORACLE_SECRET_KEY;
  if (!secret || secret.startsWith("suiprivkey1...")) {
    throw new Error(
      "ORACLE_SECRET_KEY not set. Copy oracle/.env.example to oracle/.env and fill it:\n" +
        "  sui keytool export --key-identity <utility-address>  # copy the suiprivkey1... value",
    );
  }
  return Ed25519Keypair.fromSecretKey(secret);
}

// The charger key that signs session readings. Separate from the oracle/utility key: the oracle
// *submits* settle, but the charger *signs* the kWh, so the operator can't fabricate a reading.
// Generate a demo pair with `pnpm gen:charger`; its public key is registered on-chain at
// create_event (web/src/lib/config.ts DEMO_CHARGER_PUBKEY).
export function chargerKeypair(): Ed25519Keypair {
  const secret = process.env.CHARGER_SECRET_KEY;
  if (!secret || secret.startsWith("suiprivkey1...")) {
    throw new Error(
      "CHARGER_SECRET_KEY not set. Copy oracle/.env.example to oracle/.env and fill it with the\n" +
        "demo charger key (generate one with `pnpm gen:charger`).",
    );
  }
  return Ed25519Keypair.fromSecretKey(secret);
}
