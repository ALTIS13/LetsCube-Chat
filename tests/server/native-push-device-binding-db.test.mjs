import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = new URL("../../", import.meta.url);
const proposalPath = "supabase/migration-proposals/native_push_device_binding.sql";
const read = async path => readFile(new URL(path, root), "utf8");
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = uuid(1), other = uuid(2), session = uuid(3), replacement = uuid(4), otherSession = uuid(5);
const token = "fictional-fcm-binding-token-01";
const hash = createHash("sha256").update(token).digest("hex");
const rpc = "public.native_push_device_binding(text)";

async function proposal() {
  try { return await read(proposalPath); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

function definition(source, name) {
  const start = source.indexOf(`create function public.${name}(`);
  const end = source.indexOf("$fn$;", start) + "$fn$;".length;
  assert.ok(start >= 0 && end > start, "actual installed definition must be present");
  return source.slice(start, end);
}

// Real registration SQL, recipient authority and pgcrypto; only claims/rows are
// fictional. This does not validate JWT signatures, HTTP behavior or FCM delivery.
async function fixture(sql) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  try {
    const old = await read(".migration-backup/supabase/migrations/20260711_native_push_fcm_delivery.sql");
    const registration = await read(".migration-backup/supabase/migrations/20260921114126_android_push_session_binding.sql");
    const installed = await read("supabase/migrations/20261007210924_native_message_preview.sql");
    await db.exec(`
      create role fixture_control superuser login;
      set session authorization fixture_control;
      alter role postgres rename to fixture_admin;
      create role postgres nosuperuser bypassrls;
      create role authenticated nosuperuser nobypassrls;
      create role anon nosuperuser nobypassrls;
      create role service_role nosuperuser bypassrls;
      create role outsider nosuperuser nobypassrls;
      create role supabase_auth_admin nosuperuser;
      create schema auth authorization supabase_auth_admin;
      create schema private authorization postgres;
      create schema extensions authorization postgres;
      revoke all on schema private from public, anon, authenticated, service_role;
      grant usage on schema public, auth, extensions to postgres, authenticated, anon, service_role, outsider;
      grant create on schema public to postgres;
      create extension pgcrypto with schema extensions;
      create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key, user_id uuid not null references auth.users(id),
        created_at timestamptz not null default now(), not_after timestamptz);
      alter table auth.users owner to supabase_auth_admin;
      alter table auth.sessions owner to supabase_auth_admin;
      grant select, references on auth.sessions to postgres;
      grant references on auth.users to postgres;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
      $$;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(auth.jwt()->>'sub','')::uuid
      $$;
      insert into auth.users values ('${owner}'),('${other}');
      insert into auth.sessions values
        ('${session}','${owner}',now()-interval '1 hour',null),
        ('${replacement}','${owner}',now()-interval '1 hour',null),
        ('${otherSession}','${other}',now()-interval '1 hour',null);
      set role postgres;
      alter default privileges for role postgres in schema public
        grant execute on functions to anon, authenticated, service_role;
      ${old.slice(old.indexOf("create table if not exists public.user_push_devices"), old.indexOf("update public.user_push_devices"))}
      alter table public.user_push_devices add column session_id uuid
        references auth.sessions(id) on delete set null, add column voice_call_protocol smallint;
      alter table public.user_push_devices add constraint user_push_devices_voice_call_protocol_check
        check (voice_call_protocol is null or (voice_call_protocol=1 and platform='android' and provider='fcm'));
      create unique index user_push_devices_provider_token_hash_uidx
        on public.user_push_devices(provider,token_hash);
      alter table public.user_push_devices enable row level security;
      revoke all on public.user_push_devices from public, anon, authenticated, service_role;
      create table public.notification_preview_preferences(user_id uuid primary key,preview_level text not null default 'none');
      alter table public.notification_preview_preferences enable row level security;
      revoke all on public.notification_preview_preferences from public, anon, authenticated, service_role;
    `);
    for (const name of ["legacy", "new", "impl"]) {
      const ddl = registration.match(new RegExp(`v_${name}_ddl text := \\$ddl\\$([\\s\\S]*?)\\$ddl\\$;`));
      assert.ok(ddl, "actual registration definition must be present");
      await db.exec(ddl[1]);
    }
    await db.exec(`
      revoke all on function public.register_push_device(text,text,text,text,text,text,text),
        public.register_push_device(text,text,text,text,text,text,text,smallint)
        from public,anon,authenticated,service_role;
      grant execute on function public.register_push_device(text,text,text,text,text,text,text),
        public.register_push_device(text,text,text,text,text,text,text,smallint) to authenticated;
      ${definition(installed, "native_message_preview_recipient")}
      alter function public.native_message_preview_recipient() owner to postgres;
      revoke all on function public.native_message_preview_recipient() from public,anon,authenticated,service_role;
      grant execute on function public.native_message_preview_recipient() to authenticated;
    `);
    if (sql !== undefined) await db.exec(sql);
    return db;
  } catch (error) {
    delete error.query;
    await db.close();
    throw error;
  }
}

async function caller(db, run, { dbRole = "authenticated", ...overrides } = {}, readOnly = false) {
  await db.exec(`begin${readOnly ? " read only" : ""}; set session authorization ${dbRole};`);
  try {
    const claims = { sub: owner, session_id: session, role: "authenticated", is_anonymous: false,
      exp: Math.floor(Date.now() / 1000) + 3600, ...overrides };
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
    assert.deepEqual((await db.query("select current_user as role,session_user as session_role,rolsuper from pg_roles where rolname=current_user")).rows,
      [{ role: dbRole, session_role: dbRole, rolsuper: false }]);
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (error) {
    delete error.query;
    await db.exec("rollback");
    throw error;
  } finally {
    await db.exec("reset session authorization; set session authorization fixture_control; set role postgres");
  }
}

async function register(db, claims, value = token, metadata = uuid(90)) {
  return caller(db, async () => (await db.query(`select * from public.register_push_device(
    'android','fcm',$1::text,'deliberately-not-the-token-hash',$2::text,'fictional model','fixture',1::smallint)`,
  [value, metadata])).rows, claims);
}

async function resolve(db, selector = hash, claims, readOnly = false) {
  return caller(db, async () => (await db.query("select * from public.native_push_device_binding($1::text)", [selector])).rows,
    claims, readOnly);
}

async function using(sql, run) {
  const db = await fixture(sql);
  try { await run(db); } finally { await db.close(); }
}

test("control: actual registration acknowledges owner/session and derives its own token hash", async () => {
  await using(undefined, async db => {
    assert.deepEqual(await register(db), [{ recipient_id: owner, recipient_session_id: session }]);
    const row = (await db.query("select id,token_hash,device_id from public.user_push_devices")).rows[0];
    assert.equal(row.token_hash, hash);
    assert.equal(row.device_id, uuid(90));
    assert.notEqual(row.id, row.device_id);
  });
});

test("control: actual installed recipient accepts live owner and refuses expired claims", async () => {
  await using(undefined, async db => {
    const recipient = overrides => caller(db, async () =>
      (await db.query("select public.native_message_preview_recipient() as recipient")).rows[0].recipient, overrides);
    assert.equal(await recipient(), owner);
    assert.equal(await recipient({ exp: 1 }), null);
    assert.equal(await recipient({ session_id: otherSession }), null);
  });
});

test("resolver exists as a distinct read-only contract", async () => {
  await using(await proposal(), async db => {
    assert.equal((await db.query("select to_regprocedure($1) is not null as present", [rpc])).rows[0].present,
      true, "recipient/session-bound device UUID resolver is absent");
  });
});

async function positive(db) {
  const id = (await db.query("select id from public.user_push_devices where provider='fcm' and token_hash=$1", [hash])).rows[0].id;
  assert.deepEqual(await resolve(db), [{ binding_v: 1, recipient_id: owner, session_id: session, device_id: id }]);
  return id;
}

async function state(db) {
  return (await db.query(`select md5(jsonb_build_object(
    'devices',(select jsonb_agg(to_jsonb(d) order by id) from public.user_push_devices d),
    'sessions',(select jsonb_agg(to_jsonb(s) order by id) from auth.sessions s),
    'consent',(select jsonb_agg(to_jsonb(c) order by user_id) from public.notification_preview_preferences c),
    'relations',(select jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity)
      order by c.oid) from pg_class c where c.oid in ('public.user_push_devices'::regclass,
        'auth.sessions'::regclass,'public.notification_preview_preferences'::regclass)),
    'columnACL',(select jsonb_agg(jsonb_build_array(attrelid,attnum,attacl) order by attrelid,attnum)
      from pg_attribute where attrelid='public.user_push_devices'::regclass),
    'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p),
    'defaults',(select jsonb_agg(to_jsonb(a) order by oid) from pg_default_acl a),
    'functions',(select jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proacl)
      order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private','auth') and p.proname<>'native_push_device_binding')
  )::text) as digest`)).rows[0].digest;
}

test("genuine registration resolves UUID primary key, not text device metadata or caller hash", async () => {
  await using(await proposal(), async db => {
    await register(db, undefined, token, "fictional-device-metadata");
    const id = await positive(db);
    assert.equal((await db.query("select device_id from public.user_push_devices")).rows[0].device_id,
      "fictional-device-metadata");
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.deepEqual(await resolve(db, "deliberately-not-the-token-hash"), []);
    assert.deepEqual(await resolve(db, "f".repeat(64)), []);
    await positive(db);
  });
});

test("lookup is read-only and installation preserves old rows, functions, RLS and ACLs", async () => {
  await using(undefined, async db => {
    await register(db);
    await db.query("insert into public.notification_preview_preferences values($1,'none')", [owner]);
    const before = await state(db);
    await db.exec(await proposal());
    assert.equal(await state(db), before);
    const id = await positive(db);
    assert.deepEqual(await resolve(db, hash, undefined, true),
      [{ binding_v: 1, recipient_id: owner, session_id: session, device_id: id }]);
    assert.deepEqual(await resolve(db, null, undefined, true), []);
    assert.equal(await state(db), before);
    await assert.rejects(caller(db, () => db.query("select id from public.user_push_devices")),
      error => error.code === "42501");
  });
});

test("same-user new session cannot discover old binding and old session cannot discover its replacement", async () => {
  await using(await proposal(), async db => {
    await register(db);
    const id = await positive(db);
    assert.deepEqual(await resolve(db, hash, { session_id: replacement }), []);
    assert.deepEqual(await register(db, { session_id: replacement }),
      [{ recipient_id: owner, recipient_session_id: replacement }]);
    assert.deepEqual(await resolve(db), []);
    assert.deepEqual(await resolve(db, hash, { session_id: replacement }),
      [{ binding_v: 1, recipient_id: owner, session_id: replacement, device_id: id }]);
  });
});

const rowRefusals = [
  ["foreign owner", `update public.user_push_devices set user_id='${other}'`],
  ["foreign session", `update public.user_push_devices set session_id='${otherSession}'`],
  ["null session", "update public.user_push_devices set session_id=null"],
  ["disabled", "update public.user_push_devices set enabled=false"],
  ["null enabled drift", "alter table public.user_push_devices alter column enabled drop not null; update public.user_push_devices set enabled=null"],
  ["revoked", "update public.user_push_devices set revoked_at=now()"],
  ["non Android", "update public.user_push_devices set voice_call_protocol=null,platform='ios'"],
  ["non FCM", "update public.user_push_devices set voice_call_protocol=null,provider='apns'"],
  ["deleted session", "reset role; delete from auth.sessions; set role postgres"],
  ["hard expired session", "reset role; update auth.sessions set not_after=now()-interval '1 second'; set role postgres"],
  ["future session", "reset role; update auth.sessions set created_at=now()+interval '1 hour'; set role postgres"],
];
test("exact live owner/session and endpoint status refuse stale rows", async t => {
  for (const [name, change] of rowRefusals) {
    await t.test(name, async () => using(await proposal(), async db => {
      await register(db);
      await positive(db);
      await db.exec(change);
      assert.deepEqual(await resolve(db), []);
    }));
  }
});

test("actual recipient rejects invalid JWT/session contexts and hash format never discovers rows", async () => {
  await using(await proposal(), async db => {
    await register(db);
    for (const context of [
      { sub: other }, { session_id: otherSession }, { session_id: uuid(99) }, { session_id: null },
      { session_id: "malformed" }, { sub: "malformed" }, { exp: 1 }, { exp: null },
      { exp: "1e20" }, { is_anonymous: true }, { is_anonymous: null }, { role: "service_role" },
    ]) {
      assert.deepEqual(await resolve(db, hash, context), []);
    }
    for (const selector of [null, "", ` ${hash}`, `${hash}\n`, hash.toUpperCase(), hash.slice(1), "x".repeat(64)]) {
      assert.deepEqual(await resolve(db, selector), []);
    }
    await positive(db);
    // A corrupt stored hash cannot bypass syntax refusal even if it matches input.
    await db.query("update public.user_push_devices set token_hash=$1", ["not-a-canonical-hash"]);
    assert.deepEqual(await resolve(db, "not-a-canonical-hash"), []);
  });
});

test("hash ambiguity refuses before owner/status filtering, including an ineligible duplicate", async () => {
  await using(await proposal(), async db => {
    await register(db);
    await positive(db);
    // Deliberate fixture-only drift after installation, not a production repair.
    await db.exec("drop index public.user_push_devices_provider_token_hash_uidx");
    await db.query(`insert into public.user_push_devices(user_id,platform,provider,token,token_hash,
      enabled,revoked_at,session_id) values($1,'android','fcm','fictional-duplicate',$2,false,now(),$3)`,
    [other, hash, otherSession]);
    assert.deepEqual(await resolve(db), []);
    await db.query("delete from public.user_push_devices where user_id=$1", [other]);
    await positive(db);
  });
});

test("same hash in a different provider namespace neither selects nor vetoes the owned FCM row", async () => {
  await using(await proposal(), async db => {
    await register(db);
    await db.query(`insert into public.user_push_devices(user_id,platform,provider,token,token_hash,session_id)
      values($1,'ios','apns','fictional-apns-only',$2,$3)`, [other, hash, otherSession]);
    await positive(db);
  });
});

test("only authenticated execution is granted; PUBLIC, anon, service and outsider remain denied", async () => {
  await using(await proposal(), async db => {
    await register(db);
    for (const role of ["anon", "service_role", "outsider"]) {
      await assert.rejects(resolve(db, hash, { dbRole: role }), error => error.code === "42501");
    }
    await positive(db);
    assert.deepEqual((await db.query(`select a.grantee::regrole::text as grantee,a.privilege_type,a.is_grantable
      from pg_proc p,lateral aclexplode(p.proacl) a where p.oid=$1::regprocedure order by grantee`, [rpc])).rows,
    ["authenticated", "postgres"].map(grantee => ({ grantee, privilege_type: "EXECUTE", is_grantable: false })));
  });
});

test("caller SET or RESET ROLE cannot turn a foreign or denied context into the definer owner", async () => {
  await using(await proposal(), async db => {
    await register(db);
    for (const role of ["postgres", "fixture_control", "service_role"]) {
      await assert.rejects(caller(db, () => db.exec(`set role ${role}`)), error => error.code === "42501");
    }
    for (const dbRole of ["anon", "outsider"]) {
      await assert.rejects(caller(db, () => db.exec("set role authenticated"), { dbRole }), error => error.code === "42501");
    }
    await caller(db, async () => {
      await db.exec("reset role");
      assert.deepEqual((await db.query("select current_user as role,session_user as session_role")).rows,
        [{ role: "authenticated", session_role: "authenticated" }]);
      assert.deepEqual((await db.query("select * from public.native_push_device_binding($1)", [hash])).rows, []);
    }, { sub: other, session_id: otherSession });
    await positive(db);
  });
});

test("raw CRLF proposal bytes fail the pinned body hash instead of being normalized by fixture", async () => {
  const raw = await proposal();
  assert.ok(!raw.includes("\r"), "reviewed proposal is LF and must be applied byte-identically");
  await using(undefined, async db => {
    await assert.rejects(db.exec(raw.replaceAll("\n", "\r\n")), error => error.code === "P0001"
      && error.message === "native_push_device_binding_definition_refused");
    await db.exec("rollback");
    assert.equal((await db.query("select to_regprocedure($1) is null as absent", [rpc])).rows[0].absent, true);
  });
});

test("locked dependency check sees ACL drift at the lock boundary and rolls it back", async () => {
  const lock = "lock table public.user_push_devices in share update exclusive mode;";
  const sql = mutate(await proposal(), lock, `${lock}\ngrant select(token_hash) on public.user_push_devices to authenticated;`);
  await using(undefined, async db => {
    const before = await state(db);
    await assert.rejects(db.exec(sql), error => error.code === "P0001"
      && error.message === "native_push_device_binding_endpoint_acl_refused");
    await db.exec("rollback");
    assert.equal(await state(db), before);
    assert.equal((await db.query("select to_regprocedure($1) is null as absent", [rpc])).rows[0].absent, true);
  });
});

test("any existing same-name overload and missing unique index refuse without partial installation", async () => {
  const sql = await proposal();
  for (const setup of [
    "create function public.native_push_device_binding(uuid) returns boolean language sql as $$ select false $$",
    "drop index public.user_push_devices_provider_token_hash_uidx",
    "grant select(token_hash) on public.user_push_devices to authenticated",
  ]) {
    await using(undefined, async db => {
      await db.exec(setup);
      const before = await state(db);
      await assert.rejects(db.exec(sql), error => error.code === "P0001");
      await db.exec("rollback");
      assert.equal((await db.query("select to_regprocedure($1) is null as absent", [rpc])).rows[0].absent, true);
      assert.equal(await state(db), before);
    });
  }
});

test("inherited anonymous EXECUTE is refused even without a direct anonymous grant", async () => {
  await using(undefined, async db => {
    await db.exec("reset role; grant authenticated to anon; set role postgres");
    await assert.rejects(db.exec(await proposal()), error => error.code === "P0001"
      && error.message === "native_push_device_binding_acl_refused");
    await db.exec("rollback");
    assert.equal((await db.query("select to_regprocedure($1) is null as absent", [rpc])).rows[0].absent, true);
  });
});

test("documented RESTRICT rollback removes only resolver and refuses dependent consumers", async () => {
  const sql = await proposal();
  const rollback = sql.match(/-- BEGIN;\n-- (DROP FUNCTION[^\n]+)\n-- COMMIT;/);
  assert.ok(rollback, "explicit rollback header must exist");
  await using(sql, async db => {
    await register(db);
    const before = await state(db);
    await db.exec("create view public.fixture_binding_consumer as select * from public.native_push_device_binding(null)");
    await assert.rejects(db.exec(`begin; ${rollback[1]} commit;`), error => error.code === "2BP01");
    await db.exec("rollback; drop view public.fixture_binding_consumer");
    await positive(db);
    await db.exec(`begin; ${rollback[1]} commit;`);
    assert.equal((await db.query("select to_regprocedure($1) is null as absent", [rpc])).rows[0].absent, true);
    assert.equal(await state(db), before);
  });
});

function mutate(source, before, after) {
  assert.equal(source.split(before).length, 2, "mutation must change exactly one site");
  return source.replace(before, after);
}

test("compiled behavioral omissions fail literal output and refusal oracles", async t => {
  const body = definition(await proposal(), "native_push_device_binding");
  const mutants = [
    ["literal version", "select 1::smallint", "select 2::smallint", "", positive],
    ["primary key", "v_session,d.id", `v_session,'${uuid(90)}'::uuid`, "", positive],
    ["owner", "d.user_id=v_recipient", "true", rowRefusals[0][1]],
    ["session", "d.session_id=v_session", "true", rowRefusals[1][1]],
    ["enabled true", "d.enabled is true", "true", rowRefusals[3][1]],
    ["enabled null", "d.enabled is true", "d.enabled is not false", rowRefusals[4][1]],
    ["revoked", "d.revoked_at is null", "true", rowRefusals[5][1]],
    ["platform", "d.platform='android'", "true", rowRefusals[6][1]],
    ["provider", "d.provider='fcm'", "true", rowRefusals[7][1]],
    ["hash selector", "d.token_hash=p_token_hash", "true", "", db => refusal(db, "f".repeat(64))],
    ["hash syntax", "p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'", "false",
      "update public.user_push_devices set token_hash='not-a-canonical-hash'", db => refusal(db, "not-a-canonical-hash")],
    ["cardinality", "(select count(*) from matching)=1", "true", `
      drop index public.user_push_devices_provider_token_hash_uidx;
      insert into public.user_push_devices(user_id,platform,provider,token,token_hash,enabled,session_id)
        values('${other}','android','fcm','fictional-duplicate','${hash}',false,'${otherSession}')`],
  ];
  for (const [name, before, after, change, oracle = refusal] of mutants) {
    await t.test(name, async () => using(mutate(body, before, after), async db => {
      await register(db);
      await db.exec(change);
      await assert.rejects(() => oracle(db), error => error instanceof assert.AssertionError,
        "compiled mutant must fail an assertion, not a SQL/setup error");
    }));
  }
});

async function refusal(db, selector = hash) { assert.deepEqual(await resolve(db, selector), []); }

test("raising definition and ACL selfchecks roll back weakened compiled proposals", async t => {
  const sql = await proposal();
  for (const [name, before, after] of [
    ["body", "select 1::smallint", "select 2::smallint"],
    ["output key", "returns table(binding_v smallint", "returns table(other_v smallint"],
    ["output type", "returns table(binding_v smallint", "returns table(binding_v integer"],
    ["owner", "owner to postgres;", "owner to fixture_control;"],
    ["stable", "language plpgsql stable security definer", "language plpgsql volatile security definer"],
    ["definer", "language plpgsql stable security definer", "language plpgsql stable security invoker"],
    ["search path", "set search_path = pg_catalog", "set search_path = pg_catalog,public"],
    ["ACL revoke", "revoke all on function public.native_push_device_binding(text)\n  from public,anon,authenticated,service_role;", ""],
    ["authenticated grant", "grant execute on function public.native_push_device_binding(text) to authenticated;", ""],
  ]) {
    await t.test(name, async () => using(undefined, async db => {
      if (name === "owner") {
        // Permit the altered owner so PostgreSQL reaches the proposal's guard.
        await db.exec("reset role; grant fixture_control to postgres; set role postgres");
      }
      const beforeState = await state(db);
      await assert.rejects(db.exec(mutate(sql, before, after)), error => error.code === "P0001");
      await db.exec("rollback");
      assert.equal((await db.query("select to_regprocedure($1) is null as absent", [rpc])).rows[0].absent, true);
      assert.equal(await state(db), beforeState);
    }));
  }
});

test("compiled inherited-ACL guard omission is caught by actual effective privilege", async () => {
  const sql = mutate(await proposal(), "or has_function_privilege('anon',p.oid,'EXECUTE')", "");
  await using(undefined, async db => {
    await db.exec("reset role; grant authenticated to anon; set role postgres");
    await db.exec(sql);
    await assert.rejects(async () => assert.equal((await db.query(
      "select has_function_privilege('anon',$1::regprocedure,'EXECUTE') as allowed", [rpc])).rows[0].allowed, false),
    error => error instanceof assert.AssertionError);
  });
});

test("compiled pre-lock dependency-check regression fails the lock-boundary ACL oracle", async () => {
  const original = await proposal();
  const dependency = original.match(/do \$dependency\$[\s\S]*?\$dependency\$;/)[0];
  const lock = "lock table public.user_push_devices in share update exclusive mode;";
  const sql = mutate(mutate(original, dependency, ""), lock,
    `${dependency}\n${lock}\ngrant select(token_hash) on public.user_push_devices to authenticated;`);
  await using(undefined, async db => {
    await db.exec(sql);
    await assert.rejects(async () => assert.equal((await db.query(`select
      has_column_privilege('authenticated','public.user_push_devices','token_hash','SELECT') as allowed`)).rows[0].allowed, false),
    error => error instanceof assert.AssertionError);
  });
});
