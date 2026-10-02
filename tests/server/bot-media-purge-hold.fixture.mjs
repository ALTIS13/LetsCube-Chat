import assert from "node:assert/strict";
import { postgres, read, quote, uuid } from "./bot-inline-media-ingest.fixture.mjs";

export { quote, uuid };
export const holdStem = "supabase/migrations/20261002203853_bot_media_purge_hold";
const oldMigration = ".migration-backup/supabase/migrations/20260928210000_deleted_message_keeps_nothing.sql";
export const claimSignature = "public.message_media_purge_claim(integer)";
export const finishSignature = "public.message_media_purge_finish(uuid,text)";
export const migration = () => read(holdStem + ".sql");
export const rollback = () => read(holdStem + ".rollback.sql");

export function originalFunction(name) {
  const source = read(oldMigration);
  const start = source.indexOf("create function public." + name + "(");
  assert.notEqual(start, -1, "D-103 function declaration is present");
  const end = source.indexOf("\nend $$;", start);
  assert.notEqual(end, -1, "D-103 function terminator is present");
  return source.slice(start, end + "\nend $$;".length);
}

function missingSchema() {
  const source = read(oldMigration);
  const queue = source.match(/create table private\.message_media_purge \([\s\S]*?\n\);/);
  assert.ok(queue, "exact D-103 queue schema is present");
  // Fictional rows, the referenced columns, production owners and role boundaries.
  // Unrelated auth/profile FKs and read policies are outside this focused fixture.
  return `
set role postgres;
${queue[0]}
create index message_media_purge_pending_idx on private.message_media_purge(created_at) where status='pending';
revoke all on private.message_media_purge from public,anon,authenticated,service_role;
create table public.content_reports(
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null, kind text not null,
  target_user_id uuid not null, message_id uuid references public.messages(id) on delete set null,
  chat_id uuid references public.chats(id) on delete set null, reason text not null, note text,
  status text not null default 'new', handled_by uuid, handled_at timestamptz,
  created_at timestamptz not null default now(),
  check(kind in ('message','user')), check(status in ('new','reviewing','actioned','dismissed'))
);
alter table public.content_reports enable row level security;
revoke all on public.content_reports from public,anon,authenticated,service_role;
grant select,insert on public.content_reports to authenticated;
grant update(status,handled_by,handled_at) on public.content_reports to authenticated;
grant all on public.content_reports to service_role;
reset role;
set role supabase_admin;
create table public.media_variants(
  id uuid primary key default gen_random_uuid(), message_id uuid references public.messages(id) on delete cascade,
  chat_id uuid, owner_id uuid, profile_id uuid, source_bucket text not null default 'media',
  source_path text not null, variant_kind text not null, variant_bucket text not null default 'media',
  variant_path text not null, mime_type text not null default 'image/webp', width integer,
  height integer, size_bytes bigint, status text not null default 'ready', error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.media_variants enable row level security;
revoke all on public.media_variants from public,anon,authenticated,service_role;
grant select on public.media_variants to authenticated;
grant select,insert,update,delete on public.media_variants to service_role;
grant all on public.media_variants to postgres;
reset role;
set role postgres;
${originalFunction("message_media_purge_claim")}
${originalFunction("message_media_purge_finish")}
${originalFunction("message_media_purge_claim").replace("public.message_media_purge_claim(", "public.fixture_stale_claim(")}
revoke all on function ${claimSignature} from public,anon,authenticated,service_role;
revoke all on function ${finishSignature} from public,anon,authenticated,service_role;
revoke all on function public.fixture_stale_claim(integer) from public,anon,authenticated,service_role;
grant execute on function ${claimSignature} to service_role;
grant execute on function ${finishSignature} to service_role;
grant execute on function public.fixture_stale_claim(integer) to service_role;
reset role;
`;
}

export async function purgeFixture(t, { applyHold = !process.env.BOT_PURGE_HOLD_BASELINE, sql } = {}) {
  assert.ok(!process.env.BOT_INGEST_TEST_BASELINE, "purge tests must use the accepted ingest fixture unchanged");
  const db = await postgres(t);
  await db.exec(missingSchema());
  const [baseline] = await db.query(`select md5(prosrc) as md5,
    encode(sha256(convert_to(prosrc,'UTF8')),'hex') as sha256 from pg_proc where oid='${claimSignature}'::regprocedure`);
  assert.equal(baseline.md5, "6c8c495fff5655465d4f788389bdd1ae", "extracted baseline matches live D-103 body MD5");
  assert.equal(baseline.sha256, "22ae6a8dadb994f1803bbf5b030827fa6fb1c86d350adbf898f64b7a43c3b097");
  if (applyHold) await db.exec(sql ?? migration());
  return db;
}

export async function enqueue(db, n, bucket, path, extra = {}) {
  const row = { id: uuid(1000 + n), message_id: uuid(2000 + n), bucket, path, ...extra };
  const fields = Object.keys(row);
  const values = Object.values(row).map(value => value === null ? "null" : quote(value));
  await db.exec(`insert into private.message_media_purge(${fields.join(",")}) values (${values.join(",")});`);
  return row.id;
}

export async function claim(db, limit = 50) {
  const expression = limit === null ? "null" : String(limit);
  return JSON.parse(await db.exec(`set role service_role;
    select coalesce(jsonb_agg(q),'[]'::jsonb) from public.message_media_purge_claim(${expression}) q;`));
}

export const queueRows = db => db.query("select * from private.message_media_purge order by id");

export async function catalog(db) {
  return db.query(`select p.oid::regprocedure::text as signature,p.proname as name,p.oid,proowner::regrole::text as owner,
    proacl::text,proconfig::text,prosecdef,provolatile,prorettype::regtype::text as result,
    pronargdefaults,proargnames,proargmodes,md5(prosrc) as body from pg_proc p
    where oid in ('${claimSignature}'::regprocedure,'${finishSignature}'::regprocedure) order by 1`);
}

export async function queueConstraints(db) {
  return db.query(`select conname,convalidated,pg_get_constraintdef(oid) as definition from pg_constraint
    where conrelid='private.message_media_purge'::regclass order by conname`);
}

export async function waitForRelationLock(db, pid, relation) {
  for (let i = 0; i < 80; i++) {
    const [state] = await db.query(`select exists(select 1 from pg_locks
      where pid=${Number(pid)} and relation=${quote(relation)}::regclass and not granted) as waiting`);
    if (state.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("fixture session did not reach the expected relation-lock barrier");
}
