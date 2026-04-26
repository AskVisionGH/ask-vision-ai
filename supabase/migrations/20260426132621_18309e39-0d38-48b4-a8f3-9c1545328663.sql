-- Welcome emails should fire only on onboarding completion, where the
-- profile already has a display_name. The auth.users-side triggers fire
-- immediately on email confirmation — before the user has set their
-- display name — and end up addressing people by the local-part of their
-- email. They also "burn" welcome_email_sent_at, blocking the onboarding
-- trigger from running later.

DROP TRIGGER IF EXISTS send_welcome_email_on_insert ON auth.users;
DROP TRIGGER IF EXISTS send_welcome_email_on_update ON auth.users;
DROP FUNCTION IF EXISTS public.send_welcome_email_if_needed();