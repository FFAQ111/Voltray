// One-command oracle run for demos. Finds the most recent event this oracle owns that
// still has an unsettled response, reads the (simulated) OCPP sessions for those drivers,
// and settles them on-chain. No eventId to copy: just `pnpm settle`.
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Transaction } from "@mysten/sui/transactions";
import { client, fq, oracleKeypair, chargerKeypair, USDC_TYPE } from "./config";
import { fetchEvent, findVault, queryResponded, querySettled } from "./chain";
import { signReading } from "./signer";
import type { OcppSession } from "./simulator";

async function pickEvent(oracleAddr: string) {
  const res = await client.queryEvents({
    query: { MoveEventType: fq("EventCreated") },
    order: "descending",
    limit: 10,
  });
  for (const e of res.data) {
    const j = e.parsedJson as Record<string, string>;
    if (j.utility !== oracleAddr) continue; // settle() only accepts the event's utility
    const id = j.event_id;
    const responders = await queryResponded(id);
    const paid = new Set(
      (await querySettled(id)).map((s) => `${s.responder}:${s.meterId}`),
    );
    const pending = responders.filter(
      (r) => !paid.has(`${r.responder}:${r.meterId}`),
    );
    if (pending.length > 0) return { id, pending };
  }
  return null;
}

async function main() {
  const keypair = oracleKeypair();
  const charger = chargerKeypair();
  const oracleAddr = keypair.getPublicKey().toSuiAddress();

  const picked = await pickEvent(oracleAddr);
  if (!picked) {
    console.log("Nothing to settle: no event with an unsettled response.");
    console.log("Respond to an event in the app first, then run `pnpm settle` again.");
    return;
  }
  const { id: eventId, pending } = picked;
  const [ev, vaultId] = await Promise.all([fetchEvent(eventId), findVault(eventId)]);

  console.log(`Event ${eventId.slice(0, 12)}…  —  ${pending.length} pending response(s)\n`);

  // 1) Read OCPP charging sessions for the pending drivers (simulated CPO feed).
  const mid = Math.floor((ev.startTime + ev.endTime) / 2);
  const sessions: OcppSession[] = pending.map((r, i) => ({
    chargerId: `CP-${String(i + 1).padStart(3, "0")}`,
    meterId: r.meterId,
    driver: r.responder,
    transactionId: 1000 + i,
    startTime: mid,
    endTime: ev.endTime,
    energyKwh: 12 + ((i * 7) % 19), // deterministic 12..30 kWh
    tariffWindow: "off-peak",
  }));
  writeFileSync(
    new URL("../sessions.json", import.meta.url),
    JSON.stringify(sessions, null, 2),
  );
  for (const s of sessions)
    console.log(
      `  charger ${s.chargerId}  ${s.driver.slice(0, 10)}…  ${s.energyKwh} kWh off-peak`,
    );
  console.log("");

  // 2) Settle each on-chain. The contract pays from the vault and blocks double-payment.
  for (const s of sessions) {
    const savedUnits = Math.floor(s.energyKwh);
    // The charger signs the reading; settle() rejects it if the signature doesn't verify.
    const signature = await signReading(charger, {
      eventId,
      meterId: s.meterId,
      responder: s.driver,
      savedUnits,
    });
    const tx = new Transaction();
    tx.moveCall({
      target: fq("settle"),
      typeArguments: [USDC_TYPE],
      arguments: [
        tx.object(eventId),
        tx.object(vaultId),
        tx.pure.address(s.driver),
        tx.pure.id(s.meterId),
        tx.pure.u64(savedUnits),
        tx.pure.vector("u8", Array.from(signature)),
      ],
    });
    const res = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });
    console.log(
      `  settled ${s.driver.slice(0, 10)}…  ${savedUnits} kWh  ->  tx ${res.digest}`,
    );
  }
  console.log(
    "\nDone. Switch back to the browser; the event flips to Settled within a few seconds.",
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
