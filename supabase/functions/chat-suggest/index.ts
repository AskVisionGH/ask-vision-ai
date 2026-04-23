import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM = `You are a fast autocomplete engine for a Solana-focused AI chat called Vision.

The user is typing a question/request. Given their partial input and recent
conversation context, return up to 3 short, plausible completions as plain text,
ONE PER LINE, with NO numbering, bullets, quotes, or commentary.

Rules:
- Each line MUST start with the user's exact partial text (preserve casing where possible)
  and continue naturally.
- Each completion adds 3-12 words after the partial text. Be concrete and Solana/crypto-flavored:
  wallet balances, token prices, swaps, transfers, trending tokens, smart-money activity,
  contract risk analysis, social sentiment, bridging, staking, protocols (Jupiter, Jito,
  Marinade, Drift, etc).
- Completions must be DISTINCT (different intents).
- No emoji, no quotes, no trailing punctuation beyond a single ? when natural.
- If the partial text is gibberish or <3 chars, output nothing.
- If a wallet is connected, completions can reference "my wallet".

Output format example (3 lines, nothing else):
how do I swap SOL for USDC on Jupiter
how do I stake SOL with Jito
how do I bridge USDC from Ethereum`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const partial = typeof body?.partial === "string" ? body.partial.slice(0, 200) : "";
  const walletConnected = Boolean(body?.walletConnected);
  const recent = Array.isArray(body?.recent)
    ? body.recent
        .slice(-4)
        .map((m: any) => ({
          role: m?.role === "assistant" ? "assistant" : "user",
          content: typeof m?.content === "string" ? m.content.slice(0, 300) : "",
        }))
        .filter((m: any) => m.content)
    : [];

  if (partial.trim().length < 3) {
    // Empty stream; client will treat as "no suggestions".
    return new Response("", {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ctx: string[] = [];
  ctx.push(`Wallet connected: ${walletConnected ? "yes" : "no"}`);
  if (recent.length) {
    ctx.push("Recent conversation (most recent last):");
    for (const m of recent) ctx.push(`- ${m.role}: ${m.content}`);
  }
  ctx.push("");
  ctx.push(`User is currently typing: "${partial}"`);
  ctx.push(`Return up to 3 distinct completions, each on its own line, each starting with that exact text.`);

  try {
    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: ctx.join("\n") },
        ],
        stream: true,
        max_tokens: 180,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      if (upstream.status === 429 || upstream.status === 402) {
        return new Response("", {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }
      const t = await upstream.text().catch(() => "");
      console.error("suggest gateway error:", upstream.status, t);
      return new Response("", {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // Pass the SSE stream straight through. The client parses delta text and
    // splits it on newlines into individual suggestions as they arrive.
    return new Response(upstream.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("chat-suggest error:", e);
    return new Response("", {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  }
});
