/**
 * Measures every branch of the service-message trigger and rolls back.
 *
 * Run with the migration body (minus its own begin/commit) at /tmp/mig-body.sql.
 *
 * Registration on this deployment is invite-only, so no fixture can make an
 * account: every person below is a real row, picked by what they are and never
 * by who they are, and nothing is printed but the produced sentence with the
 * names replaced. Nothing is written outside the transaction.
 */

begin;

create temporary table rehearsal_line (
  step text,
  produced text
) on commit drop;

create temporary table rehearsal_who (
  label text primary key,
  id uuid
) on commit drop;

/** Every system message already in the chat, so only new ones are read. */
create temporary table rehearsal_seen (id uuid primary key) on commit drop;

do $pick$
declare
  v_chat uuid;
  v_actor uuid;
  v_subject uuid;
begin
  -- A group with at least two people already in it, so no INSERT under test is
  -- ever the chat's first membership.
  select member_row.chat_id into v_chat
    from public.chat_members member_row
    join public.chats chat_row on chat_row.id = member_row.chat_id
   where chat_row.type = 'group'
   group by member_row.chat_id
  having pg_catalog.count(*) >= 2
   order by member_row.chat_id
   limit 1;
  if v_chat is null then
    raise exception 'no group with two members to rehearse in';
  end if;

  select member_row.user_id into v_actor
    from public.chat_members member_row
   where member_row.chat_id = v_chat order by member_row.user_id limit 1;

  select person.id into v_subject
    from public.profiles person
   where not exists (
     select 1 from public.chat_members mine
      where mine.chat_id = v_chat and mine.user_id = person.id
   )
   order by person.id limit 1;
  if v_subject is null then
    raise exception 'everybody is already in that group; nobody left to add';
  end if;

  insert into rehearsal_who values ('chat', v_chat), ('actor', v_actor), ('subject', v_subject);
  insert into rehearsal_seen
    select m.id from public.messages m where m.chat_id = v_chat and m.type = 'system';
end
$pick$;

/**
 * Do one membership change as `p_actor` and record the sentence it produced.
 *
 * The new row is found by id against a set of ids already seen, **not** by
 * `created_at`: inside one transaction `now()` is frozen, so every row this
 * rehearsal writes carries the same timestamp and «the newest one» has no
 * meaning. That is a property of the harness, not of the trigger.
 *
 * The sentence has the real names swapped for «АКТЁР» and «УЧАСТНИК» before it
 * is recorded, so the shape can be read without printing who anybody is.
 */
create or replace function pg_temp.observe(p_step text, p_op text, p_actor text)
returns void
language plpgsql
as $observe$
declare
  v_chat    uuid := (select id from rehearsal_who where label = 'chat');
  v_subject uuid := (select id from rehearsal_who where label = 'subject');
  v_actor   uuid := (select id from rehearsal_who where label = p_actor);
  v_new     uuid;
  v_line    text;
begin
  perform set_config('request.jwt.claims',
    case when v_actor is null then ''
         else json_build_object('sub', v_actor::text, 'role', 'authenticated')::text end, true);

  if p_op = 'INSERT' then
    insert into public.chat_members (chat_id, user_id, role)
      values (v_chat, v_subject, 'member');
  else
    delete from public.chat_members
     where chat_id = v_chat and user_id = v_subject;
  end if;

  perform set_config('request.jwt.claims', '', true);

  select m.id, m.content into v_new, v_line
    from public.messages m
   where m.chat_id = v_chat and m.type = 'system'
     and not exists (select 1 from rehearsal_seen s where s.id = m.id)
   limit 1;

  if v_new is null then
    insert into rehearsal_line values (p_step, 'NO LINE WRITTEN');
    return;
  end if;

  insert into rehearsal_seen values (v_new);
  v_line := pg_catalog.replace(v_line, public.chat_member_service_name(v_subject), 'УЧАСТНИК');
  if v_actor is not null then
    v_line := pg_catalog.replace(v_line, public.chat_member_service_name(v_actor), 'АКТЁР');
  end if;
  insert into rehearsal_line values (p_step, v_line);
end
$observe$;

\i /tmp/mig-body.sql

-- ── the six branches ──────────────────────────────────────────────────────────
select pg_temp.observe('1 somebody else adds them',   'INSERT', 'actor');
select pg_temp.observe('2 they are removed by that person', 'DELETE', 'actor');
select pg_temp.observe('3 they join by themselves',   'INSERT', 'subject');
select pg_temp.observe('4 they leave by themselves',  'DELETE', 'subject');
select pg_temp.observe('5 the service adds them',     'INSERT', 'nobody');
select pg_temp.observe('6 the service removes them',  'DELETE', 'nobody');

-- ── and the two silences ──────────────────────────────────────────────────────
do $silences$
declare
  v_private uuid;
  v_person  uuid;
  v_before  bigint;
  v_after   bigint;
  v_member  uuid;
  v_chat    uuid := (select id from rehearsal_who where label = 'chat');
begin
  -- A private chat says nothing.
  select chat_row.id into v_private from public.chats chat_row
   where chat_row.type = 'private' order by chat_row.id limit 1;
  select person.id into v_person from public.profiles person
   where not exists (select 1 from public.chat_members mine
                      where mine.chat_id = v_private and mine.user_id = person.id)
   order by person.id limit 1;
  if v_private is not null and v_person is not null then
    select pg_catalog.count(*) into v_before from public.messages
     where chat_id = v_private and type = 'system';
    insert into public.chat_members (chat_id, user_id, role) values (v_private, v_person, 'member');
    select pg_catalog.count(*) into v_after from public.messages
     where chat_id = v_private and type = 'system';
    insert into rehearsal_line values ('7 a private chat',
      case when v_after = v_before then 'NO LINE WRITTEN' else 'A LINE APPEARED — private chats must stay silent' end);
  end if;

  -- A role change says nothing.
  select member_row.user_id into v_member from public.chat_members member_row
   where member_row.chat_id = v_chat and member_row.role = 'member'
   order by member_row.user_id limit 1;
  if v_member is not null then
    select pg_catalog.count(*) into v_before from public.messages
     where chat_id = v_chat and type = 'system';
    update public.chat_members set role = 'admin'
     where chat_id = v_chat and user_id = v_member;
    select pg_catalog.count(*) into v_after from public.messages
     where chat_id = v_chat and type = 'system';
    insert into rehearsal_line values ('8 a role change',
      case when v_after = v_before then 'NO LINE WRITTEN' else 'A LINE APPEARED — role changes belong to the audit log' end);
  else
    insert into rehearsal_line values ('8 a role change', 'SKIPPED — nobody plain enough to promote');
  end if;
end
$silences$;

select step, produced from rehearsal_line order by step;

do $verdict$
declare
  v_bad text;
begin
  for v_bad in
    select step from rehearsal_line
     where step in ('1 somebody else adds them','2 they are removed by that person',
                    '3 they join by themselves','4 they leave by themselves',
                    '5 the service adds them','6 the service removes them')
       and produced = 'NO LINE WRITTEN'
  loop
    raise exception 'a branch that must speak said nothing: %', v_bad;
  end loop;

  for v_bad in
    select step from rehearsal_line
     where step in ('7 a private chat','8 a role change')
       and produced not in ('NO LINE WRITTEN', 'SKIPPED — nobody plain enough to promote')
  loop
    raise exception 'a branch that must stay silent spoke: %', v_bad;
  end loop;

  -- The two that name nobody must not invent an actor.
  if exists (
    select 1 from rehearsal_line
     where step in ('5 the service adds them','6 the service removes them')
       and produced like '%АКТЁР%'
  ) then
    raise exception 'a line named an actor where there was none';
  end if;

  raise notice 'REHEARSAL PASSED — six branches speak, two stay silent, and none invents an actor';
end
$verdict$;

rollback;
