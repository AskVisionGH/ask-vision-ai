-- Stores the single Helius webhook we manage for tracked-wallet activity.
-- Only one active row at a time (singleton enforced in app code).
create table if not exists public.helius_webhooks (
  id uuid primary key default gen_random_uuid(),
  webhook_id text not null,            -- Helius's ID for the webhook
  auth_header text not null,           -- shared secret Helius sends back as Authorization
  address_count int not null default 0,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.helius_webhooks enable row level security;

create policy "Admins view helius webhooks"
  on public.helius_webhooks
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- (Service role bypasses RLS; no other write policies needed.)

create trigger update_helius_webhooks_updated_at
  before update on public.helius_webhooks
  for each row execute function public.update_updated_at_column();