import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  referenceFixture, known, references, observation, mediaUrl, quote,
  snapshot, allBindings, mutateInstalled,
} from "./bot-message-media-references.fixture.mjs";
import { uuid } from "./bot-inline-media-ingest.fixture.mjs";

export { known, references, observation, mediaUrl, quote, uuid, snapshot, allBindings, mutateInstalled };
export const baseline = process.env.BOT_MESSAGE_MEDIA_OBSERVATIONS_BASELINE === "1";
export const actor = uuid(7001);
export const outsider = uuid(7002);
export const table = "private.bot_message_media_observations";
export const signature = "private.bot_message_media_observe_statement()";
const root = new URL("../../", import.meta.url);
const stem = "supabase/migrations/20261002232331_bot_message_media_observations";
let candidate;
export const observationSource = () => candidate ??= readFileSync(new URL(stem + ".sql", root), "utf8").replaceAll("\r\n", "\n");
export const observationRollback = () => readFileSync(new URL(stem + ".rollback.sql", root), "utf8").replaceAll("\r\n", "\n");
const source = path => readFileSync(new URL(path, root), "utf8").replaceAll("\r\n", "\n");

function capturedDefinition(path, name, kind = "function") {
  const sql = source(path);
  const escaped = name.replaceAll(".", "\\.");
  const start = sql.search(new RegExp("^create(?: or replace)? " + kind + " " + escaped + "(?:\\(|\\s)", "im"));
  assert.notEqual(start, -1, "accepted source definition must exist: " + name);
  const selected = sql.slice(start);
  if (kind === "trigger") return selected.slice(0, selected.indexOf(";") + 1);
  const delimiter = selected.match(/\bas\s+(\$[A-Za-z_]*\$)/i)?.[1];
  assert.ok(delimiter, "accepted function must have a complete dollar-quoted body");
  const open = selected.indexOf(delimiter), close = selected.indexOf(delimiter, open + delimiter.length);
  assert.ok(close > open, "accepted function body must terminate");
  return selected.slice(0, selected.indexOf(";", close + delimiter.length) + 1);
}

async function acceptedRowHooks(db) {
  const scrub = "supabase/migrations/20260928210000_deleted_message_keeps_nothing.sql";
  const epoch = "supabase/migrations/20260926144000_bot_privacy_delivery_epoch.sql";
  await db.exec(`alter table public.messages
      alter column chat_id set not null,
      add column forwarded_from_id uuid references public.messages(id) on delete set null,
      add column client_message_id uuid,
      add column client_sent_at timestamptz,
      add column pinned boolean default false,
      add column bot_input_field_placeholder text;
    alter table public.messages add constraint fixture_reply_fk foreign key(reply_to_id)
      references public.messages(id) on delete set null;
    create unique index fixture_client_message_id on public.messages(chat_id,user_id,client_message_id)
      where client_message_id is not null;
    alter table public.messages add constraint messages_media_metadata_is_object
      check(media_metadata is null or jsonb_typeof(media_metadata)='object');
    create table public.content_reports(id uuid primary key,message_id uuid,status text);
    alter table public.content_reports owner to postgres;
    alter table public.content_reports enable row level security;
    create table private.message_media_purge(message_id uuid,bucket text,path text,
      constraint message_media_purge_once unique(message_id,bucket,path));
    alter table private.message_media_purge owner to postgres;
    revoke all on private.message_media_purge from public,anon,authenticated,service_role;
    set role postgres;
    ${capturedDefinition(scrub, "private.deleted_message_keeps_nothing")}
    ${capturedDefinition(scrub, "trg_zz_deleted_message_keeps_nothing", "trigger")}
    ${capturedDefinition(scrub, "private.closed_report_finishes_deletion")}
    ${capturedDefinition(scrub, "trg_content_report_closed_finishes_deletion", "trigger")}
    ${capturedDefinition(epoch, "private.lock_bot_message_epoch")}
    ${capturedDefinition(epoch, "trg_a_lock_bot_message_epoch", "trigger")}
    ${capturedDefinition(epoch, "private.guard_bot_message_created_at")}
    ${capturedDefinition(epoch, "trg_guard_bot_message_created_at", "trigger")}
    revoke all on function private.deleted_message_keeps_nothing(),private.closed_report_finishes_deletion(),
      private.lock_bot_message_epoch(),private.guard_bot_message_created_at()
      from public,anon,authenticated,service_role;`);
  const guard = ".migration-backup/supabase/migrations/20260913131000_message_media_path_guard.sql";
  await db.exec(`set role postgres;
    ${capturedDefinition(guard, "private.message_media_path_allowed")}
    ${capturedDefinition(guard, "private.guard_message_media_path")}
    ${capturedDefinition(guard, "trg_guard_message_media_path", "trigger")}
    revoke all on function private.message_media_path_allowed(uuid,uuid,uuid,text,boolean),
      private.guard_message_media_path() from public,anon,authenticated,service_role;`);
  await db.exec("set role postgres; " + source(".migration-backup/supabase/migrations/20260913132000_message_media_metadata_shape.sql"));
}

export async function observationFixture(t, { applyObservations = !baseline, sql } = {}) {
  assert.ok(!process.env.BOT_MESSAGE_MEDIA_REFERENCES_BASELINE, "the accepted stage 2 resolver is required");
  const db = await referenceFixture(t, { applyResolver: true });
  // Focused fictional message authorization, not a copy of every production policy.
  await db.exec(`create schema auth authorization postgres;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    alter function auth.uid() owner to postgres;
    grant usage on schema auth to authenticated,anon,postgres;
    grant execute on function auth.uid() to authenticated,anon,postgres;
    create table public.chat_members(chat_id uuid not null,user_id uuid not null,cleared_at timestamptz,primary key(chat_id,user_id));
    alter table public.chat_members owner to postgres;
    alter table public.chat_members enable row level security;
    grant select on public.chat_members to authenticated;
    create policy fixture_own_membership on public.chat_members for select to authenticated using(user_id=auth.uid());
    insert into public.chat_members(chat_id,user_id) values ('${uuid(3)}','${actor}');
    grant select,insert,update,delete on public.messages to authenticated,service_role;
    create policy fixture_member_read on public.messages for select to authenticated using(exists(
      select 1 from public.chat_members c where c.chat_id=messages.chat_id and c.user_id=auth.uid()));
    create policy fixture_member_insert on public.messages for insert to authenticated with check(
      user_id=auth.uid() and bot_id is null and exists(
        select 1 from public.chat_members c where c.chat_id=messages.chat_id and c.user_id=auth.uid()));
    create policy fixture_author_update on public.messages for update to authenticated
      using(user_id=auth.uid()) with check(user_id=auth.uid());
    create policy fixture_author_delete on public.messages for delete to authenticated using(user_id=auth.uid());`);
  await acceptedRowHooks(db);
  if (applyObservations) await db.exec(sql ?? observationSource());
  return db;
}

export const authenticated = (db, sql, user = actor) => db.exec(`set role authenticated;
  set request.jwt.claim.sub=${quote(user)}; ${sql}`);

export function messageInsert(id, { chat = uuid(3), user = actor, bucket = "chat-media", path = null,
  url = null, metadata = {}, deleted = false, forward = null } = {}) {
  const scalar = value => value === null ? "null" : quote(value);
  return `insert into public.messages(id,chat_id,user_id,type,media_bucket,media_path,media_url,media_metadata,deleted_at,forwarded_from_id)
    values ('${id}','${chat}',${scalar(user)},'file',${scalar(bucket)},${scalar(path)},${scalar(url)},
      ${metadata === undefined ? "null" : quote(JSON.stringify(metadata)) + "::jsonb"},
      ${deleted ? "clock_timestamp()" : "null"},${scalar(forward)})`;
}

export async function observations(db, id) {
  const [exists] = await db.query(`select to_regclass('${table}') is not null as present`);
  if (!exists.present) return [];
  return db.query(`select source_kind,bucket_id,object_path,generation_id,reference_state,hold_reason
    from ${table} where message_id='${id}' order by source_kind`);
}

export const allObservations = db => db.query(`select * from ${table} order by message_id,source_kind`);
export const trusted = (db, sql) => db.exec("set role postgres; " + sql);
export const previewPath = path => path.replace(/\.[^./]*$/, "") + ".preview.webp";
export const registered = (kind, a) => observation(kind, "chat-media", a.receipt.path, a.identity.generation_id, "registered", null);
export const settled = promise => promise.then(value => ({ value }), error => ({ error }));

export async function session(db, setup = "") {
  const connection = db.session();
  const pid = Number(await connection.send("set statement_timeout='15s'; " + setup + " select pg_backend_pid();"));
  assert.ok(Number.isInteger(pid) && pid > 0, "actual PostgreSQL session PID is required");
  return { connection, pid };
}

export async function waitForRelation(db, waiter, blocker, mode) {
  for (let i = 0; i < 100; i++) {
    const [state] = await db.query(`select exists(select 1 from pg_locks where pid=${waiter}
      and relation='public.messages'::regclass and mode=${quote(mode)} and not granted) as waiting,
      ${blocker}=any(pg_blocking_pids(${waiter})) as expected_blocker,
      (select wait_event_type='Lock' from pg_stat_activity where pid=${waiter}) as lock_wait`);
    if (state.waiting && state.expected_blocker && state.lock_wait) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("expected messages relation wait and blocking PID were not observed");
}

export async function waitForGate(db, waiter, blocker) {
  for (let i = 0; i < 100; i++) {
    const [state] = await db.query(`select exists(select 1 from pg_locks where pid=${waiter}
      and locktype='advisory' and classid=74001 and objid=1 and not granted) as waiting,
      ${blocker}=any(pg_blocking_pids(${waiter})) as expected_blocker`);
    if (state.waiting && state.expected_blocker) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("bootstrap did not reach the test-only advisory commit barrier");
}

export async function legacyState(db) {
  return {
    messages: await db.query("select * from public.messages order by id"),
    accounting: await snapshot(db), bindings: await allBindings(db),
    schemas: await db.query("select oid,nspname,nspowner,nspacl::text from pg_namespace where nspname in ('public','private','storage','auth') order by oid"),
    tables: await db.query(`select c.oid,c.relname,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,
      c.relkind,c.relispartition from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private','storage') and c.relkind in ('r','p')
      and c.relname<>'bot_message_media_observations' order by c.oid`),
    columns: await db.query(`select a.attrelid,a.attnum,a.attname,a.atttypid,a.attnotnull,a.attacl::text
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private','storage') and c.relkind in ('r','p')
      and c.relname<>'bot_message_media_observations' and a.attnum>0 and not a.attisdropped order by a.attrelid,a.attnum`),
    policies: await db.query("select * from pg_policies where tablename<>'bot_message_media_observations' order by schemaname,tablename,policyname"),
    functions: await db.query(`select oid,oid::regprocedure::text as signature,prosrc,proacl::text,proconfig,
      proowner,prosecdef,provolatile from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace)
      and proname not like 'bot_message_media_observ%' order by oid`),
    triggers: await db.query(`select t.oid,t.tgrelid,t.tgname,t.tgfoid,t.tgtype,t.tgenabled,pg_get_triggerdef(t.oid) as ddl
      from pg_trigger t where t.tgrelid='public.messages'::regclass
      and t.tgname not like 'trg_bot_message_media_observations_%' order by t.oid`),
  };
}

export async function installForward(db) {
  await db.exec(`create table public.message_hidden_for_users(message_id uuid,user_id uuid);
    alter table public.message_hidden_for_users owner to postgres;
    alter table public.message_hidden_for_users enable row level security;
    create table public.media_variants(id uuid primary key default gen_random_uuid(),
      message_id uuid references public.messages(id) on delete cascade,
      chat_id uuid references public.chats(id) on delete cascade,owner_id uuid,profile_id uuid,
      source_bucket text not null default 'media',source_path text not null,
      variant_kind text not null check(variant_kind in ('image_preview','image_thumb','video_poster','video_720p','avatar_128','avatar_256')),
      variant_bucket text not null default 'media',variant_path text not null,mime_type text not null,
      width integer check(width is null or width>0),height integer check(height is null or height>0),
      size_bytes bigint check(size_bytes is null or size_bytes>=0),
      status text not null default 'ready' check(status in ('ready','failed','stale')),error_code text,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
      check((message_id is not null and chat_id is not null and profile_id is null)
        or(message_id is null and chat_id is null and profile_id is not null)));
    create unique index fixture_variants_message_kind on public.media_variants(message_id,variant_kind)
      where message_id is not null and status='ready';
    create unique index fixture_variants_profile_kind on public.media_variants(profile_id,variant_kind)
      where profile_id is not null and status='ready';
    alter table public.media_variants owner to postgres;
    alter table public.media_variants enable row level security;
    set role postgres;
    create function public.is_banned(uuid) returns boolean language sql as $$ select false $$;
    create function public.is_muted(uuid,uuid) returns boolean language sql as $$ select false $$;
    ${capturedDefinition(".migration-backup/supabase/migrations/20260911144000_forward_message_with_media.sql", "public.forward_message")}
    revoke all on function public.forward_message(uuid,uuid,uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
    grant execute on function public.forward_message(uuid,uuid,uuid,timestamptz,uuid) to authenticated;`);
}

export function omitResolverArgument(body, index) {
  let edits = 0;
  const after = body.replace(/private\.bot_message_media_references\(([^()]*)\)/g, (call, parameters) => {
    const args = parameters.split(",");
    assert.equal(args.length, 4, "mutant must select the actual four-argument resolver call");
    args[index] = index === 3 ? "NULL::jsonb" : "NULL::text";
    edits++;
    return "private.bot_message_media_references(" + args.join(",") + ")";
  });
  assert.ok(edits > 0, "mutant must change a compiled observer resolver invocation");
  return after;
}
