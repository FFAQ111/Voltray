import { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildRegisterMeter,
  buildRespond,
  buildSettle,
  fetchEvent,
  fetchMeters,
  findVault,
  queryResponded,
  querySettled,
  type EventSummary,
} from "../lib/suiwatt";
import {
  clearValidity,
  formatTime,
  onInvalidEn,
  shortAddr,
  windowStatus,
} from "../lib/format";

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
  const [note, setNote] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["event", event.eventId],
    queryFn: () => fetchEvent(client, event.eventId),
  });
  const vault = useQuery({
    queryKey: ["vault", event.txDigest],
    queryFn: () => findVault(client, event.txDigest),
  });
  const responded = useQuery({
    queryKey: ["responded", event.eventId],
    queryFn: () => queryResponded(client, event.eventId),
  });
  const settled = useQuery({
    queryKey: ["settled", event.eventId],
    queryFn: () => querySettled(client, event.eventId),
  });
  const meters = useQuery({
    queryKey: ["meters", account?.address],
    queryFn: () => fetchMeters(client, account!.address),
    enabled: !!account,
  });

  const refresh = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        ["event", "responded", "settled", "meters"].includes(
          q.queryKey[0] as string,
        ),
    });

  const run = (tx: ReturnType<typeof buildRespond>, ok: string) => {
    setNote(null);
    signAndExecute(
      { transaction: tx },
      {
        onSuccess: () => {
          setNote(ok);
          refresh();
        },
        onError: (e) => setNote(`Failed: ${e.message}`),
      },
    );
  };

  if (detail.isLoading) return <p className="muted">Loading event…</p>;
  if (detail.error || !detail.data)
    return <p className="error">Failed to load event.</p>;

  const ev = detail.data;
  const isUtility = account?.address === ev.utility;
  const status = windowStatus(ev.startTime, ev.endTime);
  const myMeters = meters.data ?? [];
  const respondedList = responded.data ?? [];
  const settledList = settled.data ?? [];

  return (
    <div className="stack">
      <button className="tab" onClick={onBack}>
        ← Back
      </button>
      <h2>Event {shortAddr(ev.id)}</h2>

      <div className="card">
        <div className="row">
          <span className="muted">Status</span>
          <span className={`badge ${status}`}>{status}</span>
        </div>
        <div className="row">
          <span className="muted">Utility</span>
          <span>{shortAddr(ev.utility)}</span>
        </div>
        <div className="row">
          <span className="muted">Reward / unit</span>
          <span>{ev.rewardPerUnit} MIST</span>
        </div>
        <div className="row">
          <span className="muted">Remaining / target</span>
          <span>
            {ev.remainingUnits} / {ev.targetReduction}
          </span>
        </div>
        <div className="row">
          <span className="muted">Window</span>
          <span>
            {formatTime(ev.startTime)} → {formatTime(ev.endTime)}
          </span>
        </div>
      </div>

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
          onRegister={(label) => run(buildRegisterMeter(label), "Meter registered.")}
          onRespond={(meterId) =>
            run(buildRespond(ev.id, meterId), "Response submitted.")
          }
        />
      )}

      {/* Utility (oracle) actions */}
      {isUtility && (
        <SettlePanel
          responders={respondedList}
          settled={settledList}
          disabled={isPending || !vault.data}
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
      )}

      {note && <p className="muted">{note}</p>}

      <section className="stack">
        <h3>Responses ({respondedList.length})</h3>
        {respondedList.length === 0 ? (
          <p className="muted">No responses yet.</p>
        ) : (
          <ul className="list">
            {respondedList.map((r, i) => (
              <li key={i}>
                {shortAddr(r.responder)} · meter {shortAddr(r.meterId)} ·{" "}
                {formatTime(r.timestamp)}
              </li>
            ))}
          </ul>
        )}

        <h3>Settlements ({settledList.length})</h3>
        {settledList.length === 0 ? (
          <p className="muted">No payouts yet.</p>
        ) : (
          <ul className="list">
            {settledList.map((s, i) => (
              <li key={i}>
                {shortAddr(s.responder)} · {s.unitsPaid} units · {s.amount} MIST
              </li>
            ))}
          </ul>
        )}
      </section>
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
  const [meterId, setMeterId] = useState(meters[0]?.id ?? "");
  const selected = meterId || meters[0]?.id || "";
  const done = selected ? alreadyResponded(selected) : false;

  return (
    <div className="card stack">
      <h3>Respond</h3>
      {meters.length === 0 ? (
        <div className="row">
          <input
            placeholder="Meter label, e.g. home-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            className="primary"
            disabled={disabled || !label}
            onClick={() => onRegister(label)}
          >
            Register meter
          </button>
        </div>
      ) : (
        <div className="row">
          <select value={selected} onChange={(e) => setMeterId(e.target.value)}>
            {meters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({shortAddr(m.id)})
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={disabled || status !== "active" || done}
            onClick={() => onRespond(selected)}
          >
            {done
              ? "Already responded"
              : status !== "active"
                ? `Window ${status}`
                : "Respond"}
          </button>
        </div>
      )}
    </div>
  );
}

function SettlePanel({
  responders,
  settled,
  disabled,
  onSettle,
}: {
  responders: { responder: string; meterId: string }[];
  settled: { responder: string }[];
  disabled: boolean;
  onSettle: (responder: string, meterId: string, savedUnits: number) => void;
}) {
  const [units, setUnits] = useState<Record<string, number>>({});

  return (
    <div className="card stack">
      <h3>Settle (utility / oracle)</h3>
      {responders.length === 0 ? (
        <p className="muted">No responders to settle.</p>
      ) : (
        <ul className="list">
          {responders.map((r, i) => {
            const paid = settled.some((s) => s.responder === r.responder);
            return (
              <li key={i} className="row">
                <span>{shortAddr(r.responder)}</span>
                <input
                  type="number"
                  min={1}
                  placeholder="saved units"
                  value={units[r.responder] ?? ""}
                  onInvalid={onInvalidEn}
                  onChange={(e) => {
                    clearValidity(e);
                    setUnits({ ...units, [r.responder]: Number(e.target.value) });
                  }}
                />
                <button
                  className="primary"
                  disabled={disabled || paid || !units[r.responder]}
                  onClick={() =>
                    onSettle(r.responder, r.meterId, units[r.responder])
                  }
                >
                  {paid ? "Settled" : "Settle"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
