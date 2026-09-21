import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../../.migration-backup/supabase/migrations/', import.meta.url);
export const stem = '20260921114127_android_voice_ring_outbox';
export const sql = (name = stem) => readFileSync(new URL(`${name}.sql`, migrations), 'utf8');

// Reuse the existing minimal auth/chat/message schema without importing its tests.
// The explicit delimiter fails closed if the fixture is moved or stops being raw SQL.
const precedent = readFileSync(new URL('../server/voice-call-service-message-db.test.mjs', import.meta.url), 'utf8');
const stub = precedent.match(/const STUB = String.raw`([\s\S]*?)`;/)?.[1];
assert.ok(stub, 'the shared voice service-message schema fixture moved');
export const chain = [
  '20260913150000_voice_channels',
  '20260914140000_channel_categories',
  '20260918160000_voice_rooms_many_and_the_stuck_flag',
  '20260918170000_voice_recount_writes_only_when_something_changed',
  '20260918200000_a_call_says_so_in_the_conversation',
  '20260918220000_a_private_chat_can_ring',
  '20260918230000_a_ring_cannot_be_forged',
  '20260918240000_a_call_that_died_does_not_lock_the_pair_out',
  '20260918250000_a_call_says_so_in_the_private_chat',
  '20260918270000_a_call_over_an_hour_says_hours',
  '20260918280000_a_private_chat_has_no_channel_to_announce',
  '20260918290000_a_device_can_refuse_calls',
  '20260919000000_a_session_time_is_utc_because_it_says_so',
  '20260919180000_the_rail_already_says_who_is_in_the_channel',
  '20260920130000_a_group_voice_channel_has_no_seat_limit',
];

// Extract the exact single CREATE FUNCTION statement, not a rewritten RPC.
// Only the sweep's scheduler is excluded: this harness never installs pg_cron.
export function functionSql(name, qualifiedName) {
  const statements = [...sql(name).matchAll(/create (?:or replace )?function\s+([\w.]+)\s*\([\s\S]*?\bas\s+(\$[\w]*\$)[\s\S]*?\2;/gi)];
  const found = statements.filter((m) => m[1] === qualifiedName);
  assert.equal(found.length, 1, `expected one recorded definition of ${qualifiedName}`);
  return found[0][0];
}

export async function exec(db, source) {
  try { return await db.exec(source); }
  catch (error) { await db.exec('rollback'); throw error; }
}

export async function database(source = sql()) {
  const db = new PGlite();
  try {
    await db.exec(stub);
    await db.exec(`
      create role supabase_admin superuser bypassrls;
      create table auth.sessions (
        id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
        not_after timestamptz, created_at timestamptz default now(),
        refreshed_at timestamp, user_agent text, ip inet
      );
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create table public.user_blocks (blocker_id uuid, blocked_id uuid, primary key(blocker_id, blocked_id));
      -- Schema contract only: registration and its migration belong to Task 2a.
      create table public.user_push_devices (
        id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
        platform text not null, provider text not null, token text not null, token_hash text not null,
        enabled boolean not null default true, revoked_at timestamptz,
        session_id uuid references auth.sessions(id) on delete set null,
        voice_call_protocol smallint check (voice_call_protocol = 1),
        unique(provider, token_hash)
      );
      alter table public.user_push_devices enable row level security;
    `);
    await db.exec(functionSql('20260914120000_personal_blocks_and_reports', 'public.blocked_from_chat'));
    await db.exec(functionSql('20260504_roles_admin', 'public.is_banned'));
    await db.exec(functionSql('20260504_roles_admin', 'public.is_muted'));
    for (const name of chain) {
      if (name.startsWith('20260920130000')) {
        // Its historical self-check pins five rooms and the production owner.
        // Supply synthetic rows; keep the recorded migration byte-for-byte.
        await db.exec(`
          alter table public.voice_channels owner to supabase_admin;
          insert into public.chats(type) values ('group'), ('group'), ('group'), ('private'), ('private');
          insert into public.voice_channels(chat_id, name, max_participants)
            select id, 'fixture', case when type = 'private' then 2 else 10 end from public.chats;
        `);
      }
      await exec(db, sql(name));
    }
    await db.exec('delete from public.chats');
    await db.exec(functionSql('20260918260000_a_missed_call_is_recorded_even_if_nobody_is_there', 'public.voice_rings_sweep_expired'));
    await db.exec(`
      alter table public.voice_channels owner to supabase_admin;
      alter table public.user_session_settings owner to supabase_admin;
      -- Hostile defaults model Supabase: an omitted REVOKE must be observable.
      alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated, service_role;
      set role supabase_admin;
    `);
    if (source.trim()) await exec(db, source);
    return db;
  } catch (error) { await db.close(); throw error; }
}

export const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const A = uid(1), B = uid(2), C = uid(3);
export async function setup(db) {
  await db.exec(`
    insert into auth.users(id) values ('${A}'), ('${B}'), ('${C}');
    insert into public.profiles(id) select id from auth.users;
  `);
  const { rows: [chat] } = await db.query("insert into public.chats(type, created_by) values ('private', $1) returning id", [A]);
  await db.query('insert into public.chat_members(chat_id, user_id, role) values ($1, $2, \'owner\'), ($1, $3, \'member\')', [chat.id, A, B]);
  for (const [id, user] of [[11, A], [12, B], [13, B], [14, C]]) {
    await db.query('insert into auth.sessions(id, user_id, refreshed_at) values ($1, $2, now())', [uid(id), user]);
  }
  for (const [id, user, session] of [[21, A, 11], [22, B, 12], [23, B, 12], [24, B, 13], [25, C, 14]]) {
    await db.query(`insert into public.user_push_devices(id, user_id, platform, provider, token, token_hash, session_id, voice_call_protocol)
      values ($1, $2, 'android', 'fcm', $3, $3, $4, 1)`, [uid(id), user, `synthetic-device-${id}`, uid(session)]);
  }
  return chat.id;
}

export async function asUser(db, user, statement, args = []) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user })]);
  await db.exec('set role authenticated');
  try { return await db.query(statement, args); }
  finally { await db.exec('reset role; set role supabase_admin'); }
}
export async function ring(db, chat) {
  const { rows: [result] } = await asUser(db, A, 'select * from public.voice_call_ring($1)', [chat]);
  return result;
}
export const events = async (db) => (await db.query('select * from public.voice_ring_push_events order by event, recipient_session_id')).rows;
export const outcomes = async (db) => (await db.query('select * from public.voice_ring_push_devices order by event_id, push_device_id')).rows;
