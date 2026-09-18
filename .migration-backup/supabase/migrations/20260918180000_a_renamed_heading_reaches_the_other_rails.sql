/**
 * The channel headings were never published, so nobody else ever saw one change.
 *
 * `useServerChannels` opens three Realtime bindings for a group's channel rail
 * — `voice_channels`, `chat_channel_categories` and one per room on
 * `voice_participants`. Two of those tables are in the `supabase_realtime`
 * publication. The third never was.
 *
 * MEASURED on 2026-09-18, read-only, as `postgres`:
 *
 *     select tablename, exists (select 1 from pg_publication_tables p
 *              where p.pubname = 'supabase_realtime'
 *                and p.schemaname = 'public' and p.tablename = t.tablename) …
 *
 *     chat_channel_categories | f | d   <- not published, replica identity default
 *     voice_channels          | t | d
 *     voice_participants      | t | f
 *     topics                  | t | d
 *
 * `20260914140000_channel_categories.sql` created the table, granted it, gave it
 * six policies and two foreign keys, and never added it to the publication.
 * `20260913150000_voice_channels.sql`, the day before, had a `do $publish$`
 * block for exactly this and a self-check that counted the membership; the
 * categories file carried neither. So the binding has delivered nothing since
 * the day it was written, for any event, to anybody.
 *
 * ── What a person experiences ────────────────────────────────────────────────
 *
 * An administrator renames «Голос» to «Переговорные» in «Каналы». On their own
 * screen it changes, because `useChannelAdmin` writes its own held list. On
 * every other member's screen the old heading stays until they reload the
 * application or reopen the group. The same for a heading added, deleted, or
 * dragged into a new order: the writer sees it, nobody else does, and nothing
 * anywhere says so.
 *
 * **Moving a room between headings already works**, and that is worth stating
 * because it is why the defect is easy to miss. That write lands on
 * `voice_channels.category_id`, `voice_channels` is published, and its own
 * binding fires. So a tester dragging a room sees the rail update on the other
 * device and concludes the rail is live. It is the headings themselves that are
 * not.
 *
 * ── Why it is contained, and why that is not luck ────────────────────────────
 *
 * On 2026-09-05 one unpublished table killed every other binding on its channel
 * while still reporting SUBSCRIBED, and the sidebar stopped moving.
 * `lib/realtimeTableChannels.ts` answered that with one channel per table, and
 * `useServerChannels` uses it. So this unpublished binding sits alone on
 * `server-channels:<chatId>:chat_channel_categories` and takes nothing down
 * with it. The rooms and the participant lists are live. That rule is the only
 * reason this is a missing feature rather than a second outage.
 *
 * Nothing warns anybody either. `realtime.subscription_check_filters` — the
 * trigger that validates a new subscription — checks that the filter column
 * exists and that the claims role may SELECT it. It does not look at the
 * publication. The subscribe succeeds, the channel reports SUBSCRIBED, and the
 * silence is indistinguishable from a group whose headings nobody has touched.
 *
 * ── Two halves, because publishing the table is not the whole fix ────────────
 *
 * The binding is `filter: chat_id=eq.<chatId>`, and `removeCategory` issues a
 * real DELETE — the only one among the ten mutators of `useChannelAdmin` that
 * is not an INSERT or an UPDATE. Under REPLICA IDENTITY DEFAULT the old tuple carries only the
 * primary key, so a DELETE arrives at the filter with no `chat_id` in it.
 *
 * This is not reasoned from the documentation. `realtime.is_visible_through_filters`
 * lives in this database, is IMMUTABLE and pure, and can therefore be asked
 * directly. Measured on production, read-only, before this file was written:
 *
 *     old tuple [chat_id, id] against filter chat_id=eq.<that chat>   -> t
 *     old tuple [id]          against filter chat_id=eq.<that chat>   -> NULL
 *     old tuple [chat_id, id] against filter chat_id=eq.<other chat>  -> f
 *
 * The middle row is the current state. The function inner-joins its filters
 * against the columns it was given, so a filter naming a column that is not
 * there aggregates over no rows, `bool_and` returns NULL, and `apply_rls` —
 * which uses the result in a `where` — treats NULL as not visible. The third
 * row is the control: with the whole old tuple available the filter still
 * refuses another group's category, so FULL widens the payload without
 * widening who receives it.
 *
 * Hence both statements below. Publishing alone would leave a deleted heading
 * lingering on every other rail — the worse half of the defect, because a
 * stale name is merely wrong while a heading that still lists rooms that have
 * moved out of it is confusing.
 *
 * ── The alternative that was rejected ───────────────────────────────────────
 *
 * `chat_channel_categories_chat_id_id_key UNIQUE (chat_id, id)` already exists
 * — the categories migration created it so the composite foreign key could
 * reference it — and `replica identity using index` on it would put exactly
 * `chat_id` and `id` in the old tuple, which is all the filter needs, at a
 * fraction of FULL's WAL.
 *
 * It was rejected for one reason: the replica identity would then depend on an
 * index kept for a different purpose, and PostgreSQL treats a dropped replica
 * identity index as REPLICA IDENTITY NOTHING **silently**. That is a rule
 * living where nobody would look for it, and this project has already paid for
 * two of those. Every one of the seven tables in this deployment with a
 * non-default replica identity uses plain FULL. The cost of following them is
 * one extra old row in the WAL per heading rename, on a table that holds
 * headings.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 *
 * It is not a policy change, a grant change, or a change to what the rail
 * reads. The six policies on `chat_channel_categories` are untouched, and they
 * are what decides who receives an event: `apply_rls` runs the table's SELECT
 * policy as the subscriber for INSERT and UPDATE, so publishing the table
 * exposes a heading to exactly the members who could already read it. A DELETE
 * cannot be secured that way — `apply_rls` says so in its own comment — and
 * trims the payload to the primary key, which is all the handler needs, since
 * the handler is `refresh`.
 *
 * It does not touch `voice_channels`, `voice_participants` or `topics`.
 *
 * **And it deliberately does not fix `chat_members`, which measured the same
 * way.** `chat_members` is published with replica identity DEFAULT, and
 * `useChats` binds its DELETE with `filter: user_id=eq.<userId>` — so by the
 * mechanism proved above that DELETE cannot match either, and
 * `docs/SUPABASE_CURRENT_STATE.md:117` claims the table is FULL when production
 * says `d`. That is a second finding with a second blast radius and a second
 * set of interface paths that might already cover it. It gets its own
 * measurement and its own file, not a line in this one.
 *
 * ── Applying ────────────────────────────────────────────────────────────────
 *
 * **As `postgres`, and this one really is `postgres`.** Verified rather than
 * assumed, because the two migrations immediately before this one had to run as
 * `supabase_admin` and the schema is no guide:
 *
 *     publication supabase_realtime        | postgres
 *     table public.chat_channel_categories | postgres
 *     table public.voice_channels          | supabase_admin
 *     table public.voice_participants      | supabase_admin
 *
 * `ALTER PUBLICATION … ADD TABLE` requires ownership of the publication and of
 * the table; `ALTER TABLE … REPLICA IDENTITY` requires ownership of the table.
 * `postgres` owns all three objects here — the categories migration ended with
 * `alter table public.chat_channel_categories owner to postgres` on purpose, so
 * that it would match `topics` and `chats` rather than `voice_channels`.
 * `supabase_admin` would also succeed, being superuser and a member of
 * `postgres`; `postgres` is not a member of `supabase_admin`
 * (`pg_has_role('postgres','supabase_admin','MEMBER')` is false), which is the
 * asymmetry that cost the last two migrations a round trip.
 *
 * **Locks.** `ALTER PUBLICATION … ADD TABLE` opens the table in
 * ShareUpdateExclusiveLock (`OpenTableList` in `publicationcmds.c`: «The
 * returned tables are locked in ShareUpdateExclusiveLock mode in order to add
 * them to a publication»), which does not conflict with SELECT, INSERT, UPDATE
 * or DELETE — reads and writes to the rail continue throughout. `ALTER TABLE …
 * REPLICA IDENTITY` is not among the reduced-lock forms and therefore takes
 * ACCESS EXCLUSIVE, but it is a catalog-only write to `pg_class.relreplident`:
 * no rewrite, no index build. The self-check proves the no-rewrite claim by
 * comparing `pg_relation_filenode` across the statement rather than asserting
 * it, and `lock_timeout = '5s'` bounds the wait so a blocked acquisition rolls
 * the whole transaction back instead of queueing traffic behind it. Measured
 * before writing this: the table holds 0 rows in 65,536 bytes and nothing held
 * a lock on it.
 *
 * **No Realtime restart, and no slot work.** `realtime.list_changes` rebuilds
 * its `add-tables` argument from `pg_publication_tables` on every single poll —
 * the publication is a parameter of the read, not state baked into the slot —
 * so the next poll after commit carries the table. Read off the deployed
 * function, not assumed.
 *
 * **Additive and idempotent.** Both statements are guarded on the state they
 * establish, so a second application does no DDL at all and takes no lock
 * beyond the read.
 *
 * Rollback: 20260918180000_a_renamed_heading_reaches_the_other_rails.rollback.sql.
 * Run that as `postgres` too. It costs nothing but the same two locks and
 * returns the rail to silence.
 */

begin;

set local lock_timeout = '5s';

/**
 * The two guarded statements, together with the proof that the second of them
 * did not rewrite the table. The filenode has to be read before the ALTER, so
 * that one check lives here rather than in the contract block below.
 */
do $apply$
declare
  v_filenode_before oid;
  v_filenode_after oid;
begin
  if pg_catalog.to_regclass('public.chat_channel_categories') is null then
    raise exception
      'public.chat_channel_categories does not exist, so 20260914140000 has not been applied here';
  end if;

  select pg_catalog.pg_relation_filenode('public.chat_channel_categories'::regclass)
    into v_filenode_before;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'chat_channel_categories'
  ) then
    alter publication supabase_realtime add table public.chat_channel_categories;
    raise notice 'published public.chat_channel_categories';
  else
    raise notice 'public.chat_channel_categories was already published';
  end if;

  -- The DELETE half. Guarded so that a second application takes no ACCESS
  -- EXCLUSIVE lock at all.
  if (
    select relreplident from pg_catalog.pg_class
     where oid = 'public.chat_channel_categories'::regclass
  ) <> 'f' then
    alter table public.chat_channel_categories replica identity full;
    raise notice 'replica identity full, so a deleted heading carries its chat_id';
  else
    raise notice 'replica identity was already full';
  end if;

  select pg_catalog.pg_relation_filenode('public.chat_channel_categories'::regclass)
    into v_filenode_after;
  if v_filenode_after <> v_filenode_before then
    raise exception
      'the replica identity change rewrote the table (filenode % -> %); this migration is documented as catalog-only and that claim is now false',
      v_filenode_before, v_filenode_after;
  end if;
end
$apply$;

comment on table public.chat_channel_categories is
  'Collapsible headings for a group''s channel rail. In supabase_realtime with '
  'replica identity full: the rail''s binding filters on chat_id, and only FULL '
  'puts chat_id into a deleted row''s old tuple.';

/**
 * The contract, which raises rather than committing half of it.
 *
 * The three `is_visible_through_filters` calls are the behavioural part. They
 * ask this deployment's own filter function what it would decide about a
 * DELETE whose old tuple is shaped the way this migration makes it, the way it
 * was shaped before, and the way another group's would be. A source scan of
 * `relreplident` alone would pass on a Realtime that had changed how it filters.
 */
do $check$
declare
  v_published boolean;
  v_replident "char";
  v_full_matches boolean;
  v_default_matches boolean;
  v_other_chat_matches boolean;
  v_chat_id_readable boolean;
  v_select_policies integer;
  v_restrictive integer;
  v_uuid oid = 'uuid'::regtype::oid;
begin
  select exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'chat_channel_categories'
  ) into v_published;
  if not v_published then
    raise exception
      'chat_channel_categories is still outside supabase_realtime, so the rail''s heading binding still delivers nothing';
  end if;

  select relreplident into v_replident
    from pg_catalog.pg_class where oid = 'public.chat_channel_categories'::regclass;
  if v_replident <> 'f' then
    raise exception
      'replica identity is % rather than f, so a deleted heading would still arrive without its chat_id',
      v_replident;
  end if;

  -- The old tuple this migration produces: every column, so chat_id is there.
  select realtime.is_visible_through_filters(
      array[
        row('chat_id', 'uuid', v_uuid,
            pg_catalog.to_jsonb('11111111-1111-1111-1111-111111111111'::uuid), false, true)::realtime.wal_column,
        row('id', 'uuid', v_uuid,
            pg_catalog.to_jsonb('22222222-2222-2222-2222-222222222222'::uuid), true, true)::realtime.wal_column
      ],
      array[row('chat_id', 'eq', '11111111-1111-1111-1111-111111111111')::realtime.user_defined_filter]
    ) into v_full_matches;

  -- The old tuple before it: the primary key alone, which is what DEFAULT logs.
  select realtime.is_visible_through_filters(
      array[
        row('id', 'uuid', v_uuid,
            pg_catalog.to_jsonb('22222222-2222-2222-2222-222222222222'::uuid), true, true)::realtime.wal_column
      ],
      array[row('chat_id', 'eq', '11111111-1111-1111-1111-111111111111')::realtime.user_defined_filter]
    ) into v_default_matches;

  -- The control: another group's heading must still be refused.
  select realtime.is_visible_through_filters(
      array[
        row('chat_id', 'uuid', v_uuid,
            pg_catalog.to_jsonb('33333333-3333-3333-3333-333333333333'::uuid), false, true)::realtime.wal_column,
        row('id', 'uuid', v_uuid,
            pg_catalog.to_jsonb('22222222-2222-2222-2222-222222222222'::uuid), true, true)::realtime.wal_column
      ],
      array[row('chat_id', 'eq', '11111111-1111-1111-1111-111111111111')::realtime.user_defined_filter]
    ) into v_other_chat_matches;

  if v_full_matches is not true then
    raise exception
      'the whole old tuple still does not satisfy a chat_id filter (got %), so a deleted heading will not reach the rail',
      coalesce(v_full_matches::text, 'null');
  end if;
  if v_default_matches is true then
    raise exception
      'a primary-key-only old tuple now satisfies a chat_id filter, so this migration''s reason no longer holds and the replica identity change is unnecessary';
  end if;
  if v_other_chat_matches is not false then
    raise exception
      'another group''s heading would now reach this rail (got %), so the full old tuple has widened the audience',
      coalesce(v_other_chat_matches::text, 'null');
  end if;

  -- apply_rls builds the payload from columns the subscriber may SELECT, and
  -- subscription_check_filters refuses a filter on a column it may not.
  select pg_catalog.has_column_privilege('authenticated', 'public.chat_channel_categories', 'chat_id', 'SELECT')
    into v_chat_id_readable;
  if not v_chat_id_readable then
    raise exception
      'authenticated cannot SELECT chat_id, so the rail''s filter would be refused at subscribe time';
  end if;

  -- Publishing a table must not change who may read it. These are the gates
  -- apply_rls runs as the subscriber for INSERT and UPDATE.
  if not (
    select relrowsecurity from pg_catalog.pg_class
     where oid = 'public.chat_channel_categories'::regclass
  ) then
    raise exception 'row level security is off on chat_channel_categories, so publishing it exposes every heading';
  end if;

  select pg_catalog.count(*) into v_select_policies
    from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'chat_channel_categories'
     and permissive = 'PERMISSIVE' and cmd in ('SELECT', 'ALL');
  if v_select_policies < 1 then
    raise exception 'no permissive read policy is left on chat_channel_categories';
  end if;

  select pg_catalog.count(*) into v_restrictive
    from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'chat_channel_categories'
     and permissive = 'RESTRICTIVE';
  if v_restrictive <> 4 then
    raise exception 'expected the four restrictive banned-user guards, found %', v_restrictive;
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.chat_channel_categories', 'select') then
    raise exception 'anon can read chat_channel_categories, which publishing it would now broadcast';
  end if;

  raise notice 'a heading added, renamed, reordered or deleted now reaches every other member''s rail';
end
$check$;

commit;
