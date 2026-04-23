

## Step 6: Sign & Submit Swaps

The preview card already shows live Jupiter quotes. Now we wire up the **Confirm & Sign** button so the swap actually executes on Solana mainnet through the user's connected wallet.

### What you'll see

In the preview card from Step 5, **Confirm & Sign** becomes enabled. Click it →

1. Button changes to `Building transaction…` (spinner)
2. Wallet popup appears asking to approve the swap
3. Button changes to `Submitting…` while it broadcasts
4. Card collapses into a compact **success state**:

```text
┌─────────────────────────────────────────┐
│  ✓ Swapped 0.1 SOL → 14.81 USDC          │
│    Confirmed in 1.4s                    │
│    Tx  5xK8…9aPq  ↗ Solscan             │
└─────────────────────────────────────────┘
```

If the user rejects the wallet popup, the card stays in preview mode with a small "Cancelled — try again or adjust" note. If the on-chain submit fails (slippage, expired blockhash, insufficient funds), the card shows a clear error and a **Retry** button that re-fetches a fresh quote.

### What gets built

**1. New edge function — `supabase/functions/swap-build/index.ts`**
- Input: the same quote object the preview already has, plus `userPublicKey`
- Calls Jupiter Swap API (`https://lite-api.jup.ag/swap/v1/swap`) to get a serialized v0 transaction ready for signing
- Sets sane defaults: `wrapAndUnwrapSol: true`, `dynamicComputeUnitLimit: true`, `prioritizationFeeLamports: "auto"` — so swaps land reliably without us hand-tuning fees
- Returns `{ swapTransaction: <base64>, lastValidBlockHeight, prioritizationFeeLamports }`
- Keyless, same Jupiter API as the quote — no new secrets needed

**2. New edge function — `supabase/functions/tx-status/index.ts`**
- Input: `{ signature, lastValidBlockHeight }`
- Polls Helius RPC (`HELIUS_API_KEY` already configured) for confirmation status
- Returns `{ status: "confirmed" | "pending" | "failed", err?, slot?, blockTime? }`
- Used by the frontend after submission to confirm landing

**3. `SwapPreviewCard.tsx` — enable the action**
- Replace the disabled tooltip with a real handler:
  - Call `swap-build` → get serialized transaction
  - Deserialize as `VersionedTransaction` (using `@solana/web3.js`, already a dep via `@solana/wallet-adapter-react`)
  - Call `wallet.sendTransaction(tx, connection)` — wallet adapter handles sign + submit in one step
  - Poll `tx-status` every 1.5s for up to 60s
- Card has 4 visual states driven by a local state machine:
  - `preview` (current) → `building` → `awaiting_signature` → `submitting` → `success` | `error`
- Auto-refresh quote pauses the moment the user clicks **Confirm & Sign** so the quote can't change mid-flight
- **Cancel** still works in preview state; in error state it becomes **Retry** (re-fetches quote and resets to preview)

**4. Success state component**
- Compact green-tinted variant of the card
- Shows `swapped X → Y`, confirmation time, truncated tx signature, and a Solscan link (`https://solscan.io/tx/<sig>`)
- Replaces the full preview card in place — same message, no chat duplication

**5. System prompt tweak**
- Remove the "Signing ships in the next update" deflection
- Add: "After a swap confirms, the user sees a success card automatically — don't restate the result, just acknowledge briefly if they ask follow-ups."

### Technical details

- **Versioned transactions**: Jupiter returns v0 transactions with address lookup tables. We must use `VersionedTransaction.deserialize(Buffer.from(swapTx, 'base64'))`, not legacy `Transaction`.
- **Connection**: Uses the existing `WalletContextProvider` connection (Helius RPC) for `sendTransaction` — keeps RPC calls authenticated through our own key.
- **Confirmation strategy**: We poll `tx-status` rather than using `connection.confirmTransaction` because the latter can hang past blockhash expiry. Polling Helius gives us deterministic timeout behavior.
- **Error mapping**: Jupiter/Solana errors are translated to plain English — `0x1771` → "price moved beyond your slippage tolerance", `BlockhashNotFound` → "quote expired, try again", etc.

### What we explicitly defer to Step 7
- SOL/SPL transfers (separate intent, separate tool)
- SNS (`.sol` name) resolution
- Per-swap slippage adjustment UI (the AI can already pass `slippageBps`; we'll add a manual control later if needed)

### Notes
- No new secrets, no new dependencies — `@solana/web3.js` is already pulled in by the wallet adapter
- Helius RPC is already configured via `HELIUS_API_KEY` — same key we use for balances
- All transactions go to **mainnet-beta**; this is real money. The wallet popup is the user's safety gate.

Approve and I'll build it.

