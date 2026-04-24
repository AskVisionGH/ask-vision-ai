-- Let admins read every profile so the admin Users panel lists all signups.
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow signed-in users to record a wallet they've connected to their account.
-- (SIWS verify already inserts via the service role; this lets the regular
-- in-app "Connect wallet" flow do the same for Google/email accounts.)
CREATE POLICY "Users can link their own wallet"
  ON public.wallet_links
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow signed-in users to remove a wallet link they own.
CREATE POLICY "Users can unlink their own wallet"
  ON public.wallet_links
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Prevent duplicate (user, wallet) pairs so we can safely upsert on connect.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_links_user_wallet_unique
  ON public.wallet_links (user_id, wallet_address);