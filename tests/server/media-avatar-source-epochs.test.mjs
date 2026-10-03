import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { postgres, read, root } from "./bot-inline-media-ingest.fixture.mjs";
import { avatarEpochOwners, avatarEpochOther, avatarEpochReplacement, sqlLiteral as q,
  avatarEpochUrl, insertAvatarEpochOwner, currentAvatarEpoch, avatarEpochHistory,
  assertAvatarEpochLink, runAvatarEpochAssignments } from "./media-avatar-source-epochs.contract.mjs";

const candidatePath = "tests/server/fixtures/media-avatar-source-epochs-candidate.sql";
const rollbackPath = "tests/server/fixtures/media-avatar-source-epochs-candidate.rollback.sql";
const capturedOnly = process.env.AVATAR_EPOCH_CAPTURED === "1";
const hash = value => createHash("sha256").update(value).digest("hex");
const pins = {
  "tests/server/bot-inline-media-ingest.fixture.mjs": "7a70abed62580418a5d362a1660867ce4608632abf4e18ab049e6ef409d1942f",
  ".migration-backup/supabase/migrations/20260913120000_media_variant_job_queue.sql": "a04d22bb9898256e704ef153d7b0ed120534b45a6e1635caba4a06c5a2bf49cc",
  "supabase/migrations/20261003183925_media_variant_claim_token.sql": "2f11b9596fbd4a000a34499c0cae0d7f83772cd76199bd79c2c031a39a3db693",
  "supabase/migrations/20260930150100_micro_group_avatar_variants.sql": "94a2b7d5f020d23d4eaae36b8e1681026ab4fac408d2de65083db73b16890a42",
  "supabase/migrations/20260930170000_a_chat_keeps_its_kind.sql": "e1bf4a2e8e84f0509ea54c7f61479e0f323db86603b24d6f0db14c628aa80315",
  ".migration-backup/supabase/migrations/20260919030000_a_refusal_to_set_a_picture_says_why.sql": "0b143ea76e770c19fa824228454be03d332023e923279d17922f01c948dfe2d1",
};

function functionDDL(source, name) {
  const escaped = name.replaceAll(".", "\\.");
  const match = source.match(new RegExp(`create or replace function ${escaped}\\([^]*?as \\$function\\$[^]*?\\$function\\$;`, "i"));
  assert.ok(match, `captured function ${name} exists`); return match[0];
}
function body(ddl) { return ddl.split("$function$")[1]; }
const ident = value => '"' + value.replaceAll('"', '""') + '"';

function prepare() {
  const queue = read(".migration-backup/supabase/migrations/20260913120000_media_variant_job_queue.sql");
  const currentQueue = read("supabase/migrations/20261003183925_media_variant_claim_token.sql");
  const sourcePairs = [
    [queue, "private.enqueue_media_variant_job_for_profile"],
    [read("supabase/migrations/20260930150100_micro_group_avatar_variants.sql"), "private.enqueue_media_variant_job_for_chat"],
    [read("supabase/migrations/20260930170000_a_chat_keeps_its_kind.sql"), "private.chats_identity_is_fixed"],
    [read(".migration-backup/supabase/migrations/20260919030000_a_refusal_to_set_a_picture_says_why.sql"), "public.bot_set_avatar_internal"],
  ];
  for (const [source, name] of sourcePairs) {
    const capture = capturedOwnerMetadata().triggers.find(t => t.function.startsWith(`CREATE OR REPLACE FUNCTION ${name}(`))?.function
      ?? capturedOwnerMetadata().setters.find(t => t.definition.startsWith(`CREATE OR REPLACE FUNCTION ${name}(`))?.definition;
    assert.equal(body(functionDDL(source, name)), body(capture), `exact archived/live body ${name}`);
  }
  let sql = `grant create on database postgres to postgres; set role postgres; set check_function_bodies=off;
    do $$ begin
      if (select count(*) from public.bots) <> 2 or (select count(*) from public.chats) <> 2
        or exists(select 1 from public.bots where id not in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000010'))
        or exists(select 1 from public.chats where id not in ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000011'))
      then raise exception 'not_exact_fictional_harness_bootstrap'; end if;
    end $$;
    delete from private.bot_tokens where id in ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000012');
    delete from public.chat_bot_members where bot_id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000010');
    delete from public.bots where id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000010');
    delete from public.chats where id in ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000011');
    create schema auth authorization postgres;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    create function public.uid() returns uuid language sql stable as $$ select auth.uid() $$;
    create type public.app_role as enum ('user','manager','admin');
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text);
    create table public.profiles(id uuid primary key);
    create table public.chat_members(chat_id uuid,user_id uuid,role text,hidden_at timestamptz,primary key(chat_id,user_id));
    create table public.bot_owners(bot_id uuid,user_id uuid,role text);
    create table public.profile_contacts(user_id uuid primary key);
    create table public.roles(id uuid primary key,key text,scope text,is_active boolean,priority int);
    create table public.user_global_roles(user_id uuid,role_id uuid,assigned_by uuid);
    create table public.cosmetics(key text,kind text,active boolean,required_achievement text);
    create table public.user_achievements(user_id uuid,achievement_key text);
    create table private.bot_callback_interface_grants(chat_id uuid,viewer_id uuid,bot_id uuid);
    create table private.bot_viewer_interfaces(chat_id uuid,viewer_id uuid,bot_id uuid,closed_at timestamptz,version int);
    create table public.voice_ring_push_events(channel_id uuid,ring_started_at timestamptz,chat_id uuid,event text,state text);
    create function public.is_admin(p_id uuid default auth.uid()) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.profiles where id=p_id and role='admin') $$;
    create function public.is_manager_or_admin(p_id uuid default auth.uid()) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.profiles where id=p_id and role in ('admin','manager')) $$;
    create function public.is_banned(p_id uuid default auth.uid()) returns boolean language sql stable as $$ select false $$;
    create function public.is_chat_admin(p_id uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.chat_members where chat_id=p_id and user_id=auth.uid() and role in ('owner','admin')) $$;
    create function public.is_chat_owner(p_id uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.chat_members where chat_id=p_id and user_id=auth.uid() and role='owner') $$;
    create function public.registration_invite_normalize_code(p_code text) returns text language sql as $$ select nullif(trim(p_code),'') $$;
    create function public.registration_invites_required() returns boolean language sql as $$ select false $$;
    create function public.profile_reserved_username_key(p_name text) returns text language sql as $$ select lower(p_name) $$;
    create function public.profile_reserved_username_keys() returns text[] language sql as $$ select array['admin']::text[] $$;
    create function public.has_global_role(p_id uuid,p_role text) returns boolean language sql as $$ select false $$;
  `;
  for (const col of capturedOwnerMetadata().columns) {
    if (!["id", "type", "username", "state"].includes(col.name) || col.table === "profiles" && col.name !== "id") {
      sql += `alter table public.${col.table} add column ${ident(col.name)} ${col.type === "app_role" ? "public.app_role" : col.type};\n`;
    }
    const def = col.def === "uuid_generate_v4()" ? "gen_random_uuid()" : col.def;
    sql += `alter table public.${col.table} alter column ${ident(col.name)} ${def ? "set default " + def : "drop default"};\n`;
    sql += `alter table public.${col.table} alter column ${ident(col.name)} ${col.nullable === "NO" ? "set not null" : "drop not null"};\n`;
  }
  sql += `alter table public.profiles add constraint profiles_presence_status_check
    CHECK (((presence_status IS NULL) OR (presence_status = ANY (ARRAY['idle'::text, 'dnd'::text]))));\n`;
  sql += queue.slice(queue.indexOf("create table if not exists private.media_variant_jobs"), queue.indexOf("-- \u2500\u2500 the triggers"));
  // Capture current D-339 definitions, not its migration/application or old bodies.
  const queueDefinitions = [...currentQueue.matchAll(/create or replace function public\.media_variant_job_(?:finish|retry)\([^]*?\$function\$;/gi)].map(m => m[0]);
  assert.equal(queueDefinitions.length, 4);
  sql += queueDefinitions.join("\n") + "\n" + functionDDL(queue, "public.media_variant_jobs_claim") + "\n";
  for (const signature of ["media_variant_jobs_claim(integer,uuid,timestamptz)", "media_variant_job_finish(text,uuid)",
    "media_variant_job_finish(text,uuid,uuid)", "media_variant_job_retry(text,uuid,text,timestamptz)",
    "media_variant_job_retry(text,uuid,text,timestamptz,uuid)"]) {
    sql += `revoke all on function public.${signature} from public,anon,authenticated,service_role; grant execute on function public.${signature} to service_role;\n`;
  }
  for (const t of capturedOwnerMetadata().triggers) sql += t.function + ";\n" + t.trigger + ";\n";
  for (const s of capturedOwnerMetadata().setters) {
    sql += s.definition + ";\n";
    sql += `reset role; alter function public.${s.signature} owner to ${s.owner}; revoke all on function public.${s.signature} from public,anon,authenticated,service_role;\n`;
    for (const grant of s.acl) {
      const role = grant.split("=")[0];
      if (role !== s.owner) sql += `grant execute on function public.${s.signature} to ${role};\n`;
    }
    sql += "set role postgres;\n";
  }
  sql += "create trigger fixture_auth_profile_bootstrap after insert on auth.users for each row execute function public.handle_new_user();\n";
  for (const table of ["profiles", "chats", "bots"]) {
    sql += `alter table public.${table} enable row level security; revoke all on public.${table} from public,anon,authenticated,service_role;\n`;
  }
  for (const p of capturedOwnerMetadata().policies) {
    sql += `create policy ${ident(p.policyname)} on public.${p.tablename} as ${p.permissive} for ${p.cmd}
      to ${p.roles.map(ident).join(",")}${p.qual ? " using (" + p.qual + ")" : ""}${p.with_check ? " with check (" + p.with_check + ")" : ""};\n`;
  }
  for (const g of capturedOwnerMetadata().grants) {
    sql += `grant ${g.privilege_type} on public.${g.table_name} to ${ident(g.grantee)}${g.is_grantable === "YES" ? " with grant option" : ""};\n`;
  }
  sql += "grant select on public.chat_members,public.chat_bot_members,public.bot_owners to authenticated,anon; reset check_function_bodies; reset role;";
  return sql;
}

let raw, directory, inputManifest, binaryManifest;
const cleanups = [], pending = new Set();
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
}
before(async () => {
  assert.ok(process.env.BOT_INGEST_PG_BIN, "configured owned local PG binaries required");
  assert.ok(!process.env.BOT_INGEST_TEST_BASELINE, "real captured fixture bootstrap required");
  const inputs = { ...pins };
  for (const [path, expected] of Object.entries(pins)) assert.equal(hash(readFileSync(new URL(path, root))), expected, path);
  for (const path of ["tests/server/media-avatar-source-epochs.test.mjs", "tests/server/media-avatar-source-epochs.contract.mjs",
    ...(!capturedOnly ? [candidatePath, rollbackPath] : [])]) inputs[path] = hash(readFileSync(new URL(path, root)));
  console.log("pre-SQL input hashes " + JSON.stringify(inputs));
  inputManifest = inputs;
  binaryManifest = Object.fromEntries(["initdb", "pg_ctl", "psql", "postgres"].map(name => {
    const path = resolve(process.env.BOT_INGEST_PG_BIN, name + (process.platform === "win32" ? ".exe" : ""));
    return [path, hash(readFileSync(path))];
  }));
  console.log("pre-SQL configured PG binary hashes " + JSON.stringify(binaryManifest));
  raw = await postgres({ after(fn) { cleanups.push(fn); } }, prepare());
  const [owned] = await raw.query("select current_user as owner,current_setting('data_directory') as path");
  assert.equal(owned.owner, "fixture_control"); directory = owned.path;
  assert.equal(resolve(dirname(directory)), resolve(tmpdir())); assert.match(basename(directory), /^letscube-bot-ingest-/);
  console.log("exact owned PG directory " + directory);
  console.log("owned PostgreSQL " + raw.version + "; startup awaited outside per-case timeout");
});
after(async () => {
  const start = performance.now();
  try { await bounded(Promise.allSettled([...pending]), 8000, "SQL settling exceeded 8s"); assert.equal(pending.size, 0); }
  finally { await bounded((async () => { for (const fn of cleanups.reverse()) await fn(); })(), 12000, "owned disposal exceeded 12s"); }
  if (directory) assert.equal(existsSync(directory), false); assert.ok(performance.now() - start < 20000);
  for (const [path, expected] of Object.entries(inputManifest ?? {})) assert.equal(hash(readFileSync(new URL(path, root))), expected, "final input hash " + path);
  for (const [path, expected] of Object.entries(binaryManifest ?? {})) assert.equal(hash(readFileSync(path)), expected, "final configured binary hash " + path);
  console.log(`SQL pending=0; exact owned PG directory absent; cleanup ${Math.ceil(performance.now() - start)}ms`);
});

async function catalog(query) {
  return query(`select kind,value from (
    select 'function' as kind,jsonb_build_object('signature',p.oid::regprocedure::text,'ddl',pg_get_functiondef(p.oid),
      'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig) as value
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','auth') and p.prokind='f'
    union all select 'trigger',jsonb_build_object('ddl',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
      from pg_trigger t where not t.tgisinternal
    union all select 'policy',to_jsonb(p) from pg_policies p
    union all select 'schema',jsonb_build_object('name',nspname,'acl',nspacl::text,'owner',pg_get_userbyid(nspowner))
      from pg_namespace where nspname in ('public','private','auth')
    union all select 'table',jsonb_build_object('name',c.oid::regclass::text,'owner',pg_get_userbyid(c.relowner),
      'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth') and c.relkind='r'
    union all select 'column',jsonb_build_object('table',a.attrelid::regclass::text,'position',a.attnum,'name',a.attname,
      'acl',a.attacl::text,'type',a.atttypid::regtype::text,'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid))
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where n.nspname in ('public','private','auth') and c.relkind='r' and a.attnum>0 and not a.attisdropped
  ) s order by kind,value::text`);
}
async function fixture(t, { install = !capturedOnly, inject = false } = {}) {
  const failures = [], injected = new assert.AssertionError({ message: "fictional epoch adapter assertion" });
  injected.code = "42501";
  const retainUnexpected = error => {
    if ((error instanceof assert.AssertionError || !/^[0-9A-Z]{5}$/.test(error.code ?? "")) && !failures.includes(error)) failures.push(error);
  };
  const exec = sql => {
    const job = (async () => {
      try {
        if (inject && sql.includes("fictional-epoch-adapter-assertion")) throw injected;
        return await raw.exec("set statement_timeout='4s'; set lock_timeout='2s';\n" + sql);
      } catch (error) { retainUnexpected(error); throw error; }
    })();
    pending.add(job); const settle = () => pending.delete(job); job.then(settle, settle);
    return bounded(job, 8000, "SQL transport exceeded 8s").catch(error => { retainUnexpected(error); throw error; });
  };
  const query = async sql => JSON.parse(await exec(`select coalesce(jsonb_agg(q),'[]'::jsonb) from (${sql}) q;`));
  const apply = sql => exec("set role postgres;\n" + sql + "\nreset role;");
  const before = await catalog(query);
  t.after(async () => {
    await bounded(Promise.allSettled([...pending]), 8000, "case SQL settling exceeded 8s");
    try {
      const [{ present }] = await query("select to_regclass('private.media_avatar_source_current') is not null as present");
      if (present) await apply(read(rollbackPath));
      const ids = [...avatarEpochOwners.map(o => o.id), avatarEpochOther, avatarEpochReplacement].map(q).join(",");
      await exec(`delete from auth.users where id in (${ids}); delete from public.profiles where id in (${ids});
        delete from public.chats where id in (${ids}); delete from public.bots where id in (${ids});
        delete from public.profile_contacts where user_id in (${ids}); delete from public.bot_owners where bot_id in (${ids});
        delete from public.chat_members where chat_id in (${ids}); delete from private.media_variant_jobs where target_id in (${ids});`);
      assert.deepEqual(await catalog(query), before, "exact prestate catalog including current D-339 restored");
      for (const table of ["profiles", "chats", "bots", "profile_contacts"]) {
        const [{ count }] = await query(`select count(*)::int as count from public.${table}`); assert.equal(count, 0);
      }
      const [{ count }] = await query("select count(*)::int as count from private.media_variant_jobs"); assert.equal(count, 0);
    } finally { assert.deepEqual(failures, inject ? [injected] : [], "every unexpected adapter assertion survives"); }
    t.diagnostic("exact fictional rows cleared; original catalog/roles/queue restored; SQL settled");
  });
  if (install) await apply(read(candidatePath));
  return { exec, query, apply, before, failures, injected };
}

for (const owner of avatarEpochOwners) {
  test(`desired ${owner.scope}: INSERT NULL, equal, clear, ABA and unrelated-write literal epochs`, { timeout: 60000 }, async t => {
    const f = await fixture(t);
    assert.deepEqual(await runAvatarEpochAssignments(f, owner), { events: 7, distinctEpochs: 7 });
  });
  test(`desired ${owner.scope}: committed equal/ABA/clear/NULL setters retain six literal events`, { timeout: 60000 }, async t => {
    const f = await fixture(t), a = avatarEpochUrl(owner, "a"), b = avatarEpochUrl(owner, "b");
    await insertAvatarEpochOwner(f, owner, a);
    for (const url of [a, b, a, null, null]) await f.exec(`update public.${owner.table} set avatar_url=${q(url)} where id=${q(owner.id)};`);
    assert.deepEqual(await f.query(`select avatar_url from public.${owner.table} where id=${q(owner.id)}`), [{ avatar_url: null }], "actual setters committed");
    const [{ present }] = await f.query("select to_regclass('private.media_avatar_source_history') is not null as present");
    const history = present ? await avatarEpochHistory(f, owner) : [];
    assert.equal(history.length, 6, "literal retained-event oracle after committed equal/ABA/clear/NULL setters");
    assert.deepEqual(history.map(r => r.avatar_url), [a, a, b, a, null, null]);
    assert.equal(new Set(history.map(r => r.source_epoch)).size, 6);
    await assertAvatarEpochLink(f, owner, null);
  });
}

async function syntheticTrigger(f, owner, name, timing, bodySql, action) {
  const ddl = `create function private.fixture_epoch_nested() returns trigger language plpgsql as $fixture$
    begin ${bodySql} return new; end $fixture$;
    create trigger ${name} ${timing} update on public.${owner.table} for each row execute function private.fixture_epoch_nested();`;
  await f.apply(ddl);
  try { return await action(); }
  finally { await f.apply(`drop trigger ${name} on public.${owner.table}; drop function private.fixture_epoch_nested();`); }
}

if (!capturedOnly) {
  test("profile: actual presence CHECK rejects fictional_online without changing owner, epochs or queue", { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = avatarEpochOwners[0];
    assert.deepEqual(await f.query(`select convalidated as validated,pg_get_constraintdef(oid) as definition
      from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_presence_status_check'`), [{
      validated: true,
      definition: "CHECK (((presence_status IS NULL) OR (presence_status = ANY (ARRAY['idle'::text, 'dnd'::text]))))",
    }]);
    await insertAvatarEpochOwner(f, owner, avatarEpochUrl(owner, "a"));
    const rows = await f.query(`select * from public.profiles where id=${q(owner.id)}`);
    const current = await currentAvatarEpoch(f, owner), history = await avatarEpochHistory(f, owner);
    const queue = await f.query(`select * from private.media_variant_jobs where scope='profile' and target_id=${q(owner.id)}`);
    await assert.rejects(f.exec(`update public.profiles set presence_status='fictional_online' where id=${q(owner.id)};`),
      error => !(error instanceof assert.AssertionError) && error.code === "23514"
        && error.message.includes('relation "profiles" violates check constraint "profiles_presence_status_check"'));
    assert.deepEqual(await f.query(`select * from public.profiles where id=${q(owner.id)}`), rows);
    assert.deepEqual(await currentAvatarEpoch(f, owner), current);
    assert.deepEqual(await avatarEpochHistory(f, owner), history);
    assert.deepEqual(await f.query(`select * from private.media_variant_jobs where scope='profile' and target_id=${q(owner.id)}`), queue);
  });

  test("profile: CHECK-valid idle, dnd and NULL preserve the entire epoch and history", { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = avatarEpochOwners[0], a = avatarEpochUrl(owner, "a");
    await insertAvatarEpochOwner(f, owner, a);
    const current = await assertAvatarEpochLink(f, owner, a), history = await avatarEpochHistory(f, owner);
    const queue = await f.query(`select * from private.media_variant_jobs where scope='profile' and target_id=${q(owner.id)}`);
    assert.equal(history.length, 1);
    for (const presence of ["idle", "dnd", null]) {
      await f.exec(`update public.profiles set presence_status=${q(presence)} where id=${q(owner.id)};`);
      assert.deepEqual(await f.query(`select avatar_url,presence_status from public.profiles where id=${q(owner.id)}`),
        [{ avatar_url: a, presence_status: presence }]);
      assert.deepEqual(await currentAvatarEpoch(f, owner), current, "constraint-valid unrelated presence cannot rotate or rewrite current");
      assert.deepEqual(await avatarEpochHistory(f, owner), history);
      assert.deepEqual(await f.query(`select * from private.media_variant_jobs where scope='profile' and target_id=${q(owner.id)}`), queue);
    }
  });

  for (const owner of avatarEpochOwners) {
    test(`${owner.scope}: explicit event is visible before existing enqueue/state hooks`, { timeout: 60000 }, async t => {
      const f = await fixture(t), a = avatarEpochUrl(owner, "a"), b = avatarEpochUrl(owner, "b");
      await f.apply(`create function private.fixture_epoch_enqueue_probe() returns trigger language plpgsql as $fixture$
        declare actual text;
        begin
          select avatar_url into actual from private.media_avatar_source_current where scope=${q(owner.scope)} and owner_id=new.id;
          if not found or actual is distinct from current_setting('fixture.epoch_expected') then
            raise exception 'fictional_epoch_not_visible_before_enqueue'; end if;
          if tg_op='INSERT' and exists(select 1 from private.media_variant_jobs where scope=${q(owner.scope)} and target_id=new.id) then
            raise exception 'fictional_probe_ran_after_enqueue'; end if;
          return new;
        end $fixture$;
        create trigger a02_epoch_enqueue_probe after insert or update of avatar_url on public.${owner.table}
          for each row execute function private.fixture_epoch_enqueue_probe();`);
      try {
        await f.exec(`set fixture.epoch_expected=${q(a)};
          insert into public.${owner.table}(id,avatar_url${owner.scope === "chat" ? ",type" : owner.scope === "bot" ? ",username,display_name" : ""})
          values (${q(owner.id)},${q(a)}${owner.scope === "chat" ? ",'group'" : owner.scope === "bot" ? ",'fictional_probe_bot','Fictional Probe'" : ""});`);
        const rows = await f.query(`select scope,target_id from private.media_variant_jobs where target_id=${q(owner.id)}`);
        assert.deepEqual(rows, owner.scope === "bot" ? [] : [{ scope: owner.scope, target_id: owner.id }]);
        await f.exec(`set fixture.epoch_expected=${q(b)}; update public.${owner.table} set avatar_url=${q(b)} where id=${q(owner.id)};`);
        await assertAvatarEpochLink(f, owner, b);
      } finally { await f.apply(`drop trigger a02_epoch_enqueue_probe on public.${owner.table}; drop function private.fixture_epoch_enqueue_probe();`); }
    });
  }
  for (const owner of avatarEpochOwners) {
    test(`${owner.scope}: missing ledger and indirect BEFORE mutation, no unrelated rotation`, { timeout: 60000 }, async t => {
      const f = await fixture(t), a = avatarEpochUrl(owner, "a"), b = avatarEpochUrl(owner, "b");
      await insertAvatarEpochOwner(f, owner, a);
      const first = await currentAvatarEpoch(f, owner), beforeHistory = await avatarEpochHistory(f, owner);
      await f.exec(`delete from private.media_avatar_source_current where scope=${q(owner.scope)} and owner_id=${q(owner.id)};`);
      const other = owner.scope === "profile" ? "bio" : "description";
      await f.exec(`update public.${owner.table} set ${other}='Fictional unchanged source' where id=${q(owner.id)};`);
      const repaired = await assertAvatarEpochLink(f, owner, a);
      assert.notEqual(repaired.source_epoch, first.source_epoch);
      assert.deepEqual((await avatarEpochHistory(f, owner)).filter(r => r.source_epoch === first.source_epoch), beforeHistory);
      await syntheticTrigger(f, owner, "fixture_epoch_before", "before", `new.avatar_url := ${q(b)};`, async () => {
        await f.exec(`update public.${owner.table} set ${other}='Fictional indirect setter' where id=${q(owner.id)};`);
        const indirect = await assertAvatarEpochLink(f, owner, b);
        assert.notEqual(indirect.source_epoch, repaired.source_epoch);
        assert.equal((await avatarEpochHistory(f, owner)).length, 3);
      });
    });

    test(`${owner.scope}: AFTER nested setter before observer never restores outer stale NEW`, { timeout: 60000 }, async t => {
      const f = await fixture(t), a = avatarEpochUrl(owner, "a"), b = avatarEpochUrl(owner, "b");
      await insertAvatarEpochOwner(f, owner, a);
      const first = await currentAvatarEpoch(f, owner);
      await syntheticTrigger(f, owner, "a00_avatar_00_nested", "after", `if pg_trigger_depth()=1 then
        update public.${owner.table} set avatar_url=${q(b)} where id=new.id; end if;`, async () => {
        await f.exec(`update public.${owner.table} set avatar_url=${q(a)} where id=${q(owner.id)};`);
        const final = await assertAvatarEpochLink(f, owner, b);
        assert.notEqual(final.source_epoch, first.source_epoch);
        const history = await avatarEpochHistory(f, owner);
        assert.equal(history.length, 3); assert.deepEqual(history.map(r => r.avatar_url), [a, b, b]);
      });
    });

    test(`${owner.scope}: late AFTER indirect mutation and final statement reread`, { timeout: 60000 }, async t => {
      const f = await fixture(t), a = avatarEpochUrl(owner, "a"), b = avatarEpochUrl(owner, "b");
      const other = owner.scope === "profile" ? "bio" : "description";
      await insertAvatarEpochOwner(f, owner, a);
      await f.apply(`create function private.fixture_epoch_indirect() returns trigger language plpgsql as $fixture$
        begin if pg_trigger_depth()>1 then new.avatar_url := ${q(b)}; end if; return new; end $fixture$;
        create trigger fixture_epoch_indirect before update on public.${owner.table} for each row execute function private.fixture_epoch_indirect();`);
      try {
        await syntheticTrigger(f, owner, "zzzz_epoch_late", "after", `if pg_trigger_depth()=1 then
          update public.${owner.table} set ${other}='Fictional late nested source' where id=new.id; end if;`, async () => {
          await f.exec(`update public.${owner.table} set avatar_url=${q(a)} where id=${q(owner.id)};`);
          await assertAvatarEpochLink(f, owner, b);
          const history = await avatarEpochHistory(f, owner);
          assert.equal(history.length, 3); assert.deepEqual(history.map(r => r.avatar_url), [a, a, b]);
        });
      } finally { await f.apply(`drop trigger fixture_epoch_indirect on public.${owner.table}; drop function private.fixture_epoch_indirect();`); }
    });

    test(`${owner.scope}: BEFORE nested self-UPDATE keeps native 27000 refusal and exact rows`, { timeout: 60000 }, async t => {
      const f = await fixture(t), a = avatarEpochUrl(owner, "a"), b = avatarEpochUrl(owner, "b");
      await insertAvatarEpochOwner(f, owner, a);
      const current = await currentAvatarEpoch(f, owner), history = await avatarEpochHistory(f, owner);
      await syntheticTrigger(f, owner, "fixture_epoch_before_nested", "before", `if pg_trigger_depth()=1 then
        update public.${owner.table} set avatar_url=${q(b)} where id=new.id; end if;`, async () => {
        await assert.rejects(f.exec(`update public.${owner.table} set avatar_url=${q(a)} where id=${q(owner.id)};`), e => e.code === "27000");
        assert.deepEqual(await currentAvatarEpoch(f, owner), current);
        assert.deepEqual(await avatarEpochHistory(f, owner), history);
        assert.deepEqual(await f.query(`select avatar_url from public.${owner.table} where id=${q(owner.id)}`), [{ avatar_url: a }]);
      });
    });

    test(`${owner.scope}: ID replacement, DELETE and reINSERT invalidate but retain whole history`, { timeout: 60000 }, async t => {
      const f = await fixture(t), a = avatarEpochUrl(owner, "a");
      const other = { ...owner, id: avatarEpochOther };
      await insertAvatarEpochOwner(f, owner, a); await insertAvatarEpochOwner(f, other);
      const untouched = await currentAvatarEpoch(f, other), untouchedHistory = await avatarEpochHistory(f, other);
      const original = await currentAvatarEpoch(f, owner), originalHistory = await avatarEpochHistory(f, owner);
      const replacement = { ...owner, id: avatarEpochReplacement };
      await f.exec(`update public.${owner.table} set id=${q(replacement.id)} where id=${q(owner.id)};`);
      const old = await assertAvatarEpochLink(f, owner, null, true);
      assert.notEqual(old.source_epoch, original.source_epoch);
      const replaced = await assertAvatarEpochLink(f, replacement, a);
      assert.notEqual(replaced.source_epoch, original.source_epoch);
      assert.deepEqual((await avatarEpochHistory(f, owner)).filter(r => r.source_epoch === original.source_epoch), originalHistory);
      await f.exec(`delete from public.${owner.table} where id=${q(replacement.id)};`);
      const deleted = await assertAvatarEpochLink(f, replacement, null, true);
      assert.notEqual(deleted.source_epoch, replaced.source_epoch);
      assert.equal((await avatarEpochHistory(f, replacement)).length, 2);
      await insertAvatarEpochOwner(f, replacement, a);
      const reinserted = await assertAvatarEpochLink(f, replacement, a);
      assert.notEqual(reinserted.source_epoch, deleted.source_epoch);
      assert.equal((await avatarEpochHistory(f, replacement)).length, 3);
      assert.deepEqual(await currentAvatarEpoch(f, other), untouched);
      assert.deepEqual(await avatarEpochHistory(f, other), untouchedHistory);
    });

    test(`${owner.scope}: TRUNCATE only its scope, retains current tombstones and history`, { timeout: 60000 }, async t => {
      const f = await fixture(t), other = avatarEpochOwners.find(o => o.scope !== owner.scope);
      await insertAvatarEpochOwner(f, owner, avatarEpochUrl(owner, "a"));
      await insertAvatarEpochOwner(f, other, avatarEpochUrl(other, "other"));
      const old = await currentAvatarEpoch(f, owner), history = await avatarEpochHistory(f, owner);
      const unrelated = await currentAvatarEpoch(f, other), unrelatedHistory = await avatarEpochHistory(f, other);
      await f.exec(`truncate public.${owner.table};`);
      const invalid = await assertAvatarEpochLink(f, owner, null, true);
      assert.notEqual(invalid.source_epoch, old.source_epoch);
      assert.deepEqual((await avatarEpochHistory(f, owner)).filter(r => r.source_epoch === old.source_epoch), history);
      assert.equal((await avatarEpochHistory(f, owner)).length, 2);
      assert.deepEqual(await currentAvatarEpoch(f, other), unrelated);
      assert.deepEqual(await avatarEpochHistory(f, other), unrelatedHistory);
    });
  }

  test("bootstrap observations preserve original row grants/policies and current D-339 catalog through rollback roundtrip", { timeout: 60000 }, async t => {
    const f = await fixture(t, { install: false });
    for (const owner of avatarEpochOwners) await insertAvatarEpochOwner(f, owner);
    const ownerRows = await f.query(`select 'profile' as scope,to_jsonb(p) as row from public.profiles p
      union all select 'chat',to_jsonb(c) from public.chats c union all select 'bot',to_jsonb(b) from public.bots b order by scope`);
    const queue = await f.query("select * from private.media_variant_jobs order by scope,target_id");
    const original = await catalog(f.query);
    await f.apply(read(candidatePath));
    for (const owner of avatarEpochOwners) {
      await assertAvatarEpochLink(f, owner, null);
      assert.equal((await avatarEpochHistory(f, owner))[0].event_kind, "bootstrap");
    }
    await f.apply(read(rollbackPath));
    assert.deepEqual(await catalog(f.query), original);
    assert.deepEqual(await f.query(`select 'profile' as scope,to_jsonb(p) as row from public.profiles p
      union all select 'chat',to_jsonb(c) from public.chats c union all select 'bot',to_jsonb(b) from public.bots b order by scope`), ownerRows);
    assert.deepEqual(await f.query("select * from private.media_variant_jobs order by scope,target_id"), queue);
    await f.apply(read(candidatePath));
  });

  test("actual handle_new_user default NULL bootstrap and exact trusted bot setter equal/clear refusals", { timeout: 60000 }, async t => {
    const f = await fixture(t), profile = avatarEpochOwners[0], bot = avatarEpochOwners[2];
    await f.exec(`insert into auth.users(id,raw_user_meta_data) values (${q(profile.id)},'{"full_name":"Fictional Bootstrap"}');`);
    await assertAvatarEpochLink(f, profile, null);
    await insertAvatarEpochOwner(f, bot);
    await f.exec(`insert into public.bot_owners(bot_id,user_id,role) values (${q(bot.id)},${q(profile.id)},'owner');`);
    const a = avatarEpochUrl(bot, "a"), epochs = [];
    for (const url of [a, a, null, null]) {
      const response = await f.exec(`set role service_role; select public.bot_set_avatar_internal(${q(profile.id)},${q(bot.id)},${q(url)},'fictional_epoch_request');`);
      assert.deepEqual(JSON.parse(response), { ok: true, avatar_url: url });
      epochs.push((await assertAvatarEpochLink(f, bot, url)).source_epoch);
    }
    assert.equal(new Set(epochs).size, 4);
    const before = await currentAvatarEpoch(f, bot), history = await avatarEpochHistory(f, bot);
    await assert.rejects(f.exec(`set role service_role; select public.bot_set_avatar_internal(${q(avatarEpochOther)},${q(bot.id)},null,'fictional_refused');`), e => e.code === "42501" && e.message.includes("forbidden"));
    await assert.rejects(f.exec(`set role service_role; select public.bot_set_avatar_internal(${q(profile.id)},${q(bot.id)},'https://avatar-epoch.invalid/wrong-owner.png','fictional_refused');`), e => e.code === "22023" && e.message.includes("invalid_avatar"));
    assert.deepEqual(await currentAvatarEpoch(f, bot), before); assert.deepEqual(await avatarEpochHistory(f, bot), history);
  });

  test("ordinary roles cannot read/write/assign private epochs; public self-update and existing guard refusals survive", { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = avatarEpochOwners[0], self = { ...owner, id: avatarEpochOther };
    await insertAvatarEpochOwner(f, owner); await insertAvatarEpochOwner(f, self);
    const before = await currentAvatarEpoch(f, owner);
    await f.apply(`grant usage on schema private to anon,authenticated,service_role;
      create table private.fixture_epoch_role_control(value int); insert into private.fixture_epoch_role_control values (611);
      alter table private.fixture_epoch_role_control enable row level security;
      create policy fictional_read_control on private.fixture_epoch_role_control for select using(true);
      grant select on private.fixture_epoch_role_control to anon,authenticated,service_role;`);
    try {
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(await f.exec(`set role ${role}; select value from private.fixture_epoch_role_control;`), "611", "same role/schema transport has a literal positive control");
        for (const table of ["media_avatar_source_current", "media_avatar_source_history"]) {
          for (const sql of [`select * from private.${table}`, `update private.${table} set avatar_url=null`,
            `delete from private.${table}`, `insert into private.${table} (source_epoch) values ('e6110000-0000-4000-8000-000000000777')`]) {
            await assert.rejects(f.exec(`set role ${role}; ${sql};`), e => e.code === "42501" && e.message.includes("permission denied"));
          }
        }
        await assert.rejects(f.exec(`set role ${role}; select private.media_avatar_source_observe('profile',${q(owner.id)},true,'assignment');`), e => e.code === "42501" && e.message.includes("permission denied"));
      }
    } finally { await f.apply("drop table private.fixture_epoch_role_control; revoke usage on schema private from anon,authenticated,service_role;"); }
    await f.exec(`set request.jwt.claim.sub=${q(self.id)}; set role authenticated;
      update public.profiles set avatar_url='https://avatar-epoch.invalid/fictional-self.png' where id=${q(self.id)};`);
    await assertAvatarEpochLink(f, self, "https://avatar-epoch.invalid/fictional-self.png");
    const refused = JSON.parse(await f.exec(`set request.jwt.claim.sub=${q(self.id)}; set role authenticated;
      with changed as (update public.profiles set avatar_url='https://avatar-epoch.invalid/forbidden.png' where id=${q(owner.id)} returning id)
      select coalesce(jsonb_agg(changed),'[]'::jsonb) from changed;`));
    assert.deepEqual(refused, []); assert.deepEqual(await currentAvatarEpoch(f, owner), before);
    await assert.rejects(f.exec(`update public.profiles set role='user' where id=${q(owner.id)};`), e => e.code === "P0001");
    await assert.rejects(f.exec(`update public.profiles set profile_frame='fictional_not_unlocked' where id=${q(self.id)};`), e => e.code === "P0001" && e.message.includes("cosmetic_not_unlocked"));
  });

  test("chat member/admin policies and fixed-identity guard survive with positive avatar setter", { timeout: 60000 }, async t => {
    const f = await fixture(t), chat = avatarEpochOwners[1], actor = avatarEpochOther;
    await f.exec(`insert into public.chats(id,type,created_by) values (${q(chat.id)},'group',${q(actor)});`);
    await f.exec(`set request.jwt.claim.sub=${q(actor)}; set role authenticated;
      update public.chats set avatar_url='https://avatar-epoch.invalid/fictional-chat-self.png' where id=${q(chat.id)};`);
    const current = await assertAvatarEpochLink(f, chat, "https://avatar-epoch.invalid/fictional-chat-self.png");
    await assert.rejects(f.exec(`set request.jwt.claim.sub=${q(actor)}; set role authenticated;
      update public.chats set type='private' where id=${q(chat.id)};`), e => e.code === "42501" && e.message.includes("chat_type_is_fixed"));
    assert.deepEqual(await currentAvatarEpoch(f, chat), current);
    const refused = JSON.parse(await f.exec(`set request.jwt.claim.sub=${q(avatarEpochReplacement)}; set role authenticated;
      with changed as (update public.chats set avatar_url=null where id=${q(chat.id)} returning id)
      select coalesce(jsonb_agg(changed),'[]'::jsonb) from changed;`));
    assert.deepEqual(refused, []); assert.deepEqual(await currentAvatarEpoch(f, chat), current);
  });

  for (const owner of avatarEpochOwners) {
    test(`${owner.scope}: actual same-owner row lock serializes setters; 55P03, release, distinct committed epochs`, { timeout: 60000 }, async t => {
      const f = await fixture(t), a = avatarEpochUrl(owner, "a"), b = avatarEpochUrl(owner, "b"), c = avatarEpochUrl(owner, "c");
      await insertAvatarEpochOwner(f, owner, a);
      const session = raw.session();
      let contender;
      try {
        const blockerPid = Number(await bounded(session.send("select pg_backend_pid();"), 8000, "exact blocker PID"));
        assert.ok(Number.isSafeInteger(blockerPid) && blockerPid > 0);
        await bounded(session.send(`begin; set local statement_timeout='4s'; set local lock_timeout='2s';
          update public.${owner.table} set avatar_url=${q(b)} where id=${q(owner.id)};`), 8000, "owner blocker start");
        const [held] = await f.query(`select count(*)::int as count from pg_locks where relation='public.${owner.table}'::regclass
          and mode='RowExclusiveLock' and granted`); assert.ok(held.count >= 1);
        await assert.rejects(f.exec(`set lock_timeout='150ms'; update public.${owner.table} set avatar_url=${q(c)} where id=${q(owner.id)};`), e => e.code === "55P03");
        contender = f.exec(`set application_name='fixture_epoch_contender'; update public.${owner.table} set avatar_url=${q(c)} where id=${q(owner.id)};`)
          .then(value => ({ value }), error => ({ error }));
        const deadline = performance.now() + 1200;
        let waiting = false;
        do {
          const [{ count }] = await f.query(`select count(*)::int as count from pg_stat_activity
            where application_name='fixture_epoch_contender' and wait_event_type='Lock' and ${blockerPid}=any(pg_blocking_pids(pid))`);
          waiting = count === 1;
        } while (!waiting && performance.now() < deadline);
        assert.equal(waiting, true, "actual second setter is blocked on DB ownership, not a timer-only schedule");
        await bounded(session.send("commit;"), 8000, "owner blocker commit");
        const outcome = await bounded(contender, 8000, "second setter settling");
        assert.equal(outcome.error, undefined);
        await assertAvatarEpochLink(f, owner, c);
        const history = await avatarEpochHistory(f, owner);
        assert.deepEqual(history.map(r => r.avatar_url), [a, b, c]);
        assert.equal(new Set(history.map(r => r.source_epoch)).size, 3);
      } finally {
        await bounded(session.close(), 8000, "owner blocker close");
        if (contender) await bounded(contender, 8000, "second setter final settling");
      }
    });
  }

  test("omitted explicit hook goes RED for equal URL with literal oracle; original hook restored", { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = avatarEpochOwners[0], a = avatarEpochUrl(owner, "a");
    await insertAvatarEpochOwner(f, owner, a);
    const current = await currentAvatarEpoch(f, owner);
    await f.apply("alter table public.profiles disable trigger a00_avatar_epoch_explicit;");
    try {
      await f.exec(`update public.profiles set avatar_url=${q(a)} where id=${q(owner.id)};`);
      const actual = await currentAvatarEpoch(f, owner);
      assert.throws(() => assert.notEqual(actual.source_epoch, current.source_epoch, "equal assignment must rotate"), e => e.code === "ERR_ASSERTION" && e.actual === current.source_epoch && e.expected === current.source_epoch);
      assert.deepEqual(actual, current);
    } finally { await f.apply("alter table public.profiles enable trigger a00_avatar_epoch_explicit;"); }
    await f.exec(`update public.profiles set avatar_url=${q(a)} where id=${q(owner.id)};`);
    assert.notEqual((await currentAvatarEpoch(f, owner)).source_epoch, current.source_epoch);
  });

  test("omitted all-UPDATE fallback goes RED for missing ledger, restored positive control", { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = avatarEpochOwners[0];
    await insertAvatarEpochOwner(f, owner);
    await f.apply("alter table public.profiles disable trigger a01_avatar_epoch_update_fallback; alter table public.profiles disable trigger z99_avatar_epoch_update_final;");
    try {
      await f.exec(`delete from private.media_avatar_source_current where scope='profile' and owner_id=${q(owner.id)};
        update public.profiles set bio='Fictional missing observer' where id=${q(owner.id)};`);
      await assert.rejects(currentAvatarEpoch(f, owner), e => e.code === "ERR_ASSERTION" && e.actual === 0 && e.expected === 1);
    } finally { await f.apply("alter table public.profiles enable trigger a01_avatar_epoch_update_fallback; alter table public.profiles enable trigger z99_avatar_epoch_update_final;"); }
    await f.exec(`update public.profiles set bio='Fictional repaired observer' where id=${q(owner.id)};`);
    await assertAvatarEpochLink(f, owner, null);
  });

  test("compiled final-row reread omission goes RED for nested old NEW and restores exact function definition", { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = avatarEpochOwners[0], a = avatarEpochUrl(owner, "a"), b = avatarEpochUrl(owner, "b");
    await insertAvatarEpochOwner(f, owner, a);
    const [{ ddl }] = await f.query("select pg_get_functiondef('private.media_avatar_source_observe(text,uuid,boolean,text)'::regprocedure) as ddl");
    const needle = "EXECUTE pg_catalog.format('select avatar_url from public.%I where id=$1 for update',v_table)\n    INTO v_url USING p_owner_id;\n  GET DIAGNOSTICS v_count = ROW_COUNT;\n  v_found := v_count=1;";
    assert.ok(ddl.includes(needle));
    const mutant = ddl.replace(needle, `v_url := ${q(a)}; v_found := true;`);
    assert.notEqual(mutant, ddl);
    await f.apply(mutant);
    try {
      await syntheticTrigger(f, owner, "a00_avatar_00_nested", "after", `if pg_trigger_depth()=1 then
        update public.profiles set avatar_url=${q(b)} where id=new.id; end if;`, async () => {
        await f.exec(`update public.profiles set avatar_url=${q(a)} where id=${q(owner.id)};`);
        assert.deepEqual(await f.query(`select avatar_url from public.profiles where id=${q(owner.id)}`), [{ avatar_url: b }]);
        await assert.rejects(assertAvatarEpochLink(f, owner, b), e => e.code === "ERR_ASSERTION" && e.actual === a && e.expected === b);
      });
    } finally {
      await f.apply(ddl);
      assert.equal((await f.query("select pg_get_functiondef('private.media_avatar_source_observe(text,uuid,boolean,text)'::regprocedure) as ddl"))[0].ddl, ddl);
    }
    await f.exec(`update public.profiles set bio='Fictional reconcile restored' where id=${q(owner.id)};`);
    await assertAvatarEpochLink(f, owner, b);
  });

  test("raising self-check detects ordinary-role authority leak and missing SECURITY DEFINER with atomic rollback", { timeout: 60000 }, async t => {
    const f = await fixture(t, { install: false });
    const source = read(candidatePath);
    for (const mutant of [source.replace("DO $selfcheck$", "GRANT SELECT ON private.media_avatar_source_current TO authenticated;\nDO $selfcheck$"),
      source.replace("DO $selfcheck$", "GRANT SELECT(source_epoch) ON private.media_avatar_source_current TO authenticated;\nDO $selfcheck$"),
      source.replace("RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER", "RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER")]) {
      assert.notEqual(mutant, source);
      await assert.rejects(f.apply(mutant), e => e.code === "P0001" && /avatar_epoch_(private_authority_leak|function_boundary_invalid)/.test(e.message));
      assert.deepEqual(await catalog(f.query), f.before, "failed candidate transaction leaves exact prestate");
    }
    await f.apply(source);
  });

  test("unexpected adapter assertion is independently retained and cannot masquerade as role refusal", { timeout: 60000 }, async t => {
    const f = await fixture(t, { inject: true });
    await assert.rejects(f.exec("select 'fictional-epoch-adapter-assertion';"), e => e === f.injected);
    assert.deepEqual(f.failures, [f.injected]);
    assert.throws(() => assert.equal(f.failures.length, 0), e => e.code === "ERR_ASSERTION" && e.actual === 1 && e.expected === 0);
  });

  async function helperOwnerLock(f, owner) {
    const session = raw.session();
    try {
      await bounded(session.send(`begin; set local statement_timeout='4s';
        select private.media_avatar_source_observe(${q(owner.scope)},${q(owner.id)},true,'reconcile');`), 8000, "helper observation lock");
      let refused = false;
      try { await f.exec(`begin; select id from public.${owner.table} where id=${q(owner.id)} for update nowait; rollback;`); }
      catch (error) { if (error.code !== "55P03") throw error; refused = true; }
      return refused;
    } finally { await bounded(session.close(), 8000, "helper observation release"); }
  }
  test("trusted observer holds owner before current/history; unrelated owner is lockable after observer release", { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = avatarEpochOwners[0], other = { ...owner, id: avatarEpochOther };
    await insertAvatarEpochOwner(f, owner); await insertAvatarEpochOwner(f, other);
    const untouched = await currentAvatarEpoch(f, other);
    assert.equal(await helperOwnerLock(f, owner), true, "literal direct-helper owner row lock oracle");
    assert.equal(await f.exec(`begin; select id from public.profiles where id=${q(other.id)} for update nowait; rollback;`), other.id);
    assert.deepEqual(await currentAvatarEpoch(f, other), untouched);
  });
  test("compiled owner-lock omission makes direct-helper literal lock oracle RED; exact definition restored", { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = avatarEpochOwners[0];
    await insertAvatarEpochOwner(f, owner);
    const [{ ddl }] = await f.query("select pg_get_functiondef('private.media_avatar_source_observe(text,uuid,boolean,text)'::regprocedure) as ddl");
    const mutant = ddl.replace("where id=$1 for update',v_table)", "where id=$1',v_table)");
    assert.notEqual(mutant, ddl);
    await f.apply(mutant);
    try {
      const actual = await helperOwnerLock(f, owner);
      assert.throws(() => assert.equal(actual, true, "observer must hold owner row"), e => e.code === "ERR_ASSERTION" && e.actual === false && e.expected === true);
    } finally {
      await f.apply(ddl);
      assert.equal((await f.query("select pg_get_functiondef('private.media_avatar_source_observe(text,uuid,boolean,text)'::regprocedure) as ddl"))[0].ddl, ddl);
    }
    assert.equal(await helperOwnerLock(f, owner), true);
  });
  test("compiled history-erasure mutant goes RED for retained A after clear; exact definition restored", { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = avatarEpochOwners[0], a = avatarEpochUrl(owner, "a");
    await insertAvatarEpochOwner(f, owner, a);
    const old = await currentAvatarEpoch(f, owner), oldHistory = await avatarEpochHistory(f, owner);
    const [{ ddl }] = await f.query("select pg_get_functiondef('private.media_avatar_source_observe(text,uuid,boolean,text)'::regprocedure) as ddl");
    const mutant = ddl.replace("INSERT INTO private.media_avatar_source_history", "DELETE FROM private.media_avatar_source_history WHERE scope=p_scope AND owner_id=p_owner_id;\n  INSERT INTO private.media_avatar_source_history");
    assert.notEqual(mutant, ddl); await f.apply(mutant);
    try {
      await f.exec(`update public.profiles set avatar_url=null where id=${q(owner.id)};`);
      const actual = (await avatarEpochHistory(f, owner)).filter(r => r.source_epoch === old.source_epoch);
      assert.throws(() => assert.deepEqual(actual, oldHistory, "old A retained after clear"), e => e.code === "ERR_ASSERTION" && e.actual.length === 0 && e.expected.length === 1);
    } finally {
      await f.apply(ddl);
      assert.equal((await f.query("select pg_get_functiondef('private.media_avatar_source_observe(text,uuid,boolean,text)'::regprocedure) as ddl"))[0].ddl, ddl);
    }
    const kept = await avatarEpochHistory(f, owner);
    await f.exec(`update public.profiles set avatar_url=${q(a)} where id=${q(owner.id)};`);
    assert.deepEqual((await avatarEpochHistory(f, owner)).filter(r => kept.some(k => k.source_epoch === r.source_epoch)), kept);
  });
  test("exact baseline enabled-state pin refuses altered existing enqueue; no additive objects and original state restored", { timeout: 60000 }, async t => {
    const f = await fixture(t, { install: false });
    await f.apply("alter table public.profiles disable trigger trg_enqueue_media_variant_job_for_profile;");
    try {
      await assert.rejects(f.apply(read(candidatePath)), e => e.code === "P0001" && e.message.includes("avatar_epoch_baseline_pin_mismatch: trg_enqueue_media_variant_job_for_profile"));
      assert.equal((await f.query("select to_regclass('private.media_avatar_source_current') is null as absent"))[0].absent, true);
    } finally { await f.apply("alter table public.profiles enable trigger trg_enqueue_media_variant_job_for_profile;"); }
    assert.deepEqual(await catalog(f.query), f.before);
  });
}
// The full capture catalog SHA256 is 7a660b64b61ee12d2b2ed8940fdeb4a8defde542bc156eca227e16871506e266.
function capturedOwnerMetadata() { return {
  "triggers": [
    {
      "name": "trg_bot_viewer_bot_state_revoke",
      "table": "bots",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_bot_viewer_bot_state_revoke AFTER UPDATE OF state ON public.bots FOR EACH ROW EXECUTE FUNCTION private.bot_viewer_revoke_on_change()",
      "function": "CREATE OR REPLACE FUNCTION private.bot_viewer_revoke_on_change()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nbegin\n  if tg_table_schema = 'public' and tg_table_name = 'chat_members' then\n    if tg_op = 'DELETE' then\n      delete from private.bot_callback_interface_grants grant_row\n      where grant_row.chat_id = old.chat_id and grant_row.viewer_id = old.user_id;\n      update private.bot_viewer_interfaces panel\n      set closed_at = pg_catalog.clock_timestamp(), version = version + 1\n      where panel.chat_id = old.chat_id and panel.viewer_id = old.user_id\n        and panel.closed_at is null;\n    elsif new.hidden_at is not null or new.joined_at is distinct from old.joined_at then\n      delete from private.bot_callback_interface_grants grant_row\n      where grant_row.chat_id = old.chat_id and grant_row.viewer_id = old.user_id;\n      update private.bot_viewer_interfaces panel\n      set closed_at = pg_catalog.clock_timestamp(), version = version + 1\n      where panel.chat_id = old.chat_id and panel.viewer_id = old.user_id\n        and panel.closed_at is null;\n    end if;\n  elsif tg_table_schema = 'public' and tg_table_name = 'chat_bot_members' then\n    if tg_op = 'DELETE' then\n      delete from private.bot_callback_interface_grants grant_row\n      where grant_row.chat_id = old.chat_id and grant_row.bot_id = old.bot_id;\n      update private.bot_viewer_interfaces panel\n      set closed_at = pg_catalog.clock_timestamp(), version = version + 1\n      where panel.chat_id = old.chat_id and panel.bot_id = old.bot_id\n        and panel.closed_at is null;\n    elsif new.removed_at is not null or new.joined_at is distinct from old.joined_at then\n      delete from private.bot_callback_interface_grants grant_row\n      where grant_row.chat_id = old.chat_id and grant_row.bot_id = old.bot_id;\n      update private.bot_viewer_interfaces panel\n      set closed_at = pg_catalog.clock_timestamp(), version = version + 1\n      where panel.chat_id = old.chat_id and panel.bot_id = old.bot_id\n        and panel.closed_at is null;\n    end if;\n  elsif tg_table_schema = 'public' and tg_table_name = 'messages' then\n    if tg_op = 'DELETE' then\n      delete from private.bot_callback_interface_grants grant_row\n      where grant_row.source_message_id = old.id;\n      update private.bot_viewer_interfaces panel\n      set closed_at = pg_catalog.clock_timestamp(), version = version + 1\n      where panel.source_message_id = old.id and panel.closed_at is null;\n    elsif new.deleted_at is not null then\n      delete from private.bot_callback_interface_grants grant_row\n      where grant_row.source_message_id = old.id;\n      update private.bot_viewer_interfaces panel\n      set closed_at = pg_catalog.clock_timestamp(), version = version + 1\n      where panel.source_message_id = old.id and panel.closed_at is null;\n    end if;\n  elsif tg_table_schema = 'public' and tg_table_name = 'bots' then\n    if new.state <> 'active' then\n      delete from private.bot_callback_interface_grants grant_row\n      where grant_row.bot_id = old.id;\n      update private.bot_viewer_interfaces panel\n      set closed_at = pg_catalog.clock_timestamp(), version = version + 1\n      where panel.bot_id = old.id and panel.closed_at is null;\n    end if;\n  elsif tg_table_schema = 'private' and tg_table_name = 'bot_tokens' then\n    if new.revoked_at is not null then\n      delete from private.bot_callback_interface_grants grant_row\n      where grant_row.token_id = old.id;\n      update private.bot_viewer_interfaces panel\n      set closed_at = pg_catalog.clock_timestamp(), version = version + 1\n      where panel.creator_token_id = old.id and panel.closed_at is null;\n    end if;\n  end if;\n  if tg_op = 'DELETE' then return old; end if;\n  return new;\nend\n$function$\n"
    },
    {
      "name": "trg_add_chat_creator_as_owner",
      "table": "chats",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_add_chat_creator_as_owner AFTER INSERT ON public.chats FOR EACH ROW EXECUTE FUNCTION add_chat_creator_as_owner()",
      "function": "CREATE OR REPLACE FUNCTION public.add_chat_creator_as_owner()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\nbegin\n  if new.created_by is not null then\n    insert into public.chat_members (chat_id, user_id, role)\n    values (new.id, new.created_by, 'owner')\n    on conflict (chat_id, user_id) do nothing;\n  end if;\n  return new;\nend $function$\n"
    },
    {
      "name": "trg_chats_identity_is_fixed",
      "table": "chats",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_chats_identity_is_fixed BEFORE UPDATE ON public.chats FOR EACH ROW EXECUTE FUNCTION private.chats_identity_is_fixed()",
      "function": "CREATE OR REPLACE FUNCTION private.chats_identity_is_fixed()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO ''\nAS $function$\nbegin\n  if new.type is distinct from old.type then\n    raise exception 'chat_type_is_fixed' using errcode = '42501';\n  end if;\n  if new.created_by is distinct from old.created_by\n     or new.created_at is distinct from old.created_at then\n    raise exception 'chat_identity_is_fixed' using errcode = '42501';\n  end if;\n  return new;\nend\n$function$\n"
    },
    {
      "name": "trg_enqueue_media_variant_job_for_chat",
      "table": "chats",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_enqueue_media_variant_job_for_chat AFTER INSERT OR UPDATE OF avatar_url ON public.chats FOR EACH ROW EXECUTE FUNCTION private.enqueue_media_variant_job_for_chat()",
      "function": "CREATE OR REPLACE FUNCTION private.enqueue_media_variant_job_for_chat()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nbegin\n  if new.avatar_url is not null\n     and coalesce(new.type::text, '') in ('group','channel','dm_group')\n     and (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url)\n  then\n    insert into private.media_variant_jobs (scope, target_id)\n    values ('chat', new.id)\n    on conflict (scope, target_id) do update\n      set available_at = pg_catalog.now(),\n          attempts = 0,\n          claim_token = null,\n          claimed_at = null,\n          last_error = null;\n  end if;\n  return null;\nend;\n$function$\n"
    },
    {
      "name": "trg_mark_chat_delete_cascade",
      "table": "chats",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_mark_chat_delete_cascade BEFORE DELETE ON public.chats FOR EACH ROW EXECUTE FUNCTION mark_chat_delete_cascade()",
      "function": "CREATE OR REPLACE FUNCTION public.mark_chat_delete_cascade()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\ndeclare\n  deleting_chat_ids text;\nbegin\n  deleting_chat_ids := coalesce(current_setting('kub.deleting_chat_ids', true), ',');\n  if deleting_chat_ids = '' then\n    deleting_chat_ids := ',';\n  end if;\n\n  if deleting_chat_ids not like ('%,' || old.id::text || ',%') then\n    perform set_config('kub.deleting_chat_ids', deleting_chat_ids || old.id::text || ',', true);\n  end if;\n\n  return old;\nend;\n$function$\n"
    },
    {
      "name": "trg_voice_ring_push_chat_changed",
      "table": "chats",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_voice_ring_push_chat_changed AFTER UPDATE OF type ON public.chats FOR EACH ROW EXECUTE FUNCTION private.voice_ring_push_chat_changed()",
      "function": "CREATE OR REPLACE FUNCTION private.voice_ring_push_chat_changed()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare v_ring record;\nbegin\n  if old.type is distinct from new.type then\n    for v_ring in select distinct channel_id, ring_started_at from public.voice_ring_push_events\n      where chat_id = old.id and event = 'ring' and state = 'pending'\n    loop\n      perform private.voice_ring_push_finish(v_ring.channel_id, v_ring.ring_started_at);\n    end loop;\n  end if;\n  return new;\nend\n$function$\n"
    },
    {
      "name": "profiles_guard_test_flag",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER profiles_guard_test_flag BEFORE UPDATE OF is_test_account ON public.profiles FOR EACH ROW EXECUTE FUNCTION profiles_guard_test_flag()",
      "function": "CREATE OR REPLACE FUNCTION public.profiles_guard_test_flag()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\ndeclare\n  v_actor uuid := auth.uid();\nbegin\n  if new.is_test_account is not distinct from old.is_test_account then\n    return new;\n  end if;\n  -- A migration or a backend job runs without a JWT; a person does not.\n  if v_actor is null then\n    return new;\n  end if;\n  if not public.has_permission(v_actor, 'users.manage') then\n    raise exception 'test_flag_not_permitted' using errcode = 'P0001';\n  end if;\n  return new;\nend\n$function$\n"
    },
    {
      "name": "profiles_reserved_username_guard",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER profiles_reserved_username_guard BEFORE INSERT OR UPDATE OF username, role ON public.profiles FOR EACH ROW EXECUTE FUNCTION profiles_reserved_username_guard()",
      "function": "CREATE OR REPLACE FUNCTION public.profiles_reserved_username_guard()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\ndeclare\n  v_reserved_key text;\n  v_is_admin_after_update boolean;\nbegin\n  if new.id is null or new.username is null or btrim(new.username) = '' then\n    return new;\n  end if;\n\n  v_reserved_key := public.profile_reserved_username_key(new.username);\n  v_is_admin_after_update :=\n    new.role::text = 'admin'\n    or public.has_global_role(new.id, 'owner')\n    or public.has_global_role(new.id, 'tech_admin')\n    or public.has_global_role(new.id, 'admin');\n\n  if v_reserved_key = any(public.profile_reserved_username_keys())\n     and not coalesce(v_is_admin_after_update, false) then\n    raise exception 'reserved_username_requires_admin'\n      using errcode = 'P0001',\n            detail = 'Reserved profile username can only be used by administrators.';\n  end if;\n\n  return new;\nend\n$function$\n"
    },
    {
      "name": "profiles_validate_cosmetics",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER profiles_validate_cosmetics BEFORE INSERT OR UPDATE OF profile_frame, profile_background ON public.profiles FOR EACH ROW EXECUTE FUNCTION profiles_validate_cosmetics()",
      "function": "CREATE OR REPLACE FUNCTION public.profiles_validate_cosmetics()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\ndeclare\n  v_key text;\n  v_kind text;\nbegin\n  foreach v_key in array array[new.profile_frame, new.profile_background] loop\n    continue when v_key is null;\n    v_kind := case when v_key is not distinct from new.profile_frame then 'frame' else 'background' end;\n\n    -- Unchanged values are left alone: this guards the act of choosing, not\n    -- every later write to the row.\n    continue when tg_op = 'UPDATE'\n      and v_key is not distinct from (\n        case when v_kind = 'frame' then old.profile_frame else old.profile_background end\n      );\n\n    if not exists (\n      select 1\n      from public.cosmetics item\n      where item.key = v_key\n        and item.kind = v_kind\n        and item.active\n        and (\n          item.required_achievement is null\n          or exists (\n            select 1\n            from public.user_achievements owned\n            where owned.user_id = new.id\n              and owned.achievement_key = item.required_achievement\n          )\n        )\n    ) then\n      raise exception 'cosmetic_not_unlocked' using errcode = 'P0001';\n    end if;\n  end loop;\n\n  return new;\nend\n$function$\n"
    },
    {
      "name": "trg_audit_profile_role",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_audit_profile_role AFTER UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION _audit_profile_role_after_update()",
      "function": "CREATE OR REPLACE FUNCTION public._audit_profile_role_after_update()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\nbegin\n  if new.role is distinct from old.role then\n    perform public._audit(\n      'role_change',\n      'profile',\n      new.id,\n      jsonb_build_object(\n        'from', old.role::text,\n        'to',   new.role::text\n      )\n    );\n  end if;\n  return null;\nend $function$\n"
    },
    {
      "name": "trg_bootstrap_first_admin",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_bootstrap_first_admin BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION bootstrap_first_admin()",
      "function": "CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\ndeclare\n  configured_email text;\n  matched          boolean := false;\n  admin_count      int;\nbegin\n  -- Try to read the configured \"designated admin\" email.  Wrapped in a\n  -- begin/exception block because current_setting() raises if the GUC has\n  -- never been set in this session/database.\n  begin\n    configured_email := current_setting('app.bootstrap_admin_email', true);\n  exception when others then\n    configured_email := null;\n  end;\n\n  if configured_email is not null and length(configured_email) > 0 then\n    -- Designated email mode: ONLY the matching user becomes admin.  We\n    -- intentionally do not fall back to \"first user becomes admin\" — the\n    -- operator picked an explicit person and the first random signup must\n    -- not be promoted just because that person hasn't signed up yet.\n    select exists (\n      select 1 from auth.users\n       where id = new.id and lower(email) = lower(configured_email)\n    ) into matched;\n    if matched then\n      new.role := 'admin';\n    end if;\n    return new;\n  end if;\n\n  -- No designated email → \"first user becomes admin\" mode.\n  select count(*) into admin_count from public.profiles where role = 'admin';\n  if admin_count = 0 then\n    new.role := 'admin';\n  end if;\n  return new;\nend $function$\n"
    },
    {
      "name": "trg_enforce_role_change_matrix",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_enforce_role_change_matrix BEFORE UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION enforce_role_change_matrix()",
      "function": "CREATE OR REPLACE FUNCTION public.enforce_role_change_matrix()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\ndeclare\n  caller       uuid := auth.uid();\n  caller_rank  integer;\n  admin_rank   integer;\n  manager_rank integer;\nbegin\n  -- No change → nothing to check.\n  if new.role is not distinct from old.role then\n    return new;\n  end if;\n\n  -- DB / SQL admin without a session: allow.\n  if caller is null then\n    return new;\n  end if;\n\n  select priority into admin_rank\n    from public.roles where scope = 'global' and key = 'admin' and is_active;\n  select priority into manager_rank\n    from public.roles where scope = 'global' and key = 'manager' and is_active;\n  if admin_rank is null or manager_rank is null then\n    raise exception 'Матрица ролей не настроена' using errcode = '42501';\n  end if;\n\n  caller_rank := public.effective_global_role_priority(caller);\n\n  if caller_rank >= admin_rank then\n    return new;            -- full control; last-admin guard handles edge case\n  end if;\n\n  if caller_rank >= manager_rank then\n    -- Managers may only flip between user ↔ manager.\n    if old.role = 'admin' or new.role = 'admin' then\n      raise exception 'Менеджер не может изменять роль администратора'\n        using errcode = '42501';\n    end if;\n    if new.role not in ('user', 'manager') then\n      raise exception 'Недопустимая роль для менеджера'\n        using errcode = '42501';\n    end if;\n    return new;\n  end if;\n\n  raise exception 'Только администратор или менеджер может менять роли'\n    using errcode = '42501';\nend $function$\n"
    },
    {
      "name": "trg_enqueue_media_variant_job_for_profile",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_enqueue_media_variant_job_for_profile AFTER INSERT OR UPDATE OF avatar_url ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.enqueue_media_variant_job_for_profile()",
      "function": "CREATE OR REPLACE FUNCTION private.enqueue_media_variant_job_for_profile()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nbegin\n  if new.avatar_url is not null\n     and (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url)\n  then\n    insert into private.media_variant_jobs (scope, target_id)\n    values ('profile', new.id)\n    on conflict (scope, target_id) do update\n      set available_at = pg_catalog.now(),\n          attempts = 0,\n          claim_token = null,\n          claimed_at = null,\n          last_error = null;\n  end if;\n  return null;\nend;\n$function$\n"
    },
    {
      "name": "trg_ensure_profile_contacts",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_ensure_profile_contacts AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION _ensure_profile_contacts()",
      "function": "CREATE OR REPLACE FUNCTION public._ensure_profile_contacts()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\nbegin\n  perform set_config('app.profile_contacts_bypass', 'on', true);\n  insert into public.profile_contacts (user_id)\n  values (new.id)\n  on conflict (user_id) do nothing;\n  return new;\nend $function$\n"
    },
    {
      "name": "trg_prevent_demoting_last_admin",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_prevent_demoting_last_admin BEFORE UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION prevent_demoting_last_admin()",
      "function": "CREATE OR REPLACE FUNCTION public.prevent_demoting_last_admin()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\ndeclare\n  remaining int;\nbegin\n  if old.role = 'admin' and new.role <> 'admin' then\n    -- 4242 is an arbitrary key shared by all \"admin demotion\" transactions.\n    perform pg_advisory_xact_lock(4242);\n    select count(*) into remaining\n      from public.profiles\n      where role = 'admin' and id <> old.id;\n    if remaining = 0 then\n      raise exception 'Нельзя снять последнего администратора'\n        using errcode = 'P0001';\n    end if;\n  end if;\n  return new;\nend $function$\n"
    },
    {
      "name": "trg_profiles_default_user_global_role",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_profiles_default_user_global_role AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION assign_default_user_global_role()",
      "function": "CREATE OR REPLACE FUNCTION public.assign_default_user_global_role()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\ndeclare\n  v_user_role_id uuid;\nbegin\n  if new.role <> 'user'::public.app_role then\n    return new;\n  end if;\n\n  select id into v_user_role_id\n    from public.roles\n   where key = 'user'\n     and scope = 'global'\n     and is_active\n   limit 1;\n\n  if v_user_role_id is null then\n    return new;\n  end if;\n\n  insert into public.user_global_roles (user_id, role_id, assigned_by)\n  values (new.id, v_user_role_id, null)\n  on conflict do nothing;\n\n  return new;\nend $function$\n"
    },
    {
      "name": "trg_profiles_mark_message_tombstones",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_profiles_mark_message_tombstones BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.mark_profile_delete_message_tombstones()",
      "function": "CREATE OR REPLACE FUNCTION private.mark_profile_delete_message_tombstones()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare\n  v_marker text;\nbegin\n  v_marker := pg_catalog.current_setting(\n    'letscube.profile_delete_tombstone_user_ids',\n    true\n  );\n  if coalesce(v_marker, '') = '' then\n    v_marker := old.id::text;\n  elsif old.id::text <> all(pg_catalog.string_to_array(v_marker, ',')) then\n    v_marker := v_marker || ',' || old.id::text;\n  end if;\n  perform pg_catalog.set_config(\n    'letscube.profile_delete_tombstone_user_ids',\n    v_marker,\n    true\n  );\n  return old;\nend\n$function$\n"
    },
    {
      "name": "trg_registration_invite_apply_from_profile",
      "table": "profiles",
      "enabled": "O",
      "trigger": "CREATE TRIGGER trg_registration_invite_apply_from_profile AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION registration_invite_apply_from_profile()",
      "function": "CREATE OR REPLACE FUNCTION public.registration_invite_apply_from_profile()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\ndeclare\n  v_code text;\nbegin\n  select public.registration_invite_normalize_code(u.raw_user_meta_data ->> 'invite_code')\n    into v_code\n    from auth.users u\n   where u.id = new.id;\n\n  if v_code is null then\n    if public.registration_invites_required() then\n      raise exception 'invite_required' using errcode = '22023';\n    end if;\n    return new;\n  end if;\n\n  perform public.registration_invite_consume(v_code, new.id);\n  return new;\nend $function$\n"
    }
  ],
  "policies": [
    {
      "cmd": "SELECT",
      "qual": "((state = 'active'::text) OR (EXISTS ( SELECT 1\n   FROM bot_owners owner_row\n  WHERE ((owner_row.bot_id = bots.id) AND (owner_row.user_id = ( SELECT uid() AS uid))))) OR (EXISTS ( SELECT 1\n   FROM (chat_bot_members bot_member\n     JOIN chat_members human_member ON ((human_member.chat_id = bot_member.chat_id)))\n  WHERE ((bot_member.bot_id = bots.id) AND (bot_member.removed_at IS NULL) AND (human_member.user_id = ( SELECT uid() AS uid)) AND (human_member.hidden_at IS NULL)))))",
      "roles": [
        "authenticated"
      ],
      "tablename": "bots",
      "permissive": "PERMISSIVE",
      "policyname": "authenticated users read bot identities",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "UPDATE",
      "qual": "is_chat_admin(id)",
      "roles": [
        "authenticated"
      ],
      "tablename": "chats",
      "permissive": "PERMISSIVE",
      "policyname": "Chat admins update chat",
      "schemaname": "public",
      "with_check": "is_chat_admin(id)"
    },
    {
      "cmd": "SELECT",
      "qual": "(EXISTS ( SELECT 1\n   FROM chat_members\n  WHERE ((chat_members.chat_id = chats.id) AND (chat_members.user_id = uid()))))",
      "roles": [
        "public"
      ],
      "tablename": "chats",
      "permissive": "PERMISSIVE",
      "policyname": "Chat members can view chats",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "DELETE",
      "qual": "(is_chat_owner(id) AND (type <> 'private'::text))",
      "roles": [
        "authenticated"
      ],
      "tablename": "chats",
      "permissive": "PERMISSIVE",
      "policyname": "Chat owners delete chat",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "authenticated"
      ],
      "tablename": "chats",
      "permissive": "PERMISSIVE",
      "policyname": "Users create chats with self as creator",
      "schemaname": "public",
      "with_check": "((created_by = uid()) AND (type IS NOT NULL) AND (type <> ALL (ARRAY['private'::text, 'dm_group'::text])))"
    },
    {
      "cmd": "SELECT",
      "qual": "(NOT is_banned(uid()))",
      "roles": [
        "public"
      ],
      "tablename": "chats",
      "permissive": "RESTRICTIVE",
      "policyname": "block banned reads",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "DELETE",
      "qual": "(NOT is_banned(uid()))",
      "roles": [
        "public"
      ],
      "tablename": "chats",
      "permissive": "RESTRICTIVE",
      "policyname": "block banned writes (delete)",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "public"
      ],
      "tablename": "chats",
      "permissive": "RESTRICTIVE",
      "policyname": "block banned writes (insert)",
      "schemaname": "public",
      "with_check": "(NOT is_banned(uid()))"
    },
    {
      "cmd": "UPDATE",
      "qual": "(NOT is_banned(uid()))",
      "roles": [
        "public"
      ],
      "tablename": "chats",
      "permissive": "RESTRICTIVE",
      "policyname": "block banned writes (update)",
      "schemaname": "public",
      "with_check": "(NOT is_banned(uid()))"
    },
    {
      "cmd": "SELECT",
      "qual": "is_manager_or_admin(uid())",
      "roles": [
        "public"
      ],
      "tablename": "profiles",
      "permissive": "PERMISSIVE",
      "policyname": "Admins read all profiles",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "UPDATE",
      "qual": "(is_admin(uid()) OR (is_manager_or_admin(uid()) AND (role <> 'admin'::app_role)))",
      "roles": [
        "public"
      ],
      "tablename": "profiles",
      "permissive": "PERMISSIVE",
      "policyname": "Admins update any profile",
      "schemaname": "public",
      "with_check": "(is_admin(uid()) OR (is_manager_or_admin(uid()) AND (role <> 'admin'::app_role)))"
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "public"
      ],
      "tablename": "profiles",
      "permissive": "PERMISSIVE",
      "policyname": "Profiles are viewable by everyone",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "public"
      ],
      "tablename": "profiles",
      "permissive": "PERMISSIVE",
      "policyname": "Users can insert own profile",
      "schemaname": "public",
      "with_check": "(uid() = id)"
    },
    {
      "cmd": "UPDATE",
      "qual": "(uid() = id)",
      "roles": [
        "public"
      ],
      "tablename": "profiles",
      "permissive": "PERMISSIVE",
      "policyname": "Users can update own profile",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "((NOT is_banned(uid())) OR (id = uid()))",
      "roles": [
        "public"
      ],
      "tablename": "profiles",
      "permissive": "RESTRICTIVE",
      "policyname": "block banned reads (self only on profiles)",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "DELETE",
      "qual": "(NOT is_banned(uid()))",
      "roles": [
        "public"
      ],
      "tablename": "profiles",
      "permissive": "RESTRICTIVE",
      "policyname": "block banned writes (delete)",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "public"
      ],
      "tablename": "profiles",
      "permissive": "RESTRICTIVE",
      "policyname": "block banned writes (insert)",
      "schemaname": "public",
      "with_check": "(NOT is_banned(uid()))"
    },
    {
      "cmd": "UPDATE",
      "qual": "(NOT is_banned(uid()))",
      "roles": [
        "public"
      ],
      "tablename": "profiles",
      "permissive": "RESTRICTIVE",
      "policyname": "block banned writes (update)",
      "schemaname": "public",
      "with_check": "(NOT is_banned(uid()))"
    }
  ],
  "grants": [
    {
      "table_name": "bots",
      "grantee": "authenticated",
      "privilege_type": "SELECT",
      "is_grantable": "NO"
    },
    {
      "table_name": "bots",
      "grantee": "postgres",
      "privilege_type": "DELETE",
      "is_grantable": "YES"
    },
    {
      "table_name": "bots",
      "grantee": "postgres",
      "privilege_type": "INSERT",
      "is_grantable": "YES"
    },
    {
      "table_name": "bots",
      "grantee": "postgres",
      "privilege_type": "REFERENCES",
      "is_grantable": "YES"
    },
    {
      "table_name": "bots",
      "grantee": "postgres",
      "privilege_type": "SELECT",
      "is_grantable": "YES"
    },
    {
      "table_name": "bots",
      "grantee": "postgres",
      "privilege_type": "TRIGGER",
      "is_grantable": "YES"
    },
    {
      "table_name": "bots",
      "grantee": "postgres",
      "privilege_type": "TRUNCATE",
      "is_grantable": "YES"
    },
    {
      "table_name": "bots",
      "grantee": "postgres",
      "privilege_type": "UPDATE",
      "is_grantable": "YES"
    },
    {
      "table_name": "chats",
      "grantee": "anon",
      "privilege_type": "DELETE",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "anon",
      "privilege_type": "INSERT",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "anon",
      "privilege_type": "SELECT",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "anon",
      "privilege_type": "UPDATE",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "authenticated",
      "privilege_type": "DELETE",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "authenticated",
      "privilege_type": "INSERT",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "authenticated",
      "privilege_type": "SELECT",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "authenticated",
      "privilege_type": "UPDATE",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "postgres",
      "privilege_type": "DELETE",
      "is_grantable": "YES"
    },
    {
      "table_name": "chats",
      "grantee": "postgres",
      "privilege_type": "INSERT",
      "is_grantable": "YES"
    },
    {
      "table_name": "chats",
      "grantee": "postgres",
      "privilege_type": "REFERENCES",
      "is_grantable": "YES"
    },
    {
      "table_name": "chats",
      "grantee": "postgres",
      "privilege_type": "SELECT",
      "is_grantable": "YES"
    },
    {
      "table_name": "chats",
      "grantee": "postgres",
      "privilege_type": "TRIGGER",
      "is_grantable": "YES"
    },
    {
      "table_name": "chats",
      "grantee": "postgres",
      "privilege_type": "TRUNCATE",
      "is_grantable": "YES"
    },
    {
      "table_name": "chats",
      "grantee": "postgres",
      "privilege_type": "UPDATE",
      "is_grantable": "YES"
    },
    {
      "table_name": "chats",
      "grantee": "service_role",
      "privilege_type": "DELETE",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "service_role",
      "privilege_type": "INSERT",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "service_role",
      "privilege_type": "REFERENCES",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "service_role",
      "privilege_type": "SELECT",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "service_role",
      "privilege_type": "TRIGGER",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "service_role",
      "privilege_type": "TRUNCATE",
      "is_grantable": "NO"
    },
    {
      "table_name": "chats",
      "grantee": "service_role",
      "privilege_type": "UPDATE",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "anon",
      "privilege_type": "DELETE",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "anon",
      "privilege_type": "INSERT",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "anon",
      "privilege_type": "SELECT",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "anon",
      "privilege_type": "UPDATE",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "authenticated",
      "privilege_type": "DELETE",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "authenticated",
      "privilege_type": "INSERT",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "authenticated",
      "privilege_type": "SELECT",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "authenticated",
      "privilege_type": "UPDATE",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "postgres",
      "privilege_type": "DELETE",
      "is_grantable": "YES"
    },
    {
      "table_name": "profiles",
      "grantee": "postgres",
      "privilege_type": "INSERT",
      "is_grantable": "YES"
    },
    {
      "table_name": "profiles",
      "grantee": "postgres",
      "privilege_type": "REFERENCES",
      "is_grantable": "YES"
    },
    {
      "table_name": "profiles",
      "grantee": "postgres",
      "privilege_type": "SELECT",
      "is_grantable": "YES"
    },
    {
      "table_name": "profiles",
      "grantee": "postgres",
      "privilege_type": "TRIGGER",
      "is_grantable": "YES"
    },
    {
      "table_name": "profiles",
      "grantee": "postgres",
      "privilege_type": "TRUNCATE",
      "is_grantable": "YES"
    },
    {
      "table_name": "profiles",
      "grantee": "postgres",
      "privilege_type": "UPDATE",
      "is_grantable": "YES"
    },
    {
      "table_name": "profiles",
      "grantee": "service_role",
      "privilege_type": "DELETE",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "service_role",
      "privilege_type": "INSERT",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "service_role",
      "privilege_type": "REFERENCES",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "service_role",
      "privilege_type": "SELECT",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "service_role",
      "privilege_type": "TRIGGER",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "service_role",
      "privilege_type": "TRUNCATE",
      "is_grantable": "NO"
    },
    {
      "table_name": "profiles",
      "grantee": "service_role",
      "privilege_type": "UPDATE",
      "is_grantable": "NO"
    }
  ],
  "columns": [
    {
      "table": "bots",
      "name": "id",
      "type": "uuid",
      "def": "gen_random_uuid()",
      "nullable": "NO"
    },
    {
      "table": "bots",
      "name": "username",
      "type": "text",
      "def": null,
      "nullable": "NO"
    },
    {
      "table": "bots",
      "name": "display_name",
      "type": "text",
      "def": null,
      "nullable": "NO"
    },
    {
      "table": "bots",
      "name": "description",
      "type": "text",
      "def": "''::text",
      "nullable": "NO"
    },
    {
      "table": "bots",
      "name": "avatar_url",
      "type": "text",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "bots",
      "name": "state",
      "type": "text",
      "def": "'active'::text",
      "nullable": "NO"
    },
    {
      "table": "bots",
      "name": "delete_after",
      "type": "timestamptz",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "bots",
      "name": "created_at",
      "type": "timestamptz",
      "def": "now()",
      "nullable": "NO"
    },
    {
      "table": "bots",
      "name": "updated_at",
      "type": "timestamptz",
      "def": "now()",
      "nullable": "NO"
    },
    {
      "table": "chats",
      "name": "id",
      "type": "uuid",
      "def": "uuid_generate_v4()",
      "nullable": "NO"
    },
    {
      "table": "chats",
      "name": "type",
      "type": "text",
      "def": null,
      "nullable": "NO"
    },
    {
      "table": "chats",
      "name": "name",
      "type": "text",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "chats",
      "name": "description",
      "type": "text",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "chats",
      "name": "avatar_url",
      "type": "text",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "chats",
      "name": "created_by",
      "type": "uuid",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "chats",
      "name": "created_at",
      "type": "timestamptz",
      "def": "now()",
      "nullable": "NO"
    },
    {
      "table": "chats",
      "name": "updated_at",
      "type": "timestamptz",
      "def": "now()",
      "nullable": "NO"
    },
    {
      "table": "chats",
      "name": "is_forum",
      "type": "bool",
      "def": "false",
      "nullable": "NO"
    },
    {
      "table": "chats",
      "name": "invite_policy",
      "type": "text",
      "def": "'owner_admin_only'::text",
      "nullable": "NO"
    },
    {
      "table": "profiles",
      "name": "id",
      "type": "uuid",
      "def": null,
      "nullable": "NO"
    },
    {
      "table": "profiles",
      "name": "username",
      "type": "text",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "profiles",
      "name": "full_name",
      "type": "text",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "profiles",
      "name": "avatar_url",
      "type": "text",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "profiles",
      "name": "bio",
      "type": "text",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "profiles",
      "name": "online_at",
      "type": "timestamptz",
      "def": "now()",
      "nullable": "YES"
    },
    {
      "table": "profiles",
      "name": "created_at",
      "type": "timestamptz",
      "def": "now()",
      "nullable": "NO"
    },
    {
      "table": "profiles",
      "name": "updated_at",
      "type": "timestamptz",
      "def": "now()",
      "nullable": "NO"
    },
    {
      "table": "profiles",
      "name": "role",
      "type": "app_role",
      "def": "'user'::app_role",
      "nullable": "NO"
    },
    {
      "table": "profiles",
      "name": "profile_frame",
      "type": "text",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "profiles",
      "name": "profile_background",
      "type": "text",
      "def": null,
      "nullable": "YES"
    },
    {
      "table": "profiles",
      "name": "is_test_account",
      "type": "bool",
      "def": "false",
      "nullable": "NO"
    },
    {
      "table": "profiles",
      "name": "presence_status",
      "type": "text",
      "def": null,
      "nullable": "YES"
    }
  ],
  "setters": [
    {
      "acl": [
        "supabase_admin=X/supabase_admin",
        "service_role=X/supabase_admin"
      ],
      "owner": "supabase_admin",
      "config": [
        "search_path=pg_catalog, public"
      ],
      "signature": "bot_set_avatar_internal(uuid,uuid,text,text)",
      "definition": "CREATE OR REPLACE FUNCTION public.bot_set_avatar_internal(p_actor_id uuid, p_bot_id uuid, p_avatar_url text, p_request_id text)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\ndeclare\n  v_url text := nullif(pg_catalog.btrim(coalesce(p_avatar_url, '')), '');\n  v_state text;\nbegin\n  if p_actor_id is null or p_bot_id is null then\n    raise exception 'invalid_request' using errcode = '22023';\n  end if;\n\n  if not exists (\n    select 1\n    from public.bot_owners owner\n    where owner.bot_id = p_bot_id\n      and owner.user_id = p_actor_id\n      and owner.role = 'owner'\n  ) then\n    raise exception 'forbidden' using errcode = '42501';\n  end if;\n\n  select bot.state into v_state from public.bots bot where bot.id = p_bot_id for update;\n  if not found then\n    raise exception 'not_found' using errcode = 'P0002';\n  end if;\n  if v_state in ('pending_delete', 'deleted') then\n    raise exception 'bot_deleted' using errcode = '55000';\n  end if;\n\n  -- A picture must be this bot's own file. Without this an owner could point\n  -- one of their bots at another bot's avatar, which is a small thing that\n  -- would read as impersonation in a chat.\n  if v_url is not null\n     and v_url not like ('https://core.letscube.ru/storage/v1/object/public/media/bot-avatars/' || p_bot_id::text || '/%') then\n    raise exception 'invalid_avatar' using errcode = '22023';\n  end if;\n\n  update public.bots\n  set avatar_url = v_url, updated_at = pg_catalog.now()\n  where id = p_bot_id;\n\n  return pg_catalog.jsonb_build_object('ok', true, 'avatar_url', v_url);\nend\n$function$\n"
    },
    {
      "acl": [
        "postgres=X/postgres",
        "service_role=X/postgres",
        "authenticated=X/postgres"
      ],
      "owner": "postgres",
      "config": [
        "search_path=public"
      ],
      "signature": "handle_new_user()",
      "definition": "CREATE OR REPLACE FUNCTION public.handle_new_user()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\nbegin\n  insert into public.profiles (id, full_name, avatar_url)\n  values (\n    new.id,\n    new.raw_user_meta_data->>'full_name',\n    new.raw_user_meta_data->>'avatar_url'\n  );\n  return new;\nend;\n$function$\n"
    }
  ]
}; }
