-- Rollback D-339 ONLY, as the existing RPC owner after coordinated worker
-- rollback/readiness and verified before-backup. This restores the exact
-- archived 20260913120000 prior bodies and service-only ACL/config/owners;
-- it deliberately restores the prior stale-mutation vulnerability.
-- Old workers held by compatibility false can wait up to 15 minutes for
-- reclaim. Do not promise immediate recovery or external-I/O terminality.
-- No queue rows, RLS, Storage, publication or cleanup/refund changes.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $prestate$
begin
  if (select pg_catalog.count(*) from pg_catalog.pg_proc where oid in (
      pg_catalog.to_regprocedure('public.media_variant_job_finish(text,uuid)'),
      pg_catalog.to_regprocedure('public.media_variant_job_retry(text,uuid,text,timestamptz)'),
      pg_catalog.to_regprocedure('public.media_variant_job_finish(text,uuid,uuid)'),
      pg_catalog.to_regprocedure('public.media_variant_job_retry(text,uuid,text,timestamptz,uuid)'))
      and proowner=current_user::regrole) <> 4
  then
    raise exception 'media_variant_claim_token_rollback_prestate_invalid';
  end if;
end;
$prestate$;

drop function public.media_variant_job_finish(text,uuid,uuid);
drop function public.media_variant_job_retry(text,uuid,text,timestamptz,uuid);

create or replace function public.media_variant_job_finish(
  p_scope text,
  p_target_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_deleted integer;
begin
  if p_scope is null or p_target_id is null then
    return false;
  end if;
  delete from private.media_variant_jobs
   where scope = p_scope
     and target_id = p_target_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
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
declare
  v_attempts integer;
begin
  if p_scope is null or p_target_id is null or p_now is null then
    return false;
  end if;

  update private.media_variant_jobs
     set attempts = attempts + 1,
         claim_token = null,
         claimed_at = null,
         last_error = case
           when p_error ~ '^[a-z][a-z0-9_]{0,63}$' then p_error
           else 'variant_generation_failed'
         end,
         available_at = p_now + (interval '1 minute' * (attempts + 1))
   where scope = p_scope
     and target_id = p_target_id
  returning attempts into v_attempts;

  if v_attempts is null then
    return false;
  end if;

  if v_attempts >= 5 then
    delete from private.media_variant_jobs
     where scope = p_scope
       and target_id = p_target_id;
    return false;
  end if;

  return true;
end;
$function$;

revoke all on function public.media_variant_job_finish(text,uuid),
  public.media_variant_job_retry(text,uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.media_variant_job_finish(text,uuid),
  public.media_variant_job_retry(text,uuid,text,timestamptz)
  to service_role;

do $check$
declare
  v_signature text;
  v_function record;
begin
  if pg_catalog.to_regprocedure('public.media_variant_job_finish(text,uuid,uuid)') is not null
     or pg_catalog.to_regprocedure('public.media_variant_job_retry(text,uuid,text,timestamptz,uuid)') is not null
     or (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc
       where oid='public.media_variant_job_finish(text,uuid)'::regprocedure)
       is distinct from 'f46c02040630f511bc2ffda489fec47a'
     or (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc
       where oid='public.media_variant_job_retry(text,uuid,text,timestamptz)'::regprocedure)
       is distinct from '80dcc65117332e1efd7963b3a904e392'
  then
    raise exception 'media_variant_claim_token_rollback_body_invalid';
  end if;
  foreach v_signature in array array['public.media_variant_job_finish(text,uuid)',
    'public.media_variant_job_retry(text,uuid,text,timestamptz)'] loop
    select * into v_function from pg_catalog.pg_proc where oid=v_signature::regprocedure;
    if not v_function.prosecdef or v_function.proowner <> current_user::regrole
       or v_function.prorettype <> 'boolean'::regtype or v_function.provolatile <> 'v'
       or v_function.proconfig is distinct from array['search_path=pg_catalog, public, private']
       or not pg_catalog.has_function_privilege('service_role',v_function.oid,'execute')
       or pg_catalog.has_function_privilege('anon',v_function.oid,'execute')
       or pg_catalog.has_function_privilege('authenticated',v_function.oid,'execute')
       or exists (select 1 from pg_catalog.aclexplode(v_function.proacl) a
         where a.privilege_type='EXECUTE' and a.grantee not in (v_function.proowner,'service_role'::regrole))
    then
      raise exception 'media_variant_claim_token_rollback_catalog_invalid: %',v_signature;
    end if;
  end loop;
end;
$check$;
commit;
