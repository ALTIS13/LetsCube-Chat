/**
 * Rollback for 20260918180000_a_renamed_heading_reaches_the_other_rails.sql.
 *
 * Returns `public.chat_channel_categories` to the exact state measured on
 * 2026-09-18: outside the `supabase_realtime` publication, replica identity
 * DEFAULT, no table comment.
 *
 * **What comes back with it.** The silence. `useServerChannels` keeps its
 * binding on `chat_channel_categories`, `realtime.subscription_check_filters`
 * keeps accepting it, the channel keeps reporting SUBSCRIBED, and nothing is
 * ever delivered on it again — so a heading added, renamed, reordered or
 * deleted by one administrator stays invisible to every other member until
 * they reload. Moving a room between headings keeps working, because that write
 * lands on `voice_channels`, which is published; that asymmetry is exactly what
 * made the defect hard to see the first time.
 *
 * Nothing is lost. No row is touched by either direction, the six policies and
 * both foreign keys are untouched, and the channel rail reads the same rows
 * before and after.
 *
 * **Run as `postgres`.** Same reason as the forward file, verified the same
 * way: `postgres` owns both the publication `supabase_realtime` and the table.
 * Not `supabase_admin` — that would also work, being superuser, but the two
 * voice migrations immediately before this pair needed `supabase_admin` for
 * `voice_channels`, and the difference is worth keeping straight rather than
 * carrying over by habit.
 *
 * **Locks and cost.** `ALTER PUBLICATION … DROP TABLE` opens the table in
 * ShareUpdateExclusiveLock, which does not conflict with SELECT, INSERT, UPDATE
 * or DELETE. `ALTER TABLE … REPLICA IDENTITY DEFAULT` takes ACCESS EXCLUSIVE
 * and is a catalog-only write to `pg_class.relreplident`; the check below proves
 * that by filenode rather than asserting it. `lock_timeout = '5s'` bounds the
 * wait. No slot work and no Realtime restart: `realtime.list_changes` rebuilds
 * its `add-tables` argument from `pg_publication_tables` on every poll, so the
 * next poll after commit simply stops including the table.
 *
 * Both statements are guarded on the state they establish, so running this
 * twice does no DDL at all.
 */

begin;

set local lock_timeout = '5s';

do $revert$
declare
  v_filenode_before oid;
  v_filenode_after oid;
begin
  if pg_catalog.to_regclass('public.chat_channel_categories') is null then
    raise exception 'public.chat_channel_categories does not exist, so there is nothing to roll back';
  end if;

  select pg_catalog.pg_relation_filenode('public.chat_channel_categories'::regclass)
    into v_filenode_before;

  if exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'chat_channel_categories'
  ) then
    alter publication supabase_realtime drop table public.chat_channel_categories;
    raise notice 'unpublished public.chat_channel_categories';
  else
    raise notice 'public.chat_channel_categories was already outside the publication';
  end if;

  if (
    select relreplident from pg_catalog.pg_class
     where oid = 'public.chat_channel_categories'::regclass
  ) <> 'd' then
    alter table public.chat_channel_categories replica identity default;
    raise notice 'replica identity back to default';
  else
    raise notice 'replica identity was already default';
  end if;

  select pg_catalog.pg_relation_filenode('public.chat_channel_categories'::regclass)
    into v_filenode_after;
  if v_filenode_after <> v_filenode_before then
    raise exception
      'the replica identity change rewrote the table (filenode % -> %), which neither direction of this pair is supposed to do',
      v_filenode_before, v_filenode_after;
  end if;
end
$revert$;

-- The table carried no comment before the forward migration; measured
-- 2026-09-18 with obj_description, which returned null.
comment on table public.chat_channel_categories is null;

do $check$
declare
  v_published boolean;
  v_replident "char";
  v_comment text;
  v_restrictive integer;
begin
  select exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'chat_channel_categories'
  ) into v_published;
  if v_published then
    raise exception 'chat_channel_categories is still published, so the rollback did not take';
  end if;

  select relreplident into v_replident
    from pg_catalog.pg_class where oid = 'public.chat_channel_categories'::regclass;
  if v_replident <> 'd' then
    raise exception 'replica identity is % rather than d, so the table is not back to the measured state', v_replident;
  end if;

  select pg_catalog.obj_description('public.chat_channel_categories'::regclass, 'pg_class')
    into v_comment;
  if v_comment is not null then
    raise exception 'a table comment survived the rollback: %', v_comment;
  end if;

  -- Neither direction of this pair may touch the gates, so both directions say so.
  if not (
    select relrowsecurity from pg_catalog.pg_class
     where oid = 'public.chat_channel_categories'::regclass
  ) then
    raise exception 'row level security is off on chat_channel_categories, which this rollback did not do and must not leave';
  end if;

  select pg_catalog.count(*) into v_restrictive
    from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'chat_channel_categories'
     and permissive = 'RESTRICTIVE';
  if v_restrictive <> 4 then
    raise exception 'expected the four restrictive banned-user guards, found %', v_restrictive;
  end if;

  raise notice 'the headings are unpublished again, and a renamed heading reaches nobody but its author';
end
$check$;

commit;
