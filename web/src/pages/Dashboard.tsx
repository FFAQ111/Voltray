import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { Coins, Gauge, Power, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { fetchMeters, queryEvents, querySettled } from "../lib/suiwatt";
import { formatSui } from "../lib/format";

// Reduced-scope Dashboard: a personal summary derived off-chain by scanning
// Settled events (see docs/ARCHITECTURE.md §5) — no aggregate state on-chain.
export default function Dashboard() {
  const client = useSuiClient();
  const account = useCurrentAccount();

  // Poll so a settlement (including one run by the oracle out-of-band) updates the stats
  // within a few seconds without a manual reload.
  const POLL_MS = 4000;

  const settled = useQuery({
    queryKey: ["settled"],
    queryFn: () => querySettled(client),
    refetchInterval: POLL_MS,
  });
  const events = useQuery({
    queryKey: ["events"],
    queryFn: () => queryEvents(client),
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

  const mine = (settled.data ?? []).filter((s) => s.responder === account.address);
  const earned = mine.reduce((sum, s) => sum + s.amount, 0);
  const created = (events.data ?? []).filter(
    (e) => e.utility === account.address,
  ).length;

  const stats = [
    {
      label: "Rewards earned",
      value: formatSui(earned),
      sub: `${earned.toLocaleString()} MIST`,
      icon: Coins,
    },
    {
      label: "Rewarded responses",
      value: mine.length.toString(),
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
    </div>
  );
}
