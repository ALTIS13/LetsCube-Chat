/**
 * Measures the defect, applies the migration, measures again, and rolls the
 * whole thing back. Run with the migration body (minus its own begin/commit)
 * available at /tmp/mig-body.sql.
 *
 * Registration on this deployment is invite-only, so no fixture can insert into
 * `auth.users`. Every account below is a real row, picked by what it holds and
 * never by who it is, and nothing is printed but the outcome.
 *
 * Each attempt is made as `authenticated` with real `request.jwt.claims`. A
 * policy measured as the owner of its own table is not measured at all.
 */

begin;

create temporary table rehearsal_result (
  phase text,
  case_name text,
  outcome text
) on commit drop;

create temporary table rehearsal_actor (
  label text primary key,
  id uuid
) on commit drop;

do $pick$
declare
  v_manager_rank integer;
begin
  select priority into v_manager_rank
    from public.roles where scope = 'global' and key = 'manager' and is_active;

  -- The gap: RLS calls them staff, the trigger does not.
  insert into rehearsal_actor
  select 'gap', p.id from public.profiles p
   where public.is_manager_or_admin(p.id)
     and p.role not in ('admin', 'manager')
   order by p.id limit 1;

  -- The control: the legacy column says admin, so this one always worked.
  insert into rehearsal_actor
  select 'admin', p.id from public.profiles p
   where p.role = 'admin' order by p.id limit 1;

  -- Somebody with nothing, who must stay refused in both phases.
  insert into rehearsal_actor
  select 'nobody', p.id from public.profiles p
   where not public.is_manager_or_admin(p.id) order by p.id limit 1;

  -- Two distinct people to aim at.
  insert into rehearsal_actor
  select 'target', p.id from public.profiles p
   where not public.is_manager_or_admin(p.id)
     and p.id <> (select id from rehearsal_actor where label = 'nobody')
   order by p.id limit 1;

  if (select count(*) from rehearsal_actor) <> 4 then
    raise exception 'the rehearsal could not find all four kinds of account it needs (found %)',
      (select count(*) from rehearsal_actor);
  end if;
end
$pick$;

/**
 * One attempt: become `actor`, try to ban `subject`, record what happened,
 * become the owner again. The insert is undone immediately so the next phase
 * starts from the same state.
 */
create or replace function pg_temp.attempt_ban(p_phase text, p_case text, p_actor text, p_subject text)
returns void
language plpgsql
as $attempt$
declare
  v_owner   text := current_user;
  v_actor   uuid := (select id from rehearsal_actor where label = p_actor);
  v_subject uuid := (select id from rehearsal_actor where label = p_subject);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.bans (user_id, reason, issued_by) values (v_subject, 'rehearsal', v_actor);
    perform set_config('role', v_owner, true);
    -- Undo it as the service, not as the actor: after this migration a DELETE
    -- is judged too, and the cleanup must not become a sixth measurement.
    perform set_config('request.jwt.claims', '', true);
    delete from public.bans where user_id = v_subject and reason = 'rehearsal';
    insert into rehearsal_result values (p_phase, p_case, 'ALLOWED');
  exception when others then
    perform set_config('role', v_owner, true);
    insert into rehearsal_result values (p_phase, p_case, 'REFUSED: ' || sqlerrm);
  end;
  perform set_config('role', v_owner, true);
end
$attempt$;

/** The same, for taking a sanction away. */
create or replace function pg_temp.attempt_lift(p_phase text, p_case text, p_actor text, p_subject text)
returns void
language plpgsql
as $attempt$
declare
  v_owner   text := current_user;
  v_actor   uuid := (select id from rehearsal_actor where label = p_actor);
  v_subject uuid := (select id from rehearsal_actor where label = p_subject);
  v_gone    bigint;
begin
  -- `set_config(..., true)` lasts for the transaction, so a previous attempt's
  -- claims are still in place here. The setup insert must be the service's, not
  -- the last actor's, or the BEFORE INSERT trigger judges the wrong person.
  perform set_config('request.jwt.claims', '', true);

  insert into public.bans (user_id, reason, issued_by)
    values (v_subject, 'rehearsal-lift', (select id from rehearsal_actor where label = 'admin'));

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    delete from public.bans where user_id = v_subject and reason = 'rehearsal-lift';
    get diagnostics v_gone = row_count;
    perform set_config('role', v_owner, true);
    insert into rehearsal_result values (p_phase, p_case,
      case when v_gone > 0 then 'LIFTED' else 'NO ROW VISIBLE (refused by RLS)' end);
  exception when others then
    perform set_config('role', v_owner, true);
    insert into rehearsal_result values (p_phase, p_case, 'REFUSED: ' || sqlerrm);
  end;
  -- And the teardown is the service's too. Left as the actor, this delete is
  -- judged by the very trigger the migration adds, which is how the first run
  -- of this rehearsal aborted — a fault in the harness, and incidentally the
  -- first evidence that the DELETE guard bites.
  perform set_config('role', v_owner, true);
  perform set_config('request.jwt.claims', '', true);
  delete from public.bans where user_id = v_subject and reason = 'rehearsal-lift';
end
$attempt$;

-- ── BEFORE ────────────────────────────────────────────────────────────────────
select pg_temp.attempt_ban('before', 'staff-by-global-role bans an ordinary person', 'gap', 'target');
select pg_temp.attempt_ban('before', 'legacy admin bans an ordinary person (control)', 'admin', 'target');
select pg_temp.attempt_ban('before', 'a person with no role bans somebody', 'nobody', 'target');
select pg_temp.attempt_ban('before', 'somebody bans themselves', 'admin', 'admin');
select pg_temp.attempt_lift('before', 'a person with no role lifts a ban', 'nobody', 'target');

\i /tmp/mig-body.sql

-- ── AFTER ─────────────────────────────────────────────────────────────────────
select pg_temp.attempt_ban('after', 'staff-by-global-role bans an ordinary person', 'gap', 'target');
select pg_temp.attempt_ban('after', 'legacy admin bans an ordinary person (control)', 'admin', 'target');
select pg_temp.attempt_ban('after', 'a person with no role bans somebody', 'nobody', 'target');
select pg_temp.attempt_ban('after', 'somebody bans themselves', 'admin', 'admin');
select pg_temp.attempt_lift('after', 'a person with no role lifts a ban', 'nobody', 'target');

select phase, case_name, outcome from rehearsal_result order by case_name, phase desc;

do $verdict$
declare
  v_bad text;
begin
  -- What must change.
  if (select outcome from rehearsal_result
       where phase = 'before' and case_name like 'staff-by-global-role%') not like 'REFUSED%' then
    raise exception 'the defect did not reproduce: the staff account could already ban';
  end if;
  if (select outcome from rehearsal_result
       where phase = 'after' and case_name like 'staff-by-global-role%') <> 'ALLOWED' then
    raise exception 'the fix did not take: the staff account still cannot ban';
  end if;

  -- What must not change.
  for v_bad in
    select case_name from rehearsal_result
     group by case_name having count(distinct outcome) > 1
        and case_name not like 'staff-by-global-role%'
        and case_name not like '%lifts a ban%'
  loop
    raise exception 'a case that should have been untouched changed: %', v_bad;
  end loop;

  if (select outcome from rehearsal_result
       where phase = 'after' and case_name like '%no role bans%') not like 'REFUSED%' then
    raise exception 'a person with no role can now ban somebody';
  end if;
  if (select outcome from rehearsal_result
       where phase = 'after' and case_name like '%bans themselves%') not like 'REFUSED%' then
    raise exception 'self-sanction stopped being refused';
  end if;

  raise notice 'REHEARSAL PASSED — the defect reproduced, the fix took, and nothing else moved';
end
$verdict$;

rollback;
