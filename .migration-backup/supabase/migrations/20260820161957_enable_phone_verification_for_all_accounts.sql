begin;

do $migration_guard$
begin
  if to_regclass('public.phone_verification_policy') is null then
    raise exception 'phone verification policy is missing';
  end if;

  if (select count(*) from public.phone_verification_policy where singleton) <> 1 then
    raise exception 'phone verification singleton policy is invalid';
  end if;
end
$migration_guard$;

update public.phone_verification_policy
set enabled = true,
    updated_at = now()
where singleton;

do $migration_verify$
begin
  if not exists (
    select 1
    from public.phone_verification_policy
    where singleton
      and enabled is true
      and enforce_data_access is false
  ) then
    raise exception 'phone verification rollout was not enabled safely';
  end if;
end
$migration_verify$;

commit;
