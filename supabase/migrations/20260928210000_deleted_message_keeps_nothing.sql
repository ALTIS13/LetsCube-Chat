-- D-103: a message deleted for everyone leaves its content, its media and its
-- notification preview behind. Approved by the owner on 2026-09-28 with the rest
-- of docs/operations/2026-09-28-database-proposals.md (entry 7), where it was
-- written down as his decision because it is a data-loss decision about other
-- people's messages.
--
-- What «удалить у всех» does after this, the way Telegram and Discord do it:
-- the message is gone, not hidden.
--
-- * The row keeps who sent it, when and where, and loses what it said:
--   content, media references, media metadata, a bot's keyboard and its input
--   placeholder. It is unpinned. `private.deleted_message_keeps_nothing`, a
--   BEFORE UPDATE trigger named to run after every other one, does this for
--   every path that sets `deleted_at`: `delete_messages_for_everyone`, a
--   bot's own deletion, and the author's direct UPDATE the older client still
--   makes. It also makes the deletion final: nothing written to a deleted
--   message afterwards stays, and `deleted_at` does not go back to null.
-- * What the message pointed at in storage is queued in
--   `private.message_media_purge` before the row forgets it: the file, and
--   the preview named after it in both spellings the media check allows, so a
--   preview that lands after the deletion is still found. The worker removes
--   them through the Storage API (`message_media_purge_claim` / `_finish`,
--   granted to service_role only). A file some live message still shows is
--   kept: a forward shares its source's file, and a reused video rendition is
--   the source file itself. Variant rows of a deleted message are moved into
--   the same queue by the claim.
-- * The recipients' notifications keep that a message came and lose its
--   words: `preview` becomes null and `deleted` true. A push not yet sent is
--   not sent; one already sent keeps no copy of the words in its outbox row.
--   A push already on a device stays there; nothing server-side reaches it.
-- * A message under an open report (`new`, `reviewing`) keeps what it said
--   for the moderator. Closing the report (`actioned`, `dismissed`) finishes
--   the deletion.
-- * Messages deleted before today are cleared the same way, by the same
--   trigger. Their content survives only in the automated backups, which are
--   pruned after 14 days.
--
-- Not touched: `forward_origin_name`, which a guard keeps permanent and which
-- is a name the chat already saw, and reactions.
--
-- Rollback: 20260928210000_deleted_message_keeps_nothing.rollback.sql. It
-- removes the mechanism; what was cleared stays cleared.
begin;

create table private.message_media_purge (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  bucket text not null,
  path text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  claimed_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint message_media_purge_status_valid check (status in ('pending', 'done', 'kept', 'failed')),
  constraint message_media_purge_once unique (message_id, bucket, path)
);

create index message_media_purge_pending_idx
  on private.message_media_purge (created_at) where status = 'pending';

revoke all on private.message_media_purge from public, anon, authenticated, service_role;

-- A notification is found by its message when the message is deleted.
create index notifications_message_id_idx
  on public.notifications ((payload ->> 'message_id')) where kind = 'message';

create function private.deleted_message_keeps_nothing()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_path text;
  v_bucket text;
  v_base text;
begin
  if old.deleted_at is not null then
    -- Deletion is final. Nothing brings the message back, and nothing written
    -- into it afterwards stays: it keeps what it held, which is nothing once
    -- it has been cleared, or what a moderator still has to read.
    new.deleted_at := old.deleted_at;
    new.edited_at := old.edited_at;
    new.content := old.content;
    new.media_url := old.media_url;
    new.media_bucket := old.media_bucket;
    new.media_path := old.media_path;
    new.media_metadata := old.media_metadata;
    new.bot_reply_markup := old.bot_reply_markup;
    new.bot_input_field_placeholder := old.bot_input_field_placeholder;
  end if;
  new.pinned := false;

  if exists (
    select 1
      from public.content_reports as report
     where report.message_id = old.id
       and report.status in ('new', 'reviewing')
  ) then
    return new;
  end if;

  -- What it pointed at in storage, as it was stored, before the row forgets it.
  if old.media_path is not null then
    v_path := old.media_path;
    v_bucket := coalesce(old.media_bucket, 'media');
  elsif old.media_url is not null then
    v_path := substring(old.media_url from '/storage/v1/object/public/media/([^?#]+)');
    v_bucket := 'media';
  end if;
  if v_path is not null then
    v_base := pg_catalog.regexp_replace(v_path, '[.][^./]*$', '');
    insert into private.message_media_purge (message_id, bucket, path)
    select old.id, v_bucket, candidate.path
      from (values (v_path), (v_base || '.preview.webp'), (v_base || '.preview.jpg')) as candidate(path)
    on conflict on constraint message_media_purge_once do nothing;
  end if;

  new.content := null;
  new.media_url := null;
  new.media_bucket := null;
  new.media_path := null;
  new.media_metadata := null;
  new.bot_reply_markup := null;
  new.bot_input_field_placeholder := null;
  return new;
end $$;

-- `zz` so it runs after every other BEFORE trigger on the table and has the
-- last word on the row.
create trigger trg_zz_deleted_message_keeps_nothing
  before update on public.messages
  for each row
  when (old.deleted_at is not null or new.deleted_at is not null)
  execute function private.deleted_message_keeps_nothing();

-- The recipients' copies of what the messages said.
create function private.scrub_deleted_message_notifications(p_message_ids uuid[])
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_ids text[] := array(select id::text from pg_catalog.unnest(p_message_ids) as id);
begin
  if pg_catalog.cardinality(v_ids) = 0 then
    return;
  end if;
  -- A push not yet sent is not sent.
  delete from public.notifications_push_outbox as outbox
   using public.notifications as note
   where outbox.notification_id = note.id
     and note.kind = 'message'
     and note.payload ->> 'message_id' = any (v_ids)
     and outbox.sent_at is null;
  delete from public.notifications_native_push_outbox as outbox
   using public.notifications as note
   where outbox.notification_id = note.id
     and note.kind = 'message'
     and note.payload ->> 'message_id' = any (v_ids)
     and outbox.sent_at is null;
  -- One already sent keeps no copy of the words.
  update public.notifications_push_outbox as outbox
     set payload = outbox.payload || pg_catalog.jsonb_build_object('body', 'Сообщение удалено', 'preview', null)
    from public.notifications as note
   where outbox.notification_id = note.id
     and note.kind = 'message'
     and note.payload ->> 'message_id' = any (v_ids);
  update public.notifications_native_push_outbox as outbox
     set payload = outbox.payload || pg_catalog.jsonb_build_object('body', 'Сообщение удалено', 'preview', null)
    from public.notifications as note
   where outbox.notification_id = note.id
     and note.kind = 'message'
     and note.payload ->> 'message_id' = any (v_ids);
  -- The notification keeps that a message came, and loses what it said.
  update public.notifications as note
     set payload = note.payload || pg_catalog.jsonb_build_object('preview', null, 'deleted', true)
   where note.kind = 'message'
     and note.payload ->> 'message_id' = any (v_ids);
end $$;

create function private.deleted_message_leaves_no_preview()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform private.scrub_deleted_message_notifications(array[new.id]);
  return null;
end $$;

create trigger trg_zz_deleted_message_leaves_no_preview
  after update of deleted_at on public.messages
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.deleted_message_leaves_no_preview();

-- A closed report finishes a deletion it held back.
create function private.closed_report_finishes_deletion()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.message_id is not null and new.status in ('actioned', 'dismissed') then
    update public.messages
       set deleted_at = deleted_at
     where id = new.message_id
       and deleted_at is not null;
  end if;
  return null;
end $$;

create trigger trg_content_report_closed_finishes_deletion
  after update of status on public.content_reports
  for each row
  when (old.status is distinct from new.status)
  execute function private.closed_report_finishes_deletion();

-- The worker's two calls.
create function public.message_media_purge_claim(p_limit integer default 50)
returns table (id uuid, bucket text, path text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  -- The variant files of a deleted message join the queue, and their rows go.
  with moved as (
    delete from public.media_variants as variant
     using public.messages as message
     where variant.message_id = message.id
       and message.deleted_at is not null
       and not exists (
         select 1 from public.content_reports as report
          where report.message_id = message.id and report.status in ('new', 'reviewing')
       )
    returning variant.message_id, variant.variant_bucket, variant.variant_path
  )
  insert into private.message_media_purge (message_id, bucket, path)
  select moved.message_id, moved.variant_bucket, moved.variant_path
    from moved
  on conflict on constraint message_media_purge_once do nothing;

  -- A file some live message still shows is kept: its own file, its preview,
  -- a preview named after its file, or one of its variants.
  update private.message_media_purge as queued
     set status = 'kept', finished_at = pg_catalog.now(), claimed_until = null
   where queued.status = 'pending'
     and (
       exists (
         select 1 from public.messages as live
          where live.deleted_at is null
            and coalesce(live.media_bucket, 'media') = queued.bucket
            and (live.media_path = queued.path or live.media_metadata #>> '{preview,path}' = queued.path)
       )
       -- A preview named after a file some live message shows, compared by
       -- name only for the paths that are previews.
       or (
         queued.path ~ '[.]preview[.](webp|jpg)$'
         and exists (
           select 1 from public.messages as live
            where live.deleted_at is null
              and coalesce(live.media_bucket, 'media') = queued.bucket
              and live.media_path is not null
              and pg_catalog.regexp_replace(live.media_path, '[.][^./]*$', '')
                  = pg_catalog.regexp_replace(queued.path, '[.]preview[.](webp|jpg)$', '')
         )
       )
       or exists (
         select 1 from public.media_variants as variant
          where variant.variant_bucket = queued.bucket
            and variant.variant_path = queued.path
            and (
              variant.message_id is null
              or exists (
                select 1 from public.messages as live
                 where live.id = variant.message_id and live.deleted_at is null
              )
            )
       )
     );

  return query
  with picked as (
    select queued.id
      from private.message_media_purge as queued
     where queued.status = 'pending'
       and (queued.claimed_until is null or queued.claimed_until < pg_catalog.now())
     order by queued.created_at
     limit v_limit
       for update skip locked
  )
  update private.message_media_purge as queued
     set claimed_until = pg_catalog.now() + interval '5 minutes',
         attempts = queued.attempts + 1
    from picked
   where queued.id = picked.id
  returning queued.id, queued.bucket, queued.path;
end $$;

create function public.message_media_purge_finish(p_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_error is null then
    update private.message_media_purge
       set status = 'done', finished_at = pg_catalog.now(), claimed_until = null, last_error = null
     where id = p_id;
    return;
  end if;
  -- Backed off, and given up after eight tries so a file Storage refuses for
  -- good cannot be asked about for ever.
  update private.message_media_purge
     set last_error = pg_catalog.left(p_error, 200),
         claimed_until = pg_catalog.now() + least(interval '1 hour', interval '1 minute' * pg_catalog.power(2, attempts)),
         status = case when attempts >= 8 then 'failed' else status end,
         finished_at = case when attempts >= 8 then pg_catalog.now() else finished_at end
   where id = p_id;
end $$;

revoke all on function private.deleted_message_keeps_nothing() from public, anon, authenticated, service_role;
revoke all on function private.scrub_deleted_message_notifications(uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.deleted_message_leaves_no_preview() from public, anon, authenticated, service_role;
revoke all on function private.closed_report_finishes_deletion() from public, anon, authenticated, service_role;
revoke all on function public.message_media_purge_claim(integer) from public, anon, authenticated;
revoke all on function public.message_media_purge_finish(uuid, text) from public, anon, authenticated;
grant execute on function public.message_media_purge_claim(integer) to service_role;
grant execute on function public.message_media_purge_finish(uuid, text) to service_role;

-- Messages deleted before today, through the same trigger: setting the
-- column to itself fires it and changes nothing else, so no «edited» stamp,
-- no bot update and no audit row.
create temporary table _deleted_before on commit drop as
select id from public.messages where deleted_at is not null;

update public.messages
   set deleted_at = deleted_at
 where deleted_at is not null
   and (
     content is not null
     or media_url is not null
     or media_path is not null
     or media_metadata is not null
     or bot_reply_markup is not null
     or bot_input_field_placeholder is not null
     or coalesce(pinned, false)
   );

select private.scrub_deleted_message_notifications(array(select id from _deleted_before));

do $$
begin
  if exists (
    select 1 from public.messages as message
     where message.deleted_at is not null
       and (
         message.content is not null or message.media_url is not null or message.media_path is not null
         or message.media_metadata is not null or message.bot_reply_markup is not null
         or message.bot_input_field_placeholder is not null or coalesce(message.pinned, false)
       )
       and not exists (
         select 1 from public.content_reports as report
          where report.message_id = message.id and report.status in ('new', 'reviewing')
       )
  ) then
    raise exception 'deleted_message_keeps_nothing: a deleted message still carries something';
  end if;
  if exists (
    select 1 from public.notifications as note
      join public.messages as message on message.id::text = note.payload ->> 'message_id'
     where note.kind = 'message'
       and message.deleted_at is not null
       and (note.payload ->> 'preview' is not null or not coalesce((note.payload ->> 'deleted')::boolean, false))
  ) then
    raise exception 'deleted_message_keeps_nothing: a notification still carries a deleted message''s words';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_zz_deleted_message_keeps_nothing' and tgenabled = 'O')
     or not exists (select 1 from pg_trigger where tgname = 'trg_zz_deleted_message_leaves_no_preview' and tgenabled = 'O')
     or not exists (select 1 from pg_trigger where tgname = 'trg_content_report_closed_finishes_deletion' and tgenabled = 'O')
     or pg_catalog.has_function_privilege('authenticated', 'public.message_media_purge_claim(integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.message_media_purge_finish(uuid, text)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.message_media_purge_claim(integer)', 'EXECUTE')
     or pg_catalog.has_table_privilege('service_role', 'private.message_media_purge', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'private.message_media_purge', 'SELECT')
  then
    raise exception 'deleted_message_keeps_nothing: incomplete';
  end if;
end;
$$;

commit;
