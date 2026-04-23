export type ChatRole = "user" | "assistant";

export interface TokenHolding {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  amount: number;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
}

export interface WalletBalanceData {
  address: string;
  totalUsd: number;
  holdings: TokenHolding[];
  tokenCount: number;
  error?: string;
}

export interface TokenInfoData {
  symbol: string;
  name: string;
  address: string;
  logo: string | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  priceChange1h: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  pairUrl: string | null;
  error?: string;
}

export interface TrendingToken {
  symbol: string;
  name: string;
  address: string;
  logo: string | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  pairUrl: string | null;
}

export interface TrendingData {
  tokens: TrendingToken[];
  error?: string;
}

export type ToolEvent =
  | { type: "wallet_balance"; data: WalletBalanceData }
  | { type: "token_info"; data: TokenInfoData }
  | { type: "trending"; data: TrendingData }
  | { type: string; data: any };

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolEvents?: ToolEvent[];
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const AUTH_TOKEN = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function toModelMessages(msgs: ChatMessage[]) {
  return msgs.map(({ role, content }) => ({ role, content }));
}

export async function sendChat(args: {
  messages: ChatMessage[];
  walletAddress?: string;
  signal?: AbortSignal;
}): Promise<{ content: string; toolEvents: ToolEvent[] } | { error: string; status: number }> {
  try {
    const resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        messages: toModelMessages(args.messages),
        walletAddress: args.walletAddress ?? null,
      }),
      signal: args.signal,
    });

    if (!resp.ok) {
      let msg = "Something went wrong.";
      try {
        const data = await resp.json();
        if (data?.error) msg = data.error;
      } catch {
        /* ignore */
      }
      return { error: msg, status: resp.status };
    }

    const data = await resp.json();
    return {
      content: data.content ?? "",
      toolEvents: Array.isArray(data.toolEvents) ? data.toolEvents : [],
    };
  } catch (e) {
    if ((e as Error).name === "AbortError") return { error: "Cancelled", status: 0 };
    return { error: "Network error. Check your connection.", status: 0 };
  }
}
