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
  // Vision uses Supabase Auth as its primary identity layer — Privy is
  // attached purely as the embedded wallet provider. We bind to the same
  // email via the email-OTP flow.
  loginMethods: ["email"],
  appearance: {
    theme: "dark",
    accentColor: "#ffffff",
    logo: undefined,
    // Both Solana and all EVM chains (Ethereum, Base, Arbitrum, etc.)
    walletChainType: "ethereum-and-solana",
  },
  embeddedWallets: {
    // Do NOT auto-create wallets on login. We trigger creation explicitly
    // from the "Create Vision Wallet" button so we can show recovery flow
    // first and create both chains in a known order.
    showWalletUIs: false,
    ethereum: { createOnLogin: "off" },
    solana: { createOnLogin: "off" },
  },
};
