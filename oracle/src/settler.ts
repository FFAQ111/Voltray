// One settle pass over recent events, shared by the one-shot CLI (run.ts) and the
// hosted daemon (daemon.ts): find this oracle's events with unsettled responses, read
// the (simulated) OCPP sessions for those drivers, and settle them on-chain.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Transaction } from "@mysten/sui/transactions";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { client, fq, USDC_TYPE } from "./config";
import { fetchEvent, findVault, queryResponded, querySettled } from "./chain";
import { signReading } from "./signer";
import type { OcppSession } from "./simulator";

interface PendingEvent {
  id: string;
  pending: { meterId: string; responder: string }[];
}

// An operator-editable session feed standing in for the OCPI CDRs a real CPO would push.
// Entries apply in order to each event's pending responders; anything past the list (or a
// missing/invalid file) falls back to the deterministic formula below. Only energyKwh affects
// the on-chain payout — the other fields are display, shaped like an OCPP StopTransaction.
// TODO(post-MVP): pull these from a CPO's OCPI CDR endpoint instead of a local file (TRUST.md §6).
interface SessionInput {
  chargerId?: string;
  energyKwh: number;
  tariffWindow?: "off-peak" | "peak";
}

const INPUT_FILE = new URL("../sessions.input.json", import.meta.url);

function loadSessionInput(): SessionInput[] {
  if (!existsSync(INPUT_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(INPUT_FILE, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    console.warn("sessions.input.json is not valid JSON — using the built-in formula.");
    return [];
  }
}

// All recent events this oracle owns that still have an unsettled response.
// settle() only accepts the event's utility, so other utilities' events are skipped.
async function pendingEvents(oracleAddr: string): Promise<PendingEvent[]> {
  const res = await client.queryEvents({
    query: { MoveEventType: fq("EventCreated") },
    order: "descending",
    limit: 10,
  });
  const out: PendingEvent[] = [];
  for (const e of res.data) {
    const j = e.parsedJson as Record<string, string>;
    if (j.utility !== oracleAddr) continue;
    const id = j.event_id;
    const responders = await queryResponded(id);
    if (responders.length === 0) continue;
    const paid = new Set(
      (await querySettled(id)).map((s) => `${s.responder}:${s.meterId}`),
    );
    const pending = responders.filter(
      (r) => !paid.has(`${r.responder}:${r.meterId}`),
    );
    if (pending.length > 0) out.push({ id, pending });
  }
  return out;
}

// Settle every pending response on every event this oracle owns. Returns the number of
// settlements performed. Idempotent: already-paid pairs are filtered out up front, and the
// contract's per-meter dedup (E_ALREADY_SETTLED) catches any race with a manual `pnpm settle`.
export async function settleAllPending(
  oracle: Ed25519Keypair,
  charger: Ed25519Keypair,
): Promise<number> {
  const oracleAddr = oracle.getPublicKey().toSuiAddress();
  const events = await pendingEvents(oracleAddr);
  const input = loadSessionInput();
  let settledCount = 0;

  for (const { id: eventId, pending } of events) {
    // One bad event (e.g. a drained vault) must not block the rest of the sweep.
    try {
      const [ev, vaultId] = await Promise.all([
        fetchEvent(eventId),
        findVault(eventId),
      ]);
      console.log(
        `Event ${eventId.slice(0, 12)}…  —  ${pending.length} pending response(s)\n`,
      );

      // 1) Read OCPP charging sessions for the pending drivers (simulated CPO feed).
      const mid = Math.floor((ev.startTime + ev.endTime) / 2);
      const sessions: OcppSession[] = pending.map((r, i) => {
        const feed = input[i];
        return {
          chargerId: feed?.chargerId ?? `CP-${String(i + 1).padStart(3, "0")}`,
          meterId: r.meterId,
          driver: r.responder,
          transactionId: 1000 + i,
          startTime: mid,
          endTime: ev.endTime,
          // From the editable feed when present, else a deterministic 12..30 kWh.
          energyKwh: feed?.energyKwh ?? 12 + ((i * 7) % 19),
          tariffWindow: feed?.tariffWindow ?? "off-peak",
        };
      });
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
          signer: oracle,
          transaction: tx,
          options: { showEffects: true },
        });
        // Wait for finality before the next settle so the SDK selects the updated gas-coin
        // version. Without this, consecutive sends in one tick reuse a stale coin and are
        // rejected, so a backlog dribbles out one settle per poll instead of draining at once.
        await client.waitForTransaction({ digest: res.digest });
        console.log(
          `  settled ${s.driver.slice(0, 10)}…  ${savedUnits} kWh  ->  tx ${res.digest}`,
        );
        settledCount += 1;
      }
    } catch (e) {
      console.error(
        `  event ${eventId.slice(0, 12)}… failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  return settledCount;
}
