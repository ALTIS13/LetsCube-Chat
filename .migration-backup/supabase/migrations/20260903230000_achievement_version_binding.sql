-- Bind the earned-by-date badges to real released versions, and make the dates
-- that decide them hard to move.
--
-- The threat this closes is narrow and specific: an alpha or beta badge is worth
-- something precisely because the period it marks is over. Nothing a client
-- sends can influence a grant — `achievements_sync` takes no arguments, reads
-- only the server's own clock and rows, and RLS refuses a hand-written badge —
-- so the remaining way to obtain one dishonestly is to move the boundary
-- afterwards. That is what changes here:
--
--   * a milestone now records the released version it marks, not only a date,
--     so "before 1.0" means a version that actually shipped;
--   * `reached_at` is write-once — declaring a milestone reached is a one-way
--     door, and correcting it is a separate, audited act;
--   * every grant stores the evidence it was made on, so a badge that should
--     not exist can be seen rather than merely suspected.
--
-- Additive: two new columns, one new achievement and frame, one new function,
-- two rewritten functions.

alter table public.product_milestones
  add column if not exists version text;

alter table public.product_milestones
  drop constraint if exists product_milestones_version_check;
alter table public.product_milestones
  add constraint product_milestones_version_check
  check (version is null or version ~ '^[0-9]+\.[0-9]+\.[0-9]+$');

-- A milestone that has been reached must say which version reached it.
alter table public.product_milestones
  drop constraint if exists product_milestones_reached_version_check;
alter table public.product_milestones
  add constraint product_milestones_reached_version_check
  check (reached_at is null or version is not null);

-- What justified a grant, recorded at the moment it was made.
alter table public.user_achievements
  add column if not exists evidence jsonb not null default '{}'::jsonb;

insert into public.product_milestones (key, title, reached_at, version) values
  ('alpha_end', 'Конец альфа-тестирования', null, null)
on conflict (key) do nothing;

insert into public.achievements (key, title, description, icon, grant_kind, sort_order, criteria)
values (
  'alpha_tester',
  'Альфа-тестер',
  'Был с LETSCUBE во время альфа-тестирования',
  'shield',
  'auto',
  15,
  '{"kind":"registered_before_milestone","milestone":"alpha_end"}'::jsonb
)
on conflict (key) do update set
  title = excluded.title,
  description = excluded.description,
  icon = excluded.icon,
  grant_kind = excluded.grant_kind,
  sort_order = excluded.sort_order,
  criteria = excluded.criteria;

insert into public.cosmetics (key, kind, title, required_achievement, sort_order) values
  ('frame_alpha', 'frame', 'Рамка альфа-тестера', 'alpha_tester', 15)
on conflict (key) do update set
  title = excluded.title,
  required_achievement = excluded.required_achievement,
  sort_order = excluded.sort_order;

/**
 * Declare a milestone reached, at a released version.
 *
 * Write-once on purpose. Moving the boundary later is the only way left to
 * manufacture an alpha or beta badge, so it is not something this function can
 * do — see `product_milestone_correct`, which can, and says so in the audit log.
 */
create or replace function public.product_milestone_set(
  p_key text,
  p_reached_at timestamptz,
  p_version text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_current timestamptz;
  v_found boolean := false;
begin
  if v_actor is null or not public.has_permission(v_actor, 'system.manage') then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_reached_at is null or p_version is null then
    raise exception 'milestone_incomplete' using errcode = 'P0001';
  end if;
  if p_reached_at > now() then
    -- A milestone cannot be reached in the future; that would keep the badge
    -- open while claiming it is closed.
    raise exception 'milestone_in_future' using errcode = 'P0001';
  end if;

  select milestone.reached_at, true into v_current, v_found
  from public.product_milestones milestone
  where milestone.key = p_key
  for update;

  if not coalesce(v_found, false) then
    raise exception 'milestone_not_found' using errcode = 'P0001';
  end if;
  if v_current is not null then
    raise exception 'milestone_already_reached' using errcode = 'P0001';
  end if;

  update public.product_milestones
  set reached_at = p_reached_at, version = p_version, updated_by = v_actor, updated_at = now()
  where key = p_key;

  insert into public.audit_logs (actor_id, action, target_kind, diff)
  values (
    v_actor,
    'product_milestone_set',
    'product_milestone',
    jsonb_build_object('key', p_key, 'reached_at', p_reached_at, 'version', p_version)
  );
  return true;
end
$function$;

/**
 * Correct a milestone that was recorded wrongly.
 *
 * Separated from `product_milestone_set` so that moving a boundary is never an
 * accident and never silent: it needs a reason and it lands in the audit log
 * with the value it replaced.
 */
create or replace function public.product_milestone_correct(
  p_key text,
  p_reached_at timestamptz,
  p_version text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_before public.product_milestones%rowtype;
begin
  if v_actor is null or not public.has_permission(v_actor, 'system.manage') then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    raise exception 'milestone_reason_required' using errcode = 'P0001';
  end if;
  if p_reached_at is not null and p_reached_at > now() then
    raise exception 'milestone_in_future' using errcode = 'P0001';
  end if;

  select * into v_before from public.product_milestones where key = p_key for update;
  if not found then
    raise exception 'milestone_not_found' using errcode = 'P0001';
  end if;

  update public.product_milestones
  set reached_at = p_reached_at, version = p_version, updated_by = v_actor, updated_at = now()
  where key = p_key;

  insert into public.audit_logs (actor_id, action, target_kind, diff)
  values (
    v_actor,
    'product_milestone_correct',
    'product_milestone',
    jsonb_build_object(
      'key', p_key,
      'reason', btrim(p_reason),
      'before', jsonb_build_object('reached_at', v_before.reached_at, 'version', v_before.version),
      'after', jsonb_build_object('reached_at', p_reached_at, 'version', p_version)
    )
  );
  return true;
end
$function$;

drop function if exists public.achievements_sync();

/**
 * Award what the person has earned, and report how far they are from the rest.
 *
 * Takes no arguments by design: every fact it acts on is the server's own — the
 * profile's creation time, the count of that person's messages, the recorded
 * milestones. A client can call it, and that is all a client can do.
 */
create or replace function public.achievements_sync()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_created timestamptz;
  v_messages bigint;
  v_now timestamptz := now();
  v_age_days numeric;
  v_row record;
  v_kind text;
  v_progress jsonb := '{}'::jsonb;
  v_grants jsonb := '[]'::jsonb;
  v_milestone public.product_milestones%rowtype;
  v_target numeric;
  v_current numeric;
  v_qualifies boolean;
  v_evidence jsonb;
begin
  if v_user is null then
    return jsonb_build_object('earned', '[]'::jsonb, 'progress', '{}'::jsonb);
  end if;

  select profile.created_at into v_created
  from public.profiles profile
  where profile.id = v_user;
  if not found then
    return jsonb_build_object('earned', '[]'::jsonb, 'progress', '{}'::jsonb);
  end if;

  select count(*) into v_messages
  from public.messages message
  where message.user_id = v_user
    and message.deleted_at is null;

  v_age_days := extract(epoch from (v_now - v_created)) / 86400.0;

  for v_row in
    select definition.key, definition.criteria
    from public.achievements definition
    where definition.active
  loop
    v_kind := v_row.criteria ->> 'kind';
    v_qualifies := false;
    v_target := null;
    v_current := null;
    v_evidence := jsonb_build_object('criteria', v_row.criteria, 'registered_at', v_created);

    if v_kind = 'registered_before_milestone' then
      select * into v_milestone
      from public.product_milestones
      where key = v_row.criteria ->> 'milestone';
      -- A criterion pointing at a milestone that does not exist grants nothing.
      if found then
        v_qualifies := v_milestone.reached_at is null or v_created < v_milestone.reached_at;
        v_evidence := v_evidence || jsonb_build_object(
          'milestone', v_milestone.key,
          'milestone_reached_at', v_milestone.reached_at,
          'milestone_version', v_milestone.version
        );
      end if;

    elsif v_kind = 'account_age_days' then
      v_target := (v_row.criteria ->> 'days')::numeric;
      v_current := floor(v_age_days);
      v_qualifies := v_current >= v_target;
      v_evidence := v_evidence || jsonb_build_object('account_age_days', v_current);

    elsif v_kind = 'messages_sent' then
      v_target := (v_row.criteria ->> 'count')::numeric;
      v_current := v_messages;
      v_qualifies := v_current >= v_target;
      v_evidence := v_evidence || jsonb_build_object('messages_sent', v_current);
    end if;

    if v_qualifies and v_kind is distinct from 'manual' then
      v_grants := v_grants || jsonb_build_array(
        jsonb_build_object('key', v_row.key, 'evidence', v_evidence)
      );
    end if;

    if v_target is not null and not v_qualifies then
      v_progress := v_progress || jsonb_build_object(
        v_row.key,
        jsonb_build_object('current', v_current, 'target', v_target)
      );
    end if;
  end loop;

  insert into public.user_achievements (user_id, achievement_key, granted_by, evidence)
  select v_user, grant_row ->> 'key', null, grant_row -> 'evidence'
  from jsonb_array_elements(v_grants) as grant_row
  on conflict (user_id, achievement_key) do nothing;

  return jsonb_build_object(
    'earned',
    coalesce(
      (
        select jsonb_agg(owned.achievement_key order by owned.achievement_key)
        from public.user_achievements owned
        where owned.user_id = v_user
      ),
      '[]'::jsonb
    ),
    'progress', v_progress
  );
end
$function$;

drop function if exists public.product_milestone_set(text, timestamptz);

revoke all on function public.achievements_sync() from public, anon;
revoke all on function public.product_milestone_set(text, timestamptz, text) from public, anon;
revoke all on function public.product_milestone_correct(text, timestamptz, text, text) from public, anon;
grant execute on function public.achievements_sync() to authenticated;
grant execute on function public.product_milestone_set(text, timestamptz, text) to authenticated;
grant execute on function public.product_milestone_correct(text, timestamptz, text, text) to authenticated;
