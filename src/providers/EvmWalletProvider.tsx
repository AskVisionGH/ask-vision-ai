import { ReactNode, useMemo } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import {
  RainbowKitProvider,
  connectorsForWallets,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
  coinbaseWallet,
  phantomWallet,
  rainbowWallet,
  injectedWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { SUPPORTED_EVM_CHAINS } from "@/lib/evm-chains";
import { WALLETCONNECT_PROJECT_ID } from "@/lib/walletconnect";

import "@rainbow-me/rainbowkit/styles.css";

interface Props {
  children: ReactNode;
}

// Build the connector list once. RainbowKit groups them into the modal.
// Phantom is included because it injects an EVM provider on top of its
// Solana support — users who already have Phantom installed can use it
// for both source chains.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      wallets: [metaMaskWallet, rabbyWallet, phantomWallet, walletConnectWallet],
    },
    {
      groupName: "Other",
      wallets: [rainbowWallet, coinbaseWallet, injectedWallet],
    },
  ],
  {
    appName: "Vision",
    projectId: WALLETCONNECT_PROJECT_ID,
  },
);

const wagmiConfig = createConfig({
  chains: SUPPORTED_EVM_CHAINS,
  connectors,
  transports: Object.fromEntries(
    SUPPORTED_EVM_CHAINS.map((c) => [c.id, http()]),
  ) as Record<number, ReturnType<typeof http>>,
  ssr: false,
});

export const EvmWalletProvider = ({ children }: Props) => {
  // Match Vision's dark glassy aesthetic on the RainbowKit modal.
  const theme = useMemo(
    () =>
      darkTheme({
        accentColor: "hsl(var(--primary))",
        accentColorForeground: "hsl(var(--primary-foreground))",
        borderRadius: "large",
        overlayBlur: "small",
      }),
    [],
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider theme={theme} modalSize="compact">
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
};
