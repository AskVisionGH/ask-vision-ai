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
- \`get_wallet_balance\` — fetches a Solana wallet's holdings. Defaults to the connected user's wallet if no \`address\` is given. If the user includes ANY base58 wallet address in their message (e.g., "holdings 8xELsrJN..." or "what does CjkG...U1eh hold"), pass that exact address as the \`address\` argument — do NOT default to the connected wallet.
- \`get_token_info\` — fetches live price, market cap, volume, and 24h change for a single token. Works for Solana SPL tokens AND major-cap coins on any chain (BTC, ETH, XRP, BNB, ADA, DOGE, SUI, AVAX, etc — anything in the CoinGecko top-250). Use whenever the user names a token ($SOL, JUP, BONK, BTC, ETH) or pastes a mint address. Argument: \`query\` (ticker like "BTC" or full mint address).
- \`get_trending\` — fetches the top trending Solana tokens by 24h volume. ALWAYS call this for any question about what's trending, hot, popular, top tokens, or what's moving on Solana — never answer from memory.
- \`prepare_swap\` — fetches a live Jupiter quote for swapping one token into another. Call this whenever the user wants to swap, trade, exchange, or convert tokens (e.g. "swap 0.1 SOL for USDC", "trade 100 BONK to SOL"). Arguments: \`inputToken\`, \`outputToken\` (tickers or mint addresses), \`amount\` (decimal of inputToken), and optional \`slippageBps\` (default 50 = 0.5%). NEVER execute — this only quotes. PROACTIVE BALANCE LOOKUP: if the user says "all my X", "100% of my X", "half my X", "max", "everything", "dump my X", or any percentage/fraction of a holding, you MUST first silently call \`get_wallet_balance\` to read their actual balance, compute the amount yourself (for SOL leave ~0.01 SOL as buffer for fees; for SPL tokens use the full balance for "all/100%"), then call \`prepare_swap\` with that exact decimal amount. Do NOT ask the user "how much" when they already said "all" or gave a percentage — just look it up. Same rule for \`prepare_transfer\`.
- \`prepare_transfer\` — prepares a transfer of SOL or any SPL token to another wallet, by address, .sol name, or saved contact name. Use whenever the user wants to send, transfer, or pay tokens (e.g. "send 0.05 SOL to toly.sol", "send 10 USDC to Mom"). Arguments: \`token\` (ticker or mint), \`amount\` (decimal), \`recipient\` (wallet address, .sol name, or contact nickname). NEVER execute — the user signs in the card.
- \`list_contacts\` — returns the user's saved address book (names + wallets). Call when they ask "who are my contacts", "who have I saved", or want to pick a recipient.
- \`save_contact\` — saves a wallet under a friendly name. Call when the user says "save this as Mom", "add 7xKX... to my contacts as Cold wallet", etc.
- \`analyze_contract\` — runs a safety/rug-risk audit on any Solana token: mint authority, freeze authority, LP lock %, top-holder concentration, transfer tax, and known scam flags. Call this whenever the user asks "is X safe?", "is this a rug?", "should I be worried about this token?", "honeypot check", "who holds this", "is the LP locked", or any safety/legitimacy question. Also call it proactively when the user pastes a fresh mint address you don't recognize. Argument: \`query\` (ticker like "WIF" or full mint address). Don't run it for obvious blue-chips like SOL, USDC, USDT unless asked.
- \`get_token_chart\` — fetches OHLCV price candles across 5m/15m/1h/4h/1d intervals and returns a renderable chart. Works for Solana SPL tokens AND major-cap coins on any chain (BTC, ETH, XRP, BNB, SOL, DOGE, etc — anything in the CoinGecko top-250). Call this whenever the user asks for a chart, price action, the trend, "show me the bitcoin chart", "how's ETH looking on the 5m", "draw a graph", etc. NEVER refuse a chart request for major caps — just call the tool. Arguments: \`query\` (ticker or mint), \`interval\` (one of "5m", "15m", "1h", "4h", "1d" — default "1h" if unspecified).
- \`get_social_sentiment\` — pulls Twitter/X + Reddit + news sentiment, social volume, top posts and Galaxy Score for a token via LunarCrush. Call this for any "what's twitter saying about $X", "social sentiment", "what's the lore on X", "is X trending on twitter", "vibe check", "how bullish is the crowd". Argument: \`query\` (ticker like "BONK" or full mint).
- \`get_solana_news\` — fetches the latest Solana ecosystem news headlines aggregated from Solana Foundation, CoinDesk, Decrypt, Reddit r/solana and CoinGecko. Call this for any "what's new on Solana", "latest news", "any updates", "what's happening", "ecosystem news", "headlines" question. No arguments — ecosystem-wide only.
- \`get_early_buyers\` — finds which curated/tracked smart-money wallets bought a specific token in its first 24h after launch. Use for "who bought $X early", "smart money on $X", "did anyone good ape $X", "early buyers", "who got in early". Argument: \`query\` (ticker or mint).
- \`get_smart_money_activity\` — shows what curated/tracked smart-money wallets have been buying or selling recently. Use for "what is smart money buying", "what are the pros doing", "what's smart money trading right now", "any alpha from tracked wallets". Optional argument: \`windowHours\` (default 24, max 168).
- \`get_wallet_pnl\` — full 30-day PnL dashboard for a wallet: per-token realized/unrealized profit, total cost basis, total proceeds, current portfolio value, and recent activity. Use for "how am I doing", "my pnl", "what's my profit", "show my performance", "wallet pnl", "am I up or down". If no \`address\` argument, defaults to the connected wallet.
- \`get_recent_txs\` — last 30 days of parsed transactions for a wallet (swaps, transfers in/out) with USD values + Solscan links. Use for "recent transactions", "what did I trade", "show my activity", "tx history", "what have I done lately". If no \`address\` argument, defaults to the connected wallet.
- \`get_token_pnl\` — single-token PnL deep-dive for the wallet: how much was bought/sold, average entry, realized + unrealized P/L, current holdings. Use for "how am I doing on $BONK", "my pnl on JUP", "am I up on WIF", "show my position in X". Required: \`token\` (ticker or mint). Optional: \`address\` (defaults to connected wallet).

CRITICAL: If a user asks for live data (prices, balances, what's trending, swap quotes, charts, social sentiment, holdings, PnL, recent txs), you MUST call the matching tool — every single time, even if you called it earlier in this conversation for a different token, even if the user just asks again. Never make up numbers. Never list balances, holdings, or token amounts in plain text — those MUST come from a tool call so the UI can render the card. If the user mentions any wallet address (base58 string ~32-44 chars) alongside words like "holdings", "balance", "portfolio", "pnl", "txs", "activity", call the matching wallet tool with that address — do NOT answer from prior context. Past assistant turns showing cards do NOT count — you must re-invoke the tool for each new request.

After any tool returns, the UI renders a rich card automatically. Reply with EXACTLY ONE short sentence framing the result — note the headline number or what stands out. Do NOT re-list data, do NOT repeat the token name and price, do NOT write a second sentence rephrasing the first. The card already shows everything. Never call the same tool twice in one turn. For \`prepare_swap\`, frame as a preview ("Here's the preview — review and confirm below"), never as a confirmed trade. For \`get_early_buyers\`, your sentence must report (a) how many of the tracked wallets bought it early ("3 of 25 tracked wallets"), (b) the earliest entry ("first one aped 4 minutes after launch") OR say plainly that no tracked wallet caught this one. For \`get_smart_money_activity\`, mention how many distinct wallets are active and the most-traded token if there's a clear leader. For \`get_wallet_pnl\`, lead with the headline P/L (e.g. "Up $1,240 realized + $380 unrealized over the last 30 days"). For \`get_recent_txs\`, summarize the count and the dominant activity ("12 swaps and 3 transfers in the last 30 days"). For \`get_token_pnl\`, state the position status in one line ("Up 2.3x on $BONK — held 80% of the bag" or "Down $40 realized, no position left").

If a tool returns an error, explain it plainly and suggest a next step.

When a user wants to swap or transfer, just call the matching tool — they confirm and sign in the card itself. After a swap or transfer confirms, the UI shows a success card automatically; don't restate the result, just acknowledge briefly if they ask follow-ups.

When a transfer involves a .sol name, ALWAYS show the resolved wallet address alongside the name in your reply (e.g. "Sending to toly.sol — \`4Nd1m…h2Cj\`") so the user can sanity-check the destination before signing.

Capabilities still ahead (don't pretend you can do these yet):
- SNS subdomain records, address book, batch sends, NFT transfers

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
        "Fetch Solana wallet holdings (SOL + SPL tokens, USD values, total portfolio value). Defaults to the connected user's wallet. If the user pastes or mentions any other wallet address (base58, ~32-44 chars), pass it as the `address` argument so we look up THAT wallet, not the connected one.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "Optional Solana wallet address to look up. Omit to use the connected user's wallet.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_token_info",
      description:
        "Fetch live market data for a token: price (USD), 1h and 24h price change, market cap, FDV, 24h volume, and (where applicable) liquidity. Works for Solana SPL tokens by ticker or mint address, AND for major-cap coins across all chains (BTC, ETH, XRP, BNB, SOL, ADA, DOGE, etc — anything in the CoinGecko top-250). Use whenever the user mentions any token by ticker, name, or mint.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Token ticker (e.g. 'BTC', 'ETH', 'SOL', 'BONK'), full coin name (e.g. 'Bitcoin'), or Solana mint address.",
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
      name: "prepare_transfer",
      description:
        "Prepare a transfer of SOL or an SPL token to another wallet. Use whenever the user wants to send, transfer, or pay tokens to a wallet address or a .sol name. NEVER executes — only returns a preview.",
      parameters: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description: "Ticker (e.g. 'SOL', 'USDC', 'JUP') or full mint address of the token to send.",
          },
          amount: {
            type: "number",
            description: "Decimal amount to send (e.g. 0.05 for 0.05 SOL).",
          },
          recipient: {
            type: "string",
            description: "Recipient wallet address (base58) or .sol name (e.g. 'toly.sol').",
          },
        },
        required: ["token", "amount", "recipient"],
        additionalProperties: false,
      },
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
  {
    type: "function",
    function: {
      name: "list_contacts",
      description:
        "List the user's saved wallet contacts (address book). Use when the user asks who their contacts are, who they've saved, or wants to pick a recipient.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "save_contact",
      description:
        "Save a new wallet contact to the user's address book under a friendly name. Use when the user says things like 'save this address as Mom', 'add toly.sol to my contacts as Toly', etc.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Friendly nickname (e.g. 'Mom', 'Cold wallet', 'Toly').",
          },
          address: {
            type: "string",
            description: "Wallet address (base58) or .sol name to save.",
          },
        },
        required: ["name", "address"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_contract",
      description:
        "Run a safety/rug-risk audit on a Solana token: mint authority, freeze authority, LP lock %, top holder concentration, transfer tax, and known scam flags. Use for any safety/legitimacy question ('is X safe', 'rug check', 'honeypot', 'who holds this', 'is LP locked'), or proactively when the user pastes an unfamiliar mint.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Token ticker (e.g. 'WIF') or full Solana mint address.",
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
      name: "get_token_chart",
      description:
        "Fetch OHLCV price candles across selectable intervals (5m, 15m, 1h, 4h, 1d). Works for Solana SPL tokens (chart is built from the most-liquid Solana DEX pool) AND for major-cap coins across all chains — BTC, ETH, XRP, BNB, ADA, DOGE, etc — anything in the CoinGecko top-250 (chart is aggregated cross-exchange CEX pricing, not a single low-liquidity pool). Use whenever the user asks for a chart, price action, trend, or to 'show' the price for a token.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Token ticker (e.g. 'BTC', 'ETH', 'SOL', 'BONK'), full coin name, or Solana mint address.",
          },
          interval: {
            type: "string",
            enum: ["5m", "15m", "1h", "4h", "1d"],
            description: "Candle interval. Default to '1h' if user doesn't specify.",
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
      name: "get_social_sentiment",
      description:
        "Fetch Twitter/X + Reddit + news sentiment, social volume, contributor counts, top recent posts and Galaxy Score for a token. Use for any 'what's twitter saying', 'sentiment', 'is X trending', 'vibe check', 'lore', 'narrative' question.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Token ticker (e.g. 'BONK', 'JUP') or full Solana mint address.",
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
      name: "get_solana_news",
      description:
        "Fetch the latest Solana ecosystem news headlines from Solana Foundation, CoinDesk, Decrypt, Reddit r/solana and CoinGecko. Use for any 'what's new on Solana', 'latest news', 'any updates', 'ecosystem news', 'headlines', 'what's happening' question. No arguments.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_early_buyers",
      description:
        "Find which curated/tracked smart-money wallets bought a token in its first 24h after launch. Use for 'who bought X early', 'smart money on X', 'did pros ape X', 'early buyers', 'who got in early on X'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Token ticker (e.g. 'WIF', 'BONK') or full Solana mint address.",
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
      name: "get_smart_money_activity",
      description:
        "Show recent buys/sells from curated and user-tracked smart-money wallets. Use for 'what is smart money buying', 'what are pros trading', 'tracked wallet activity', 'smart-money feed', 'any alpha right now'.",
      parameters: {
        type: "object",
        properties: {
          windowHours: {
            type: "number",
            description: "Lookback window in hours. Default 24, max 168 (7 days).",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_wallet_pnl",
      description:
        "Full 30-day PnL dashboard for a Solana wallet: per-token realized + unrealized profit, totals, and current holdings. Use for 'how am I doing', 'my pnl', 'show performance', 'am I up or down'. Defaults to the connected wallet if no address is given.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "Optional wallet address to analyze. Omit to use the connected wallet.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_txs",
      description:
        "Last 30 days of parsed transactions (swaps, transfers in/out) for a Solana wallet with USD values. Use for 'recent transactions', 'what did I trade', 'tx history', 'show my activity'. Defaults to the connected wallet.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "Optional wallet address. Omit to use the connected wallet.",
          },
          limit: {
            type: "number",
            description: "Max number of recent txs to return (5-50). Default 25.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_token_pnl",
      description:
        "Single-token PnL deep-dive for a Solana wallet: bought/sold amounts, average entry, realized + unrealized P/L, current position. Use for 'how am I doing on $X', 'my pnl on X', 'am I up on X'.",
      parameters: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description: "Token ticker (e.g. 'BONK', 'JUP') or full mint address.",
          },
          address: {
            type: "string",
            description: "Optional wallet address. Omit to use the connected wallet.",
          },
        },
        required: ["token"],
        additionalProperties: false,
      },
    },
  },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { messages, walletAddress, profile, contacts, userId } = payload;
  const contactList: { name: string; address: string; resolved_address: string | null }[] =
    Array.isArray(contacts) ? contacts : [];
  const userIdValue: string | null = typeof userId === "string" ? userId : null;

  if (!Array.isArray(messages)) {
    return json({ error: "messages must be an array" }, 400);
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return json({ error: "LOVABLE_API_KEY missing" }, 500);
  }

  const profileBlock = buildProfileBlock(profile);
  const contactsBlock = buildContactsBlock(contactList);
  const systemContent = [SYSTEM_PROMPT, profileBlock, contactsBlock]
    .filter(Boolean)
    .join("\n\n");

  const conversation: any[] = [
    { role: "system", content: systemContent },
    ...messages,
  ];

  const lastUserMessage = [...messages].reverse().find(
    (m) => m && typeof m.content === "string" && m.role === "user",
  );

  // Build an SSE response. We emit three event types:
  //   event: tool   -> tool result card payloads
  //   event: delta  -> assistant text token chunks
  //   event: error  -> { error, status } before stream closes
  //   event: done   -> end-of-stream marker
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      // Tool cards are buffered here and only flushed once the model starts
      // streaming its post-tool framing text (or right before stream end).
      // That gives the UI a smooth "text first, card slides in below" feel
      // instead of "card pops in, then text appends above and shifts the card".
      const pendingCards: Array<{ type: string; data: unknown }> = [];
      const flushPendingCards = () => {
        while (pendingCards.length > 0) {
          const card = pendingCards.shift()!;
          send("tool", card);
        }
      };

      // Track tools already invoked this turn so we never emit duplicate
      // cards if the model decides to call the same tool again.
      const emittedToolKeys = new Set<string>();
      let cardEmitted = false;
      let toolErrored = false;
      // Set when we forcibly inject a tool call because the model already
      // produced text without invoking the right tool. After the card is
      // emitted we exit the loop so the model can't write a second framing.
      let isForcedFallbackTurn = false;

      try {
        for (let iter = 0; iter < 3; iter++) {
          const isLastIter = iter === 2;

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
              stream: true,
            }),
          });

          if (!aiResp.ok || !aiResp.body) {
            if (aiResp.status === 429) {
              send("error", { error: "Rate limit hit. Wait a moment and try again.", status: 429 });
              break;
            }
            if (aiResp.status === 402) {
              send("error", {
                error: "AI credits exhausted. Add funds in Settings → Workspace → Usage.",
                status: 402,
              });
              break;
            }
            const errText = await aiResp.text().catch(() => "");
            console.error("AI gateway error:", aiResp.status, errText);
            send("error", { error: "AI gateway error", status: 500 });
            break;
          }

          // Parse the SSE response from the gateway. We accumulate text in
          // `assistantText` and assemble tool calls (which can stream their
          // arguments across many chunks) in `pendingToolCalls`. Text deltas
          // are forwarded immediately so the user sees tokens as they arrive.
          const reader = aiResp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let assistantText = "";
          const pendingToolCalls: Array<{
            id: string;
            name: string;
            arguments: string;
          }> = [];
          let streamDone = false;

          while (!streamDone) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let nl: number;
            while ((nl = buffer.indexOf("\n")) !== -1) {
              let line = buffer.slice(0, nl);
              buffer = buffer.slice(nl + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (!line || line.startsWith(":")) continue;
              if (!line.startsWith("data: ")) continue;
              const payloadStr = line.slice(6).trim();
              if (payloadStr === "[DONE]") {
                streamDone = true;
                break;
              }
              let parsed: any;
              try {
                parsed = JSON.parse(payloadStr);
              } catch {
                // Partial JSON across chunks — put it back and wait.
                buffer = line + "\n" + buffer;
                break;
              }
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;

              if (typeof delta.content === "string" && delta.content.length > 0) {
                // First text token of this iteration — flush any buffered
                // tool cards from the previous iteration so the UI shows the
                // text first and then the card lands beneath it smoothly.
                if (pendingCards.length > 0) flushPendingCards();
                assistantText += delta.content;
                send("delta", { text: delta.content });
              }

              if (Array.isArray(delta.tool_calls)) {
                for (const tcDelta of delta.tool_calls) {
                  const idx = typeof tcDelta.index === "number" ? tcDelta.index : 0;
                  const slot = pendingToolCalls[idx] ??
                    (pendingToolCalls[idx] = { id: "", name: "", arguments: "" });
                  if (tcDelta.id) slot.id = tcDelta.id;
                  const fn = tcDelta.function;
                  if (fn?.name) slot.name = fn.name;
                  if (typeof fn?.arguments === "string") slot.arguments += fn.arguments;
                }
              }
            }
          }

          // No tool calls -> the streamed text IS the final answer unless we
          // need to force a live-data tool for the latest user request.
          if (pendingToolCalls.length === 0) {
            // If a card was already shown OR a tool errored this turn, the
            // assistant text is the wrap-up — we're done. Don't force again.
            if (cardEmitted || toolErrored) break;
            const forced = inferForcedToolCall(lastUserMessage?.content ?? "");
            if (forced) {
              pendingToolCalls.push({
                id: `forced_${crypto.randomUUID()}`,
                name: forced.name,
                arguments: JSON.stringify(forced.args),
              });
              isForcedFallbackTurn = true;
            } else {
              break;
            }
          }

          if (isLastIter) {
            // Only show the canned fallback if we haven't already shown a
            // card or written any text this turn.
            if (!cardEmitted && !assistantText.trim()) {
              send("delta", {
                text: "I tried but couldn't complete that — let's try a different angle.",
              });
            }
            break;
          }

          // Reconstruct the assistant message verbatim for the next round.
          conversation.push({
            role: "assistant",
            content: assistantText || null,
            tool_calls: pendingToolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.arguments },
            })),
          });

          const toolCalls = pendingToolCalls.map((tc) => ({
            id: tc.id,
            function: { name: tc.name, arguments: tc.arguments },
          }));

          for (const tc of toolCalls) {
            const name = tc.function?.name;
            const dedupeKey = `${name}:${(tc.function?.arguments ?? "").trim()}`;
            // If this exact tool was already invoked in this turn, skip it
            // entirely — feed the model a hint and don't emit a duplicate card.
            if (emittedToolKeys.has(dedupeKey)) {
              conversation.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify({
                  note: "Already shown to the user above. Do not call this tool again. Reply with nothing more.",
                }),
              });
              continue;
            }
            emittedToolKeys.add(dedupeKey);

            let result: any;
            let eventType: string | null = null;

            if (name === "get_wallet_balance") {
              const args = safeJson(tc.function?.arguments);
              const target = (args.address ?? "").trim() || walletAddress;
              if (!target) {
                result = { error: "No wallet connected" };
              } else {
                result = await invokeFn("wallet-balance", { address: target }, req);
              }
              eventType = "wallet_balance";
            } else if (name === "get_token_info") {
              const args = safeJson(tc.function?.arguments);
              result = await invokeFn("token-info", { query: args.query ?? "" }, req);
              eventType = "token_info";
            } else if (name === "get_trending") {
              result = await invokeFn("trending-tokens", {}, req);
              eventType = "trending";
            } else if (name === "prepare_swap") {
              const args = safeJson(tc.function?.arguments);
              result = await invokeFn("swap-quote", {
                inputToken: args.inputToken ?? "",
                outputToken: args.outputToken ?? "",
                amount: args.amount,
                slippageBps: args.slippageBps,
              }, req);
              eventType = "swap_quote";
            } else if (name === "prepare_transfer") {
              const args = safeJson(tc.function?.arguments);
              if (!walletAddress) {
                result = { error: "No wallet connected. Connect your wallet first." };
              } else {
                let recipientInput: string = args.recipient ?? "";
                let contactDisplayName: string | null = null;
                const matchedContact = findContact(contactList, recipientInput);
                if (matchedContact) {
                  recipientInput = matchedContact.resolved_address || matchedContact.address;
                  contactDisplayName = matchedContact.name;
                }

                const recipientResolved = await resolveRecipientInline(recipientInput);

                if ((recipientResolved as any)?.error) {
                  result = recipientResolved;
                } else {
                  result = await invokeFn("transfer-quote", {
                    fromAddress: walletAddress,
                    token: args.token ?? "",
                    amount: args.amount,
                    recipient: args.recipient ?? "",
                    resolvedAddress: (recipientResolved as any).address,
                    displayName: contactDisplayName ?? (recipientResolved as any).displayName ?? null,
                  }, req);
                  if (result && typeof result === "object" && !result.error) {
                    result.savedContact = !!matchedContact ||
                      !!findContactByAddress(contactList, (recipientResolved as any).address);
                  }
                }
              }
              eventType = "transfer_quote";
            } else if (name === "list_contacts") {
              result = {
                contacts: contactList.map((c) => ({
                  name: c.name,
                  address: c.address,
                  resolvedAddress: c.resolved_address,
                })),
              };
              eventType = "contact_list";
            } else if (name === "save_contact") {
              const args = safeJson(tc.function?.arguments);
              const cname = String(args.name ?? "").trim();
              const caddr = String(args.address ?? "").trim();
              if (!cname || !caddr) {
                result = { error: "Both name and address are required to save a contact." };
              } else if (findContact(contactList, cname)) {
                result = {
                  error: `You already have a contact named "${cname}". Pick a different name.`,
                };
              } else {
                result = { ok: true, name: cname, address: caddr };
              }
              pendingCards.push({
                type: "save_contact_request",
                data: { name: cname, address: caddr, error: result.error ?? null },
              });
              cardEmitted = true;
              conversation.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(result),
              });
              continue;
            } else if (name === "analyze_contract") {
              const args = safeJson(tc.function?.arguments);
              result = await invokeFn("contract-analyzer", { query: args.query ?? "" }, req);
              eventType = "risk_report";
            } else if (name === "get_token_chart") {
              const args = safeJson(tc.function?.arguments);
              result = await invokeFn(
                "token-chart",
                { query: args.query ?? "", interval: args.interval ?? "1h" },
                req,
              );
              eventType = "token_chart";
            } else if (name === "get_social_sentiment") {
              const args = safeJson(tc.function?.arguments);
              result = await invokeFn("social-sentiment", { query: args.query ?? "" }, req);
              eventType = "social_sentiment";
            } else if (name === "get_solana_news") {
              result = await invokeFn("solana-news", {}, req);
              eventType = "solana_news";
            } else if (name === "get_early_buyers") {
              const args = safeJson(tc.function?.arguments);
              result = await invokeFn(
                "smart-money-early-buyers",
                { query: args.query ?? "", userId: userIdValue },
                req,
              );
              eventType = "early_buyers";
            } else if (name === "get_smart_money_activity") {
              const args = safeJson(tc.function?.arguments);
              result = await invokeFn(
                "smart-money-activity",
                { userId: userIdValue, windowHours: args.windowHours },
                req,
              );
              eventType = "smart_money_activity";
            } else if (name === "get_wallet_pnl") {
              const args = safeJson(tc.function?.arguments);
              const target = (args.address ?? "").trim() || walletAddress;
              if (!target) {
                result = { error: "No wallet connected and no address provided." };
              } else {
                result = await invokeFn(
                  "wallet-pnl",
                  { address: target, slice: "wallet_pnl" },
                  req,
                );
              }
              eventType = "wallet_pnl";
            } else if (name === "get_recent_txs") {
              const args = safeJson(tc.function?.arguments);
              const target = (args.address ?? "").trim() || walletAddress;
              if (!target) {
                result = { error: "No wallet connected and no address provided." };
              } else {
                result = await invokeFn(
                  "wallet-pnl",
                  { address: target, slice: "recent_txs", limit: args.limit ?? 25 },
                  req,
                );
              }
              eventType = "recent_txs";
            } else if (name === "get_token_pnl") {
              const args = safeJson(tc.function?.arguments);
              const target = (args.address ?? "").trim() || walletAddress;
              if (!target) {
                result = { error: "No wallet connected and no address provided." };
              } else if (!args.token) {
                result = { error: "Token ticker or mint required." };
              } else {
                result = await invokeFn(
                  "wallet-pnl",
                  { address: target, slice: "token_pnl", tokenFilter: args.token },
                  req,
                );
              }
              eventType = "token_pnl";
            } else {
              result = { error: `Unknown tool: ${name}` };
            }

            // If the tool errored, don't emit a card with a raw error string.
            // Just feed the (clean) error back to the model so it can write
            // a friendly explanation. Server-side details stay in logs.
            const hasError = result && typeof result === "object" && "error" in result && result.error;
            if (hasError) {
              console.error(`[chat] tool ${name} returned error:`, result.error);
              toolErrored = true;
            }

            // Emit the tool card immediately so the user sees it before the
            // model finishes writing its framing text — but only on success.
            if (eventType && !hasError) {
              send("tool", { type: eventType, data: result });
              cardEmitted = true;
            }

            // When a tool errors, append a strict instruction so the model
            // writes ONE brief explanation and stops — no second paraphrase.
            const toolPayload = hasError
              ? {
                  error: result.error,
                  instructions:
                    "Write exactly ONE short, friendly sentence telling the user what couldn't be done and stop. Do not repeat yourself. Do not call any more tools.",
                }
              : result;

            conversation.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(toolPayload),
            });
          }

          // If this round was triggered by our forced fallback (model already
          // wrote framing without calling a tool), stop now — otherwise the
          // next iteration would have the model write another paragraph
          // duplicating what it just said.
          if (isForcedFallbackTurn && cardEmitted) break;
        }

        send("done", {});
      } catch (e) {
        console.error("chat stream error:", e);
        send("error", {
          error: e instanceof Error ? e.message : "Unknown error",
          status: 500,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});

function safeJson(s: unknown): any {
  if (typeof s !== "string") return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

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
    console.error(`[invokeFn] ${name} HTTP ${resp.status}:`, t);
    let cleanError = "The data source is unavailable right now.";
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed.error === "string") cleanError = parsed.error;
    } catch { /* ignore */ }
    return { error: cleanError };
  }
  return await resp.json();
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function resolveRecipientInline(
  recipient: string,
): Promise<{ address: string; displayName: string | null } | { error: string }> {
  const trimmed = (recipient ?? "").trim();
  if (!trimmed) return { error: "recipient required" };

  if (trimmed.toLowerCase().endsWith(".sol")) {
    try {
      const resp = await fetch(
        `https://sdk-proxy.sns.id/resolve/${encodeURIComponent(trimmed)}`,
      );
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || data.s !== "ok" || typeof data.result !== "string") {
        return {
          error:
            `I couldn't resolve "${trimmed}" right now. Try again in a moment, or paste the wallet address.`,
        };
      }
      const result = data.result.trim();
      if (!BASE58_RE.test(result)) {
        return { error: `Resolver returned an invalid address for "${trimmed}".` };
      }
      return { address: result, displayName: trimmed.toLowerCase() };
    } catch (e) {
      console.error("SNS resolve error:", e);
      return {
        error:
          `I couldn't resolve "${trimmed}" right now. Try again in a moment, or paste the wallet address.`,
      };
    }
  }

  if (BASE58_RE.test(trimmed)) {
    return { address: trimmed, displayName: null };
  }

  return { error: "Recipient must be a wallet address or .sol name." };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function inferForcedToolCall(message: string):
  | { name: "get_wallet_balance"; args: { address?: string } }
  | { name: "get_token_chart"; args: { query: string; interval?: string } }
  | { name: "get_social_sentiment"; args: { query: string } }
  | null {
  const raw = (message ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const addressMatch = raw.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  const address = addressMatch?.[0];
  const holdingsIntent = /\b(holdings|holding|balance|portfolio|wallet holdings|what(?:'| i)?s in (?:this |that |my )?wallet|what does .* hold|show me .* holdings|show .* portfolio)\b/.test(lower);
  const chartIntent = /\b(chart|candles|candle|price action|how's it looking|trend|graph)\b/.test(lower);
  const sentimentIntent = /\b(sentiment|social|twitter|x\b|reddit|vibe check|lore)\b/.test(lower);

  if (holdingsIntent) {
    return { name: "get_wallet_balance", args: address ? { address } : {} };
  }

  if (!chartIntent && !sentimentIntent) return null;

  const interval =
    lower.includes("5m") ? "5m"
      : lower.includes("15m") ? "15m"
      : lower.includes("4h") ? "4h"
      : lower.includes("1d") || lower.includes("daily") ? "1d"
      : "1h";

  let query = address ?? "";

  if (!query) {
    const cleaned = raw
      .replace(/\$/g, "")
      .replace(/\b(chart|candles|candle|price action|how's it looking|trend|graph|social|sentiment|twitter|reddit|vibe check|lore|for|about|on|show me|send me|the|hourly|daily)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) query = cleaned;
  }

  if (!query) return null;

  if (chartIntent) return { name: "get_token_chart", args: { query, interval } };
  return { name: "get_social_sentiment", args: { query } };
}

function buildProfileBlock(profile: any): string | null {
  if (!profile || typeof profile !== "object") return null;
  const lines: string[] = [];
  const name = typeof profile.displayName === "string" ? profile.displayName.trim() : "";
  if (name) lines.push(`- The user's name is **${name}**. Greet them by name on the first message of a conversation, and weave it in naturally during casual chat (don't overdo it).`);

  const exp = profile.experience;
  if (exp === "new") {
    lines.push("- They are NEW to crypto. Define jargon the first time you use it (gas, slippage, AMM, mint, etc.). Bias toward simple analogies. Don't condescend.");
  } else if (exp === "intermediate") {
    lines.push("- They are COMFORTABLE with crypto. Skip 101 explanations unless asked. Use standard terminology freely.");
  } else if (exp === "advanced") {
    lines.push("- They are ADVANCED (degen-tier). Skip explainers entirely. Be terse, dense, and assume deep knowledge of Solana primitives, MEV, LSTs, perps, etc.");
  }

  if (Array.isArray(profile.interests) && profile.interests.length > 0) {
    lines.push(`- They're into: ${profile.interests.join(", ")}. Lean into these topics when relevant; surface news, tools, or angles they'd care about.`);
  }

  const risk = profile.riskTolerance;
  if (risk === "cautious") {
    lines.push("- Risk tone: CAUTIOUS. Flag downside risks early and clearly. Prefer mentioning blue-chips and audited protocols. Don't pitch degen plays.");
  } else if (risk === "balanced") {
    lines.push("- Risk tone: BALANCED. Note risks honestly but don't moralise. Pragmatic framing.");
  } else if (risk === "aggressive") {
    lines.push("- Risk tone: AGGRESSIVE. They want signal not safety rails. State risks once, plainly, then move on. No hand-wringing.");
  }

  if (lines.length === 0) return null;
  return `User context:\n${lines.join("\n")}\n\nNever fabricate facts about the user beyond what's listed above.`;
}

interface ContactLite {
  name: string;
  address: string;
  resolved_address: string | null;
}

function findContact(list: ContactLite[], needle: string): ContactLite | null {
  const n = (needle ?? "").trim().toLowerCase();
  if (!n) return null;
  return list.find((c) => c.name.toLowerCase() === n) ?? null;
}

function findContactByAddress(list: ContactLite[], address: string): ContactLite | null {
  const a = (address ?? "").trim();
  if (!a) return null;
  return list.find((c) => c.address === a || c.resolved_address === a) ?? null;
}

function buildContactsBlock(list: ContactLite[]): string | null {
  if (!list.length) return null;
  const lines = list
    .slice(0, 50)
    .map((c) => `- ${c.name} → ${c.resolved_address || c.address}`);
  return `Saved contacts (the user's address book — use these names when they refer to people by nickname):\n${lines.join("\n")}`;
}
