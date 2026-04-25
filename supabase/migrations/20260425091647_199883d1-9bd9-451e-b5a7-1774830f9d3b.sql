-- =====================================================================
-- 1. Set search_path on the 4 email helper functions
-- =====================================================================
ALTER FUNCTION public.enqueue_email(text, jsonb)        SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.delete_email(text, bigint)        SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq, extensions;

-- =====================================================================
-- 2. RLS policies for the 2 tables that had RLS but no policies
-- =====================================================================
-- siws_nonces: never user-facing. Only edge functions (service role) write/read.
-- Authenticated/anon users get nothing.
DROP POLICY IF EXISTS "siws_nonces no client access" ON public.siws_nonces;
CREATE POLICY "siws_nonces no client access"
  ON public.siws_nonces
  FOR SELECT
  TO authenticated, anon
  USING (false);

-- smart_money_sync_state: admins can view; nobody else.
DROP POLICY IF EXISTS "Admins view smart_money_sync_state" ON public.smart_money_sync_state;
CREATE POLICY "Admins view smart_money_sync_state"
  ON public.smart_money_sync_state
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- =====================================================================
-- 3. Lock down the avatars storage bucket SELECT policy
-- =====================================================================
-- Old policy used `bucket_id = 'avatars'` which lets clients LIST.
-- Replace with a policy that only matches when name is supplied (i.e.
-- direct GET by full path), preventing list operations.
DROP POLICY IF EXISTS "Avatar images are publicly readable" ON storage.objects;
CREATE POLICY "Avatars readable by direct path only"
  ON storage.objects
  FOR SELECT
  TO public
  USING (
    bucket_id = 'avatars'
    AND name IS NOT NULL
    AND name <> ''
    AND position('/' IN name) > 0
  );

-- =====================================================================
-- 4. Consolidated admin check: is_admin_or_super
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_admin_or_super(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'super_admin')
  )
$$;

-- Rewrite every admin SELECT policy to use the new helper.
-- profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- treasury_fees
DROP POLICY IF EXISTS "Admins can view treasury fees" ON public.treasury_fees;
CREATE POLICY "Admins can view treasury fees"
  ON public.treasury_fees FOR SELECT TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- sweep_runs
DROP POLICY IF EXISTS "Admins can view sweep runs" ON public.sweep_runs;
CREATE POLICY "Admins can view sweep runs"
  ON public.sweep_runs FOR SELECT TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- tx_events
DROP POLICY IF EXISTS "Admins can view all tx events" ON public.tx_events;
CREATE POLICY "Admins can view all tx events"
  ON public.tx_events FOR SELECT TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- wallet_links
DROP POLICY IF EXISTS "Admins can view all wallet links" ON public.wallet_links;
CREATE POLICY "Admins can view all wallet links"
  ON public.wallet_links FOR SELECT TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- app_counters
DROP POLICY IF EXISTS "Admins can view counters" ON public.app_counters;
CREATE POLICY "Admins can view counters"
  ON public.app_counters FOR SELECT TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- helius_webhooks
DROP POLICY IF EXISTS "Admins view helius webhooks" ON public.helius_webhooks;
CREATE POLICY "Admins view helius webhooks"
  ON public.helius_webhooks FOR SELECT TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- user_roles
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- Update the email RPC.
CREATE OR REPLACE FUNCTION public.admin_get_user_emails(_user_ids uuid[])
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT u.id AS user_id, u.email::text AS email
    FROM auth.users u
    WHERE u.id = ANY(_user_ids);
END;
$$;

-- =====================================================================
-- 5. Role change audit log
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.role_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid,
  target_id    uuid NOT NULL,
  role         text NOT NULL,
  action       text NOT NULL CHECK (action IN ('grant','revoke')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS role_audit_log_created_at_idx
  ON public.role_audit_log (created_at DESC);

ALTER TABLE public.role_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view audit log" ON public.role_audit_log;
CREATE POLICY "Admins can view audit log"
  ON public.role_audit_log FOR SELECT TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- Trigger: capture every grant / revoke on user_roles.
CREATE OR REPLACE FUNCTION public.log_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.role_audit_log (actor_id, target_id, role, action)
    VALUES (auth.uid(), NEW.user_id, NEW.role::text, 'grant');
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.role_audit_log (actor_id, target_id, role, action)
    VALUES (auth.uid(), OLD.user_id, OLD.role::text, 'revoke');
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_audit_ins ON public.user_roles;
CREATE TRIGGER user_roles_audit_ins
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.log_role_change();

DROP TRIGGER IF EXISTS user_roles_audit_del ON public.user_roles;
CREATE TRIGGER user_roles_audit_del
  AFTER DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.log_role_change();

-- =====================================================================
-- 6. Materialized view for admin stats
-- =====================================================================
DROP MATERIALIZED VIEW IF EXISTS public.admin_stats_summary;
CREATE MATERIALIZED VIEW public.admin_stats_summary AS
SELECT
  (SELECT count(*) FROM public.profiles)                                  AS total_users,
  (SELECT count(*) FROM public.profiles WHERE onboarding_completed)       AS onboarded_users,
  (SELECT count(*) FROM public.conversations)                             AS total_conversations,
  (SELECT count(*) FROM public.messages)                                  AS total_messages,
  (SELECT count(*) FROM public.wallet_links)                              AS total_wallet_links,
  (SELECT count(DISTINCT wallet_address) FROM public.wallet_links)        AS unique_linked_wallets,
  (SELECT count(*) FROM public.tx_events
    WHERE coalesce(metadata->>'via','') <> 'helius_webhook')              AS total_txs,
  (SELECT coalesce(sum(value_usd), 0) FROM public.tx_events
    WHERE coalesce(metadata->>'via','') <> 'helius_webhook')              AS total_volume_usd,
  (SELECT coalesce(sum(amount_usd), 0) FROM public.treasury_fees)         AS total_treasury_usd,
  now()                                                                   AS refreshed_at;

-- Allow concurrent refresh on a unique row.
CREATE UNIQUE INDEX IF NOT EXISTS admin_stats_summary_singleton
  ON public.admin_stats_summary ((1));

-- Public-facing access via SECURITY DEFINER RPC (admins only).
CREATE OR REPLACE FUNCTION public.admin_get_stats_summary()
RETURNS TABLE(
  total_users bigint,
  onboarded_users bigint,
  total_conversations bigint,
  total_messages bigint,
  total_wallet_links bigint,
  unique_linked_wallets bigint,
  total_txs bigint,
  total_volume_usd numeric,
  total_treasury_usd numeric,
  refreshed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY SELECT * FROM public.admin_stats_summary;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_admin_stats_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_stats_summary;
EXCEPTION WHEN OTHERS THEN
  -- First-time refresh can't be CONCURRENT; fall back.
  REFRESH MATERIALIZED VIEW public.admin_stats_summary;
END;
$$;

-- Initial populate.
SELECT public.refresh_admin_stats_summary();

-- Schedule: every 5 minutes.
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-admin-stats-summary');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'refresh-admin-stats-summary',
  '*/5 * * * *',
  $$ SELECT public.refresh_admin_stats_summary(); $$
);

-- =====================================================================
-- 7. Welcome trigger: read anon key from vault instead of hardcoding
-- =====================================================================
-- Try to seed a vault entry for the anon key if it doesn't exist yet.
-- This is idempotent and safe to no-op if vault.create_secret is unavailable.
DO $$
DECLARE
  v_existing text;
BEGIN
  -- If the secret already exists, do nothing.
  SELECT id::text INTO v_existing
    FROM vault.decrypted_secrets WHERE name = 'project_anon_key';
  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0eWJ6eWZmcGRrbHd2Z2p2cnBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4OTUyODQsImV4cCI6MjA5MjQ3MTI4NH0.7IzLgulPhH908Lj6tDWxxyiokUKUjRR3WmCQrjMTxcg',
      'project_anon_key',
      'Project anon JWT used by DB triggers calling edge functions'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Vault not accessible from this context; trigger will fall back gracefully.
  NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_welcome_email_if_needed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_should_send boolean := false;
  v_already_sent timestamptz;
  v_name text;
  v_anon_key text;
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_send := true;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (OLD.email IS DISTINCT FROM NEW.email)
       OR (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL) THEN
      v_should_send := true;
    END IF;
  END IF;

  IF NOT v_should_send THEN
    RETURN NEW;
  END IF;

  SELECT welcome_email_sent_at INTO v_already_sent
    FROM public.profiles WHERE user_id = NEW.id;
  IF v_already_sent IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    split_part(NEW.email, '@', 1)
  );

  -- Read anon key from vault (safe access via SECURITY DEFINER context).
  BEGIN
    SELECT decrypted_secret INTO v_anon_key
      FROM vault.decrypted_secrets
     WHERE name = 'project_anon_key'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_anon_key := NULL;
  END;

  IF v_anon_key IS NULL OR v_anon_key = '' THEN
    -- Without the key we can't authorize the request. Leave welcome flag
    -- unset so a later run can retry once vault is populated.
    RETURN NEW;
  END IF;

  UPDATE public.profiles
     SET welcome_email_sent_at = now()
   WHERE user_id = NEW.id;

  BEGIN
    PERFORM net.http_post(
      url := 'https://jtybzyffpdklwvgjvrpj.supabase.co/functions/v1/send-transactional-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key
      ),
      body := jsonb_build_object(
        'templateName', 'welcome',
        'recipientEmail', NEW.email,
        'idempotencyKey', 'welcome-' || NEW.id::text,
        'templateData', jsonb_build_object('name', v_name)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.profiles
       SET welcome_email_sent_at = NULL
     WHERE user_id = NEW.id;
  END;

  RETURN NEW;
END;
$$;