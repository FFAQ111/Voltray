import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
} from "@mysten/dapp-kit";
import { EnokiClient, isEnokiWallet } from "@mysten/enoki";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { ENOKI_API_KEY } from "./enoki";

const enokiClient = new EnokiClient({ apiKey: ENOKI_API_KEY });
const sponsorClient = new SuiClient({ url: getFullnodeUrl("testnet") });

// Build → Enoki-sponsor → zkLogin-sign → Enoki-execute, so the gas is paid by the Enoki gas
// station and the user holds zero SUI. Only works for move-call targets allowlisted in the Enoki
// project (register_meter, respond); anything else is rejected by Enoki. The Enoki wallet's
// signTransaction re-serializes but preserves the already-set sponsor gas, so the signature
// still matches the digest Enoki returned.
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
  const { bytes, digest } = await enokiClient.createSponsoredTransaction({
    network: "testnet",
    transactionKindBytes: toBase64(kindBytes),
    sender,
  });
  const { signature } = await signTransaction({
    transaction: Transaction.from(fromBase64(bytes)),
  });
  return enokiClient.executeSponsoredTransaction({ digest, signature });
}

// Submit a transaction, paying gas the right way for the connected wallet: zkLogin/Enoki accounts
// route through the gas station (zero SUI); external wallets sign+execute normally. Returns the
// finalized digest either way. Only use this for sponsor-allowlisted actions (register_meter,
// respond) — utility actions (create_event, reclaim) must keep the plain signAndExecute path.
export function useSubmitTransaction() {
  const account = useCurrentAccount();
  const { currentWallet } = useCurrentWallet();
  const { mutateAsync: signTransaction } = useSignTransaction();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  return async (transaction: Transaction): Promise<{ digest: string }> => {
    if (account && currentWallet && isEnokiWallet(currentWallet)) {
      return executeSponsored(transaction, account.address, (input) =>
        signTransaction(input),
      );
    }
    return signAndExecute({ transaction });
  };
}
