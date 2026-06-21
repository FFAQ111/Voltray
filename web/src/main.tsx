import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from "@mysten/dapp-kit";
import { getFullnodeUrl } from "@mysten/sui/client";
import "@fontsource-variable/geist/index.css";
import "@mysten/dapp-kit/dist/index.css";
import App from "./App.tsx";
import { Toaster } from "./components/ui/sonner";
import "./index.css";
import { registerVoltrayEnokiWallets } from "./lib/enoki";

const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl("testnet") },
});
const queryClient = new QueryClient();

// Register Enoki zkLogin wallets ("Sign in with Google") into dapp-kit's wallet list, so they
// show up in the existing ConnectButton alongside external wallets.
registerVoltrayEnokiWallets();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider autoConnect>
          <App />
          <Toaster position="bottom-right" />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
);
