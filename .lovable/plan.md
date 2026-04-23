

## Step 5: Swap Preview Card

Vision learns to **prepare swaps** — read a sentence like "swap 10 USDC to SOL", fetch a real Jupiter quote, and render a preview card in chat. **No signing yet** — that's Step 6. This step nails the UX and proves the quote pipeline.

### What you'll see

Type **"swap 0.1 SOL for USDC"** (or JUP, BONK, anything). Vision replies with one short sentence and a card:

```text
┌─────────────────────────────────────────┐
│  Swap preview                           │
│                                         │
│   0.1 SOL          →     ~14.82 USDC    │
│   ≈ $14.85               ≈ $14.82       │
│                                         │
│   Rate     1 SOL = 148.20 USDC          │
│   Impact   0.02%        ● low           │
│   Slippage 0.5% (auto)                  │
│   Route    SOL → USDC  via Raydium      │
│   Fee      ~0.00008 SOL network         │
│                                         │
│   [ Confirm & sign ]   [ Cancel ]       │
│                                         │
│   Quote refreshes every 15s             │
└─────────────────────────────────────────┘
```

Buttons are **visible but disabled** with a tooltip: "Signing ships in the next step." This keeps the UX honest while we build toward Step 6.

### What gets built

**1. New edge function — `supabase/functions/swap-quote/index.ts`**
- Input: `{ inputMint, outputMint, amount, slippageBps? }` (amount in human units, e.g. `0.1`)
- Resolves tickers → mint addresses via the Jupiter token list (cached in-memory per cold start) so the AI can pass `"SOL"` or a full mint
- Calls Jupiter Quote API: `https://lite-api.jup.ag/swap/v1/quote`
- Enriches with token metadata (symbol, decimals, logo) and current USD prices (DexScreener, same source as Step 4)
- Returns a normalized payload: input/output token, amounts (raw + UI), USD values, price impact, route hops, slippage used, est. network fee

**2. New AI tool — `prepare_swap`**
Added to the `chat` edge function tool list:
```ts
{
  name: "prepare_swap",
  description: "Prepare a swap quote between two Solana tokens. Use whenever the user wants to swap, trade, exchange, or convert tokens. Never execute — only quote.",
  parameters: {
    inputToken: "ticker or mint of token to sell",
    outputToken: "ticker or mint of token to buy",
    amount: "decimal amount of inputToken to swap",
    slippageBps: "optional, default 50 (0.5%)"
  }
}
```
System prompt updated so the AI calls this tool whenever it detects a swap intent and frames replies as previews, not confirmations.

**3. New UI component — `src/components/SwapPreviewCard.tsx`**
- Same visual language as `TokenCard` / `PortfolioCard` (dark panel, lilac accents, JetBrains Mono for numbers)
- Color-coded price impact: green <1%, amber 1–3%, red >3%
- Route shown as `SOL → USDC` with the AMM name (Raydium, Orca, Meteora…)
- **Confirm & Sign** button rendered disabled with a tooltip; **Cancel** removes the card from the message
- Auto-refresh quote every 15s while the card is mounted (calls `swap-quote` again, swaps in the new numbers smoothly)

**4. Wire-up**
- `chat-stream.ts` → add `SwapQuoteData` type and `swap_quote` to the `ToolEvent` union
- `ChatBubble.tsx` → render `SwapPreviewCard` when `event.type === "swap_quote"` (placed below text, same as other cards after the fix from last step)

### What we explicitly defer to Step 6
- Wallet signing, transaction building, mainnet submission
- Confirmation toasts, Solscan links, retry-on-fail flow
- SNS (`.sol` name) resolution — that lives with transfers in Step 7

### Notes
- Jupiter's quote API is free and keyless — no new secrets needed
- DexScreener is already in use for USD pricing, so no new data source either
- The Jupiter token list (~5MB) is fetched once per function cold start and held in module scope — fast enough for chat latency

Approve and I'll build it.

