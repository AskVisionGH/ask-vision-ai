// Sign-In with Solana (SIWS) helper.
//
// Usage:
//   const { error } = await signInWithSolana({ wallet, signMessage });
//   if (!error) // user is now authenticated as their wallet
//
// Under the hood:
//   1. Asks the `siws-issue-nonce` edge function for a one-time challenge.
//   2. Wallet signs the human-readable challenge message.
//   3. Posts wallet + nonce + signature to `siws-verify`, which returns
//      a token hash we exchange for a real Supabase session.

import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface IssueNonceResponse {
  nonce: string;
  message: string;
  expiresAt: string;
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

export async function signInWithSolana(args: {
  walletAddress: string;
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
}): Promise<{ error?: string }> {
  try {
    // 1. Get a fresh nonce + the exact message to sign.
    const { nonce, message } = await callFn<IssueNonceResponse>("siws-issue-nonce", {
      walletAddress: args.walletAddress,
    });

    // 2. Have the wallet sign it.
    const messageBytes = new TextEncoder().encode(message);
    const sigBytes = await args.signMessage(messageBytes);

    // 3. Encode signature as base58 (Solana convention) and verify server-side.
    const { default: bs58 } = await import("bs58");
    const signature = bs58.encode(sigBytes);

    const verified = await callFn<VerifyResponse>("siws-verify", {
      walletAddress: args.walletAddress,
      nonce,
      signature,
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
