import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";

// Default wallet adapters list is empty — Phantom, Solflare, Backpack
// auto-register via the Wallet Standard browser API.
import "@solana/wallet-adapter-react-ui/styles.css";

interface Props {
  children: ReactNode;
}

// Route browser RPC through our `rpc-url` edge function so the Helius API key
// stays server-side. Public Solana RPC (clusterApiUrl) blocks getAccountInfo
// with 403, which broke client-side transfer building.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const RPC_ENDPOINT = `${SUPABASE_URL}/functions/v1/rpc-url`;

export const WalletContextProvider = ({ children }: Props) => {
  const endpoint = useMemo(() => RPC_ENDPOINT, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
