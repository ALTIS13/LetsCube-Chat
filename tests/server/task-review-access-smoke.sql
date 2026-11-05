-- Synthetic test accounts only; all fixtures, grants, events and alerts roll back.
-- Run with ON_ERROR_STOP. Also executable against the pre-migration baseline.
begin;
set local statement_timeout = '30s';
create temporary table qa_task_review_context(actor uuid, peer uuid);
insert into qa_task_review_context
select ids[1], ids[2] from (
  select array_agg(id order by id) ids from (
    select id from public.profiles where is_test_account and not public.is_banned(id) order by id limit 2
  ) q
) q where cardinality(ids) = 2;
do $test$
begin
  if (select count(*) from qa_task_review_context) <> 1 then raise exception 'QA_ACCOUNTS_REQUIRED'; end if;
end $test$;

create function pg_temp.review_case(p_role text, p_participant text, p_action text, p_ok boolean,
                                   p_state public.task_status default 'waiting_confirmation', p_deleted boolean default false)
returns void language plpgsql as $fn$
#variable_conflict use_variable
declare
  actor uuid; peer uuid; task_id uuid := gen_random_uuid(); role_id uuid;
  actual text := 'OK'; rights jsonb; event_payload jsonb;
begin
  select c.actor,c.peer into actor,peer from qa_task_review_context c;
  delete from public.user_global_roles where user_id = actor;
  update public.profiles set role = 'user' where id = actor;
  select id into role_id from public.roles where key = p_role and scope = 'global' and is_active;
  if p_role <> 'none' and role_id is null then raise exception 'QA_ROLE_REQUIRED'; end if;
  if role_id is not null then insert into public.user_global_roles(user_id,role_id) values(actor,role_id); end if;
  insert into public.tasks(id,title,created_by,assignee_id,status,visibility,assignment_scope,deleted_at)
  values(task_id,'QA task review contract',actor,case when p_participant='primary' then actor else peer end,
         p_state,'private','user',case when p_deleted then now() else null end);
  if p_participant='co' then
    insert into public.task_coassignees(task_id,user_id,added_by) values(task_id,actor,actor);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub',actor,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  begin
    if to_regprocedure('public.task_review_access(uuid)') is not null then
      rights := public.task_review_access(task_id);
      if (rights->>'can_review')::boolean is distinct from p_ok then
        raise exception 'QA_READ_WRITE_AUTHORITY_MISMATCH';
      end if;
    end if;
    if p_action='confirm' then perform public.task_confirm(task_id,'QA review');
    else perform public.task_reject(task_id,'QA review'); end if;
  exception when sqlstate '42501' then actual := '42501';
            when sqlstate '22023' then actual := '22023';
  end;
  perform set_config('role','supabase_admin',true);
  if p_ok and actual <> 'OK' then raise exception 'QA_EXPECTED_REVIEW_SUCCESS: %/%/%',p_role,p_participant,p_action; end if;
  if not p_ok and actual = 'OK' then raise exception 'QA_EXPECTED_REVIEW_DENIAL: %/%/%',p_role,p_participant,p_action; end if;
  if p_ok then
    if (select status::text from public.tasks where id=task_id) <>
       (case when p_action='confirm' then 'confirmed' else 'rejected' end) then raise exception 'QA_STATUS_NOT_CHANGED'; end if;
    select payload into event_payload from public.task_events where task_events.task_id=task_id and kind=p_action;
    if p_participant in ('co','primary') then
      if event_payload->>'self_review' is distinct from 'true' or event_payload->>'permission' is distinct from 'tasks.review_own' then
        raise exception 'QA_SELF_REVIEW_NOT_AUDITED';
      end if;
    elsif event_payload ? 'self_review' then raise exception 'QA_FALSE_SELF_REVIEW_AUDIT'; end if;
    if event_payload is null then raise exception 'QA_REVIEW_EVENT_MISSING'; end if;
  else
    if (select status from public.tasks where id=task_id) is distinct from p_state then raise exception 'QA_DENIED_WRITE_OCCURRED'; end if;
  end if;
end $fn$;

-- The first case is RED against the shipped self/co-assignee blanket refusal.
select pg_temp.review_case('owner','co','confirm',true);
select pg_temp.review_case('owner','primary','confirm',true);
select pg_temp.review_case('owner','co','reject',true);
select pg_temp.review_case('owner','other','confirm',true);
select pg_temp.review_case('admin','other','confirm',true);
select pg_temp.review_case('admin','co','confirm',false);
select pg_temp.review_case('admin','primary','reject',false);
select pg_temp.review_case('manager','primary','confirm',false);
select pg_temp.review_case('none','other','confirm',false);
select pg_temp.review_case('owner','co','confirm',false,'confirmed');
select pg_temp.review_case('owner','co','reject',false,'cancelled');
select pg_temp.review_case('owner','co','confirm',false,'waiting_confirmation',true);

-- Capabilities work for a custom role, not just an exception for a role name.
insert into public.roles(key,name,scope,is_active) values('qa_task_review_capability','QA task review capability','global',true);
insert into public.role_permissions(role_id,permission_key)
select id,'tasks.manage' from public.roles where key='qa_task_review_capability';
select pg_temp.review_case('qa_task_review_capability','other','confirm',true);
select pg_temp.review_case('qa_task_review_capability','co','confirm',false);
insert into public.role_permissions(role_id,permission_key)
select id,'tasks.review_own' from public.roles where key='qa_task_review_capability';
select pg_temp.review_case('qa_task_review_capability','co','confirm',true);

-- Restore root capability for the separate unassigned-create control.
select pg_temp.review_case('owner','other','reject',true);

-- An unassigned private task has no recipient, pool, location or routing target.
do $test$
declare actor uuid; v_created_id uuid; created public.tasks%rowtype;
begin
  select c.actor into actor from qa_task_review_context c;
  perform set_config('request.jwt.claims', json_build_object('sub',actor,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  v_created_id := public.task_create_v4(p_title=>'QA unassigned task',p_visibility=>'private',p_assignment_scope=>'user');
  perform set_config('role','supabase_admin',true);
  select * into created from public.tasks where tasks.id=v_created_id;
  if created.status <> 'new' or created.assignee_id is not null or created.chat_id is not null
     or created.location_id is not null or created.target_role is not null or created.route_admin_id is not null
     or created.assignment_scope <> 'user' or created.created_for_admin then raise exception 'QA_UNASSIGNED_NOT_EMPTY'; end if;
end $test$;
select 'PASS_TASK_REVIEW_AND_UNASSIGNED_17';
rollback;
