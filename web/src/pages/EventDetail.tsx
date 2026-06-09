import { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildReclaim,
  buildRegisterMeter,
  buildRespond,
  buildSettle,
  fetchEvent,
  fetchMeters,
  findVault,
  queryReclaimed,
  queryResponded,
  querySettled,
  type EventSummary,
} from "../lib/suiwatt";
import { formatUsdc, formatTime, shortAddr, windowStatus } from "../lib/format";

const STATUS_BADGE: Record<ReturnType<typeof windowStatus>, string> = {
  active: "border-transparent bg-emerald-500/15 text-emerald-400",
  upcoming: "border-transparent bg-blue-500/15 text-blue-400",
  ended: "border-transparent bg-muted text-muted-foreground",
};

export default function EventDetail({
  event,
  onBack,
}: {
  event: EventSummary;
  onBack: () => void;
}) {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const qc = useQueryClient();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();

  // Poll on-chain state so in-app txns and out-of-band oracle settlements appear within a
  // few seconds without a manual reload (queryEvents indexing lags the tx, so a one-shot
  // refetch on success can still read stale data).
  const POLL_MS = 4000;

  const detail = useQuery({
    queryKey: ["event", event.eventId],
    queryFn: () => fetchEvent(client, event.eventId),
    refetchInterval: POLL_MS,
  });
  const vault = useQuery({
    queryKey: ["vault", event.txDigest],
    queryFn: () => findVault(client, event.txDigest),
  });
  const responded = useQuery({
    queryKey: ["responded", event.eventId],
    queryFn: () => queryResponded(client, event.eventId),
    refetchInterval: POLL_MS,
  });
  const settled = useQuery({
    queryKey: ["settled", event.eventId],
    queryFn: () => querySettled(client, event.eventId),
    refetchInterval: POLL_MS,
  });
  const reclaimed = useQuery({
    queryKey: ["reclaimed", event.eventId],
    queryFn: () => queryReclaimed(client, event.eventId),
    refetchInterval: POLL_MS,
  });
  const meters = useQuery({
    queryKey: ["meters", account?.address],
    queryFn: () => fetchMeters(client, account!.address),
    enabled: !!account,
    refetchInterval: POLL_MS,
  });

  const refresh = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        ["event", "responded", "settled", "reclaimed", "meters"].includes(
          q.queryKey[0] as string,
        ),
    });

  const run = (tx: ReturnType<typeof buildRespond>, ok: string) => {
    signAndExecute(
      { transaction: tx },
      {
        onSuccess: () => {
          toast.success(ok);
          refresh();
        },
        onError: (e) =>
          toast.error("Transaction failed", { description: e.message }),
      },
    );
  };

  if (detail.isLoading)
    return <p className="text-muted-foreground">Loading event…</p>;
  if (detail.error || !detail.data)
    return <p className="text-destructive">Failed to load event.</p>;

  const ev = detail.data;
  const isUtility = account?.address === ev.utility;
  const status = windowStatus(ev.startTime, ev.endTime);
  const myMeters = meters.data ?? [];
  const respondedList = responded.data ?? [];
  const settledList = settled.data ?? [];

  // The UI funds each vault at exactly target * reward (see CreateEvent), so the unspent
  // balance is remainingUnits * rewardPerUnit — until a reclaim empties it. Detecting the
  // Reclaimed event lets us close out Settle/Reclaim instead of leaving buttons live that
  // would only abort (settle) or no-op (reclaim) on-chain and waste the caller's gas.
  const isReclaimed = (reclaimed.data ?? []).length > 0;
  const reclaimableUsdc = isReclaimed ? 0 : ev.remainingUnits * ev.rewardPerUnit;
  const settleClosed = isReclaimed || ev.remainingUnits === 0;
  const settleClosedReason = isReclaimed
    ? "Unspent funds were reclaimed by the utility — settlement is closed."
    : "All target units have been settled — the vault is empty.";

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="size-4" /> Back to events
      </Button>

      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">
          Event {shortAddr(ev.id)}
        </h2>
        <Badge className={STATUS_BADGE[status]}>{status}</Badge>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label="Utility" value={shortAddr(ev.utility)} mono />
          <Row label="Reward / unit" value={formatUsdc(ev.rewardPerUnit)} />
          <Row
            label="Remaining / target"
            value={`${ev.remainingUnits} / ${ev.targetReduction} kWh`}
          />
          <Row
            label="Window"
            value={`${formatTime(ev.startTime)} → ${formatTime(ev.endTime)}`}
          />
        </CardContent>
      </Card>

      {/* User actions — shown for any connected account so a single wallet can
          run the full create → register → respond → settle loop in a demo. */}
      {account && (
        <RespondPanel
          status={status}
          meters={myMeters}
          alreadyResponded={(meterId) =>
            respondedList.some(
              (r) => r.responder === account.address && r.meterId === meterId,
            )
          }
          disabled={isPending}
          onRegister={(label) =>
            run(buildRegisterMeter(label), "Meter registered.")
          }
          onRespond={(meterId) =>
            run(buildRespond(ev.id, meterId), "Response submitted.")
          }
        />
      )}

      {/* Utility (oracle) actions */}
      {isUtility && (
        <>
          <SettlePanel
            responders={respondedList}
            settled={settledList}
            disabled={isPending || !vault.data}
            closed={settleClosed}
            closedReason={settleClosedReason}
            onSettle={(responder, meterId, savedUnits) =>
              run(
                buildSettle({
                  eventId: ev.id,
                  vaultId: vault.data!,
                  responder,
                  meterId,
                  savedUnits,
                }),
                "Settled.",
              )
            }
          />
          <ReclaimPanel
            status={status}
            reclaimed={isReclaimed}
            remainingUnits={ev.remainingUnits}
            reclaimableUsdc={reclaimableUsdc}
            disabled={isPending || !vault.data}
            onReclaim={() =>
              run(buildReclaim(ev.id, vault.data!), "Remaining funds reclaimed.")
            }
          />
        </>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Responses ({respondedList.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {respondedList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No responses yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {respondedList.map((r, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <span className="font-mono">{shortAddr(r.responder)}</span>
                    <span className="text-muted-foreground">
                      {formatTime(r.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Settlements ({settledList.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {settledList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payouts yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {settledList.map((s, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <span className="font-mono">{shortAddr(s.responder)}</span>
                    <span>
                      {s.unitsPaid} kWh ·{" "}
                      <span className="text-emerald-400">
                        {formatUsdc(s.amount)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </div>
  );
}

function RespondPanel({
  status,
  meters,
  alreadyResponded,
  disabled,
  onRegister,
  onRespond,
}: {
  status: ReturnType<typeof windowStatus>;
  meters: { id: string; label: string }[];
  alreadyResponded: (meterId: string) => boolean;
  disabled: boolean;
  onRegister: (label: string) => void;
  onRespond: (meterId: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [meterId, setMeterId] = useState("");
  const selected = meterId || meters[0]?.id || "";
  const done = selected ? alreadyResponded(selected) : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Respond</CardTitle>
      </CardHeader>
      <CardContent>
        {meters.length === 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              placeholder="Meter label, e.g. home-1"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Button disabled={disabled || !label} onClick={() => onRegister(label)}>
              Register meter
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select
              value={selected}
              onValueChange={(v) => v && setMeterId(v)}
              items={meters.map((m) => ({
                value: m.id,
                label: `${m.label} (${shortAddr(m.id)})`,
              }))}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue placeholder="Select a meter" />
              </SelectTrigger>
              <SelectContent>
                {meters.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label} ({shortAddr(m.id)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={disabled || status !== "active" || done}
              onClick={() => onRespond(selected)}
            >
              {done
                ? "Already responded"
                : status !== "active"
                  ? `Window ${status}`
                  : "Respond"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReclaimPanel({
  status,
  reclaimed,
  remainingUnits,
  reclaimableUsdc,
  disabled,
  onReclaim,
}: {
  status: ReturnType<typeof windowStatus>;
  reclaimed: boolean;
  remainingUnits: number;
  reclaimableUsdc: number;
  disabled: boolean;
  onReclaim: () => void;
}) {
  const ended = status === "ended";
  // Only enable when the window is over AND there is an unspent balance not yet pulled —
  // otherwise the on-chain call either aborts or no-ops while still costing gas.
  let label = "Available after window ends";
  let enabled = false;
  if (ended && reclaimed) label = "Funds reclaimed";
  else if (ended && remainingUnits === 0) label = "Nothing to reclaim";
  else if (ended) {
    label = `Reclaim ${formatUsdc(reclaimableUsdc)}`;
    enabled = true;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reclaim unspent funds</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {reclaimed
            ? "The unspent vault balance has been returned to the utility."
            : "After the window closes, return the vault's unspent balance to the utility."}
        </p>
        <Button
          variant="secondary"
          disabled={disabled || !enabled}
          onClick={onReclaim}
        >
          {label}
        </Button>
      </CardContent>
    </Card>
  );
}

function SettlePanel({
  responders,
  settled,
  disabled,
  closed,
  closedReason,
  onSettle,
}: {
  responders: { responder: string; meterId: string }[];
  settled: { responder: string }[];
  disabled: boolean;
  closed: boolean;
  closedReason: string;
  onSettle: (responder: string, meterId: string, savedUnits: number) => void;
}) {
  const [units, setUnits] = useState<Record<string, number>>({});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settle (utility / oracle)</CardTitle>
      </CardHeader>
      <CardContent>
        {responders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No responders to settle.
          </p>
        ) : (
          <>
          {closed && (
            <p className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {closedReason}
            </p>
          )}
          <ul className="space-y-3">
            {responders.map((r, i) => {
              const paid = settled.some((s) => s.responder === r.responder);
              return (
                <li key={i}>
                  {i > 0 && <Separator className="mb-3" />}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="flex-1 font-mono text-sm">
                      {shortAddr(r.responder)}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      placeholder="saved kWh"
                      className="sm:w-32"
                      value={units[r.responder] ?? ""}
                      onChange={(e) =>
                        setUnits({
                          ...units,
                          [r.responder]: Number(e.target.value),
                        })
                      }
                    />
                    <Button
                      disabled={disabled || paid || !units[r.responder] || closed}
                      onClick={() =>
                        onSettle(r.responder, r.meterId, units[r.responder])
                      }
                    >
                      {paid ? "Settled" : "Settle"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
