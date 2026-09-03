-- Achievements, and the profile decoration they unlock.
--
-- The decoration is visible to everyone, which is the whole point of earning
-- it — and also the reason the entitlement is enforced here rather than in the
-- interface. `profiles` is updatable by its owner, so a frame chosen only in
-- the client could be set to the tester's frame by anyone with a REST client,
-- and the badge would mean nothing.
--
-- The split is deliberate: this schema holds *identity and entitlement* — which
-- achievements exist, who has them, which decoration each one unlocks — while
-- what a frame actually looks like stays in the application, keyed by the same
-- id. A decoration the running build does not recognise simply renders plain,
-- so the two can move independently.
--
-- Additive: three new tables, two new nullable columns, one trigger, three
-- functions. Nothing existing changes behaviour.

create table if not exists public.achievements (
  key text primary key,
  title text not null,
  description text not null,
  icon text not null default 'crown',
  -- 'auto' is granted by achievements_sync; 'manual' only by a person with
  -- users.manage. A tester's badge cannot be earned by using the product.
  grant_kind text not null default 'auto' check (grant_kind in ('auto', 'manual')),
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.user_achievements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_key text not null references public.achievements(key) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id) on delete set null,
  primary key (user_id, achievement_key)
);

create index if not exists user_achievements_user_idx
  on public.user_achievements (user_id);

create table if not exists public.cosmetics (
  key text primary key,
  kind text not null check (kind in ('frame', 'background')),
  title text not null,
  -- null means everyone may use it.
  required_achievement text references public.achievements(key) on delete restrict,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists profile_frame text references public.cosmetics(key) on delete set null;
alter table public.profiles
  add column if not exists profile_background text references public.cosmetics(key) on delete set null;

-- Catalogues are public knowledge: a person should be able to see what exists
-- and what it takes, including before they have earned it. Badges are public
-- too — being seen is what they are for.
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.cosmetics enable row level security;

drop policy if exists "achievements readable" on public.achievements;
create policy "achievements readable" on public.achievements for select using (true);

drop policy if exists "cosmetics readable" on public.cosmetics;
create policy "cosmetics readable" on public.cosmetics for select using (true);

drop policy if exists "user achievements readable" on public.user_achievements;
create policy "user achievements readable" on public.user_achievements for select using (true);

-- No write policy on any of the three: every grant goes through a function, so
-- nobody can award themselves a badge by writing a row.
grant select on public.achievements to anon, authenticated;
grant select on public.cosmetics to anon, authenticated;
grant select on public.user_achievements to anon, authenticated;

/**
 * Refuse a decoration the person has not earned.
 *
 * Only a *changed* value is checked, so an administrator editing someone
 * else's name never trips over a decoration that account is entitled to.
 */
create or replace function public.profiles_validate_cosmetics()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_key text;
  v_kind text;
begin
  foreach v_key in array array[new.profile_frame, new.profile_background] loop
    continue when v_key is null;
    v_kind := case when v_key is not distinct from new.profile_frame then 'frame' else 'background' end;

    -- Unchanged values are left alone: this guards the act of choosing, not
    -- every later write to the row.
    continue when tg_op = 'UPDATE'
      and v_key is not distinct from (
        case when v_kind = 'frame' then old.profile_frame else old.profile_background end
      );

    if not exists (
      select 1
      from public.cosmetics item
      where item.key = v_key
        and item.kind = v_kind
        and item.active
        and (
          item.required_achievement is null
          or exists (
            select 1
            from public.user_achievements owned
            where owned.user_id = new.id
              and owned.achievement_key = item.required_achievement
          )
        )
    ) then
      raise exception 'cosmetic_not_unlocked' using errcode = 'P0001';
    end if;
  end loop;

  return new;
end
$function$;

drop trigger if exists profiles_validate_cosmetics on public.profiles;
create trigger profiles_validate_cosmetics
  before insert or update of profile_frame, profile_background on public.profiles
  for each row execute function public.profiles_validate_cosmetics();

/**
 * Award what the person has already earned.
 *
 * Called by the client when the profile loads. It is idempotent, cheap enough
 * to run on every load — the counting query rides `messages_user_id_idx` — and
 * grants nothing that is not true at the moment it runs.
 */
create or replace function public.achievements_sync()
returns setof text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_created timestamptz;
  v_messages bigint;
  v_now timestamptz := now();
  v_earned text[] := array[]::text[];
begin
  if v_user is null then
    return;
  end if;

  select profile.created_at into v_created
  from public.profiles profile
  where profile.id = v_user;
  if not found then
    return;
  end if;

  select count(*) into v_messages
  from public.messages message
  where message.user_id = v_user
    and message.deleted_at is null;

  if v_created < timestamptz '2027-01-01 00:00:00+00' then
    v_earned := v_earned || 'early_adopter'::text;
  end if;
  if v_now - v_created >= interval '30 days' then
    v_earned := v_earned || 'settled_in'::text;
  end if;
  if v_now - v_created >= interval '365 days' then
    v_earned := v_earned || 'veteran'::text;
  end if;
  if v_messages >= 100 then
    v_earned := v_earned || 'conversationalist'::text;
  end if;
  if v_messages >= 1000 then
    v_earned := v_earned || 'storyteller'::text;
  end if;

  insert into public.user_achievements (user_id, achievement_key, granted_by)
  select v_user, candidate.key, null
  from unnest(v_earned) as candidate(key)
  join public.achievements definition
    on definition.key = candidate.key
   and definition.active
   and definition.grant_kind = 'auto'
  on conflict (user_id, achievement_key) do nothing;

  return query
    select owned.achievement_key
    from public.user_achievements owned
    where owned.user_id = v_user;
end
$function$;

/**
 * Award or withdraw a manual badge — a tester's, for instance — which by
 * definition cannot be earned by using the product.
 */
create or replace function public.achievement_grant(
  p_user_id uuid,
  p_key text,
  p_granted boolean default true
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.has_permission(v_actor, 'users.manage') then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.achievements definition
    where definition.key = p_key and definition.grant_kind = 'manual'
  ) then
    raise exception 'achievement_not_grantable' using errcode = 'P0001';
  end if;

  if p_granted then
    insert into public.user_achievements (user_id, achievement_key, granted_by)
    values (p_user_id, p_key, v_actor)
    on conflict (user_id, achievement_key) do nothing;
  else
    delete from public.user_achievements
    where user_id = p_user_id and achievement_key = p_key;
    -- Withdrawing the badge withdraws what it unlocked, or the decoration
    -- would outlive the thing it was meant to prove.
    update public.profiles profile
    set profile_frame = case
          when profile.profile_frame in (
            select item.key from public.cosmetics item where item.required_achievement = p_key
          ) then null else profile.profile_frame end,
        profile_background = case
          when profile.profile_background in (
            select item.key from public.cosmetics item where item.required_achievement = p_key
          ) then null else profile.profile_background end
    where profile.id = p_user_id;
  end if;

  return true;
end
$function$;

revoke all on function public.achievements_sync() from public, anon;
revoke all on function public.achievement_grant(uuid, text, boolean) from public, anon;
grant execute on function public.achievements_sync() to authenticated;
grant execute on function public.achievement_grant(uuid, text, boolean) to authenticated;

-- The catalogue. Titles and descriptions live here so an operator can read
-- them; how a frame is drawn lives in the application.
insert into public.achievements (key, title, description, icon, grant_kind, sort_order) values
  ('tester',            'Тестировщик',      'Помогал проверять LETSCUBE до релиза',      'shield',   'manual', 10),
  ('early_adopter',     'Первопроходец',    'Зарегистрировался в первый год LETSCUBE',   'zap',      'auto',   20),
  ('settled_in',        'Освоился',         'В LETSCUBE больше месяца',                  'check',    'auto',   30),
  ('veteran',           'Ветеран',          'В LETSCUBE больше года',                    'crown',    'auto',   40),
  ('conversationalist', 'Собеседник',       'Отправил 100 сообщений',                    'chats',    'auto',   50),
  ('storyteller',       'Рассказчик',       'Отправил 1000 сообщений',                   'chatRect', 'auto',   60)
on conflict (key) do update set
  title = excluded.title,
  description = excluded.description,
  icon = excluded.icon,
  grant_kind = excluded.grant_kind,
  sort_order = excluded.sort_order;

insert into public.cosmetics (key, kind, title, required_achievement, sort_order) values
  ('frame_tester',   'frame',      'Рамка тестировщика', 'tester',            10),
  ('frame_early',    'frame',      'Рамка первопроходца','early_adopter',     20),
  ('frame_veteran',  'frame',      'Рамка ветерана',     'veteran',           30),
  ('frame_talker',   'frame',      'Рамка собеседника',  'conversationalist', 40),
  ('bg_aurora',      'background', 'Северное сияние',    'settled_in',        10),
  ('bg_circuit',     'background', 'Схема',              'conversationalist', 20),
  ('bg_prism',       'background', 'Призма',             'tester',            30)
on conflict (key) do update set
  kind = excluded.kind,
  title = excluded.title,
  required_achievement = excluded.required_achievement,
  sort_order = excluded.sort_order;
