// Domain helpers over the Voltray package: event-log queries, object reads, and
// transaction builders. Aggregates are derived here by scanning Sui events
// (see docs/ARCHITECTURE.md §5) — the contract stores no accumulating state.
import type { SuiClient } from "@mysten/sui/client";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { fromHex } from "@mysten/sui/utils";
import { CLOCK_ID, DEMO_CHARGER_PUBKEY, USDC_TYPE, fq } from "./config";

// ===== Parsed shapes =====

export interface EventSummary {
  eventId: string;
  utility: string;
  rewardPerUnit: number;
  txDigest: string; // the publish tx; used to resolve the matching RewardVault
}

// EventSummary plus the per-event fields the list needs for status badges. EventCreated does
// not emit the window times, so these come from reading the DREvent objects (see
// queryEventsDetailed).
export interface EventListItem extends EventSummary {
  startTime: number;
  endTime: number;
  remainingUnits: number;
  reclaimed: boolean;
}

export type ActivityKind = "funded" | "responded" | "earned";

export interface Activity {
  kind: ActivityKind;
  eventId: string;
  timestamp: number;
  amount?: number; // µUSDC, for "earned"
  rewardPerUnit?: number; // µUSDC, for "funded"
}

export interface DREventData {
  id: string;
  utility: string;
  rewardPerUnit: number;
  targetReduction: number;
  remainingUnits: number;
  startTime: number;
  endTime: number;
}

export interface Responded {
  eventId: string;
  meterId: string;
  responder: string;
  timestamp: number;
}

export interface Settled {
  eventId: string;
  meterId: string;
  responder: string;
  amount: number;
  unitsPaid: number;
}

export interface Reclaimed {
  eventId: string;
  amount: number;
}

export interface Meter {
  id: string;
  label: string;
}

// ===== Queries =====

export async function queryEvents(client: SuiClient): Promise<EventSummary[]> {
  const res = await client.queryEvents({
    query: { MoveEventType: fq("EventCreated") },
    order: "descending",
    limit: 50,
  });
  return res.data.map((e) => {
    const j = e.parsedJson as Record<string, string>;
    return {
      eventId: j.event_id,
      utility: j.utility,
      rewardPerUnit: Number(j.reward_per_unit),
      txDigest: e.id.txDigest,
    };
  });
}

// EventList needs window times + remaining + reclaim status, which EventCreated doesn't carry.
// Batch-read the DREvent objects and fold in a single Reclaimed-event query. Frontend-only —
// no contract change.
export async function queryEventsDetailed(
  client: SuiClient,
): Promise<EventListItem[]> {
  const summaries = await queryEvents(client);
  if (summaries.length === 0) return [];

  const reclaimedRes = await client.queryEvents({
    query: { MoveEventType: fq("Reclaimed") },
    order: "descending",
    limit: 50,
  });
  const reclaimedIds = new Set(
    reclaimedRes.data.map(
      (e) => (e.parsedJson as Record<string, string>).event_id,
    ),
  );

  const objs = await client.multiGetObjects({
    ids: summaries.map((s) => s.eventId),
    options: { showContent: true },
  });
  const byId = new Map<
    string,
    { startTime: number; endTime: number; remainingUnits: number }
  >();
  for (const o of objs) {
    const content = o.data?.content;
    if (!content || content.dataType !== "moveObject") continue;
    const f = content.fields as Record<string, string>;
    byId.set(o.data!.objectId, {
      startTime: Number(f.start_time),
      endTime: Number(f.end_time),
      remainingUnits: Number(f.remaining_units),
    });
  }

  return summaries.map((s) => ({
    ...s,
    startTime: byId.get(s.eventId)?.startTime ?? 0,
    endTime: byId.get(s.eventId)?.endTime ?? 0,
    remainingUnits: byId.get(s.eventId)?.remainingUnits ?? 0,
    reclaimed: reclaimedIds.has(s.eventId),
  }));
}

// One unified, time-sorted activity feed for the connected address: events it funded, its
// responses, and its payouts. Assembled from the three event streams (the contract keeps no
// per-account index by design — see CLAUDE.md critical rule).
export async function queryMyActivity(
  client: SuiClient,
  address: string,
): Promise<Activity[]> {
  const ev = (name: string) =>
    client.queryEvents({
      query: { MoveEventType: fq(name) },
      order: "descending",
      limit: 50,
    });
  const [created, responded, settled] = await Promise.all([
    ev("EventCreated"),
    ev("MeterResponded"),
    ev("Settled"),
  ]);

  const out: Activity[] = [];
  for (const e of created.data) {
    const j = e.parsedJson as Record<string, string>;
    if (j.utility !== address) continue;
    out.push({
      kind: "funded",
      eventId: j.event_id,
      timestamp: Number(e.timestampMs ?? 0),
      rewardPerUnit: Number(j.reward_per_unit),
    });
  }
  for (const e of responded.data) {
    const j = e.parsedJson as Record<string, string>;
    if (j.responder !== address) continue;
    out.push({
      kind: "responded",
      eventId: j.event_id,
      timestamp: Number(j.timestamp),
    });
  }
  for (const e of settled.data) {
    const j = e.parsedJson as Record<string, string>;
    if (j.responder !== address) continue;
    out.push({
      kind: "earned",
      eventId: j.event_id,
      timestamp: Number(e.timestampMs ?? 0),
      amount: Number(j.amount),
    });
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}

export async function fetchEvent(
  client: SuiClient,
  id: string,
): Promise<DREventData> {
  const obj = await client.getObject({ id, options: { showContent: true } });
  const content = obj.data?.content;
  if (!content || content.dataType !== "moveObject")
    throw new Error("DREvent not found");
  const f = content.fields as Record<string, string>;
  return {
    id,
    utility: f.utility,
    rewardPerUnit: Number(f.reward_per_unit),
    targetReduction: Number(f.target_reduction),
    remainingUnits: Number(f.remaining_units),
    startTime: Number(f.start_time),
    endTime: Number(f.end_time),
  };
}

// The RewardVault is created in the same tx as its DREvent, so resolve it from
// that tx's object changes rather than needing an indexer.
export async function findVault(
  client: SuiClient,
  txDigest: string,
): Promise<string | null> {
  const tx = await client.getTransactionBlock({
    digest: txDigest,
    options: { showObjectChanges: true },
  });
  const change = tx.objectChanges?.find(
    // RewardVault is generic, so its type ends with `<...::usdc::USDC>` — match the prefix.
    (c) => c.type === "created" && c.objectType.includes("::voltray::RewardVault<"),
  );
  return change && "objectId" in change ? change.objectId : null;
}

export async function querySettled(
  client: SuiClient,
  eventId?: string,
): Promise<Settled[]> {
  const res = await client.queryEvents({
    query: { MoveEventType: fq("Settled") },
    order: "descending",
    limit: 50,
  });
  const all = res.data.map((e) => {
    const j = e.parsedJson as Record<string, string>;
    return {
      eventId: j.event_id,
      meterId: j.meter_id,
      responder: j.responder,
      amount: Number(j.amount),
      unitsPaid: Number(j.units_paid),
    };
  });
  return eventId ? all.filter((s) => s.eventId === eventId) : all;
}

export async function queryReclaimed(
  client: SuiClient,
  eventId: string,
): Promise<Reclaimed[]> {
  const res = await client.queryEvents({
    query: { MoveEventType: fq("Reclaimed") },
    order: "descending",
    limit: 50,
  });
  return res.data
    .map((e) => {
      const j = e.parsedJson as Record<string, string>;
      return { eventId: j.event_id, amount: Number(j.amount) };
    })
    .filter((r) => r.eventId === eventId);
}

export async function queryResponded(
  client: SuiClient,
  eventId: string,
): Promise<Responded[]> {
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

export async function fetchMeters(
  client: SuiClient,
  owner: string,
): Promise<Meter[]> {
  const res = await client.getOwnedObjects({
    owner,
    filter: { StructType: fq("SmartMeter") },
    options: { showContent: true },
  });
  return res.data.flatMap((o) => {
    const content = o.data?.content;
    if (!content || content.dataType !== "moveObject") return [];
    const f = content.fields as Record<string, string>;
    return [{ id: o.data!.objectId, label: f.label }];
  });
}

// ===== Transaction builders =====

// PTB: fund the vault from the creator's USDC coins and pass it straight into create_event
// in one transaction. coinWithBalance auto-selects/merges/splits the exact USDC amount; the
// contract is generic over the coin, so USDC is supplied as the type argument.
export function buildCreateEvent(args: {
  funding: number;
  rewardPerUnit: number;
  targetReduction: number;
  startTime: number;
  endTime: number;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: fq("create_event"),
    typeArguments: [USDC_TYPE],
    arguments: [
      coinWithBalance({ type: USDC_TYPE, balance: BigInt(args.funding) }),
      tx.pure.u64(args.rewardPerUnit),
      tx.pure.u64(args.targetReduction),
      tx.pure.u64(args.startTime),
      tx.pure.u64(args.endTime),
      // Authorise the demo charger to sign this event's settlement readings (TRUST.md §5.1).
      tx.pure.vector("u8", Array.from(fromHex(DEMO_CHARGER_PUBKEY))),
    ],
  });
  return tx;
}

export function buildRegisterMeter(label: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: fq("register_meter"), arguments: [tx.pure.string(label)] });
  return tx;
}

export function buildRespond(eventId: string, meterId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: fq("respond"),
    arguments: [tx.object(eventId), tx.object(meterId), tx.object(CLOCK_ID)],
  });
  return tx;
}

// Settlement is performed by the oracle, not the web app: settle() now requires an ed25519
// signature from the event's authorised charger over the reading, which the oracle produces
// from the (simulated) OCPP session (oracle/src/run.ts, docs/TRUST.md §5.1). There is therefore
// no in-browser settle builder.

// Utility recovers the unspent vault balance once the window has closed (reclaim_remaining).
export function buildReclaim(eventId: string, vaultId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: fq("reclaim_remaining"),
    typeArguments: [USDC_TYPE],
    arguments: [tx.object(eventId), tx.object(vaultId), tx.object(CLOCK_ID)],
  });
  return tx;
}
