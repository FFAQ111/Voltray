// OCPP charging-session simulator. Stands in for a Charge Point Operator's backend
// (real chargers speak OCPP) by emitting one StopTransaction-style session per driver
// that pledged on-chain. The oracle later verifies and settles against these sessions.
//
// TODO(post-MVP): consume real OCPP 1.6 / 2.0.1 StopTransaction telemetry from a charger
// or a CPO API instead of synthesising it from the on-chain pledge set.
import { writeFileSync } from "node:fs";
import { fetchEvent, queryResponded } from "./chain";

export interface OcppSession {
  chargerId: string;
  meterId: string; // links to the on-chain SmartMeter
  driver: string; // the driver's Sui address (CPO maps charging account -> wallet)
  transactionId: number;
  startTime: number; // ms epoch; off-peak when inside the event window
  endTime: number;
  energyKwh: number; // energy delivered off-peak == kWh shifted away from the peak
  tariffWindow: "off-peak" | "peak";
}

const SESSIONS_FILE = new URL("../sessions.json", import.meta.url);

async function main() {
  const eventId = process.argv[2];
  if (!eventId) throw new Error("usage: pnpm simulate <eventId>");

  const ev = await fetchEvent(eventId);
  const responders = await queryResponded(eventId);
  if (responders.length === 0) {
    console.log("No on-chain responders yet — nobody to generate sessions for.");
    return;
  }

  // Place each session inside the event window so it counts as an off-peak charge.
  const mid = Math.floor((ev.startTime + ev.endTime) / 2);
  const sessions: OcppSession[] = responders.map((r, i) => ({
    chargerId: `CP-${String(i + 1).padStart(3, "0")}`,
    meterId: r.meterId,
    driver: r.responder,
    transactionId: 1000 + i,
    startTime: mid,
    endTime: ev.endTime,
    energyKwh: 12 + ((i * 7) % 19), // deterministic 12..30 kWh
    tariffWindow: "off-peak",
  }));

  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  console.log(`Wrote ${sessions.length} session(s) to oracle/sessions.json`);
  for (const s of sessions)
    console.log(
      `  ${s.chargerId}  ${s.driver.slice(0, 10)}…  ${s.energyKwh} kWh ${s.tariffWindow}`,
    );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
