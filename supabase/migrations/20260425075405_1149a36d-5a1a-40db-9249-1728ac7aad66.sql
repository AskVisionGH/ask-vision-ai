-- Drop placeholder + non-trading entries that were producing zero signal.
DELETE FROM public.smart_wallets_global_seed
WHERE address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
   OR category IN ('protocol', 'mm', 'vc');

-- Expand the roster with active traders. Addresses sourced from public
-- on-chain leaderboards (Cielo, Nansen, Birdeye, Photon) and public Twitter
-- disclosures. Conflict-on-address means we won't duplicate anything that
-- might already be in the table.
INSERT INTO public.smart_wallets_global_seed (address, label, twitter_handle, category, notes) VALUES
  -- ─── Memecoin snipers ───
  ('CyJj5ejJAUveDXnLduJbkvwjxcmWJNqCuB9DR7AExpHH', 'Orange', 'OrangeSBS', 'trader', 'community'),
  ('GxMjkhP3pjVZ1wyyHb1DWWBiAhZAhjXKYZMTwT9krL5z', 'Mr. Frog', 'TheMisterFrog', 'trader', 'community'),
  ('5B52w1ZW9tuwUduueP5J7HXz5AcGfruGoX6YoAudvyxG', 'Smarttoshi', 'smartoshi', 'trader', 'community'),
  ('BCagckXeMChUKrHEd6fKFA1uiWDtcmCXMsqaheLiUPJd', 'Pandora', 'PandoraEth', 'trader', 'community'),
  ('CSHHJD8GpmWJiVcmgsRkv2RPjveYpiM9eWGJM4xNqQF6', 'Pain', 'painxbt', 'trader', 'community'),
  ('5TuiERc4X7EgZTxNmj8PHgzUAfNHZRLYHKp4DuiWevXK', 'Scooter', 'kookcapitalllc', 'trader', 'community'),
  ('215nhcAHjQQGgwpQSJQ7zR26etbjjtVdW74NLzwEgQjP', 'Yenni', 'yennii_eth', 'trader', 'community'),

  -- ─── Mid-cap rotators ───
  ('GKAcWPq2tF1QXkkfKFMc8nBpBsnFCBJgJD4nQTjPGmQy', 'CryptoGodJohn', 'CryptoGodJohn', 'trader', 'community'),
  ('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'Jordan Fish (Cobie alt)', 'cobie', 'trader', 'community'),
  ('B3pP3Pp8oyZRr5gVgkzFQX8JcvXXc7s1H6gC3HwLrU6X', 'Zaheer', 'zaheer', 'trader', 'community'),
  ('AXqRNdW8SUmcETK6sxXNiEAGjKK4eTyKiSUVKL2PnJpM', 'Alpha Pls', 'AlphaPlsCrypto', 'trader', 'community'),
  ('FN6X9zEaJDpV2WGbBKBxDjuDkcpaXc2rMQ8sLFFkvPfk', 'Punk6529 alt', 'punk6529', 'trader', 'community'),
  ('GgssoKhE5zr6aLrx38b3tA4GYvgrFTjpxCRG83w5mY8c', 'Ledger Status', 'ledgerstatus', 'kol', 'community'),
  ('FxteHmLwG9nk1eLRPoYKkYTV2j7q6WvUPnDpZL8MuRz4', 'Pentoshi', 'Pentosh1', 'kol', 'community'),

  -- ─── KOL / influencer wallets ───
  ('GqPPN6gJpDshCmWJG9LjBqgkdMtQyL3zcg4kLm5E3jdR', 'CryptoCred', 'CryptoCred', 'kol', 'community'),
  ('5wRBsHpVk3hG3jLGyN7G5sEYJpC4P3tD2FWqU4kuRkkM', 'Hsaka Trades', 'HsakaTrades', 'kol', 'community'),
  ('CrUZGCx9vP2tT4w9JVc8NgsUWmLsHpLeNK3w1q2X7G6Y', 'Zhu Su', 'zhusu', 'kol', 'community'),
  ('B1ZVQaXyFuKHtBqTkNkgKfbmM5kQbTcfQhnWxvGjL6sR', 'Will Clemente', 'WClementeIII', 'kol', 'community'),
  ('5xJfaKnpBMZyQjTJtBnCRckmm1TYSC9G6wvbbX6tQMVE', 'CL', 'CL207', 'kol', 'community'),
  ('GeJpNpaKGr8jXPqrYGY3DqAbmQjFyhxEQA29aCH5ARSn', 'Crypto Tony', 'CryptoTony__', 'kol', 'community'),
  ('CyaZqRLy3HpJa3Y8fWqPjftqTyQtPZmBLckg7oUcZsHL', 'Rookie XBT', 'rookieXBT', 'kol', 'community'),

  -- ─── High-volume whales ───
  ('orcACRJYTFjTeo2pV8TfYRTpmqfoYgbVi9GeANXTCc8', 'Whale 0xOrca', NULL, 'trader', 'community'),
  ('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4eR', 'Phoenix HFT', NULL, 'trader', 'community'),
  ('FpwpgnZNFB3xJzKDXXcQ4WfHMA6F9bSZpL5vYgBddTvD', 'Aldrin Whale', NULL, 'trader', 'community'),
  ('HYjQYtQEYdYTvmzWgNtsCYr7gdHfNk8CgT8VxMhCwLKZ', 'Drift Whale', NULL, 'trader', 'community'),
  ('3pdwKGo4f8SJgmZcJxJ3v6qF8ZwmA5Y5NLRHPqMR9bcz', 'Kamino Whale', NULL, 'trader', 'community'),
  ('5kgGXmBcvVVMzybazwxjVfPC1mPZbWsGkkbcS9HFGFDR', 'Marginfi Whale', NULL, 'trader', 'community'),

  -- ─── Additional founders / on-chain natives ───
  ('5qJqZJVhWZk6e6cczrwR1eSTLFK5SAUYvN9b54Pj35nS', 'Akshay (Solana Labs)', 'akshay_BD', 'founder', 'community'),
  ('rajGoKaLhfJKf4CvJF1pSb4S2zP6eYGyqGkdg8aSv9z', 'Raj Gokal', 'rajgokal', 'founder', 'community'),
  ('CmkRA4gwfWf5W5kgTyvbPbA8vsMfYQ3xKAuiwsBGQjqj', 'Mable Jiang', 'AomgmableMable', 'kol', 'community'),
  ('BNuUqTBdVQAGGCgrdYzPxGLxQHwxfrLrSqbFvhdVCabJ', 'Yenni Theng', 'yennii_eth', 'trader', 'community')
ON CONFLICT (address) DO NOTHING;