-- After merging Daniel's duplicate roles, super_admin no longer implicitly
-- satisfies has_role(_, 'admin') checks in RLS policies. Replace each
-- admin-only SELECT policy so it accepts either role.

-- profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- treasury_fees
DROP POLICY IF EXISTS "Admins can view treasury fees" ON public.treasury_fees;
CREATE POLICY "Admins can view treasury fees"
  ON public.treasury_fees FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- sweep_runs
DROP POLICY IF EXISTS "Admins can view sweep runs" ON public.sweep_runs;
CREATE POLICY "Admins can view sweep runs"
  ON public.sweep_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- tx_events
DROP POLICY IF EXISTS "Admins can view all tx events" ON public.tx_events;
CREATE POLICY "Admins can view all tx events"
  ON public.tx_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- wallet_links
DROP POLICY IF EXISTS "Admins can view all wallet links" ON public.wallet_links;
CREATE POLICY "Admins can view all wallet links"
  ON public.wallet_links FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- app_counters
DROP POLICY IF EXISTS "Admins can view counters" ON public.app_counters;
CREATE POLICY "Admins can view counters"
  ON public.app_counters FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- helius_webhooks
DROP POLICY IF EXISTS "Admins view helius webhooks" ON public.helius_webhooks;
CREATE POLICY "Admins view helius webhooks"
  ON public.helius_webhooks FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- user_roles (admins-can-view-all)
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- admin_get_user_emails RPC also gates on 'admin' — update it similarly.
CREATE OR REPLACE FUNCTION public.admin_get_user_emails(_user_ids uuid[])
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT u.id AS user_id, u.email::text AS email
    FROM auth.users u
    WHERE u.id = ANY(_user_ids);
END;
$$;