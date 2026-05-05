-- Web Push subscriptions: one row per device per user.
-- The push-worker reads these to deliver notifications when new messages arrive.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Endpoint is unique per device — re-subscribing on the same browser
  -- replaces the row instead of duplicating it.
  unique (endpoint)
);

create index if not exists idx_push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- A user may read / write only their own subscriptions.
-- The push-worker uses the service-role key, which bypasses RLS.
create policy "users manage own push subs"
  on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
