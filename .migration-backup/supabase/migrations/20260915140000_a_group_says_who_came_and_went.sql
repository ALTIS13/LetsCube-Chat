/**
 * A group finally says who joined and who left.
 *
 * D-166. Every membership change has been recorded per chat since May 2026 —
 * `audit_logs` holds 69 `chat_member_added`, 103 `chat_member_removed` and 12
 * `chat_member_role_changed`, all with `target_kind = 'chat'` and
 * `target_id = chat_id` — and no chat could show a line of it. The only reader
 * is the global administration panel, and it filters by actor, action and date,
 * never by `target_id`.
 *
 * ## Why not simply let a member read `audit_logs`
 *
 * Because it is the wrong table for this. Measured on production on 2026-09-15:
 * the live policy is `audit_logs select by permission`
 * (`has_permission(auth.uid(), 'audit.view')`), held by 5 of 18 people, and a
 * read as an ordinary member of a chat — inside a rolled-back transaction, with
 * `auth.uid()` confirmed and `is_chat_member` true — returned 0 of the 1 row
 * that exists for that chat and 0 of the whole table. Opening it would hand a
 * group's members a slice of a **global** audit table, and Telegram and Discord
 * both show these lines to everybody in the room rather than to owners.
 *
 * ## The channel that was already built for this and never used
 *
 * `messages.type` accepts `'system'`; `messages_sender_shape_check` *requires*
 * such a row to carry `user_id IS NULL` and `bot_id IS NULL`; and
 * `private.enforce_message_sender_on_insert` has a branch for exactly that
 * shape. `enqueue_message_notifications` returns null on the first line for a
 * system message, so none of this pushes a notification. And the client already
 * draws it: `resolveMessageActor` returns `{ kind: "system" }`, `MessageList`
 * routes on `type === "system"` before it touches a sender, and
 * `SystemMessageNotice` renders it centred as a quiet pill with no bubble and no
 * avatar. Three such rows exist in production, all from May 2026, and nothing
 * has written one since.
 *
 * **No client can write one**, which is why this is a trigger. The only
 * permissive INSERT policy on `messages` is
 * `auth.uid() = user_id AND bot_id IS NULL AND is_chat_member(chat_id)`, and
 * `auth.uid() = NULL` is never true.
 *
 * ## What it deliberately does not do
 *
 * **Role changes write no line.** Neither Telegram nor Discord puts «X made Y an
 * administrator» in the conversation; both keep it in an admin log, which is
 * where `chat_member_role_changed` already is. Emitting one would also produce
 * two lines for a single ownership handover (D-150 moves two rows), which is
 * noise rather than news.
 *
 * **Private chats write no line**, so the 27 private chats and every bot chat —
 * `open_or_create_bot_chat` makes a `private` one — are untouched.
 *
 * **The group's own creation writes no line.** `trg_add_chat_creator_as_owner`
 * inserts the creator's membership as the chat is made; that is the group being
 * created, not somebody joining it. The guard is that the row is the chat's
 * first, which needs no timestamp arithmetic.
 *
 * **A vanishing chat writes no line.** Deleting a chat cascades into
 * `chat_members`, and an AFTER DELETE that inserted a message would reference a
 * chat that is already gone. The chat is looked up first and `is distinct from`
 * is used rather than `<>`, because `NULL <> 'group'` is NULL and would fall
 * through.
 *
 * ## The actor is not always known
 *
 * `auth.uid()` is null for service-role and SQL work, and the existing record
 * shows this is not hypothetical: 32 of the 103 recorded removals carry no
 * actor. So each event has a form that names nobody, and it says only what is
 * true — «больше не в группе» rather than guessing that they left of their own
 * accord.
 *
 * Rollback: `20260915140000_a_group_says_who_came_and_went.rollback.sql`.
 */

begin;

set local lock_timeout = '5s';

/**
 * The name to call somebody in a service line.
 *
 * The same order `enqueue_message_notifications` already uses, so one product
 * does not have two ways of naming the same person.
 */
create or replace function public.chat_member_service_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  -- `coalesce` and `nullif` are SQL grammar rather than functions in a schema,
  -- so they take no `pg_catalog.` prefix — qualifying them is a syntax error,
  -- and an empty search_path cannot reach them anyway. `btrim` is a real
  -- function and does take one.
  select coalesce(
           nullif(pg_catalog.btrim(person.full_name), ''),
           nullif('@' || person.username, '@'),
           'Участник'
         )
    from public.profiles person
   where person.id = p_user_id
$function$;

revoke all on function public.chat_member_service_name(uuid) from public, anon;
grant execute on function public.chat_member_service_name(uuid) to authenticated;

create or replace function public.write_membership_service_message()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_chat_id    uuid;
  v_subject    uuid;
  v_actor      uuid := auth.uid();
  v_chat_type  text;
  v_members    bigint;
  v_subject_nm text;
  v_actor_nm   text;
  v_line       text;
begin
  if tg_op = 'DELETE' then
    v_chat_id := old.chat_id;
    v_subject := old.user_id;
  else
    v_chat_id := new.chat_id;
    v_subject := new.user_id;
  end if;

  -- `is distinct from` rather than `<>`: a cascading chat delete leaves no row
  -- here, v_chat_type is null, and `null <> 'group'` is null — which would fall
  -- through and try to write a message into a chat that no longer exists.
  select chat_row.type into v_chat_type
    from public.chats chat_row where chat_row.id = v_chat_id;
  if v_chat_type is distinct from 'group' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    -- The creator's own row, written by `trg_add_chat_creator_as_owner` while
    -- the group is being made. That is a group appearing, not a person joining.
    select pg_catalog.count(*) into v_members
      from public.chat_members member_row where member_row.chat_id = v_chat_id;
    if v_members <= 1 then
      return null;
    end if;
  end if;

  v_subject_nm := public.chat_member_service_name(v_subject);
  if v_actor is not null and v_actor is distinct from v_subject then
    v_actor_nm := public.chat_member_service_name(v_actor);
  end if;

  -- Russian needs the accusative for a direct object — «добавил Ольгу», not
  -- «добавил Ольга Крылова» — and there is no declension to be had in SQL. So
  -- where a name would be an object it is introduced by a colon instead, which
  -- licenses the nominative and stays grammatical for every name. Where the
  -- person is the subject the plain form already works.
  if tg_op = 'INSERT' then
    if v_actor_nm is null then
      v_line := v_subject_nm || ' присоединился(ась) к группе';
    else
      v_line := v_actor_nm || ' добавил(а) в группу: ' || v_subject_nm;
    end if;
  else
    if v_actor_nm is not null then
      v_line := v_actor_nm || ' исключил(а) из группы: ' || v_subject_nm;
    elsif v_actor is not null then
      v_line := v_subject_nm || ' вышел(а) из группы';
    else
      -- Nobody to name. Saying «вышел» here would be a guess about somebody
      -- who may well have been removed by the service.
      v_line := v_subject_nm || ' больше не в группе';
    end if;
  end if;

  insert into public.messages (chat_id, type, content)
    values (v_chat_id, 'system', v_line);

  return null;
end
$function$;

revoke all on function public.write_membership_service_message() from public, anon, authenticated;

drop trigger if exists trg_membership_service_message_insert on public.chat_members;
create trigger trg_membership_service_message_insert
  after insert on public.chat_members
  for each row execute function public.write_membership_service_message();

drop trigger if exists trg_membership_service_message_delete on public.chat_members;
create trigger trg_membership_service_message_delete
  after delete on public.chat_members
  for each row execute function public.write_membership_service_message();

do $check$
declare
  v_secdef boolean;
  v_pinned boolean;
  v_count  bigint;
begin
  select p.prosecdef,
         exists (
           select 1 from pg_catalog.unnest(p.proconfig) setting
            where setting like 'search_path=%'
              and pg_catalog.btrim(pg_catalog.split_part(setting, '=', 2), '"') = ''
         )
    into v_secdef, v_pinned
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'write_membership_service_message';
  if not coalesce(v_secdef, false) then
    raise exception 'the service-message writer is not security definer, so it cannot write past the INSERT policy';
  end if;
  if not coalesce(v_pinned, false) then
    raise exception 'the service-message writer does not pin an empty search_path';
  end if;

  select pg_catalog.count(*) into v_count
    from pg_catalog.pg_trigger t
   where not t.tgisinternal
     and t.tgrelid = 'public.chat_members'::regclass
     and t.tgname like 'trg_membership_service_message%';
  if v_count <> 2 then
    raise exception 'expected two membership service-message triggers, found %', v_count;
  end if;

  -- Nobody may call the writer directly; it is a trigger, not a door.
  if pg_catalog.has_function_privilege('authenticated', 'public.write_membership_service_message()', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.write_membership_service_message()', 'execute') then
    raise exception 'the service-message writer is reachable as a function';
  end if;

  raise notice 'a group will now say who joined and who left, and a role change still will not';
end
$check$;

commit;
