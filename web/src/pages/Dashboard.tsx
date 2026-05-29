import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { fetchMeters, queryEvents, querySettled } from "../lib/suiwatt";

// Reduced-scope Dashboard: a personal summary derived off-chain by scanning
// Settled events (see docs/ARCHITECTURE.md §5) — no aggregate state on-chain.
export default function Dashboard() {
  const client = useSuiClient();
  const account = useCurrentAccount();

  const settled = useQuery({
    queryKey: ["settled"],
    queryFn: () => querySettled(client),
  });
  const events = useQuery({
    queryKey: ["events"],
    queryFn: () => queryEvents(client),
  });
  const meters = useQuery({
    queryKey: ["meters", account?.address],
    queryFn: () => fetchMeters(client, account!.address),
    enabled: !!account,
  });

  if (!account)
    return <p className="muted">Connect a wallet to see your dashboard.</p>;

  const mine = (settled.data ?? []).filter((s) => s.responder === account.address);
  const earned = mine.reduce((sum, s) => sum + s.amount, 0);
  const created = (events.data ?? []).filter(
    (e) => e.utility === account.address,
  ).length;

  return (
    <div className="stack">
      <h2>Your Dashboard</h2>
      <div className="grid">
        <div className="card stat">
          <div className="stat-value">{earned.toLocaleString()}</div>
          <div className="muted">MIST earned</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{mine.length}</div>
          <div className="muted">Rewarded responses</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{meters.data?.length ?? 0}</div>
          <div className="muted">Registered meters</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{created}</div>
          <div className="muted">Events you created</div>
        </div>
      </div>
    </div>
  );
}
