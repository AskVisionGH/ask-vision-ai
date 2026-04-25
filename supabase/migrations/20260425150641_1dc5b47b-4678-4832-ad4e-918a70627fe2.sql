-- 1) Update existing auth-side welcome trigger function to prefer profiles.display_name
CREATE OR REPLACE FUNCTION public.send_welcome_email_if_needed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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

  -- Prefer the user's chosen display name from their profile, then fall back
  -- to Google/auth metadata, then the email local-part.
  SELECT NULLIF(display_name, '') INTO v_name
    FROM public.profiles WHERE user_id = NEW.id;

  IF v_name IS NULL OR v_name = '' THEN
    v_name := COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      split_part(NEW.email, '@', 1)
    );
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_anon_key
      FROM vault.decrypted_secrets
     WHERE name = 'project_anon_key'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_anon_key := NULL;
  END;

  IF v_anon_key IS NULL OR v_anon_key = '' THEN
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
$function$;

-- 2) New function fired when a profile finishes onboarding. Sends the welcome
--    email if it wasn't sent yet (covers wallet-only signups that added an
--    email later, and ensures the user's chosen display name is used).
CREATE OR REPLACE FUNCTION public.send_welcome_email_on_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_email text;
  v_email_confirmed_at timestamptz;
  v_name text;
  v_anon_key text;
BEGIN
  -- Only react when onboarding flips from false -> true.
  IF NOT (COALESCE(OLD.onboarding_completed, false) = false
          AND NEW.onboarding_completed = true) THEN
    RETURN NEW;
  END IF;

  -- Skip if welcome already sent.
  IF NEW.welcome_email_sent_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Need a confirmed email on auth.users to send to.
  SELECT email, email_confirmed_at
    INTO v_email, v_email_confirmed_at
    FROM auth.users WHERE id = NEW.user_id;

  IF v_email IS NULL OR v_email = '' OR v_email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  v_name := COALESCE(
    NULLIF(NEW.display_name, ''),
    split_part(v_email, '@', 1)
  );

  BEGIN
    SELECT decrypted_secret INTO v_anon_key
      FROM vault.decrypted_secrets
     WHERE name = 'project_anon_key'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_anon_key := NULL;
  END;

  IF v_anon_key IS NULL OR v_anon_key = '' THEN
    RETURN NEW;
  END IF;

  -- Mark first to avoid duplicate sends on rapid updates.
  NEW.welcome_email_sent_at := now();

  BEGIN
    PERFORM net.http_post(
      url := 'https://jtybzyffpdklwvgjvrpj.supabase.co/functions/v1/send-transactional-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key
      ),
      body := jsonb_build_object(
        'templateName', 'welcome',
        'recipientEmail', v_email,
        'idempotencyKey', 'welcome-' || NEW.user_id::text,
        'templateData', jsonb_build_object('name', v_name)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NEW.welcome_email_sent_at := NULL;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_send_welcome_on_onboarding ON public.profiles;
CREATE TRIGGER trg_send_welcome_on_onboarding
BEFORE UPDATE OF onboarding_completed ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.send_welcome_email_on_onboarding();