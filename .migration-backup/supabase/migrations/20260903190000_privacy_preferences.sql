-- Privacy preferences, first slice: whether a person publishes their presence.
--
-- The constraint this is built under: nothing here may stop a member of staff
-- finding a colleague or writing to them. Presence satisfies that — hiding when
-- you were last online changes neither search nor the ability to message you.
--
-- It is honest privacy rather than a display filter. `profiles.online_at` is
-- written by the person's own client on a heartbeat; when they turn presence
-- off the client stops publishing and clears the value, so there is nothing
-- stored for anyone — staff included — to read. A setting that kept storing the
-- timestamp and merely hid it in one interface would be worse than none.
--
-- Additive and idempotent: a new table, its policies and a trigger. Nothing
-- existing is altered.

create table if not exists public.privacy_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  -- Publish "last seen" and the online dot to other people.
  presence_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.privacy_preferences enable row level security;

-- A person reads and writes their own row and no one else's. There is
-- deliberately no staff read policy: the preference itself is not something
-- anyone needs to see, because its effect is the absence of data.
drop policy if exists "privacy_preferences own select" on public.privacy_preferences;
create policy "privacy_preferences own select"
  on public.privacy_preferences for select
  using (auth.uid() = user_id);

drop policy if exists "privacy_preferences own insert" on public.privacy_preferences;
create policy "privacy_preferences own insert"
  on public.privacy_preferences for insert
  with check (auth.uid() = user_id);

drop policy if exists "privacy_preferences own update" on public.privacy_preferences;
create policy "privacy_preferences own update"
  on public.privacy_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "privacy_preferences own delete" on public.privacy_preferences;
create policy "privacy_preferences own delete"
  on public.privacy_preferences for delete
  using (auth.uid() = user_id);

create or replace function public.privacy_preferences_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists privacy_preferences_set_updated_at on public.privacy_preferences;
create trigger privacy_preferences_set_updated_at
  before update on public.privacy_preferences
  for each row execute function public.privacy_preferences_touch_updated_at();

grant select, insert, update, delete on public.privacy_preferences to authenticated;
