// Hosted auto-close worker: closes ended events (settle pending + reclaim leftover) on a poll loop.
// Deployed on Fly.io (see docs/DEPLOY.md); polling over WS subscription per docs/TRUST.md §7.1.
import "dotenv/config";
import { PACKAGE_ID, chargerKeypair, oracleKeypair } from "./config";
import { closeAllEnded } from "./closer";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const oracle = oracleKeypair();
  const charger = chargerKeypair();
  console.log(`Voltray settlement daemon`);
  console.log(`  oracle   ${oracle.getPublicKey().toSuiAddress()}`);
  console.log(`  package  ${PACKAGE_ID}`);
  console.log(`  poll     every ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`  closes   events after their window: settle pending + reclaim leftover\n`);

  for (;;) {
    // A transient RPC failure must not kill the worker — log and try again next tick.
    try {
      // Close every event whose window has closed: settle all still-pending responders and
      // reclaim the leftover to the utility, atomically per event. Reclaim is gated on the
      // window being over, so active events are read-only and cost no gas. `pnpm settle` can
      // still force a mid-window settle for demos.
      const { closed, settled } = await closeAllEnded(oracle, charger);
      if (closed > 0)
        console.log(`tick: closed ${closed} event(s), settled ${settled} response(s)`);
    } catch (e) {
      console.error(`tick failed: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
