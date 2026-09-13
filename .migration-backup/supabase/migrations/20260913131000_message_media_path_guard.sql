/**
 * A message's media_path must be the sender's own upload.
 *
 * D-177 item 2. The upload side is already closed: `_kub_media_path_allowed`
 * confines an object in the `media` bucket to `{auth.uid()}/...`, or to one of
 * the avatar prefixes (20260905150000_media_path_uuid_pattern_repair.sql:51-90),
 * and the four `media` policies call it (20260505_media_storage_path_policies.sql:70-108).
 * The row side is not: `Chat members can send messages`
 * (20260831100000_bot_platform_foundation.sql:759-767) checks membership and
 * authorship and nothing about media, so a member can post a message that points
 * at another person's object — and the author-only UPDATE policy plus
 * trg_enqueue_bot_message_updates_after_update (…:4205-4208) mean the same is
 * reachable after the insert.
 *
 * THE TWO EXEMPTIONS ARE NOT OPTIONAL.
 *   - A forward carries the SOURCE's media_path, copied from the server's own
 *     row by public.forward_message (20260911144000:24-27). Without the
 *     forwarded_from_id branch below this refuses every forwarded photo, which
 *     is D-083 reopened. The branch grants nothing: a forward can only re-point
 *     at media of a message the caller could already read.
 *   - A session with no auth.uid() is the service role: the variant worker
 *     (mediaVariantsWorker.ts) and maintenance. Not the subject of this rule.
 * Bot messages are exempt by bot_id; the insert policy already forbids a client
 * from setting it.
 *
 * Nothing is raised on a violation the product could produce, because there is
 * none. A violation IS raised, because unlike a read mark there is no
 * "stale client" reading of a message claiming someone else's file.
 *
 * Owner: the owner of public.messages (postgres on this deployment) or a
 * superuser. Lock: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on public.messages,
 * which every send writes; lock_timeout makes the apply fail in five seconds
 * rather than queue sends behind it.
 *
 * Idempotent: drop-and-create of one trigger and two functions.
 * Rollback: 3.5.
 */

begin;

set local lock_timeout = '5s';

create schema if not exists private;

-- The rule as a pure function, so the self-check can prove it without writing a
-- row. p_forward_matches is "this row names a forwarded_from_id whose message
-- carries the same bucket and path", resolved by the trigger.
create or replace function private.message_media_path_allowed(
  p_actor uuid,
  p_author uuid,
  p_bot_id uuid,
  p_media_path text,
  p_forward_matches boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_media_path is null then true          -- no media, nothing to check
    when p_actor is null then true               -- service role: not the subject
    when p_bot_id is not null then true          -- a bot's message, not a client insert
    when p_forward_matches then true             -- a forward carries the source's path
    when p_author is null then false             -- a person's message with no author
    else pg_catalog.split_part(p_media_path, '/', 1) = p_author::text
  end
$function$;

create or replace function private.guard_message_media_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_forward_matches boolean := false;
begin
  if new.media_path is null then
    return new;
  end if;

  if new.forwarded_from_id is not null then
    select true
      into v_forward_matches
      from public.messages source
     where source.id = new.forwarded_from_id
       and source.media_path is not distinct from new.media_path
       and source.media_bucket is not distinct from new.media_bucket;
    v_forward_matches := coalesce(v_forward_matches, false);
  end if;

  if not private.message_media_path_allowed(
       v_actor, new.user_id, new.bot_id, new.media_path, v_forward_matches) then
    raise exception 'message_media_path_not_owned'
      using errcode = '42501',
            detail = 'media_path must begin with the sender''s own id, or be copied from a forwarded message';
  end if;

  return new;
end
$function$;

revoke all on function private.message_media_path_allowed(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_message_media_path()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_message_media_path on public.messages;
create trigger trg_guard_message_media_path
  before insert or update of media_bucket, media_path, user_id, bot_id, forwarded_from_id
  on public.messages
  for each row execute function private.guard_message_media_path();

-- Refuse to commit unless the trigger is in place, the rule is the one
-- described, and — the part that would break the product — no message the
-- history already holds would have been refused by it.
do $$
declare
  v_mine constant uuid := '11111111-1111-1111-1111-111111111111';
  v_other constant uuid := '22222222-2222-2222-2222-222222222222';
  v_bot constant uuid := '33333333-3333-3333-3333-333333333333';
  v_trigger record;
  v_columns text[];
  v_refused bigint;
begin
  select t.tgenabled, t.tgtype, t.tgattr, p.oid::regprocedure::text as fn
    into v_trigger
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.messages'::regclass
     and t.tgname = 'trg_guard_message_media_path'
     and not t.tgisinternal;
  if not found then
    raise exception 'the media-path guard trigger is missing';
  end if;
  if v_trigger.tgenabled = 'D' then
    raise exception 'the media-path guard trigger is disabled';
  end if;
  -- tgtype bits: 1 = row, 2 = before, 4 = insert, 16 = update.
  if (v_trigger.tgtype & 1) = 0 or (v_trigger.tgtype & 2) = 0
     or (v_trigger.tgtype & 4) = 0 or (v_trigger.tgtype & 16) = 0 then
    raise exception 'the media-path guard must be a BEFORE INSERT OR UPDATE row trigger (tgtype %)', v_trigger.tgtype;
  end if;
  if v_trigger.fn <> 'private.guard_message_media_path()' then
    raise exception 'the media-path guard calls % instead', v_trigger.fn;
  end if;
  select pg_catalog.array_agg(a.attname::text order by a.attname)
    into v_columns
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.messages'::regclass
     and a.attnum = any (v_trigger.tgattr::smallint[]);
  if v_columns is distinct from
       array['bot_id', 'forwarded_from_id', 'media_bucket', 'media_path', 'user_id'] then
    raise exception 'the media-path guard fires for columns % instead of the media and sender columns', v_columns;
  end if;

  -- The rule itself, case by case.
  if not private.message_media_path_allowed(v_mine, v_mine, null, v_mine::text || '/a.jpg', false) then
    raise exception 'a sender''s own upload was refused';
  end if;
  if private.message_media_path_allowed(v_mine, v_mine, null, v_other::text || '/a.jpg', false) then
    raise exception 'a message claiming another person''s object was accepted';
  end if;
  if not private.message_media_path_allowed(v_mine, v_mine, null, v_other::text || '/a.jpg', true) then
    raise exception 'a forward carrying the source''s path was refused: D-083 would reopen';
  end if;
  if not private.message_media_path_allowed(null, v_other, null, v_other::text || '/a.jpg', false) then
    raise exception 'the service role was refused; the variant worker would stop';
  end if;
  if not private.message_media_path_allowed(v_mine, null, v_bot, 'anything/a.jpg', false) then
    raise exception 'a bot message was refused';
  end if;
  if not private.message_media_path_allowed(v_mine, v_mine, null, null, false) then
    raise exception 'a message without media was refused';
  end if;
  if private.message_media_path_allowed(v_mine, v_mine, null, 'avatars/' || v_mine::text || '/a.jpg', false) then
    raise exception 'a message pointing at an avatar path was accepted; message media lives under the sender''s id';
  end if;

  -- And no message already stored would have been refused. If this is not zero,
  -- the rule above is wrong about the product: widen the rule, never the check.
  select count(*)
    into v_refused
    from public.messages m
   where m.media_path is not null
     and m.bot_id is null
     and not private.message_media_path_allowed(
           m.user_id, m.user_id, m.bot_id, m.media_path,
           exists (
             select 1 from public.messages src
              where src.id = m.forwarded_from_id
                and src.media_path is not distinct from m.media_path
                and src.media_bucket is not distinct from m.media_bucket
           ));
  if v_refused <> 0 then
    raise exception
      '% messages already in the history would have been refused by this rule; it is wrong about the product', v_refused;
  end if;
end
$$;

commit;
