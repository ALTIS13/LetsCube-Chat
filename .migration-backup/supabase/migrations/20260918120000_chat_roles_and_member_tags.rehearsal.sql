/**
 * Rehearsal for 20260918120000_chat_roles_and_member_tags.sql.
 *
 * Applies the migration, measures what it claims, and rolls the whole thing
 * back. Nothing survives this file: it ends in `rollback`, and the read-only
 * counts printed after it prove the database is where it was.
 *
 * ── How to run it ───────────────────────────────────────────────────────────
 *
 * The body of the migration has to be available without its own transaction,
 * because this file opens one of its own. From the repository:
 *
 *     sed '/^begin;$/d; /^commit;$/d' \
 *       .migration-backup/supabase/migrations/20260918120000_chat_roles_and_member_tags.sql \
 *       > mig-body.sql
 *     scp -i <key> mig-body.sql root@ms.letscube.ru:/tmp/mig-body.sql
 *     ssh -i <key> root@ms.letscube.ru \
 *       'docker cp /tmp/mig-body.sql supabase-db:/tmp/mig-body.sql'
 *     ssh -i <key> root@ms.letscube.ru \
 *       'docker exec -i supabase-db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -f -' \
 *       < .../20260918120000_chat_roles_and_member_tags.rehearsal.sql
 *
 * `ON_ERROR_STOP=1` matters. Without it psql keeps going after a failed
 * statement, the transaction is aborted, and every probe below returns the same
 * "current transaction is aborted" string — which reads like sixteen refusals
 * and is in fact one syntax error.
 *
 * ── Why the impersonation ───────────────────────────────────────────────────
 *
 * Every attempt below is made as `authenticated` with a real
 * `request.jwt.claims`. A policy measured as its own table's owner is not
 * measured at all: `postgres` bypasses row level security outright, so as
 * `postgres` every one of these would be ALLOWED and the file would prove
 * nothing. `set_config(..., true)` is transaction-local, so a previous
 * attempt's claims are still in place at the start of the next one; each helper
 * therefore sets both the claims and the role every time, and puts them back
 * afterwards.
 *
 * Registration on this deployment is invite-only, so no fixture can insert into
 * `auth.users`. Every actor is a real row, chosen by what it holds and never by
 * who it is, and nothing is printed but a label and an outcome.
 *
 * ── What a wrong answer looks like ──────────────────────────────────────────
 *
 * Read this before the results, not after.
 *
 * - **Every case REFUSED, controls included.** Then nothing was measured. The
 *   usual cause is the aborted-transaction cascade above, or an actor that is
 *   not a member of the chat it is being pointed at. The verdict block raises
 *   on this rather than letting a page of REFUSED look like a page of security.
 * - **Every case ALLOWED.** Then the impersonation did not take and everything
 *   ran as `postgres`. Case 05 (a member reads) and case 06 (a non-member
 *   reads) disagree by construction: if both return the same count, the role
 *   never changed.
 * - **Case 02 ALLOWED** — a plain member created a role. The write gate is not
 *   on, or it is `is_chat_member` where it should be `is_chat_owner`.
 * - **Case 03 ALLOWED** — a chat administrator who is not the owner created a
 *   role. That is not a bug, it is the other decision: the migration gates
 *   `chat_roles` on `is_chat_owner`, and if the owner prefers administrators to
 *   be able to invent tags, the change is `is_chat_owner` to `is_chat_admin` in
 *   the "owners manage chat roles" policy and the expected value of this one
 *   case flips. Nothing else in the file moves.
 * - **Case 07 REFUSED** — an administrator could not hand out an existing tag.
 *   The split has collapsed to owner-only and the assignment policy is wrong.
 * - **Case 10 ALLOWED** — a tag from another group was accepted. The composite
 *   key onto `chat_roles (chat_id, id)` is missing or was written as a plain
 *   `references chat_roles(id)`, which is how the proposal has it. This is the
 *   case the whole `chat_roles_chat_id_id_key` unique constraint exists for.
 * - **Case 11 ALLOWED** — one side of a two-person conversation can invent a
 *   tag for the other. The private-chat trigger is missing or its condition is
 *   inverted.
 * - **Case 12 showing `tags after leaving: 1`** — the composite foreign key
 *   onto `chat_members` is not cascading, and the design needs the sweeper it
 *   was written to avoid. If it shows `roles still defined: 0` as well, the
 *   cascade went too far and took the group's vocabulary with one person's
 *   departure.
 * - **Case 14 ALLOWED** — `chat_roles.colour` accepts a free hex value, which
 *   is the D-214 defect reproduced once per group. Deliberate only if the owner
 *   has said so.
 * - **Case 16 ALLOWED** — twenty-six roles went in as one statement. The count
 *   bound is a BEFORE trigger, which cannot see the rows its own command is
 *   inserting, and the limit is decorative.
 * - **Any case REFUSED with the wrong reason.** The verdict block checks the
 *   text of each refusal against the constraint, policy or trigger that was
 *   supposed to produce it, because "REFUSED" alone cannot tell a working rule
 *   from a different rule firing first. That is not hypothetical: an earlier
 *   draft of this file ran the per-chat fill before the blank-name, hex-colour
 *   and duplicate-name cases, so all three were refused by `chat_roles_limit`
 *   and all three would have been reported green.
 */

\set ON_ERROR_STOP on

-- ── Before ───────────────────────────────────────────────────────────────────
-- The defect is an absence, so there is no "before" measurement to take beyond
-- proving the absence: if either table already exists, an earlier attempt was
-- half applied and this rehearsal would measure that instead of the file.

do $before$
begin
  if pg_catalog.to_regclass('public.chat_roles') is not null
     or pg_catalog.to_regclass('public.chat_member_roles') is not null then
    raise exception 'chat_roles or chat_member_roles already exists; this rehearsal would not be measuring the migration';
  end if;
  raise notice 'before: neither table exists, as expected';
end
$before$;

begin;

create temporary table rehearsal_result (
  case_name text primary key,
  outcome   text
) on commit drop;

create temporary table rehearsal_actor (
  label   text primary key,
  id      uuid,
  chat_id uuid
) on commit drop;

/**
 * The actors, chosen by what they hold.
 *
 * Measured on 2026-09-18 this deployment has 13 groups: seven with an owner and
 * nobody else, one with an owner and one member, one with an owner and two
 * members, one with an owner and one administrator. **No single group contains
 * both a non-owner administrator and a plain member**, which is why the probes
 * below use two groups rather than one. If that shape has changed, this block
 * raises rather than quietly measuring something else.
 */
do $pick$
declare
  v_group_a uuid;
  v_group_b uuid;
  v_private uuid;
begin
  -- A group with an owner and at least one plain member.
  select member_row.chat_id into v_group_a
    from public.chat_members as member_row
    join public.chats as chat_row on chat_row.id = member_row.chat_id
   where chat_row.type = 'group' and member_row.role = 'member'
     and exists (
       select 1 from public.chat_members as owner_row
        where owner_row.chat_id = member_row.chat_id and owner_row.role = 'owner'
     )
   order by member_row.chat_id limit 1;

  -- A group with an owner and a non-owner administrator.
  select member_row.chat_id into v_group_b
    from public.chat_members as member_row
    join public.chats as chat_row on chat_row.id = member_row.chat_id
   where chat_row.type = 'group' and member_row.role = 'admin'
     and exists (
       select 1 from public.chat_members as owner_row
        where owner_row.chat_id = member_row.chat_id and owner_row.role = 'owner'
     )
   order by member_row.chat_id limit 1;

  -- A private chat carrying an owner row: the 2026-09-11 artefact.
  select member_row.chat_id into v_private
    from public.chat_members as member_row
    join public.chats as chat_row on chat_row.id = member_row.chat_id
   where chat_row.type = 'private' and member_row.role = 'owner'
   order by member_row.chat_id limit 1;

  if v_group_a is null then
    raise exception 'no group has an owner and a plain member; cases 02, 05, 08, 09, 12 cannot be measured';
  end if;
  if v_group_b is null then
    raise exception 'no group has a non-owner administrator; cases 03, 04, 07 cannot be measured';
  end if;
  if v_private is null then
    raise exception 'no private chat carries an owner row; case 11 cannot be measured';
  end if;

  insert into rehearsal_actor
  select 'owner_a', user_id, chat_id from public.chat_members
   where chat_id = v_group_a and role = 'owner' order by user_id limit 1;

  insert into rehearsal_actor
  select 'member_a', user_id, chat_id from public.chat_members
   where chat_id = v_group_a and role = 'member' order by user_id limit 1;

  insert into rehearsal_actor
  select 'owner_b', user_id, chat_id from public.chat_members
   where chat_id = v_group_b and role = 'owner' order by user_id limit 1;

  insert into rehearsal_actor
  select 'admin_b', user_id, chat_id from public.chat_members
   where chat_id = v_group_b and role = 'admin' order by user_id limit 1;

  insert into rehearsal_actor
  select 'private_owner', user_id, chat_id from public.chat_members
   where chat_id = v_private and role = 'owner' order by user_id limit 1;

  -- Somebody who is not in group A at all, for the read-side control.
  insert into rehearsal_actor
  select 'outsider', profile_row.id, v_group_a from public.profiles as profile_row
   where not exists (
     select 1 from public.chat_members as member_row
      where member_row.chat_id = v_group_a and member_row.user_id = profile_row.id
   )
   order by profile_row.id limit 1;

  if (select count(*) from rehearsal_actor) <> 6 then
    raise exception 'the rehearsal found % of the six actors it needs',
      (select count(*) from rehearsal_actor);
  end if;

  raise notice 'picked six actors across two groups and one private chat';
end
$pick$;

-- ── The migration itself ─────────────────────────────────────────────────────
-- A syntax error surfaces here, harmlessly, inside a transaction that ends in
-- rollback. This is the only place the file is executed before the owner
-- applies it for real.

\i /tmp/mig-body.sql

-- ── The helpers ──────────────────────────────────────────────────────────────

/**
 * Become `p_actor`, try to create a role in the chat `p_chat_of` belongs to,
 * record the outcome, become the service again.
 */
create or replace function pg_temp.try_create_role(
  p_case text, p_actor text, p_chat_of text, p_name text,
  p_colour text default null
)
returns void
language plpgsql
as $attempt$
declare
  v_service text := current_user;
  v_actor   uuid := (select id from rehearsal_actor where label = p_actor);
  v_chat    uuid := (select chat_id from rehearsal_actor where label = p_chat_of);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.chat_roles (chat_id, name, colour, created_by)
      values (v_chat, p_name, p_colour, v_actor);
    perform set_config('role', v_service, true);
    insert into rehearsal_result values (p_case, 'ALLOWED');
  exception when others then
    perform set_config('role', v_service, true);
    insert into rehearsal_result values (p_case, 'REFUSED: ' || sqlerrm);
  end;
  perform set_config('role', v_service, true);
end
$attempt$;

/** Become `p_actor` and try to put `p_role_name` on `p_subject`. */
create or replace function pg_temp.try_assign(
  p_case text, p_actor text, p_chat_of text, p_subject text, p_role_name text,
  p_role_from_chat_of text default null
)
returns void
language plpgsql
as $attempt$
declare
  v_service text := current_user;
  v_actor   uuid := (select id from rehearsal_actor where label = p_actor);
  v_chat    uuid := (select chat_id from rehearsal_actor where label = p_chat_of);
  v_subject uuid := (select id from rehearsal_actor where label = p_subject);
  v_role_in uuid := (select chat_id from rehearsal_actor
                      where label = coalesce(p_role_from_chat_of, p_chat_of));
  v_role    uuid;
begin
  -- The role is looked up as the service, so a failure to find it is never
  -- mistaken for a refusal to write.
  select id into v_role from public.chat_roles
   where chat_id = v_role_in and name = p_role_name;
  if v_role is null then
    insert into rehearsal_result values (p_case, 'SETUP FAILED: no role named ' || p_role_name);
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.chat_member_roles (chat_id, user_id, role_id, assigned_by)
      values (v_chat, v_subject, v_role, v_actor);
    perform set_config('role', v_service, true);
    insert into rehearsal_result values (p_case, 'ALLOWED');
  exception when others then
    perform set_config('role', v_service, true);
    insert into rehearsal_result values (p_case, 'REFUSED: ' || sqlerrm);
  end;
  perform set_config('role', v_service, true);
end
$attempt$;

/** Become `p_actor` and count the roles they can see in that chat. */
create or replace function pg_temp.try_read(p_case text, p_actor text, p_chat_of text)
returns void
language plpgsql
as $attempt$
declare
  v_service text := current_user;
  v_actor   uuid := (select id from rehearsal_actor where label = p_actor);
  v_chat    uuid := (select chat_id from rehearsal_actor where label = p_chat_of);
  v_seen    integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    select count(*)::integer into v_seen from public.chat_roles where chat_id = v_chat;
    perform set_config('role', v_service, true);
    insert into rehearsal_result values (p_case, 'SEES ' || v_seen);
  exception when others then
    perform set_config('role', v_service, true);
    insert into rehearsal_result values (p_case, 'REFUSED: ' || sqlerrm);
  end;
  perform set_config('role', v_service, true);
end
$attempt$;

-- ── The probes ───────────────────────────────────────────────────────────────

-- 01 is the control. If this is refused, every refusal below means nothing.
select pg_temp.try_create_role('01 CONTROL group owner creates a role', 'owner_a', 'owner_a', 'Модератор');

-- 02 the plain member. Must be refused by "owners manage chat roles".
select pg_temp.try_create_role('02 plain member creates a role', 'member_a', 'member_a', 'Самозванец');

-- 03 the chat administrator. Refused by the decision this migration took; see
--    the header for the one line that flips it.
select pg_temp.try_create_role('03 chat admin creates a role', 'admin_b', 'admin_b', 'Хранитель');

-- 04 the second control, in the other group, so case 03's refusal is about the
--    actor and not about that group being unusable.
select pg_temp.try_create_role('04 CONTROL other group owner creates a role', 'owner_b', 'owner_b', 'Ветеран группы');

-- 05 and 06 are the read pair. They must disagree, or the impersonation is not
--    taking and every other line is meaningless.
select pg_temp.try_read('05 CONTROL member reads the group roles', 'member_a', 'member_a');
select pg_temp.try_read('06 non-member reads the group roles', 'outsider', 'outsider');

-- 07 an administrator hands out an existing tag. Must be allowed.
select pg_temp.try_assign('07 CONTROL chat admin assigns a tag', 'admin_b', 'admin_b', 'admin_b', 'Ветеран группы');

-- 08 a plain member hands out a tag. Must be refused.
select pg_temp.try_assign('08 plain member assigns a tag', 'member_a', 'member_a', 'member_a', 'Модератор');

-- 09 the owner tags the member. Must be allowed, and sets up case 12.
select pg_temp.try_assign('09 CONTROL owner tags a member', 'owner_a', 'member_a', 'member_a', 'Модератор');

-- 10 a tag from the other group. Must be refused by the composite key onto
--    chat_roles (chat_id, id) — the correction to the proposal's design.
select pg_temp.try_assign('10 tag borrowed from another group', 'owner_a', 'member_a', 'member_a', 'Ветеран группы', 'owner_b');

-- 11 a private chat. Must be refused by private.enforce_chat_role_scope.
select pg_temp.try_create_role('11 private chat owner creates a role', 'private_owner', 'private_owner', 'Мой человек');

-- 12 leaving the group. The member deletes their own membership row, which is
--    what leaving is, and the tag from case 09 must go with it while the
--    group's vocabulary stays.
do $cascade$
declare
  v_service     text := current_user;
  v_actor       uuid := (select id from rehearsal_actor where label = 'member_a');
  v_chat        uuid := (select chat_id from rehearsal_actor where label = 'member_a');
  v_tags_before integer;
  v_tags_after  integer;
  v_roles_after integer;
begin
  select count(*)::integer into v_tags_before from public.chat_member_roles
   where chat_id = v_chat and user_id = v_actor;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  delete from public.chat_members where chat_id = v_chat and user_id = v_actor;
  perform set_config('role', v_service, true);
  perform set_config('request.jwt.claims', '', true);

  select count(*)::integer into v_tags_after from public.chat_member_roles
   where chat_id = v_chat and user_id = v_actor;
  select count(*)::integer into v_roles_after from public.chat_roles where chat_id = v_chat;

  insert into rehearsal_result values ('12 leaving the group drops the tags',
    'tags before: ' || v_tags_before || ', tags after leaving: ' || v_tags_after ||
    ', roles still defined: ' || v_roles_after);
exception when others then
  perform set_config('role', v_service, true);
  perform set_config('request.jwt.claims', '', true);
  insert into rehearsal_result values ('12 leaving the group drops the tags',
    'SETUP FAILED: ' || sqlerrm);
end
$cascade$;

-- 13 a blank name.
select pg_temp.try_create_role('13 a blank role name', 'owner_a', 'owner_a', '   ');

-- 14 a free hex colour, which is the D-214 defect this column refuses.
select pg_temp.try_create_role('14 a free hex colour', 'owner_a', 'owner_a', 'Золотой', '#F5B50A');

-- 15 the same name folded and trimmed.
select pg_temp.try_create_role('15 the same name in another case', 'owner_a', 'owner_a', '  модератор ');

-- 16 and 17 are the per-chat bound, and they come LAST on purpose. The fill
--    puts the group at its limit, and anything attempted afterwards can be
--    refused by the limit instead of by the rule it was meant to test. That is
--    not hypothetical: in the first draft of this file the bound was a BEFORE
--    trigger and the fill ran before 13, 14 and 15, so all three were refused
--    by `chat_roles_limit` and all three would have been reported green. The
--    bound is an AFTER trigger now and a CHECK constraint would fire ahead of
--    it, so the hazard is smaller -- but the order stays, because a rehearsal
--    should not depend on knowing which of two mechanisms wins a race, and the
--    verdict block now checks the reason as well as the refusal.
--
--    16 also proves the bound cannot be walked past by a single multi-row
--    insert, which is the thing a BEFORE trigger could not have stopped:
--    twenty-six rows in one statement, as the service, with RLS out of the
--    picture entirely.
do $bulk$
begin
  begin
    insert into public.chat_roles (chat_id, name)
    select (select chat_id from rehearsal_actor where label = 'owner_a'),
           'Оптом ' || filler
      from generate_series(1, 26) as filler;
    insert into rehearsal_result values ('16 twenty-six roles in one statement', 'ALLOWED');
  exception when others then
    insert into rehearsal_result values ('16 twenty-six roles in one statement',
      'REFUSED: ' || sqlerrm);
  end;
end
$bulk$;

-- Twenty-four more, one statement, taking the group from one to twenty-five.
do $fill$
begin
  insert into public.chat_roles (chat_id, name)
  select (select chat_id from rehearsal_actor where label = 'owner_a'),
         'Наполнитель ' || filler
    from generate_series(1, 24) as filler;
end
$fill$;
select pg_temp.try_create_role('17 the twenty-sixth role in one group', 'owner_a', 'owner_a', 'Лишний');

-- ── The results ──────────────────────────────────────────────────────────────

select case_name, outcome from rehearsal_result order by case_name;

do $verdict$
declare
  v_case     text;
  v_expected text;
  v_outcome  text;
  v_allowed  integer;
  v_refused  integer;
begin
  -- The shape of the whole run, before any single case.
  select count(*) filter (where outcome = 'ALLOWED'),
         count(*) filter (where outcome like 'REFUSED%')
    into v_allowed, v_refused
    from rehearsal_result;
  if v_allowed = 0 then
    raise exception 'nothing was allowed, so nothing was measured: a page of REFUSED is not a page of security';
  end if;
  if v_refused = 0 then
    raise exception 'nothing was refused, so the impersonation did not take and this ran as the table owner';
  end if;

  -- The controls first, because they are what make a refusal mean something.
  foreach v_case in array array[
    '01 CONTROL group owner creates a role',
    '04 CONTROL other group owner creates a role',
    '07 CONTROL chat admin assigns a tag',
    '09 CONTROL owner tags a member'
  ]
  loop
    select outcome into v_outcome from rehearsal_result where case_name = v_case;
    if v_outcome is distinct from 'ALLOWED' then
      raise exception 'a control failed, so every refusal in this run is unexplained: % -> %',
        v_case, coalesce(v_outcome, '<no result>');
    end if;
  end loop;

  select outcome into v_outcome from rehearsal_result
   where case_name = '05 CONTROL member reads the group roles';
  if v_outcome = 'SEES 0' or v_outcome is null then
    raise exception 'a member of the group cannot see its roles, so the read policy is wrong: %',
      coalesce(v_outcome, '<no result>');
  end if;

  select outcome into v_outcome from rehearsal_result
   where case_name = '06 non-member reads the group roles';
  if v_outcome is distinct from 'SEES 0' then
    raise exception 'somebody outside the group can read its roles: %',
      coalesce(v_outcome, '<no result>');
  end if;

  -- The refusals, each paired with the thing that has to have done the
  -- refusing. "REFUSED" on its own is not a measurement: a blank name rejected
  -- by a row-count limit, or a free hex rejected by a policy, would read
  -- exactly the same and would mean the opposite.
  for v_case, v_expected in
    select * from (values
      ('02 plain member creates a role',            'row-level security'),
      ('03 chat admin creates a role',              'row-level security'),
      ('08 plain member assigns a tag',             'row-level security'),
      ('10 tag borrowed from another group',        'chat_member_roles_role_fkey'),
      ('11 private chat owner creates a role',      'chat_role_private_chat'),
      ('13 a blank role name',                      'chat_roles_name_length'),
      ('14 a free hex colour',                      'chat_roles_colour_palette_key'),
      ('15 the same name in another case',          'chat_roles_chat_name_idx'),
      ('16 twenty-six roles in one statement',      'chat_roles_limit'),
      ('17 the twenty-sixth role in one group',     'chat_roles_limit')
    ) as expectation(case_name, needle)
  loop
    select outcome into v_outcome from rehearsal_result where case_name = v_case;
    if v_outcome is null or v_outcome not like 'REFUSED%' then
      raise exception 'a case that must be refused was not: % -> %',
        v_case, coalesce(v_outcome, '<no result>');
    end if;
    if position(v_expected in v_outcome) = 0 then
      raise exception 'case % was refused, but by something else: nothing in its message mentions %. Got: %',
        v_case, v_expected, v_outcome;
    end if;
  end loop;

  -- And the cascade, read literally rather than by eye.
  select outcome into v_outcome from rehearsal_result
   where case_name = '12 leaving the group drops the tags';
  if v_outcome is null or v_outcome not like 'tags before: 1,%' then
    raise exception 'case 12 did not start from one tag, so it measured nothing: %',
      coalesce(v_outcome, '<no result>');
  end if;
  if v_outcome not like '%tags after leaving: 0%' then
    raise exception 'the tag outlived the membership, so the design needs the sweeper it was written to avoid: %',
      v_outcome;
  end if;
  if v_outcome like '%roles still defined: 0%' then
    raise exception 'one person leaving took the group vocabulary with them: %', v_outcome;
  end if;

  raise notice 'REHEARSAL PASSED — the controls held, the gates refused, and leaving took the tags';
end
$verdict$;

rollback;

-- ── After the rollback: prove nothing was left behind ────────────────────────
-- Counts only. If any of these is not what it should be, something escaped the
-- transaction and the database is not where it was.

select pg_catalog.to_regclass('public.chat_roles') is null as chat_roles_gone,
       pg_catalog.to_regclass('public.chat_member_roles') is null as chat_member_roles_gone,
       (select count(*) from public.chat_members) as memberships_now,
       (select count(*) from public.audit_logs where created_at > now() - interval '10 minutes')
         as audit_rows_in_the_last_ten_minutes,
       (select count(*) from public.roles where scope = 'chat' and is_active) as revived_chat_scope_roles;
