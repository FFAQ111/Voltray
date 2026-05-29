import { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { buildCreateEvent } from "../lib/suiwatt";
import { clearValidity, onInvalidEn } from "../lib/format";

export default function CreateEvent({ onCreated }: { onCreated: () => void }) {
  const account = useCurrentAccount();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [rewardPerUnit, setRewardPerUnit] = useState(1_000_000);
  const [targetReduction, setTargetReduction] = useState(100);
  const [durationMin, setDurationMin] = useState(60);
  const [status, setStatus] = useState<string | null>(null);

  // Vault must cover the full reward cap, so funding is derived, not entered.
  const funding = rewardPerUnit * targetReduction;

  const submit = () => {
    setStatus(null);
    const start = Date.now();
    const tx = buildCreateEvent({
      funding,
      rewardPerUnit,
      targetReduction,
      startTime: start,
      endTime: start + durationMin * 60_000,
    });
    signAndExecute(
      { transaction: tx },
      {
        onSuccess: () => {
          setStatus("Event created.");
          onCreated();
        },
        onError: (e) => setStatus(`Failed: ${e.message}`),
      },
    );
  };

  if (!account)
    return <p className="muted">Connect a wallet to create an event.</p>;

  return (
    <div className="stack form">
      <h2>Create DR Event</h2>

      <label>
        Reward per unit (MIST)
        <input
          type="number"
          min={1}
          value={rewardPerUnit}
          onInvalid={onInvalidEn}
          onChange={(e) => {
            clearValidity(e);
            setRewardPerUnit(Number(e.target.value));
          }}
        />
      </label>

      <label>
        Target reduction (units)
        <input
          type="number"
          min={1}
          value={targetReduction}
          onInvalid={onInvalidEn}
          onChange={(e) => {
            clearValidity(e);
            setTargetReduction(Number(e.target.value));
          }}
        />
      </label>

      <label>
        Duration (minutes from now)
        <input
          type="number"
          min={1}
          value={durationMin}
          onInvalid={onInvalidEn}
          onChange={(e) => {
            clearValidity(e);
            setDurationMin(Number(e.target.value));
          }}
        />
      </label>

      <div className="row">
        <span className="muted">Vault funding (auto)</span>
        <span>{funding.toLocaleString()} MIST</span>
      </div>

      <button className="primary" disabled={isPending} onClick={submit}>
        {isPending ? "Submitting…" : "Create (single PTB)"}
      </button>
      <p className="hint">
        One PTB splits {funding.toLocaleString()} MIST off your gas coin and funds
        the reward vault atomically.
      </p>
      {status && <p className="muted">{status}</p>}
    </div>
  );
}
