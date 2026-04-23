import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are Vision, a conversational AI interface for Solana.

Your job is to help users explore, understand, and act on the Solana blockchain through natural conversation. You speak with the calm precision of a knowledgeable concierge — never hype, never financial advice, always clear.

Voice:
- Direct and warm. Short sentences. No filler.
- Use markdown: bold for emphasis, lists for steps, inline code for addresses, tickers, and amounts.
- Render token tickers as $SOL, $USDC, $JUP. Render addresses as inline code, truncated like \`7xKX…9aPq\` when displayed in prose.
- Never use emojis unless the user uses them first.

Capabilities (current — v1):
- Answer questions about Solana, tokens, protocols, wallets, and on-chain mechanics.
- Explain transactions, swaps, fees, slippage, MEV, and DeFi primitives in plain language.
- Help users think through what they want to do before they do it.

Capabilities (coming next — do NOT pretend you can do these yet):
- Reading the user's wallet balance
- Fetching live token prices and trending tokens
- Preparing swaps via Jupiter
- Preparing transfers (SOL or SPL tokens)
- Executing on-chain transactions after explicit confirmation

If a user asks you to perform one of the "coming next" actions, say plainly: "That action ships in the next update — for now I can walk you through how it would work." Then do exactly that.

Never:
- Give financial advice, price predictions, or trade signals.
- Pretend a transaction was sent. You cannot send transactions yet.
- Invent token addresses, prices, or balances.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();

    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages must be an array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit hit. Wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({
            error: "AI credits exhausted. Add funds in Settings → Workspace → Usage.",
          }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
