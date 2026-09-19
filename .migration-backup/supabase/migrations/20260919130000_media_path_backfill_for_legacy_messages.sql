-- D-208 step three: the rows that carry only a URL.
--
-- Written 2026-09-19 from read-only measurements and revised the same day after
-- a second measuring pass that read the live triggers, constraints and
-- ownership rather than only the data.
--
-- ## It is a prerequisite, not a tidy-up
--
-- The read predicate applied earlier today, `_kub_media_read_allowed`
-- (`20260919120000`), reaches a message's own upload through exactly this pair:
--
--     where m.media_bucket = 'media' and m.media_path = p_name
--       and m.deleted_at is null
--
-- Both halves. Ten live messages carry a `media_url` and neither column, so for
-- those ten the only branch that admits anybody is `v_first = v_uid::text` --
-- the uploader. Every other member of the chat loses the picture the moment the
-- bucket stops being public, which is step four. Parsing the URL client-side
-- recovers the address and not the right to sign it, so `messageMediaObjectRef`
-- does not cover this.
--
-- ## The counts, re-measured on 2026-09-19 rather than carried forward
--
--     media messages (media_url not null)          314
--       of which both columns                      294
--       of which media_url only                     20
--     objects in the `media` bucket                778
--     avatar URLs  10 profiles + 7 chats + 0 bots   17
--
-- The twenty by shape:
--
--     live | object still in storage | rows
--     -----+-------------------------+-----
--     f    | f                       |  10
--     t    | t                       |  10
--
-- Exactly ten are on messages that are not deleted, and those ten are exactly
-- the ten whose object still exists. The other ten name files removed with
-- their messages, and writing a path to a deleted object would replace an
-- honestly dead URL with a dangling reference. So this back-fill is ten rows.
--
-- The ten split 5 image, 1 video, 4 file across 4 chats; all ten carry
-- `media_bucket` NULL as well as a null path; nine are forwards; all ten derive
-- a `{uuid}/{file}` path whose first segment is a real profile; none contains a
-- query string, a percent sign or an underscore.
--
-- ## Why inverting the URL is safe here
--
-- In all 294 rows carrying both columns, `media_url` is **exactly**
-- `<base>/storage/v1/object/public/media/` + `media_path` -- string equality,
-- not a pattern match, measured today: 294 of 294. Two distinct bases exist
-- among the 314; the ten live legacy rows are all on the current one, and the
-- other base accounts for precisely the ten deleted ones.
--
-- A third, independent witness: the variant pipeline already derived these same
-- paths from the same URLs. All 12 `media_variants` rows belonging to the six
-- image/video candidates carry `source_bucket = 'media'` and a `source_path`
-- equal to the path this migration derives.
--
-- The derivation below is `substring(... from strpos(...) + length(...))` --
-- everything after the **first** marker -- so `base || marker || derived` is the
-- original string by construction. There is nothing left to assert about
-- exactness; what is left is whether the object is really there, which is the
-- `d208_qualified` filter.
--
-- ## What the triggers on `public.messages` will do to these ten rows
--
-- Eleven triggers exist; the SET list here is `media_bucket, media_path`, and
-- `UPDATE OF` narrows the rest away. Three fire:
--
--   - `trg_guard_message_media_path` (BEFORE UPDATE OF media_bucket,
--     media_path, user_id, bot_id, forwarded_from_id) calls
--     `private.message_media_path_allowed(auth.uid(), ...)`, whose second
--     branch is `when p_actor is null then true -- service role: not the
--     subject`. A psql session carries no `request.jwt.claims`, so `auth.uid()`
--     is NULL and the guard admits. It **must** be applied that way: nine of
--     the ten are forwards whose path begins with the *original* uploader's id,
--     so only 2 of 10 would satisfy `split_part(media_path,'/',1) = author`,
--     and `v_forward_matches` rescues only 7 of the 9 because two of the source
--     rows are themselves legacy with a null path. Impersonating the author
--     would fail on at least three rows. Do not apply this under a JWT.
--
--   - `trg_enqueue_media_variant_job_on_update` (AFTER UPDATE OF media_bucket,
--     media_path, media_url) inserts one `private.media_variant_jobs` row per
--     touched message of type image or video: **6 rows** (5 image, 1 video).
--     The four `file` rows enqueue nothing. The queue holds 0 rows today, so
--     these six are the whole of it. They are no-ops: every expected kind for
--     all six is already recorded `ready` in `media_variants`, so
--     `loadMessageJobTarget` returns null, `runVariantJob` settles the job
--     without downloading anything and `finishVariantJob` deletes the row. No
--     re-encode, no new object, no storage write. Predicted, not discovered.
--
--   - `trg_enqueue_bot_message_updates_after_update` (AFTER UPDATE OF content,
--     media_bucket, media_path, media_metadata, topic_id, reply_to_id,
--     bot_reply_markup) does **not** take its early return: that return needs
--     the watched values to be unchanged, and media_path changes. It proceeds,
--     and then finds nothing: its loop is over `chat_bot_members` with
--     `removed_at is null` in the message's chat, and **0** of the four chats
--     has one (production has 2 active bot memberships, none in these chats).
--     So: 0 bot updates enqueued.
--
-- The eight that do not fire, and why it matters: `trg_guard_message_client_times`
-- and `trg_messages_sender_on_update` are `UPDATE OF` other columns, so these
-- rows are **not** marked edited -- `edited_at` is not touched by this
-- migration and the self-check proves it.
--
-- `messages_media_metadata_shape` is a CHECK marked NOT VALID, and a NOT VALID
-- check is still enforced on UPDATE. It ties `media_metadata #>> '{preview,path}'`
-- to `media_path` once `media_path` is not null, so it is the one constraint
-- that could have refused this write. Measured: all ten carry
-- `media_metadata = '{}'` -- zero keys, no `preview` -- so the clause is vacuous
-- for them, and 0 rows in the whole table would violate the check if it were
-- validated today.
--
-- `idx_messages_media_path` is a non-unique partial index on
-- `(media_bucket, media_path)`, so the nine rows whose derived path is already
-- carried by another row (forwards sharing the source's object) collide with
-- nothing. The ten rows name only six distinct objects.
--
-- `public.messages` is in the `supabase_realtime` publication, so each touched
-- row broadcasts an UPDATE to clients subscribed to those four chats. Nothing
-- on screen moves: `media_url` is unchanged and the shipped client reads the
-- URL.
--
-- ## Owner
--
-- Apply as **`postgres`**, which owns `public.messages` and the `private`
-- schema, holds BYPASSRLS, and is what `20260913120000_media_variant_job_queue`
-- says to use for this table. This is *not* the sibling case: that one had to
-- be `supabase_admin` because `storage.objects` belongs to
-- `supabase_storage_admin` and `pg_has_role('postgres','supabase_storage_admin',
-- 'MEMBER')` is false. Nothing here writes `storage.objects`; it is read only,
-- and `postgres` reads it under BYPASSRLS.
--
-- ## Residue
--
-- `private.d208_media_path_backfill` stays behind on purpose: it is what makes
-- the rollback exact rather than a re-derivation. The rollback drops it.
--
-- Rollback: `20260919130000_media_path_backfill_for_legacy_messages.rollback.sql`.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';
set local idle_in_transaction_session_timeout = '5min';

-- Recorded before, so the rollback has something exact to restore and the
-- self-check has something to compare against.
create table if not exists private.d208_media_path_backfill (
  message_id uuid primary key,
  previous_bucket text,
  previous_path text,
  filled_bucket text not null,
  filled_path text not null,
  filled_at timestamptz not null default now()
);

-- One definition of "a live legacy row", used by the insert and by every check
-- below, so the migration and its own assertions cannot drift apart.
create temp table d208_candidate on commit drop as
select
  m.id as message_id,
  m.media_bucket as previous_bucket,
  m.media_path as previous_path,
  substring(m.media_url from strpos(m.media_url, '/storage/v1/object/public/media/')
            + length('/storage/v1/object/public/media/')) as derived_path
from public.messages m
where (m.media_path is null or m.media_path = '')
  and strpos(m.media_url, '/storage/v1/object/public/media/') > 0
  and m.deleted_at is null;

-- Only where the object is really there. A path pointing at nothing is worse
-- than the URL it replaces, because the URL is visibly dead and a path is not.
-- A path carrying a query string or a percent escape is one the inversion did
-- not recover cleanly; measured as zero today, and skipped rather than mangled
-- if one ever appears.
create temp table d208_qualified on commit drop as
select c.*
from d208_candidate c
where c.derived_path <> ''
  and strpos(c.derived_path, '?') = 0
  and strpos(c.derived_path, '%') = 0
  and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'media' and o.name = c.derived_path
  );

insert into private.d208_media_path_backfill
  (message_id, previous_bucket, previous_path, filled_bucket, filled_path)
select message_id, previous_bucket, previous_path, 'media', derived_path
from d208_qualified
on conflict (message_id) do nothing;

-- Everything the update must leave exactly as it found it, fingerprinted before
-- the write. The first digest covers every row in the table and every column
-- this migration does not name; the second covers the two columns it does name,
-- over every row it is not about to touch.
create temp table d208_before on commit drop as
select
  (select count(*) from public.messages where media_path is not null and media_path <> '') as path_rows,
  (select count(*) from public.messages where media_url is not null) as url_rows,
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
set media_bucket = b.filled_bucket,
    media_path = b.filled_path
from private.d208_media_path_backfill b
where m.id = b.message_id
  and (m.media_path is null or m.media_path = '');

do $check$
declare
  v_expected integer;
  v_filled integer;
  v_disagree integer;
  v_left integer;
  v_skipped integer;
  v_reachable integer;
  v_now_path_rows integer;
  v_now_url_rows integer;
  v_now_total integer;
  v_untouched text;
  v_other_paths text;
  b pg_temp.d208_before%rowtype;
begin
  select * into b from pg_temp.d208_before;
  select count(*) into v_expected from private.d208_media_path_backfill;

  -- 1. Every recorded row carries the path and the bucket it was recorded with.
  select count(*) into v_filled
  from public.messages m
  join private.d208_media_path_backfill b2 on b2.message_id = m.id
  where m.media_bucket = b2.filled_bucket and m.media_path = b2.filled_path;
  if v_filled <> v_expected then
    raise exception 'back-fill is half applied: % of % rows carry the path', v_filled, v_expected;
  end if;

  -- 2. Every touched row's URL is still exactly the address its columns produce.
  --    Equality, not LIKE: an object name is not a pattern, and 484 of the 778
  --    names in this bucket contain an underscore, which LIKE reads as a
  --    wildcard. That is the same hole the sibling migration's review found in
  --    its sidecar branch, and it had been repeated here.
  select count(*) into v_disagree
  from public.messages m
  join private.d208_media_path_backfill b2 on b2.message_id = m.id
  where m.media_url is distinct from (
    split_part(m.media_url, '/storage/v1/object/public/media/', 1)
    || '/storage/v1/object/public/media/' || m.media_path
  );
  if v_disagree > 0 then
    raise exception '% back-filled rows disagree with their own URL', v_disagree;
  end if;

  -- 3. Nothing else moved. Row count, the two populations, and two digests.
  select count(*) into v_now_total from public.messages;
  select count(*) into v_now_url_rows from public.messages where media_url is not null;
  select count(*) into v_now_path_rows from public.messages where media_path is not null and media_path <> '';
  if v_now_total <> b.total_rows then
    raise exception 'row count moved: % to %', b.total_rows, v_now_total;
  end if;
  if v_now_url_rows <> b.url_rows then
    raise exception 'media_url population moved: % to %', b.url_rows, v_now_url_rows;
  end if;
  if v_now_path_rows <> b.path_rows + v_expected then
    raise exception 'media_path population moved by % where % was intended',
      v_now_path_rows - b.path_rows, v_expected;
  end if;

  select md5(coalesce(string_agg(
      concat_ws(chr(31), m.id::text, coalesce(m.media_url, ''), coalesce(m.edited_at::text, ''),
                coalesce(m.deleted_at::text, ''), coalesce(m.content, ''),
                coalesce(m.media_metadata::text, ''), coalesce(m.type::text, '')),
      chr(30) order by m.id), '')) into v_untouched
  from public.messages m;
  if v_untouched is distinct from b.untouched_digest then
    raise exception 'a column this migration does not write has changed';
  end if;

  select md5(coalesce(string_agg(
      concat_ws(chr(31), m.id::text, coalesce(m.media_bucket, ''), coalesce(m.media_path, '')),
      chr(30) order by m.id), '')) into v_other_paths
  from public.messages m
  where not exists (select 1 from private.d208_media_path_backfill b2 where b2.message_id = m.id);
  if v_other_paths is distinct from b.other_rows_path_digest then
    raise exception 'a row outside the back-fill has changed its media_bucket or media_path';
  end if;

  -- 4. What is left over must be only what was deliberately skipped. The
  --    previous draft of this file demanded that *no* live legacy row remain,
  --    which contradicted its own design: a row whose object is missing is
  --    excluded on purpose and would then have aborted the migration that
  --    correctly excluded it.
  select count(*) into v_left
  from d208_candidate c
  join d208_qualified q on q.message_id = c.message_id
  where not exists (
    select 1 from private.d208_media_path_backfill b2 where b2.message_id = c.message_id
  );
  if v_left > 0 then
    raise exception '% live legacy rows qualified but were not filled', v_left;
  end if;

  select count(*) into v_skipped
  from d208_candidate c
  where not exists (select 1 from d208_qualified q where q.message_id = c.message_id);

  -- 5. What this buys, counted rather than assumed: rows now matching the shape
  --    `_kub_media_read_allowed` looks for on a message's own upload.
  select count(*) into v_reachable
  from public.messages m
  join private.d208_media_path_backfill b2 on b2.message_id = m.id
  where m.media_bucket = 'media'
    and m.deleted_at is null
    and split_part(m.media_path, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (select 1 from storage.objects o where o.bucket_id = 'media' and o.name = m.media_path);

  raise notice 'D-208 back-fill: % rows filled, % reachable through the read predicate, % live rows left alone (object gone or path not invertible)',
    v_expected, v_reachable, v_skipped;
end
$check$;

commit;
