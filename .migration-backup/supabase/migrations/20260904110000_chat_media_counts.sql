-- Exact media totals for the profile card, counted where the rows are.
--
-- The card lists what a chat holds, one counted row per kind — «1543
-- фотографии», «96 файлов». Until now those numbers came from the first page
-- of messages the panel had fetched, 24 rows, so the card printed «24+
-- фотографии» in place of a total. That was merely imprecise. The part that was
-- wrong is what the page did NOT contain: a kind whose only rows sit outside
-- that window got no row at all. A chat whose 24 most recent messages are
-- photos showed no «Файлы» row while holding ninety-six files, and the list
-- reads as a complete inventory, so absence was a claim — a false one.
--
-- A client cannot count what it has not fetched, so the count moves here.
--
-- Visibility. `chat_media_counts` is SECURITY INVOKER, deliberately. It runs as
-- the caller, so the two SELECT policies already on `public.messages` decide
-- what it may see:
--
--   "Chat members can view messages"  using (is_chat_member(chat_id))
--   "block banned reads"              using (not is_banned(uid()))
--
-- A non-member's scan therefore returns zero rows and the function returns an
-- empty set, without a membership test of its own. That absence is the point:
-- an `is_chat_member` check written into the body would be a second copy of the
-- visibility rule, free to drift from the policy that actually protects the
-- table. Nothing here can widen what the caller could already read with a plain
-- `select * from messages where chat_id = ...`; the same is true of the two
-- other tables it touches, which it reads only through the caller's own
-- policies — `chat_members` ("(user_id = uid()) OR is_chat_member(chat_id)")
-- for the caller's own `cleared_at`, and `message_hidden_for_users`
-- ("user_id = uid()") for the caller's own hidden rows.
--
-- The count also matches what the panel would have shown had it loaded
-- everything: soft-deleted rows are skipped, rows cleared by «Очистить историю
-- у себя» are skipped for the person who cleared them and for nobody else, and
-- a message hidden for one member stays counted for the others.
--
-- Drift. `public.message_media_kind` and `public.message_first_link` are a
-- second copy of `classifyMessageMedia` and `extractFirstLink` from
-- `artifacts/kub/src/lib/messageMediaSections.ts`, which is the risk this
-- migration takes on. `tests/server/chat-media-counts-parity.test.mjs` loads
-- THIS file into an in-process PostgreSQL and runs both implementations over
-- one corpus, so a change to either side that the other does not follow turns
-- the suite red.
--
-- Two translations in that copy are not obvious and are deliberate:
--
--   * The whitespace class repeated below is JavaScript's own `\s`, spelled
--     out as `\uXXXX` escapes: 0009-000d, 0020, 00a0, 1680, 2000-200a, 2028,
--     2029, 202f, 205f, 3000, feff. `[[:space:]]` is close but not the same
--     set, and `String.prototype.trim` removes exactly this set, which is why
--     the caption test allows leading whitespace instead of trimming: any
--     trailing whitespace character already satisfies the alternative after
--     the word.
--   * `char_length(...) + regexp_count(..., '[\U00010000-\U0010FFFF]')` is
--     JavaScript's `String.length`, which counts UTF-16 code units. It matters
--     only for `http://` followed by a single astral character, where
--     `char_length` alone would say 8 and JavaScript says 9.
--
-- Cost. Measured on this deployment: 2951 messages in total, 1381 in the
-- largest chat. `messages_chat_active_created_idx (chat_id, created_at desc,
-- id desc) where deleted_at is null` already covers the scan, so no index is
-- added here.

do $guard$
begin
  if to_regclass('public.messages') is null
     or to_regclass('public.chat_members') is null
     or to_regclass('public.message_hidden_for_users') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception 'chat_media_counts prerequisites are missing';
  end if;
end
$guard$;

-- The first http(s) link in a piece of text, or null.
--
-- Mirrors `extractFirstLink`. Trailing punctuation is stripped because a link
-- at the end of a sentence is followed by a full stop that is not part of the
-- address, and what is left has to be longer than `https://` — otherwise
-- «https://.» would count as a link.
create or replace function public.message_first_link(p_content text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $function$
  select case
    when candidate.trimmed is null then null
    when char_length(candidate.trimmed)
         + regexp_count(candidate.trimmed, '[\U00010000-\U0010FFFF]') > 8
      then candidate.trimmed
  end
  from (
    select regexp_replace(
             (regexp_match(
                coalesce(p_content, ''),
                'https?://[^\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff<>"''`]+',
                'i'
              ))[1],
             '[.,;:!?)\]}»"'']+$',
             ''
           ) as trimmed
  ) candidate
$function$;

-- Which section of the shared-media list a row belongs to, or null for none.
--
-- Mirrors `classifyMessageMedia`. A row with no attachment is not media
-- whatever its type says — that is how a deleted attachment would otherwise be
-- counted as a photo. Text is the one exception: it carries links, which have
-- no attachment of their own. The empty string is checked alongside null
-- because the JavaScript reads `if (!message.media_url)`, and '' is falsy
-- there.
create or replace function public.message_media_kind(
  p_type text,
  p_content text,
  p_media_url text,
  p_media_metadata jsonb
)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $function$
  select case
    when p_type = 'text' then
      case when public.message_first_link(p_content) is not null then 'link' end
    when p_media_url is null or p_media_url = '' then null
    when p_type = 'image' then
      case when strpos(lower(coalesce(p_content, '') || ' ' || coalesce(p_media_url, '')), '.gif') > 0
        then 'gif' else 'photo' end
    when p_type = 'video' then
      case
        -- A round «кружок», not an ordinary clip.
        when coalesce(p_media_metadata ->> 'kind' = 'video_message', false)
          or coalesce(p_media_metadata ->> 'shape' = 'round', false)
          or coalesce(p_content, '') ~*
             '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*Видео-сообщение([\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|\(|$)'
          then 'videoMessage'
        when strpos(lower(coalesce(p_content, '') || ' ' || coalesce(p_media_url, '')), '.gif') > 0
          then 'gif'
        else 'video'
      end
    when p_type = 'audio' then
      case
        -- A recorded voice note, as opposed to an audio file that was attached.
        when lower(coalesce(p_media_url, '')) ~ '\.(webm|ogg|oga|mp3|wav|m4a|aac)(\?|#|$)'
          or strpos(lower(coalesce(p_content, '')), 'голосовое') > 0
          or strpos(lower(coalesce(p_content, '')), 'voice') > 0
          then 'voice'
        else 'audio'
      end
    when p_type = 'file' then 'file'
  end
$function$;

-- How many of each kind this chat holds, for the caller.
create or replace function public.chat_media_counts(p_chat_id uuid)
returns table (kind text, total integer)
language sql
stable
parallel safe
set search_path = pg_catalog, public
as $function$
  select classified.k as kind, count(*)::integer as total
  from (
    select public.message_media_kind(m.type, m.content, m.media_url, m.media_metadata) as k
    from public.messages m
    where m.chat_id = p_chat_id
      and m.deleted_at is null
      and m.created_at > coalesce(
        (
          select cm.cleared_at
          from public.chat_members cm
          where cm.chat_id = p_chat_id
            and cm.user_id = auth.uid()
        ),
        '-infinity'::timestamptz
      )
      and not exists (
        select 1
        from public.message_hidden_for_users h
        where h.message_id = m.id
          and h.user_id = auth.uid()
      )
  ) classified
  where classified.k is not null
  group by classified.k
  order by classified.k
$function$;

revoke all on function public.message_first_link(text) from public, anon, authenticated, service_role;
revoke all on function public.message_media_kind(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.chat_media_counts(uuid) from public, anon, authenticated, service_role;

-- The two helpers read nothing; they are pure text functions and are granted
-- only because a SECURITY INVOKER caller needs EXECUTE on what it calls.
grant execute on function public.message_first_link(text) to authenticated;
grant execute on function public.message_media_kind(text, text, text, jsonb) to authenticated;
grant execute on function public.chat_media_counts(uuid) to authenticated;

comment on function public.message_first_link(text) is
  'The first http(s) link in a text, trailing punctuation stripped, or null. Mirrors extractFirstLink in artifacts/kub/src/lib/messageMediaSections.ts; kept in step by tests/server/chat-media-counts-parity.test.mjs.';
comment on function public.message_media_kind(text, text, text, jsonb) is
  'Which shared-media section a message row belongs to, or null. Mirrors classifyMessageMedia in artifacts/kub/src/lib/messageMediaSections.ts; kept in step by tests/server/chat-media-counts-parity.test.mjs.';
comment on function public.chat_media_counts(uuid) is
  'Exact per-kind media totals for one chat. SECURITY INVOKER: the caller''s own RLS on messages, chat_members and message_hidden_for_users decides what is counted, so a non-member gets an empty set.';
