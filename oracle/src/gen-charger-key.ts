// One-off helper: mint a demo "charger" ed25519 keypair. The charger signs session readings
// (oracle/src/signer.ts); settle() verifies the signature against the event's authorised key.
//
//   pnpm gen:charger
//
// Put the printed secret in oracle/.env as CHARGER_SECRET_KEY, and the public-key hex in
// web/src/lib/config.ts as DEMO_CHARGER_PUBKEY (it is registered on-chain at create_event).
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toHex } from "@mysten/sui/utils";

const kp = Ed25519Keypair.generate();
console.log("CHARGER_SECRET_KEY =", kp.getSecretKey());
console.log("DEMO_CHARGER_PUBKEY = 0x" + toHex(kp.getPublicKey().toRawBytes()));
