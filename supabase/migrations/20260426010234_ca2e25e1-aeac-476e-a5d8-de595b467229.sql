CREATE TABLE public.wallet_token_history_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address text NOT NULL,
  token_mint text NOT NULL,
  first_buy_at timestamptz,
  first_buy_signature text,
  first_buy_amount numeric,
  first_buy_usd numeric,
  total_buys integer NOT NULL DEFAULT 0,
  total_sells integer NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  realized_usd numeric NOT NULL DEFAULT 0,
  oldest_scanned_signature text,
  oldest_scanned_at timestamptz,
  newest_scanned_signature text,
  newest_scanned_at timestamptz,
  fully_scanned boolean NOT NULL DEFAULT false,
  signatures_scanned integer NOT NULL DEFAULT 0,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_scanned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wallet_address, token_mint)
);

CREATE INDEX wallet_token_history_cache_wallet_idx
  ON public.wallet_token_history_cache (wallet_address);

ALTER TABLE public.wallet_token_history_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read wallet history cache"
  ON public.wallet_token_history_cache
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role manages wallet history cache"
  ON public.wallet_token_history_cache
  FOR ALL
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER update_wallet_token_history_cache_updated_at
  BEFORE UPDATE ON public.wallet_token_history_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();