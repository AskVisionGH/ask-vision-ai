-- Nonces issued for Sign-In with Solana flow.
-- Each nonce is single-use, scoped to a wallet, and short-lived.
CREATE TABLE public.siws_nonces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  consumed BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_siws_nonces_wallet ON public.siws_nonces (wallet_address);
CREATE INDEX idx_siws_nonces_expires ON public.siws_nonces (expires_at);

-- Lock the table down: only the service role (edge functions) ever touches it.
ALTER TABLE public.siws_nonces ENABLE ROW LEVEL SECURITY;

-- No client-side policies — RLS denies all access from anon/authenticated roles.
-- The siws-issue-nonce and siws-verify edge functions use the service role key.

-- Map a wallet address to its Supabase user id, so the same wallet always
-- resolves to the same account when signing in (across browsers, devices).
CREATE TABLE public.wallet_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  wallet_address TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_links_user ON public.wallet_links (user_id);

ALTER TABLE public.wallet_links ENABLE ROW LEVEL SECURITY;

-- Users can see their own wallet link (useful for "this wallet is signed in as you" UI).
CREATE POLICY "Users can view their own wallet link"
ON public.wallet_links
FOR SELECT
USING (auth.uid() = user_id);

-- Inserts/updates/deletes happen server-side via the SIWS edge function only.