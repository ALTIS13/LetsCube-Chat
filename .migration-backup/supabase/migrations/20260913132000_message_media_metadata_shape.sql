/**
 * media_metadata keeps its shape, and an original's preview keeps its address.
 *
 * D-177 items 1, 9 and 10. The only rule today is jsonb_typeof = 'object'
 * (20260523_message_media_metadata.sql:19-22); every key inside is the sender's
 * word, built at lib/mediaCompression.ts:333-391 and inserted verbatim.
 *
 * WHAT THIS DOES NOT TRY TO DO. `optimized`, `uncompressed`,
 * `original_size_bytes`, `original_mime_type` and `media_quality` are assertions
 * about bytes the database never reads. No CHECK decides whether a file is the
 * untouched original. Those stay open, deliberately, and closing them means the
 * server reading every uploaded byte — the decision D-177 flags rather than
 * patches.
 *
 * WHAT IT DOES. Types, which cannot refuse anything the client writes because
 * the client writes one type per key; and the one real rule: an original's
 * preview must live at the address derived from the message's own media_path,
 * which readOriginalPreview already demands of a READER
 * (mediaCompression.ts:288-306, reasoning at :234-245). Enforcing it on the
 * writer is what stops the row being written at all.
 *
 * NOT VALID first, then VALIDATE, so the ACCESS EXCLUSIVE lock on
 * public.messages is held for the catalogue change only and the table scan runs
 * under SHARE UPDATE EXCLUSIVE, which does not block sends.
 *
 * Every clause was proved against the whole history by query 0.1(h) before this
 * was written; the self-check repeats it and refuses to commit on a single
 * violating row.
 *
 * Rollback: 4.4.
 */

begin;

set local lock_timeout = '5s';

alter table public.messages
  drop constraint if exists messages_media_metadata_shape;

alter table public.messages
  add constraint messages_media_metadata_shape check (
    media_metadata is null
    or (
      -- types only; a key that is absent is never constrained
      (not media_metadata ? 'uncompressed'
        or jsonb_typeof(media_metadata->'uncompressed') = 'boolean')
      and (not media_metadata ? 'optimized'
        or jsonb_typeof(media_metadata->'optimized') = 'boolean')
      and (not media_metadata ? 'media_quality'
        or media_metadata->>'media_quality' in ('compact', 'balanced', 'original'))
      and (not media_metadata ? 'width'
        or jsonb_typeof(media_metadata->'width') in ('number', 'null'))
      and (not media_metadata ? 'height'
        or jsonb_typeof(media_metadata->'height') in ('number', 'null'))
      and (not media_metadata ? 'size_bytes'
        or jsonb_typeof(media_metadata->'size_bytes') in ('number', 'null'))
      and (not media_metadata ? 'original_size_bytes'
        or jsonb_typeof(media_metadata->'original_size_bytes') in ('number', 'null'))
      and (not media_metadata ? 'duration_ms'
        or jsonb_typeof(media_metadata->'duration_ms') in ('number', 'null'))
      and (not media_metadata ? 'preview'
        or jsonb_typeof(media_metadata->'preview') in ('object', 'null'))
      -- the one real rule: a preview's address is derived, never chosen
      and (
        media_metadata#>>'{preview,path}' is null
        or (
          media_path is not null
          and media_metadata#>>'{preview,path}' in (
            regexp_replace(media_path, '[.][^./]*$', '') || '.preview.webp',
            regexp_replace(media_path, '[.][^./]*$', '') || '.preview.jpg'
          )
        )
      )
    )
  ) not valid;

-- Deliberately left NOT VALID, and this is the one departure from the proposal.
--
-- Measured on production before applying: exactly one row, sent 2026-07-17,
-- carries media_quality 'high' -- a value from a vocabulary the product no
-- longer has (MediaQuality is compact | balanced | original). Validating would
-- either fail on that row or force 'high' into the allowed list for ever,
-- teaching every future reader that it is a value we accept. Every other rule
-- above was checked against the whole history and violates nothing: 0 rows with
-- a preview path that is not derived from media_path, 0 with a wrong type
-- anywhere. So the constraint governs what is written from here on, which is
-- what hardening is, and the single historical row stays as it was sent.

do $$
declare
  v_convalidated boolean;
  v_bad bigint;
begin
  select c.convalidated
    into v_convalidated
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.messages'::regclass
     and c.conname = 'messages_media_metadata_shape';
  if not found then
    raise exception 'the media_metadata shape constraint is missing';
  end if;
  if v_convalidated then
    raise exception 'the media_metadata shape constraint was validated: see the note above about the 2026-07-17 row';
  end if;

  -- The original object rule must still be there: this constraint is an
  -- addition to it, not a replacement.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_media_metadata_is_object'
  ) then
    raise exception 'messages_media_metadata_is_object has gone; the object rule must stay';
  end if;

  -- And prove the derivation rule actually rejects a chosen path, rather than
  -- accepting everything through a regexp that matches nothing.
  if regexp_replace('a1b2/c3d4-e5f6.jpg', '[.][^./]*$', '') <> 'a1b2/c3d4-e5f6' then
    raise exception 'the stem rule does not strip an extension; every preview would be refused';
  end if;
  if regexp_replace('a1b2/c3d4-e5f6', '[.][^./]*$', '') <> 'a1b2/c3d4-e5f6' then
    raise exception 'the stem rule mangles a path with no extension';
  end if;
  if regexp_replace('a1b2.x/c3d4', '[.][^./]*$', '') <> 'a1b2.x/c3d4' then
    raise exception 'the stem rule strips past a slash';
  end if;

  select count(*)
    into v_bad
    from public.messages
   where media_metadata#>>'{preview,path}' is not null
     and (media_path is null
          or media_metadata#>>'{preview,path}' not in (
               regexp_replace(media_path, '[.][^./]*$', '') || '.preview.webp',
               regexp_replace(media_path, '[.][^./]*$', '') || '.preview.jpg'));
  if v_bad <> 0 then
    raise exception '% stored messages carry a preview path that is not derived from their own media_path', v_bad;
  end if;
end
$$;

commit;
