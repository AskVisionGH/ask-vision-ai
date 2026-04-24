CREATE TABLE public.app_counters (
  key TEXT NOT NULL PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.app_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view counters"
  ON public.app_counters FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Generic increment helper. SECURITY DEFINER so triggers from any user can write.
CREATE OR REPLACE FUNCTION public.bump_counter(_key TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.app_counters (key, value, updated_at)
  VALUES (_key, 1, now())
  ON CONFLICT (key) DO UPDATE
    SET value = public.app_counters.value + 1,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_conversations_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.bump_counter('conversations_created_total');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_messages_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.bump_counter('messages_created_total');
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversations_bump_total
  AFTER INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.bump_conversations_total();

CREATE TRIGGER messages_bump_total
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_messages_total();

-- Backfill so we don't reset to zero today.
INSERT INTO public.app_counters (key, value)
VALUES
  ('conversations_created_total', (SELECT COUNT(*) FROM public.conversations)),
  ('messages_created_total', (SELECT COUNT(*) FROM public.messages))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();