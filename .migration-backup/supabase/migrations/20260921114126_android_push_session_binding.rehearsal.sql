-- OFFLINE, EMPTY schema clone ONLY, after the migration. Execute with
-- ON_ERROR_STOP as the clone's bootstrap administrator, able to SET ROLE.
-- No external includes, credentials, provider calls, real users or token output.
-- Fixture bootstrap temporarily disables only three named onboarding triggers:
-- invite enforcement / first-admin promotion are unrelated to push registration.
-- Their EXACT prior firing modes are restored and checked BEFORE RPC behavior.
-- No RLS is disabled. Client RPCs use authenticated/anon; legacy service_role
-- compatibility is checked separately. No registration runs as administrator.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, public, extensions;

do $guard$
begin
  if exists (select 1 from auth.users) or exists (select 1 from auth.sessions)
     or exists (select 1 from public.user_push_devices) or exists (select 1 from public.profiles) then
    raise exception 'push_binding_rehearsal_requires_empty_offline_clone';
  end if;
  if not exists (select 1 from pg_roles where rolname='postgres' and not rolsuper and rolbypassrls)
     or exists (select 1 from pg_roles where rolname in ('authenticated','anon') and (rolsuper or rolbypassrls))
     or to_regprocedure('public.register_push_device(text,text,text,text,text,text,text,smallint)') is null then
    raise exception 'push_binding_rehearsal_role_or_migration_missing';
  end if;
end
$guard$;

create temp table push_binding_fixture_triggers on commit drop as
select tgrelid, tgname, tgenabled from pg_trigger
where not tgisinternal and (
  (tgrelid='auth.users'::regclass and tgname='on_auth_user_created')
  or (tgrelid='public.profiles'::regclass and tgname in ('trg_registration_invite_apply_from_profile','trg_bootstrap_first_admin'))
);
do $bootstrap$
declare t record;
begin
  for t in select * from pg_temp.push_binding_fixture_triggers loop
    execute format('alter table %s disable trigger %I', t.tgrelid::regclass, t.tgname);
  end loop;
end
$bootstrap$;
insert into auth.users(id) values
  ('a2a00000-0000-4000-8000-000000000001'), ('a2a00000-0000-4000-8000-000000000002');
insert into public.profiles(id, full_name) values
  ('a2a00000-0000-4000-8000-000000000001','Push fixture A'),
  ('a2a00000-0000-4000-8000-000000000002','Push fixture B');
insert into auth.sessions(id,user_id,not_after) values
  ('b2a00000-0000-4000-8000-000000000001','a2a00000-0000-4000-8000-000000000001',null),
  ('b2a00000-0000-4000-8000-000000000002','a2a00000-0000-4000-8000-000000000002',now()+interval '1 day'),
  ('b2a00000-0000-4000-8000-000000000003','a2a00000-0000-4000-8000-000000000001',now()-interval '1 day');
do $restore_triggers$
declare t record;
begin
  for t in select * from pg_temp.push_binding_fixture_triggers loop
    execute format('alter table %s %s trigger %I', t.tgrelid::regclass,
      case t.tgenabled when 'D' then 'disable' when 'R' then 'enable replica'
        when 'A' then 'enable always' else 'enable' end, t.tgname);
  end loop;
  if exists (select 1 from pg_temp.push_binding_fixture_triggers b
    left join pg_trigger actual on actual.tgrelid=b.tgrelid and actual.tgname=b.tgname
    where actual.tgenabled is distinct from b.tgenabled) then
    raise exception 'push_binding_fixture_trigger_restore_failed';
  end if;
end
$restore_triggers$;

set local role postgres;
do $owner$
declare expected record;
begin
  if current_user <> 'postgres' or (select rolsuper from pg_roles where rolname=current_user) then
    raise exception 'push_binding_rehearsal_wrong_owner_role';
  end if;
  for expected in select * from (values
    ('public.register_push_device(text,text,text,text,text,text,text)',
      array['postgres=X/postgres','service_role=X/postgres','authenticated=X/postgres']::aclitem[]),
    ('public.register_push_device(text,text,text,text,text,text,text,smallint)',
      array['postgres=X/postgres','authenticated=X/postgres']::aclitem[]),
    ('private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)',
      array['postgres=X/postgres']::aclitem[])
  ) as baseline(signature, acl) loop
    if not exists (select 1 from pg_proc where oid=to_regprocedure(expected.signature)
      and proowner='postgres'::regrole and proacl=expected.acl) then
      raise exception 'push_binding_rehearsal_acl_mismatch';
    end if;
  end loop;
end
$owner$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a2a00000-0000-4000-8000-000000000001","session_id":"b2a00000-0000-4000-8000-000000000001","role":"authenticated"}';
do $client$
declare r record; n integer := 0;
begin
  if current_user <> 'authenticated' or exists (select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'push_binding_rehearsal_wrong_client_role';
  end if;
  if pg_typeof(public.register_push_device(p_platform=>'android',p_provider=>'fcm',p_token=>'fictional-fcm-legacy-01'))::text <> 'void' then
    raise exception 'push_binding_legacy_not_void';
  end if;
  perform public.register_push_device(p_token=>'fictional-fcm-legacy-01',p_platform=>'android',p_provider=>'fcm',p_device_id=>' fixture ');
  for r in select * from public.register_push_device('android','fcm',' fictional-fcm-device-01 ',
    'ignored',null,null,null,1::smallint) loop
    n := n+1;
    if r.recipient_id <> 'a2a00000-0000-4000-8000-000000000001'::uuid
       or r.recipient_session_id <> 'b2a00000-0000-4000-8000-000000000001'::uuid then
      raise exception 'push_binding_wrong_verified_pair';
    end if;
  end loop;
  if n <> 1 then raise exception 'push_binding_wrong_pair_cardinality'; end if;
  begin
    perform public.register_push_device('android','fcm','fictional-fcm-device-01',null,null,null,null,2::smallint);
    raise exception 'push_binding_unsupported_protocol_accepted';
  exception when raise_exception then
    if sqlerrm <> 'unsupported_voice_call_protocol' then raise; end if;
  end;
  begin
    perform public.register_push_device('ios','apns','fictional-fcm-device-01',null,null,null,null,1::smallint);
    raise exception 'push_binding_unsupported_provider_accepted';
  exception when raise_exception then
    if sqlerrm <> 'unsupported_push_provider' then raise; end if;
  end;
  begin
    perform 1 from public.user_push_devices;
    raise exception 'push_binding_client_table_exposed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.register_push_device_bound('android','fcm','fictional-fcm-device-01',null,null,null,null,1::smallint,true);
    raise exception 'push_binding_private_exposed';
  exception when insufficient_privilege then null;
  end;
end
$client$;

-- All failed claims must leave an existing bound row unchanged, while legacy
-- clients can still register an ordinary unbound device with the same claims.
do $invalid_sessions$
declare claim text;
begin
  foreach claim in array array[
    'b2a00000-0000-4000-8000-000000000002',
    'b2a00000-0000-4000-8000-000000000003',
    'b2a00000-0000-4000-8000-000000000099', 'malformed', '', null
  ] loop
    perform set_config('request.jwt.claims',jsonb_build_object(
      'sub','a2a00000-0000-4000-8000-000000000001','session_id',claim,'role','authenticated')::text,true);
    begin
      perform public.register_push_device('android','fcm','fictional-fcm-device-01',null,null,null,null,1::smallint);
      raise exception 'push_binding_bad_session_accepted';
    exception when raise_exception then
      if sqlerrm <> 'invalid_push_session' then raise; end if;
    end;
    perform public.register_push_device('android','fcm','fictional-fcm-unbound-01');
  end loop;
end
$invalid_sessions$;

set local role postgres;
do $stored$
begin
  if not exists (select 1 from public.user_push_devices where token_hash=encode(extensions.digest('fictional-fcm-device-01','sha256'),'hex')
    and user_id='a2a00000-0000-4000-8000-000000000001' and session_id='b2a00000-0000-4000-8000-000000000001'
    and voice_call_protocol=1 and enabled and revoked_at is null) then
    raise exception 'push_binding_failed_call_mutated_binding';
  end if;
  if not exists (select 1 from public.user_push_devices where token_hash=encode(extensions.digest('fictional-fcm-unbound-01','sha256'),'hex')
    and session_id is null and voice_call_protocol is null and enabled and revoked_at is null) then
    raise exception 'push_binding_generic_registration_broken';
  end if;
  begin
    update public.user_push_devices set voice_call_protocol=2;
    raise exception 'push_binding_protocol_constraint_missing';
  exception when check_violation then null;
  end;
end
$stored$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a2a00000-0000-4000-8000-000000000002","session_id":"b2a00000-0000-4000-8000-000000000002","role":"authenticated"}';
do $rebind$
declare r record;
begin
  select * into strict r from public.register_push_device('android','fcm','fictional-fcm-device-01','different',null,null,null,1::smallint);
  if r.recipient_id <> 'a2a00000-0000-4000-8000-000000000002'::uuid
     or r.recipient_session_id <> 'b2a00000-0000-4000-8000-000000000002'::uuid then
    raise exception 'push_binding_rebind_pair_wrong';
  end if;
end
$rebind$;
set local request.jwt.claims = '{"sub":"a2a00000-0000-4000-8000-000000000001","session_id":"b2a00000-0000-4000-8000-000000000001","role":"authenticated"}';
do $old_owner$
begin
  perform public.unregister_push_device('fcm','fictional-fcm-device-01');
end
$old_owner$;
set local role postgres;
do $rebound_stored$
begin
  if (select count(*) from public.user_push_devices where token_hash=encode(extensions.digest('fictional-fcm-device-01','sha256'),'hex')
    and user_id='a2a00000-0000-4000-8000-000000000002' and session_id='b2a00000-0000-4000-8000-000000000002'
    and voice_call_protocol=1 and enabled and revoked_at is null) <> 1 then
    raise exception 'push_binding_old_owner_acted_or_dedupe_failed';
  end if;
end
$rebound_stored$;

set local role supabase_auth_admin;
delete from auth.sessions where id='b2a00000-0000-4000-8000-000000000002';
set local role postgres;
do $deleted$
begin
  if not exists (select 1 from public.user_push_devices where user_id='a2a00000-0000-4000-8000-000000000002'
    and session_id is null and enabled and revoked_at is null) then
    raise exception 'push_binding_session_delete_lost_generic_push';
  end if;
end
$deleted$;

set local role service_role;
do $service_boundary$
begin
  if current_user <> 'service_role' or (select rolsuper from pg_roles where rolname=current_user) then
    raise exception 'push_binding_rehearsal_wrong_service_role';
  end if;
  -- Keep the original service_role API authority, but do not inherit it into
  -- either new entry point through public-schema default function grants.
  perform public.register_push_device('android','fcm','fictional-fcm-service-01');
  begin
    perform public.register_push_device('android','fcm','fictional-fcm-service-01',null,null,null,null,1::smallint);
    raise exception 'push_binding_service_new_exposed';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='register_push_device_bound'
      and has_function_privilege(current_user,p.oid,'EXECUTE')) then
    raise exception 'push_binding_service_private_exposed';
  end if;
end
$service_boundary$;

set local role anon;
do $anonymous$
begin
  if current_user <> 'anon' or exists (select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'push_binding_rehearsal_wrong_anon_role';
  end if;
  begin
    perform public.register_push_device('android','fcm','fictional-fcm-device-01');
    raise exception 'push_binding_anon_legacy_exposed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.register_push_device('android','fcm','fictional-fcm-device-01',null,null,null,null,1::smallint);
    raise exception 'push_binding_anon_new_exposed';
  exception when insufficient_privilege then null;
  end;
end
$anonymous$;

rollback;
