-- Tracker item 66: reminders on a task. A tester, 2026-09-28: «например стоит
-- задача с выполнением на месяц… комплектующие придут только через неделю и
-- тогда надо напоминание, что пора приступать делать. А потом будет вторая
-- поставка… и опять надо напоминание». Approved by the owner on 2026-09-28
-- with the rest of docs/operations/2026-09-28-database-proposals.md (entry 4).
--
-- A reminder is a moment and an optional note, addressed either to its author
-- («Мне») or to whoever is the task's assignee when it fires («Исполнителю»).
-- It arrives as the task notifications already do: a `notifications` row of
-- kind `task_reminder`, which the push trigger turns into a push. pg_cron runs
-- `task_reminders_deliver_due` every minute.
--
-- Two departures from the proposal, both deliberate:
-- * A reminder is read by its author, and by the assignee when it is addressed
--   to them, not by every reader of the task. It is a personal nudge, and a
--   note such as «проверить, пришла ли поставка» is not task content.
-- * The delivery is a pg_cron job in the database, not a poll in the worker:
--   the notification and the stamp are one transaction, no service credential
--   is added anywhere, and the database already runs its minute jobs this way.
--   `cron.job_run_details` records every run; a failed reminder is marked
--   `failed` rather than retried forever.
--
-- `_notification_push_payload` gains one branch, for `task_reminder` only: the
-- push says «Напоминание» and the note, and opens the task itself. The
-- self-check below compares every other kind's output before and after.
--
-- Rollback: 20260928190000_task_reminders.rollback.sql.
begin;

-- What the push payload function answers today, for the self-check.
create temporary table _push_payload_before on commit drop as
select kind, payload, public._notification_push_payload(kind, payload) as output
  from (values
    ('task_assigned', '{"task_id":"00000000-0000-4000-8000-000000000001","title":"T","priority":"urgent"}'::jsonb),
    ('task_waiting_confirmation', '{"task_id":"00000000-0000-4000-8000-000000000001","title":"T"}'::jsonb),
    ('task_confirmed', '{}'::jsonb),
    ('task_rejected', '{"title":"T"}'::jsonb),
    ('message', '{"chat_id":"00000000-0000-4000-8000-000000000002","message_id":"00000000-0000-4000-8000-000000000003","chat_type":"private","sender_name":"A","preview":"p"}'::jsonb),
    ('message', '{"chat_id":"00000000-0000-4000-8000-000000000002","chat_type":"group","chat_name":"G","sender_name":"A","preview":"p","sender_kind":"bot"}'::jsonb),
    ('group_invite', '{"invite_id":"00000000-0000-4000-8000-000000000004","chat_name":"G"}'::jsonb),
    ('chat_added', '{"chat_id":"00000000-0000-4000-8000-000000000002","chat_name":"G"}'::jsonb),
    ('support_operator_message', '{"preview":"p"}'::jsonb),
    ('mute_issued', '{"reason":"r"}'::jsonb),
    ('ban_issued', '{}'::jsonb)
  ) as sample(kind, payload);

create table public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  recipient text not null default 'author',
  remind_at timestamptz not null,
  note text,
  status text not null default 'pending',
  delivered_at timestamptz,
  delivered_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_reminders_recipient_valid check (recipient in ('author', 'assignee')),
  constraint task_reminders_note_valid
    check (note is null or (note = btrim(note) and char_length(note) between 1 and 200)),
  constraint task_reminders_status_valid check (status in ('pending', 'sent', 'skipped', 'failed')),
  constraint task_reminders_delivery_consistent check ((status = 'pending') = (delivered_at is null))
);

-- The delivery's question, what is due, and the detail's, what a task has.
create index task_reminders_due_idx on public.task_reminders (remind_at) where status = 'pending';
create index task_reminders_task_idx on public.task_reminders (task_id, remind_at);
create index task_reminders_created_by_idx on public.task_reminders (created_by);
create index task_reminders_delivered_to_idx on public.task_reminders (delivered_to) where delivered_to is not null;

alter table public.task_reminders enable row level security;

create policy "task_reminders select own" on public.task_reminders
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or (
      recipient = 'assignee'
      and exists (
        select 1
          from public.tasks t
         where t.id = task_reminders.task_id
           and t.deleted_at is null
           and t.assignee_id = (select auth.uid())
      )
    )
  );

create policy "block banned reads" on public.task_reminders
  as restrictive
  for select to authenticated
  using (not public.is_banned(auth.uid()));

revoke all on public.task_reminders from public, anon, authenticated;
grant select on public.task_reminders to authenticated;

-- Who may hold a reminder on a task, asked of any account: its creator, its
-- assignee, staff, or an administrator of its location. Asked when a reminder
-- is set, of the caller, and again when it fires, of the person it goes to.
create function public._task_reminder_may_hold(p_task public.tasks, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  return p_user is not null
     and not public.is_banned(p_user)
     and (
       p_user is not distinct from p_task.created_by
       or p_user is not distinct from p_task.assignee_id
       or public.is_manager_or_admin(p_user)
       or (p_task.location_id is not null and public.is_location_admin(p_task.location_id, p_user))
     );
end $$;

create function public.task_reminder_add(
  p_task_id uuid,
  p_remind_at timestamptz,
  p_recipient text default 'author',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_recipient text := coalesce(p_recipient, 'author');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  select * into v_task from public.tasks where id = p_task_id;
  if not found or v_task.deleted_at is not null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if v_task.status in ('confirmed', 'cancelled') then
    raise exception 'task_locked: status=%', v_task.status using errcode = '22023';
  end if;
  if not public._task_reminder_may_hold(v_task, v_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_recipient not in ('author', 'assignee') then
    raise exception 'reminder_recipient_invalid' using errcode = '22023';
  end if;
  if v_recipient = 'assignee' and v_task.assignee_id is null then
    raise exception 'reminder_no_assignee' using errcode = '22023';
  end if;
  if p_remind_at is null or p_remind_at <= now() then
    raise exception 'reminder_in_past' using errcode = '22023';
  end if;
  if p_remind_at > now() + interval '2 years' then
    raise exception 'reminder_too_far' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'reminder_note_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.task_reminders
       where task_id = p_task_id and created_by = v_caller and status = 'pending') >= 20 then
    raise exception 'reminders_full' using errcode = '22023';
  end if;
  insert into public.task_reminders (task_id, created_by, recipient, remind_at, note)
  values (p_task_id, v_caller, v_recipient, p_remind_at, v_note)
  returning id into v_id;
  return v_id;
end $$;

-- Only its author removes a reminder; to anybody else it does not exist.
create function public.task_reminder_remove(p_reminder_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_reminder public.task_reminders%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_reminder from public.task_reminders where id = p_reminder_id for update;
  if not found or v_reminder.created_by is distinct from v_caller then
    raise exception 'reminder_not_found' using errcode = 'P0002';
  end if;
  delete from public.task_reminders where id = p_reminder_id;
end $$;

-- The minute job. A reminder on a task that was closed or deleted meanwhile,
-- or whose recipient may no longer hold it, is marked `skipped`; one whose
-- notification could not be written is marked `failed`, so a single bad row
-- cannot hold back the rest minute after minute.
create function public.task_reminders_deliver_due(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_reminder public.task_reminders%rowtype;
  v_task public.tasks%rowtype;
  v_recipient uuid;
  v_sent integer := 0;
begin
  for v_reminder in
    select *
      from public.task_reminders
     where status = 'pending' and remind_at <= now()
     order by remind_at
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update skip locked
  loop
    select * into v_task from public.tasks where id = v_reminder.task_id;
    v_recipient := case
      when v_reminder.recipient = 'assignee' and v_task.assignee_id is not null then v_task.assignee_id
      else v_reminder.created_by
    end;
    if v_task.id is null
       or v_task.deleted_at is not null
       or v_task.status in ('confirmed', 'cancelled')
       or not public._task_reminder_may_hold(v_task, v_recipient) then
      update public.task_reminders
         set status = 'skipped', delivered_at = now()
       where id = v_reminder.id;
      continue;
    end if;
    begin
      perform public._notify(
        v_recipient,
        'task_reminder',
        jsonb_build_object(
          'task_id', v_task.id,
          'title', v_task.title,
          'note', v_reminder.note,
          'priority', v_task.priority::text,
          'reminder_id', v_reminder.id,
          'actor_id', v_reminder.created_by
        )
      );
      update public.task_reminders
         set status = 'sent', delivered_at = now(), delivered_to = v_recipient
       where id = v_reminder.id;
      v_sent := v_sent + 1;
    exception when others then
      raise warning 'task_reminder_delivery_failed: % %', v_reminder.id, sqlstate;
      update public.task_reminders
         set status = 'failed', delivered_at = now()
       where id = v_reminder.id;
    end;
  end loop;
  return v_sent;
end $$;

revoke all on function public._task_reminder_may_hold(public.tasks, uuid) from public, anon, authenticated, service_role;
revoke all on function public.task_reminder_add(uuid, timestamptz, text, text) from public, anon;
revoke all on function public.task_reminder_remove(uuid) from public, anon;
revoke all on function public.task_reminders_deliver_due(integer) from public, anon, authenticated, service_role;
grant execute on function public.task_reminder_add(uuid, timestamptz, text, text) to authenticated, service_role;
grant execute on function public.task_reminder_remove(uuid) to authenticated, service_role;

-- The push: the one new branch is `task_reminder`; every other line is the
-- function as it stood.
create or replace function public._notification_push_payload(p_kind text, p_payload jsonb)
 returns jsonb
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  v_title text := 'LETSCUBE';
  v_body text := 'Новое уведомление';
  v_route text := '/';
  v_tag text := 'kub-notification:' || p_kind;
  v_task_id text := nullif(p_payload->>'task_id', '');
  v_task_title text := nullif(p_payload->>'title', '');
  v_invite_id text := nullif(p_payload->>'invite_id', '');
  v_chat_name text := nullif(p_payload->>'chat_name', '');
  v_chat_type text := nullif(p_payload->>'chat_type', '');
  v_chat_id text := nullif(p_payload->>'chat_id', '');
  v_message_id text := nullif(p_payload->>'message_id', '');
  v_preview text := nullif(p_payload->>'preview', '');
  v_sender_name text := nullif(p_payload->>'sender_name', '');
  v_sender_avatar_url text := public._sanitize_notification_avatar_url(
    nullif(p_payload->>'sender_avatar_url', '')
  );
begin
  if p_kind = 'task_reminder' then
    v_title := 'Напоминание';
    v_body := coalesce('«' || v_task_title || '»', 'Задача')
      || coalesce(' — ' || nullif(p_payload->>'note', ''), '');
    v_route := case when v_task_id is not null then '/tasks?task=' || v_task_id else '/tasks' end;
    v_tag := 'task:' || coalesce(v_task_id, p_kind);
  elsif p_kind like 'task_%' then
    v_body := coalesce('Задача: «' || v_task_title || '»', 'Обновление задачи');
    v_route := '/tasks';
    v_tag := 'task:' || coalesce(v_task_id, p_kind);
  elsif p_kind = 'group_invite' then
    v_body := coalesce('Приглашение в «' || v_chat_name || '»', 'Новое приглашение');
    v_route := '/?notifications=1';
    v_tag := 'invite:' || coalesce(v_invite_id, v_chat_id, p_kind);
  elsif p_kind = 'chat_added' then
    v_body := coalesce('Вас добавили в «' || v_chat_name || '»', 'Вас добавили в чат');
    v_route := case when v_chat_id is not null then '/?chat=' || v_chat_id else '/' end;
    v_tag := 'chat-added:' || coalesce(v_chat_id, p_kind);
  elsif p_kind like '%message%' then
    if v_chat_type = 'private' then
      v_title := coalesce(v_sender_name, 'Новое сообщение');
      v_body := coalesce(v_preview, 'Новое сообщение');
    else
      v_title := coalesce(v_chat_name, 'Новое сообщение');
      v_body := case
        when v_sender_name is not null and v_preview is not null then v_sender_name || ': ' || v_preview
        when v_preview is not null then v_preview
        else 'Новое сообщение'
      end;
    end if;
    v_route := case
      when v_chat_id is not null and v_message_id is not null then '/?chat=' || v_chat_id || '&message=' || v_message_id
      when v_chat_id is not null then '/?chat=' || v_chat_id
      else '/'
    end;
    v_tag := 'message:chat:' || coalesce(v_chat_id, v_message_id, 'unknown');
  end if;

  return pg_catalog.jsonb_build_object(
    'title', v_title,
    'body', v_body,
    'url', v_route,
    'tag', v_tag,
    'kind', p_kind,
    'chatId', v_chat_id,
    'messageId', v_message_id,
    'chat_id', v_chat_id,
    'message_id', v_message_id,
    'sender_kind', nullif(p_payload->>'sender_kind', ''),
    'sender_id', nullif(p_payload->>'sender_id', ''),
    'bot_id', nullif(p_payload->>'bot_id', ''),
    'sender_name', v_sender_name,
    'sender_avatar_url', v_sender_avatar_url,
    'message_type', nullif(p_payload->>'message_type', ''),
    'preview', v_preview,
    'route', v_route,
    'group_tag', v_tag
  );
end
$function$;

select cron.schedule(
  'letscube-task-reminders',
  '* * * * *',
  'select public.task_reminders_deliver_due(200)'
);

do $$
declare
  v_reminder jsonb;
begin
  if exists (
    select 1 from _push_payload_before b
     where public._notification_push_payload(b.kind, b.payload) is distinct from b.output
  ) then
    raise exception 'task_reminders_migration_changed_other_pushes';
  end if;
  v_reminder := public._notification_push_payload(
    'task_reminder',
    '{"task_id":"00000000-0000-4000-8000-000000000001","title":"T","note":"N"}'::jsonb
  );
  if v_reminder->>'title' <> 'Напоминание'
     or v_reminder->>'body' <> '«T» — N'
     or v_reminder->>'url' <> '/tasks?task=00000000-0000-4000-8000-000000000001'
     or v_reminder->>'tag' <> 'task:00000000-0000-4000-8000-000000000001' then
    raise exception 'task_reminders_migration_push_wrong: %', v_reminder;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.task_reminders'::regclass)
    or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'task_reminders') <> 2
    or pg_catalog.has_table_privilege('anon', 'public.task_reminders', 'SELECT')
    or not pg_catalog.has_table_privilege('authenticated', 'public.task_reminders', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.task_reminders', 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', 'public.task_reminders', 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.task_reminders', 'DELETE')
    or pg_catalog.has_function_privilege('authenticated', 'public._task_reminder_may_hold(public.tasks, uuid)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', 'public.task_reminders_deliver_due(integer)', 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', 'public.task_reminders_deliver_due(integer)', 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', 'public.task_reminder_add(uuid, timestamptz, text, text)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', 'public.task_reminder_add(uuid, timestamptz, text, text)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', 'public.task_reminder_remove(uuid)', 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', 'public._notification_push_payload(text, jsonb)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', 'public._notification_push_payload(text, jsonb)', 'EXECUTE')
    or (select provolatile from pg_proc where oid = 'public._notification_push_payload(text, jsonb)'::regprocedure) <> 'i'
    or exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_reminders'
    )
    or not exists (
      select 1 from cron.job
       where jobname = 'letscube-task-reminders'
         and schedule = '* * * * *'
         and command = 'select public.task_reminders_deliver_due(200)'
         and active
    )
  then
    raise exception 'task_reminders_migration_incomplete';
  end if;
end;
$$;

commit;
