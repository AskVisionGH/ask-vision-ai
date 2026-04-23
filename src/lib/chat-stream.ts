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

export interface SwapTokenSide {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
  amountUi: number;
  amountAtomic: number;
  valueUsd: number | null;
}

export interface SwapRouteHop {
  ammKey: string | null;
  label: string;
  inputMint: string | null;
  outputMint: string | null;
}

export interface SwapQuoteData {
  input: SwapTokenSide;
  output: SwapTokenSide;
  rate: number;
  priceImpactPct: number | null;
  slippageBps: number;
  route: SwapRouteHop[];
  estNetworkFeeSol: number;
  quotedAt: number;
  error?: string;
}

export interface TransferQuoteData {
  from?: { address: string };
  to?: { address: string; displayName: string | null; isOnCurve: boolean };
  token?: {
    symbol: string;
    name: string;
    mint: string;
    decimals: number;
    logo: string | null;
    priceUsd: number | null;
    isNative: boolean;
    tokenProgram: string;
  };
  amountUi?: number;
  amountAtomic?: number;
  valueUsd?: number | null;
  needsAtaCreation?: boolean;
  ataCreationFeeSol?: number;
  estNetworkFeeSol?: number;
  quotedAt?: number;
  savedContact?: boolean;
  error?: string;
}

export type RiskCheckStatus = "good" | "warn" | "bad" | "unknown";

export interface RiskCheck {
  id: string;
  label: string;
  status: RiskCheckStatus;
  detail: string;
}

export interface RiskReportData {
  symbol: string;
  name: string;
  address: string;
  logo: string | null;
  /** 0-100, lower is safer. */
  score: number;
  verdict: "safe" | "caution" | "risky" | "danger" | "unknown";
  headline: string;
  checks: RiskCheck[];
  sources: string[];
  stats: {
    topHolderPct: number | null;
    top10HolderPct: number | null;
    lpLockedPct: number | null;
    holderCount: number | null;
    mintAuthorityRevoked: boolean | null;
    freezeAuthorityRevoked: boolean | null;
  };
  error?: string;
}

export interface ChartCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type ChartInterval = "5m" | "15m" | "1h" | "4h" | "1d";

export interface TokenChartData {
  symbol: string;
  name: string;
  address: string;
  logo: string | null;
  pairAddress: string;
  pairUrl: string | null;
  interval: ChartInterval;
  candles: ChartCandle[];
  priceUsd: number | null;
  priceChangePct: number | null;
  high: number | null;
  low: number | null;
  error?: string;
}

export interface TaIndicators {
  rsi: number;
  macdLine: number;
  changePct: number;
  atrPct: number;
  volRatio: number;
  high: number;
  low: number;
}

export interface TaResponse {
  symbol: string;
  interval: ChartInterval;
  commentary: string;
  indicators: TaIndicators;
  error?: string;
}

export type SentimentVerdict =
  | "very_bullish"
  | "bullish"
  | "neutral"
  | "bearish"
  | "very_bearish"
  | "unknown";

export interface SentimentSeriesPoint {
  t: number;
  socialVolume: number;
  sentimentPct: number;
}

export interface SocialPost {
  id: string;
  network: string;
  url: string;
  title: string;
  creatorName: string | null;
  creatorAvatar: string | null;
  interactions24h: number;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  postedAt: number;
}

export interface SocialSentimentData {
  symbol: string;
  name: string;
  topic: string;
  bullishPct: number | null;
  galaxyScore: number | null;
  altRank: number | null;
  socialVolume24h: number | null;
  socialVolumeChangePct: number | null;
  contributors24h: number | null;
  sentimentVerdict: SentimentVerdict;
  headline: string;
  series: SentimentSeriesPoint[];
  topPosts: SocialPost[];
  sources: string[];
  reportUrl?: string | null;
  error?: string;
}

export type ToolEvent =
  | { type: "wallet_balance"; data: WalletBalanceData }
  | { type: "token_info"; data: TokenInfoData }
  | { type: "trending"; data: TrendingData }
  | { type: "swap_quote"; data: SwapQuoteData }
  | { type: "transfer_quote"; data: TransferQuoteData }
  | { type: "risk_report"; data: RiskReportData }
  | { type: "token_chart"; data: TokenChartData }
  | { type: "social_sentiment"; data: SocialSentimentData }
  | { type: string; data: any };

export interface ChatMessage {
  /** Database id, present once persisted. Used for in-place edits. */
  id?: string;
  /** Database created_at, present once persisted. Used to truncate from a point. */
  createdAt?: string;
  role: ChatRole;
  content: string;
  toolEvents?: ToolEvent[];
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const AUTH_TOKEN = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function toModelMessages(msgs: ChatMessage[]) {
  return msgs.map(({ role, content }) => ({ role, content }));
}

export interface UserProfileContext {
  displayName?: string | null;
  experience?: "new" | "intermediate" | "advanced" | null;
  interests?: string[];
  riskTolerance?: "cautious" | "balanced" | "aggressive" | null;
}

export interface ContactContext {
  name: string;
  address: string;
  resolved_address: string | null;
}

export interface StreamChatCallbacks {
  /** Called for each text delta from the assistant. */
  onDelta: (text: string) => void;
  /** Called when a tool result card arrives. */
  onToolEvent: (event: ToolEvent) => void;
  /** Called once at the end on success. */
  onDone: () => void;
  /** Called on stream error. status=0 for network/abort errors. */
  onError: (error: string, status: number) => void;
}

export async function streamChat(args: {
  messages: ChatMessage[];
  walletAddress?: string;
  profile?: UserProfileContext;
  contacts?: ContactContext[];
  signal?: AbortSignal;
} & StreamChatCallbacks): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        messages: toModelMessages(args.messages),
        walletAddress: args.walletAddress ?? null,
        profile: args.profile ?? null,
        contacts: args.contacts ?? [],
      }),
      signal: args.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      args.onError("Cancelled", 0);
      return;
    }
    args.onError("Network error. Check your connection.", 0);
    return;
  }

  if (!resp.ok || !resp.body) {
    let msg = "Something went wrong.";
    try {
      const data = await resp.json();
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    args.onError(msg, resp.status);
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // SSE parser keyed on event type. Each block is delimited by a blank line.
  let currentEvent = "message";
  let currentData = "";

  const flushEvent = () => {
    if (!currentData) {
      currentEvent = "message";
      return;
    }
    let parsed: any = null;
    try {
      parsed = JSON.parse(currentData);
    } catch {
      currentEvent = "message";
      currentData = "";
      return;
    }
    if (currentEvent === "delta") {
      if (typeof parsed?.text === "string") args.onDelta(parsed.text);
    } else if (currentEvent === "tool") {
      if (parsed?.type) args.onToolEvent(parsed as ToolEvent);
    } else if (currentEvent === "error") {
      args.onError(parsed?.error ?? "Stream error", parsed?.status ?? 500);
    }
    currentEvent = "message";
    currentData = "";
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          flushEvent();
          continue;
        }
        if (line.startsWith(":")) continue; // comment
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData = line.slice(5).trim();
        }
      }
    }
    // Flush whatever's left.
    if (buffer) {
      for (const raw of buffer.split("\n")) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line === "") flushEvent();
        else if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
        else if (line.startsWith("data:")) currentData = line.slice(5).trim();
      }
      flushEvent();
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      args.onError("Cancelled", 0);
      return;
    }
    args.onError("Stream interrupted", 0);
    return;
  }

  args.onDone();
}

