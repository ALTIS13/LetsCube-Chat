-- D-339: only the exact current queue claim may finish or retry.
-- Apply ONCE as the existing RPC owner after verified before-backup, full PG17
-- restore/PostgREST rehearsal and token-propagating worker readiness.
-- Rollback: 20261003183925_media_variant_claim_token.rollback.sql, as the same
-- owner. Coordinate worker rollback first; restoring old RPCs reopens D-339.
-- Rolling deploy: old signatures return false WITHOUT mutation. Old workers
-- may leave claims pending until the existing 15-minute reclaim threshold.
-- No queue rows, triggers, claim RPC, RLS, Storage or publication changes.
-- A claim token is retry ownership, not source epoch, durable I/O intent,
-- physical generation, cleanup authority or quota-release permission.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $prestate$
declare
  v_finish oid := pg_catalog.to_regprocedure('public.media_variant_job_finish(text,uuid)');
  v_retry oid := pg_catalog.to_regprocedure('public.media_variant_job_retry(text,uuid,text,timestamptz)');
begin
  if pg_catalog.to_regclass('private.media_variant_jobs') is null
     or v_finish is null or v_retry is null
     or pg_catalog.to_regprocedure('public.media_variant_job_finish(text,uuid,uuid)') is not null
     or pg_catalog.to_regprocedure('public.media_variant_job_retry(text,uuid,text,timestamptz,uuid)') is not null
     or (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=v_finish)
          is distinct from 'f46c02040630f511bc2ffda489fec47a'
     or (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=v_retry)
          is distinct from '80dcc65117332e1efd7963b3a904e392'
     or exists (select 1 from pg_catalog.pg_proc where oid in (v_finish,v_retry)
       and (proowner <> current_user::regrole or not prosecdef
         or proconfig is distinct from array['search_path=pg_catalog, public, private']))
  then
    raise exception 'media_variant_claim_token_prestate_invalid';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where p.oid in (v_finish,v_retry) and a.privilege_type='EXECUTE'
      and a.grantee not in (p.proowner,'service_role'::regrole)
  ) or not pg_catalog.has_function_privilege('service_role',v_finish,'execute')
    or not pg_catalog.has_function_privilege('service_role',v_retry,'execute')
  then
    raise exception 'media_variant_claim_token_prestate_acl_invalid';
  end if;
end;
$prestate$;

create or replace function public.media_variant_job_finish(
  p_scope text,
  p_target_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_deleted integer;
begin
  if p_scope is null or p_target_id is null or p_claim_token is null then
    return false;
  end if;
  perform 1 from private.media_variant_jobs job
    where job.scope = p_scope and job.target_id = p_target_id
      and job.claim_token = p_claim_token
    for update;
  if not found then return false; end if;

  delete from private.media_variant_jobs job
    where job.scope = p_scope and job.target_id = p_target_id
      and job.claim_token = p_claim_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$function$;

create or replace function public.media_variant_job_retry(
  p_scope text,
  p_target_id uuid,
  p_error text,
  p_now timestamptz,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_attempts integer;
begin
  if p_scope is null or p_target_id is null or p_now is null or p_claim_token is null then
    return false;
  end if;
  perform 1 from private.media_variant_jobs job
    where job.scope = p_scope and job.target_id = p_target_id
      and job.claim_token = p_claim_token
    for update;
  if not found then return false; end if;

  update private.media_variant_jobs job
     set attempts = job.attempts + 1,
         claim_token = null,
         claimed_at = null,
         last_error = case
           when p_error ~ '^[a-z][a-z0-9_]{0,63}$' then p_error
           else 'variant_generation_failed'
         end,
         available_at = p_now + (interval '1 minute' * (job.attempts + 1))
    where job.scope = p_scope and job.target_id = p_target_id
      and job.claim_token = p_claim_token
  returning job.attempts into v_attempts;
  if v_attempts is null then return false; end if;

  if v_attempts >= 5 then
    -- The exact row remains locked after clearing its token; re-enqueue/claim
    -- cannot replace it inside this transaction before exhaustion removal.
    delete from private.media_variant_jobs
      where scope = p_scope and target_id = p_target_id;
    return false;
  end if;
  return true;
end;
$function$;

-- Keep argument names/signatures for rolling callers, but no token means no
-- authority. These wrappers must never forward to an unguarded mutation.
create or replace function public.media_variant_job_finish(
  p_scope text,
  p_target_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  return false;
end;
$function$;

create or replace function public.media_variant_job_retry(
  p_scope text,
  p_target_id uuid,
  p_error text,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  return false;
end;
$function$;

revoke all on function public.media_variant_job_finish(text,uuid),
  public.media_variant_job_retry(text,uuid,text,timestamptz),
  public.media_variant_job_finish(text,uuid,uuid),
  public.media_variant_job_retry(text,uuid,text,timestamptz,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.media_variant_job_finish(text,uuid),
  public.media_variant_job_retry(text,uuid,text,timestamptz),
  public.media_variant_job_finish(text,uuid,uuid),
  public.media_variant_job_retry(text,uuid,text,timestamptz,uuid)
  to service_role;

do $check$
declare
  v_signature text;
  v_function record;
begin
  foreach v_signature in array array[
    'public.media_variant_job_finish(text,uuid)',
    'public.media_variant_job_retry(text,uuid,text,timestamptz)',
    'public.media_variant_job_finish(text,uuid,uuid)',
    'public.media_variant_job_retry(text,uuid,text,timestamptz,uuid)'
  ] loop
    select * into v_function from pg_catalog.pg_proc
      where oid=pg_catalog.to_regprocedure(v_signature);
    if not found or not v_function.prosecdef
       or v_function.proowner <> current_user::regrole
       or v_function.prorettype <> 'boolean'::regtype
       or v_function.provolatile <> 'v'
       or v_function.proconfig is distinct from array['search_path=pg_catalog, public, private']
       or not pg_catalog.has_function_privilege('service_role',v_function.oid,'execute')
       or pg_catalog.has_function_privilege('anon',v_function.oid,'execute')
       or pg_catalog.has_function_privilege('authenticated',v_function.oid,'execute')
       or exists (select 1 from pg_catalog.aclexplode(v_function.proacl) a
         where a.privilege_type='EXECUTE' and a.grantee not in (v_function.proowner,'service_role'::regrole))
    then
      raise exception 'media_variant_claim_token_catalog_invalid: %',v_signature;
    end if;
  end loop;
  if exists (select 1 from pg_catalog.pg_proc where oid in (
      'public.media_variant_job_finish(text,uuid)'::regprocedure,
      'public.media_variant_job_retry(text,uuid,text,timestamptz)'::regprocedure)
      and pg_catalog.btrim(prosrc,E' \t\r\n') <> E'begin\n  return false;\nend;')
     or public.media_variant_job_finish(null::text,null::uuid,null::uuid) is distinct from false
     or public.media_variant_job_retry(null::text,null::uuid,null::text,null::timestamptz,null::uuid) is distinct from false
  then
    raise exception 'media_variant_claim_token_behavior_invalid';
  end if;
end;
$check$;
commit;
