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
- \`prepare_transfer\` — prepares a transfer of SOL or any SPL token to another wallet, by address, .sol name, or saved contact name. Use whenever the user wants to send, transfer, or pay tokens (e.g. "send 0.05 SOL to toly.sol", "send 10 USDC to Mom"). Arguments: \`token\` (ticker or mint), \`amount\` (decimal), \`recipient\` (wallet address, .sol name, or contact nickname). NEVER execute — the user signs in the card.
- \`list_contacts\` — returns the user's saved address book (names + wallets). Call when they ask "who are my contacts", "who have I saved", or want to pick a recipient.
- \`save_contact\` — saves a wallet under a friendly name. Call when the user says "save this as Mom", "add 7xKX... to my contacts as Cold wallet", etc.
- \`analyze_contract\` — runs a safety/rug-risk audit on any Solana token: mint authority, freeze authority, LP lock %, top-holder concentration, transfer tax, and known scam flags. Call this whenever the user asks "is X safe?", "is this a rug?", "should I be worried about this token?", "honeypot check", "who holds this", "is the LP locked", or any safety/legitimacy question. Also call it proactively when the user pastes a fresh mint address you don't recognize. Argument: \`query\` (ticker like "WIF" or full mint address). Don't run it for obvious blue-chips like SOL, USDC, USDT unless asked.
- \`get_token_chart\` — fetches OHLCV price candles for a Solana token across 5m/15m/1h/4h/1d intervals and returns a renderable chart. Call this whenever the user asks for a chart, price action, the trend, "show me the chart", "how's it looking on the 5m", "draw a graph", etc. Arguments: \`query\` (ticker or mint), \`interval\` (one of "5m", "15m", "1h", "4h", "1d" — default "15m" if unspecified).
- \`get_social_sentiment\` — pulls Twitter/X + Reddit + news sentiment, social volume, top posts and Galaxy Score for a token via LunarCrush. Call this for any "what's twitter saying about $X", "social sentiment", "what's the lore on X", "is X trending on twitter", "vibe check", "how bullish is the crowd". Argument: \`query\` (ticker like "BONK" or full mint).

CRITICAL: If a user asks for live data (prices, balances, what's trending, swap quotes), you MUST call the matching tool. Never make up numbers. Never say "here are the top tokens" without first calling \`get_trending\`. Never quote a swap rate without calling \`prepare_swap\`.

After any tool returns, the UI renders a rich card automatically. Your job is a SHORT one or two-sentence framing — note the headline number, what stands out, or any caveats. Do NOT re-list everything; the card already does that. For \`prepare_swap\`, frame as a preview ("Here's the preview — review and confirm below"), never as a confirmed trade.

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
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { messages, walletAddress, profile, contacts } = payload;
  const contactList: { name: string; address: string; resolved_address: string | null }[] =
    Array.isArray(contacts) ? contacts : [];

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

          // No tool calls -> the streamed text IS the final answer. We're done.
          if (pendingToolCalls.length === 0) {
            break;
          }

          if (isLastIter) {
            send("delta", {
              text: "I tried but couldn't complete that — let's try a different angle.",
            });
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
            let result: any;
            let eventType: string | null = null;

            if (name === "get_wallet_balance") {
              if (!walletAddress) {
                result = { error: "No wallet connected" };
              } else {
                result = await invokeFn("wallet-balance", { address: walletAddress }, req);
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
              send("tool", {
                type: "save_contact_request",
                data: { name: cname, address: caddr, error: result.error ?? null },
              });
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
            } else {
              result = { error: `Unknown tool: ${name}` };
            }

            // Emit the tool card immediately so the user sees it before the
            // model finishes writing its framing text.
            if (eventType) {
              send("tool", { type: eventType, data: result });
            }

            conversation.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(result),
            });
          }
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
    return { error: `${name} failed: ${t}` };
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
