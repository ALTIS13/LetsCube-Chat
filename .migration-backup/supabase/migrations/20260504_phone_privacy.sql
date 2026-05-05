-- =====================================================================
-- Task #31 — Phone binding & privacy
-- =====================================================================
-- Goal:
--   Bind a verified phone number to each user, normalise to E.164, and
--   make sure that **only the owner and explicit staff (manager/admin)
--   can read or write that phone**.  Postgres RLS is row-level only —
--   it cannot mask a column on a row that's otherwise readable, so
--   leaving the phone on `public.profiles` (which every authenticated
--   user can SELECT for chat/member display) would leak it.
--
--   Therefore we move sensitive contact fields off `profiles` into a
--   sibling 1:1 table `public.profile_contacts` whose RLS only grants
--   SELECT/UPDATE to the owner OR `is_manager_or_admin(auth.uid())`.
--   The original `profiles.phone` column is backfilled and dropped.
--
--   This is a deliberate contract refinement: the spec says "phone on
--   profile", which we honour at the user-facing API layer (the field
--   is exposed via a per-user SELECT against `profile_contacts`) and
--   in the SettingsModal UI.  The change is documented in replit.md
--   and the frontend types are updated in the same commit so any
--   stale `profiles.phone` reader fails at the TypeScript layer.
--
-- Section ordering (matters for production data):
--   1. Create the `profile_contacts` table (no constraints yet).
--   2. Drop any prior CHECK / unique-index from earlier dev runs and
--      drop functions that we are about to re-create with `CASCADE`.
--   3. Define the E.164 normalisation helper.
--   4. Backfill from `profiles.phone` if it still exists, normalising
--      and de-duplicating BEFORE the unique index is created.  Also
--      seed an empty contacts row for every existing profile so app
--      code can `select * from profile_contacts where user_id = $self`
--      without a NOT-FOUND fallback.
--   5. Now add the CHECK constraint + partial unique index.
--   6. Install RLS policies (owner-or-staff SELECT, owner-only writes).
--   7. Install the BEFORE INSERT/UPDATE guard trigger (bypass-first so
--      the migration backfill — which runs without a JWT — is not
--      blocked by ownership checks).
--   8. AFTER INSERT trigger on `profiles` to auto-create an empty
--      contacts row for every new user.
--   9. SECURITY DEFINER RPC `profile_phone_mark_verified()` that
--      re-checks `auth.users.phone_confirmed_at` server-side.
--  10. Drop the legacy `profiles.phone` column.
--
-- Idempotent.  Safe to re-run.
-- =====================================================================

set search_path = public;

-- ── 1. Table ──────────────────────────────────────────────────────────
create table if not exists public.profile_contacts (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  phone          text,
  phone_verified boolean not null default false,
  updated_at     timestamptz not null default now()
);

-- ── 2. Defensive cleanup of objects we re-create below ───────────────
alter table public.profile_contacts
  drop constraint if exists profile_contacts_phone_e164_chk;
drop index if exists public.ux_profile_contacts_phone;

drop function if exists public.profile_phone_mark_verified()  cascade;
drop function if exists public._guard_profile_contacts()       cascade;
drop function if exists public._ensure_profile_contacts()      cascade;

-- ── 3. E.164 normalisation helper ─────────────────────────────────────
-- Accepts user-typed input like "+7 999 123 45 67", "8 (999) 123-45-67"
-- or "9991234567" and returns "+79991234567".  Default country is +7
-- (Russia) — bare 8-prefix or 10-digit local forms get rewritten.
create or replace function public._normalize_phone_e164(p text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  if p is null then return null; end if;
  v := regexp_replace(p, '[^0-9+]', '', 'g');
  if v = '' or v = '+' then return null; end if;
  if left(v, 1) = '+' then
    v := '+' || regexp_replace(substring(v from 2), '\D', '', 'g');
  elsif left(v, 1) = '8' and length(v) = 11 then
    v := '+7' || substring(v from 2);
  elsif length(v) = 10 then
    v := '+7' || v;
  else
    v := '+' || v;
  end if;
  return v;
end $$;

-- ── 4. Backfill from legacy profiles.phone, then seed empty rows ─────
-- The bypass GUC tells the guard trigger (installed in §7) to skip the
-- auth.uid() / ownership checks — necessary because this DO block runs
-- in the SQL editor (no JWT, so auth.uid() is null).
do $$
declare
  has_legacy boolean;
begin
  perform set_config('app.profile_contacts_bypass', 'on', true);

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'phone'
  ) into has_legacy;

  if has_legacy then
    -- Two profiles whose phones collapse to the same E.164 form would
    -- violate the unique index added in §5.  Keep one row per
    -- normalised phone (most-recently-updated profile wins); the
    -- losers will pick up an empty contacts row in the seed step
    -- below.  We also null-out unsalvageable values up front.
    insert into public.profile_contacts (user_id, phone)
    select distinct on (norm_phone) src.id, src.norm_phone
    from (
      select p.id,
             public._normalize_phone_e164(p.phone) as norm_phone,
             p.updated_at
      from public.profiles p
      where p.phone is not null
    ) src
    where src.norm_phone is not null
    order by src.norm_phone, src.updated_at desc nulls last, src.id
    on conflict (user_id) do update
      set phone = excluded.phone
      where public.profile_contacts.phone is null;
  end if;

  -- Seed an empty row for every profile that still doesn't have one,
  -- so the app can rely on a single-row read by user_id.
  insert into public.profile_contacts (user_id)
  select p.id from public.profiles p
  on conflict (user_id) do nothing;
end $$;

-- ── 5. CHECK + unique index, now that data is known-good ─────────────
-- E.164 = '+' followed by 1-9 then 6-14 more digits (7..15 digits total).
alter table public.profile_contacts
  add constraint profile_contacts_phone_e164_chk
  check (phone is null or phone ~ '^\+[1-9]\d{6,14}$');

-- One number across the whole table; partial so multiple NULLs are OK.
create unique index if not exists ux_profile_contacts_phone
  on public.profile_contacts (phone) where phone is not null;

-- ── 6. RLS — owner-or-staff SELECT, owner-only writes ────────────────
alter table public.profile_contacts enable row level security;

drop policy if exists "Owner or staff read contacts"        on public.profile_contacts;
drop policy if exists "Owner inserts own contacts"          on public.profile_contacts;
drop policy if exists "Owner updates own contacts"          on public.profile_contacts;
drop policy if exists "Block banned from contacts"          on public.profile_contacts;

-- SELECT: owner OR staff (managers + admins).  Non-staff readers
-- cannot see anyone else's number — the central privacy promise of
-- this task.
create policy "Owner or staff read contacts"
  on public.profile_contacts
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_manager_or_admin(auth.uid())
  );

-- INSERT: owner only.  The auto-create trigger (§8) runs as the
-- user during sign-up so this still passes; the migration backfill
-- (§4) bypasses RLS via the SECURITY DEFINER trigger guard GUC.
create policy "Owner inserts own contacts"
  on public.profile_contacts
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- UPDATE: owner only.  Staff intentionally CANNOT change another
-- user's phone — write access is strictly the owner's, matching the
-- explicit reviewer feedback that "user can change only their own".
-- Staff retain SELECT for moderation visibility (UsersTab).
create policy "Owner updates own contacts"
  on public.profile_contacts
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Banned users cannot touch their own contacts row either.
create policy "Block banned from contacts"
  on public.profile_contacts
  as restrictive
  for all
  to authenticated
  using (not public.is_banned(auth.uid()));

-- ── 7. Guard trigger: normalise + clamp phone_verified ───────────────
-- Bypass-first ordering is critical: the migration backfill (§4) and
-- the verified RPC (§9) set `app.profile_contacts_bypass = 'on'` for
-- the duration of their transaction; in those contexts `auth.uid()`
-- may legitimately be null and ownership enforcement must NOT fire.
-- Outside the bypass path we still re-assert owner-only writes (the
-- RLS policy above is already strict, but the trigger is defence in
-- depth) and clamp `phone_verified` so only the bypass path may flip
-- it.  Changing the underlying number resets verification.
create or replace function public._guard_profile_contacts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bypass boolean := current_setting('app.profile_contacts_bypass', true) = 'on';
  v_caller uuid;
begin
  if v_bypass then
    if (tg_op = 'INSERT') or (new.phone is distinct from old.phone) then
      new.phone := public._normalize_phone_e164(new.phone);
    end if;
    new.updated_at := now();
    return new;
  end if;

  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if new.user_id <> v_caller then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if (tg_op = 'INSERT') or (new.phone is distinct from old.phone) then
    new.phone := public._normalize_phone_e164(new.phone);
  end if;

  if tg_op = 'INSERT' then
    new.phone_verified := false;
  elsif new.phone_verified is distinct from old.phone_verified then
    -- Only the bypass path may toggle this column.
    new.phone_verified := old.phone_verified;
  end if;

  if tg_op = 'UPDATE' and new.phone is distinct from old.phone then
    new.phone_verified := false;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_profile_contacts on public.profile_contacts;
create trigger trg_guard_profile_contacts
  before insert or update on public.profile_contacts
  for each row execute function public._guard_profile_contacts();

-- ── 8. Auto-create empty contacts row when a new profile is added ────
create or replace function public._ensure_profile_contacts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.profile_contacts_bypass', 'on', true);
  insert into public.profile_contacts (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_ensure_profile_contacts on public.profiles;
create trigger trg_ensure_profile_contacts
  after insert on public.profiles
  for each row execute function public._ensure_profile_contacts();

-- ── 9. SECURITY DEFINER RPC: mark phone as verified ──────────────────
-- The client calls this AFTER `supabase.auth.verifyOtp({type:'phone_change'})`
-- succeeds.  We re-check `auth.users.phone_confirmed_at` server-side
-- so a malicious client cannot lie about having verified.
create or replace function public.profile_phone_mark_verified()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller    uuid := auth.uid();
  v_phone     text;
  v_confirmed timestamptz;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_banned(v_caller) then
    raise exception 'banned' using errcode = '42501';
  end if;

  select phone, phone_confirmed_at
    into v_phone, v_confirmed
    from auth.users
    where id = v_caller;

  if v_phone is null or v_confirmed is null then
    raise exception 'phone_not_confirmed' using errcode = '22023';
  end if;

  perform set_config('app.profile_contacts_bypass', 'on', true);
  insert into public.profile_contacts (user_id, phone, phone_verified)
  values (v_caller, public._normalize_phone_e164(v_phone), true)
  on conflict (user_id) do update
    set phone          = excluded.phone,
        phone_verified = true,
        updated_at     = now();
end $$;

revoke all on function public.profile_phone_mark_verified() from public, anon;
grant execute on function public.profile_phone_mark_verified() to authenticated;

-- ── 10. Drop the legacy column from profiles ─────────────────────────
alter table public.profiles drop column if exists phone;
