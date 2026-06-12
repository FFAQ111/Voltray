// Hosted auto-settlement worker: the settle pass from settler.ts on a poll loop.
// Deployed on Fly.io (see docs/DEPLOY.md); polling over WS subscription per docs/TRUST.md §7.1.
import "dotenv/config";
import { PACKAGE_ID, chargerKeypair, oracleKeypair } from "./config";
import { settleAllPending } from "./settler";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const oracle = oracleKeypair();
  const charger = chargerKeypair();
  console.log(`Voltray settlement daemon`);
  console.log(`  oracle   ${oracle.getPublicKey().toSuiAddress()}`);
  console.log(`  package  ${PACKAGE_ID}`);
  console.log(`  poll     every ${POLL_INTERVAL_MS / 1000}s\n`);

  for (;;) {
    // A transient RPC failure must not kill the worker — log and try again next tick.
    try {
      const settled = await settleAllPending(oracle, charger);
      if (settled > 0) console.log(`tick: settled ${settled} response(s)`);
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
