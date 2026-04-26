// Pool of starter prompts shown on the empty-chat screen. We rotate a fresh
// set of 4 every time the user logs in or starts a new chat so the surface
// feels alive instead of static.
//
// Keep entries:
//  - actionable (start with a verb where possible)
//  - short (fits on two lines on mobile)
//  - varied across the product surface (swap, bridge, research, alerts, etc.)
const SUGGESTION_POOL: string[] = [
  // Trading
  "Swap 1 SOL into USDC",
  "Swap 50 USDC into JUP",
  "Set a limit order to buy SOL at $140",
  "DCA $100 into SOL every week",
  "Set a take-profit on my biggest position",

  // Bridging
  "Bridge 0.5 SOL to ETH on Ethereum",
  "Bridge 100 USDC from Solana to Base",
  "What's the cheapest way to get USDC onto Arbitrum?",

  // Discovery / research
  "Find smart money buying memecoins right now",
  "Show me the hottest tokens trending on Solana",
  "Which wallets are accumulating BONK this week?",
  "What are the top movers in the last 24 hours?",
  "Show me new tokens with strong early buyers",

  // Historical wallet × token deep-dives
  "When did this wallet first buy BONK?",
  "Find the earliest entry of a wallet into a token",
  "Show every historical buy and sell of WIF by a wallet",
  "How long has this wallet held JUP?",

  // Portfolio / wallet
  "What's in my wallet right now?",
  "How is my portfolio performing this week?",
  "What's my biggest unrealized gain?",
  "Show my recent swaps",

  // Token deep-dives
  "Give me a risk report on JUP",
  "Pull up the chart for WIF",
  "What's the social sentiment around SOL today?",
  "Analyze this token for me",

  // Alerts / automation
  "Alert me if SOL drops below $130",
  "Notify me when my portfolio is up 10%",
  "Watch this wallet and ping me on big buys",

  // Transfers / contacts
  "Send 5 USDC to a contact",
  "How do I save a wallet as a contact?",

  // Solana basics / how-to
  "Explain what Jupiter actually does",
  "What's a good wallet for beginners?",
  "How do priority fees work on Solana?",
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
