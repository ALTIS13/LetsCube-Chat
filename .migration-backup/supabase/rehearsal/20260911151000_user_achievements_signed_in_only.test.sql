-- Rehearsal: 20260911151000_user_achievements_signed_in_only.sql
--
-- Run on the throwaway copy of production's schema, after that migration:
--   psql -X -v ON_ERROR_STOP=1 -f .migration-backup/supabase/rehearsal/20260911151000_user_achievements_signed_in_only.test.sql
--
-- One transaction that ends in ROLLBACK, with its own people and its own badge.

begin;

do $preflight$
declare
  v_probe uuid := gen_random_uuid();
  v_seen uuid;
  v_claims_ok boolean;
  v_sub_ok boolean;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_probe, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_seen := auth.uid();
  execute 'reset role';
  v_claims_ok := v_seen is not distinct from v_probe;

  perform pg_catalog.set_config('request.jwt.claims', '', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_probe::text, true);
  execute 'set local role authenticated';
  v_seen := auth.uid();
  execute 'reset role';
  v_sub_ok := v_seen is not distinct from v_probe;

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  raise notice 'auth.uid() reads request.jwt.claims: %; request.jwt.claim.sub: %', v_claims_ok, v_sub_ok;
  if not v_claims_ok and not v_sub_ok then
    raise exception 'preflight: auth.uid() reads neither request.jwt.claims nor request.jwt.claim.sub; read pg_get_functiondef(''auth.uid()''::regprocedure)';
  end if;
end
$preflight$;

do $test$
declare
  v_holder uuid := gen_random_uuid();
  v_reader uuid := gen_random_uuid();
  v_key constant text := 'rehearsal_' || pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_now constant timestamptz := pg_catalog.now();
  v_count integer;
  v_failed boolean;
begin
  -- Only columns that the auth.users of production and of the rehearsal image both have.
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  select person.id, 'authenticated', 'authenticated', 'rehearsal-' || person.id::text || '@invalid', v_now, v_now
    from pg_catalog.unnest(array[v_holder, v_reader]) as person(id);
  insert into public.profiles (id, full_name, username)
  select person.id, 'Rehearsal ' || person.label, 'rh_' || person.label || '_' || pg_catalog.substr(pg_catalog.replace(person.id::text, '-', ''), 1, 8)
    from (values (v_holder, 'holder'), (v_reader, 'reader')) as person(id, label)
  on conflict (id) do update set full_name = excluded.full_name, username = excluded.username;
  insert into public.achievements (key, title, description)
  values (v_key, 'Rehearsal badge', 'Held by a rehearsal account');
  insert into public.user_achievements (user_id, achievement_key) values (v_holder, v_key);

  -- (a) A signed-in person reads someone else's badge.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_reader::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_reader, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select pg_catalog.count(*)::integer into v_count from public.user_achievements where user_id = v_holder;
  if v_count <> 1 then
    raise exception '(a) a signed-in person sees % of another person''s badges, expected 1', v_count;
  end if;

  -- (b) The views over the table still answer a signed-in reader.
  if pg_catalog.to_regclass('public.achievement_stats') is not null then
    perform 1 from public.achievement_stats limit 1;
  end if;
  if pg_catalog.to_regclass('public.achievement_recipients') is not null then
    perform 1 from public.achievement_recipients limit 1;
  end if;

  -- (c) Nobody signed in writes a badge by hand.
  v_failed := false;
  begin
    insert into public.user_achievements (user_id, achievement_key) values (v_reader, v_key);
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(c) a signed-in person awarded themselves a badge';
  end if;

  -- (d) Without an account: not the table, and not who holds what through a view.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  v_failed := false;
  begin
    perform 1 from public.user_achievements limit 1;
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(d) anon reads public.user_achievements';
  end if;
  if pg_catalog.to_regclass('public.achievement_recipients') is not null then
    v_failed := false;
    begin
      perform 1 from public.achievement_recipients limit 1;
    exception
      when insufficient_privilege then
        v_failed := true;
    end;
    if not v_failed then
      raise exception '(d) anon reads who holds which badge through achievement_recipients';
    end if;
  end if;

  -- (e) The catalogue stays public.
  perform 1 from public.achievements limit 1;
  execute 'reset role';
end
$test$;

select 'rehearsal passed: 20260911151000_user_achievements_signed_in_only' as result;

rollback;
