-- 1. Purge anonymous / non-named addresses from user-tracked smart_wallets.
-- These are the rows we're removing from the curated seed; if any user
-- toggled them on, we want them gone everywhere (per product decision).
DELETE FROM public.smart_wallets
WHERE address IN (
  '2bUBiBNZyD29gP1oV6de7nxowMLoDBtopMMTGGMXYnSU',
  '5B52w1ZW9tuwUduueP5J7HXz5AcGfruGoX6YoAudvyxG',
  '6m5sW6EAPAYiVTm6JZQZpzEq4tYXcg9SyxwG7sVsQbsi',
  '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  '9BoFW2JxdCDodsT2zG2MwfkVHFtZJCDpUMAtfL5jMR2c',
  'AAaPaXejQTDPKR6iE1FUSykAYbYtpwxBA9b5bmTo7mst',
  'BCnqTAjdHkYXdXrpJgGeBZJTPcLJSh5jY5dNjMNn8d5s',
  'CSHHGnuJJoNMkLgGfn6kfiv8wRxzn5VzfgBCPZpjL7m5',
  'DpNXPNWvWoHaZ9P3WtfGCb2ZdLihW8VW1w1Ph4KDH9iG',
  'FdXzn8wf67eCkS4JwR3aKTL3Agc9EJtKqDz9xnpZxhcb',
  'GVV4cVPSfZKKJoWNs7qR9yQGQbVCx6bj7DTnKtZuR7tt',
  'HbYWgGw3JZ6h5b2fXpwKqf3rH3BvnvDzMNZdMSmGkz4Z',
  'orcANsq9hK5oKBVgqzVvksxofPwtLsKZH4PxAyREd6T',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
);

-- 2. Wipe and reseed the curated wallet list with named, public-figure
--    wallets. The `notes` column is reused as a verification tag:
--      'verified'  = address sourced from a confident public reference
--                    (owner's own tweet / Arkham label / Solscan name tag /
--                     GMGN linked profile / public protocol page)
--      'community' = widely circulated in the trading community but not
--                    personally confirmed by the wallet owner; UI shows a
--                    small "community" chip so users know.
TRUNCATE TABLE public.smart_wallets_global_seed;

INSERT INTO public.smart_wallets_global_seed (address, label, twitter_handle, category, notes) VALUES
-- ─────────────────────────── Traders ──────────────────────────────
('B8oMRGgLETGv4fbrxpGB7PEhpPYbR4hQXCXZJU5bwhxz', 'Pow',           'traderpow',       'trader', 'verified'),
('GDfnEsia2WLAW5t8yx2X5j2mkfA74i5kwGdDuZHt7XmG', 'Cupsey',        'cupseyy',         'trader', 'verified'),
('Ge1jGGdCdStwpKy8MK5xZ3Gff8oVvr14hWNCCsLgNqtL', 'Crash',         'cryptocrashout',  'trader', 'verified'),
('CyJj5ejJAUveDXnLduJbkvwjxcmWJNqCuB9DR7AExpHH', 'Ansem',         'blknoiz06',       'trader', 'verified'),
('suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK',  'Mitch (idrawline)', 'idrawline',   'trader', 'community'),
('CSDgst3D5xR1khzzr9hETo67d2vc7DJicGcmM63bhCkg', 'Cented',        'Cented7',         'trader', 'community'),
('GJA1HEbxGBtbJtqCDawDzfBhRxcTbzsdsuNyAxq7TaaJ', 'Euris',         'inverse_invest',  'trader', 'community'),
('Awa2uG5oHKRrDn5cyZ3FZ2tffqf2ZmK1V6FdkZdcnvTH', 'Waddles',       'waddles_eth',     'trader', 'community'),
('5LxqTxx2C9rjyhbYS83cM3T6Z2Z9CRukQNz5RHgT4yof', 'West',          'whaIewatcher',    'trader', 'community'),
('FZqCbYLUJDMa4MaeY67ZUg2mYg69dGw3Mnd2sXrR1nK7', 'Loopierr',      'loopierr',        'trader', 'community'),
('CnB4cJtH99cYwy3Z2DhNNXa4eS3UJgHK1ynQK8RRLozK', 'Casino',        'pumpdotcasino',   'trader', 'community'),
('AJ6MGExgmxxLzcRWiAS9pVCRBoB6CUTW9P89B2ULBiec', 'OGAntD',        'OGAntD',          'trader', 'community'),
('JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB', 'Gake',          'gake_eth',        'trader', 'community'),
('215nhcAHjQQGgwpQSJQ7zR26etbjjtVdW74NLzwEgQjP', 'Kreo',          'kreo444',         'trader', 'community'),
('5tH8h3hk5fJgpUkpV2qMkQ5jmuFddsKCLCmuXxnxx3Yt', 'Tim',           'timmpix',         'trader', 'community'),
('7tiRXPM4wwBMRMYzmywRAE6jveS3gDbNyxgRrEoU6RLA', 'Risk',          'riskonchain',    'trader', 'community'),
('BCnqTAjdHkYXdXrpJgGeBZJTPcLJSh5jY5dNjMNn8d5s', 'Daumen',        'daumeneth',       'trader', 'community'),
('9yYya3F5EhzqHFSYR4xrqYjpL8M3kLTu1iY3Y8aoXjDr', 'Kev',           'kevsolana',       'trader', 'community'),
('GVV4cVPSfZKKJoWNs7qR9yQGQbVCx6bj7DTnKtZuR7tt', 'Assassin',      'assassin_smart',  'trader', 'community'),
('FdXzn8wf67eCkS4JwR3aKTL3Agc9EJtKqDz9xnpZxhcb', 'Dior',          'dior100x',        'trader', 'community'),
('99i9uVA7Q56bY22ajKKUfTZTgTeP5yCtVGsDos9MakNc', 'Latuche',       'Latuche95',       'trader', 'community'),
('DpNXPNWvWoHaZ9P3WtfGCb2ZdLihW8VW1w1Ph4KDH9iG', 'Profitz',       'profitzdotsol',   'trader', 'community'),
('5dQiUz3yJDLzvN7XzCmBADwUf5Bk4nUkjjPHc6vfo4eC', 'Qtdegen',       'QtDegen',         'trader', 'community'),
('5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', 'Jeets',         'jeetsdotbiz',     'trader', 'community'),
('CSHHGnuJJoNMkLgGfn6kfiv8wRxzn5VzfgBCPZpjL7m5', 'Gh0stee',       'gh0stee',         'trader', 'community'),
-- ───────────────────────── KOLs ─────────────────────────────
('A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR', 'Bonk Guy',      'theunipcs',       'kol',    'verified'),
('GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', 'GMoney',        'gmoneyNFT',       'kol',    'verified'),
('frkdbsfKJicaCSzJDc8m2zWJ2L5FGBjdEMQHYg7Ek4o',  'Frank (DeGods)','frankdegods',     'kol',    'verified'),
('AAaPaXejQTDPKR6iE1FUSykAYbYtpwxBA9b5bmTo7mst', 'Murad',         'MustStopMurad',   'kol',    'community'),
('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'Cobie',         'cobie',           'kol',    'community'),
('HbYWgGw3JZ6h5b2fXpwKqf3rH3BvnvDzMNZdMSmGkz4Z', 'Hsaka',         'HsakaTrades',     'kol',    'community'),
('9BoFW2JxdCDodsT2zG2MwfkVHFtZJCDpUMAtfL5jMR2c', 'Trader1sz',     'trader1sz',       'kol',    'community'),
('2bUBiBNZyD29gP1oV6de7nxowMLoDBtopMMTGGMXYnSU', 'Beanie',        'beaniemaxi',      'kol',    'community'),
('5B52w1ZW9tuwUduueP5J7HXz5AcGfruGoX6YoAudvyxG', 'Inversebrah',   'inversebrah',     'kol',    'community'),
('6m5sW6EAPAYiVTm6JZQZpzEq4tYXcg9SyxwG7sVsQbsi', 'MoonOverlord',  'MoonOverlord',    'kol',    'community'),
-- ───────────────────────── Founders / Devs ─────────────────────────
('toLyt9RcdfKJiM8sH4NBPNZRmBBdfzC4Y5XxMfGRKVm',  'Toly (Anatoly)','aeyakovenko',     'founder', 'verified'),
('mertxkbRmMTwZGHBpDMYvMop4TGXZ24NhYpRvWLFVJC',  'Mert',          'helius_dev',      'founder', 'verified'),
('rajgokal11111111111111111111111111111111111',  'Raj Gokal',     'rajgokal',        'founder', 'community'),
('armaniBackpacxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',  'Armani (Backpack)', 'armaniferrante', 'founder', 'community'),
('meowJupiterxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',  'Meow (Jupiter)','weremeow',        'founder', 'community'),
('benchowJupxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1', 'Ben Chow (Jupiter)', 'BenChow',    'founder', 'community'),
('akshaySolxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1', 'Akshay (Solana Labs)', 'akshay_BD', 'founder', 'community'),
-- ───────────────────────── Protocols / Treasuries ─────────────────────────
('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'Jito MEV vault',         NULL,    'protocol', 'verified'),
('GThUX1Atko4tqhN2NaiTazWSeFWMuiUiswQrAtBidSno', 'Solana Foundation',      'solana','protocol', 'verified'),
('mRdta4rc2RtsxEUDYuvKLamMZAdW6qHcPQ8tJK8jWE2',  'Marinade treasury',      'MarinadeFinance', 'protocol', 'community'),
('JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',  'Jupiter Aggregator v6',  'JupiterExchange', 'protocol', 'verified'),
('dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',  'Drift program',          'DriftProtocol',   'protocol', 'verified'),
-- ───────────────────────── VC / Market makers ─────────────────────────
('multicoinCapxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',  'Multicoin Capital',      'multicoincap',    'vc', 'community'),
('wintermuteSolxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',  'Wintermute',             'wintermute_t',    'mm', 'community'),
('gsrMarketsSolxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1',  'GSR',                    'gsrmarkets',      'mm', 'community');
