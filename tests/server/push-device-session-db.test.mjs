import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = new URL("../../", import.meta.url);
const stem = ".migration-backup/supabase/migrations/20260921114126_android_push_session_binding";
const read = (name) => readFileSync(new URL(name, root), "utf8").replaceAll("\r\n", "\n");
const migration = read(`${stem}.sql`);
const oldSql = read(".migration-backup/supabase/migrations/20260711_native_push_fcm_delivery.sql");
const legacyDefinition = oldSql.match(/create function public\.register_push_device\([\s\S]*?\$\$;/)[0];
const unregisterDefinition = oldSql.match(/create function public\.unregister_push_device\([\s\S]*?\$\$;/)[0];
const oldSignature = "public.register_push_device(text,text,text,text,text,text,text)";
const newSignature = "public.register_push_device(text,text,text,text,text,text,text,smallint)";
const implSignature = "private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)";
const userA = "10000000-0000-4000-8000-000000000001";
const userB = "10000000-0000-4000-8000-000000000002";
const sessionA = "20000000-0000-4000-8000-000000000001";
const sessionB = "20000000-0000-4000-8000-000000000002";
const expired = "20000000-0000-4000-8000-000000000003";
const missing = "20000000-0000-4000-8000-000000000099";
const token = "fictional-fcm-device-01";

// Only bootstrap is superuser. Migration, fixture DML and every RPC thereafter
// run under explicitly checked roles matching the supplied live ownership.
async function database(sql = migration) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  try {
    await db.exec(`
      create role fixture_control superuser login;
      set session authorization fixture_control;
      alter role postgres rename to fixture_admin;
      create role postgres nosuperuser bypassrls;
      create role authenticated nosuperuser nobypassrls;
      create role anon nosuperuser nobypassrls;
      create role service_role nosuperuser bypassrls;
      create role supabase_auth_admin nosuperuser;
      create schema auth authorization supabase_auth_admin;
      create schema extensions authorization postgres;
      create schema private authorization postgres;
      revoke all on schema private from public, anon, authenticated;
      grant usage on schema public, auth, extensions to postgres, authenticated, anon, service_role;
      grant create on schema public to postgres;
      create extension pgcrypto with schema extensions;
      create table auth.users (id uuid primary key);
      alter table auth.users owner to supabase_auth_admin;
      create table auth.sessions (
        id uuid primary key, user_id uuid not null references auth.users(id),
        not_after timestamptz, refreshed_at timestamp without time zone
      );
      alter table auth.sessions owner to supabase_auth_admin;
      grant select, references on auth.sessions to postgres;
      grant references on auth.users to postgres;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
      insert into auth.users values ('${userA}'), ('${userB}');
      insert into auth.sessions(id, user_id, not_after) values
        ('${sessionA}', '${userA}', null),
        ('${sessionB}', '${userB}', now() + interval '1 day'),
        ('${expired}', '${userA}', now() - interval '1 day');
      set role postgres;
      alter default privileges for role postgres in schema public
        grant execute on functions to anon, authenticated, postgres, service_role;
      create table public.profiles(id uuid primary key references auth.users(id), full_name text);
      ${oldSql.slice(oldSql.indexOf("create table if not exists public.user_push_devices"), oldSql.indexOf("update public.user_push_devices"))}
      create unique index user_push_devices_provider_token_hash_uidx
        on public.user_push_devices(provider, token_hash);
      alter table public.user_push_devices enable row level security;
      revoke all on public.user_push_devices from public, anon, authenticated;
      ${legacyDefinition}
      ${unregisterDefinition}
      revoke all on function ${oldSignature} from public, anon, authenticated;
      revoke all on function public.unregister_push_device(text,text) from public, anon, authenticated;
      grant execute on function ${oldSignature} to authenticated;
      grant execute on function public.unregister_push_device(text,text) to authenticated;
    `);
    assert.deepEqual((await db.query(`select current_user as role, rolsuper, rolbypassrls
      from pg_roles where rolname=current_user`)).rows,
    [{ role: "postgres", rolsuper: false, rolbypassrls: true }]);
    assert.equal((await db.query(`select md5(pg_get_functiondef('${oldSignature}'::regprocedure)) as hash`)).rows[0].hash,
      "1ec557fdad31f1c6bd4e436511ef40ac");
    assert.equal((await db.query(`select proacl::text as acl from pg_proc where oid='${oldSignature}'::regprocedure`)).rows[0].acl,
      "{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}");
    assert.deepEqual((await db.query(`select a.grantee::regrole::text as grantee,a.grantor::regrole::text as grantor,
      a.privilege_type,a.is_grantable from pg_default_acl d, lateral aclexplode(d.defaclacl) a
      where d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace and d.defaclobjtype='f'
      order by grantee`)).rows, ["anon","authenticated","postgres","service_role"].map((grantee) =>
      ({ grantee, grantor: "postgres", privilege_type: "EXECUTE", is_grantable: false })));
    assert.equal((await db.query(`select count(*)::int as n from pg_default_acl
      where defaclrole='postgres'::regrole and defaclnamespace='private'::regnamespace`)).rows[0].n, 0);
    if (sql.trim()) await db.exec(sql);
    return db;
  } catch (error) {
    await db.close();
    // PGlite attaches the entire SQL to errors; keep failures bounded and free
    // of fixture row contents while retaining PostgreSQL diagnostics.
    delete error.query;
    throw error;
  }
}

async function asCaller(db, { user = userA, session = sessionA, role = "authenticated" } = {}, fn) {
  await db.exec(`begin; set local role ${role};`);
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: user, ...(session === "ABSENT" ? {} : { session_id: session }) })]);
    assert.deepEqual((await db.query(`select current_user as role, rolsuper, rolbypassrls
      from pg_roles where rolname=current_user`)).rows,
    [{ role, rolsuper: false, rolbypassrls: false }]);
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function register(db, { legacy = false, protocol = 1, value = token,
  platform = "android", provider = "fcm", hash = "caller-hash", ...caller } = {}) {
  const args = [platform, provider, value, hash, " device ", " model ", " 1.0 "];
  if (!legacy) args.push(protocol);
  return asCaller(db, caller, () => db.query(`select * from public.register_push_device(
    $1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text${legacy ? "" : ",$8::smallint"})`, args));
}

async function withDatabase(fn, sql = migration) {
  const db = await database(sql);
  try { await fn(db); } finally { await db.close(); }
}

test("nullable session and protocol columns exist (RED against empty migration)", async () => {
  await withDatabase(async (db) => {
    const { rows } = await db.query(`select column_name, data_type, is_nullable, column_default
      from information_schema.columns where table_schema='public' and table_name='user_push_devices'
      and column_name in ('session_id','voice_call_protocol') order by column_name`);
    assert.deepEqual(rows, [
      { column_name: "session_id", data_type: "uuid", is_nullable: "YES", column_default: null },
      { column_name: "voice_call_protocol", data_type: "smallint", is_nullable: "YES", column_default: null },
    ]);
  });
});

test("required eight-argument overload exists (RED against empty migration)", async () => {
  await withDatabase(async (db) => {
    const { rows } = await db.query(`select pronargdefaults, pg_get_function_result(oid) as result
      from pg_proc where oid=to_regprocedure('${newSignature}')`);
    assert.deepEqual(rows, [{ pronargdefaults: 0,
      result: "TABLE(recipient_id uuid, recipient_session_id uuid)" }]);
  });
});

test("legacy named calls with omitted defaults resolve and return void", async () => {
  await withDatabase(async (db) => {
    for (const extra of ["", ", p_token_hash=>'ignored'", ", p_device_id=>' fixture '",
      ", p_token_hash=>null, p_device_id=>null, p_device_model=>null, p_app_version=>null"]) {
      const result = await asCaller(db, {}, () => db.query(`select pg_typeof(public.register_push_device(
        p_token=>'${token}', p_provider=>'fcm', p_platform=>'android'${extra}))::text as result`));
      assert.deepEqual(result.rows, [{ result: "void" }]);
    }
    assert.deepEqual((await db.query("select session_id, voice_call_protocol from public.user_push_devices")).rows,
      [{ session_id: sessionA, voice_call_protocol: null }]);
  });
});

test("new overload returns exactly the JWT user/session pair and hashes/normalizes server-side", async () => {
  await withDatabase(async (db) => {
    assert.deepEqual((await register(db, { value: `  ${token}  ` })).rows,
      [{ recipient_id: userA, recipient_session_id: sessionA }]);
    const { rows } = await db.query(`select user_id, session_id, voice_call_protocol,
      token_hash, device_id, device_model, app_version from public.user_push_devices`);
    assert.deepEqual(rows, [{ user_id: userA, session_id: sessionA, voice_call_protocol: 1,
      token_hash: createHash("sha256").update(token).digest("hex"),
      device_id: "device", device_model: "model", app_version: "1.0" }]);
    await register(db, { protocol: null });
    assert.equal((await db.query("select voice_call_protocol from public.user_push_devices")).rows[0].voice_call_protocol, null);
  });
});

for (const [name, session] of [["other user's", sessionB], ["absent", "ABSENT"],
  ["null", null], ["missing/deleted", missing], ["expired", expired],
  ["malformed", "not-a-uuid"], ["empty", ""], ["non-string", { id: sessionA }]]) {
  test(`${name} session is refused for new registration; legacy remains unbound`, async () => {
    await withDatabase(async (db) => {
      // ABSENT deliberately omits the claim, distinct from an explicit null.
      const invoke = (legacy) => asCaller(db, { session: session ?? null }, () => db.query(
        `select * from public.register_push_device('android','fcm','${token}',null,null,null,null${legacy ? "" : ",1::smallint"})`));
      await assert.rejects(invoke(false), /invalid_push_session/);
      assert.equal((await db.query("select count(*)::int as n from public.user_push_devices")).rows[0].n, 0);
      await invoke(true);
      assert.deepEqual((await db.query("select enabled, session_id, voice_call_protocol from public.user_push_devices")).rows,
        [{ enabled: true, session_id: null, voice_call_protocol: null }]);
    });
  });
}

test("unsupported protocols/providers and invalid tokens cannot register", async () => {
  await withDatabase(async (db) => {
    for (const protocol of [0, 2, -1]) await assert.rejects(register(db, { protocol }), /unsupported_voice_call_protocol/);
    for (const [platform, provider] of [["ios", "apns"], ["windows", "wns"], ["Android", "fcm"], [null, "fcm"]]) {
      await assert.rejects(register(db, { platform, provider }), /unsupported_push_provider/);
    }
    for (const value of [null, "short", "x".repeat(4097)]) {
      await assert.rejects(register(db, { value }), /invalid_push_token/);
    }
    await assert.rejects(register(db, { user: null }), /not_authenticated/);
  });
});

async function metadata(db) {
  return (await db.query(`select jsonb_build_object(
    'function', (select jsonb_build_object('definition',pg_get_functiondef(oid),
      'owner',proowner::regrole::text,'acl',proacl::text,'defaults',pronargdefaults)
      from pg_proc where oid='${oldSignature}'::regprocedure),
    'unregister', (select jsonb_build_object('definition',pg_get_functiondef(oid),
      'owner',proowner::regrole::text,'acl',proacl::text)
      from pg_proc where oid='public.unregister_push_device(text,text)'::regprocedure),
    'columns', (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid='public.user_push_devices'::regclass and a.attnum>0 and not a.attisdropped),
    'table', (select jsonb_build_object('owner',relowner::regrole::text,'acl',relacl::text,
      'rls',relrowsecurity,'force',relforcerowsecurity) from pg_class where oid='public.user_push_devices'::regclass),
    'constraints', (select jsonb_agg(pg_get_constraintdef(oid) order by conname)
      from pg_constraint where conrelid='public.user_push_devices'::regclass),
    'policies', (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p
      where polrelid='public.user_push_devices'::regclass)
  ) as snapshot`)).rows[0].snapshot;
}

test("baseline generic device rows are retained unbound and byte-for-byte unchanged", async () => {
  await withDatabase(async (db) => {
    await register(db, { legacy: true });
    await db.exec(`insert into public.user_push_devices(user_id,platform,provider,token,token_hash)
      values ('${userA}','ios','apns','fictional-apns-device-01','fictional-apns-hash');`);
    const before = (await db.query("select to_jsonb(d) as row from public.user_push_devices d")).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query(`select to_jsonb(d)-'session_id'-'voice_call_protocol' as row
      from public.user_push_devices d where enabled and revoked_at is null`)).rows, before);
    assert.deepEqual((await db.query("select session_id, voice_call_protocol from public.user_push_devices")).rows,
      [{ session_id: null, voice_call_protocol: null }, { session_id: null, voice_call_protocol: null }]);
  }, "");
});

test("session deletion SET NULL preserves ordinary push and deleted claim cannot re-register voice", async () => {
  await withDatabase(async (db) => {
    await register(db);
    await db.exec(`set role supabase_auth_admin; delete from auth.sessions where id='${sessionA}'; set role postgres;`);
    assert.deepEqual((await db.query("select enabled, session_id, voice_call_protocol from public.user_push_devices")).rows,
      [{ enabled: true, session_id: null, voice_call_protocol: 1 }]);
    await assert.rejects(register(db), /invalid_push_session/);
    await register(db, { legacy: true });
    assert.equal((await db.query("select voice_call_protocol from public.user_push_devices")).rows[0].voice_call_protocol, null);
  });
});

test("stored protocol CHECK enforces literal 1 and android/fcm even for owner writes", async () => {
  await withDatabase(async (db) => {
    await register(db);
    for (const update of ["voice_call_protocol=2", "platform='ios'", "provider='apns'"]) {
      await assert.rejects(db.exec(`update public.user_push_devices set ${update}`),
        (e) => e.code === "23514" && e.constraint === "user_push_devices_voice_call_protocol_check");
    }
    await db.exec("update public.user_push_devices set platform='ios', provider='apns', voice_call_protocol=null");
    await assert.rejects(db.exec(`update public.user_push_devices set session_id='${missing}'`),
      (e) => e.code === "23503");
  });
});

test("exact wrapper defaults/names, owner and EXECUTE ACLs; no client table or private API access", async () => {
  await withDatabase(async (db) => {
    const { rows } = await db.query(`select pronargs, pronargdefaults, proargnames,
      pg_get_expr(proargdefaults,0) as defaults, proowner::regrole::text as owner, prosecdef
      from pg_proc where oid='${oldSignature}'::regprocedure`);
    assert.deepEqual(rows, [{ pronargs: 7, pronargdefaults: 4,
      proargnames: ["p_platform","p_provider","p_token","p_token_hash","p_device_id","p_device_model","p_app_version"],
      defaults: "NULL::text, NULL::text, NULL::text, NULL::text", owner: "postgres", prosecdef: true }]);
    for (const signature of [oldSignature, newSignature, implSignature]) {
      const acl = (await db.query(`select a.grantee::regrole::text as grantee,a.privilege_type,a.is_grantable
        from pg_proc p, lateral aclexplode(p.proacl) a where p.oid=$1::regprocedure order by grantee`, [signature])).rows;
      assert.deepEqual(acl, (signature === implSignature ? ["postgres"] : signature === oldSignature
        ? ["authenticated","postgres","service_role"] : ["authenticated","postgres"])
        .map((grantee) => ({ grantee, privilege_type: "EXECUTE", is_grantable: false })));
      assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') as allowed", [signature])).rows[0].allowed,
        signature === oldSignature);
    }
    for (const role of ["anon", "authenticated"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        assert.equal((await db.query("select has_table_privilege($1,'public.user_push_devices',$2) as yes", [role,privilege])).rows[0].yes, false);
      }
      await assert.rejects(asCaller(db, { role }, () => db.query("select count(*) from public.user_push_devices")), /permission denied/);
      await assert.rejects(asCaller(db, { role }, () => db.query(`select * from private.register_push_device_bound(
        'android','fcm','${token}',null,null,null,null,1::smallint,true)`)), /permission denied/);
    }
    await assert.rejects(register(db, { role: "anon" }), /permission denied for function register_push_device/);
    await assert.rejects(register(db, { role: "anon", legacy: true }), /permission denied for function register_push_device/);
    await assert.rejects(asCaller(db, {}, () => db.query(`select * from public.register_push_device(
      p_platform=>'android',p_provider=>'fcm',p_token=>'${token}',p_voice_call_protocol=>1::smallint)`)), /does not exist/);
    await assert.rejects(asCaller(db, {}, () => db.query(`select * from public.register_push_device(
      p_platform=>'android',p_provider=>'fcm',p_token=>'${token}',p_session_id=>'${sessionB}'::uuid)`)), /does not exist/);
    await register(db);
    // A transactional hypothetical SELECT grant separates RLS proof from ACL
    // denial. It is rolled back and is never part of the proposed migration.
    await db.exec("begin; grant select on public.user_push_devices to authenticated; set local role authenticated;");
    assert.deepEqual((await db.query("select current_user as role")).rows, [{ role: "authenticated" }]);
    assert.equal((await db.query("select count(*)::int as n from public.user_push_devices")).rows[0].n, 0);
    await db.exec("rollback");
  });
});

test("legacy validation and truncation remain identical, including historical NULL provider semantics", async () => {
  const calls = [
    ["android", "fcm", token, "ignored", " x ", " model ", " 1 "],
    [null, null, token, null, "a".repeat(180), "m".repeat(320), "v".repeat(80)],
    [" android ", "fcm", token, null, null, null, null],
    ["android", "FCM", token, null, null, null, null],
    ["ios", "apns", token, null, null, null, null],
    ["android", "fcm", "x".repeat(19), null, null, null, null],
    ["android", "fcm", "x".repeat(20), null, null, null, null],
    ["android", "fcm", "x".repeat(4096), null, null, null, null],
    ["android", "fcm", "x".repeat(4097), null, null, null, null],
  ];
  async function outcomes(sql) {
    const results = [];
    await withDatabase(async (db) => {
      for (const args of calls) {
        try {
          await asCaller(db, {}, () => db.query(`select public.register_push_device(
            $1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text)`, args));
          results.push((await db.query(`select token_hash,device_id,device_model,app_version
            from public.user_push_devices order by token_hash`)).rows);
        } catch (e) { results.push({ error: e.message }); }
      }
    }, sql);
    return results;
  }
  assert.deepEqual(await outcomes(migration), await outcomes(""));
});

test("identical reapply is a no-op, drift and incomplete application are refused", async () => {
  await withDatabase(async (db) => {
    const before = await metadata(db);
    await db.exec(migration);
    assert.deepEqual(await metadata(db), before);
    for (const drift of [
      `alter function ${implSignature} security invoker`,
      `grant execute on function ${newSignature} to anon`,
      `revoke execute on function ${implSignature} from postgres`,
      `revoke execute on function ${oldSignature} from service_role`,
      `grant execute on function ${newSignature} to service_role`,
      "alter table public.user_push_devices alter column voice_call_protocol set default 1",
      "alter table public.user_push_devices drop constraint user_push_devices_session_id_fkey",
      `drop function ${newSignature}`,
    ]) {
      await db.exec(`begin; ${drift};`);
      await assert.rejects(db.exec(migration.replace(/^begin;$/m, "").replace(/^commit;$/m, "")), /push_binding_.*(drift|state)/);
      await db.exec("rollback");
    }
  });
});

test("rollback restores exact registration metadata, leaves generic data, and can reapply", async () => {
  await withDatabase(async (db) => {
    const before = await metadata(db);
    await register(db, { legacy: true });
    const beforeRows = (await db.query("select to_jsonb(d) as row from public.user_push_devices d")).rows;
    await db.exec(migration);
    await db.exec(read(`${stem}.rollback.sql`));
    assert.deepEqual(await metadata(db), before);
    assert.deepEqual((await db.query("select to_jsonb(d) as row from public.user_push_devices d")).rows, beforeRows);
    assert.deepEqual((await db.query(`select to_regprocedure('${newSignature}') as new,
      to_regprocedure('${implSignature}') as impl`)).rows, [{ new: null, impl: null }]);
    await register(db, { legacy: true, value: "fictional-fcm-device-02" });
    await db.exec(migration);
    await register(db);
  }, "");
});

test("rollback refuses dependent objects and rolls back every partial DDL change", async () => {
  await withDatabase(async (db) => {
    const before = await metadata(db);
    for (const [create, object, remove] of [
      ["create view public.fixture_session_dependency as select session_id from public.user_push_devices", "public.fixture_session_dependency", "drop view public.fixture_session_dependency"],
      ["create index fixture_session_dependency on public.user_push_devices(session_id)", "public.fixture_session_dependency", "drop index public.fixture_session_dependency"],
    ]) {
      await db.exec(create);
      await assert.rejects(db.exec(read(`${stem}.rollback.sql`)), (e) => e.code === "2BP01");
      await db.exec("rollback");
      assert.deepEqual(await metadata(db), before);
      assert.ok((await db.query("select to_regclass($1) as object", [object])).rows[0].object);
      await db.exec(remove);
    }
  });
});

test("current_user must be postgres, even if the session administrator is superuser", async () => {
  await withDatabase(async (db) => {
    await db.exec("set role fixture_control");
    await assert.rejects(db.exec(migration), /push_binding_owner_guard/);
    await db.exec("rollback; set role postgres;");
    await db.exec(migration);
  }, "");
});

test("baseline body, private schema ACL and table grants cannot be silently repaired", async () => {
  await withDatabase(async (db) => {
    for (const [drift, error] of [
      [`alter function ${oldSignature} set search_path=public`, /push_binding_legacy_drift/],
      ["grant usage on schema private to authenticated", /push_binding_auth_baseline/],
      ["grant select on public.user_push_devices to authenticated", /push_binding_rls_grants_baseline/],
      ["grant update(enabled) on public.user_push_devices to authenticated", /push_binding_rls_grants_baseline/],
      [`grant execute on function ${oldSignature} to anon`, /push_binding_function_drift/],
    ]) {
      await db.exec(`begin; ${drift};`);
      await assert.rejects(db.exec(migration.replace(/^begin;$/m, "").replace(/^commit;$/m, "")), error);
      await db.exec("rollback");
    }
  }, "");
});

function mutate(sql, needle, replacement) {
  assert.equal(sql.split(needle).length - 1, 1, `mutation must match exactly once: ${needle}`);
  return sql.replace(needle, replacement);
}

test("mutation: removing session ownership is caught by cross-user assertion", async () => {
  await withDatabase(async (db) => {
    await assert.rejects(assert.rejects(register(db, { session: sessionB }), /invalid_push_session/),
      (e) => e.code === "ERR_ASSERTION" && /Missing expected rejection/.test(e.message));
  }, mutate(migration, "and s.user_id = v_user", "and true"));
});

test("mutation: removing not_after expiry is caught by stale-session assertion", async () => {
  await withDatabase(async (db) => {
    await assert.rejects(assert.rejects(register(db, { session: expired }), /invalid_push_session/),
      (e) => e.code === "ERR_ASSERTION" && /Missing expected rejection/.test(e.message));
  }, mutate(migration, "and (s.not_after is null or s.not_after > clock_timestamp())", "and true"));
});

test("mutation: wrong auth.sessions owner cannot silently pass owner preflight", async () => {
  const mutated = mutate(migration, "and relowner = 'supabase_auth_admin'::regrole", "and true");
  await withDatabase(async (db) => {
    await db.exec("set role fixture_control; alter table auth.sessions owner to fixture_control; set role postgres;");
    await assert.rejects(db.exec(migration), /push_binding_owner_guard/);
    await db.exec("rollback");
    await assert.rejects(assert.rejects(db.exec(mutated), /push_binding_owner_guard/),
      (e) => e.code === "ERR_ASSERTION" && /Missing expected rejection/.test(e.message));
  }, "");
});

for (const [name, signature] of [["new RPC", newSignature], ["private implementation", implSignature]]) {
  test(`mutation: omitted ${name} REVOKE is caught by ACL self-check`, async () => {
    const needle = `    revoke all on function ${signature} from public, anon, authenticated, service_role;`;
    await assert.rejects(database(mutate(migration, needle, "")), /push_binding_function_self_check/);
  });
}

test("mutation: permissive protocol CHECK is caught by catalog assertion", async () => {
  await assert.rejects(database(mutate(migration,
    "check (voice_call_protocol is null or (voice_call_protocol = 1 and platform = 'android' and provider = 'fcm'));",
    "check (voice_call_protocol is null or (voice_call_protocol >= 1 and platform = 'android' and provider = 'fcm'));")), /push_binding_column_constraint_drift/);
});

test("mutation: retaining inherited new RPC service_role EXECUTE is caught by ACL self-check", async () => {
  const needle = `revoke all on function ${newSignature} from public, anon, authenticated, service_role;`;
  const replacement = `revoke all on function ${newSignature} from public, anon, authenticated;`;
  await assert.rejects(database(mutate(migration, needle, replacement)), /push_binding_function_self_check/);
});

test("mutation: losing legacy service_role EXECUTE is caught by ACL self-check", async () => {
  const needle = `    grant execute on function ${oldSignature} to authenticated;`;
  await assert.rejects(database(mutate(migration, needle,
    `    revoke execute on function ${oldSignature} from service_role;\n${needle}`)), /push_binding_function_self_check/);
});

test("mutation: lost RLS is caught by raising preservation self-check", async () => {
  await assert.rejects(database(mutate(migration, "  if v_fresh then\n",
    "  alter table public.user_push_devices disable row level security;\n  if v_fresh then\n")), /push_binding_preservation_self_check/);
});

test("self-contained SQL rehearsal uses real roles and leaves no fixture state", async () => {
  await withDatabase(async (db) => {
    const before = await metadata(db);
    await db.exec("set role fixture_control;");
    await db.exec("delete from auth.sessions; delete from auth.users;");
    await db.exec(`create function public.fixture_onboarding_guard() returns trigger language plpgsql as
      $$ begin raise exception 'fixture onboarding trigger must be suspended only during setup'; end $$;
      create trigger on_auth_user_created after insert on auth.users for each row execute function public.fixture_onboarding_guard();
      create trigger trg_registration_invite_apply_from_profile after insert on public.profiles for each row execute function public.fixture_onboarding_guard();
      create trigger trg_bootstrap_first_admin after insert on public.profiles for each row execute function public.fixture_onboarding_guard();
      alter table public.profiles enable always trigger trg_bootstrap_first_admin;`);
    const triggersBefore = (await db.query(`select tgrelid,tgname,tgenabled from pg_trigger
      where tgfoid='public.fixture_onboarding_guard()'::regprocedure order by tgname`)).rows;
    await db.exec(read(`${stem}.rehearsal.sql`));
    assert.deepEqual((await db.query(`select tgrelid,tgname,tgenabled from pg_trigger
      where tgfoid='public.fixture_onboarding_guard()'::regprocedure order by tgname`)).rows, triggersBefore);
    await db.exec("set role postgres;");
    assert.deepEqual(await metadata(db), before);
    assert.equal((await db.query("select count(*)::int as n from public.user_push_devices")).rows[0].n, 0);
  });
});

test("token rebinds account/session; old owner cannot unregister or mutate it", async () => {
  await withDatabase(async (db) => {
    await register(db);
    const id = (await db.query("select id from public.user_push_devices")).rows[0].id;
    assert.deepEqual((await register(db, { user: userB, session: sessionB, hash: "different" })).rows,
      [{ recipient_id: userB, recipient_session_id: sessionB }]);
    await asCaller(db, {}, () => db.query("select public.unregister_push_device('fcm',$1)", [token]));
    assert.deepEqual((await db.query("select id,user_id,session_id,enabled from public.user_push_devices")).rows,
      [{ id, user_id: userB, session_id: sessionB, enabled: true }]);
    await assert.rejects(asCaller(db, {}, () => db.exec("update public.user_push_devices set enabled=false")), /permission denied/);
    await register(db, { legacy: true });
    assert.deepEqual((await db.query("select user_id,session_id,voice_call_protocol from public.user_push_devices")).rows,
      [{ user_id: userA, session_id: sessionA, voice_call_protocol: null }]);
  });
});
