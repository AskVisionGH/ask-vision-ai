

## Trading screen — `/trade`

A dedicated page with the Vision dark/lilac aesthetic and a Jupiter-style swap module. Tabs: **Trade**, **Limit**, **Bridge**, **Buy**, **Sell** — only Trade is active; the rest render as disabled with a "Soon" pill.

### Layout

```text
┌─────────────────────────────────────────────────────────────┐
│  Sidebar      │  Header (logo + Connect wallet)             │
│  (existing)   ├─────────────────────────────────────────────┤
│               │            ┌───────────────────────┐         │
│  • Trade ←    │            │ Trade│Limit│Bridge│…  │ ⚙       │
│    (active)   │            ├───────────────────────┤         │
│               │            │ Sell                   │         │
│               │            │  0.00         [SOL ▾] │         │
│               │            │  $0.00                 │         │
│               │            ├──────── ⇅ ────────────┤         │
│               │            │ Buy                    │         │
│               │            │  0.00      [Select ▾] │         │
│               │            │  $0.00                 │         │
│               │            ├───────────────────────┤         │
│               │            │ Rate · Impact · Route │         │
│               │            ├───────────────────────┤         │
│               │            │   [Connect / Swap]    │         │
│               │            └───────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

Centered card, max-width ~440px, on top of the same `bg-aurora` glow used in Chat. Reuses sidebar shell so navigation feels identical.

### Files to create

1. **`src/pages/Trade.tsx`** — page shell mirroring Chat.tsx layout (sidebar + header with `ConnectWalletButton`). Renders `<TradeSwap />` centered.
2. **`src/components/trade/TradeSwap.tsx`** — main swap module:
   - Tab row at top: Trade (active), Limit, Bridge, Buy, Sell (disabled with `Soon` chip)
   - Sell input (amount + token picker, defaults to SOL) with USD value + balance pill ("Max" button when wallet connected)
   - Flip button (⇅) swaps input/output
   - Buy input (amount auto-filled from quote, output token picker, defaults to empty → "Select token")
   - Stats row: rate, price impact (color-coded), slippage (auto, click to open settings), route via N AMMs, network fee, 1% platform fee disclosure
   - Settings popover (gear icon): slippage tolerance (0.1 / 0.5 / 1.0 / custom bps)
   - Primary CTA: "Connect wallet" → opens wallet modal; or "Enter an amount" → "Select a token" → "Swap" with loading states
3. **`src/components/trade/TokenPickerDialog.tsx`** — modal token search (Jupiter-style): search by symbol/name/mint, show top tokens, recently used, and live results from `lite-api.jup.ag/tokens/v2/search`. Shows logo, symbol, name, price.
4. **`src/components/trade/TradeTabs.tsx`** — small pill-tab component, only Trade enabled.

### Files to modify

- **`src/App.tsx`** — register `<Route path="/trade" element={<ProtectedRoute><Trade /></ProtectedRoute>} />`.
- **`src/components/ChatSidebar.tsx`** — turn the existing disabled "Trade" button into an active `<Link to="/trade">` (remove "Soon" pill, keep `Repeat` icon, highlight when on `/trade`). Also add a Trade icon entry to the collapsed rail. Bridge stays disabled.

### Behavior

- **Quote fetching**: debounced (350ms) call to existing `swap-quote` edge function whenever input amount/token/output token/slippage changes. Auto-refresh every 15s while idle. Shows skeleton on the output amount while fetching.
- **Token defaults**: input = SOL (with native balance shown when wallet connected via `useWallet` + connection from `WalletContextProvider`); output = empty until user picks.
- **Confirm flow**: same as `SwapPreviewCard` — call `swap-build`, deserialize with `VersionedTransaction`, sign via wallet adapter, submit through `tx-submit`, poll `tx-status`. On success, show inline success state with Solscan link and a "Swap again" reset button.
- **Validation states for the CTA** (in order):
  1. Wallet not connected → "Connect wallet" (opens modal)
  2. No output token selected → "Select a token" (disabled)
  3. No amount or 0 → "Enter an amount" (disabled)
  4. Amount > balance → "Insufficient SOL/TOKEN" (disabled)
  5. Quote loading → "Fetching best price…" (disabled with spinner)
  6. Quote error → red banner + "Retry"
  7. Otherwise → "Swap" (lilac primary, `shadow-glow`)
- **Disabled tabs**: clicking Limit/Bridge/Buy/Sell does nothing; tooltip "Coming soon".

### Design tokens (already in `index.css`)

- Card: `bg-card/60 backdrop-blur-sm` + `border border-border` + `rounded-2xl`
- Active tab: `bg-secondary text-foreground`; inactive: `text-muted-foreground`; disabled: `text-muted-foreground/40` + `Soon` chip
- CTA: `bg-primary text-primary-foreground shadow-glow ease-vision`
- Token picker buttons: pill-shaped `bg-secondary hover:bg-muted` with token logo + symbol + chevron
- Mono font for amounts, regular for labels — matches `SwapPreviewCard`

### Reuses (no new edge functions needed)

- `swap-quote` for live pricing
- `swap-build` + `tx-submit` + `tx-status` for execution
- `TokenLogo` component, `useWallet`, `useWalletModal`, existing `supabase.functions.invoke` patterns from `SwapPreviewCard`

### Out of scope (future)

- Limit orders, Bridge (Wormhole/deBridge), Buy (on-ramp), Sell (off-ramp) — tabs are placeholders only
- Token balances for non-SOL output side (Max button only on input)
- Charts inside the swap card

