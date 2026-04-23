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

Tools:
- You have a tool \`get_wallet_balance\` that fetches the connected user's wallet holdings. Call it whenever the user asks about their balance, holdings, portfolio, what they own, what's in their wallet, or similar.
- The tool needs no arguments — the user's connected wallet address is injected automatically.
- After the tool returns, the UI renders a portfolio card automatically. Your job is to add a SHORT one or two-sentence summary above it — e.g. note total value, top holding, or anything notable. Do NOT list every token; the card already does that.
- If the wallet is empty, say so plainly and suggest funding it.

Capabilities (coming next — do NOT pretend you can do these yet):
- Live token prices, trending tokens
- Preparing swaps via Jupiter
- Preparing transfers (SOL or SPL tokens)
- Executing on-chain transactions after explicit confirmation

If a user asks for one of these, say plainly: "That ships in the next update — for now I can walk you through how it would work."

Never:
- Give financial advice, price predictions, or trade signals.
- Pretend a transaction was sent.
- Invent token addresses, prices, or balances.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_wallet_balance",
      description:
        "Fetch the connected user's Solana wallet holdings: SOL balance, all SPL tokens, USD values, and total portfolio value. Use whenever the user asks about their balance, holdings, portfolio, or what they own.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, walletAddress } = await req.json();

    if (!Array.isArray(messages)) {
      return json({ error: "messages must be an array" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    // Multi-turn tool loop. Max 3 iterations to bound cost.
    const conversation: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ];

    const toolEvents: any[] = []; // structured events to send back alongside the text

    for (let iter = 0; iter < 3; iter++) {
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: conversation,
          tools: TOOLS,
          tool_choice: "auto",
        }),
      });

      if (!aiResp.ok) {
        if (aiResp.status === 429) {
          return json({ error: "Rate limit hit. Wait a moment and try again." }, 429);
        }
        if (aiResp.status === 402) {
          return json(
            { error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." },
            402,
          );
        }
        const errText = await aiResp.text();
        console.error("AI gateway error:", aiResp.status, errText);
        return json({ error: "AI gateway error" }, 500);
      }

      const data = await aiResp.json();
      const choice = data.choices?.[0];
      const msg = choice?.message;
      if (!msg) {
        return json({ error: "No response from AI" }, 500);
      }

      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // Final answer
        return json({
          content: msg.content ?? "",
          toolEvents,
        });
      }

      // Push assistant message verbatim so tool_call_ids match
      conversation.push(msg);

      // Execute each tool
      for (const tc of toolCalls) {
        const name = tc.function?.name;
        let result: any;

        if (name === "get_wallet_balance") {
          if (!walletAddress) {
            result = { error: "No wallet connected" };
          } else {
            result = await invokeWalletBalance(walletAddress, req);
          }
          toolEvents.push({ type: "wallet_balance", data: result });
        } else {
          result = { error: `Unknown tool: ${name}` };
        }

        conversation.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    return json({
      content: "I tried but couldn't complete that — let's try a different angle.",
      toolEvents,
    });
  } catch (e) {
    console.error("chat error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function invokeWalletBalance(address: string, req: Request) {
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supaUrl || !anonKey) return { error: "Backend misconfigured" };

  const resp = await fetch(`${supaUrl}/functions/v1/wallet-balance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: req.headers.get("Authorization") ?? `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ address }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    return { error: `wallet fetch failed: ${t}` };
  }
  return await resp.json();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
