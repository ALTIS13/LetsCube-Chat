-- D-208 step three: the rows that carry only a URL.
--
-- NOT APPLIED. Written 2026-09-19 from read-only measurements; nothing here has
-- been rehearsed anywhere. Needs a verified backup and the owner's approval.
--
-- ## What the counts actually are
--
-- The register says "the 20 legacy `media_url`-only messages". Re-measured on
-- production on 2026-09-19 there are indeed 20, and the number hides the shape:
--
--     live | object still in storage | rows
--     -----+-------------------------+-----
--     f    | f                       |  10
--     t    | t                       |  10
--
-- Exactly ten are on messages that are not deleted, and those ten are exactly
-- the ten whose object still exists. The other ten name files that were removed
-- with the messages. So the back-fill is ten rows, not twenty, and the ten it
-- cannot fill are not a failure — writing a path to a deleted object would
-- create a dangling reference where there is currently an honest dead URL.
--
-- Also re-measured: 294 of 314 media messages already carry both path columns
-- (the register's 293 of 313 — one message has been sent since), and in **all
-- 294** `media_url` is exactly `<base>/storage/v1/object/public/media/` plus
-- `media_path`, with no escaping and no query string. That is what makes the
-- derivation below safe rather than a guess: the same relationship holds on
-- every row where both halves can be compared.
--
-- ## This is not a prerequisite for steps one and two
--
-- `messageMediaObjectRef` in `lib/media/mediaObjectRef.ts` already falls back to
-- parsing the URL when the columns are absent, and all 20 parse. Running this
-- makes the columns the single source rather than one of two, which is worth
-- having; it does not unblock anything.
--
-- ## The 16 avatar URLs need no migration at all
--
-- `profiles.avatar_url`, `chats.avatar_url` and `bots.avatar_url` have no path
-- column to be back-filled into, so "back-filling the 16" can only mean adding
-- three columns or recovering the path at read time. All 16 — 10 profiles and 6
-- chats; production has no bot with a picture — parse to a path with no
-- percent-escapes and no query string, and all 16 name an object that exists.
-- `avatarMediaObjectRef` recovers them, and three new columns buy nothing.
--
-- Rollback: `20260919130000_media_path_backfill_for_legacy_messages.rollback.sql`.

begin;

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

with candidate as (
  select
    m.id,
    m.media_bucket as previous_bucket,
    m.media_path as previous_path,
    'media'::text as filled_bucket,
    regexp_replace(m.media_url, '^.*/storage/v1/object/public/media/', '') as filled_path
  from public.messages m
  where (m.media_path is null or m.media_path = '')
    and m.media_url like '%/storage/v1/object/public/media/%'
    and m.deleted_at is null
),
-- Only where the object is really there. A path pointing at nothing is worse
-- than the URL it replaces, because the URL is visibly dead and a path is not.
present as (
  select c.* from candidate c
  where exists (
    select 1 from storage.objects o
    where o.bucket_id = 'media' and o.name = c.filled_path
  )
    -- No query string and no escape: measured true for all 20, and asserted
    -- here so a row that acquires one later is skipped rather than mangled.
    and c.filled_path not like '%?%'
    and c.filled_path not like '%\%%'
)
insert into private.d208_media_path_backfill
  (message_id, previous_bucket, previous_path, filled_bucket, filled_path)
select id, previous_bucket, previous_path, filled_bucket, filled_path from present
on conflict (message_id) do nothing;

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
begin
  select count(*) into v_expected from private.d208_media_path_backfill;

  select count(*) into v_filled
  from public.messages m
  join private.d208_media_path_backfill b on b.message_id = m.id
  where m.media_bucket = b.filled_bucket and m.media_path = b.filled_path;

  if v_filled <> v_expected then
    raise exception 'back-fill is half applied: % of % rows carry the path', v_filled, v_expected;
  end if;

  -- Every touched row's URL must still be the address its columns produce.
  select count(*) into v_disagree
  from public.messages m
  join private.d208_media_path_backfill b on b.message_id = m.id
  where m.media_url not like '%/storage/v1/object/public/media/' || m.media_path;
  if v_disagree > 0 then
    raise exception '% back-filled rows disagree with their own URL', v_disagree;
  end if;

  -- What is left over should be the deleted ones, and only those.
  select count(*) into v_left
  from public.messages
  where (media_path is null or media_path = '')
    and media_url like '%/storage/v1/object/public/media/%'
    and deleted_at is null;
  if v_left > 0 then
    raise exception '% live legacy rows were not filled', v_left;
  end if;

  raise notice 'D-208 back-fill: % rows', v_expected;
end
$check$;

commit;
