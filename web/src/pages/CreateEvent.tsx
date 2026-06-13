import { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
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
import { buildCreateEvent, type EventSummary } from "../lib/voltray";
import { formatUsdc } from "../lib/format";

export default function CreateEvent({
  onCreated,
}: {
  onCreated: (event: EventSummary | null) => void;
}) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();
  // Spans the whole flow (sign → execute → confirmation read → navigate), unlike the hook's
  // isPending which clears after execute and leaves the button live during waitForTransaction.
  const [busy, setBusy] = useState(false);

  // µUSDC per kWh (6 decimals): 100_000 = 0.1 USDC/kWh. With target 100 the vault funds at
  // 10 USDC, so one Circle faucet claim (20 USDC / 2h) covers a demo event.
  const [rewardPerUnit, setRewardPerUnit] = useState(100_000);
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
    setBusy(true);
    signAndExecute(
      { transaction: tx },
      {
        onSuccess: async ({ digest }) => {
          toast.success("DR event created", {
            description: `Vault funded with ${formatUsdc(funding)}.`,
          });
          // Open the new event straight from the tx's created object (a fresh getObject
          // read), instead of waiting for the laggy event log to index the EventCreated.
          // The component unmounts on navigation, so busy is released by the view change;
          // if this follow-up read fails the event still exists, so fall back to the list.
          try {
            const res = await client.waitForTransaction({
              digest,
              options: { showObjectChanges: true },
            });
            const created = res.objectChanges?.find(
              (c) =>
                c.type === "created" &&
                c.objectType.endsWith("::voltray::DREvent"),
            );
            onCreated(
              created && "objectId" in created
                ? {
                    eventId: created.objectId,
                    utility: account!.address,
                    rewardPerUnit,
                    txDigest: digest,
                  }
                : null,
            );
          } catch {
            onCreated(null);
          }
        },
        onError: (e) => {
          toast.error("Create failed", { description: e.message });
          setBusy(false);
        },
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
            Pulls USDC from your wallet and funds the reward vault in one
            atomic transaction. Get testnet USDC from faucet.circle.com.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="reward">Reward per unit (µUSDC / kWh saved)</Label>
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
              {formatUsdc(funding)}
              <span className="ml-1 text-xs text-muted-foreground">
                ({funding.toLocaleString()} µUSDC)
              </span>
            </span>
          </div>

          <Button
            className="w-full"
            disabled={busy}
            onClick={submit}
          >
            {busy && <Loader2Icon className="size-4 animate-spin" />}
            {busy ? "Submitting…" : "Create & fund event"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
