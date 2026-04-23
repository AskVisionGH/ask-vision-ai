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

Tools (call them whenever relevant — don't ask permission, don't pretend you called them):
- \`get_wallet_balance\` — fetches the connected user's holdings. Use for "what's in my wallet", "my balance", "my portfolio", etc. No arguments; the wallet address is injected.
- \`get_token_info\` — fetches live price, market cap, volume, and 24h change for a single token. Use whenever the user names a token ($SOL, JUP, BONK) or pastes a mint address. Argument: \`query\` (ticker like "SOL" or full mint address).
- \`get_trending\` — fetches the top trending Solana tokens by 24h volume. ALWAYS call this for any question about what's trending, hot, popular, top tokens, or what's moving on Solana — never answer from memory.
- \`prepare_swap\` — fetches a live Jupiter quote for swapping one token into another. Call this whenever the user wants to swap, trade, exchange, or convert tokens (e.g. "swap 0.1 SOL for USDC", "trade 100 BONK to SOL"). Arguments: \`inputToken\`, \`outputToken\` (tickers or mint addresses), \`amount\` (decimal of inputToken), and optional \`slippageBps\` (default 50 = 0.5%). NEVER execute — this only quotes.

CRITICAL: If a user asks for live data (prices, balances, what's trending, swap quotes), you MUST call the matching tool. Never make up numbers. Never say "here are the top tokens" without first calling \`get_trending\`. Never quote a swap rate without calling \`prepare_swap\`.

After any tool returns, the UI renders a rich card automatically. Your job is a SHORT one or two-sentence framing — note the headline number, what stands out, or any caveats. Do NOT re-list everything; the card already does that. For \`prepare_swap\`, frame as a preview ("Here's the preview — review and confirm below"), never as a confirmed trade.

If a tool returns an error, explain it plainly and suggest a next step.

Capabilities (coming next — do NOT pretend you can do these yet):
- Signing and submitting swaps on-chain (the preview is ready; signing ships next)
- Preparing transfers (SOL or SPL tokens)
- Executing on-chain transactions after explicit confirmation

If a user asks to actually send/sign/execute a swap or transfer, say plainly: "Signing ships in the next update — for now I can show you the preview."

Never:
- Give financial advice, price predictions, or trade signals.
- Pretend a transaction was sent.
- Invent token addresses, prices, or balances. If you don't have data, call a tool or say so.`;

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
  {
    type: "function",
    function: {
      name: "get_token_info",
      description:
        "Fetch live market data for a single Solana token: price (USD), 1h and 24h price change, market cap, FDV, 24h volume, and liquidity. Use when the user mentions any token by ticker or mint address.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Token ticker (e.g. 'SOL', 'JUP', 'BONK') or full Solana mint address.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_trending",
      description:
        "Fetch the top 10 trending Solana tokens right now, ranked by 24h trading volume. Use for 'what's trending', 'top tokens', 'what's hot on Solana', etc.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "prepare_swap",
      description:
        "Prepare a Jupiter swap quote between two Solana tokens. Use whenever the user wants to swap, trade, exchange, or convert tokens. NEVER executes — only returns a preview quote.",
      parameters: {
        type: "object",
        properties: {
          inputToken: {
            type: "string",
            description: "Ticker (e.g. 'SOL', 'USDC') or full mint address of the token to sell.",
          },
          outputToken: {
            type: "string",
            description: "Ticker or full mint address of the token to buy.",
          },
          amount: {
            type: "number",
            description: "Decimal amount of inputToken to swap (e.g. 0.1 for 0.1 SOL).",
          },
          slippageBps: {
            type: "number",
            description: "Optional slippage tolerance in basis points (default 50 = 0.5%).",
          },
        },
        required: ["inputToken", "outputToken", "amount"],
        additionalProperties: false,
      },
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
            result = await invokeFn("wallet-balance", { address: walletAddress }, req);
          }
          toolEvents.push({ type: "wallet_balance", data: result });
        } else if (name === "get_token_info") {
          let args: any = {};
          try {
            args = JSON.parse(tc.function?.arguments ?? "{}");
          } catch { /* ignore */ }
          result = await invokeFn("token-info", { query: args.query ?? "" }, req);
          toolEvents.push({ type: "token_info", data: result });
        } else if (name === "get_trending") {
          result = await invokeFn("trending-tokens", {}, req);
          toolEvents.push({ type: "trending", data: result });
        } else if (name === "prepare_swap") {
          let args: any = {};
          try {
            args = JSON.parse(tc.function?.arguments ?? "{}");
          } catch { /* ignore */ }
          result = await invokeFn("swap-quote", {
            inputToken: args.inputToken ?? "",
            outputToken: args.outputToken ?? "",
            amount: args.amount,
            slippageBps: args.slippageBps,
          }, req);
          toolEvents.push({ type: "swap_quote", data: result });
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

async function invokeFn(name: string, body: unknown, req: Request) {
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supaUrl || !anonKey) return { error: "Backend misconfigured" };

  const resp = await fetch(`${supaUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: req.headers.get("Authorization") ?? `Bearer ${anonKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    return { error: `${name} failed: ${t}` };
  }
  return await resp.json();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
