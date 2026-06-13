import { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Gauge, History, Loader2Icon, Power, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildRegisterMeter,
  fetchMeters,
  queryMyActivity,
  type ActivityKind,
  type Meter,
} from "../lib/voltray";
import { formatUsdc, formatTime, shortAddr } from "../lib/format";

// Reduced-scope Dashboard: a personal summary derived off-chain by scanning the event log
// (see docs/ARCHITECTURE.md §5) — no aggregate state on-chain. Stats and the activity feed
// share one queryMyActivity scan so the page issues a single set of event queries.
const POLL_MS = 4000;
const PAGE = 10;

const KIND_META: Record<ActivityKind, { label: string; cls: string }> = {
  funded: {
    label: "Funded",
    cls: "border-transparent bg-amber-500/15 text-amber-400",
  },
  responded: {
    label: "Responded",
    cls: "border-transparent bg-blue-500/15 text-blue-400",
  },
  earned: {
    label: "Earned",
    cls: "border-transparent bg-emerald-500/15 text-emerald-400",
  },
};

export default function Dashboard() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const [showAll, setShowAll] = useState(false);

  const activity = useQuery({
    queryKey: ["activity", account?.address],
    queryFn: () => queryMyActivity(client, account!.address),
    enabled: !!account,
    refetchInterval: POLL_MS,
  });
  const meters = useQuery({
    queryKey: ["meters", account?.address],
    queryFn: () => fetchMeters(client, account!.address),
    enabled: !!account,
    refetchInterval: POLL_MS,
  });

  if (!account)
    return (
      <p className="text-muted-foreground">
        Connect a wallet to see your dashboard.
      </p>
    );

  const acts = activity.data ?? [];
  const earnedActs = acts.filter((a) => a.kind === "earned");
  const earned = earnedActs.reduce((sum, a) => sum + (a.amount ?? 0), 0);
  const created = acts.filter((a) => a.kind === "funded").length;

  const stats = [
    {
      label: "Rewards earned",
      value: formatUsdc(earned),
      sub: `${earned.toLocaleString()} µUSDC`,
      icon: Coins,
    },
    {
      label: "Rewarded responses",
      value: earnedActs.length.toString(),
      sub: "settled payouts",
      icon: Zap,
    },
    {
      label: "Registered meters",
      value: (meters.data?.length ?? 0).toString(),
      sub: "smart meters",
      icon: Gauge,
    },
    {
      label: "Events created",
      value: created.toString(),
      sub: "as a utility",
      icon: Power,
    },
  ];

  const shown = showAll ? acts : acts.slice(0, PAGE);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Your Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Personal demand-response activity, derived from on-chain events.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-sm">{s.label}</span>
                <s.icon className="size-4" />
              </div>
              <div className="text-2xl font-semibold tracking-tight text-foreground">
                {s.value}
              </div>
              <div className="text-xs text-muted-foreground">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <MeterManager meters={meters.data ?? []} address={account.address} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" /> Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {acts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No activity yet. Fund, respond to, or get settled on an event.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {shown.map((a, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <div className="flex items-center gap-2.5">
                      <Badge className={KIND_META[a.kind].cls}>
                        {KIND_META[a.kind].label}
                      </Badge>
                      <span className="font-mono text-muted-foreground">
                        {shortAddr(a.eventId)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {a.kind === "earned" && (
                        <span className="text-emerald-400">
                          {formatUsdc(a.amount ?? 0)}
                        </span>
                      )}
                      {a.kind === "funded" && (
                        <span className="text-muted-foreground">
                          {formatUsdc(a.rewardPerUnit ?? 0)} / unit
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {a.timestamp ? formatTime(a.timestamp) : "—"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {acts.length > PAGE && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll ? "Show less" : `Show all ${acts.length}`}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Register and list the connected wallet's smart meters. Meters live on-chain as owned
// objects (fetchMeters), so registration is a one-time setup here; events only select an
// existing meter to respond with.
function MeterManager({
  meters,
  address,
}: {
  meters: Meter[];
  address: string;
}) {
  const client = useSuiClient();
  const qc = useQueryClient();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const register = () => {
    setBusy(true);
    signAndExecute(
      { transaction: buildRegisterMeter(label) },
      {
        onSuccess: async ({ digest }) => {
          await client.waitForTransaction({ digest });
          toast.success("Meter registered.");
          setLabel("");
          await qc.invalidateQueries({ queryKey: ["meters", address] });
          setBusy(false);
        },
        onError: (e) => {
          toast.error("Registration failed", { description: e.message });
          setBusy(false);
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4" /> Smart meters
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {meters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No meters yet. Register one to start responding to events.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {meters.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span>{m.label}</span>
                <span className="font-mono text-muted-foreground">
                  {shortAddr(m.id)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            placeholder="Meter label, e.g. home-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button disabled={busy || !label} onClick={register}>
            {busy && <Loader2Icon className="size-4 animate-spin" />}
            Register meter
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
