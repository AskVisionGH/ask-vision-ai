import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM = `You are an autocomplete engine for a Solana-focused AI chat called Vision.

The user is typing a question/request. Given their partial input and recent
conversation context, return 3 short, plausible completions for what they
might be trying to ask.

Rules:
- Each suggestion must START WITH the user's exact partial text (case preserved
  where possible) and continue naturally. Do not rephrase what they already typed.
- Keep each completion concise: 3-12 words after the partial text.
- Make them concrete, useful, Solana/crypto-flavored. Examples of good topics:
  wallet balances, token prices, swaps, transfers, trending tokens, smart-money
  activity, contract risk analysis, social sentiment, bridging, staking,
  explaining protocols (Jupiter, Jito, Marinade, Drift, etc).
- Suggestions must be DISTINCT from each other (different intents, not rewordings).
- No emoji, no quotes, no trailing punctuation beyond a single ? when natural.
- If the partial text doesn't make sense or is gibberish (<3 chars or random
  letters), return an empty list.
- If a wallet is connected, you may suggest things involving "my wallet".
- If recent assistant messages are provided, suggestions can be reasonable
  follow-ups (e.g. user typed "what about" -> "what about its 24h volume?").

Return ONLY via the suggest tool.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const partial = typeof body?.partial === "string" ? body.partial.slice(0, 200) : "";
  const walletConnected = Boolean(body?.walletConnected);
  const recent = Array.isArray(body?.recent)
    ? body.recent
        .slice(-4)
        .map((m: any) => ({
          role: m?.role === "assistant" ? "assistant" : "user",
          content: typeof m?.content === "string" ? m.content.slice(0, 400) : "",
        }))
        .filter((m: any) => m.content)
    : [];

  if (partial.trim().length < 3) return json({ suggestions: [] });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY missing" }, 500);

  const contextLines: string[] = [];
  contextLines.push(`Wallet connected: ${walletConnected ? "yes" : "no"}`);
  if (recent.length) {
    contextLines.push("Recent conversation (most recent last):");
    for (const m of recent) {
      contextLines.push(`- ${m.role}: ${m.content}`);
    }
  }
  contextLines.push("");
  contextLines.push(`User is currently typing: "${partial}"`);
  contextLines.push("Return 3 distinct completions that each start with that exact text.");

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: contextLines.join("\n") },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest",
              description: "Return up to 3 autocomplete suggestions.",
              parameters: {
                type: "object",
                properties: {
                  suggestions: {
                    type: "array",
                    maxItems: 3,
                    items: { type: "string" },
                  },
                },
                required: ["suggestions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest" } },
        max_tokens: 200,
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429 || resp.status === 402) {
        return json({ suggestions: [] });
      }
      const t = await resp.text().catch(() => "");
      console.error("suggest gateway error:", resp.status, t);
      return json({ suggestions: [] });
    }

    const data = await resp.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any = {};
    try {
      parsed = JSON.parse(call?.function?.arguments ?? "{}");
    } catch {
      parsed = {};
    }

    const raw: unknown[] = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    const cleaned = raw
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
      .map((s) => normalize(s, partial))
      .filter((s) => s && s.toLowerCase() !== partial.trim().toLowerCase())
      .slice(0, 3);

    // De-dupe (case-insensitive).
    const seen = new Set<string>();
    const unique = cleaned.filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return json({ suggestions: unique });
  } catch (e) {
    console.error("chat-suggest error:", e);
    return json({ suggestions: [] });
  }
});

/**
 * Force the suggestion to start with the user's partial text. The model
 * usually obeys, but we don't want to render anything that doesn't extend
 * what they've typed (would look broken).
 */
function normalize(suggestion: string, partial: string): string {
  let s = suggestion.replace(/^["'`]+|["'`]+$/g, "").trim();
  // Strip trailing period if not a question.
  s = s.replace(/[.!,;:]+$/g, "").trim();

  const p = partial.trimEnd();
  if (!s.toLowerCase().startsWith(p.toLowerCase())) {
    // Re-prefix with the user's text + the suggestion (best-effort).
    s = `${p} ${s}`.replace(/\s+/g, " ");
  } else {
    // Preserve the user's exact casing for the prefix.
    s = p + s.slice(p.length);
  }
  return s;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
