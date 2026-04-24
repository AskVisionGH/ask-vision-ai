-- Treasury fee ledger: unified record of all platform revenue
CREATE TABLE public.treasury_fees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chain TEXT NOT NULL CHECK (chain IN ('solana', 'ethereum')),
  treasury_address TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('swap_fee', 'dca_fee', 'bridge_fee', 'sweep', 'limit_fee', 'transfer_fee', 'other')),
  asset_symbol TEXT,
  asset_address TEXT, -- mint (Solana) or contract (Ethereum); null for native
  amount NUMERIC NOT NULL DEFAULT 0,
  amount_usd NUMERIC,
  signature TEXT NOT NULL, -- tx hash / sig (unique to dedupe indexer runs)
  from_address TEXT,
  block_time TIMESTAMP WITH TIME ZONE NOT NULL,
  related_user_id UUID,
  related_tx_event_id UUID,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Dedupe key: same signature + asset can only appear once per chain
CREATE UNIQUE INDEX treasury_fees_dedupe_idx
  ON public.treasury_fees (chain, signature, COALESCE(asset_address, 'native'));

CREATE INDEX treasury_fees_chain_time_idx
  ON public.treasury_fees (chain, block_time DESC);

CREATE INDEX treasury_fees_source_kind_idx
  ON public.treasury_fees (source_kind);

CREATE INDEX treasury_fees_block_time_idx
  ON public.treasury_fees (block_time DESC);

ALTER TABLE public.treasury_fees ENABLE ROW LEVEL SECURITY;

-- Admins can view all entries
CREATE POLICY "Admins can view treasury fees"
ON public.treasury_fees
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- No client-side writes; service role bypasses RLS for indexers
-- (No INSERT/UPDATE/DELETE policies = client cannot modify)
