// Settlement oracle. Joins OCPP charging sessions (the off-chain "did they charge
// off-peak?" evidence) with the on-chain pledge set, and calls settle() for each driver
// that both pledged and actually charged inside the event window.
//
// This is the trust-minimised core: payout is enforced by the contract against verifiable
// session evidence, not a hand-typed number. EV charging makes the evidence clean — a single
// metered session in a window, not a fuzzy whole-home baseline.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { Transaction } from "@mysten/sui/transactions";
import { client, fq, oracleKeypair, chargerKeypair, USDC_TYPE } from "./config";
import { fetchEvent, findVault, queryResponded, querySettled } from "./chain";
import { signReading } from "./signer";
import type { OcppSession } from "./simulator";

function loadSessions(): OcppSession[] {
  const path = new URL("../sessions.json", import.meta.url);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as OcppSession[];
  } catch {
    throw new Error(
      "oracle/sessions.json missing — run `pnpm simulate <eventId>` first",
    );
  }
}

async function main() {
  const eventId = process.argv[2];
  if (!eventId) throw new Error("usage: pnpm settle <eventId>");

  const keypair = oracleKeypair();
  const charger = chargerKeypair();
  const oracleAddr = keypair.getPublicKey().toSuiAddress();

  const [ev, responders, vaultId] = await Promise.all([
    fetchEvent(eventId),
    queryResponded(eventId),
    findVault(eventId),
  ]);

  if (oracleAddr !== ev.utility)
    throw new Error(
      "settle() is restricted to the event's utility, but the oracle key is a different " +
        `address.\n  utility: ${ev.utility}\n  oracle:  ${oracleAddr}`,
    );

  const pledged = new Set(responders.map((r) => `${r.responder}:${r.meterId}`));
  const paid = new Set(
    (await querySettled(eventId)).map((s) => `${s.responder}:${s.meterId}`),
  );

  const skip = (s: OcppSession, why: string) =>
    console.log(`skip    ${s.driver.slice(0, 10)}…  (${why})`);

  for (const s of loadSessions()) {
    const key = `${s.driver}:${s.meterId}`;

    // Verification gate: pay only a session that (1) was pledged on-chain and
    // (2) actually charged off-peak, i.e. inside the event window.
    if (!pledged.has(key)) {
      skip(s, "no on-chain pledge");
      continue;
    }
    const offPeak =
      s.tariffWindow === "off-peak" &&
      s.startTime >= ev.startTime &&
      s.endTime <= ev.endTime;
    if (!offPeak) {
      skip(s, "not off-peak / outside window");
      continue;
    }
    if (paid.has(key)) {
      skip(s, "already settled");
      continue;
    }

    const savedUnits = Math.floor(s.energyKwh); // 1 unit == 1 kWh shifted
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
      `settled ${s.driver.slice(0, 10)}…  ${savedUnits} kWh  tx ${res.digest}`,
    );
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
