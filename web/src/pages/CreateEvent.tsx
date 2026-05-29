import { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildCreateEvent } from "../lib/suiwatt";
import { formatSui } from "../lib/format";

export default function CreateEvent({ onCreated }: { onCreated: () => void }) {
  const account = useCurrentAccount();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [rewardPerUnit, setRewardPerUnit] = useState(1_000_000);
  const [targetReduction, setTargetReduction] = useState(100);
  const [durationMin, setDurationMin] = useState(60);

  // Vault must cover the full reward cap, so funding is derived, not entered.
  const funding = rewardPerUnit * targetReduction;

  const submit = () => {
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
          toast.success("DR event created", {
            description: `Vault funded with ${formatSui(funding)}.`,
          });
          onCreated();
        },
        onError: (e) => toast.error("Create failed", { description: e.message }),
      },
    );
  };

  if (!account)
    return (
      <p className="text-muted-foreground">
        Connect a wallet to create an event.
      </p>
    );

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Create DR Event</CardTitle>
          <CardDescription>
            One PTB splits the funding off your gas coin and funds the reward
            vault atomically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="reward">Reward per unit (MIST / kWh saved)</Label>
            <Input
              id="reward"
              type="number"
              min={1}
              value={rewardPerUnit}
              onChange={(e) => setRewardPerUnit(Number(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="target">Target reduction (kWh)</Label>
            <Input
              id="target"
              type="number"
              min={1}
              value={targetReduction}
              onChange={(e) => setTargetReduction(Number(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration">Duration (minutes from now)</Label>
            <Input
              id="duration"
              type="number"
              min={1}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Vault funding (auto)</span>
            <span className="font-medium">
              {formatSui(funding)}
              <span className="ml-1 text-xs text-muted-foreground">
                ({funding.toLocaleString()} MIST)
              </span>
            </span>
          </div>

          <Button
            className="w-full"
            disabled={isPending}
            onClick={submit}
          >
            {isPending ? "Submitting…" : "Create (single PTB)"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
