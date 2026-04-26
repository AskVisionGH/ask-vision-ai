-- Invalidate cached wallet × token history rows that still classify
-- DEX swaps from sources like PUMP_AMM as plain transfers. The new
-- parser will rebuild these correctly on the next scan.
DELETE FROM public.wallet_token_history_cache
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(events) e
  WHERE e->>'kind' = 'transfer'
    AND upper(coalesce(e->>'source', '')) IN (
      'PUMP_AMM','PUMP_FUN','RAYDIUM','JUPITER','ORCA','METEORA',
      'PHOENIX','OPENBOOK','SERUM','MOONSHOT','LIFINITY','FLUXBEAM'
    )
);