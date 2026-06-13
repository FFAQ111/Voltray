// Atomically close out an event: in ONE programmable transaction (PTB), settle every
// still-pending responder and then reclaim the leftover to the utility. Either everyone
// pending is paid AND the remainder returns, or the whole transaction reverts — so reclaim
// can never race ahead of a pledged-but-unsettled payout (docs/TRUST.md §3.3, ARCHITECTURE
// §3.5). The contract stores no participant list, so this ordering can only be enforced here,
// off-chain, by bundling the calls; the PTB makes it atomic.
//
// Usage: pnpm close <eventId>   (only after the event window has closed)
import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { USDC_TYPE, chargerKeypair, client, fqAt, oracleKeypair } from "./config";
import { fetchEvent, findVault, queryResponded, querySettled } from "./chain";
import { signReading } from "./signer";
import { loadSessionInput } from "./settler";

// The shared Clock object has a fixed, well-known id on every Sui network.
const CLOCK_ID = "0x6";

async function main() {
  const eventId = process.argv[2];
  if (!eventId) throw new Error("usage: pnpm close <eventId>");

  const oracle = oracleKeypair();
  const charger = chargerKeypair();

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
  console.log(
    `Closed event ${eventId.slice(0, 12)}… — settled ${pending.length} pending + reclaimed leftover in one PTB -> tx ${res.digest}`,
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
