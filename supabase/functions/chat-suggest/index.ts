import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM = `You are a fast autocomplete engine for a Solana-focused AI chat called Vision.

The user is typing a question/request. Return up to 3 short, plausible completions
as plain text, ONE PER LINE, with NO numbering, bullets, quotes, or commentary.

Vision can ONLY do the things in the capability list below. Every suggestion MUST
map to one of these. Do NOT suggest anything else — specifically NEVER suggest:
staking, bridging across chains, NFTs, price alerts / notifications, limit orders,
DCA, yield farming, lending/borrowing, governance voting, wallet creation,
fiat on/off-ramps, portfolio tracking over time, tax reports, or copy-trading.

Capabilities:
- Show the connected wallet's balances and token holdings (SOL + SPL tokens).
- Look up info on a token (price, market cap, volume, liquidity) by ticker, name, or mint address.
- Show a token's price chart over an interval (1h, 24h, 7d, etc).
- Show what's currently trending on Solana.
- Prepare a transfer of SOL or an SPL token to an address or saved contact (user signs in their wallet).
- Prepare a swap between two tokens via Jupiter (user signs in their wallet).
- List the user's saved contacts, or save a new contact (name + address).
- Analyze a token contract / mint address for risk (honeypot, mint authority, LP lock, top holders).
- Show social sentiment for a token (Twitter/X chatter).
- Show recent Solana ecosystem news.
- Show early buyers of a token (which wallets bought first).
- Show smart-money activity (what tracked smart wallets are buying/selling).
- Show realized + unrealized PnL for the connected wallet (overall, or for a specific token).
- Show the connected wallet's recent transactions.
- Explain Solana / DeFi / protocol concepts in plain English (educational only — no actions).

Rules:
- Each line MUST start with the user's exact partial text (preserve casing where possible)
  and continue naturally into one of the capabilities above.
- Each completion adds 3-12 words after the partial text. Be concrete.
- Completions must be DISTINCT (different capabilities or different targets).
- No emoji, no quotes, no trailing punctuation beyond a single ? when natural.
- If the partial text is gibberish, <3 chars, or only fits something Vision can't do, output nothing.
- If a wallet is NOT connected, avoid suggestions that require one (balances, PnL, recent txs,
  transfers, swaps from "my wallet"). Prefer token lookups, trending, news, sentiment,
  contract analysis, education.
- If a wallet IS connected, "my wallet" suggestions are great.

Output format example (lines only, nothing else):
how do I swap SOL for USDC
how is BONK trending on Solana right now
how risky is this token contract`;

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
