import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
} from "@mysten/dapp-kit";
import { isEnokiWallet } from "@mysten/enoki";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";

const sponsorClient = new SuiClient({ url: getFullnodeUrl("testnet") });

// Build → Shinami-sponsor (via our /api/sponsor proxy) → zkLogin-sign → execute, so the gas is
// paid by Shinami's gas fund and the user holds zero SUI. The proxy holds the secret Shinami key
// and only sponsors this package's register_meter / respond. The Enoki (zkLogin) wallet's
// signTransaction re-serializes but preserves the sponsor's gas data, so the sender signature
// still matches the bytes Shinami returned; we then submit both signatures together.
async function executeSponsored(
  transaction: Transaction,
  sender: string,
  signTransaction: (input: {
    transaction: Transaction;
  }) => Promise<{ signature: string }>,
): Promise<{ digest: string }> {
  const kindBytes = await transaction.build({
    client: sponsorClient,
    onlyTransactionKind: true,
  });
  const res = await fetch("/api/sponsor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionKindBytes: toBase64(kindBytes),
      sender,
    }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Sponsorship failed: ${error}`);
  }
  const { txBytes, signature: sponsorSignature } = await res.json();
  const { signature } = await signTransaction({
    transaction: Transaction.from(fromBase64(txBytes)),
  });
  return sponsorClient.executeTransactionBlock({
    transactionBlock: txBytes,
    signature: [signature, sponsorSignature],
  });
}

// Sponsoring is live for zkLogin/Enoki accounts: their register_meter / respond run through the
// Shinami gas station (zero SUI). Set false to fall back to faucet-funded self-paid gas (e.g. if
// the gas fund is empty). External (browser-extension) wallets always self-pay regardless.
const SPONSORED_GAS_ENABLED: boolean = true;

// Submit a transaction, paying gas the right way for the connected wallet. With sponsoring on,
// zkLogin/Enoki accounts route through the gas station (zero SUI); otherwise (and for external
// wallets) they sign+execute normally. Returns the finalized digest either way. Only ever route
// sponsor-allowlisted actions (register_meter, respond) here — utility actions (create_event,
// reclaim) must keep the plain signAndExecute path.
export function useSubmitTransaction() {
  const account = useCurrentAccount();
  const { currentWallet } = useCurrentWallet();
  const { mutateAsync: signTransaction } = useSignTransaction();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  return async (transaction: Transaction): Promise<{ digest: string }> => {
    if (
      SPONSORED_GAS_ENABLED &&
      account &&
      currentWallet &&
      isEnokiWallet(currentWallet)
    ) {
      return executeSponsored(transaction, account.address, (input) =>
        signTransaction(input),
      );
    }
    return signAndExecute({ transaction });
  };
}
