-- Allow admins to see every wallet link so the admin Users panel can list
-- a user's connected on-chain wallets.
CREATE POLICY "Admins can view all wallet links"
  ON public.wallet_links
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Helper function: return (user_id, email) pairs for any subset of users.
-- Restricted to admins via an internal role check; runs as SECURITY DEFINER
-- so it can read auth.users, which is otherwise off-limits to the client.
CREATE OR REPLACE FUNCTION public.admin_get_user_emails(_user_ids uuid[])
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT u.id AS user_id, u.email::text AS email
    FROM auth.users u
    WHERE u.id = ANY(_user_ids);
END;
$$;

-- Make the function callable by signed-in users (admin check happens inside).
REVOKE ALL ON FUNCTION public.admin_get_user_emails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_emails(uuid[]) TO authenticated;
