CREATE TYPE public.tx_event_kind AS ENUM ('swap', 'transfer', 'bridge');

CREATE TABLE public.tx_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  kind public.tx_event_kind NOT NULL,
  signature TEXT NOT NULL,
  value_usd NUMERIC,
  input_mint TEXT,
  output_mint TEXT,
  input_amount NUMERIC,
  output_amount NUMERIC,
  recipient TEXT,
  wallet_address TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tx_events_signature_unique ON public.tx_events (signature);
CREATE INDEX tx_events_user_created_idx ON public.tx_events (user_id, created_at DESC);
CREATE INDEX tx_events_kind_created_idx ON public.tx_events (kind, created_at DESC);

ALTER TABLE public.tx_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tx events"
  ON public.tx_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all tx events"
  ON public.tx_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));