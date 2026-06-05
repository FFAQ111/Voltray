import { useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { queryEvents, type EventSummary } from "../lib/suiwatt";
import { formatUsdc, shortAddr } from "../lib/format";

export default function EventList({
  onOpen,
}: {
  onOpen: (event: EventSummary) => void;
}) {
  const client = useSuiClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["events"],
    queryFn: () => queryEvents(client),
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
        {data.map((e) => (
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
              <div className="flex items-center gap-1 pt-1 text-sm font-medium text-primary">
                View detail <ArrowRight className="size-4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
