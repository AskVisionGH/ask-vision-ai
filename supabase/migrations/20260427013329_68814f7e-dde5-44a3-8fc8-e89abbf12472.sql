-- Backfill missed swap fees: for every own-wallet swap in tx_events that
-- doesn't yet have a matching treasury_fees row, insert a 1% swap_fee row.
-- This is a one-shot reconciliation for the period before the helius-webhook
-- server-side fallback was deployed.
INSERT INTO public.treasury_fees (
  chain, treasury_address, source_kind, asset_symbol, asset_address,
  amount, amount_usd, signature, from_address, block_time,
  related_user_id, related_tx_event_id, metadata
)
SELECT
  'solana',
  'ASKVSe32esNeK7i84oGsL5F9cqh8ov3neXEF8jSc9i89',
  'swap_fee',
  CASE
    WHEN te.output_mint IS NULL OR te.output_mint = 'So11111111111111111111111111111111111111112' THEN 'SOL'
    WHEN te.output_mint IN ('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                             'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB') THEN 'USDC'
    ELSE NULL
  END,
  CASE
    WHEN te.output_mint IS NULL OR te.output_mint = 'So11111111111111111111111111111111111111112' THEN NULL
    ELSE te.output_mint
  END,
  0,
  ROUND((te.value_usd * 0.01)::numeric, 6),
  te.signature,
  te.wallet_address,
  te.created_at,
  te.user_id,
  te.id,
  jsonb_build_object(
    'bps', 100,
    'valueUsd', te.value_usd,
    'inputMint', te.input_mint,
    'outputMint', te.output_mint,
    'via', 'backfill_2026_04_27'
  )
FROM public.tx_events te
JOIN public.wallet_links wl
  ON wl.user_id = te.user_id
 AND wl.wallet_address = te.wallet_address
WHERE te.kind = 'swap'
  AND te.value_usd > 0
  AND te.created_at > now() - interval '30 days'
  AND NOT EXISTS (
    SELECT 1 FROM public.treasury_fees tf
    WHERE tf.signature = te.signature
      AND tf.source_kind IN ('swap_fee','swap_upfront_fee')
  )
ON CONFLICT DO NOTHING;