-- Rollback for `20260919130000_media_path_backfill_for_legacy_messages.sql`.
--
-- Restores each touched row to exactly what it held before, from the record the
-- forward migration wrote. It restores nothing it did not itself fill: the
-- table is keyed by message and carries the previous values, so a row somebody
-- else changed in between is left alone rather than reverted to a stale value.
--
-- Apply as `postgres`, the owner of `public.messages` and of the `private`
-- schema, and with no JWT -- `private.message_media_path_allowed` admits a null
-- actor, and this write sets `media_path` back to NULL, which the guard returns
-- on immediately anyway.
--
-- What the triggers do on the way back, for the ten rows of 2026-09-19:
-- `trg_enqueue_media_variant_job_on_update` enqueues the same six no-op jobs
-- again (the six image/video rows still have every kind recorded `ready`, so
-- each settles without work); `trg_enqueue_bot_message_updates_after_update`
-- again finds no active bot member in any of the four chats; and
-- `trg_guard_message_media_path` returns on its first line, because the new
-- `media_path` is null.
--
-- The six queue rows are deliberately left behind. An earlier draft of this
-- file deleted them, and the rehearsal refused it: `private.media_variant_jobs`
-- belongs to `supabase_admin` and `postgres` holds SELECT on it and nothing
-- else, so the tidy-up would have made the rollback need a superuser in order
-- to remove six rows that settle themselves. The trigger reaches the table
-- through a SECURITY DEFINER function, which is why the insert succeeds where a
-- direct delete does not. They are no-ops: the worker claims each one, finds
-- every expected kind already `ready`, and deletes it.
--
-- Idempotent: the record table is recreated if it is already gone, so a second
-- run restores nothing, reports zero and exits clean rather than failing on a
-- missing relation.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';
set local idle_in_transaction_session_timeout = '5min';

create table if not exists private.d208_media_path_backfill (
  message_id uuid primary key,
  previous_bucket text,
  previous_path text,
  filled_bucket text not null,
  filled_path text not null,
  filled_at timestamptz not null default now()
);

create temp table d208_rollback_before on commit drop as
select
  (select count(*) from private.d208_media_path_backfill) as recorded,
  (select count(*) from public.messages) as total_rows,
  (select md5(coalesce(string_agg(
      concat_ws(chr(31), m.id::text, coalesce(m.media_url, ''), coalesce(m.edited_at::text, ''),
                coalesce(m.deleted_at::text, ''), coalesce(m.content, ''),
                coalesce(m.media_metadata::text, ''), coalesce(m.type::text, '')),
      chr(30) order by m.id), ''))
   from public.messages m) as untouched_digest,
  (select md5(coalesce(string_agg(
      concat_ws(chr(31), m.id::text, coalesce(m.media_bucket, ''), coalesce(m.media_path, '')),
      chr(30) order by m.id), ''))
   from public.messages m
   where not exists (select 1 from private.d208_media_path_backfill b where b.message_id = m.id)
  ) as other_rows_path_digest;

update public.messages m
set media_bucket = b.previous_bucket,
    media_path = b.previous_path
from private.d208_media_path_backfill b
where m.id = b.message_id
  and m.media_bucket is not distinct from b.filled_bucket
  and m.media_path is not distinct from b.filled_path;

do $check$
declare
  v_stuck integer;
  v_restored integer;
  v_foreign integer;
  v_now_total integer;
  v_untouched text;
  v_other_paths text;
  b pg_temp.d208_rollback_before%rowtype;
begin
  select * into b from pg_temp.d208_rollback_before;

  -- 1. No recorded row may still carry the value this rollback exists to undo.
  select count(*) into v_stuck
  from public.messages m
  join private.d208_media_path_backfill b2 on b2.message_id = m.id
  where m.media_path is not distinct from b2.filled_path
    and b2.previous_path is distinct from b2.filled_path;
  if v_stuck > 0 then
    raise exception '% rows still carry the back-filled path', v_stuck;
  end if;

  -- 2. How many actually went back, and how many were left alone because
  --    somebody else had changed them since. The second number is reported, not
  --    raised on: reverting a value this migration never wrote would be worse.
  select count(*) into v_restored
  from public.messages m
  join private.d208_media_path_backfill b2 on b2.message_id = m.id
  where m.media_bucket is not distinct from b2.previous_bucket
    and m.media_path is not distinct from b2.previous_path;
  v_foreign := b.recorded - v_restored;

  -- 3. Nothing outside the record moved, in this direction either.
  select count(*) into v_now_total from public.messages;
  if v_now_total <> b.total_rows then
    raise exception 'row count moved during the rollback: % to %', b.total_rows, v_now_total;
  end if;

  select md5(coalesce(string_agg(
      concat_ws(chr(31), m.id::text, coalesce(m.media_url, ''), coalesce(m.edited_at::text, ''),
                coalesce(m.deleted_at::text, ''), coalesce(m.content, ''),
                coalesce(m.media_metadata::text, ''), coalesce(m.type::text, '')),
      chr(30) order by m.id), '')) into v_untouched
  from public.messages m;
  if v_untouched is distinct from b.untouched_digest then
    raise exception 'the rollback changed a column it does not write';
  end if;

  select md5(coalesce(string_agg(
      concat_ws(chr(31), m.id::text, coalesce(m.media_bucket, ''), coalesce(m.media_path, '')),
      chr(30) order by m.id), '')) into v_other_paths
  from public.messages m
  where not exists (select 1 from private.d208_media_path_backfill b2 where b2.message_id = m.id);
  if v_other_paths is distinct from b.other_rows_path_digest then
    raise exception 'the rollback changed a row outside the back-fill';
  end if;

  raise notice 'D-208 rollback: % of % recorded rows restored, % left alone because they had changed since',
    v_restored, b.recorded, v_foreign;
end
$check$;

drop table if exists private.d208_media_path_backfill;

commit;
