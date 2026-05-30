// SuiWatt package references and signer for the settlement oracle.
//
// Source of truth for PACKAGE_ID is web/src/lib/config.ts and docs/DEPLOY.md. The oracle
// is a self-contained package (no workspace — see CLAUDE.md), so the ID is mirrored here;
// keep it in sync after any fresh publish that changes the ID.
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export const PACKAGE_ID =
  "0x1c34bd5411ea26efc74e9526bbdb727a3bdd0c0fde8eb60582b77a24af92585f";
export const MODULE = "suiwatt";
export const NETWORK = "testnet" as const;

// Fully-qualified `package::module::name` for move calls and event filters.
export const fq = (name: string) => `${PACKAGE_ID}::${MODULE}::${name}`;

export const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

// The contract restricts settle() to the event's utility address, so the oracle signs
// as the utility. For the MVP it holds that key directly.
// TODO(post-MVP): replace the admin-only check with oracle-signature verification or a
// multisig so the oracle is not the utility (see contracts/sources/suiwatt.move settle()).
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
