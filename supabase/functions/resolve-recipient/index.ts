import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Connection, PublicKey } from "https://esm.sh/@solana/web3.js@1.95.3";
import { resolve as resolveSns } from "https://esm.sh/@bonfida/spl-name-service@3.0.7?deps=@solana/web3.js@1.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const isBase58Pubkey = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { recipient } = await req.json();
    if (!recipient || typeof recipient !== "string") {
      return json({ error: "recipient required" }, 400);
    }

    const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
    if (!HELIUS_API_KEY) return json({ error: "RPC misconfigured" }, 500);
    const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

    const trimmed = recipient.trim();
    let address: string | null = null;
    let displayName: string | null = null;

    if (trimmed.toLowerCase().endsWith(".sol")) {
      // SNS resolution
      try {
        const connection = new Connection(rpcUrl, "confirmed");
        const domain = trimmed.replace(/\.sol$/i, "");
        const owner = await resolveSns(connection, domain);
        address = owner.toBase58();
        displayName = trimmed.toLowerCase();
      } catch (e) {
        console.error("SNS resolve error:", e);
        return json(
          { error: `Couldn't resolve "${trimmed}" — that .sol name doesn't exist or has no owner.` },
          404,
        );
      }
    } else if (isBase58Pubkey(trimmed)) {
      try {
        const pk = new PublicKey(trimmed);
        address = pk.toBase58();
      } catch {
        return json({ error: "That doesn't look like a valid Solana address." }, 400);
      }
    } else {
      return json({ error: "Recipient must be a wallet address or .sol name." }, 400);
    }

    // Safety: detect off-curve (PDA) addresses
    let isOnCurve = true;
    try {
      isOnCurve = PublicKey.isOnCurve(new PublicKey(address!).toBytes());
    } catch {
      isOnCurve = true;
    }

    return json({ address, displayName, isOnCurve });
  } catch (e) {
    console.error("resolve-recipient error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
