-- 20260527_push_notifications_foundation.sql
-- Proposal only. Do not apply automatically from Codex.
--
-- Production Web Push foundation:
-- - per-device browser subscriptions;
-- - per-user push preferences;
-- - per-chat push mute preferences;
-- - push outbox enqueue that respects preferences and avoids sender echo.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions
  add column if not exists platform text,
  add column if not exists is_active boolean not null default true,
  add column if not exists last_seen_at timestamptz not null default now();

create unique index if not exists push_subscriptions_user_endpoint_uidx
  on public.push_subscriptions (user_id, endpoint);

create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id, updated_at desc)
  where is_active;

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  push_enabled boolean not null default false,
  message_push_enabled boolean not null default true,
  task_push_enabled boolean not null default true,
  invite_push_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_notification_preferences (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  push_enabled boolean not null default true,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create index if not exists chat_notification_preferences_user_idx
  on public.chat_notification_preferences (user_id, chat_id);

create table if not exists public.notifications_push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempt_count int not null default 0,
  last_error text,
  unique (notification_id, subscription_id)
);

create index if not exists notifications_push_outbox_pending_idx
  on public.notifications_push_outbox (created_at)
  where sent_at is null and attempt_count < 5;

create or replace function public._kub_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_push_subscriptions_touch_updated_at on public.push_subscriptions;
create trigger trg_push_subscriptions_touch_updated_at
  before update on public.push_subscriptions
  for each row execute function public._kub_touch_updated_at();

drop trigger if exists trg_notification_preferences_touch_updated_at on public.notification_preferences;
create trigger trg_notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function public._kub_touch_updated_at();

drop trigger if exists trg_chat_notification_preferences_touch_updated_at on public.chat_notification_preferences;
create trigger trg_chat_notification_preferences_touch_updated_at
  before update on public.chat_notification_preferences
  for each row execute function public._kub_touch_updated_at();

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.chat_notification_preferences enable row level security;
alter table public.notifications_push_outbox enable row level security;

drop policy if exists "push_subscriptions own select" on public.push_subscriptions;
drop policy if exists "push_subscriptions own insert" on public.push_subscriptions;
drop policy if exists "push_subscriptions own update" on public.push_subscriptions;
drop policy if exists "push_subscriptions own delete" on public.push_subscriptions;
create policy "push_subscriptions own select"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);
create policy "push_subscriptions own insert"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);
create policy "push_subscriptions own update"
  on public.push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "push_subscriptions own delete"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

drop policy if exists "notification_preferences own select" on public.notification_preferences;
drop policy if exists "notification_preferences own insert" on public.notification_preferences;
drop policy if exists "notification_preferences own update" on public.notification_preferences;
create policy "notification_preferences own select"
  on public.notification_preferences for select
  using (auth.uid() = user_id);
create policy "notification_preferences own insert"
  on public.notification_preferences for insert
  with check (auth.uid() = user_id);
create policy "notification_preferences own update"
  on public.notification_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "chat_notification_preferences own select" on public.chat_notification_preferences;
drop policy if exists "chat_notification_preferences own insert" on public.chat_notification_preferences;
drop policy if exists "chat_notification_preferences own update" on public.chat_notification_preferences;
drop policy if exists "chat_notification_preferences own delete" on public.chat_notification_preferences;
create policy "chat_notification_preferences own select"
  on public.chat_notification_preferences for select
  using (auth.uid() = user_id);
create policy "chat_notification_preferences own insert"
  on public.chat_notification_preferences for insert
  with check (auth.uid() = user_id);
create policy "chat_notification_preferences own update"
  on public.chat_notification_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "chat_notification_preferences own delete"
  on public.chat_notification_preferences for delete
  using (auth.uid() = user_id);

revoke all on table public.notifications_push_outbox from anon, authenticated;

create or replace function public._notification_push_payload(
  p_kind text,
  p_payload jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_title text := 'КУБ';
  v_body text := 'Новое уведомление';
  v_url text := '/';
  v_task_title text := nullif(p_payload->>'title', '');
  v_chat_name text := nullif(p_payload->>'chat_name', '');
  v_chat_id text := nullif(p_payload->>'chat_id', '');
begin
  if p_kind like 'task_%' then
    v_body := coalesce('Задача: «' || v_task_title || '»', 'Обновление задачи');
    v_url := '/tasks';
  elsif p_kind = 'group_invite' then
    v_body := coalesce('Приглашение в «' || v_chat_name || '»', 'Новое приглашение');
    v_url := '/?notifications=1';
  elsif p_kind = 'chat_added' then
    v_body := coalesce('Вас добавили в «' || v_chat_name || '»', 'Вас добавили в чат');
    v_url := case when v_chat_id is not null then '/?chat=' || v_chat_id else '/' end;
  elsif p_kind like '%message%' then
    v_body := coalesce('Новое сообщение в «' || v_chat_name || '»', 'Новое сообщение');
    v_url := case when v_chat_id is not null then '/?chat=' || v_chat_id else '/' end;
  end if;

  return jsonb_build_object(
    'title', v_title,
    'body', v_body,
    'url', v_url,
    'tag', 'kub-notification:' || p_kind,
    'kind', p_kind,
    'chatId', v_chat_id
  );
end $$;

create or replace function public._notification_push_allowed(
  p_user_id uuid,
  p_kind text,
  p_payload jsonb
)
returns boolean
language plpgsql
stable
as $$
declare
  v_prefs public.notification_preferences%rowtype;
  v_chat_id uuid;
  v_chat_pref public.chat_notification_preferences%rowtype;
  v_sender_id uuid;
begin
  select * into v_prefs
  from public.notification_preferences
  where user_id = p_user_id;

  if coalesce(v_prefs.push_enabled, false) is not true then
    return false;
  end if;

  if p_kind like '%message%' and coalesce(v_prefs.message_push_enabled, true) is not true then
    return false;
  end if;
  if p_kind like 'task_%' and coalesce(v_prefs.task_push_enabled, true) is not true then
    return false;
  end if;
  if p_kind = 'group_invite' and coalesce(v_prefs.invite_push_enabled, true) is not true then
    return false;
  end if;

  if (p_payload->>'sender_id') ~* '^[0-9a-f-]{36}$' then
    v_sender_id := (p_payload->>'sender_id')::uuid;
    if v_sender_id = p_user_id then
      return false;
    end if;
  end if;

  if (p_payload->>'chat_id') ~* '^[0-9a-f-]{36}$' then
    v_chat_id := (p_payload->>'chat_id')::uuid;
    select * into v_chat_pref
    from public.chat_notification_preferences
    where chat_id = v_chat_id and user_id = p_user_id;

    if found then
      if v_chat_pref.push_enabled is not true then
        return false;
      end if;
      if v_chat_pref.muted_until is not null and v_chat_pref.muted_until > now() then
        return false;
      end if;
    end if;
  end if;

  return true;
end $$;

create or replace function public._enqueue_push_after_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  if not public._notification_push_allowed(new.user_id, new.kind, new.payload) then
    return null;
  end if;

  v_payload := public._notification_push_payload(new.kind, new.payload);
  insert into public.notifications_push_outbox (
    notification_id, subscription_id, user_id, payload
  )
  select new.id, ps.id, new.user_id, v_payload
  from public.push_subscriptions ps
  where ps.user_id = new.user_id
    and ps.is_active is true
  on conflict (notification_id, subscription_id) do nothing;

  return null;
end $$;

drop trigger if exists trg_enqueue_push_after_notification_insert on public.notifications;
create trigger trg_enqueue_push_after_notification_insert
  after insert on public.notifications
  for each row execute function public._enqueue_push_after_notification_insert();
