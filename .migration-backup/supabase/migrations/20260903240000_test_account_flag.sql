-- Mark the QA accounts so they stop sitting among real people.
--
-- They exist for testing and they are indistinguishable in every list that
-- matters — the user directory, counts, recent activity — which makes both
-- jobs harder: finding a real person, and knowing whether a number is real.
--
-- The flag is not something an account may set on itself. Otherwise anyone
-- could opt out of the directory by claiming to be a test account, which is
-- the opposite of what this is for.
--
-- Additive: one nullable-defaulted column, one trigger, one function.

alter table public.profiles
  add column if not exists is_test_account boolean not null default false;

create index if not exists profiles_is_test_account_idx
  on public.profiles (is_test_account)
  where is_test_account;

/**
 * Only someone who manages users may mark or unmark a test account.
 *
 * Written as a guard on the change rather than a policy on the row, because
 * the row itself must stay updatable by its owner for every other column.
 */
create or replace function public.profiles_guard_test_flag()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if new.is_test_account is not distinct from old.is_test_account then
    return new;
  end if;
  -- A migration or a backend job runs without a JWT; a person does not.
  if v_actor is null then
    return new;
  end if;
  if not public.has_permission(v_actor, 'users.manage') then
    raise exception 'test_flag_not_permitted' using errcode = 'P0001';
  end if;
  return new;
end
$function$;

drop trigger if exists profiles_guard_test_flag on public.profiles;
create trigger profiles_guard_test_flag
  before update of is_test_account on public.profiles
  for each row execute function public.profiles_guard_test_flag();

update public.profiles profile
set is_test_account = true
from auth.users account
where account.id = profile.id
  and lower(account.email) in (
    'seraltis14@gmail.com',
    'seraltis15@gmail.com',
    'altitest1@atomicmail.io',
    'altitest2@atomicmail.io',
    'altitest3@atomicmail.io'
  );
