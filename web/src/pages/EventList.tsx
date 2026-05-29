import { useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { queryEvents, type EventSummary } from "../lib/suiwatt";
import { shortAddr } from "../lib/format";

export default function EventList({
  onOpen,
}: {
  onOpen: (event: EventSummary) => void;
}) {
  const client = useSuiClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["events"],
    queryFn: () => queryEvents(client),
  });

  if (isLoading) return <p className="muted">Loading events…</p>;
  if (error) return <p className="error">Failed to load events.</p>;
  if (!data || data.length === 0)
    return <p className="muted">No DR events yet. Create one to get started.</p>;

  return (
    <div className="stack">
      <h2>DR Events</h2>
      <div className="grid">
        {data.map((e) => (
          <button key={e.eventId} className="card" onClick={() => onOpen(e)}>
            <div className="card-title">Event {shortAddr(e.eventId)}</div>
            <div className="row">
              <span className="muted">Utility</span>
              <span>{shortAddr(e.utility)}</span>
            </div>
            <div className="row">
              <span className="muted">Reward / unit</span>
              <span>{e.rewardPerUnit} MIST</span>
            </div>
            <div className="link">View detail →</div>
          </button>
        ))}
      </div>
    </div>
  );
}
