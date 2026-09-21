-- Rollback Task 3 before Task 2b/2a. Removes only Task 3 objects and restores
-- the exact column UPDATE grants supplied by Task 2b. No CASCADE or data reset.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';
do $guard$
begin
  if current_user <> 'supabase_admin' then raise exception 'Task 3 rollback requires supabase_admin'; end if;
  if not exists (select 1 from pg_class where oid = 'private.voice_push_dispatch_config'::regclass
      and relowner = 'supabase_admin'::regrole)
     or obj_description('private.voice_push_dispatch_config'::regclass, 'pg_class') is distinct from
       'Task 3 owner-only SQL dispatch gate; disabled on install. No client/service setter.'
     or not exists (select 1 from pg_trigger where tgrelid = 'public.voice_ring_push_devices'::regclass
       and tgname = 'trg_voice_push_wake' and tgfoid = 'private.voice_push_wake()'::regprocedure) then
    raise exception 'Task 3 rollback object/owner drift';
  end if;
end
$guard$;
drop trigger trg_voice_push_wake on public.voice_ring_push_devices;
drop function public.voice_push_prepare(uuid, uuid, uuid);
drop function public.voice_push_claim(integer, uuid);
drop function public.voice_push_complete(uuid, uuid, uuid, text, integer, text);
drop function private.voice_push_wake();
drop function private.voice_push_eligible(uuid, uuid, timestamptz);
drop table private.voice_push_dispatch_config;
grant update (state, terminal_at, updated_at) on public.voice_ring_push_events to service_role;
grant update (state, attempts, next_attempt_at, claim_id, claimed_until, last_attempt_at, updated_at)
  on public.voice_ring_push_devices to service_role;
do $check$
declare v_table regclass; v_columns text[];
begin
  if to_regclass('private.voice_push_dispatch_config') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname = 'public' and p.proname in ('voice_push_claim','voice_push_prepare','voice_push_complete'))
          or (n.nspname = 'private' and p.proname in ('voice_push_eligible','voice_push_wake')))
     or exists (select 1 from pg_trigger where tgrelid = 'public.voice_ring_push_devices'::regclass and tgname = 'trg_voice_push_wake') then
    raise exception 'Task 3 rollback left an owned object';
  end if;
  foreach v_table in array array['public.voice_ring_push_events'::regclass, 'public.voice_ring_push_devices'::regclass] loop
    select array_agg(attname::text order by attname) into v_columns from pg_attribute
      where attrelid = v_table and attnum > 0 and not attisdropped
        and has_column_privilege('service_role', v_table, attnum, 'UPDATE');
    if has_table_privilege('service_role', v_table, 'UPDATE')
       or (v_table = 'public.voice_ring_push_events'::regclass and v_columns is distinct from array['state','terminal_at','updated_at'])
       or (v_table = 'public.voice_ring_push_devices'::regclass and v_columns is distinct from
         array['attempts','claim_id','claimed_until','last_attempt_at','next_attempt_at','state','updated_at']) then
      raise exception 'Task 3 rollback did not restore exact Task 2 operational grants';
    end if;
  end loop;
end
$check$;
commit;
