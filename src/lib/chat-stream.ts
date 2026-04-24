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
  platformFee?: {
    bps: number;
    amountUi: number;
    symbol: string;
    valueUsd: number | null;
  };
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
  /** "coingecko" for cross-exchange aggregated charts (BTC, ETH, etc),
   *  "solana-dex" for SPL tokens charted from a single Solana pool. */
  source?: "coingecko" | "solana-dex";
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

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  summary: string | null;
  thumbnail: string | null;
  kind: "article" | "reddit" | "blog";
}

export interface SolanaNewsData {
  items: NewsItem[];
  fetchedAt: number;
  sources: string[];
  error?: string;
}

export interface SmartWalletInfo {
  address: string;
  label: string | null;
  twitterHandle: string | null;
  category: string | null;
  isCurated: boolean;
  isUserTracked?: boolean;
  isUserAdded?: boolean;
}

export interface EarlyBuyer extends SmartWalletInfo {
  firstBuyAt: number;
  signature: string | null;
  firstBuyUsd: number | null;
  firstBuyAmount: number | null;
  currentValueUsd: number | null;
  multiplier: number | null;
  minutesAfterLaunch: number | null;
}

export interface EarlyBuyersData {
  token: {
    symbol: string;
    name: string;
    address: string;
    logo: string | null;
    priceUsd: number | null;
    pairUrl: string | null;
  } | null;
  launchTimestamp: number | null;
  curatedBuyers: EarlyBuyer[];
  totalCuratedTracked: number;
  windowHours: number;
  error?: string;
}

export interface SmartWalletMeta {
  address: string;
  label: string;
  twitterHandle: string | null;
  category: string | null;
  isCurated: boolean;
  isUserAdded: boolean;
}

export interface SmartMoneyWalletSummary {
  wallet: SmartWalletMeta;
  side: "buy" | "sell";
  count: number;
  totalUsd: number;
  totalAmount: number;
  latestTimestamp: number;
  latestSignature: string;
}

export interface SmartMoneyTokenActivity {
  token: {
    symbol: string;
    name: string;
    address: string;
    logo: string | null;
    pairUrl: string | null;
    priceUsd: number | null;
  };
  netUsd: number;
  buyUsd: number;
  sellUsd: number;
  buyerCount: number;
  sellerCount: number;
  totalTradeCount: number;
  latestTimestamp: number;
  wallets: SmartMoneyWalletSummary[];
}

export interface SmartMoneyActivityData {
  tokens: SmartMoneyTokenActivity[];
  walletsTracked: number;
  walletsActive: number;
  totalTrades: number;
  windowHours: number;
  fetchedAt: number;
  error?: string;
}

export interface ParsedTx {
  signature: string;
  timestamp: number;
  type: "swap" | "transfer_in" | "transfer_out" | "other";
  description: string | null;
  source: string | null;
  fee: number;
  inToken?: { mint: string; symbol: string; amount: number };
  outToken?: { mint: string; symbol: string; amount: number };
  solChange?: number;
  counterparty?: string | null;
  valueUsd: number | null;
}

export interface TokenPnL {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  buys: number;
  sells: number;
  costUsd: number;
  proceedsUsd: number;
  unitsBought: number;
  unitsSold: number;
  currentUnits: number;
  currentPriceUsd: number | null;
  currentValueUsd: number | null;
  realizedUsd: number;
  unrealizedUsd: number;
  pairUrl: string | null;
}

export interface WalletPnLData {
  address: string;
  windowDays: number;
  totals: {
    totalRealizedUsd: number;
    totalUnrealizedUsd: number;
    totalCostUsd: number;
    totalProceedsUsd: number;
    currentPortfolioUsd: number;
    txCount: number;
  };
  tokens: TokenPnL[];
  recentTxs: ParsedTx[];
  error?: string;
}

export interface RecentTxsData {
  address: string;
  windowDays: number;
  txs: ParsedTx[];
  totalCount: number;
  error?: string;
}

export interface TokenPnLData {
  address: string;
  windowDays: number;
  token: TokenPnL | null;
  recentTxs: ParsedTx[];
  error?: string;
}

export interface OrderTokenSide {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
}

export interface LimitOrderQuoteData {
  input: OrderTokenSide;
  output: OrderTokenSide;
  /** Amount of input being sold, UI units. */
  sellAmountUi: number;
  /** Limit price in OUTPUT per 1 INPUT. */
  limitPrice: number;
  /** Output the user will receive at the limit price. */
  receiveAmountUi: number;
  /** Current market mid (output per 1 input). */
  marketPrice: number | null;
  /** % delta of limit vs current market. */
  deltaPct: number | null;
  /** Seconds until expiry. null = good till cancelled. */
  expirySeconds: number | null;
  expiryLabel: string;
  sellValueUsd: number | null;
  receiveValueUsd: number | null;
  /** Will fill instantly because limit is too aggressive. */
  willFillInstantly: boolean;
  error?: string;
}

export interface DcaQuoteData {
  input: OrderTokenSide;
  output: OrderTokenSide;
  totalAmountUi: number;
  numberOfOrders: number;
  intervalSeconds: number;
  intervalLabel: string;
  perOrderUi: number;
  perOrderUsd: number | null;
  totalUsd: number | null;
  totalDurationSeconds: number;
  minPriceUsd: number | null;
  maxPriceUsd: number | null;
  error?: string;
}

export interface BracketQuoteData {
  input: OrderTokenSide;
  output: OrderTokenSide;
  sellAmountUi: number;
  sellValueUsd: number | null;
  entryMode: "market" | "limit";
  entryPriceUsd: number | null;
  entrySide: "above" | "below" | null;
  tpPriceUsd: number;
  slPriceUsd: number;
  marketPriceUsd: number | null;
  /** URL with prefilled state for /trade */
  tradeUrl: string;
  error?: string;
}

export interface LadderQuoteData {
  asset: OrderTokenSide;
  quote: OrderTokenSide;
  side: "buy" | "sell";
  totalAmountUi: number;
  totalUsd: number | null;
  rungCount: number;
  minPriceUsd: number;
  maxPriceUsd: number;
  averagePriceUsd: number;
  rungs: { priceUsd: number; spendUi: number; receiveUi: number }[];
  /** URL with prefilled state for /trade */
  tradeUrl: string;
  error?: string;
}

export interface OpenOrderSummary {
  kind: "limit" | "dca";
  /** Provider order id (for cancel) */
  id: string;
  inSymbol: string;
  outSymbol: string;
  inLogo: string | null;
  outLogo: string | null;
  /** Remaining input amount (UI units) */
  inAmount: number;
  /** Target output amount for limit orders */
  outAmount: number | null;
  /** For DCA: remaining cycles */
  remainingCycles: number | null;
  /** For DCA: per-cycle amount in input units */
  perCycleAmount: number | null;
  /** ms epoch */
  expiresAt: number | null;
  /** ms epoch (DCA next cycle) */
  nextCycleAt: number | null;
}

export interface OpenOrdersData {
  walletAddress: string | null;
  limitCount: number;
  dcaCount: number;
  totalCount: number;
  /** Up to ~6 most relevant orders for inline preview. */
  preview: OpenOrderSummary[];
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
  | { type: "solana_news"; data: SolanaNewsData }
  | { type: "early_buyers"; data: EarlyBuyersData }
  | { type: "smart_money_activity"; data: SmartMoneyActivityData }
  | { type: "wallet_pnl"; data: WalletPnLData }
  | { type: "recent_txs"; data: RecentTxsData }
  | { type: "token_pnl"; data: TokenPnLData }
  | { type: "limit_quote"; data: LimitOrderQuoteData }
  | { type: "dca_quote"; data: DcaQuoteData }
  | { type: "bracket_quote"; data: BracketQuoteData }
  | { type: "ladder_quote"; data: LadderQuoteData }
  | { type: "open_orders"; data: OpenOrdersData }
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
  /** BCP-47 / "auto" language code for AI replies. */
  language?: string | null;
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
  userId?: string | null;
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
        userId: args.userId ?? null,
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

