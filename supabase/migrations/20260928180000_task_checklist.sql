-- Tracker item 62: a checklist inside a task. A tester, 2026-09-28: «прописать
-- пункты и отмечать какие выполнены». Approved by the owner on 2026-09-28 with
-- the rest of docs/operations/2026-09-28-database-proposals.md.
--
-- Who sees an item is exactly who sees its task: the read policy is
-- `task_events select scoped`'s, the parent row's visibility, written out.
-- Nobody writes the table directly; four functions do, and each asks the rule
-- `task_update_v3` asks — the creator, staff, or an administrator of the task's
-- own location — except ticking an item off, which the task's assignee may do
-- too: the person doing the work is the one who marks it done. Nothing changes
-- on a task that is confirmed, cancelled or deleted.
--
-- Rollback: 20260928180000_task_checklist.rollback.sql.
begin;

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  position integer not null,
  created_by uuid references public.profiles(id) on delete set null,
  done_by uuid references public.profiles(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_checklist_items_text_valid
    check (text = btrim(text) and char_length(text) between 1 and 500),
  constraint task_checklist_items_done_consistent
    check ((done and done_at is not null) or (not done and done_at is null and done_by is null))
);

create index task_checklist_items_task_position_idx
  on public.task_checklist_items (task_id, position);

-- As `tasks` and `task_events`: a DELETE carries the task, so the detail
-- modal's `task_id` filter hears it.
alter table public.task_checklist_items replica identity full;

alter table public.task_checklist_items enable row level security;

create policy "task_checklist_items select scoped" on public.task_checklist_items
  for select to authenticated
  using (
    exists (
      select 1
        from public.tasks t
       where t.id = task_checklist_items.task_id
         and (t.deleted_at is null or public._task_deleted_visible_to_current_user())
         and public._task_visible_to_current_user_v3(
           t.assignee_id, t.created_by, t.chat_id, t.visibility, t.assignment_scope,
           t.location_id, t.target_role, t.route_admin_id, t.created_for_admin
         )
    )
  );

revoke all on public.task_checklist_items from public, anon, authenticated;
grant select on public.task_checklist_items to authenticated;

-- The rule every change asks, and the one refusal each can give.
create function public._task_checklist_assert_can_change(p_task public.tasks, p_ticking boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if p_task.deleted_at is not null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if p_task.status in ('confirmed', 'cancelled') then
    raise exception 'task_locked: status=%', p_task.status using errcode = '22023';
  end if;
  if v_caller is not distinct from p_task.created_by
     or public.is_manager_or_admin(v_caller)
     or (p_task.location_id is not null and public.is_location_admin(p_task.location_id, v_caller))
     or (p_ticking and v_caller is not distinct from p_task.assignee_id) then
    return;
  end if;
  raise exception 'forbidden' using errcode = '42501';
end $$;

create function public.task_checklist_add(p_task_id uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_text text := btrim(coalesce(p_text, ''));
  v_position integer;
  v_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  perform public._task_checklist_assert_can_change(v_task, false);
  if char_length(v_text) not between 1 and 500 then
    raise exception 'checklist_text_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.task_checklist_items where task_id = p_task_id) >= 100 then
    raise exception 'checklist_full' using errcode = '22023';
  end if;
  select coalesce(max(position), 0) + 1 into v_position
    from public.task_checklist_items where task_id = p_task_id;
  insert into public.task_checklist_items (task_id, text, position, created_by)
  values (p_task_id, v_text, v_position, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.task_checklist_rename(p_item_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item public.task_checklist_items%rowtype;
  v_task public.tasks%rowtype;
  v_text text := btrim(coalesce(p_text, ''));
begin
  select * into v_item from public.task_checklist_items where id = p_item_id for update;
  if not found then
    raise exception 'checklist_item_not_found' using errcode = 'P0002';
  end if;
  select * into v_task from public.tasks where id = v_item.task_id;
  perform public._task_checklist_assert_can_change(v_task, false);
  if char_length(v_text) not between 1 and 500 then
    raise exception 'checklist_text_invalid' using errcode = '22023';
  end if;
  update public.task_checklist_items set text = v_text, updated_at = now() where id = p_item_id;
end $$;

create function public.task_checklist_set_done(p_item_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item public.task_checklist_items%rowtype;
  v_task public.tasks%rowtype;
begin
  select * into v_item from public.task_checklist_items where id = p_item_id for update;
  if not found then
    raise exception 'checklist_item_not_found' using errcode = 'P0002';
  end if;
  select * into v_task from public.tasks where id = v_item.task_id;
  perform public._task_checklist_assert_can_change(v_task, true);
  update public.task_checklist_items
     set done = coalesce(p_done, false),
         done_by = case when coalesce(p_done, false) then auth.uid() else null end,
         done_at = case when coalesce(p_done, false) then now() else null end,
         updated_at = now()
   where id = p_item_id;
end $$;

create function public.task_checklist_remove(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item public.task_checklist_items%rowtype;
  v_task public.tasks%rowtype;
begin
  select * into v_item from public.task_checklist_items where id = p_item_id for update;
  if not found then
    raise exception 'checklist_item_not_found' using errcode = 'P0002';
  end if;
  select * into v_task from public.tasks where id = v_item.task_id;
  perform public._task_checklist_assert_can_change(v_task, false);
  delete from public.task_checklist_items where id = p_item_id;
end $$;

revoke all on function public._task_checklist_assert_can_change(public.tasks, boolean) from public, anon, authenticated;
revoke all on function public.task_checklist_add(uuid, text) from public, anon;
revoke all on function public.task_checklist_rename(uuid, text) from public, anon;
revoke all on function public.task_checklist_set_done(uuid, boolean) from public, anon;
revoke all on function public.task_checklist_remove(uuid) from public, anon;
grant execute on function public.task_checklist_add(uuid, text) to authenticated, service_role;
grant execute on function public.task_checklist_rename(uuid, text) to authenticated, service_role;
grant execute on function public.task_checklist_set_done(uuid, boolean) to authenticated, service_role;
grant execute on function public.task_checklist_remove(uuid) to authenticated, service_role;

alter publication supabase_realtime add table public.task_checklist_items;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.task_checklist_items'::regclass)
    or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'task_checklist_items') <> 1
    or pg_catalog.has_table_privilege('anon', 'public.task_checklist_items', 'SELECT')
    or not pg_catalog.has_table_privilege('authenticated', 'public.task_checklist_items', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.task_checklist_items', 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', 'public.task_checklist_items', 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.task_checklist_items', 'DELETE')
    or pg_catalog.has_function_privilege('authenticated', 'public._task_checklist_assert_can_change(public.tasks, boolean)', 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', 'public.task_checklist_add(uuid, text)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', 'public.task_checklist_set_done(uuid, boolean)', 'EXECUTE')
    or not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_checklist_items'
    )
    or (select relreplident from pg_class where oid = 'public.task_checklist_items'::regclass) <> 'f'
  then
    raise exception 'task_checklist_migration_incomplete';
  end if;
end;
$$;

commit;
