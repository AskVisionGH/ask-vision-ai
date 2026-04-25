-- Trade ledger populated by the smart-money-sync background job
CREATE TABLE public.smart_money_trades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  wallet_label TEXT NOT NULL,
  wallet_twitter_handle TEXT,
  wallet_category TEXT,
  wallet_notes TEXT,
  wallet_is_curated BOOLEAN NOT NULL DEFAULT true,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  token_mint TEXT NOT NULL,
  token_amount NUMERIC NOT NULL,
  value_usd NUMERIC,
  signature TEXT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency for upserts
CREATE UNIQUE INDEX idx_smart_money_trades_unique
  ON public.smart_money_trades (wallet_address, signature, token_mint, side);

-- Hot query paths
CREATE INDEX idx_smart_money_trades_block_time
  ON public.smart_money_trades (block_time DESC);
CREATE INDEX idx_smart_money_trades_token_time
  ON public.smart_money_trades (token_mint, block_time DESC);
CREATE INDEX idx_smart_money_trades_wallet_time
  ON public.smart_money_trades (wallet_address, block_time DESC);

ALTER TABLE public.smart_money_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view smart money trades"
  ON public.smart_money_trades
  FOR SELECT
  TO authenticated
  USING (true);

-- Per-wallet sync bookkeeping
CREATE TABLE public.smart_money_sync_state (
  wallet_address TEXT NOT NULL PRIMARY KEY,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_signature TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  trades_last_sync INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.smart_money_sync_state ENABLE ROW LEVEL SECURITY;
-- No policies: service role only.
