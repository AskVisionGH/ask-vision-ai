

## Step 7: Transfers & SNS Resolution

Vision learns to **send tokens** — SOL or any SPL — to a wallet address or a `.sol` name. Same conversational pattern as swaps: AI prepares a preview card, the user reviews and signs, the card flips to a success state.

### What you'll see

Type **"send 0.05 SOL to toly.sol"** or **"send 10 USDC to 7xKX…9aPq"**. Vision replies with one short sentence and a card:

```text
┌─────────────────────────────────────────┐
│  Transfer preview                       │
│                                         │
│   You send       0.05 SOL               │
│                  ≈ $7.42                │
│                                         │
│   To             toly.sol               │
│                  4Nd1m…h2Cj             │
│                                         │
│   Network fee    ~0.000005 SOL          │
│   Total          0.050005 SOL           │
│                                         │
│   [ Confirm & sign ]   [ Cancel ]       │
└─────────────────────────────────────────┘
```

After signing, the card collapses to the same green success state used for swaps:

```text
┌─────────────────────────────────────────┐
│  ✓ Sent 0.05 SOL to toly.sol            │
│    Confirmed in 1.2s                    │
│    Tx  3yQ2…7nFp  ↗ Solscan             │
└─────────────────────────────────────────┘
```

If the recipient address is invalid, the SNS name doesn't resolve, or the wallet has insufficient balance, the AI explains plainly and the card never renders.

### What gets built

**1. New edge function — `supabase/functions/resolve-recipient/index.ts`**
- Input: `{ recipient: string }` — either a base58 wallet address or a `.sol` name
- If `.sol` suffix: resolves via Bonfida SNS SDK over Helius RPC (`@bonfida/spl-name-service` for Deno)
- If raw address: validates it's a valid base58 32-byte public key
- Returns `{ address, displayName, isOnCurve }` — `isOnCurve` flags PDAs (rare but worth catching to avoid sending to a program-owned account)

**2. New edge function — `supabase/functions/transfer-build/index.ts`**
- Input: `{ fromAddress, toAddress, mint, amount }` (mint = `"SOL"` or SPL mint address; amount in human units)
- For **SOL**: builds a `SystemProgram.transfer` instruction
- For **SPL tokens**:
  - Looks up sender's associated token account (ATA) for the mint
  - Looks up recipient's ATA; if missing, prepends a `createAssociatedTokenAccountInstruction` (sender pays the ~0.002 SOL rent — this is shown in the preview)
  - Adds a `createTransferCheckedInstruction` with proper decimals
- Wraps in a `VersionedTransaction` with a recent blockhash from Helius
- Returns `{ transaction: <base64>, lastValidBlockHeight, estNetworkFeeSol, ataCreationFeeSol }`

**3. New AI tool — `prepare_transfer`**
Added to the `chat` edge function tool list:
```ts
{
  name: "prepare_transfer",
  description: "Prepare a transfer of SOL or an SPL token to another wallet. Use whenever the user wants to send, transfer, or pay tokens to an address or .sol name.",
  parameters: {
    token: "ticker (SOL, USDC, JUP) or full mint address",
    amount: "decimal amount to send",
    recipient: "wallet address or .sol name"
  }
}
```
The chat function calls `resolve-recipient` first; if it fails, it returns a clear error event so the AI can explain ("That .sol name doesn't resolve to anything"). On success it calls a new `transfer-quote` helper that bundles recipient resolution + USD pricing + fee estimate into the same event shape the UI expects.

**4. New UI component — `src/components/TransferPreviewCard.tsx`**
- Same visual language as `SwapPreviewCard` (dark panel, lilac accents, JetBrains Mono numbers)
- Reuses the same state machine: `preview` → `building` → `awaiting_signature` → `submitting` → `confirming` → `success` | `error`
- Reuses the existing `tx-submit` and `tx-status` edge functions verbatim — they're transaction-agnostic
- Shows the resolved address under a `.sol` name so the user always sees where funds are actually going
- Highlights ATA creation fee in amber when the recipient doesn't have a token account yet ("First-time send to this address — adds ~0.002 SOL")

**5. Wire-up**
- `chat-stream.ts` → add `TransferQuoteData` type and `transfer_quote` to the `ToolEvent` union
- `ChatBubble.tsx` → render `TransferPreviewCard` when `event.type === "transfer_quote"`
- System prompt: add the `prepare_transfer` tool guidance and the rule "Always show the resolved address alongside any `.sol` name in your reply, so the user can sanity-check the destination."

### Technical details

- **SNS resolution**: Bonfida's `@bonfida/spl-name-service` Deno-compatible build resolves `name.sol` → owner pubkey via on-chain account reads through Helius RPC. No API key needed beyond what we already have.
- **ATA detection**: Use `getAssociatedTokenAddressSync` for the address, then `connection.getAccountInfo` to check existence. Missing ATA → prepend creation instruction.
- **Decimals**: Pulled from the same Jupiter token list cache that `swap-quote` already uses — no extra RPC call for known tokens.
- **Safety check**: `PublicKey.isOnCurve()` flags PDAs. We block sending SPL tokens to non-curve addresses (programs) but allow SOL (some valid recipients are off-curve, e.g. Squads vaults). The card surfaces a warning either way.
- **Reuse**: `tx-submit` and `tx-status` are unchanged — any signed `VersionedTransaction` flows through them.

### What we explicitly defer to a later step
- Address book / contacts ("send to mom")
- Batch sends (one tx, multiple recipients)
- Memo field on transfers
- NFT transfers (separate intent — different account model)

### Notes
- No new secrets needed — Helius RPC and Jupiter token list are already in place
- New Deno dep: `@bonfida/spl-name-service` (imported via esm.sh in the edge function — no package install)
- Real mainnet money — same wallet popup safety gate as swaps

