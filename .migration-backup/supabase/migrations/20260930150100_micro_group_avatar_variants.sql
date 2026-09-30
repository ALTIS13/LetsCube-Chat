/**
 * A micro-group's picture gets its small versions, as a group's does
 * (tracker item 45, 2026-09-30). One line of
 * `private.enqueue_media_variant_job_for_chat`, which belongs to
 * `supabase_admin` — so this is applied as `supabase_admin`, apart from
 * `20260930150000_micro_groups.sql`, the way the 2026-09-05 repair was.
 *
 * Rollback: 20260930150100_micro_group_avatar_variants.rollback.sql.
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
     and coalesce(new.type::text, '') in ('group','channel','dm_group')
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
  if pg_catalog.pg_get_functiondef('private.enqueue_media_variant_job_for_chat()'::regprocedure) not like '%dm_group%' then
    raise exception 'micro_group_avatar_variants_incomplete';
  end if;
end;
$$;

commit;
