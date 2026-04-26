import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM = `You generate ultra-short, human-friendly titles for chat conversations about Solana, crypto, and finance.

Rules:
- 2-5 words. Hard maximum 40 characters.
- Title Case. No quotes, no trailing punctuation, no emoji.
- Capture the user's INTENT and TOPIC — not their greeting, not raw data they pasted.
- For greetings or chit-chat ("hi", "hello", "what's up", "gm"), return: New Chat
- Tickers stay uppercase WITH the dollar sign when the user used one ("$BONK", "$SOL"), or without if they didn't ("BONK Price", "SOL Trend"). Match the user's style.
- **NEVER put a raw contract address (long base58 string ~32-44 chars) in the title.** If the user pasted only a contract address with no ticker, infer the topic from the verb/intent and use a generic noun: "Token Holders", "Token Analysis", "Token Chart", "Token Swap", "Token Risk Check". If the user wrote both a ticker AND a contract address, use the ticker. If the message is JUST a bare contract address with no other words, return: Token Lookup
- Prefer ACTION + SUBJECT format: "Top BONK Holders", "SOL Price Check", "Swap SOL to USDC", "Bridge to Base", "WIF Risk Report", "Trending Tokens", "My Wallet PnL".
- Examples:
  - "what's in my wallet" -> Wallet Check
  - "swap 0.1 SOL for USDC" -> Swap SOL to USDC
  - "show me bonk price" -> BONK Price
  - "give me the top ten holders of \$Punch" -> Top \$Punch Holders
  - "top holders of NV2RYH954cTJ3ckFUpvfqaQXU4ARqqDH3562nFSpump" -> Top Token Holders
  - "is EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm safe" -> Token Risk Check
  - "analyze EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" -> Token Analysis
  - "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" -> Token Lookup
  - "what's trending on solana" -> Trending Tokens
  - "explain jupiter routing" -> Jupiter Routing
  - "send 5 usdc to mom" -> Send USDC to Mom
  - "bridge 1 SOL to base" -> Bridge SOL to Base
  - "hi" -> New Chat

Return ONLY the title text. No prefix, no explanation.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json({ title: "New chat" });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY missing" }, 500);

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: message.slice(0, 500) },
        ],
        max_tokens: 24,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.error("title gateway error:", resp.status, t);
      return json({ title: fallback(message) });
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content;
    const cleaned = sanitize(raw);
    return json({ title: cleaned || fallback(message) });
  } catch (e) {
    console.error("chat-title error:", e);
    return json({ title: fallback(message) });
  }
});

function sanitize(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  // Strip surrounding quotes/backticks.
  s = s.replace(/^["'`]+|["'`]+$/g, "").trim();
  // Drop trailing punctuation.
  s = s.replace(/[.!?,;:\-]+$/g, "").trim();
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ");
  if (s.length > 40) s = s.slice(0, 40).trim();
  return s;
}

function fallback(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  const sliced = cleaned.slice(0, 40).trim();
  return sliced.charAt(0).toUpperCase() + sliced.slice(1);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
