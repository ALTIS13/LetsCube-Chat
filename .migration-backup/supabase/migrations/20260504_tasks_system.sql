-- Computer Club Task System (Task #30) — REVISED
--
-- Adds the work-order workflow for staff: a manager/admin assigns a task
-- to an employee (e.g. "wipe the VIP zone", "fix headphones in box 4"),
-- the employee accepts → starts → sends for confirmation, then a manager/
-- admin (NOT the assignee) either confirms or rejects with a reason.
-- A rejected task can be re-opened by the assignee via task_return_to_work.
-- Every transition is captured in task_events for audit, and the state
-- machine is enforced in SECURITY DEFINER RPCs — never trust the client.
--
-- This revision:
--   • Switches every `is_chat_member(cid, uid)` call to the new safe
--     single-argument helper `is_chat_member(cid)` from the revised
--     Task #28 migration.
--   • Adds explicit `is_banned(caller)` checks at the top of every
--     mutation RPC, since SECURITY DEFINER functions otherwise bypass
--     the restrictive ban veto policies on the underlying tables.
--   • Adds a `not is_banned(auth.uid())` clause to the SELECT policies
--     on tasks and task_events, since those tables are NOT in the
--     restrictive-ban veto loop in roles_admin.
--   • Forbids managers from assigning tasks to admins (admins may
--     assign anyone; managers may assign only users / managers).
--   • Adds the `task_return_to_work` RPC and the corresponding
--     `return_to_work` event kind so a rejected task can re-enter
--     `in_progress` (the spec calls this "вернуть в работу").
--   • Tightens RLS policies with explicit `to authenticated` and adds
--     the explicit `grant select` on the two tables.
--
-- Idempotent: safe to re-apply.  Apply in the Supabase SQL editor.
--
-- Depends on `20260504_roles_admin.sql` (`is_admin`,
-- `is_manager_or_admin`, `is_banned`) AND on the REVISED
-- `20260504_chats_membership_hardening.sql` (`is_chat_member(uuid)`).

-- ── 1. enums ────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum (
      'new', 'assigned', 'accepted', 'in_progress',
      'waiting_confirmation', 'confirmed', 'rejected', 'cancelled'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'task_priority') then
    create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');
  end if;
end $$;

-- ── 2. tables ───────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  priority     public.task_priority not null default 'normal',
  status       public.task_status not null default 'new',
  created_by   uuid references public.profiles(id) on delete set null,
  assignee_id  uuid references public.profiles(id) on delete set null,
  chat_id      uuid references public.chats(id) on delete set null,
  due_at       timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Defensive `add column if not exists` blocks in case an earlier draft
-- created the table with a different column set.
alter table public.tasks add column if not exists priority    public.task_priority not null default 'normal';
alter table public.tasks add column if not exists status      public.task_status   not null default 'new';
alter table public.tasks add column if not exists chat_id     uuid references public.chats(id) on delete set null;
alter table public.tasks add column if not exists due_at      timestamptz;
alter table public.tasks add column if not exists description text;

create index if not exists idx_tasks_assignee_status on public.tasks(assignee_id, status);
create index if not exists idx_tasks_creator_status  on public.tasks(created_by, status);
create index if not exists idx_tasks_chat            on public.tasks(chat_id);
create index if not exists idx_tasks_status          on public.tasks(status);
create index if not exists idx_tasks_priority_due    on public.tasks(priority, due_at);

create table if not exists public.task_events (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Closed set of event kinds — mirrors the TS `TaskEventKind` union.
-- `return_to_work` is new in this revision.  We drop+recreate so that
-- a previously-applied check constraint with the old value list is
-- updated cleanly.
alter table public.task_events drop constraint if exists task_events_kind_check;
alter table public.task_events
  add constraint task_events_kind_check
  check (kind in (
    'create','assign','accept','start','send_for_confirmation',
    'confirm','reject','cancel','comment','update','return_to_work'
  ));

create index if not exists idx_task_events_task_created on public.task_events(task_id, created_at);

-- Realtime UPDATE/DELETE need full row image so `old`/`new` are populated.
alter table public.tasks         replica identity full;
alter table public.task_events   replica identity full;

-- ── 3. RLS — tasks ──────────────────────────────────────────────────────
alter table public.tasks enable row level security;

-- Drop any prior version (named or positional) so this section is fully
-- idempotent and we never end up with two policies enforcing different
-- predicates.
drop policy if exists "tasks select"                  on public.tasks;
drop policy if exists "tasks select for participants" on public.tasks;
drop policy if exists "tasks insert blocked"          on public.tasks;
drop policy if exists "tasks update blocked"          on public.tasks;
drop policy if exists "tasks delete blocked"          on public.tasks;

-- SELECT: assignee, creator, staff, or any chat member (when linked).
-- Banned users see nothing — defence in depth (the restrictive ban veto
-- in roles_admin doesn't list `tasks`).
create policy "tasks select for participants"
  on public.tasks for select
  to authenticated
  using (
    not public.is_banned(auth.uid())
    and (
      assignee_id = auth.uid()
      or created_by = auth.uid()
      or public.is_manager_or_admin(auth.uid())
      or (chat_id is not null and public.is_chat_member(chat_id))
    )
  );

-- Direct INSERT/UPDATE/DELETE are blocked.  Mutations go through the
-- SECURITY DEFINER RPCs below, which enforce role + state-machine.
create policy "tasks insert blocked" on public.tasks
  for insert to authenticated with check (false);
create policy "tasks update blocked" on public.tasks
  for update to authenticated using (false) with check (false);
create policy "tasks delete blocked" on public.tasks
  for delete to authenticated using (false);

-- ── 4. RLS — task_events ────────────────────────────────────────────────
alter table public.task_events enable row level security;

drop policy if exists "task_events select"                  on public.task_events;
drop policy if exists "task_events select for participants" on public.task_events;
drop policy if exists "task_events insert blocked"          on public.task_events;
drop policy if exists "task_events update blocked"          on public.task_events;
drop policy if exists "task_events delete blocked"          on public.task_events;

create policy "task_events select for participants"
  on public.task_events for select
  to authenticated
  using (
    not public.is_banned(auth.uid())
    and exists (
      select 1 from public.tasks t
       where t.id = task_events.task_id
         and (
           t.assignee_id = auth.uid()
           or t.created_by = auth.uid()
           or public.is_manager_or_admin(auth.uid())
           or (t.chat_id is not null and public.is_chat_member(t.chat_id))
         )
    )
  );

create policy "task_events insert blocked" on public.task_events
  for insert to authenticated with check (false);
create policy "task_events update blocked" on public.task_events
  for update to authenticated using (false) with check (false);
create policy "task_events delete blocked" on public.task_events
  for delete to authenticated using (false);

-- ── 5. Explicit table-level grants ──────────────────────────────────────
-- RLS still gates which rows are returned; this just makes sure the role
-- isn't blocked at the table grant layer.  Direct INSERT/UPDATE/DELETE
-- are intentionally NOT granted — all writes go through the RPCs.
grant select on public.tasks       to authenticated;
grant select on public.task_events to authenticated;

-- ── 6. internal helper: append an event + bump updated_at ───────────────
create or replace function public.task_append_event(
  p_task_id uuid,
  p_kind    text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.task_events (task_id, actor_id, kind, payload)
  values (p_task_id, auth.uid(), p_kind, coalesce(p_payload, '{}'::jsonb));

  update public.tasks set updated_at = now() where id = p_task_id;
end $$;

revoke all on function public.task_append_event(uuid, text, jsonb)
  from public, anon, authenticated;

-- ── 7. internal helper: assert caller is allowed to assign to target ────
-- Encapsulates the "manager cannot assign to admin" rule so create / assign
-- share one source of truth.  Caller-must-be-staff is checked separately.
create or replace function public._task_assert_can_assign_to(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_admin boolean;
  target_role     public.app_role;
begin
  if p_target is null then
    return;  -- creating a task without an assignee is allowed
  end if;

  if not exists (select 1 from public.profiles where id = p_target) then
    raise exception 'Исполнитель не найден' using errcode = 'P0002';
  end if;

  caller_is_admin := public.is_admin(auth.uid());
  if caller_is_admin then
    return;  -- admins may assign anyone
  end if;

  select role into target_role from public.profiles where id = p_target;
  if target_role = 'admin'::public.app_role then
    raise exception 'Менеджер не может назначать задачи администратору'
      using errcode = '42501';
  end if;
end $$;

revoke all on function public._task_assert_can_assign_to(uuid)
  from public, anon, authenticated;

-- ── 8. RPC — create ─────────────────────────────────────────────────────
create or replace function public.task_create(
  p_title       text,
  p_description text default null,
  p_assignee_id uuid default null,
  p_priority    public.task_priority default 'normal',
  p_due_at      timestamptz default null,
  p_chat_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller   uuid := auth.uid();
  new_id   uuid;
  start_st public.task_status;
begin
  if caller is null then
    raise exception 'Требуется аутентификация' using errcode = '42501';
  end if;
  if public.is_banned(caller) then
    raise exception 'Пользователь заблокирован' using errcode = '42501';
  end if;
  if not public.is_manager_or_admin(caller) then
    raise exception 'Только администратор или менеджер может создавать задачи'
      using errcode = '42501';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'Не указано название задачи' using errcode = '22023';
  end if;
  if p_chat_id is not null
     and not exists (select 1 from public.chats where id = p_chat_id) then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  -- Manager-can't-assign-admin + existence check.
  perform public._task_assert_can_assign_to(p_assignee_id);

  start_st := case when p_assignee_id is null
                   then 'new'::public.task_status
                   else 'assigned'::public.task_status end;

  insert into public.tasks (
    title, description, priority, status,
    created_by, assignee_id, chat_id, due_at
  )
  values (
    btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
    p_priority, start_st,
    caller, p_assignee_id, p_chat_id, p_due_at
  )
  returning id into new_id;

  perform public.task_append_event(
    new_id, 'create',
    jsonb_build_object(
      'priority',    p_priority,
      'assignee_id', p_assignee_id,
      'chat_id',     p_chat_id,
      'due_at',      p_due_at
    )
  );
  return new_id;
end $$;

revoke all on function public.task_create(text, text, uuid, public.task_priority, timestamptz, uuid)
  from public, anon;
grant execute on function public.task_create(text, text, uuid, public.task_priority, timestamptz, uuid)
  to authenticated;

-- ── 9. RPC — assign ─────────────────────────────────────────────────────
-- Allowed source statuses: new, assigned (pre-acceptance only).
create or replace function public.task_assign(
  p_task_id     uuid,
  p_assignee_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  cur    public.tasks%rowtype;
begin
  if caller is null then
    raise exception 'Требуется аутентификация' using errcode = '42501';
  end if;
  if public.is_banned(caller) then
    raise exception 'Пользователь заблокирован' using errcode = '42501';
  end if;
  if not public.is_manager_or_admin(caller) then
    raise exception 'Только администратор или менеджер может назначать задачи'
      using errcode = '42501';
  end if;
  if p_assignee_id is null then
    raise exception 'Исполнитель не указан' using errcode = '22023';
  end if;

  perform public._task_assert_can_assign_to(p_assignee_id);

  select * into cur from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if cur.status not in ('new'::public.task_status, 'assigned'::public.task_status) then
    raise exception 'Назначить можно только новую или назначенную задачу'
      using errcode = '22023';
  end if;

  update public.tasks
     set assignee_id = p_assignee_id,
         status      = 'assigned'::public.task_status
   where id = p_task_id;

  perform public.task_append_event(
    p_task_id, 'assign',
    jsonb_build_object(
      'assignee_id',          p_assignee_id,
      'previous_assignee_id', cur.assignee_id
    )
  );
end $$;

revoke all on function public.task_assign(uuid, uuid) from public, anon;
grant execute on function public.task_assign(uuid, uuid) to authenticated;

-- ── 10. Generic transition RPC — internal ───────────────────────────────
create or replace function public._task_transition(
  p_task_id        uuid,
  p_kind           text,
  p_from_statuses  public.task_status[],
  p_to_status      public.task_status,
  p_assignee_only  boolean,
  p_payload        jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  cur    public.tasks%rowtype;
begin
  if caller is null then
    raise exception 'Требуется аутентификация' using errcode = '42501';
  end if;
  if public.is_banned(caller) then
    raise exception 'Пользователь заблокирован' using errcode = '42501';
  end if;

  select * into cur from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;

  if p_assignee_only and cur.assignee_id <> caller then
    raise exception 'Это действие доступно только исполнителю задачи'
      using errcode = '42501';
  end if;

  if not (cur.status = any (p_from_statuses)) then
    raise exception 'Недопустимый переход из статуса %', cur.status
      using errcode = '22023';
  end if;

  update public.tasks
     set status = p_to_status
   where id = p_task_id;

  perform public.task_append_event(p_task_id, p_kind, p_payload);
end $$;

revoke all on function public._task_transition(uuid, text, public.task_status[], public.task_status, boolean, jsonb)
  from public, anon, authenticated;

-- ── 11. RPC — accept / start / send_for_confirmation (assignee only) ────
create or replace function public.task_accept(p_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._task_transition(
    p_task_id, 'accept',
    array['assigned']::public.task_status[],
    'accepted'::public.task_status,
    true, '{}'::jsonb
  );
end $$;

create or replace function public.task_start(p_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._task_transition(
    p_task_id, 'start',
    array['accepted']::public.task_status[],
    'in_progress'::public.task_status,
    true, '{}'::jsonb
  );
end $$;

create or replace function public.task_send_for_confirmation(
  p_task_id uuid, p_note text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._task_transition(
    p_task_id, 'send_for_confirmation',
    array['in_progress']::public.task_status[],
    'waiting_confirmation'::public.task_status,
    true,
    case when p_note is null or length(btrim(p_note)) = 0
         then '{}'::jsonb
         else jsonb_build_object('note', btrim(p_note)) end
  );
end $$;

-- ── 12. RPC — return_to_work (assignee, after rejection) ────────────────
-- Spec: a rejected task must be re-openable.  Distinct event kind so the
-- audit log clearly shows "вернул(а) задачу в работу".
create or replace function public.task_return_to_work(
  p_task_id uuid, p_note text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._task_transition(
    p_task_id, 'return_to_work',
    array['rejected']::public.task_status[],
    'in_progress'::public.task_status,
    true,
    case when p_note is null or length(btrim(p_note)) = 0
         then '{}'::jsonb
         else jsonb_build_object('note', btrim(p_note)) end
  );
end $$;

revoke all on function public.task_accept(uuid)                       from public, anon;
revoke all on function public.task_start(uuid)                        from public, anon;
revoke all on function public.task_send_for_confirmation(uuid, text)  from public, anon;
revoke all on function public.task_return_to_work(uuid, text)         from public, anon;
grant execute on function public.task_accept(uuid)                       to authenticated;
grant execute on function public.task_start(uuid)                        to authenticated;
grant execute on function public.task_send_for_confirmation(uuid, text)  to authenticated;
grant execute on function public.task_return_to_work(uuid, text)         to authenticated;

-- ── 13. RPC — confirm (admin/manager, NOT the assignee) ─────────────────
create or replace function public.task_confirm(
  p_task_id uuid, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  cur    public.tasks%rowtype;
begin
  if caller is null then
    raise exception 'Требуется аутентификация' using errcode = '42501';
  end if;
  if public.is_banned(caller) then
    raise exception 'Пользователь заблокирован' using errcode = '42501';
  end if;
  if not public.is_manager_or_admin(caller) then
    raise exception 'Подтверждать может только администратор или менеджер'
      using errcode = '42501';
  end if;

  select * into cur from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if cur.status <> 'waiting_confirmation'::public.task_status then
    raise exception 'Подтверждать можно только задачу со статусом «На подтверждении»'
      using errcode = '22023';
  end if;
  if cur.assignee_id = caller then
    raise exception 'Нельзя подтверждать собственную задачу'
      using errcode = '42501';
  end if;

  update public.tasks
     set status = 'confirmed'::public.task_status
   where id = p_task_id;

  perform public.task_append_event(
    p_task_id, 'confirm',
    case when p_note is null or length(btrim(p_note)) = 0
         then '{}'::jsonb
         else jsonb_build_object('note', btrim(p_note)) end
  );
end $$;

revoke all on function public.task_confirm(uuid, text) from public, anon;
grant execute on function public.task_confirm(uuid, text) to authenticated;

-- ── 14. RPC — reject (admin/manager, reason required) ──────────────────
create or replace function public.task_reject(
  p_task_id uuid, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  cur    public.tasks%rowtype;
begin
  if caller is null then
    raise exception 'Требуется аутентификация' using errcode = '42501';
  end if;
  if public.is_banned(caller) then
    raise exception 'Пользователь заблокирован' using errcode = '42501';
  end if;
  if not public.is_manager_or_admin(caller) then
    raise exception 'Отклонять может только администратор или менеджер'
      using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Укажите причину отклонения' using errcode = '22023';
  end if;

  select * into cur from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if cur.status <> 'waiting_confirmation'::public.task_status then
    raise exception 'Отклонять можно только задачу со статусом «На подтверждении»'
      using errcode = '22023';
  end if;
  if cur.assignee_id = caller then
    raise exception 'Нельзя отклонять собственную задачу'
      using errcode = '42501';
  end if;

  update public.tasks
     set status = 'rejected'::public.task_status
   where id = p_task_id;

  perform public.task_append_event(
    p_task_id, 'reject',
    jsonb_build_object('reason', btrim(p_reason))
  );
end $$;

revoke all on function public.task_reject(uuid, text) from public, anon;
grant execute on function public.task_reject(uuid, text) to authenticated;

-- ── 15. RPC — cancel (creator OR admin/manager, reason required) ───────
create or replace function public.task_cancel(
  p_task_id uuid, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  cur    public.tasks%rowtype;
begin
  if caller is null then
    raise exception 'Требуется аутентификация' using errcode = '42501';
  end if;
  if public.is_banned(caller) then
    raise exception 'Пользователь заблокирован' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Укажите причину отмены' using errcode = '22023';
  end if;

  select * into cur from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if not (cur.created_by = caller or public.is_manager_or_admin(caller)) then
    raise exception 'Отменить задачу может только её создатель или администратор/менеджер'
      using errcode = '42501';
  end if;
  if cur.status in (
    'confirmed'::public.task_status,
    'rejected'::public.task_status,
    'cancelled'::public.task_status
  ) then
    raise exception 'Эту задачу уже нельзя отменить'
      using errcode = '22023';
  end if;

  update public.tasks
     set status = 'cancelled'::public.task_status
   where id = p_task_id;

  perform public.task_append_event(
    p_task_id, 'cancel',
    jsonb_build_object('reason', btrim(p_reason))
  );
end $$;

revoke all on function public.task_cancel(uuid, text) from public, anon;
grant execute on function public.task_cancel(uuid, text) to authenticated;

-- ── 16. RPC — comment ──────────────────────────────────────────────────
create or replace function public.task_comment(
  p_task_id uuid, p_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  can    boolean;
begin
  if caller is null then
    raise exception 'Требуется аутентификация' using errcode = '42501';
  end if;
  if public.is_banned(caller) then
    raise exception 'Пользователь заблокирован' using errcode = '42501';
  end if;
  if p_text is null or length(btrim(p_text)) = 0 then
    raise exception 'Комментарий не может быть пустым' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.tasks t
     where t.id = p_task_id
       and (
         t.assignee_id = caller
         or t.created_by = caller
         or public.is_manager_or_admin(caller)
         or (t.chat_id is not null and public.is_chat_member(t.chat_id))
       )
  ) into can;

  if not can then
    raise exception 'Нет доступа к этой задаче' using errcode = '42501';
  end if;

  perform public.task_append_event(
    p_task_id, 'comment',
    jsonb_build_object('text', btrim(p_text))
  );
end $$;

revoke all on function public.task_comment(uuid, text) from public, anon;
grant execute on function public.task_comment(uuid, text) to authenticated;

-- ── 17. Realtime publication ───────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.tasks';
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'task_events'
  ) then
    execute 'alter publication supabase_realtime add table public.task_events';
  end if;
end $$;
