
## Answer

Not really. There is no project-side setting here to raise the CPU budget for just `resolve-recipient`. The current backend docs support per-function config like `verify_jwt`, `import_map`, and `entrypoint` in `supabase/config.toml`, and Lovable Cloud instance size can be upgraded in **Cloud → Overview → Advanced settings → Upgrade instance**, but that helps overall backend capacity — it does not remove the hosted Edge Function CPU ceiling that is causing this failure.

## What’s actually going wrong

`resolve-recipient` is still a separate Edge Function, and it imports Solana web3 just to normalize/check an address. That extra worker hop is the part still hitting the resource limit. The `.sol` lookup itself is cheap; the current architecture around it is not.

## Implementation plan

1. **Take `.sol` resolution out of the separate worker hot path**
   - Stop calling `resolve-recipient` as its own Edge Function from `chat`.
   - Add a small resolver helper directly inside `supabase/functions/chat/index.ts`.
   - For `.sol` names, use the lightweight SNS proxy HTTP lookup.
   - For raw addresses, use a lightweight base58-format check only.
   - Pass the resolved address straight into `transfer-quote`.

2. **Retire or slim down `resolve-recipient`**
   - Either remove it from the transfer flow entirely, or keep it as a zero-dependency helper endpoint.
   - If kept, strip out `@solana/web3.js` so the function does not pay startup/CPU cost just to validate input.

3. **Make `transfer-quote` the authoritative validator**
   - Update `supabase/functions/transfer-quote/index.ts` so it can work from `resolvedAddress` alone.
   - Keep the real Solana-specific checks there, since this function already loads web3 and token utilities anyway.
   - Compute `isOnCurve` there when needed, and continue blocking SPL transfers to off-curve recipients.

4. **Harden the contract between backend and UI**
   - Make the transfer event shape tolerant of partial/error states.
   - Treat `displayName`, `resolvedAddress`, and `isOnCurve` as optional until quote preparation succeeds.
   - Keep `TransferPreviewCard` defensive so failed preparation never tries to read nested fields.

5. **Improve failure handling**
   - If `.sol` lookup fails, return a clean message like:
     - “I couldn’t resolve that `.sol` name right now. Try again or paste the wallet address.”
   - Avoid surfacing raw worker-limit JSON to the chat UI.

6. **Regression-check the full transfer flow**
   - Test:
     - `send 0.5 usdc to toly.sol`
     - `send 0.05 sol to <wallet address>`
     - invalid `.sol`
     - invalid base58 address
     - SPL transfer to off-curve address
   - Confirm the preview card renders and refreshes without re-triggering heavy resolution work.

## Files to update

- `supabase/functions/chat/index.ts`
- `supabase/functions/transfer-quote/index.ts`
- `supabase/functions/resolve-recipient/index.ts` or remove it from active flow
- `src/lib/chat-stream.ts`
- `src/components/TransferPreviewCard.tsx`

## Technical details

- Current `supabase/config.toml` has no function-specific overrides.
- Per-function config is useful for auth/import behavior, not CPU budget.
- Hosted Edge Functions have a fixed CPU-time limit, so the real fix is to reduce synchronous compute and remove unnecessary worker boundaries.
- Upgrading Lovable Cloud instance size is still worth knowing for general scaling, but it is not the right fix for this specific resolver failure.
