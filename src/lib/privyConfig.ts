/**
 * Privy configuration for Vision embedded wallets.
 *
 * The App ID is a publishable identifier (similar to a Supabase anon key)
 * and is safe to ship in client code. The PRIVY_APP_SECRET lives only in
 * Supabase secrets and is used by edge functions for server-side validation.
 */
export const PRIVY_APP_ID = "cmogw21xh00vj0cjsefsm5fi8";

import type { PrivyClientConfig } from "@privy-io/react-auth";

export const privyConfig: PrivyClientConfig = {
  // Login methods are managed in the Privy dashboard. We disable the
  // built-in login UI here because Vision uses Supabase Auth as its
  // primary identity layer — Privy is used purely as the embedded
  // wallet provider, attached to a Supabase user.
  loginMethods: ["email"],
  appearance: {
    theme: "dark",
    accentColor: "#ffffff",
    logo: undefined,
    walletChainType: "solana-only",
  },
  embeddedWallets: {
    // Do NOT auto-create wallets on login. Users must explicitly
    // opt in via the "Create Vision Wallet" button so we can show
    // the recovery flow first.
    showWalletUIs: false,
    ethereum: { createOnLogin: "off" },
    solana: { createOnLogin: "off" },
  },
  solanaClusters: [
    {
      name: "mainnet-beta",
      rpcUrl: "https://api.mainnet-beta.solana.com",
    },
  ],
};
