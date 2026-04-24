

# Limit Orders — Design & Plan

Building a beautiful, dead-simple limit order experience on the `/trade` screen using Jupiter's **Trigger API v1** (no API key required, supports our 1% referral fee).

## What you get (UX)

A new **Limit** tab next to **Trade** that mirrors the swap card layout, with one extra row: **target price**.

```text
┌─────────────────────────────────┐
│  ◢   [ TRADE | LIMIT ]    ⚙    │
├─────────────────────────────────┤
│ SELL                Bal: 4.21   │
│ 1.00          [SOL ▾]           │
│ ≈ $145.00                       │
├─────────────────────────────────┤
│ WHEN 1 SOL =                    │
│ 200.00 USDC  [Market +37%] 🔁  │ ← target price input
│ ≈ Order fills when SOL ≥ $200   │
├─────────────────────────────────┤
│ BUY (you receive)               │
│ 200.00        [USDC ▾]          │ ← auto-calc from price
├─────────────────────────────────┤
│ Expires: [1d] [7d] [30d] [Never]│
│ Platform fee: 1% on fill        │
├─────────────────────────────────┤
│   [   PLACE LIMIT ORDER   ]     │
└─────────────────────────────────┘

▼ Open orders (3)
  SELL 1 SOL → 200 USDC   in 6d 23h   [Cancel]
  BUY  500 BONK at $0.00002          [Cancel]
```

### Key UX touches
- **One field, both directions**: type either the receive amount *or* the price — the other auto-computes from the rate. Toggle with a tiny ⇄ icon.
- **Smart price chips**: quick-set the price to `Market`, `+1%`, `+5%`, `+10%`, `-5%` (sell side) or the inverse for buys. Pulls live market price from the existing `swap-quote` shadow call.
- **Live "distance from market" badge**: green chip "+12% above market" or red "-3% below" so users instantly see whether the order is realistic.
- **Expiry chips**: 1 day / 7 days / 30 days / Never — no date picker noise.
- **Open orders list** below the card: fetched from Jupiter, with token logos, time-to-expiry, and one-click cancel.
- **Same beautiful confirmation flow** as swaps — building → sign → submitting → success card with Solscan link.

## How it works (technical)

### New edge functions (3)

1. **`limit-order-build`** — Builds the createOrder transaction.
   - Calls `POST https://lite-api.jup.ag/trigger/v1/createOrder`
   - Params: `inputMint`, `outputMint`, `maker`, `payer`, `params: { makingAmount, takingAmount, expiredAt, feeBps: 100 }`, plus `feeAccount` (our derived referral PDA — same logic as `swap-build`).
   - Returns `{ requestId, transaction (base64) }` for the client to sign.
   - **Fee**: passes `feeBps: 100` and the referral `feeAccount` for the OUTPUT mint, so our 1% sweep applies on every fill.

2. **`limit-order-execute`** — Submits the signed createOrder tx.
   - Calls `POST https://lite-api.jup.ag/trigger/v1/execute` with `requestId` + `signedTransaction`.
   - Returns `{ signature, status }`. Polled the same way swaps are.

3. **`limit-order-list`** — Lists & cancels orders for a wallet.
   - `GET https://lite-api.jup.ag/trigger/v1/getTriggerOrders?user=<wallet>&orderStatus=active` for the open list.
   - For cancels: `POST /trigger/v1/cancelOrder` then `/execute`. Wrapped in the same edge function with an `action` param (`list` | `cancel`).

### New components (3)

- **`src/components/trade/TradeLimit.tsx`** — Main limit order card. Mirrors `TradeSwap.tsx`'s structure (token pickers, balance, MAX, settings popover) so it feels native. Local state: `inputToken`, `outputToken`, `sellAmount`, `targetPrice`, `expirySeconds`, plus a derived `buyAmount = sellAmount * targetPrice`. Fetches a tiny market quote via existing `swap-quote` to power the "distance from market" badge and "Market" chip.
- **`src/components/trade/LimitPriceField.tsx`** — Specialized price input with the preset chips (`Market`, `+1%`, `+5%`, `+10%`, custom %). Shows the +/- delta vs market.
- **`src/components/trade/OpenOrdersList.tsx`** — Renders user's active limit orders below the card with cancel buttons. Uses React Query to refetch every 30s and on visibility change.

### Wiring

- **`TradeTabs.tsx`**: flip `limit` to `enabled: true`, remove "Soon" badge.
- **`src/pages/Trade.tsx`**: lift the active tab into page state and conditionally render `<TradeSwap />` vs `<TradeLimit />` (currently the tab state lives inside `TradeSwap` — we'll hoist it).
- **Same shared pieces reused**: `TokenPickerDialog`, `TokenLogo`, `SwapSide`-style row component, the success card pattern, the slippage popover (replaced with "Expiry" popover for limit), and the glowing CTA button.

### Validation & safety

- Block submit if: target price is less favorable than market by >50% (warning modal: "This will fill instantly at a worse price than market — sure?").
- Block if `makingAmount > balance` (same `insufficient` check as swap).
- Min order size guard ($1 USD equivalent) to avoid dusty Jupiter rejects.
- All fetches go through the existing `supaPost` pattern → uniform error toasts.
- 7-day default expiry to prevent stale orders accumulating.

### Files added / changed

**New**
- `supabase/functions/limit-order-build/index.ts`
- `supabase/functions/limit-order-execute/index.ts`
- `supabase/functions/limit-order-manage/index.ts` (list + cancel)
- `src/components/trade/TradeLimit.tsx`
- `src/components/trade/LimitPriceField.tsx`
- `src/components/trade/OpenOrdersList.tsx`

**Modified**
- `src/components/trade/TradeTabs.tsx` — enable Limit tab
- `src/pages/Trade.tsx` — host tab state, switch components
- `src/components/trade/TradeSwap.tsx` — accept `tab` + `onTabChange` as props (small refactor to lift state)

### Out of scope (call out, don't build)
- OCO / TP-SL brackets (Jupiter v2 only — needs API key + JWT). Single limit orders only for v1.
- Notifications when an order fills (would need a poll job + email integration — separate ticket).

