// Pool of starter prompts shown on the empty-chat screen. We rotate a fresh
// set of 4 every time the user logs in or starts a new chat so the surface
// feels alive instead of static.
//
// Keep entries:
//  - actionable (start with a verb where possible)
//  - short (fits on two lines on mobile)
//  - varied across the product surface (swap, bridge, research, alerts, etc.)
// Every prompt here MUST be answerable in a single shot — no follow-up
// questions required. That means: no ambiguous "this wallet" / "this token"
// references, no features we don't support yet (e.g. portfolio-% alerts),
// and no actions that need a missing input (recipient, amount, etc.).
const SUGGESTION_POOL: string[] = [
  // Trading — concrete amounts + tokens, instantly executable
  "Swap 1 SOL into USDC",
  "Swap 50 USDC into JUP",
  "Swap 0.1 SOL into BONK",
  "Set a limit order to buy SOL at $140",
  "Set a limit order to sell JUP at $1.20",
  "DCA $100 into SOL every week",
  "DCA $50 into JUP every day for a month",

  // Bridging — concrete chains + amounts
  "Bridge 0.5 SOL to ETH on Ethereum",
  "Bridge 100 USDC from Solana to Base",
  "Bridge 50 USDC from Solana to Arbitrum",
  "What's the cheapest way to get USDC onto Arbitrum?",

  // Discovery / research — no required context
  "Find smart money buying memecoins right now",
  "Show me the hottest tokens trending on Solana",
  "Which wallets are accumulating BONK this week?",
  "What are the top movers in the last 24 hours?",
  "Show me new tokens with strong early buyers",
  "Who are the early buyers of WIF?",

  // Portfolio / wallet — answered from the connected wallet
  "What's in my wallet right now?",
  "How is my portfolio performing this week?",
  "What's my biggest unrealized gain?",
  "Show my recent swaps",
  "Show my PnL for the last 30 days",

  // Token deep-dives — concrete tokens
  "Give me a risk report on JUP",
  "Pull up the chart for WIF",
  "What's the social sentiment around SOL today?",
  "Risk report on BONK",
  "Show me the chart for JUP",

  // Alerts — only price alerts (the only kind we actually support)
  "Alert me if SOL drops below $130",
  "Alert me if JUP rises above $1",
  "Alert me if BONK pumps 20% in 24h",

  // Solana basics / how-to — pure Q&A
  "Explain what Jupiter actually does",
  "What's a good wallet for beginners?",
  "How do priority fees work on Solana?",
  "How do I save a wallet as a contact?",
  "What's the difference between a limit order and DCA?",
];

/**
 * Pick `count` unique suggestions from the pool using a Fisher–Yates partial
 * shuffle — cheap, unbiased, and avoids duplicates within a single render.
 */
export const pickSuggestions = (count = 4): string[] => {
  const pool = [...SUGGESTION_POOL];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
};
