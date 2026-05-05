-- =====================================================================
-- Task #32 — In-app notifications + bell
-- =====================================================================
-- Adds `public.notifications` (per-user, RLS-protected) plus the
-- server-side machinery that creates rows automatically when something
-- the user cares about happens:
--   • task_assigned             — someone (re)assigned a task to you
--   • task_waiting_confirmation — assignee asks creator to confirm
--   • task_confirmed            — creator/staff confirmed your task
--   • task_rejected             — creator/staff rejected your task
--   • chat_added                — added to a group/channel
--   • mute_issued               — you got muted
--   • ban_issued                — you got banned
--
-- Notifications are NEVER inserted by the client. INSERT/UPDATE/DELETE
-- are blocked by RLS — only SECURITY DEFINER helpers (`_notify`) and
-- the `notifications_mark_read*` RPCs may write. SELECT is owner-only.
--
-- Idempotent.  Safe to re-run.
-- =====================================================================

set search_path = public;

-- ── 1. Table ──────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;

-- ── 2. RLS — owner-only SELECT, all writes blocked ────────────────────
alter table public.notifications enable row level security;

drop policy if exists "Owner reads own notifications" on public.notifications;
create policy "Owner reads own notifications"
  on public.notifications
  for select
  to authenticated
  using (user_id = auth.uid());

-- No INSERT / UPDATE / DELETE policies on purpose: with RLS enabled
-- and no permissive policy, every non-SECURITY-DEFINER write is
-- denied.  All mutations go through the helpers below.

-- ── 3. SECURITY DEFINER write helper ──────────────────────────────────
create or replace function public._notify(
  p_user_id uuid,
  p_kind    text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_kind is null then
    return;
  end if;
  insert into public.notifications (user_id, kind, payload)
  values (p_user_id, p_kind, coalesce(p_payload, '{}'::jsonb));
end $$;

-- Internal helper — never expose to clients directly.
revoke all on function public._notify(uuid, text, jsonb)
  from public, anon, authenticated;

-- ── 4. Mark-read RPCs ────────────────────────────────────────────────
create or replace function public.notifications_mark_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = p_id and user_id = v_caller;
end $$;

create or replace function public.notifications_mark_all_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.notifications
     set read_at = now()
   where user_id = v_caller and read_at is null;
end $$;

revoke all on function public.notifications_mark_read(uuid)    from public, anon;
revoke all on function public.notifications_mark_all_read()    from public, anon;
grant execute on function public.notifications_mark_read(uuid) to authenticated;
grant execute on function public.notifications_mark_all_read() to authenticated;

-- ── 5. Trigger fns: tasks (assigned / waiting / confirmed / rejected) ─
create or replace function public._notify_tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Initial assignment on task creation: notify the assignee unless
  -- the actor is the assignee themselves.
  if new.assignee_id is not null
     and new.assignee_id is distinct from v_actor then
    perform public._notify(
      new.assignee_id,
      'task_assigned',
      jsonb_build_object(
        'task_id', new.id,
        'title',   new.title,
        'priority', new.priority::text,
        'actor_id', v_actor
      )
    );
  end if;
  return null;
end $$;

create or replace function public._notify_tasks_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Re-assignment: someone other than the new assignee changed
  -- assignee_id to a non-null value.
  if new.assignee_id is distinct from old.assignee_id
     and new.assignee_id is not null
     and new.assignee_id is distinct from v_actor then
    perform public._notify(
      new.assignee_id,
      'task_assigned',
      jsonb_build_object(
        'task_id',  new.id,
        'title',    new.title,
        'priority', new.priority::text,
        'actor_id', v_actor
      )
    );
  end if;

  -- Status transitions notify the relevant party.
  if new.status is distinct from old.status then
    if new.status = 'waiting_confirmation' then
      -- Assignee asks creator to confirm.
      if new.created_by is not null
         and new.created_by is distinct from v_actor then
        perform public._notify(
          new.created_by,
          'task_waiting_confirmation',
          jsonb_build_object(
            'task_id', new.id,
            'title',   new.title,
            'actor_id', v_actor
          )
        );
      end if;
    elsif new.status = 'confirmed' then
      if new.assignee_id is not null
         and new.assignee_id is distinct from v_actor then
        perform public._notify(
          new.assignee_id,
          'task_confirmed',
          jsonb_build_object(
            'task_id', new.id,
            'title',   new.title,
            'actor_id', v_actor
          )
        );
      end if;
    elsif new.status = 'rejected' then
      if new.assignee_id is not null
         and new.assignee_id is distinct from v_actor then
        perform public._notify(
          new.assignee_id,
          'task_rejected',
          jsonb_build_object(
            'task_id', new.id,
            'title',   new.title,
            'actor_id', v_actor
          )
        );
      end if;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_notify_tasks_after_insert on public.tasks;
drop trigger if exists trg_notify_tasks_after_update on public.tasks;
create trigger trg_notify_tasks_after_insert
  after insert on public.tasks
  for each row execute function public._notify_tasks_after_insert();
create trigger trg_notify_tasks_after_update
  after update on public.tasks
  for each row execute function public._notify_tasks_after_update();

-- ── 6. Trigger fn: chat_members (chat_added) ─────────────────────────
-- Fires after a row is added to chat_members. Skips the chat creator
-- (auto-added as owner by the existing creator-as-owner trigger) so
-- people don't get notified about chats they made themselves.
create or replace function public._notify_chat_members_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat   public.chats%rowtype;
begin
  select * into v_chat from public.chats where id = new.chat_id;
  if not found then
    return null;
  end if;
  -- Skip the creator's own membership (added by the
  -- add_chat_creator_as_owner trigger).
  if v_chat.created_by is not null and v_chat.created_by = new.user_id then
    return null;
  end if;
  -- Don't notify yourself if you're somehow the actor.
  if auth.uid() is not null and auth.uid() = new.user_id then
    return null;
  end if;
  -- Private one-to-one chats also fire this — surfacing them is fine
  -- ("you have a new conversation").
  perform public._notify(
    new.user_id,
    'chat_added',
    jsonb_build_object(
      'chat_id',   v_chat.id,
      'chat_name', v_chat.name,
      'chat_type', v_chat.type,
      'actor_id',  auth.uid()
    )
  );
  return null;
end $$;

drop trigger if exists trg_notify_chat_members_after_insert on public.chat_members;
create trigger trg_notify_chat_members_after_insert
  after insert on public.chat_members
  for each row execute function public._notify_chat_members_after_insert();

-- ── 7. Trigger fns: bans / mutes ─────────────────────────────────────
create or replace function public._notify_bans_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._notify(
    new.user_id,
    'ban_issued',
    jsonb_build_object(
      'reason',     new.reason,
      'expires_at', new.expires_at,
      'actor_id',   new.issued_by
    )
  );
  return null;
end $$;

create or replace function public._notify_mutes_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._notify(
    new.user_id,
    'mute_issued',
    jsonb_build_object(
      'chat_id',    new.chat_id,
      'reason',     new.reason,
      'expires_at', new.expires_at,
      'actor_id',   new.issued_by
    )
  );
  return null;
end $$;

drop trigger if exists trg_notify_bans_after_insert  on public.bans;
drop trigger if exists trg_notify_mutes_after_insert on public.mutes;
create trigger trg_notify_bans_after_insert
  after insert on public.bans
  for each row execute function public._notify_bans_after_insert();
create trigger trg_notify_mutes_after_insert
  after insert on public.mutes
  for each row execute function public._notify_mutes_after_insert();

-- ── 8. Realtime publication ──────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ── 9. Web-push outbox ───────────────────────────────────────────────
-- Per-(notification × subscription) queue drained by the api-server's
-- pushDispatcher worker (uses the service-role key to bypass RLS).
-- Pre-rendered Russian title/body/url avoid a second round-trip from
-- the worker.  Locked down: clients have ZERO access — only the
-- service role may read or mutate this table.
create table if not exists public.notifications_push_outbox (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  user_id         uuid not null,
  payload         jsonb not null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  attempt_count   int not null default 0,
  last_error      text,
  unique (notification_id, subscription_id)
);

create index if not exists notifications_push_outbox_pending_idx
  on public.notifications_push_outbox (created_at)
  where sent_at is null;

alter table public.notifications_push_outbox enable row level security;
-- No policies on purpose: service-role bypasses RLS; everyone else
-- is denied. Defence-in-depth in case the table is ever exposed via
-- PostgREST.

-- Build the Russian-language push payload for a notification row.
-- Mirrors `formatNotification` in NotificationBell.tsx.
create or replace function public._notification_push_payload(
  p_kind text,
  p_payload jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_title    text := 'КУБ';
  v_body     text := '';
  v_url      text := '/';
  v_t_title  text := nullif(p_payload->>'title', '');
  v_chat     text := nullif(p_payload->>'chat_name', '');
  v_chat_id  text := nullif(p_payload->>'chat_id', '');
  v_reason   text := nullif(p_payload->>'reason', '');
begin
  if p_kind = 'task_assigned' then
    v_body := coalesce('Новая задача: «' || v_t_title || '»', 'Вам назначена задача');
    v_url  := '/tasks';
  elsif p_kind = 'task_waiting_confirmation' then
    v_body := coalesce('Задача «' || v_t_title || '» ждёт подтверждения', 'Задача ждёт подтверждения');
    v_url  := '/tasks';
  elsif p_kind = 'task_confirmed' then
    v_body := coalesce('Задача «' || v_t_title || '» подтверждена', 'Задача подтверждена');
    v_url  := '/tasks';
  elsif p_kind = 'task_rejected' then
    v_body := coalesce('Задача «' || v_t_title || '» отклонена', 'Задача отклонена');
    v_url  := '/tasks';
  elsif p_kind = 'chat_added' then
    v_body := coalesce('Вас добавили в чат «' || v_chat || '»', 'Вас добавили в чат');
    v_url  := case when v_chat_id is not null then '/?chat=' || v_chat_id else '/' end;
  elsif p_kind = 'mute_issued' then
    v_body := coalesce('Вам выдан мут: ' || v_reason, 'Вам выдан мут');
    v_url  := case when v_chat_id is not null then '/?chat=' || v_chat_id else '/' end;
  elsif p_kind = 'ban_issued' then
    v_body := coalesce('Вы заблокированы: ' || v_reason, 'Вы заблокированы');
  else
    v_body := 'Новое уведомление';
  end if;
  return jsonb_build_object(
    'title', v_title,
    'body',  v_body,
    'url',   v_url,
    'tag',   'kub-notification:' || p_kind,
    'kind',  p_kind
  );
end $$;

-- Enqueue a row in the outbox for every active push_subscription
-- belonging to the recipient. If the user has no subscriptions the
-- function is a no-op.
create or replace function public._enqueue_push_after_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  v_payload := public._notification_push_payload(new.kind, new.payload);
  insert into public.notifications_push_outbox (
    notification_id, subscription_id, user_id, payload
  )
  select new.id, ps.id, new.user_id, v_payload
    from public.push_subscriptions ps
   where ps.user_id = new.user_id
  on conflict (notification_id, subscription_id) do nothing;
  return null;
end $$;

drop trigger if exists trg_enqueue_push_after_notification_insert on public.notifications;
create trigger trg_enqueue_push_after_notification_insert
  after insert on public.notifications
  for each row execute function public._enqueue_push_after_notification_insert();
