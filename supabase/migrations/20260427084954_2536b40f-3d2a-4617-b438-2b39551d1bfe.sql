ALTER TABLE public.vision_wallets
  ADD COLUMN IF NOT EXISTS solana_wallet_id text,
  ADD COLUMN IF NOT EXISTS evm_wallet_id text,
  ALTER COLUMN privy_user_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vision_wallets_solana_wallet_id_key
  ON public.vision_wallets (solana_wallet_id)
  WHERE solana_wallet_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vision_wallets_evm_wallet_id_key
  ON public.vision_wallets (evm_wallet_id)
  WHERE evm_wallet_id IS NOT NULL;