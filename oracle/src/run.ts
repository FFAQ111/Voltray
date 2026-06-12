// One-command oracle run for demos: a single settle pass over this oracle's events.
// No eventId to copy: just `pnpm settle`. The hosted daemon (daemon.ts) runs the same
// pass on a loop; the settle logic lives in settler.ts.
import "dotenv/config";
import { chargerKeypair, oracleKeypair } from "./config";
import { settleAllPending } from "./settler";

async function main() {
  const settled = await settleAllPending(oracleKeypair(), chargerKeypair());
  if (settled === 0) {
    console.log("Nothing to settle: no event with an unsettled response.");
    console.log("Respond to an event in the app first, then run `pnpm settle` again.");
    return;
  }
  console.log(
    "\nDone. Switch back to the browser; the event flips to Settled within a few seconds.",
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
