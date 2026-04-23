
# Vision App — v1 Build Plan

Build `app.askvision.ai`: a conversational AI interface for Solana, with a clear path to Base + bridging later. Inherits the exact dark/lilac aesthetic from your landing page.

## Tech stack (locked)
- **Frontend:** React 18 + Vite + TypeScript + Tailwind (Lovable's stack)
- **Backend:** Lovable Cloud (Supabase) — auth, database, edge functions, secrets
- **AI:** Lovable AI Gateway — `google/gemini-3-flash-preview` for intent parsing & chat
- **Wallets:** Solana Wallet Adapter (Phantom, Solflare, Backpack) — direct, no third-party SDK
- **Solana RPC:** Helius (free tier, best DX) — API key stored in Lovable Cloud secrets
- **Swaps:** Jupiter Aggregator API (no key required)
- **Token data:** Jupiter token list + Birdeye/DexScreener for prices
- **Hosting:** Lovable's hosting → custom domain `app.askvision.ai`

## Design system (from your landing page)
- Background `#09090b`, panels `#111114` / `#16161a`
- Borders `rgba(255,255,255,.08)`, text `#f4f4f5` / dim `#a1a1aa`
- Accent lilac `#c4b5fd`, glow `#8b5cf6`
- Fonts: **Geist** (UI), **Instrument Serif italic** (accents), **JetBrains Mono** (chat/code/captions)
- Subtle grain overlay, radial purple aurora glows, smooth `cubic-bezier(.2,.7,.2,1)` easing
- White triangle logo, pill-shaped buttons, 14px / 20px radii

## v1 — what we ship first (the foundation)

**1. App shell & auth**
- Landing screen at `/` matching your "almost here" page energy: triangle + beam, "Connect wallet to begin"
- Solana Wallet Adapter modal (Phantom / Solflare / Backpack)
- Wallet address = identity. Lovable Cloud stores user profile keyed to wallet address (signed message proves ownership)
- Persistent sidebar after connect: chat history, settings, disconnect

**2. Conversational chat (the core)**
- Full-screen chat UI, JetBrains Mono input, markdown-rendered AI replies, streaming token-by-token
- System prompt teaches the AI to recognize crypto intents and call structured tools
- Edge function `chat` proxies to Lovable AI Gateway with conversation history
- Suggested prompts on empty state: "What's in my wallet?", "Swap 10 USDC to SOL", "Show trending tokens"

**3. Intent recognition via tool-calling**
The AI uses structured tool calls (not freeform JSON) for these intents in v1:
- `get_wallet_balance` — show SOL + SPL token holdings with USD values
- `get_token_info` — price, 24h change, market cap, links
- `get_trending` — top tokens by volume from DexScreener
- `prepare_swap` — Jupiter quote + route for "swap X for Y"
- `prepare_transfer` — SOL or SPL token send

**4. Action preview cards (the "human-readable preview")**
- AI never executes silently. Every action returns a rich preview card rendered inline in chat:
  - Swap: from-token → to-token, amount in/out, price impact, slippage, route, fees, ~USD
  - Transfer: recipient (with `.sol` SNS resolution), amount, network fee
- Two buttons: **Confirm & Sign** / **Cancel**

**5. On-chain execution (real, on Solana mainnet)**
- Confirm → build transaction client-side using Jupiter / @solana/web3.js
- Wallet adapter prompts user to sign in their wallet
- Submit via Helius RPC, show toast with progress, link to Solscan on success
- Failed/rejected tx shown inline in chat with retry option

**6. Wallet & history pages**
- `/wallet` — clean portfolio view: tokens, balances, USD totals (uses same data as chat)
- `/history` — past conversations + past transactions (synced from on-chain)

## What we explicitly defer (so we ship)
- Base / EVM chains → v2 (after Solana works end-to-end)
- Bridging via LiFi → v2
- Privy embedded wallets → v2 (Wallet Adapter is fine for crypto-native users)
- Limit orders, DCA, perps, NFTs, pump.fun integration → later
- Mobile app → web is responsive; native later

## Setup tasks before first code
- Enable Lovable Cloud (auto)
- You create a free **Helius** account → grab API key → I'll add it as a Cloud secret
- Connect GitHub once we have something working (you mentioned you already use this pattern)

## Build order (for our chats — we'll do these one at a time)
1. **Today:** App shell, dark theme, design tokens, landing/connect screen, wallet adapter integration
2. **Next:** Chat UI + AI streaming + basic conversation (no tools yet, just talking)
3. **Then:** First tool — `get_wallet_balance` end-to-end (proves the architecture)
4. **Then:** Token info + trending (read-only, low risk)
5. **Then:** Swap preview card + Jupiter quote (still no signing)
6. **Then:** Real swap execution with wallet signing (the big milestone)
7. **Then:** Transfers + SNS resolution
8. **Then:** Wallet page, history, polish, custom domain

Each step is a separate chat so you can see, test, and learn before we move on. Approve this and we'll start with step 1.
