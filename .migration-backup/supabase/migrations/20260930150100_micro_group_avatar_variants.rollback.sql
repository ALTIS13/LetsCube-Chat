/**
 * Rollback of 20260930150100_micro_group_avatar_variants.sql: the trigger
 * function as read off production before it (2026-09-30). Apply as
 * `supabase_admin`.
 */
begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION private.enqueue_media_variant_job_for_chat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.avatar_url is not null
     and coalesce(new.type::text, '') in ('group','channel')
     and (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url)
  then
    insert into private.media_variant_jobs (scope, target_id)
    values ('chat', new.id)
    on conflict (scope, target_id) do update
      set available_at = pg_catalog.now(),
          attempts = 0,
          claim_token = null,
          claimed_at = null,
          last_error = null;
  end if;
  return null;
end;
$function$;

do $$
begin
  if pg_catalog.pg_get_functiondef('private.enqueue_media_variant_job_for_chat()'::regprocedure) like '%dm_group%' then
    raise exception 'micro_group_avatar_variants survived the rollback';
  end if;
end;
$$;

commit;
