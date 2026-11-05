-- Run only on an isolated, egress-blocked clone named letscube_task9_rehearsal,
-- with delivery workers stopped. Use a fresh privileged psql session:
-- psql -X -v ON_ERROR_STOP=1 -d letscube_task9_rehearsal -v qa_owner_id=<uuid> -v qa_viewer_id=<uuid> -f tests/server/task-coassignee-revocation-smoke.sql
-- Bind the two independently identified QA profile IDs, never credentials.
-- Existing profiles, roles, preferences and delivery registrations are read only.
\set ON_ERROR_STOP on
begin isolation level repeatable read;
set local statement_timeout = '30s';
set local lock_timeout = '3s';
set local row_security = on;
set local search_path = pg_catalog;
set local qa.task9_owner_id = :'qa_owner_id';
set local qa.task9_viewer_id = :'qa_viewer_id';

do $smoke$
declare
  v_owner constant uuid := current_setting('qa.task9_owner_id')::uuid;
  v_viewer constant uuid := current_setting('qa.task9_viewer_id')::uuid;
  v_task constant uuid := gen_random_uuid();
  v_title constant text := 'QA task coassignee revocation ' || v_task::text;
  v_notice constant jsonb := jsonb_build_object(
    'task_id', v_task, 'title', v_title, 'priority', 'normal',
    'actor_id', v_owner, 'coassignee', true
  );
  v_empty constant uuid[] := array[]::uuid[];
  v_add_event constant jsonb := jsonb_build_object('coassignees',
    jsonb_build_object('added', array[v_viewer], 'removed', v_empty));
  v_remove_event constant jsonb := jsonb_build_object('coassignees',
    jsonb_build_object('added', v_empty, 'removed', array[v_viewer]));
  v_step record;
  v_original jsonb;
  v_notices uuid[];
  v_exact_notices bigint;
  v_events bigint;
  v_adds bigint;
  v_removes bigint;
begin
  if current_database() <> 'letscube_task9_rehearsal' or current_user <> session_user then
    raise exception 'QA_ISOLATED_CLONE_AND_FRESH_SESSION_REQUIRED';
  end if;
  if exists (
    select 1 from unnest(array[
      'public.profiles', 'public.user_global_roles', 'public.roles', 'public.tasks',
      'public.task_coassignees', 'public.task_events', 'public.notifications',
      'public.push_subscriptions', 'public.user_push_devices', 'public.notifications_push_outbox',
      'public.notifications_native_push_outbox', 'public.album_push_members'
    ]::regclass[]) as rel(oid) where row_security_active(rel.oid)
  ) then
    raise exception 'QA_PRIVILEGED_FIXTURE_INSPECTION_REQUIRED';
  end if;
  if v_owner = v_viewer or (
    select count(*) from public.profiles p
     where p.id in (v_owner, v_viewer) and p.is_test_account is true
       and public.is_banned(p.id) is false
  ) <> 2 then
    raise exception 'QA_TWO_DISTINCT_UNBANNED_TEST_PROFILES_REQUIRED';
  end if;
  if public.has_global_role(v_owner, 'owner') is not true
     or public.has_permission(v_owner, 'tasks.manage') is not true
     or (select p.role::text from public.profiles p where p.id = v_viewer) is distinct from 'user'
     or public.is_manager_or_admin(v_viewer) is not false
     or public.has_permission(v_viewer, 'tasks.manage') is not false
     or public.has_permission(v_viewer, 'tasks.view_all_locations') is not false
     or exists (
       select 1 from public.user_global_roles g join public.roles r on r.id = g.role_id
        where g.user_id = v_viewer and r.scope = 'global' and r.is_active
          and r.key not in ('user', 'client')
     ) then
    raise exception 'QA_REAL_OWNER_AND_ORDINARY_VIEWER_REQUIRED';
  end if;

  -- Keep the normal notification triggers running. No registration or preference
  -- edits: require neither fixture identity to have an enabled delivery endpoint.
  if current_setting('session_replication_role') <> 'origin' or not exists (
    select 1 from pg_trigger t where t.tgrelid = 'public.notifications'::regclass
      and t.tgname = 'trg_enqueue_push_after_notification_insert' and t.tgenabled in ('O', 'A')
  ) then
    raise exception 'QA_NORMAL_PUSH_TRIGGER_REQUIRED';
  end if;
  if exists (select 1 from public.push_subscriptions s where s.user_id in (v_owner, v_viewer) and s.is_active)
     or exists (select 1 from public.user_push_devices d where d.user_id in (v_owner, v_viewer)
                  and d.enabled and d.revoked_at is null) then
    raise exception 'QA_DELIVERY_ENDPOINT_PRESENT';
  end if;
  if exists (select 1 from public.tasks t where t.id = v_task or t.title = v_title) then
    raise exception 'QA_SYNTHETIC_TASK_COLLISION';
  end if;

  -- Seed exactly one private task. The owner's JWT suppresses self-assignment alerts.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  if auth.uid() is distinct from v_owner then raise exception 'QA_SEED_ACTOR_MISMATCH'; end if;
  insert into public.tasks (
    id, title, created_by, assignee_id, status, priority, visibility, assignment_scope,
    chat_id, location_id, target_role, route_admin_id, created_for_admin, deleted_at
  ) values (
    v_task, v_title, v_owner, v_owner, 'new', 'normal', 'private', 'user',
    null, null, null, null, false, null
  );
  select to_jsonb(t) - 'updated_at' into strict v_original from public.tasks t
   where t.id = v_task and t.title = v_title and t.created_by = v_owner and t.assignee_id = v_owner
     and t.status = 'new' and t.priority = 'normal' and t.visibility = 'private' and t.assignment_scope = 'user'
     and t.chat_id is null and t.location_id is null and t.target_role is null and t.route_admin_id is null
     and t.created_for_admin is false and t.deleted_at is null;

  for v_step in select * from (values
    (0, v_empty,         0, 0, 0),
    (1, array[v_viewer], 1, 1, 0),
    (2, v_empty,         0, 1, 1),
    (3, array[v_viewer], 1, 2, 1),
    (4, v_empty,         0, 2, 2)
  ) as steps(step_no, wanted, viewer_rows, notices, removals) order by step_no loop
    if v_step.step_no > 0 then
      perform set_config('request.jwt.claim.sub', v_owner::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      if current_user <> 'authenticated' or auth.uid() is distinct from v_owner
         or not row_security_active('public.tasks'::regclass)
         or (select count(*) from public.tasks t where t.id = v_task) <> 1 then
        raise exception 'QA_OWNER_RLS_CONTROL_FAILED';
      end if;
      perform public.task_set_coassignees(v_task, v_step.wanted);
      perform set_config('role', 'none', true);
    end if;

    -- This is also the exact pre-write state for the following replacement.
    if (select count(*) from public.tasks t where t.id = v_task or t.title = v_title) <> 1
       or (select to_jsonb(t) - 'updated_at' from public.tasks t where t.id = v_task) is distinct from v_original
       or (select count(*) from public.task_coassignees c where c.task_id = v_task) <> v_step.viewer_rows
       or exists (select 1 from public.task_coassignees c where c.task_id = v_task
                    and (c.user_id is distinct from v_viewer or c.added_by is distinct from v_owner)) then
      raise exception 'QA_TASK_OR_MEMBERSHIP_MISMATCH: step %', v_step.step_no;
    end if;

    select count(*),
      count(*) filter (where e.kind = 'update' and e.actor_id = v_owner and e.payload = v_add_event),
      count(*) filter (where e.kind = 'update' and e.actor_id = v_owner and e.payload = v_remove_event)
      into v_events, v_adds, v_removes from public.task_events e where e.task_id = v_task;
    if v_events <> v_step.step_no or v_adds <> v_step.notices or v_removes <> v_step.removals then
      raise exception 'QA_COASSIGNEE_EVENT_MISMATCH: step %', v_step.step_no;
    end if;

    select coalesce(array_agg(n.id), v_empty), count(*) filter (
      where n.user_id = v_viewer and n.kind = 'task_assigned' and n.payload = v_notice
    ) into v_notices, v_exact_notices from public.notifications n
     where n.payload->>'task_id' = v_task::text or n.payload->>'title' = v_title;
    if cardinality(v_notices) <> v_step.notices or v_exact_notices <> v_step.notices then
      raise exception 'QA_ASSIGNMENT_NOTIFICATION_MISMATCH: step %', v_step.step_no;
    end if;
    if exists (select 1 from public.notifications_push_outbox o where o.notification_id = any(v_notices))
       or exists (select 1 from public.notifications_native_push_outbox o where o.notification_id = any(v_notices))
       or exists (select 1 from public.album_push_members m where m.notification_id = any(v_notices)) then
      raise exception 'QA_UNEXPECTED_DELIVERY_QUEUE_ROWS: step %', v_step.step_no;
    end if;

    perform set_config('request.jwt.claim.sub', v_viewer::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    if current_user <> 'authenticated' or auth.uid() is distinct from v_viewer
       or not row_security_active('public.tasks'::regclass)
       or not row_security_active('public.task_coassignees'::regclass) then
      raise exception 'QA_VIEWER_RLS_CONTEXT_FAILED';
    end if;
    if (select count(*) from public.tasks t where t.id = v_task) <> v_step.viewer_rows
       or (select count(*) from public.task_coassignees c where c.task_id = v_task) <> v_step.viewer_rows then
      raise exception 'QA_VIEWER_RLS_VISIBILITY_MISMATCH: step %', v_step.step_no;
    end if;
    perform set_config('role', 'none', true);
  end loop;
end;
$smoke$;

rollback;
select 'PASS_TASK_COASSIGNEE_REVOCATION_RLS_01010_NOTIFICATIONS_01122';
