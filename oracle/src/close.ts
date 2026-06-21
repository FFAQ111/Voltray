// Atomically close out one ended event: settle every still-pending responder and reclaim the
// leftover to the utility, in a single PTB (see closeEvent in closer.ts and docs/TRUST.md §3.3).
//
// Usage: pnpm close <eventId>   (only after the event window has closed)
import "dotenv/config";
import { chargerKeypair, oracleKeypair } from "./config";
import { closeEvent } from "./closer";

async function main() {
  const eventId = process.argv[2];
  if (!eventId) throw new Error("usage: pnpm close <eventId>");

  const { settled, digest } = await closeEvent(
    oracleKeypair(),
    chargerKeypair(),
    eventId,
  );
  console.log(
    `Closed event ${eventId.slice(0, 12)}… — settled ${settled} pending + reclaimed leftover in one PTB -> tx ${digest}`,
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
