CREATE TYPE public.alert_rule_kind AS ENUM ('price', 'wallet_activity', 'portfolio_pnl');

CREATE TABLE public.alert_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  kind public.alert_rule_kind NOT NULL,
  label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_triggered_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_rules_user ON public.alert_rules(user_id);
CREATE INDEX idx_alert_rules_enabled ON public.alert_rules(enabled) WHERE enabled = true;

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own alert rules"
  ON public.alert_rules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own alert rules"
  ON public.alert_rules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own alert rules"
  ON public.alert_rules FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own alert rules"
  ON public.alert_rules FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_alert_rules_updated_at
  BEFORE UPDATE ON public.alert_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();