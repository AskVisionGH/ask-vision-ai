-- 1. Track whether we've already sent the welcome email per user
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;

-- 2. Trigger function: enqueue the branded welcome email via the
--    send-transactional-email edge function. Uses pg_net so it never
--    blocks the auth signup transaction.
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
  v_service_key text;
BEGIN
  -- Only consider rows that have a confirmed email address.
  IF NEW.email IS NULL OR NEW.email = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_send := true;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Fire when email is newly set/changed AND now confirmed.
    IF (OLD.email IS DISTINCT FROM NEW.email)
       OR (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL) THEN
      v_should_send := true;
    END IF;
  END IF;

  IF NOT v_should_send THEN
    RETURN NEW;
  END IF;

  -- Don't double-send per-user (covers email re-confirmations / re-changes).
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

  -- Mark optimistically so concurrent updates don't double-fire.
  UPDATE public.profiles
     SET welcome_email_sent_at = now()
   WHERE user_id = NEW.id;

  -- Best-effort enqueue. Edge function uses welcome-${user_id} idempotency key
  -- as a second line of defense.
  BEGIN
    PERFORM net.http_post(
      url := 'https://jtybzyffpdklwvgjvrpj.supabase.co/functions/v1/send-transactional-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0eWJ6eWZmcGRrbHd2Z2p2cnBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4OTUyODQsImV4cCI6MjA5MjQ3MTI4NH0.7IzLgulPhH908Lj6tDWxxyiokUKUjRR3WmCQrjMTxcg'
      ),
      body := jsonb_build_object(
        'templateName', 'welcome',
        'recipientEmail', NEW.email,
        'idempotencyKey', 'welcome-' || NEW.id::text,
        'templateData', jsonb_build_object('name', v_name)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Roll back the optimistic mark so a future event can retry.
    UPDATE public.profiles
       SET welcome_email_sent_at = NULL
     WHERE user_id = NEW.id;
  END;

  RETURN NEW;
END;
$$;

-- 3. Triggers on auth.users for both signup and email-add/confirm.
DROP TRIGGER IF EXISTS send_welcome_email_on_insert ON auth.users;
CREATE TRIGGER send_welcome_email_on_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.send_welcome_email_if_needed();

DROP TRIGGER IF EXISTS send_welcome_email_on_update ON auth.users;
CREATE TRIGGER send_welcome_email_on_update
  AFTER UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.send_welcome_email_if_needed();

-- 4. Backfill: mark existing users with a confirmed email so we don't
--    blast the welcome email to everyone retroactively.
UPDATE public.profiles p
   SET welcome_email_sent_at = COALESCE(p.welcome_email_sent_at, now())
  FROM auth.users u
 WHERE p.user_id = u.id
   AND u.email IS NOT NULL
   AND u.email_confirmed_at IS NOT NULL;