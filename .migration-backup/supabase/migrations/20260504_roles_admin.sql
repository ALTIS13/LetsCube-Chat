-- Roles & Admin Panel (Part 5)
--
-- Adds a global role to every profile (admin / manager / user), tables for
-- bans and mutes, helper SECURITY DEFINER functions used by RLS, and a
-- bootstrap trigger that turns the very first profile into an admin.
--
-- This migration is idempotent: it can be re-applied without errors.

-- ── 1. role enum + column ──────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'manager', 'user');
  end if;
end $$;

alter table public.profiles
  add column if not exists role public.app_role not null default 'user';

create index if not exists idx_profiles_role on public.profiles(role);

-- ── 2. bans table ──────────────────────────────────────────────────────────
create table if not exists public.bans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  reason      text not null,
  expires_at  timestamptz,
  issued_by   uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_bans_user on public.bans(user_id);

-- ── 3. mutes table (chat_id = null → global mute) ──────────────────────────
create table if not exists public.mutes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  chat_id     uuid references public.chats(id) on delete cascade,
  reason      text not null,
  expires_at  timestamptz,
  issued_by   uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_mutes_user on public.mutes(user_id);
create index if not exists idx_mutes_user_chat on public.mutes(user_id, chat_id);

-- ── 4. helper SECURITY DEFINER functions used by RLS ───────────────────────
-- They run with the function-owner's rights so RLS doesn't recurse infinitely
-- when policies refer back to profiles / bans / mutes.

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role = 'admin'
  )
$$;

create or replace function public.is_manager_or_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role in ('admin','manager')
  )
$$;

create or replace function public.is_banned(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.bans
    where user_id = uid
      and (expires_at is null or expires_at > now())
  )
$$;

-- chat_id may be null when checking the "global mute" case alone.
create or replace function public.is_muted(uid uuid, cid uuid default null)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.mutes
    where user_id = uid
      and (chat_id is null or chat_id = cid)
      and (expires_at is null or expires_at > now())
  )
$$;

grant execute on function public.is_admin(uuid) to authenticated, anon;
grant execute on function public.is_manager_or_admin(uuid) to authenticated, anon;
grant execute on function public.is_banned(uuid) to authenticated, anon;
grant execute on function public.is_muted(uuid, uuid) to authenticated, anon;

-- ── 5. RLS — bans ──────────────────────────────────────────────────────────
alter table public.bans enable row level security;

drop policy if exists "managers read all bans" on public.bans;
create policy "managers read all bans"
  on public.bans for select
  using (public.is_manager_or_admin(auth.uid()));

-- Self-read is restricted to ACTIVE bans only — past bans are not the
-- user's business; staff still see history via "managers read all bans".
drop policy if exists "user reads own bans" on public.bans;
create policy "user reads own bans"
  on public.bans for select
  using (
    user_id = auth.uid()
    and (expires_at is null or expires_at > now())
  );

drop policy if exists "managers insert bans" on public.bans;
create policy "managers insert bans"
  on public.bans for insert
  with check (public.is_manager_or_admin(auth.uid()));

drop policy if exists "managers delete bans" on public.bans;
create policy "managers delete bans"
  on public.bans for delete
  using (public.is_manager_or_admin(auth.uid()));

-- ── 6. RLS — mutes ─────────────────────────────────────────────────────────
alter table public.mutes enable row level security;

drop policy if exists "managers read all mutes" on public.mutes;
create policy "managers read all mutes"
  on public.mutes for select
  using (public.is_manager_or_admin(auth.uid()));

-- Same active-only rule for mutes.
drop policy if exists "user reads own mutes" on public.mutes;
create policy "user reads own mutes"
  on public.mutes for select
  using (
    user_id = auth.uid()
    and (expires_at is null or expires_at > now())
  );

drop policy if exists "managers insert mutes" on public.mutes;
create policy "managers insert mutes"
  on public.mutes for insert
  with check (public.is_manager_or_admin(auth.uid()));

drop policy if exists "managers delete mutes" on public.mutes;
create policy "managers delete mutes"
  on public.mutes for delete
  using (public.is_manager_or_admin(auth.uid()));

-- ── 7. profiles — let admins/managers update profiles ──────────────────────
-- The existing self-update policy ("Users update own profile" or similar)
-- stays in place; this one ADDs another permissive option.
--   • admins can update any profile (including other admins)
--   • managers can update users + other managers, never admins —
--     this matches the sanction matrix and the role-change matrix
drop policy if exists "Admins update any profile" on public.profiles;
create policy "Admins update any profile"
  on public.profiles for update
  using (
    public.is_admin(auth.uid())
    or (
      public.is_manager_or_admin(auth.uid())
      and role <> 'admin'::public.app_role
    )
  )
  with check (
    public.is_admin(auth.uid())
    or (
      public.is_manager_or_admin(auth.uid())
      and role <> 'admin'::public.app_role
    )
  );

-- Ensure managers/admins can read every profile (for the Users tab).
-- Self-read continues to work via existing policies.
drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles"
  on public.profiles for select
  using (public.is_manager_or_admin(auth.uid()));

-- ── 8. messages — block muted/banned users from inserting ──────────────────
-- A RESTRICTIVE policy AND-combines with all permissive insert policies, so
-- this acts as a hard veto regardless of the user's chat membership.
drop policy if exists "block muted/banned from sending" on public.messages;
create policy "block muted/banned from sending"
  on public.messages
  as restrictive
  for insert
  with check (
    not public.is_banned(auth.uid())
    and not public.is_muted(auth.uid(), chat_id)
  );

-- ── 9. Last-admin guard ────────────────────────────────────────────────────
-- Block any UPDATE that would leave the system without an admin.
--
-- Race-safety: two concurrent transactions could each demote a different
-- admin, observe `remaining > 0` and both commit, leaving zero admins.  We
-- serialise these checks with a transaction-scoped advisory lock so any
-- demotion of an admin row blocks until the previous one has committed.
--
-- Note on trigger style: the original task plan suggested a DEFERRED
-- constraint trigger.  Postgres only supports `DEFERRABLE` on triggers
-- defined `CONSTRAINT TRIGGER` AFTER row events, and constraint triggers
-- can't easily peek at OLD row values for the count predicate without
-- losing the immediate-error UX (the failure would be reported at COMMIT
-- instead of at the offending statement).  An immediate BEFORE UPDATE
-- trigger paired with `pg_advisory_xact_lock` gives the same race-safety
-- guarantee — the lock is released only at commit/rollback, so two
-- concurrent demotions of distinct admins are forced to run serially —
-- and produces a clearer error at the right place in the call stack.
create or replace function public.prevent_demoting_last_admin()
returns trigger
language plpgsql
as $$
declare
  remaining int;
begin
  if old.role = 'admin' and new.role <> 'admin' then
    -- 4242 is an arbitrary key shared by all "admin demotion" transactions.
    perform pg_advisory_xact_lock(4242);
    select count(*) into remaining
      from public.profiles
      where role = 'admin' and id <> old.id;
    if remaining = 0 then
      raise exception 'Нельзя снять последнего администратора'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_prevent_demoting_last_admin on public.profiles;
create trigger trg_prevent_demoting_last_admin
  before update of role on public.profiles
  for each row execute function public.prevent_demoting_last_admin();

-- ── 9b. Role-change matrix enforcement ─────────────────────────────────────
-- The existing "users update own profile" RLS policy is row-level, not
-- column-level, so without this trigger any user could PATCH their own row
-- with `role = 'admin'`.  We enforce the full matrix here:
--   admin   → can change any role to any role (last-admin guard runs in
--             a separate trigger above)
--   manager → can move users between `user` and `manager`; cannot touch
--             rows that already have role `admin`, and cannot promote
--             anyone to `admin`
--   user    → cannot change anyone's role
--   service / SQL (auth.uid() is null) → unrestricted
create or replace function public.enforce_role_change_matrix()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_role public.app_role;
begin
  -- No change → nothing to check.
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- DB / SQL admin without a session: allow.
  if caller is null then
    return new;
  end if;

  select role into caller_role from public.profiles where id = caller;

  if caller_role = 'admin' then
    return new;            -- full control; last-admin guard handles edge case
  end if;

  if caller_role = 'manager' then
    -- Managers may only flip between user ↔ manager.
    if old.role = 'admin' or new.role = 'admin' then
      raise exception 'Менеджер не может изменять роль администратора'
        using errcode = '42501';
    end if;
    if new.role not in ('user','manager') then
      raise exception 'Недопустимая роль для менеджера'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Только администратор или менеджер может менять роли'
    using errcode = '42501';
end $$;

drop trigger if exists trg_prevent_self_role_escalation on public.profiles;
drop trigger if exists trg_enforce_role_change_matrix on public.profiles;
create trigger trg_enforce_role_change_matrix
  before update of role on public.profiles
  for each row execute function public.enforce_role_change_matrix();

-- ── 9c. SECURITY DEFINER helper: emails for staff UI ───────────────────────
-- The Users tab needs to show each user's email.  `auth.users` is locked down
-- by Supabase, so we expose a narrow function that only managers/admins may
-- call.  Returns rows like `(user_id, email)`.
create or replace function public.admin_user_emails(uids uuid[])
returns table (id uuid, email text)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_manager_or_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text
      from auth.users u
     where u.id = any(uids);
end $$;

revoke all on function public.admin_user_emails(uuid[]) from public;
grant execute on function public.admin_user_emails(uuid[]) to authenticated;

-- ── 10. Bootstrap first admin ──────────────────────────────────────────────
-- When a profile is inserted and no admin exists yet, promote it.
-- An optional GUC `app.bootstrap_admin_email` lets the operator point at a
-- specific email; if set, only the matching user is promoted (regardless of
-- whether other admins exist).  Set it via:
--   alter database postgres set app.bootstrap_admin_email = 'you@example.com';
create or replace function public.bootstrap_first_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  configured_email text;
  matched          boolean := false;
  admin_count      int;
begin
  -- Try to read the configured "designated admin" email.  Wrapped in a
  -- begin/exception block because current_setting() raises if the GUC has
  -- never been set in this session/database.
  begin
    configured_email := current_setting('app.bootstrap_admin_email', true);
  exception when others then
    configured_email := null;
  end;

  if configured_email is not null and length(configured_email) > 0 then
    -- Designated email mode: ONLY the matching user becomes admin.  We
    -- intentionally do not fall back to "first user becomes admin" — the
    -- operator picked an explicit person and the first random signup must
    -- not be promoted just because that person hasn't signed up yet.
    select exists (
      select 1 from auth.users
       where id = new.id and lower(email) = lower(configured_email)
    ) into matched;
    if matched then
      new.role := 'admin';
    end if;
    return new;
  end if;

  -- No designated email → "first user becomes admin" mode.
  select count(*) into admin_count from public.profiles where role = 'admin';
  if admin_count = 0 then
    new.role := 'admin';
  end if;
  return new;
end $$;

drop trigger if exists trg_bootstrap_first_admin on public.profiles;
create trigger trg_bootstrap_first_admin
  before insert on public.profiles
  for each row execute function public.bootstrap_first_admin();

-- ── 10b. Hard lock for banned users (reads AND writes) ─────────────────────
-- Bans must mean more than "you can't send messages": a banned user must not
-- be able to mutate or read any application data while the ban is active.
-- We add RESTRICTIVE policies on every writable table for INSERT/UPDATE/DELETE
-- and on every "content" table for SELECT — RESTRICTIVE policies AND with all
-- permissive policies, so they act as a hard veto.
--
-- `profiles` gets a narrowed SELECT veto: banned users may only read their
-- own profile row (needed for the BannedScreen / sign-out flow).  All
-- other profile reads are blocked while a ban is active.  The `bans` /
-- `mutes` tables are exempted entirely (we still want unban/unmute to be
-- possible by staff, and the affected user must be able to read their own
-- ban row to render the overlay).
drop policy if exists "block banned reads (self only on profiles)" on public.profiles;
create policy "block banned reads (self only on profiles)"
  on public.profiles
  as restrictive
  for select
  using (not public.is_banned(auth.uid()) or id = auth.uid());
do $$
declare
  t text;
  -- Tables that get the full INSERT/UPDATE/DELETE veto:
  write_tables text[] := array[
    'profiles', 'chats', 'chat_members', 'messages', 'reactions',
    'topics', 'folders', 'folder_chats', 'push_subscriptions'
  ];
  -- Tables that also get a SELECT veto (don't block self-profile reads):
  read_tables text[] := array[
    'chats', 'chat_members', 'messages', 'reactions',
    'topics', 'folders', 'folder_chats'
  ];
begin
  foreach t in array write_tables loop
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', 'block banned writes (insert)', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert with check (not public.is_banned(auth.uid()))',
      'block banned writes (insert)', t
    );

    execute format('drop policy if exists %I on public.%I', 'block banned writes (update)', t);
    execute format(
      'create policy %I on public.%I as restrictive for update using (not public.is_banned(auth.uid())) with check (not public.is_banned(auth.uid()))',
      'block banned writes (update)', t
    );

    execute format('drop policy if exists %I on public.%I', 'block banned writes (delete)', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete using (not public.is_banned(auth.uid()))',
      'block banned writes (delete)', t
    );
  end loop;

  foreach t in array read_tables loop
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', 'block banned reads', t);
    execute format(
      'create policy %I on public.%I as restrictive for select using (not public.is_banned(auth.uid()))',
      'block banned reads', t
    );
  end loop;
end $$;

-- ── 10c. Sanction matrix — managers cannot touch admins ────────────────────
-- The Users tab UI already hides ban/mute actions on admin rows for
-- managers, but UI is never the security boundary.  This trigger enforces
-- the same rule at the DB level on `bans` and `mutes`.
--   • admin caller → may sanction anyone (cannot sanction self)
--   • manager      → may sanction users / managers, never admins
--   • everyone else (including SQL with auth.uid() null) is allowed —
--     SQL admins / service-role tools must keep working.
create or replace function public.enforce_sanction_matrix()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller       uuid := auth.uid();
  caller_role  public.app_role;
  target_role  public.app_role;
begin
  if caller is null then
    return new;  -- service role / SQL session
  end if;

  if new.user_id = caller then
    raise exception 'Нельзя применять санкции к самому себе'
      using errcode = '42501';
  end if;

  select role into caller_role from public.profiles where id = caller;
  select role into target_role from public.profiles where id = new.user_id;

  if caller_role = 'admin' then
    return new;
  end if;

  if caller_role = 'manager' then
    if target_role = 'admin' then
      raise exception 'Менеджер не может применять санкции к администратору'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Только администратор или менеджер может применять санкции'
    using errcode = '42501';
end $$;

drop trigger if exists trg_enforce_sanction_matrix_bans on public.bans;
create trigger trg_enforce_sanction_matrix_bans
  before insert on public.bans
  for each row execute function public.enforce_sanction_matrix();

drop trigger if exists trg_enforce_sanction_matrix_mutes on public.mutes;
create trigger trg_enforce_sanction_matrix_mutes
  before insert on public.mutes
  for each row execute function public.enforce_sanction_matrix();

-- ── 11. Realtime publication ───────────────────────────────────────────────
-- So the React app reacts immediately when an admin bans / mutes / promotes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bans'
  ) then
    execute 'alter publication supabase_realtime add table public.bans';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mutes'
  ) then
    execute 'alter publication supabase_realtime add table public.mutes';
  end if;
  -- profiles is normally already in the publication; add if missing so
  -- role changes propagate live.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    execute 'alter publication supabase_realtime add table public.profiles';
  end if;
end $$;
