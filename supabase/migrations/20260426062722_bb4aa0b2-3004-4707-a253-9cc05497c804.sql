-- Invalidate cached wallet × token history rows that pre-date the
-- swap/transfer kind distinction. They will be rebuilt on the next scan
-- with proper `kind` and `counterparty` fields, fixing cases where a
-- transfer-in was previously counted as a DEX buy.
DELETE FROM public.wallet_token_history_cache
WHERE jsonb_array_length(events) > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(events) e WHERE e ? 'kind'
  );