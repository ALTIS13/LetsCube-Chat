-- Make the earning conditions explicit data instead of code.
--
-- The previous sync had its thresholds written into the function body, which
-- meant every "100 messages instead of 50" was a migration, and the one
-- condition that genuinely cannot be known yet — the date LETSCUBE leaves beta
-- — had to be guessed at. Now each achievement carries its own criteria and the
-- dates live in a milestone table.
--
-- The beta badge is the reason for the milestone table. Its condition is
-- "registered before 1.0", and 1.0 has not shipped: while `reached_at` is null
-- the product is still in beta, so everyone who registers earns it. On the day
-- the date is recorded the badge freezes to the people who were already here,
-- which is exactly what it is supposed to mean, and needs no code change.
--
-- Additive: one new table, one new column, two rewritten functions.

create table if not exists public.product_milestones (
  key text primary key,
  title text not null,
  -- Null means the milestone has not been reached yet.
  reached_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.product_milestones enable row level security;

drop policy if exists "product milestones readable" on public.product_milestones;
create policy "product milestones readable"
  on public.product_milestones for select using (true);

grant select on public.product_milestones to anon, authenticated;

insert into public.product_milestones (key, title, reached_at) values
  ('v1_0', 'Выход LETSCUBE 1.0', null)
on conflict (key) do nothing;

/**
 * How an achievement is earned.
 *
 * Recognised shapes:
 *   {"kind":"manual"}                                    – granted by a person
 *   {"kind":"registered_before_milestone","milestone":"v1_0"}
 *   {"kind":"account_age_days","days":30}
 *   {"kind":"messages_sent","count":100}
 *
 * A shape the sync does not recognise grants nothing, so an unknown criterion
 * fails closed rather than handing out a badge.
 */
alter table public.achievements
  add column if not exists criteria jsonb not null default '{"kind":"manual"}'::jsonb;

update public.achievements set criteria = '{"kind":"manual"}'::jsonb
  where key = 'tester';
update public.achievements set criteria = '{"kind":"account_age_days","days":30}'::jsonb
  where key = 'settled_in';
update public.achievements set criteria = '{"kind":"account_age_days","days":365}'::jsonb
  where key = 'veteran';
update public.achievements set criteria = '{"kind":"messages_sent","count":100}'::jsonb
  where key = 'conversationalist';
update public.achievements set criteria = '{"kind":"messages_sent","count":1000}'::jsonb
  where key = 'storyteller';

-- `early_adopter` guessed at a hard-coded date. It becomes the beta badge, tied
-- to the milestone instead. Both keys are referenced by foreign keys, so this
-- is written as move-then-remove rather than an in-place rename: it is a no-op
-- today, when nothing has been granted or worn, and it would still carry
-- someone's history correctly if it were not.
insert into public.achievements (key, title, description, icon, grant_kind, sort_order, criteria)
values (
  'beta_tester',
  'Бета-тестер',
  'Был с LETSCUBE до выхода 1.0',
  'zap',
  'auto',
  20,
  '{"kind":"registered_before_milestone","milestone":"v1_0"}'::jsonb
)
on conflict (key) do update set
  title = excluded.title,
  description = excluded.description,
  icon = excluded.icon,
  grant_kind = excluded.grant_kind,
  sort_order = excluded.sort_order,
  criteria = excluded.criteria;

insert into public.cosmetics (key, kind, title, required_achievement, sort_order)
values ('frame_beta', 'frame', 'Рамка бета-тестера', 'beta_tester', 20)
on conflict (key) do update set
  title = excluded.title,
  required_achievement = excluded.required_achievement,
  sort_order = excluded.sort_order;

update public.profiles set profile_frame = 'frame_beta' where profile_frame = 'frame_early';
delete from public.cosmetics where key = 'frame_early';

update public.user_achievements set achievement_key = 'beta_tester'
  where achievement_key = 'early_adopter'
    and not exists (
      select 1 from public.user_achievements existing
      where existing.user_id = user_achievements.user_id
        and existing.achievement_key = 'beta_tester'
    );
delete from public.user_achievements where achievement_key = 'early_adopter';
delete from public.achievements where key = 'early_adopter';

/**
 * Award what the person has earned, and report how far they are from the rest.
 *
 * Returns `{"earned": [...], "progress": {"<key>": {"current": n, "target": n}}}`
 * so the interface can show the distance to a badge rather than only its
 * absence — the difference between "not yet" and "how".
 */
-- The return type changes from `setof text` to a document carrying progress,
-- and Postgres will not replace a function across that change.
drop function if exists public.achievements_sync();

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
  v_earned text[] := array[]::text[];
  v_progress jsonb := '{}'::jsonb;
  v_milestone timestamptz;
  v_milestone_found boolean;
  v_target numeric;
  v_current numeric;
  v_qualifies boolean;
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

    if v_kind = 'registered_before_milestone' then
      select milestone.reached_at, true
        into v_milestone, v_milestone_found
      from public.product_milestones milestone
      where milestone.key = v_row.criteria ->> 'milestone';
      -- No such milestone is a misconfiguration, not an open door.
      if coalesce(v_milestone_found, false) then
        v_qualifies := v_milestone is null or v_created < v_milestone;
      end if;
      v_milestone_found := false;

    elsif v_kind = 'account_age_days' then
      v_target := (v_row.criteria ->> 'days')::numeric;
      v_current := floor(v_age_days);
      v_qualifies := v_current >= v_target;

    elsif v_kind = 'messages_sent' then
      v_target := (v_row.criteria ->> 'count')::numeric;
      v_current := v_messages;
      v_qualifies := v_current >= v_target;
    end if;

    if v_qualifies and v_kind is distinct from 'manual' then
      v_earned := v_earned || v_row.key;
    end if;

    if v_target is not null and not v_qualifies then
      v_progress := v_progress || jsonb_build_object(
        v_row.key,
        jsonb_build_object('current', v_current, 'target', v_target)
      );
    end if;
  end loop;

  insert into public.user_achievements (user_id, achievement_key, granted_by)
  select v_user, candidate.key, null
  from unnest(v_earned) as candidate(key)
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

/** Record that a milestone has been reached, which freezes the badges tied to it. */
create or replace function public.product_milestone_set(
  p_key text,
  p_reached_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.has_permission(v_actor, 'system.manage') then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  update public.product_milestones
  set reached_at = p_reached_at, updated_by = v_actor, updated_at = now()
  where key = p_key;

  if not found then
    raise exception 'milestone_not_found' using errcode = 'P0001';
  end if;
  return true;
end
$function$;

revoke all on function public.achievements_sync() from public, anon;
revoke all on function public.product_milestone_set(text, timestamptz) from public, anon;
grant execute on function public.achievements_sync() to authenticated;
grant execute on function public.product_milestone_set(text, timestamptz) to authenticated;
