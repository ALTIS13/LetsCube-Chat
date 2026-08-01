begin;

do $setup$
declare
  v_staff uuid;
  v_target uuid;
begin
  select profile.id
    into v_staff
  from public.profiles profile
  where public.has_permission(profile.id, 'users.view')
    and not public.is_banned(profile.id)
  order by profile.created_at
  limit 1;

  select contact.user_id
    into v_target
  from public.profile_contacts contact
  join public.profiles profile on profile.id = contact.user_id
  order by profile.created_at
  limit 1;

  if v_staff is null or v_target is null then
    raise exception 'phone search smoke fixtures are unavailable';
  end if;

  perform set_config('app.profile_contacts_bypass', 'on', true);
  update public.profile_contacts
     set phone = '+19995550199',
         phone_verified = true,
         phone_verified_at = now()
   where user_id = v_target;

  perform set_config('app.qa_phone_search_staff', v_staff::text, true);
  perform set_config('app.qa_phone_search_target', v_target::text, true);
end
$setup$;

set local role authenticated;

do $set_staff_claim$
begin
  perform set_config(
    'request.jwt.claim.sub',
    current_setting('app.qa_phone_search_staff'),
    true
  );
end
$set_staff_claim$;

do $authorized_checks$
declare
  v_target uuid := current_setting('app.qa_phone_search_target')::uuid;
  v_count integer;
begin
  select count(*)
    into v_count
  from public.search_profiles_by_phone('+1 (999) 555-0199', 100) result
  where result.id = v_target;

  if v_count <> 1 then
    raise exception 'authorized exact phone lookup failed';
  end if;

  select count(*)
    into v_count
  from public.search_profiles_by_phone('+1999555', 10);

  if v_count <> 0 then
    raise exception 'partial phone lookup must not return profiles';
  end if;

  select count(*)
    into v_count
  from public.search_profiles_by_phone('19995550199', 10);

  if v_count <> 0 then
    raise exception 'phone lookup without explicit country prefix must be rejected';
  end if;
end
$authorized_checks$;

do $set_unauthorized_claim$
begin
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
end
$set_unauthorized_claim$;

do $unauthorized_checks$
declare
  v_count integer;
begin
  select count(*)
    into v_count
  from public.search_profiles_by_phone('+19995550199', 10);

  if v_count <> 0 then
    raise exception 'unauthorized phone lookup returned a profile';
  end if;
end
$unauthorized_checks$;

reset role;

do $grant_checks$
begin
  if has_function_privilege('anon', 'public.search_profiles_by_phone(text,integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.search_profiles_by_phone(text,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.search_profiles_by_phone(text,integer)', 'EXECUTE') then
    raise exception 'phone search RPC grants are unsafe';
  end if;
end
$grant_checks$;

rollback;
