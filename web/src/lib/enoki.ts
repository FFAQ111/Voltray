import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { registerEnokiWallets } from "@mysten/enoki";

// The Enoki public API key and Google OAuth client ID are public, client-side identifiers
// (shipped in the frontend by design — the *private* Enoki key and any secrets never live here).
// This registers zkLogin as a "Sign in with Google" wallet inside the existing dapp-kit
// ConnectButton: the user gets a derived Sui address with no seed phrase and no extension.
// NOTE: registerEnokiWallets does NOT sponsor gas — zero-SUI sponsorship is a separate
// EnokiClient flow layered on top (see TODO in the respond/register paths).
export const ENOKI_API_KEY = "enoki_public_459f193f0955f3043c64c655f7928fa1";
const GOOGLE_CLIENT_ID =
  "514360842030-vj9ikm77va7i15d1bklf3oj0o5j8ea6p.apps.googleusercontent.com";

export function registerVoltrayEnokiWallets() {
  const client = new SuiClient({ url: getFullnodeUrl("testnet") });
  registerEnokiWallets({
    apiKey: ENOKI_API_KEY,
    providers: {
      google: {
        clientId: GOOGLE_CLIENT_ID,
        // OAuth returns to wherever login started — localhost:5173 in dev, the Vercel URL in
        // prod. Both are registered in the Google client's authorized origins + redirect URIs.
        redirectUrl: window.location.origin,
      },
    },
    client,
    network: "testnet",
  });
}
