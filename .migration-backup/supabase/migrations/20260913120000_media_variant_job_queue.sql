/**
 * The media pipeline is told about work instead of hunting for it (D-176).
 *
 * WHAT EXISTS. `mediaVariantsWorker` keeps no queue and no cursor. Every 60
 * seconds, for ever, whether or not anything was uploaded, it scans the newest
 * 1200 image and video messages, the newest 120 profiles with a picture and the
 * newest 120 group or channel pictures, and asks `media_variants` which of them
 * are missing something. The code says so itself: «it has no queue - the
 * candidate set is a fresh scan every minute» (mediaVariantRules.ts:196-198).
 * Measured on production on 2026-09-13: 244 media messages, 10 profile pictures
 * and 3 chat pictures, none of them missing a variant. Every one of those scans
 * found nothing, and will go on finding nothing until somebody uploads.
 *
 * The cost that matters is not the scan. It is the wait: a person who sends a
 * video waits up to a minute before the server even looks at it, and only then
 * starts the poster. Telegram has no counterpart to this - the send itself
 * carries the media, so the server learns of a file at the moment it is
 * referenced.
 *
 * WHAT THIS ADDS. A queue of exactly the shape this database already uses for
 * bot updates and for the registration cleanup, so there is one pattern here
 * rather than two:
 *
 *   - `private.media_variant_jobs`, a row per thing that needs variants, keyed
 *     by what it is and which one. `private`, because PostgREST on this
 *     deployment exposes `public`, `storage` and `graphql_public` only, and a
 *     queue is nobody's business but the worker's.
 *   - three triggers that fill it: a message that arrives with media, a profile
 *     picture that changes, a group or channel picture that changes.
 *   - `public.media_variant_jobs_claim`, `_finish` and `_retry`, SECURITY
 *     DEFINER and executable by `service_role` alone, which is how
 *     `registration_cleanup_claim` reaches its own private table.
 *
 * The claim takes `for update skip locked` and a claim token, and a claim older
 * than fifteen minutes is taken again - a worker that dies mid-job must not
 * strand the work. `attempts` is bounded: after five failures the job is
 * dropped, because the failure is already recorded in `media_variants` with its
 * error code and retrying for ever would be a loop with no exit.
 *
 * WHAT THIS DOES NOT CHANGE. The worker keeps its scan as a rare safety net
 * rather than as its heartbeat: rows that existed before this migration, and
 * anything a trigger ever misses, still get picked up. A queue that is the only
 * path is a queue whose one bad day loses the work silently.
 *
 * BACKFILL. Every media message not yet carrying a ready variant of each kind
 * it expects, and every picture likewise, is enqueued once here. On production
 * today that is nothing at all, which is the correct outcome and is why the
 * self-check does not require it to be non-empty.
 *
 * OWNER. Apply as the owner of `public.messages`, `public.profiles` and
 * `public.chats` (postgres on this deployment).
 *
 * Lock: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on each of the three tables for
 * the length of this transaction; `lock_timeout` gives up after five seconds
 * rather than queue behind a long one.
 *
 * Rollback: 20260913120000_media_variant_job_queue.rollback.sql.
 */

begin;

set local lock_timeout = '5s';

-- ── the queue ───────────────────────────────────────────────────────────────

create table if not exists private.media_variant_jobs (
  scope text not null check (scope in ('message','profile','chat')),
  target_id uuid not null,
  enqueued_at timestamptz not null default pg_catalog.now(),
  available_at timestamptz not null default pg_catalog.now(),
  attempts integer not null default 0 check (attempts between 0 and 20),
  claim_token uuid null,
  claimed_at timestamptz null,
  last_error text null
    check (last_error is null or last_error ~ '^[a-z][a-z0-9_]{0,63}$'),
  primary key (scope, target_id)
);

create index if not exists media_variant_jobs_due_idx
  on private.media_variant_jobs(available_at, enqueued_at)
  where claimed_at is null;

comment on table private.media_variant_jobs is
  'What the media variants worker has been told to look at (D-176). Filled by triggers, drained by the worker through media_variant_jobs_claim.';

-- ── the triggers that fill it ───────────────────────────────────────────────

create or replace function private.enqueue_media_variant_job_for_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(new.type::text, '') in ('image','video')
     and new.deleted_at is null
     and (new.media_path is not null or new.media_url is not null)
  then
    insert into private.media_variant_jobs (scope, target_id)
    values ('message', new.id)
    on conflict (scope, target_id) do nothing;
  end if;
  return null;
end;
$function$;

revoke all on function private.enqueue_media_variant_job_for_message()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enqueue_media_variant_job_on_insert on public.messages;
create trigger trg_enqueue_media_variant_job_on_insert
  after insert on public.messages
  for each row execute function private.enqueue_media_variant_job_for_message();

drop trigger if exists trg_enqueue_media_variant_job_on_update on public.messages;
create trigger trg_enqueue_media_variant_job_on_update
  after update of media_bucket, media_path, media_url on public.messages
  for each row execute function private.enqueue_media_variant_job_for_message();

create or replace function private.enqueue_media_variant_job_for_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.avatar_url is not null
     and (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url)
  then
    insert into private.media_variant_jobs (scope, target_id)
    values ('profile', new.id)
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

revoke all on function private.enqueue_media_variant_job_for_profile()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enqueue_media_variant_job_for_profile on public.profiles;
create trigger trg_enqueue_media_variant_job_for_profile
  after insert or update of avatar_url on public.profiles
  for each row execute function private.enqueue_media_variant_job_for_profile();

/**
 * A private chat is skipped for the same reason the worker skips it: the client
 * shows the other person's own picture there, which has variants of its own, so
 * a variant of the chat row's picture would be made and never asked for.
 */
create or replace function private.enqueue_media_variant_job_for_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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

revoke all on function private.enqueue_media_variant_job_for_chat()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enqueue_media_variant_job_for_chat on public.chats;
create trigger trg_enqueue_media_variant_job_for_chat
  after insert or update of avatar_url on public.chats
  for each row execute function private.enqueue_media_variant_job_for_chat();

-- ── what the worker calls ───────────────────────────────────────────────────

/**
 * Take up to `p_limit` jobs that are due, marking them with a token.
 *
 * `skip locked` so two workers never take the same row, and a claim older than
 * fifteen minutes is taken again: a worker killed mid-transcode must not strand
 * the job for ever. Fifteen minutes is above the ten-minute ffmpeg timeout the
 * worker gives itself, so a job still being worked on is never stolen.
 */
create or replace function public.media_variant_jobs_claim(
  p_limit integer,
  p_claim_token uuid,
  p_now timestamptz
)
returns table(scope text, target_id uuid, attempts integer)
language sql
security definer
set search_path = pg_catalog, public, private
as $function$
  with due as (
    select job.scope, job.target_id
      from private.media_variant_jobs job
     where p_limit between 1 and 100
       and p_claim_token is not null
       and p_now is not null
       and job.available_at <= p_now
       and (job.claimed_at is null or job.claimed_at < p_now - interval '15 minutes')
     order by job.available_at, job.enqueued_at
     limit p_limit
       for update of job skip locked
  ), claimed as (
    update private.media_variant_jobs job
       set claim_token = p_claim_token,
           claimed_at = p_now
      from due
     where job.scope = due.scope
       and job.target_id = due.target_id
    returning job.scope, job.target_id, job.attempts
  )
  select claimed.scope, claimed.target_id, claimed.attempts
    from claimed;
$function$;

revoke all on function public.media_variant_jobs_claim(integer, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.media_variant_jobs_claim(integer, uuid, timestamptz)
  to service_role;

/** The work is done, or the target is gone: the job leaves the queue. */
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

revoke all on function public.media_variant_job_finish(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.media_variant_job_finish(text, uuid)
  to service_role;

/**
 * The work failed: try again later, a few times, then stop.
 *
 * The backoff is a minute per attempt, and after five the job is dropped -- the
 * failure is already recorded in `media_variants` with its error code, and a
 * queue that retries for ever is a loop with no exit. `p_error` is bounded to
 * the same shape the variant rows use, so nothing free-form is ever stored.
 */
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

revoke all on function public.media_variant_job_retry(text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.media_variant_job_retry(text, uuid, text, timestamptz)
  to service_role;

-- ── backfill: what already exists and is not finished ───────────────────────

insert into private.media_variant_jobs (scope, target_id)
select 'message', message.id
  from public.messages as message
 where message.deleted_at is null
   and coalesce(message.type::text, '') in ('image','video')
   and (message.media_path is not null or message.media_url is not null)
   and (
     select pg_catalog.count(*)
       from public.media_variants as variant
      where variant.message_id = message.id
        and variant.status = 'ready'
   ) < 2
on conflict (scope, target_id) do nothing;

insert into private.media_variant_jobs (scope, target_id)
select 'profile', profile.id
  from public.profiles as profile
 where profile.avatar_url is not null
   and (
     select pg_catalog.count(*)
       from public.media_variants as variant
      where variant.profile_id = profile.id
        and variant.status = 'ready'
   ) < 2
on conflict (scope, target_id) do nothing;

insert into private.media_variant_jobs (scope, target_id)
select 'chat', chat.id
  from public.chats as chat
 where chat.avatar_url is not null
   and coalesce(chat.type::text, '') in ('group','channel')
   and (
     select pg_catalog.count(*)
       from public.media_variants as variant
      where variant.chat_id = chat.id
        and variant.status = 'ready'
   ) < 2
on conflict (scope, target_id) do nothing;

-- ── the self-check, which raises rather than committing half of this ────────

do $check$
declare
  v_missing text := '';
begin
  if pg_catalog.to_regclass('private.media_variant_jobs') is null then
    v_missing := v_missing || ' table';
  end if;

  if (
    select pg_catalog.count(*)
      from pg_catalog.pg_trigger
     where tgrelid in ('public.messages'::regclass, 'public.profiles'::regclass, 'public.chats'::regclass)
       and not tgisinternal
       and tgname like 'trg_enqueue_media_variant_job%'
  ) <> 4 then
    v_missing := v_missing || ' triggers';
  end if;

  if (
    select pg_catalog.count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('media_variant_jobs_claim','media_variant_job_finish','media_variant_job_retry')
  ) <> 3 then
    v_missing := v_missing || ' functions';
  end if;

  if not pg_catalog.has_function_privilege('service_role', 'public.media_variant_jobs_claim(integer,uuid,timestamptz)', 'execute') then
    v_missing := v_missing || ' claim_grant';
  end if;

  if pg_catalog.has_function_privilege('authenticated', 'public.media_variant_jobs_claim(integer,uuid,timestamptz)', 'execute') then
    v_missing := v_missing || ' claim_leaked_to_authenticated';
  end if;

  if v_missing <> '' then
    raise exception 'media variant job queue is half applied:%', v_missing;
  end if;
end
$check$;

commit;
