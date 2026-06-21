// Read helpers over the Voltray package. Aggregates are derived by scanning Sui events —
// the contract stores no accumulating state (see docs/ARCHITECTURE.md and CLAUDE.md).
import { client, fq } from "./config";

export interface Responded {
  eventId: string;
  meterId: string;
  responder: string;
  timestamp: number;
}

// Drivers who pledged on-chain for this event (one MeterResponded per meter).
export async function queryResponded(eventId: string): Promise<Responded[]> {
  const res = await client.queryEvents({
    query: { MoveEventType: fq("MeterResponded") },
    order: "descending",
    limit: 50,
  });
  return res.data
    .map((e) => {
      const j = e.parsedJson as Record<string, string>;
      return {
        eventId: j.event_id,
        meterId: j.meter_id,
        responder: j.responder,
        timestamp: Number(j.timestamp),
      };
    })
    .filter((r) => r.eventId === eventId);
}

// Pairs already paid out — used to keep settlement runs idempotent.
export async function querySettled(
  eventId: string,
): Promise<{ responder: string; meterId: string }[]> {
  const res = await client.queryEvents({
    query: { MoveEventType: fq("Settled") },
    order: "descending",
    limit: 50,
  });
  return res.data
    .map((e) => e.parsedJson as Record<string, string>)
    .filter((j) => j.event_id === eventId)
    .map((j) => ({ responder: j.responder, meterId: j.meter_id }));
}

// Events whose leftover has already been returned to the utility. Lets the daemon tell a
// still-open vault from one already closed out — the same idempotency role querySettled plays
// for paid pairs, and the same signal the frontend uses (web EventDetail "isReclaimed").
export async function queryReclaimed(
  eventId: string,
): Promise<{ amount: number }[]> {
  const res = await client.queryEvents({
    query: { MoveEventType: fq("Reclaimed") },
    order: "descending",
    limit: 50,
  });
  return res.data
    .map((e) => e.parsedJson as Record<string, string>)
    .filter((j) => j.event_id === eventId)
    .map((j) => ({ amount: Number(j.amount) }));
}

export interface EventWindow {
  utility: string;
  startTime: number;
  endTime: number;
  remainingUnits: number;
}

export async function fetchEvent(eventId: string): Promise<EventWindow> {
  const obj = await client.getObject({
    id: eventId,
    options: { showContent: true },
  });
  const content = obj.data?.content;
  if (!content || content.dataType !== "moveObject")
    throw new Error(`DREvent ${eventId} not found`);
  const f = content.fields as Record<string, string>;
  return {
    utility: f.utility,
    startTime: Number(f.start_time),
    endTime: Number(f.end_time),
    remainingUnits: Number(f.remaining_units),
  };
}

// The RewardVault is created in the same tx as its DREvent, so resolve it from that
// tx's object changes rather than needing an indexer (mirrors web/src/lib/voltray.ts).
export async function findVault(eventId: string): Promise<string> {
  const res = await client.queryEvents({
    query: { MoveEventType: fq("EventCreated") },
    order: "descending",
    limit: 50,
  });
  const created = res.data.find(
    (e) => (e.parsedJson as Record<string, string>).event_id === eventId,
  );
  if (!created) throw new Error(`EventCreated not found for ${eventId}`);
  const tx = await client.getTransactionBlock({
    digest: created.id.txDigest,
    options: { showObjectChanges: true },
  });
  const change = tx.objectChanges?.find(
    (c) =>
      c.type === "created" &&
      // RewardVault is now generic, so its type carries a `<...::usdc::USDC>` suffix —
      // match the prefix rather than the whole string.
      c.objectType.includes("::voltray::RewardVault<"),
  );
  if (!change || !("objectId" in change))
    throw new Error(`RewardVault not found for ${eventId}`);
  return change.objectId;
}
