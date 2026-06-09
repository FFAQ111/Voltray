import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { queryEventsDetailed, type EventListItem } from "../lib/suiwatt";
import { formatUsdc, shortAddr, windowStatus } from "../lib/format";

const STATUS_BADGE: Record<ReturnType<typeof windowStatus>, string> = {
  active: "border-transparent bg-emerald-500/15 text-emerald-400",
  upcoming: "border-transparent bg-blue-500/15 text-blue-400",
  ended: "border-transparent bg-muted text-muted-foreground",
};

// Rough "ends in / starts in" hint, recomputed each poll — no separate ticking timer needed.
function rel(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function timeHint(
  e: EventListItem,
  status: ReturnType<typeof windowStatus>,
): string {
  const now = Date.now();
  if (status === "upcoming") return `Starts in ${rel(e.startTime - now)}`;
  if (status === "active") return `Ends in ${rel(e.endTime - now)}`;
  return "Window closed";
}

export default function EventList({
  onOpen,
}: {
  onOpen: (event: EventListItem) => void;
}) {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const { data, isLoading, error } = useQuery({
    queryKey: ["events-detailed"],
    queryFn: () => queryEventsDetailed(client),
    refetchInterval: 4000, // keep the list live without a manual reload
  });

  if (isLoading)
    return <p className="text-muted-foreground">Loading events…</p>;
  if (error)
    return <p className="text-destructive">Failed to load events.</p>;
  if (!data || data.length === 0)
    return (
      <p className="text-muted-foreground">
        No DR events yet. Create one to get started.
      </p>
    );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">DR Events</h2>
        <p className="text-sm text-muted-foreground">
          Open an event to register a meter, respond, or settle payouts.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((e) => {
          const status = windowStatus(e.startTime, e.endTime);
          const mine = account?.address === e.utility;
          // Creator-only lifecycle badge, shown once the window has closed.
          const ownerBadge =
            mine && status === "ended"
              ? e.reclaimed
                ? { text: "Reclaimed", cls: STATUS_BADGE.ended }
                : e.remainingUnits > 0
                  ? {
                      text: "Reclaimable",
                      cls: "border-transparent bg-amber-500/15 text-amber-400",
                    }
                  : null
              : null;
          return (
            <Card
              key={e.eventId}
              onClick={() => onOpen(e)}
              className="cursor-pointer transition-colors hover:bg-muted/40"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="size-4 text-primary" />
                  Event {shortAddr(e.eventId)}
                </CardTitle>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge className={STATUS_BADGE[status]}>{status}</Badge>
                  {ownerBadge && (
                    <Badge className={ownerBadge.cls}>{ownerBadge.text}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Utility</span>
                  <span className="font-mono">{shortAddr(e.utility)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Reward / unit</span>
                  <span>{formatUsdc(e.rewardPerUnit)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {status === "ended" ? "Status" : "Time"}
                  </span>
                  <span>{timeHint(e, status)}</span>
                </div>
                <div className="flex items-center gap-1 pt-1 text-sm font-medium text-primary">
                  View detail <ArrowRight className="size-4" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
