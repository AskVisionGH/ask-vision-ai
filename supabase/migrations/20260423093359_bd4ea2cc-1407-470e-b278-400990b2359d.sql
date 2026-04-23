-- Curated global seed list (readable by anyone, no writes from app)
CREATE TABLE public.smart_wallets_global_seed (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  twitter_handle TEXT,
  category TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.smart_wallets_global_seed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view the curated wallet list"
  ON public.smart_wallets_global_seed
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Per-user tracked wallets
CREATE TABLE public.smart_wallets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  address TEXT NOT NULL,
  label TEXT NOT NULL,
  twitter_handle TEXT,
  notes TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, address)
);

ALTER TABLE public.smart_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tracked wallets"
  ON public.smart_wallets
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add their own tracked wallets"
  ON public.smart_wallets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tracked wallets"
  ON public.smart_wallets
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can remove their own tracked wallets"
  ON public.smart_wallets
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_smart_wallets_user ON public.smart_wallets(user_id);

CREATE TRIGGER update_smart_wallets_updated_at
  BEFORE UPDATE ON public.smart_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed the curated list (well-known Solana traders, KOLs, devs)
INSERT INTO public.smart_wallets_global_seed (address, label, twitter_handle, category) VALUES
  ('CyJj5ejJAUveDXnLduJbkvwjxcmWJNqCuB9DR7AExpHH', 'Ansem', 'blknoiz06', 'trader'),
  ('toLyt9RcdfKJiM8sH4NBPNZRmBBdfzC4Y5XxMfGRKVm', 'Toly (Anatoly)', 'aeyakovenko', 'founder'),
  ('mertxkbRmMTwZGHBpDMYvMop4TGXZ24NhYpRvWLFVJC', 'Mert', '0xMert_', 'founder'),
  ('frkdbsfKJicaCSzJDc8m2zWJ2L5FGBjdEMQHYg7Ek4o', 'Frank (DeGods)', 'frankdegods', 'kol'),
  ('orcANsq9hK5oKBVgqzVvksxofPwtLsKZH4PxAyREd6T', 'Orca Trader 1', NULL, 'trader'),
  ('GDfnEsia2WLAW5t8yx2X5j2mkfA74i5kwGdDuZHt7XmG', 'Cupsey', 'Cupseyy', 'trader'),
  ('B8oMRGgLETGv4fbrxpGB7PEhpPYbR4hQXCXZJU5bwhxz', 'Pow', 'traderpow', 'trader'),
  ('Ge1jGGdCdStwpKy8MK5xZ3Gff8oVvr14hWNCCsLgNqtL', 'Crash', '0xcrashout', 'trader'),
  ('5B52w1ZW9tuwUduueP5J7HXz5AcGfruGoX6YoAudvyxG', 'Smart Trader (5B52)', NULL, 'trader'),
  ('AAaPaXejQTDPKR6iE1FUSykAYbYtpwxBA9b5bmTo7mst', 'Smart Trader (AAaP)', NULL, 'trader'),
  ('2bUBiBNZyD29gP1oV6de7nxowMLoDBtopMMTGGMXYnSU', 'Smart Trader (2bUB)', NULL, 'trader'),
  ('BCnqTAjdHkYXdXrpJgGeBZJTPcLJSh5jY5dNjMNn8d5s', 'Smart Trader (BCnq)', NULL, 'trader'),
  ('9BoFW2JxdCDodsT2zG2MwfkVHFtZJCDpUMAtfL5jMR2c', 'Smart Trader (9BoF)', NULL, 'trader'),
  ('GVV4cVPSfZKKJoWNs7qR9yQGQbVCx6bj7DTnKtZuR7tt', 'Smart Trader (GVV4)', NULL, 'trader'),
  ('6m5sW6EAPAYiVTm6JZQZpzEq4tYXcg9SyxwG7sVsQbsi', 'Smart Trader (6m5s)', NULL, 'trader'),
  ('FdXzn8wf67eCkS4JwR3aKTL3Agc9EJtKqDz9xnpZxhcb', 'Smart Trader (FdXz)', NULL, 'trader'),
  ('CSHHGnuJJoNMkLgGfn6kfiv8wRxzn5VzfgBCPZpjL7m5', 'Smart Trader (CSHH)', NULL, 'trader'),
  ('DpNXPNWvWoHaZ9P3WtfGCb2ZdLihW8VW1w1Ph4KDH9iG', 'Smart Trader (DpNX)', NULL, 'trader'),
  ('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'Smart Trader (7xKX)', NULL, 'trader'),
  ('HbYWgGw3JZ6h5b2fXpwKqf3rH3BvnvDzMNZdMSmGkz4Z', 'Smart Trader (HbYW)', NULL, 'trader'),
  ('A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR', 'Bonk Guy', 'bonk_inu', 'kol'),
  ('GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', 'GMoney', 'gmoney', 'kol'),
  ('5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', 'Solana Treasury', NULL, 'protocol'),
  ('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 'Jupiter Pubkey', 'JupiterExchange', 'protocol'),
  ('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'Jito MEV', 'jito_sol', 'protocol');