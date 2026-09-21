-- PROPOSAL ONLY. Apply as postgres after reviewed PG17 rehearsal and a verified
-- before-schema backup. No dispatch enablement or existing token backfill.
-- Rollback: 20260921114126_android_push_session_binding.rollback.sql, in its
-- entirety. Reverse dependent migrations first; rollback never uses CASCADE.
-- Existing registrations retain ordinary push. Only the eight-argument RPC can
-- advertise voice protocol 1; its returned recipient is auth.uid(), not device id.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, public, extensions;

do $migration$
declare
  v_old regprocedure := to_regprocedure('public.register_push_device(text,text,text,text,text,text,text)');
  v_new regprocedure := to_regprocedure('public.register_push_device(text,text,text,text,text,text,text,smallint)');
  v_impl regprocedure := to_regprocedure('private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)');
  v_table regclass := to_regclass('public.user_push_devices');
  v_count integer;
  v_fresh boolean;
  v_signature text;
  v_expected text;
  v_proc record;
  v_preserved jsonb;
  v_after jsonb;
  v_fk text := 'FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE SET NULL';
  v_check text := 'CHECK (((voice_call_protocol IS NULL) OR ((voice_call_protocol = 1) AND (platform = ''android''::text) AND (provider = ''fcm''::text))))';
  -- Canonical pg_get_functiondef text makes reapplication a comparison, never a
  -- CREATE OR REPLACE over an unknown implementation. Bodies are defined once.
  v_legacy_ddl text := $ddl$CREATE OR REPLACE FUNCTION public.register_push_device(p_platform text, p_provider text, p_token text, p_token_hash text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text, p_device_model text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  perform private.register_push_device_bound(
    p_platform::text, p_provider::text, p_token::text, p_token_hash::text,
    p_device_id::text, p_device_model::text, p_app_version::text,
    null::smallint, false::boolean);
end
$function$
$ddl$;
  v_new_ddl text := $ddl$CREATE OR REPLACE FUNCTION public.register_push_device(p_platform text, p_provider text, p_token text, p_token_hash text, p_device_id text, p_device_model text, p_app_version text, p_voice_call_protocol smallint)
 RETURNS TABLE(recipient_id uuid, recipient_session_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  return query select bound.recipient_id, bound.recipient_session_id
    from private.register_push_device_bound(
      p_platform::text, p_provider::text, p_token::text, p_token_hash::text,
      p_device_id::text, p_device_model::text, p_app_version::text,
      p_voice_call_protocol::smallint, true::boolean) as bound;
end
$function$
$ddl$;
  v_impl_ddl text := $ddl$CREATE OR REPLACE FUNCTION private.register_push_device_bound(p_platform text, p_provider text, p_token text, p_token_hash text, p_device_id text, p_device_model text, p_app_version text, p_voice_call_protocol smallint, p_require_session boolean)
 RETURNS TABLE(recipient_id uuid, recipient_session_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_user uuid := auth.uid();
  v_session uuid;
  v_token text := btrim(coalesce(p_token, ''));
  v_token_hash text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  -- The legacy predicate (including its NULL semantics) is the live contract.
  if p_platform <> 'android' or p_provider <> 'fcm'
     or (p_require_session and (p_platform is distinct from 'android' or p_provider is distinct from 'fcm')) then
    raise exception 'unsupported_push_provider';
  end if;
  if length(v_token) < 20 or length(v_token) > 4096 then
    raise exception 'invalid_push_token';
  end if;
  if p_voice_call_protocol is not null and p_voice_call_protocol <> 1 then
    raise exception 'unsupported_voice_call_protocol';
  end if;

  -- Text comparison rejects malformed claims without casting untrusted input.
  -- Session existence alone is insufficient: enforce subject and hard expiry.
  select s.id into v_session from auth.sessions as s
   where s.id::text = nullif(auth.jwt()->>'session_id', '')
     and s.user_id = v_user
     and (s.not_after is null or s.not_after > clock_timestamp());
  if p_require_session and v_session is null then
    raise exception 'invalid_push_session';
  end if;

  -- p_token_hash is compatibility-only. A token always deduplicates server-side.
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  insert into public.user_push_devices (
    user_id, platform, provider, token, token_hash, device_id, device_model,
    app_version, enabled, revoked_at, last_seen_at, updated_at,
    session_id, voice_call_protocol
  ) values (
    v_user, 'android', 'fcm', v_token, v_token_hash,
    nullif(left(btrim(coalesce(p_device_id, '')), 160), ''),
    nullif(left(btrim(coalesce(p_device_model, '')), 300), ''),
    nullif(left(btrim(coalesce(p_app_version, '')), 60), ''),
    true, null, now(), now(), v_session,
    case when p_require_session then p_voice_call_protocol else null::smallint end
  )
  on conflict (provider, token_hash) do update
  set user_id = excluded.user_id,
      platform = excluded.platform,
      token = excluded.token,
      device_id = excluded.device_id,
      device_model = excluded.device_model,
      app_version = excluded.app_version,
      enabled = true,
      revoked_at = null,
      last_seen_at = now(),
      updated_at = now(),
      session_id = excluded.session_id,
      voice_call_protocol = excluded.voice_call_protocol;
  return query select v_user::uuid, v_session::uuid;
end
$function$
$ddl$;
begin
  if current_user <> 'postgres'
     or not exists (select 1 from pg_roles where rolname = 'postgres' and not rolsuper and rolbypassrls)
     or not exists (select 1 from pg_class where oid = v_table and relowner = 'postgres'::regrole and relkind = 'r')
     or not exists (select 1 from pg_proc where oid = v_old and proowner = 'postgres'::regrole)
     or not exists (select 1 from pg_namespace where nspname = 'private' and nspowner = 'postgres'::regrole)
     or not exists (select 1 from pg_class where oid = to_regclass('auth.sessions') and relowner = 'supabase_auth_admin'::regrole) then
    raise exception 'push_binding_owner_guard';
  end if;
  if not has_table_privilege('postgres', 'auth.sessions', 'SELECT')
     or not has_table_privilege('postgres', 'auth.sessions', 'REFERENCES')
     or exists (select 1 from pg_namespace n, lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
       where n.nspname = 'private' and a.grantee <> 'postgres'::regrole)
     or (select count(*) from pg_attribute where attrelid = 'auth.sessions'::regclass and not attisdropped
         and ((attname in ('id','user_id') and atttypid = 'uuid'::regtype)
           or (attname = 'not_after' and atttypid = 'timestamptz'::regtype))) <> 3 then
    raise exception 'push_binding_auth_baseline';
  end if;
  if not (select relrowsecurity from pg_class where oid = v_table)
     or exists (select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = v_table and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid))
     or exists (select 1 from pg_attribute c, lateral aclexplode(c.attacl) a
       where c.attrelid = v_table and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid))
     or has_any_column_privilege('anon', v_table, 'SELECT,INSERT,UPDATE,REFERENCES')
     or has_any_column_privilege('authenticated', v_table, 'SELECT,INSERT,UPDATE,REFERENCES')
     or has_table_privilege('anon', v_table, 'DELETE,TRUNCATE,TRIGGER')
     or has_table_privilege('authenticated', v_table, 'DELETE,TRUNCATE,TRIGGER') then
    raise exception 'push_binding_rls_grants_baseline';
  end if;
  -- Lock only this device table. Recheck inside the lock; no schema repair on drift.
  lock table public.user_push_devices in access exclusive mode;
  select count(*) into v_count from pg_attribute where attrelid = v_table
    and attname in ('session_id','voice_call_protocol') and not attisdropped;
  v_fresh := v_count = 0 and v_new is null and v_impl is null;
  if not v_fresh and (v_count <> 2 or v_new is null or v_impl is null) then
    raise exception 'push_binding_incomplete_state';
  end if;
  if v_fresh and md5(pg_get_functiondef(v_old)) <> '1ec557fdad31f1c6bd4e436511ef40ac' then
    raise exception 'push_binding_legacy_drift';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'register_push_device')
       <> (case when v_fresh then 1 else 2 end) then
    raise exception 'push_binding_overload_drift';
  end if;
  foreach v_signature in array array[
    'public.register_push_device(text,text,text,text,text,text,text)',
    'public.register_push_device(text,text,text,text,text,text,text,smallint)',
    'private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)'
  ] loop
    select * into v_proc from pg_proc where oid = to_regprocedure(v_signature);
    if not found then continue; end if;
    v_expected := case v_signature
      when 'public.register_push_device(text,text,text,text,text,text,text)' then v_legacy_ddl
      when 'public.register_push_device(text,text,text,text,text,text,text,smallint)' then v_new_ddl
      else v_impl_ddl end;
    if v_proc.proowner <> 'postgres'::regrole
       or (not v_fresh and pg_get_functiondef(v_proc.oid) <> v_expected)
       or v_proc.proacl is distinct from (case
         when v_proc.oid = v_old then array['postgres=X/postgres','service_role=X/postgres','authenticated=X/postgres']::aclitem[]
         when v_signature like 'public.%' then array['postgres=X/postgres','authenticated=X/postgres']::aclitem[]
         else array['postgres=X/postgres']::aclitem[] end) then
      raise exception 'push_binding_function_drift: %', v_signature;
    end if;
  end loop;

  -- Catalog-only snapshot: no tokens or other user data enter output or metadata.
  select jsonb_build_object(
    'columns', (select jsonb_agg(to_jsonb(a) order by a.attnum) from pg_attribute a
      where a.attrelid = v_table and a.attnum > 0 and not a.attisdropped
      and a.attname not in ('session_id','voice_call_protocol')),
    'policies', (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p where p.polrelid = v_table),
    'acl', (select relacl::text from pg_class where oid = v_table)
  ) into v_preserved;
  if v_fresh then
    alter table public.user_push_devices
      add column session_id uuid,
      add column voice_call_protocol smallint,
      add constraint user_push_devices_session_id_fkey foreign key (session_id) references auth.sessions(id) on delete set null,
      add constraint user_push_devices_voice_call_protocol_check
        check (voice_call_protocol is null or (voice_call_protocol = 1 and platform = 'android' and provider = 'fcm'));
    execute v_impl_ddl;
    revoke all on function private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean) from public, anon, authenticated, service_role;
    execute v_legacy_ddl;
    revoke all on function public.register_push_device(text,text,text,text,text,text,text) from public, anon, authenticated;
    execute v_new_ddl;
    revoke all on function public.register_push_device(text,text,text,text,text,text,text,smallint) from public, anon, authenticated, service_role;
    -- Preserve the existing legacy service_role grant; do not extend it to the
    -- new overload through postgres/public default function privileges.
    grant execute on function public.register_push_device(text,text,text,text,text,text,text) to authenticated;
    grant execute on function public.register_push_device(text,text,text,text,text,text,text,smallint) to authenticated;
  end if;

  if (select count(*) from pg_attribute where attrelid = v_table and not attisdropped
      and not attnotnull and not atthasdef and attidentity = '' and attgenerated = ''
      and ((attname = 'session_id' and atttypid = 'uuid'::regtype)
        or (attname = 'voice_call_protocol' and atttypid = 'smallint'::regtype))) <> 2
     or not exists (select 1 from pg_constraint where conrelid = v_table and conname = 'user_push_devices_session_id_fkey'
       and convalidated and not condeferrable and pg_get_constraintdef(oid) = v_fk)
     or not exists (select 1 from pg_constraint where conrelid = v_table and conname = 'user_push_devices_voice_call_protocol_check'
       and convalidated and not condeferrable and pg_get_constraintdef(oid) = v_check) then
    raise exception 'push_binding_column_constraint_drift';
  end if;
  foreach v_signature in array array[
    'public.register_push_device(text,text,text,text,text,text,text)',
    'public.register_push_device(text,text,text,text,text,text,text,smallint)',
    'private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)'
  ] loop
    select * into strict v_proc from pg_proc where oid = to_regprocedure(v_signature);
    v_expected := case v_signature
      when 'public.register_push_device(text,text,text,text,text,text,text)' then v_legacy_ddl
      when 'public.register_push_device(text,text,text,text,text,text,text,smallint)' then v_new_ddl
      else v_impl_ddl end;
    if v_proc.proowner <> 'postgres'::regrole or pg_get_functiondef(v_proc.oid) <> v_expected
       or v_proc.proacl is distinct from (case
         when v_proc.oid = v_old then array['postgres=X/postgres','service_role=X/postgres','authenticated=X/postgres']::aclitem[]
         when v_signature like 'public.%' then array['postgres=X/postgres','authenticated=X/postgres']::aclitem[]
         else array['postgres=X/postgres']::aclitem[] end) then
      raise exception 'push_binding_function_self_check: %', v_signature;
    end if;
  end loop;
  select jsonb_build_object(
    'columns', (select jsonb_agg(to_jsonb(a) order by a.attnum) from pg_attribute a
      where a.attrelid = v_table and a.attnum > 0 and not a.attisdropped
      and a.attname not in ('session_id','voice_call_protocol')),
    'policies', (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p where p.polrelid = v_table),
    'acl', (select relacl::text from pg_class where oid = v_table)
  ) into v_after;
  if v_after is distinct from v_preserved or not (select relrowsecurity from pg_class where oid = v_table) then
    raise exception 'push_binding_preservation_self_check';
  end if;
end
$migration$;
commit;
