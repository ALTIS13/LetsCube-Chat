-- 20260528_phone_verification.sql
-- Proposal only. Do not apply automatically from Codex.
--
-- Hardens the existing phone privacy model:
-- - phone lives in profile_contacts, not profiles;
-- - verified state mirrors Supabase Auth only after OTP success;
-- - phone_verified_at records the successful verification time;
-- - ordinary clients cannot set verified flags manually.

alter table public.profile_contacts
  add column if not exists phone_verified_at timestamptz;

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
    new.phone_verified_at := null;
  elsif new.phone_verified is distinct from old.phone_verified then
    new.phone_verified := old.phone_verified;
  elsif new.phone_verified_at is distinct from old.phone_verified_at then
    new.phone_verified_at := old.phone_verified_at;
  end if;

  if tg_op = 'UPDATE' and new.phone is distinct from old.phone then
    new.phone_verified := false;
    new.phone_verified_at := null;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_profile_contacts on public.profile_contacts;
create trigger trg_guard_profile_contacts
  before insert or update on public.profile_contacts
  for each row execute function public._guard_profile_contacts();

create or replace function public.profile_phone_mark_verified()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_phone text;
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
  insert into public.profile_contacts (user_id, phone, phone_verified, phone_verified_at)
  values (v_caller, public._normalize_phone_e164(v_phone), true, v_confirmed)
  on conflict (user_id) do update
    set phone = excluded.phone,
        phone_verified = true,
        phone_verified_at = excluded.phone_verified_at,
        updated_at = now();
end $$;

revoke all on function public.profile_phone_mark_verified() from public, anon;
grant execute on function public.profile_phone_mark_verified() to authenticated;
