import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { TrustWalletAdapter } from "@solana/wallet-adapter-trust";

// Modal styles must be imported once at the app root.
import "@solana/wallet-adapter-react-ui/styles.css";

interface Props {
  children: ReactNode;
}

// Route browser RPC through our `rpc-url` edge function so the Helius API key
// stays server-side. The public Solana RPC (clusterApiUrl) blocks getAccountInfo
// with 403, which broke client-side transfer building.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const RPC_ENDPOINT = `${SUPABASE_URL}/functions/v1/rpc-url`;

// Inject the Supabase anon key on every JSON-RPC request the wallet adapter
// sends to our edge function — the gateway requires `apikey`/`Authorization`.
const rpcFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers ?? {});
  headers.set("apikey", SUPABASE_ANON_KEY);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
  }
  return fetch(input, { ...(init ?? {}), headers });
};

export const WalletContextProvider = ({ children }: Props) => {
  const endpoint = useMemo(() => RPC_ENDPOINT, []);
  const config = useMemo(() => ({ commitment: "confirmed" as const, fetch: rpcFetch }), []);

  // Explicit adapters surface install links for wallets the user doesn't have
  // yet. Wallet Standard wallets (Phantom, Solflare, Backpack, Glow, OKX,
  // Bitget, Magic Eden, Brave, etc.) auto-register on top of this list when
  // installed, so the modal will show every available option.
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new BackpackWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new TrustWalletAdapter(),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

