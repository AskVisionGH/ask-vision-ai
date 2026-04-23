import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.95.3";

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

    const trimmed = recipient.trim();
    let address: string | null = null;
    let displayName: string | null = null;

    if (trimmed.toLowerCase().endsWith(".sol")) {
      try {
        const resp = await fetch(`https://sdk-proxy.sns.id/resolve/${encodeURIComponent(trimmed)}`);
        const data = await resp.json().catch(() => null);

        if (!resp.ok || !data || data.s !== "ok" || typeof data.result !== "string") {
          return json(
            { error: `Couldn't resolve "${trimmed}" — that .sol name doesn't exist or has no owner.` },
            404,
          );
        }

        address = new PublicKey(data.result).toBase58();
        displayName = trimmed.toLowerCase();
      } catch (e) {
        console.error("SNS proxy resolve error:", e);
        return json(
          { error: `Couldn't resolve "${trimmed}" — please try again in a moment.` },
          502,
        );
      }
    } else if (isBase58Pubkey(trimmed)) {
      try {
        address = new PublicKey(trimmed).toBase58();
      } catch {
        return json({ error: "That doesn't look like a valid Solana address." }, 400);
      }
    } else {
      return json({ error: "Recipient must be a wallet address or .sol name." }, 400);
    }

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

