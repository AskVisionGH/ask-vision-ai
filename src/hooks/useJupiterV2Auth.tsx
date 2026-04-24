import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { supabase } from "@/integrations/supabase/client";

// Manages the Jupiter Trigger v2 challenge → sign → JWT flow.
// JWTs are valid 24h. We cache per-wallet in memory + sessionStorage so the
// user only signs once per session. We never persist to localStorage to
// satisfy Jupiter's "no localStorage" guidance.

interface CachedJwt {
  token: string;
  walletPubkey: string;
  expiresAt: number;
}

const STORAGE_KEY = "vision:jup-v2-jwt";
const TTL_MS = 23 * 60 * 60 * 1000; // refresh ~1h before expiry

function readCached(): CachedJwt | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedJwt;
    if (!parsed?.token || !parsed?.expiresAt || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCached(c: CachedJwt) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

function clearCached() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

const supaPost = async (fn: string, body: unknown): Promise<any> => {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const ctx = (error as any).context;
    let msg: string | null = null;
    if (ctx && typeof ctx.json === "function") {
      try {
        const p = await ctx.json();
        if (p?.error) msg = String(p.error);
      } catch { /* ignore */ }
    }
    throw new Error(msg ?? error.message ?? `${fn} failed`);
  }
  if (data && typeof data === "object" && (data as any).error) {
    throw new Error((data as any).error);
  }
  return data;
};

export const useJupiterV2Auth = () => {
  const { publicKey, signMessage } = useWallet();
  const inflight = useRef<Promise<string> | null>(null);
  const [signing, setSigning] = useState(false);
  const [cachedToken, setCachedToken] = useState<string | null>(null);

  useEffect(() => {
    const walletPubkey = publicKey?.toBase58();
    if (!walletPubkey) {
      setCachedToken(null);
      return;
    }

    const cached = readCached();
    setCachedToken(cached?.walletPubkey === walletPubkey ? cached.token : null);
  }, [publicKey]);

  const ensureJwt = useCallback(async (): Promise<string> => {
    if (!publicKey) throw new Error("Connect your wallet to continue");
    if (!signMessage) throw new Error("Wallet doesn't support message signing");

    const walletPubkey = publicKey.toBase58();
    const cached = readCached();
    if (cached && cached.walletPubkey === walletPubkey) {
      setCachedToken(cached.token);
      return cached.token;
    }

    if (inflight.current) return inflight.current;

    const promise = (async () => {
      setSigning(true);
      try {
        const challenge = await supaPost("trigger-v2-auth", {
          action: "challenge",
          walletPubkey,
          type: "message",
        });
        const message: string = challenge.challenge;
        if (!message) throw new Error("No challenge returned");

        const encoded = new TextEncoder().encode(message);
        const sig = await signMessage(encoded);
        const signatureB58 = bs58.encode(sig);

        const verified = await supaPost("trigger-v2-auth", {
          action: "verify",
          walletPubkey,
          type: "message",
          signature: signatureB58,
        });
        const token: string = verified.token;
        if (!token) throw new Error("No token returned");
        writeCached({ token, walletPubkey, expiresAt: Date.now() + TTL_MS });
        setCachedToken(token);
        return token;
      } finally {
        setSigning(false);
        inflight.current = null;
      }
    })();
    inflight.current = promise;
    return promise;
  }, [publicKey, signMessage]);

  const reset = useCallback(() => {
    clearCached();
    setCachedToken(null);
  }, []);

  return { ensureJwt, reset, signing, cachedToken, hasCachedJwt: !!cachedToken };
};
