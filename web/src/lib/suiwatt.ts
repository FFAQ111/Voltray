// Domain helpers over the SuiWatt package: event-log queries, object reads, and
// transaction builders. Aggregates are derived here by scanning Sui events
// (see docs/ARCHITECTURE.md §5) — the contract stores no accumulating state.
import type { SuiClient } from "@mysten/sui/client";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { CLOCK_ID, USDC_TYPE, fq } from "./config";

// ===== Parsed shapes =====

export interface EventSummary {
  eventId: string;
  utility: string;
  rewardPerUnit: number;
  txDigest: string; // the publish tx; used to resolve the matching RewardVault
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
    (c) => c.type === "created" && c.objectType.includes("::suiwatt::RewardVault<"),
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

export function buildSettle(args: {
  eventId: string;
  vaultId: string;
  responder: string;
  meterId: string;
  savedUnits: number;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: fq("settle"),
    typeArguments: [USDC_TYPE],
    arguments: [
      tx.object(args.eventId),
      tx.object(args.vaultId),
      tx.pure.address(args.responder),
      tx.pure.id(args.meterId),
      tx.pure.u64(args.savedUnits),
    ],
  });
  return tx;
}

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
