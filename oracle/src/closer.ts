// Reusable "close out an event" logic, shared by the CLI (close.ts) and the hosted daemon
// (daemon.ts). closeEvent atomically settles every still-pending responder and reclaims the
// leftover in ONE programmable transaction (PTB); closeAllEnded runs it over every ended event
// this oracle owns that still needs closing. The contract stores no participant list, so the
// settle-before-reclaim ordering can only be enforced here, off-chain, by bundling the calls —
// the PTB makes it atomic, so reclaim can never race ahead of a pledged-but-unsettled payout
// (docs/TRUST.md §3.3, ARCHITECTURE §3.5).
import { Transaction } from "@mysten/sui/transactions";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { USDC_TYPE, client, fq, fqAt } from "./config";
import {
  fetchEvent,
  findVault,
  queryReclaimed,
  queryResponded,
  querySettled,
} from "./chain";
import { signReading } from "./signer";
import { loadSessionInput } from "./settler";

// The shared Clock object has a fixed, well-known id on every Sui network.
const CLOCK_ID = "0x6";

// Settle all still-pending responders for one ended event, then reclaim the leftover to the
// utility — bundled in a single PTB. Aborts if the window has not closed (reclaim_remaining is
// gated on it, and an abort would revert the whole PTB), so callers must only pass ended events.
export async function closeEvent(
  oracle: Ed25519Keypair,
  charger: Ed25519Keypair,
  eventId: string,
): Promise<{ settled: number; digest: string }> {
  const [ev, vaultId] = await Promise.all([fetchEvent(eventId), findVault(eventId)]);
  // reclaim_remaining aborts inside the window (E_EVENT_NOT_ENDED), which would revert the
  // whole PTB — fail fast with a clear message instead.
  if (ev.endTime >= Date.now())
    throw new Error(
      `Event window has not closed yet (ends ${new Date(ev.endTime).toISOString()}). ` +
        `Close after the window so reclaim is allowed.`,
    );

  const responders = await queryResponded(eventId);
  const paid = new Set(
    (await querySettled(eventId)).map((s) => `${s.responder}:${s.meterId}`),
  );
  const pending = responders.filter((r) => !paid.has(`${r.responder}:${r.meterId}`));
  const input = loadSessionInput();

  const tx = new Transaction();
  for (let i = 0; i < pending.length; i++) {
    const r = pending[i];
    const savedUnits = Math.floor(input[i]?.energyKwh ?? 12 + ((i * 7) % 19));
    const signature = await signReading(charger, {
      eventId,
      meterId: r.meterId,
      responder: r.responder,
      savedUnits,
    });
    tx.moveCall({
      target: fqAt("settle"),
      typeArguments: [USDC_TYPE],
      arguments: [
        tx.object(eventId),
        tx.object(vaultId),
        tx.pure.address(r.responder),
        tx.pure.id(r.meterId),
        tx.pure.u64(savedUnits),
        tx.pure.vector("u8", Array.from(signature)),
      ],
    });
  }
  // Reclaim last, so it only takes what is left after the settles above are applied.
  tx.moveCall({
    target: fqAt("reclaim_remaining"),
    typeArguments: [USDC_TYPE],
    arguments: [tx.object(eventId), tx.object(vaultId), tx.object(CLOCK_ID)],
  });

  const res = await client.signAndExecuteTransaction({
    signer: oracle,
    transaction: tx,
    options: { showEffects: true },
  });
  return { settled: pending.length, digest: res.digest };
}

// The daemon close pass: find this oracle's events whose window has closed and that still need
// closing, and run closeEvent for each. Idempotent — an ended event is skipped once its vault is
// drained (remaining_units === 0, the same signal settler.ts uses) or its leftover has already
// been returned (a Reclaimed event exists). Returns how many events were closed and how many
// responders were settled across them.
//
// TODO(post-MVP): reclaim fires on the first tick after the window closes (no grace/finality
// window). Safe for the MVP because a closed window freezes the pledge set, but a real OCPI CDR
// feed that can arrive late would want a grace delay before reclaim — see reclaim_remaining in
// contracts/sources/voltray.move and docs/ARCHITECTURE.md §5.
export async function closeAllEnded(
  oracle: Ed25519Keypair,
  charger: Ed25519Keypair,
): Promise<{ closed: number; settled: number }> {
  const oracleAddr = oracle.getPublicKey().toSuiAddress();
  const res = await client.queryEvents({
    query: { MoveEventType: fq("EventCreated") },
    order: "descending",
    limit: 10,
  });
  let closed = 0;
  let settled = 0;
  for (const e of res.data) {
    const j = e.parsedJson as Record<string, string>;
    if (j.utility !== oracleAddr) continue;
    const eventId = j.event_id;
    // One bad event (e.g. a transient RPC error) must not block the rest of the sweep.
    try {
      const ev = await fetchEvent(eventId);
      if (ev.endTime >= Date.now()) continue; // window still open
      if (ev.remainingUnits === 0) continue; // vault drained: nothing to pay or reclaim
      if ((await queryReclaimed(eventId)).length > 0) continue; // leftover already returned
      const r = await closeEvent(oracle, charger, eventId);
      closed += 1;
      settled += r.settled;
      console.log(
        `  closed event ${eventId.slice(0, 12)}…  settled ${r.settled} + reclaimed  ->  tx ${r.digest}`,
      );
    } catch (err) {
      console.error(
        `  event ${eventId.slice(0, 12)}… close failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  return { closed, settled };
}
