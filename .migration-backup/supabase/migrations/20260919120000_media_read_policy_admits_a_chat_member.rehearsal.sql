\pset pager off
\set ON_ERROR_STOP on

-- D-208 step nought: rehearsal of
--   20260919120000_media_read_policy_admits_a_chat_member.sql
-- and of its rollback, on production, inside one transaction that is rolled
-- back. Both files are spliced in verbatim; only their `begin;`/`commit;`
-- lines are removed, because this script owns the transaction.
--
-- Nothing identifying is printed: every object name, chat id and account id
-- lives in a temp table and only booleans, counts and SQLSTATEs come out.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '10min';
set local idle_in_transaction_session_timeout = '5min';
-- `storage.protect_delete` raises 42501 on any direct DELETE unless this is set,
-- which is also the code an RLS refusal carries. So there is no DELETE probe in
-- here at all: it could not be told apart from a policy refusal. This setting
-- exists only so the probe rows a phase leaves behind can be cleared between
-- phases, and it is transaction-local like everything else here.
set local storage.allow_delete_query = 'true';

create temp sequence res_ord;
create temp table res (
  ord bigint default nextval('res_ord'),
  phase text, who text, label text, value text
) on commit drop;
grant usage on sequence res_ord to authenticated;
grant select, insert on res to authenticated;

-- ------------------------------------------------------------- fixtures ----
create temp table fx on commit drop as
with base as (
  select m.chat_id, m.id as message_id, m.user_id as uploader, m.media_path as photo
  from public.messages m
  where m.media_bucket = 'media' and m.media_path is not null and m.deleted_at is null
    and exists (select 1 from storage.objects o where o.bucket_id='media' and o.name = m.media_path)
    and exists (select 1 from storage.objects v where v.bucket_id='media'
                  and (storage.foldername(v.name))[1]='variants'
                  and (storage.foldername(v.name))[2]='messages'
                  and (storage.foldername(v.name))[4]=m.id::text)
    and (select count(*) from public.chat_members cm where cm.chat_id = m.chat_id) >= 2
  order by m.created_at desc
  limit 1
), b2 as (
  select b.*,
    (select cm.user_id from public.chat_members cm
      where cm.chat_id = b.chat_id and cm.user_id <> b.uploader order by cm.joined_at limit 1) as member_b
  from base b
)
select
  b.chat_id, b.message_id, b.uploader, b.member_b, b.photo,
  (select p.id from public.profiles p
     where not exists (select 1 from public.chat_members cm
                        where cm.chat_id = b.chat_id and cm.user_id = p.id)
     order by p.id limit 1) as outsider,
  (select v.name from storage.objects v where v.bucket_id='media'
     and (storage.foldername(v.name))[1]='variants' and (storage.foldername(v.name))[2]='messages'
     and (storage.foldername(v.name))[4]=b.message_id::text order by v.name limit 1) as variant,
  (select v.name from storage.objects v where v.bucket_id='media'
     and (storage.foldername(v.name))[1]='variants' and (storage.foldername(v.name))[2]='messages'
     and not exists (select 1 from public.chat_members cm
                      where cm.user_id = b.member_b and cm.chat_id::text = (storage.foldername(v.name))[3])
     order by v.name limit 1) as foreign_variant,
  (select o.name from storage.objects o where o.bucket_id='media'
     and (storage.foldername(o.name))[1]='chat-avatars'
     and exists (select 1 from public.chat_members cm
                  where cm.user_id = b.member_b and cm.chat_id::text = (storage.foldername(o.name))[2])
     order by o.name limit 1) as chat_avatar_in,
  (select o.name from storage.objects o where o.bucket_id='media'
     and (storage.foldername(o.name))[1]='chat-avatars'
     and (storage.foldername(o.name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and not exists (select 1 from public.chat_members cm
                      where cm.user_id = b.member_b and cm.chat_id::text = (storage.foldername(o.name))[2])
     order by o.name limit 1) as chat_avatar_out,
  (select o.name from storage.objects o where o.bucket_id='media'
     and (storage.foldername(o.name))[1]='variants' and (storage.foldername(o.name))[2]='chats'
     and exists (select 1 from public.chat_members cm
                  where cm.user_id = b.member_b and cm.chat_id::text = (storage.foldername(o.name))[3])
     order by o.name limit 1) as vchat_in,
  (select o.name from storage.objects o where o.bucket_id='media'
     and (storage.foldername(o.name))[1]='variants' and (storage.foldername(o.name))[2]='chats'
     and (storage.foldername(o.name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and not exists (select 1 from public.chat_members cm
                      where cm.user_id = b.member_b and cm.chat_id::text = (storage.foldername(o.name))[3])
     order by o.name limit 1) as vchat_out,
  (select o.name from storage.objects o where o.bucket_id='media'
     and (storage.foldername(o.name))[1]='avatars'
     and (storage.foldername(o.name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (storage.foldername(o.name))[2] <> b.member_b::text
     order by o.name limit 1) as other_avatar,
  (select o.name from storage.objects o where o.bucket_id='media'
     and (storage.foldername(o.name))[1]='variants' and (storage.foldername(o.name))[2]='profiles'
     and (storage.foldername(o.name))[3] <> b.member_b::text
     order by o.name limit 1) as other_vprofile,
  left(b.photo, length(b.photo) - length(substring(b.photo from '\.[A-Za-z0-9]+$'))) as stem
from b2 b;

alter table fx add column sidecar text;
alter table fx add column poisoned text;
update fx set
  sidecar  = stem || '.preview.webp',
  poisoned = left(stem, length(stem) - 1) || '_' || '.preview.webp';

grant select on fx to authenticated;

do $fixture$
declare f record;
begin
  if (select count(*) from fx) <> 1 then
    raise exception 'no fixture';
  end if;
  select * into f from fx;
  if f.photo is null or f.variant is null or f.foreign_variant is null
     or f.member_b is null or f.outsider is null
     or f.chat_avatar_in is null or f.chat_avatar_out is null
     or f.vchat_in is null or f.vchat_out is null
     or f.other_avatar is null or f.other_vprofile is null
     or f.stem is null or f.sidecar is null or f.poisoned is null then
    raise exception 'incomplete fixture';
  end if;
  if f.uploader = f.member_b or f.member_b = f.outsider or f.uploader = f.outsider then
    raise exception 'the three actors are not three different accounts';
  end if;
  if right(f.stem, 1) = '_' or f.poisoned = f.sidecar then
    raise exception 'the poisoned name is not distinguishable from the real one';
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id='media' and o.name in (f.sidecar, f.poisoned)) then
    raise exception 'a synthetic name collides with a real object';
  end if;
end
$fixture$;

-- Two synthetic objects, so the sidecar branch can be measured at all: not one
-- of the 778 real names contains `.preview.`. `poisoned` is the same name with
-- one character of the stem replaced by an underscore — a LIKE wildcard, and
-- not a prefix. Both vanish with this transaction.
insert into storage.objects (bucket_id, name) select 'media', sidecar from fx;
insert into storage.objects (bucket_id, name) select 'media', poisoned from fx;

-- --------------------------------------------------------------- probes ----
create function pg_temp.note(p_phase text, p_who text, p_label text, p_value text)
returns void language plpgsql as $note$
begin
  insert into pg_temp.res(phase, who, label, value) values (p_phase, p_who, p_label, coalesce(p_value, '(null)'));
end
$note$;

create function pg_temp.can_read(p_phase text, p_who text, p_col text)
returns void language plpgsql as $cr$
declare v boolean;
begin
  execute format(
    'select exists (select 1 from storage.objects o, pg_temp.fx f where o.bucket_id = ''media'' and o.name = f.%I)',
    p_col) into v;
  insert into pg_temp.res(phase, who, label, value) values (p_phase, p_who, p_col, v::text);
exception when others then
  insert into pg_temp.res(phase, who, label, value) values (p_phase, p_who, p_col, 'ERROR ' || sqlstate);
end
$cr$;

create function pg_temp.try_write(p_phase text, p_who text, p_label text, p_sql text)
returns void language plpgsql as $tw$
begin
  begin
    execute p_sql;
    insert into pg_temp.res(phase, who, label, value) values (p_phase, p_who, p_label, 'ALLOWED');
  exception when others then
    insert into pg_temp.res(phase, who, label, value) values (p_phase, p_who, p_label, 'REFUSED ' || sqlstate);
  end;
end
$tw$;

create function pg_temp.count_rows(p_phase text, p_who text, p_label text, p_sql text)
returns void language plpgsql as $cn$
declare n integer;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
    insert into pg_temp.res(phase, who, label, value) values (p_phase, p_who, p_label, n || ' rows');
  exception when others then
    insert into pg_temp.res(phase, who, label, value) values (p_phase, p_who, p_label, 'REFUSED ' || sqlstate);
  end;
end
$cn$;

\echo === who the storage objects belong to, structurally (no values) ===
select 'objects in media' as k, count(*)::text as v from storage.objects where bucket_id='media'
union all select 'members of the fixture chat', (select count(*)::text from public.chat_members cm, fx where cm.chat_id = fx.chat_id)
union all select 'variants of the fixture message', (select count(*)::text from storage.objects v, fx
  where v.bucket_id='media' and (storage.foldername(v.name))[1]='variants'
    and (storage.foldername(v.name))[2]='messages' and (storage.foldername(v.name))[4]=fx.message_id::text)
union all select 'bans on the fixture accounts', (select count(*)::text from public.bans b, fx where b.user_id in (fx.uploader, fx.member_b, fx.outsider));

\echo === phase: before ===

select set_config('request.jwt.claims',
  json_build_object('sub',(select member_b from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.note('before','member_b','impersonation_ok',
  (select (auth.uid() = (select member_b from fx))::text));
select pg_temp.can_read('before','member_b','photo');
select pg_temp.can_read('before','member_b','variant');
select pg_temp.can_read('before','member_b','foreign_variant');
select pg_temp.can_read('before','member_b','chat_avatar_in');
select pg_temp.can_read('before','member_b','chat_avatar_out');
select pg_temp.can_read('before','member_b','vchat_in');
select pg_temp.can_read('before','member_b','vchat_out');
select pg_temp.can_read('before','member_b','other_avatar');
select pg_temp.can_read('before','member_b','other_vprofile');
select pg_temp.can_read('before','member_b','sidecar');
select pg_temp.can_read('before','member_b','poisoned');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub',(select outsider from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.note('before','outsider','impersonation_ok',
  (select (auth.uid() = (select outsider from fx))::text));
select pg_temp.can_read('before','outsider','photo');
select pg_temp.can_read('before','outsider','variant');
select pg_temp.can_read('before','outsider','foreign_variant');
select pg_temp.can_read('before','outsider','chat_avatar_in');
select pg_temp.can_read('before','outsider','chat_avatar_out');
select pg_temp.can_read('before','outsider','vchat_in');
select pg_temp.can_read('before','outsider','vchat_out');
select pg_temp.can_read('before','outsider','other_avatar');
select pg_temp.can_read('before','outsider','other_vprofile');
select pg_temp.can_read('before','outsider','sidecar');
select pg_temp.can_read('before','outsider','poisoned');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub',(select uploader from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.note('before','uploader','impersonation_ok',
  (select (auth.uid() = (select uploader from fx))::text));
select pg_temp.can_read('before','uploader','photo');
select pg_temp.can_read('before','uploader','variant');
select pg_temp.can_read('before','uploader','foreign_variant');
select pg_temp.can_read('before','uploader','chat_avatar_in');
select pg_temp.can_read('before','uploader','chat_avatar_out');
select pg_temp.can_read('before','uploader','vchat_in');
select pg_temp.can_read('before','uploader','vchat_out');
select pg_temp.can_read('before','uploader','other_avatar');
select pg_temp.can_read('before','uploader','other_vprofile');
select pg_temp.can_read('before','uploader','sidecar');
select pg_temp.can_read('before','uploader','poisoned');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub',(select member_b from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.try_write('before','member_b','insert_into_the_chats_variant_folder', $probe$insert into storage.objects (bucket_id, name) select 'media', 'variants/messages/' || f.chat_id || '/' || f.message_id || '/kub-rehearsal-probe.webp' from pg_temp.fx f$probe$);
select pg_temp.try_write('before','member_b','insert_under_another_accounts_prefix', $probe$insert into storage.objects (bucket_id, name) select 'media', f.uploader || '/kub-rehearsal-probe.bin' from pg_temp.fx f$probe$);
select pg_temp.try_write('before','member_b','insert_into_a_chat_avatar_folder', $probe$insert into storage.objects (bucket_id, name) select 'media', 'chat-avatars/' || (storage.foldername(f.chat_avatar_in))[2] || '/kub-rehearsal-probe.webp' from pg_temp.fx f$probe$);
select pg_temp.try_write('before','member_b','CONTROL_insert_under_own_prefix', $probe$insert into storage.objects (bucket_id, name) select 'media', f.member_b || '/kub-rehearsal-probe.bin' from pg_temp.fx f$probe$);
select pg_temp.count_rows('before','member_b','update_another_accounts_object', $probe$update storage.objects o set user_metadata = '{"kub_rehearsal":true}'::jsonb from pg_temp.fx f where o.bucket_id = 'media' and o.name = f.photo$probe$);
reset role;
delete from storage.objects where bucket_id = 'media' and name like '%kub-rehearsal-probe%';

-- ==================================================================== ====
\echo === applying the migration, spliced verbatim ===
-- D-208, the step the register does not have, and it comes before its step one.
--
-- Written 2026-09-19 from read-only measurements against production, then
-- reviewed, re-measured and revised the same day before it was rehearsed. The
-- revisions are listed under "What the review changed" below.
--
-- ## Why it is needed
--
-- Signing an object requires `select` on `storage.objects`. The `media`
-- bucket's SELECT policy calls `_kub_media_path_allowed`, which admits exactly
-- four things: your own uploads under `{auth.uid()}/`, your own avatar, an
-- administrator reaching another person's avatar, and a chat *administrator*
-- reaching that chat's avatar folder. Nothing else. Measured on production on
-- 2026-09-19, as a real chat member looking at a photograph a different member
-- of the same chat had sent:
--
--     may_select_the_photo             f
--     may_select_its_preview           f
--     uploader_may_select_own_photo    t
--     uploader_may_select_its_preview  f
--
-- and `select count(*) from storage.objects` over those two names, as that
-- member, returned 0 where `postgres` sees 2. The whole `variants/` prefix
-- matches no branch of that function at all — not even for the person who
-- uploaded the original it was made from.
--
-- So what puts other people's photographs on screen today is not the policy. It
-- is the bucket's `public` flag, which is the defect. Until this runs, a client
-- switched to signed URLs would lose every photograph, video, voice message and
-- file anybody else sent, and every generated preview, thumbnail, poster and
-- 720p re-encode including its own.
--
-- ## What it does, and what it deliberately does not
--
-- It adds a *reading* predicate, `_kub_media_read_allowed`, and points only the
-- SELECT policy at it. `_kub_media_path_allowed` keeps INSERT, UPDATE and
-- DELETE and is not touched: who may write to an address and who may read it
-- are different questions, and they have been sharing one answer. Writing stays
-- exactly as narrow as it is today.
--
-- Every branch below is written against the object layout as it actually is,
-- re-counted on production immediately before the apply rather than trusted
-- from the first pass. 778 objects in `media`, up from the 771 the register
-- recorded on 2026-09-15, and three of the shape counts moved:
--
--     {owner_uuid}/{file}                                    306, of which 286
--                                                            name a live or
--                                                            deleted message row
--                                                            and 20 name none
--     avatars/{profile_id}/avatar-{uuid}.{ext}                21, 19 with a uuid
--                                                            second segment
--     chat-avatars/{chat_id}/avatar-{uuid}.{ext}              11, 10 with a uuid
--                                                            second segment
--     bot-avatars/{bot_id}/...                                 0
--     variants/messages/{chat_id}/{message_id}/{kind}.{ext}   412, and 412/412
--                                                            confirmed seg3 is a
--                                                            real chat and seg4 a
--                                                            real message
--     variants/profiles/{profile_id}/{kind}.webp               20, 20/20 confirmed
--     variants/chats/{chat_id}/{token}/{kind}.webp              8,  8/8 confirmed
--
-- Three objects sit one segment short — `avatars/{file}` twice and
-- `chat-avatars/{file}` once, with no id folder at all. They match no branch
-- here and matched none before either, and no `avatar_url` in the product names
-- them: all 17 avatar URLs in use are two-segment, carry a uuid, and their
-- object exists. So they are orphans, and nothing regresses by leaving them
-- unreadable.
--
-- ## The one judgement call in here
--
-- An avatar — a person's, a chat's, a bot's — and a profile's avatar variants
-- are readable by **any authenticated account**, not only by someone who shares
-- a chat. That is a deliberate widening relative to the other branches and a
-- large narrowing relative to today, where they are readable by the entire
-- internet with no account at all. It is what the product already does: an
-- avatar is drawn in global search, in a member list, beside a forwarded
-- message and in a notification, none of which implies a shared chat. Tying it
-- to membership would blank pictures in all four. If that is judged too wide,
-- the branch to tighten is `avatars/` and `variants/profiles/` — and it should
-- be tightened with a measurement of which surfaces go blank, not by argument.
--
-- ## What the review changed, and why
--
-- 1. **A banned account is refused.** `public.messages` and
--    `public.chat_members` each carry a RESTRICTIVE `block banned reads`
--    policy, and this function is SECURITY DEFINER, so it bypasses exactly the
--    rule that says a banned account may not see the conversation whose
--    membership every shared branch below consults. Without the check a banned
--    account would have kept reading every photograph in every chat it had not
--    yet been removed from. The check sits *below* the own-upload branch, so
--    nothing a banned account can read today stops being readable.
--
-- 2. **The sidecar branch no longer matches with LIKE.** `v_stem` comes out of
--    an object name, and 484 of the 778 object names in this bucket contain an
--    underscore, which LIKE reads as a wildcard. `starts_with` has no
--    metacharacters.
--
-- 3. **The predicate is owned by `postgres`, not by `supabase_admin`.** Both
--    work — the body needs only SELECT on two tables and BYPASSRLS, and
--    `postgres` measurably holds all three — but `supabase_admin` is a
--    superuser on this deployment and `postgres` is not. A SECURITY DEFINER
--    function that every authenticated account may execute should run as the
--    smaller role, and `postgres` is what its sibling
--    `_kub_media_path_allowed` already runs as.
--
-- 4. **The self-check proves the write predicate rather than naming it.** It
--    asserted only that a policy called `media authenticated scoped insert`
--    existed; it now asserts that all three write policies still carry
--    `_kub_media_path_allowed`, that the new function is a stable
--    security-definer owned by `postgres`, and that `anon` cannot execute it.
--
-- ## Two things this does not fix, measured and recorded here
--
-- - **The sidecar branch matches nothing on production.** Not one of the 778
--   object names contains `.preview.`; the client writes that address but no
--   object at it has reached this deployment yet. The branch is therefore
--   forward-looking, and the only proof it works is the rehearsal, which
--   inserted such an object inside a transaction it rolled back.
-- - **Ten live messages carry a `media_url` and no `media_path`**, and all ten
--   name an object that exists. This predicate reaches a message's original
--   through `messages.media_path`, so for those ten only the uploader passes.
--   Today the bucket's `public` flag hides that. It means
--   `20260919130000_media_path_backfill_for_legacy_messages.sql` is a
--   **prerequisite for step four**, not the tidy-up the register calls it.
--
-- Rollback: `20260919120000_media_read_policy_admits_a_chat_member.rollback.sql`.

-- [rehearsal] begin; removed: we are already in one

create or replace function public._kub_media_read_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'storage'
as $function$
declare
  v_parts text[] := storage.foldername(p_name);
  v_first text := v_parts[1];
  v_second text := v_parts[2];
  v_third text := v_parts[3];
  v_uid uuid := auth.uid();
  v_suffix text;
  v_stem text;
  -- 8-4-4-4-12. Written out because a migration in this project once shipped
  -- 8-4-4-12 and two branches were unreachable for weeks without anyone
  -- noticing; see `20260905150000_media_path_uuid_pattern_repair.sql`.
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null then
    return false;
  end if;

  -- Whatever this account uploaded itself. Unchanged from the write predicate.
  if v_first = v_uid::text then
    return true;
  end if;

  -- A banned account gets nothing beyond its own uploads. Every branch below
  -- asks `chat_members` or `messages`, both of which carry a RESTRICTIVE
  -- `block banned reads` that this SECURITY DEFINER function would otherwise
  -- bypass. Deliberately below the branch above, so that a ban changes nothing
  -- about what a banned account can read today.
  if public.is_banned(v_uid) then
    return false;
  end if;

  -- A profile picture, and the small versions of one. Readable by any account;
  -- see the note in the header for why this branch is not tied to membership.
  if v_first = 'avatars' and coalesce(v_second, '') ~* v_uuid_re then
    return true;
  end if;
  if v_first = 'variants' and v_second = 'profiles' and coalesce(v_third, '') ~* v_uuid_re then
    return true;
  end if;

  -- A bot's picture. Same reasoning: it is drawn wherever the bot is named.
  if v_first = 'bot-avatars' and coalesce(v_second, '') ~* v_uuid_re then
    return true;
  end if;

  -- A group or channel picture, and its small versions: for its members.
  -- Today only a chat *administrator* passes, which would blank the picture for
  -- everybody else the moment the bucket stops being public.
  if v_first = 'chat-avatars' and coalesce(v_second, '') ~* v_uuid_re then
    return exists (
      select 1 from public.chat_members cm
      where cm.chat_id = v_second::uuid and cm.user_id = v_uid
    );
  end if;
  if v_first = 'variants' and v_second = 'chats' and coalesce(v_third, '') ~* v_uuid_re then
    return exists (
      select 1 from public.chat_members cm
      where cm.chat_id = v_third::uuid and cm.user_id = v_uid
    );
  end if;

  -- A message's generated variants. The path carries the chat and the message,
  -- which is exactly the pair the entry pointed at as the reason the current
  -- state is worse than "somebody needs the URL": those two ids are derivable
  -- by any member, so the address is too. Making membership the *condition*
  -- rather than the leak is the whole of the fix.
  if v_first = 'variants' and v_second = 'messages' and coalesce(v_third, '') ~* v_uuid_re then
    return exists (
      select 1
      from public.chat_members cm
      where cm.chat_id = v_third::uuid and cm.user_id = v_uid
    );
  end if;

  -- A message's own upload. The path is `{uploader}/{file}` and carries no
  -- chat, so the message row is what says which conversation it belongs to.
  -- `idx_messages_media_path` covers this lookup exactly.
  if coalesce(v_first, '') ~* v_uuid_re then
    if exists (
      select 1
      from public.messages m
      join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id = v_uid
      where m.media_bucket = 'media'
        and m.media_path = p_name
        and m.deleted_at is null
    ) then
      return true;
    end if;

    -- The sidecar preview the client uploads beside an original, at the address
    -- a reader derives from the original's own path (`originalPreviewPath`). It
    -- is in no row of its own, so it is admitted through the original it names.
    -- `starts_with` rather than LIKE: the stem is an object name, and 484 of the
    -- names in this bucket contain an underscore, which LIKE reads as a
    -- wildcard and which would widen this branch across a neighbour's file.
    v_suffix := substring(p_name from '\.preview\.(webp|jpg)$');
    if v_suffix is not null then
      v_stem := left(p_name, length(p_name) - length('.preview.') - length(v_suffix));
      return exists (
        select 1
        from public.messages m
        join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id = v_uid
        where m.media_bucket = 'media'
          and m.user_id = v_first::uuid
          and m.deleted_at is null
          and starts_with(m.media_path, v_stem || '.')
      );
    end if;

    return false;
  end if;

  return false;
end
$function$;

alter function public._kub_media_read_allowed(text) owner to postgres;
revoke all on function public._kub_media_read_allowed(text) from public;
-- The grant the bot-avatar migration forgot, which took every upload in the
-- product down for a day. See `20260905140000_bot_avatar_policy_repair.sql`.
grant execute on function public._kub_media_read_allowed(text) to authenticated;

drop policy if exists "media authenticated scoped read" on storage.objects;
create policy "media authenticated scoped read"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and public._kub_media_read_allowed(name));

-- A half-applied state raises rather than committing.
do $check$
declare
  v_has_policy boolean;
  v_exec boolean;
  v_write_policies integer;
begin
  select exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'media authenticated scoped read'
      and qual like '%_kub_media_read_allowed%'
  ) into v_has_policy;
  if not v_has_policy then
    raise exception 'media read policy did not take the new predicate';
  end if;

  select has_function_privilege('authenticated', 'public._kub_media_read_allowed(text)', 'execute')
    into v_exec;
  if not v_exec then
    raise exception 'authenticated cannot execute the read predicate';
  end if;

  if has_function_privilege('anon', 'public._kub_media_read_allowed(text)', 'execute') then
    raise exception 'anon can execute the read predicate';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = '_kub_media_read_allowed'
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.provolatile = 's'
  ) then
    raise exception 'the read predicate is not a stable security-definer owned by postgres';
  end if;

  -- The write predicate must be exactly as narrow as it was: named, and still
  -- pointing at the function it pointed at. Naming it alone proved nothing.
  select count(*) into v_write_policies
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('media authenticated scoped insert',
                       'media authenticated scoped update',
                       'media authenticated scoped delete')
    and coalesce(qual, '') || coalesce(with_check, '') like '%media_path_allowed%';
  if v_write_policies <> 3 then
    raise exception 'the write policies were disturbed: % of 3 still carry the write predicate', v_write_policies;
  end if;
end
$check$;

-- [rehearsal] commit; removed: this transaction is rolled back


\echo === phase: after ===

select set_config('request.jwt.claims',
  json_build_object('sub',(select member_b from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.note('after','member_b','impersonation_ok',
  (select (auth.uid() = (select member_b from fx))::text));
select pg_temp.can_read('after','member_b','photo');
select pg_temp.can_read('after','member_b','variant');
select pg_temp.can_read('after','member_b','foreign_variant');
select pg_temp.can_read('after','member_b','chat_avatar_in');
select pg_temp.can_read('after','member_b','chat_avatar_out');
select pg_temp.can_read('after','member_b','vchat_in');
select pg_temp.can_read('after','member_b','vchat_out');
select pg_temp.can_read('after','member_b','other_avatar');
select pg_temp.can_read('after','member_b','other_vprofile');
select pg_temp.can_read('after','member_b','sidecar');
select pg_temp.can_read('after','member_b','poisoned');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub',(select outsider from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.note('after','outsider','impersonation_ok',
  (select (auth.uid() = (select outsider from fx))::text));
select pg_temp.can_read('after','outsider','photo');
select pg_temp.can_read('after','outsider','variant');
select pg_temp.can_read('after','outsider','foreign_variant');
select pg_temp.can_read('after','outsider','chat_avatar_in');
select pg_temp.can_read('after','outsider','chat_avatar_out');
select pg_temp.can_read('after','outsider','vchat_in');
select pg_temp.can_read('after','outsider','vchat_out');
select pg_temp.can_read('after','outsider','other_avatar');
select pg_temp.can_read('after','outsider','other_vprofile');
select pg_temp.can_read('after','outsider','sidecar');
select pg_temp.can_read('after','outsider','poisoned');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub',(select uploader from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.note('after','uploader','impersonation_ok',
  (select (auth.uid() = (select uploader from fx))::text));
select pg_temp.can_read('after','uploader','photo');
select pg_temp.can_read('after','uploader','variant');
select pg_temp.can_read('after','uploader','foreign_variant');
select pg_temp.can_read('after','uploader','chat_avatar_in');
select pg_temp.can_read('after','uploader','chat_avatar_out');
select pg_temp.can_read('after','uploader','vchat_in');
select pg_temp.can_read('after','uploader','vchat_out');
select pg_temp.can_read('after','uploader','other_avatar');
select pg_temp.can_read('after','uploader','other_vprofile');
select pg_temp.can_read('after','uploader','sidecar');
select pg_temp.can_read('after','uploader','poisoned');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub',(select member_b from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.try_write('after','member_b','insert_into_the_chats_variant_folder', $probe$insert into storage.objects (bucket_id, name) select 'media', 'variants/messages/' || f.chat_id || '/' || f.message_id || '/kub-rehearsal-probe.webp' from pg_temp.fx f$probe$);
select pg_temp.try_write('after','member_b','insert_under_another_accounts_prefix', $probe$insert into storage.objects (bucket_id, name) select 'media', f.uploader || '/kub-rehearsal-probe.bin' from pg_temp.fx f$probe$);
select pg_temp.try_write('after','member_b','insert_into_a_chat_avatar_folder', $probe$insert into storage.objects (bucket_id, name) select 'media', 'chat-avatars/' || (storage.foldername(f.chat_avatar_in))[2] || '/kub-rehearsal-probe.webp' from pg_temp.fx f$probe$);
select pg_temp.try_write('after','member_b','CONTROL_insert_under_own_prefix', $probe$insert into storage.objects (bucket_id, name) select 'media', f.member_b || '/kub-rehearsal-probe.bin' from pg_temp.fx f$probe$);
select pg_temp.count_rows('after','member_b','update_another_accounts_object', $probe$update storage.objects o set user_metadata = '{"kub_rehearsal":true}'::jsonb from pg_temp.fx f where o.bucket_id = 'media' and o.name = f.photo$probe$);
reset role;
delete from storage.objects where bucket_id = 'media' and name like '%kub-rehearsal-probe%';

-- --------------------------------------------- the one mutation that matters
-- The sidecar branch changed from LIKE to starts_with. Both forms evaluated
-- against the poisoned name, with RLS bypassed exactly as the SECURITY DEFINER
-- predicate bypasses it.
select
  exists (select 1 from public.messages m
            join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id = (select member_b from fx)
           where m.media_bucket='media' and m.user_id = (select uploader from fx) and m.deleted_at is null
             and m.media_path like (select left(poisoned, length(poisoned) - length('.preview.webp')) from fx) || '.%'
         ) as like_would_admit_the_poisoned_name,
  exists (select 1 from public.messages m
            join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id = (select member_b from fx)
           where m.media_bucket='media' and m.user_id = (select uploader from fx) and m.deleted_at is null
             and starts_with(m.media_path, (select left(poisoned, length(poisoned) - length('.preview.webp')) from fx) || '.')
         ) as starts_with_admits_the_poisoned_name;

-- ------------------------------------------------------------ a ban, then --
\echo === a ban on member_b, and the same reads again ===
-- `enforce_sanction_matrix` reads auth.uid() and refuses a sanction against
-- oneself, and the claims are still whoever the last read block impersonated.
-- Clearing them puts the trigger on its "service role / SQL session" path.
select set_config('request.jwt.claims', '', true) = '' as claims_cleared;
insert into public.bans (user_id, reason, issued_by)
select member_b, 'kub rehearsal, rolled back', null from fx;

select set_config('request.jwt.claims',
  json_build_object('sub',(select member_b from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.note('after+ban','member_b','is_banned', (select public.is_banned((select member_b from fx))::text));
select pg_temp.can_read('after+ban','member_b','photo');
select pg_temp.can_read('after+ban','member_b','variant');
select pg_temp.can_read('after+ban','member_b','chat_avatar_in');
select pg_temp.can_read('after+ban','member_b','other_avatar');
select pg_temp.can_read('after+ban','member_b','sidecar');
reset role;

\echo === and the uploader, banned, still reaches its own upload ===
select set_config('request.jwt.claims', '', true) = '' as claims_cleared;
insert into public.bans (user_id, reason, issued_by)
select uploader, 'kub rehearsal, rolled back', null from fx;
select set_config('request.jwt.claims',
  json_build_object('sub',(select uploader from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.note('after+ban','uploader','is_banned', (select public.is_banned((select uploader from fx))::text));
select pg_temp.can_read('after+ban','uploader','photo');
select pg_temp.can_read('after+ban','uploader','variant');
reset role;

select set_config('request.jwt.claims', '', true) = '' as claims_cleared;
delete from public.bans where reason = 'kub rehearsal, rolled back';

-- ----------------------------------------------------------- the rollback --
\echo === running the rollback, spliced verbatim ===
-- Rollback for `20260919120000_media_read_policy_admits_a_chat_member.sql`.
--
-- Puts the SELECT policy back on the write predicate, which is where it was
-- before. Safe only while the bucket is still public: with a private bucket
-- this narrows reading back to "your own uploads and your own avatar", which
-- takes every other picture in the product off the screen. If the bucket has
-- already been made private, make it public again FIRST and verify a picture
-- somebody else sent still loads, then run this.
--
-- Run it as `supabase_admin`, the same role the migration needs. `storage.objects`
-- is owned by `supabase_storage_admin` and `postgres` is not a member of that
-- role (`pg_has_role` answers false here), so `postgres` cannot drop or create
-- a policy on it, and cannot drop a function owned by `postgres` either while
-- the policy still names it. Measured on production 2026-09-19.
--
-- Rehearsed: run verbatim inside the migration's own rehearsal transaction,
-- after the migration, and the pre-migration measurements were then taken
-- again and matched.

-- [rehearsal] begin; removed: we are already in one

drop policy if exists "media authenticated scoped read" on storage.objects;
create policy "media authenticated scoped read"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and public._kub_media_path_allowed(name));

drop function if exists public._kub_media_read_allowed(text);

do $check$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'media authenticated scoped read'
      and qual like '%_kub_media_path_allowed%'
  ) then
    raise exception 'the read policy was not restored';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_kub_media_read_allowed'
  ) then
    raise exception 'the read predicate is still there';
  end if;

  -- The write policies are not this file's business, and must be untouched.
  if (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('media authenticated scoped insert',
                         'media authenticated scoped update',
                         'media authenticated scoped delete')
      and coalesce(qual, '') || coalesce(with_check, '') like '%media_path_allowed%'
  ) <> 3 then
    raise exception 'the write policies were disturbed';
  end if;
end
$check$;

-- [rehearsal] commit; removed: this transaction is rolled back


\echo === phase: rolled-back ===

select set_config('request.jwt.claims',
  json_build_object('sub',(select member_b from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.note('rolled-back','member_b','impersonation_ok',
  (select (auth.uid() = (select member_b from fx))::text));
select pg_temp.can_read('rolled-back','member_b','photo');
select pg_temp.can_read('rolled-back','member_b','variant');
select pg_temp.can_read('rolled-back','member_b','foreign_variant');
select pg_temp.can_read('rolled-back','member_b','chat_avatar_in');
select pg_temp.can_read('rolled-back','member_b','chat_avatar_out');
select pg_temp.can_read('rolled-back','member_b','vchat_in');
select pg_temp.can_read('rolled-back','member_b','vchat_out');
select pg_temp.can_read('rolled-back','member_b','other_avatar');
select pg_temp.can_read('rolled-back','member_b','other_vprofile');
select pg_temp.can_read('rolled-back','member_b','sidecar');
select pg_temp.can_read('rolled-back','member_b','poisoned');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub',(select outsider from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.note('rolled-back','outsider','impersonation_ok',
  (select (auth.uid() = (select outsider from fx))::text));
select pg_temp.can_read('rolled-back','outsider','photo');
select pg_temp.can_read('rolled-back','outsider','variant');
select pg_temp.can_read('rolled-back','outsider','foreign_variant');
select pg_temp.can_read('rolled-back','outsider','chat_avatar_in');
select pg_temp.can_read('rolled-back','outsider','chat_avatar_out');
select pg_temp.can_read('rolled-back','outsider','vchat_in');
select pg_temp.can_read('rolled-back','outsider','vchat_out');
select pg_temp.can_read('rolled-back','outsider','other_avatar');
select pg_temp.can_read('rolled-back','outsider','other_vprofile');
select pg_temp.can_read('rolled-back','outsider','sidecar');
select pg_temp.can_read('rolled-back','outsider','poisoned');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub',(select uploader from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.note('rolled-back','uploader','impersonation_ok',
  (select (auth.uid() = (select uploader from fx))::text));
select pg_temp.can_read('rolled-back','uploader','photo');
select pg_temp.can_read('rolled-back','uploader','variant');
select pg_temp.can_read('rolled-back','uploader','foreign_variant');
select pg_temp.can_read('rolled-back','uploader','chat_avatar_in');
select pg_temp.can_read('rolled-back','uploader','chat_avatar_out');
select pg_temp.can_read('rolled-back','uploader','vchat_in');
select pg_temp.can_read('rolled-back','uploader','vchat_out');
select pg_temp.can_read('rolled-back','uploader','other_avatar');
select pg_temp.can_read('rolled-back','uploader','other_vprofile');
select pg_temp.can_read('rolled-back','uploader','sidecar');
select pg_temp.can_read('rolled-back','uploader','poisoned');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub',(select member_b from fx),'role','authenticated')::text, true) is not null as ok;
set local role authenticated;
select pg_temp.try_write('rolled-back','member_b','insert_into_the_chats_variant_folder', $probe$insert into storage.objects (bucket_id, name) select 'media', 'variants/messages/' || f.chat_id || '/' || f.message_id || '/kub-rehearsal-probe.webp' from pg_temp.fx f$probe$);
select pg_temp.try_write('rolled-back','member_b','insert_under_another_accounts_prefix', $probe$insert into storage.objects (bucket_id, name) select 'media', f.uploader || '/kub-rehearsal-probe.bin' from pg_temp.fx f$probe$);
select pg_temp.try_write('rolled-back','member_b','insert_into_a_chat_avatar_folder', $probe$insert into storage.objects (bucket_id, name) select 'media', 'chat-avatars/' || (storage.foldername(f.chat_avatar_in))[2] || '/kub-rehearsal-probe.webp' from pg_temp.fx f$probe$);
select pg_temp.try_write('rolled-back','member_b','CONTROL_insert_under_own_prefix', $probe$insert into storage.objects (bucket_id, name) select 'media', f.member_b || '/kub-rehearsal-probe.bin' from pg_temp.fx f$probe$);
select pg_temp.count_rows('rolled-back','member_b','update_another_accounts_object', $probe$update storage.objects o set user_metadata = '{"kub_rehearsal":true}'::jsonb from pg_temp.fx f where o.bucket_id = 'media' and o.name = f.photo$probe$);
reset role;
delete from storage.objects where bucket_id = 'media' and name like '%kub-rehearsal-probe%';

-- ------------------------------------------------------------- the report --
\echo === reads: one row per object shape, one column per phase ===
select label,
  max(value) filter (where phase='before'      and who='member_b') as before_member,
  max(value) filter (where phase='after'       and who='member_b') as after_member,
  max(value) filter (where phase='rolled-back' and who='member_b') as back_member,
  max(value) filter (where phase='before'      and who='outsider') as before_outsider,
  max(value) filter (where phase='after'       and who='outsider') as after_outsider,
  max(value) filter (where phase='before'      and who='uploader') as before_uploader,
  max(value) filter (where phase='after'       and who='uploader') as after_uploader
from res
where label not like '%insert%' and label not like '%update%' and label <> 'impersonation_ok'
group by label, (select min(ord) from res r2 where r2.label = res.label)
order by (select min(ord) from res r2 where r2.label = res.label);

\echo === banned member_b, and the banned uploader ===
select who, label, value from res where phase = 'after+ban' order by ord;

\echo === writes as member_b: unchanged is the whole point ===
select label,
  max(value) filter (where phase='before')      as before,
  max(value) filter (where phase='after')       as after,
  max(value) filter (where phase='rolled-back') as rolled_back
from res
where label like '%insert%' or label like '%update%'
group by label, (select min(ord) from res r2 where r2.label = res.label)
order by (select min(ord) from res r2 where r2.label = res.label);

\echo === impersonation was real in every phase ===
select phase, who, value from res where label = 'impersonation_ok' order by ord;

\echo === nothing of ours is left in place before the rollback of the transaction ===
select 'probe objects still present' as k, count(*)::text as v from storage.objects
  where bucket_id='media' and name like '%kub-rehearsal-probe%'
union all select 'rehearsal bans still present', (select count(*)::text from public.bans where reason = 'kub rehearsal, rolled back');

rollback;
