// Sign-In with Ethereum (SIWE / EIP-4361) helper.
//
// Usage:
//   const { error } = await signInWithEthereum({ walletAddress, signMessage, chainId });
//   if (!error) // user is now authenticated as their EVM wallet
//
// Under the hood (mirrors src/lib/siws.ts for Solana):
//   1. Asks the `siwe-issue-nonce` edge function for a one-time challenge.
//   2. Wallet signs the human-readable message via personal_sign.
//   3. Posts wallet + nonce + signature to `siwe-verify`, which returns
//      a token hash we exchange for a real Supabase session.

import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface IssueNonceResponse {
  nonce: string;
  message: string;
  expiresAt: string;
  chainId: number;
  domain: string;
}

interface VerifyResponse {
  userId: string;
  walletAddress: string;
  tokenHash: string;
  email: string;
}

async function callFn<T>(name: string, body: unknown): Promise<T> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error ?? `Request to ${name} failed`);
  }
  return data as T;
}

export async function signInWithEthereum(args: {
  walletAddress: string;
  /** Wagmi's `signMessageAsync` — must sign the raw string via personal_sign. */
  signMessage: (message: string) => Promise<string>;
  chainId?: number;
}): Promise<{ error?: string }> {
  try {
    // 1. Get a fresh nonce + the exact message to sign.
    const { nonce, message, chainId } = await callFn<IssueNonceResponse>("siwe-issue-nonce", {
      walletAddress: args.walletAddress,
      chainId: args.chainId ?? 1,
    });

    // 2. Have the wallet sign it.
    const signature = await args.signMessage(message);

    // 3. Verify server-side.
    const verified = await callFn<VerifyResponse>("siwe-verify", {
      walletAddress: args.walletAddress,
      nonce,
      signature,
      chainId,
    });

    // 4. Exchange the magic-link token hash for a real session.
    const { error } = await supabase.auth.verifyOtp({
      token_hash: verified.tokenHash,
      type: "magiclink",
    });

    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sign-in failed" };
  }
}
