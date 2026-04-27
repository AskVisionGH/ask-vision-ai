-- Enum for how a Vision Wallet was created
CREATE TYPE public.vision_wallet_origin AS ENUM ('created', 'imported_seed', 'imported_key');

-- Main table
CREATE TABLE public.vision_wallets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  privy_user_id TEXT NOT NULL,
  solana_address TEXT,
  evm_address TEXT,
  origin public.vision_wallet_origin NOT NULL DEFAULT 'created',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT vision_wallets_user_unique UNIQUE (user_id),
  CONSTRAINT vision_wallets_privy_user_unique UNIQUE (privy_user_id),
  CONSTRAINT vision_wallets_has_an_address CHECK (
    solana_address IS NOT NULL OR evm_address IS NOT NULL
  )
);

-- Helpful lookup indexes (addresses are queried often)
CREATE INDEX idx_vision_wallets_solana_address ON public.vision_wallets (solana_address) WHERE solana_address IS NOT NULL;
CREATE INDEX idx_vision_wallets_evm_address ON public.vision_wallets (lower(evm_address)) WHERE evm_address IS NOT NULL;

-- Enable RLS
ALTER TABLE public.vision_wallets ENABLE ROW LEVEL SECURITY;

-- Users can manage their own vision wallet
CREATE POLICY "Users can view their own vision wallet"
  ON public.vision_wallets
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own vision wallet"
  ON public.vision_wallets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own vision wallet"
  ON public.vision_wallets
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own vision wallet"
  ON public.vision_wallets
  FOR DELETE
  USING (auth.uid() = user_id);

-- Admins can view all vision wallets for support
CREATE POLICY "Admins can view all vision wallets"
  ON public.vision_wallets
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- updated_at trigger
CREATE TRIGGER update_vision_wallets_updated_at
  BEFORE UPDATE ON public.vision_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();