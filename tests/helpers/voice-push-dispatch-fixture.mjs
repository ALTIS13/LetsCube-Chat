import { readFileSync } from 'node:fs';
import { database as task2Database, exec, uid } from './voice-ring-push-fixture.mjs';
export { setup, ring, asUser, events, outcomes, exec, A, B, C, uid } from './voice-ring-push-fixture.mjs';

export const stem = '20260921122846_android_voice_push_dispatch';
export const sql = (suffix = '') => readFileSync(new URL(`../../.migration-backup/supabase/migrations/${stem}${suffix}.sql`, import.meta.url), 'utf8');
export const claimId = uid(101);

export async function database(source = sql()) {
  const db = await task2Database();
  try {
    await db.exec(`
      alter table public.user_push_devices add column updated_at timestamptz not null default now();
      create schema vault;
      create table vault.decrypted_secrets(name text, decrypted_secret text);
      create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
        returns uuid language plpgsql as $$ begin
          insert into vault.decrypted_secrets values (new_name, new_secret); return gen_random_uuid(); end $$;
      create schema net;
      create table net.requests(url text, body jsonb, headers jsonb, timeout_ms integer);
      create table net.http_request_queue(method text, url text, headers jsonb, body bytea, timeout_milliseconds integer);
      create function net.http_post(url text, body jsonb default '{}'::jsonb,
        params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
      returns bigint language plpgsql as $$
      begin
        if not exists (select 1 from public.voice_ring_push_devices) then
          raise exception 'synthetic wake ran before target rows';
        end if;
        insert into net.requests values (url, body, headers, timeout_milliseconds);
        insert into net.http_request_queue values ('POST', url, headers, convert_to(body::text, 'UTF8'), timeout_milliseconds);
        return 1;
      end $$;
    `);
    if (source.trim()) await exec(db, source);
    return db;
  } catch (error) { await db.close(); throw error; }
}

export async function service(db, statement, args = []) {
  await db.exec('set role service_role');
  try { return await db.query(statement, args); }
  finally { await db.exec('reset role; set role supabase_admin'); }
}
export async function enable(db) { await db.exec('update private.voice_push_dispatch_config set enabled = true'); }
export const claim = async (db, id = claimId, limit = 20) =>
  (await service(db, 'select * from public.voice_push_claim(p_limit => $1, p_claim_id => $2)', [limit, id])).rows;
export const prepare = async (db, row) =>
  (await service(db, 'select * from public.voice_push_prepare(p_event_id => $1, p_push_device_id => $2, p_claim_id => $3)',
    [row.event_id, row.push_device_id, row.claim_id])).rows;
export const complete = async (db, row, result = 'accepted', delay = null, hash = null) =>
  (await service(db, `select public.voice_push_complete(p_event_id => $1, p_push_device_id => $2, p_claim_id => $3,
    p_result => $4, p_retry_after_ms => $5, p_token_hash => $6) as result`,
    [row.event_id, row.push_device_id, row.claim_id, result, delay, hash])).rows[0].result;
