// Charger-side signing of a session reading. The charger (here, the simulated CPO feed) holds
// an ed25519 key; settle() in contracts/sources/voltray.move verifies this signature against the
// event's authorised charger_pubkey before paying (see docs/TRUST.md §5.1).
import { bcs } from "@mysten/sui/bcs";
import { fromHex } from "@mysten/sui/utils";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export interface Reading {
  eventId: string;
  meterId: string;
  responder: string;
  savedUnits: number;
}

// Must match the Move verifier byte-for-byte:
// event_id(32) ‖ meter_id(32) ‖ responder(32) ‖ saved_units(u64, little-endian, 8).
export function readingMessage(r: Reading): Uint8Array {
  return Uint8Array.from([
    ...fromHex(r.eventId),
    ...fromHex(r.meterId),
    ...fromHex(r.responder),
    ...bcs.u64().serialize(r.savedUnits).toBytes(),
  ]);
}

// Raw ed25519 signature over the message. `sign` (not signPersonalMessage/signTransaction,
// which prepend intent bytes) is what sui::ed25519::ed25519_verify checks.
export function signReading(
  charger: Ed25519Keypair,
  r: Reading,
): Promise<Uint8Array> {
  return charger.sign(readingMessage(r));
}
