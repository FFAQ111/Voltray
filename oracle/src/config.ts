// Voltray package references and signer for the settlement oracle.
//
// Source of truth for PACKAGE_ID is web/src/lib/config.ts and docs/DEPLOY.md. The oracle
// is a self-contained package (no workspace — see CLAUDE.md), so the ID is mirrored here;
// keep it in sync after any fresh publish that changes the ID.
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export const PACKAGE_ID =
  "0x4e211bfc5f344f541a235372cd9e22ef8a2947b5bfb4020a19858fbaaa25e964";
export const MODULE = "voltray";
export const NETWORK = "testnet" as const;

// Reward coin type argument for settle()/reclaim. The contract is generic over Coin<T>;
// on testnet that is Circle USDC. Keep in sync with web/src/lib/config.ts USDC_TYPE.
export const USDC_TYPE =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

// Fully-qualified `package::module::name` for move calls and event filters.
export const fq = (name: string) => `${PACKAGE_ID}::${MODULE}::${name}`;

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
