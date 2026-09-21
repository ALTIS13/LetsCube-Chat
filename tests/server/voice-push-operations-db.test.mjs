import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { database as task3Database, setup, ring, exec, uid, B, claim, complete, prepare, enable, service } from '../helpers/voice-push-dispatch-fixture.mjs';

const stem = '20260921153256_android_voice_push_operations';
const source = (suffix = '') => readFileSync(new URL(`../../.migration-backup/supabase/migrations/${stem}${suffix}.sql`, import.meta.url), 'utf8');
const baseline = process.env.LETSCUBE_TASK5_TEST_TASK3 === '1';

// PGlite executes the real proposal. These doubles only supply extension APIs;
// actual cron scheduling, concurrent connections and pg_net belong to PG17 QA.
async function database(sql = baseline ? '' : source()) {
  const db = await task3Database();
  try {
    await db.exec(`
      create schema cron;
      create table cron.job(jobid bigserial primary key, jobname text unique, schedule text,
        command text, database text, username text, active boolean);
      create function cron.schedule_in_database(job_name text, schedule text, command text,
        database text, username text default null, active boolean default true)
      returns bigint language sql as $$
        insert into cron.job(jobname,schedule,command,database,username,active)
        values(job_name,schedule,command,database,coalesce(username,current_user),active) returning jobid $$;
      create function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$
        begin delete from cron.job where jobid=job_id; return found; end $$;
      insert into cron.job(jobname,schedule,command,database,username,active)
        values('generic-minute','* * * * *','select 1',current_database(),'supabase_admin',true);
      alter table net.http_request_queue add column id bigserial;
      create table net._http_response(id bigint, status_code integer, content_type text, headers jsonb,
        content text, timed_out boolean, error_msg text, created timestamptz not null default now());
      create or replace function net.http_post(url text, body jsonb default '{}'::jsonb,
        params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
      returns bigint language plpgsql as $$ declare request_id bigint; begin
        insert into net.http_request_queue(method,url,headers,body,timeout_milliseconds)
          values('POST',url,headers,convert_to(body::text,'UTF8'),timeout_milliseconds) returning id into request_id;
        insert into net.requests values(url,body,headers,timeout_milliseconds);
        return request_id;
      end $$;
    `);
    if (sql.trim()) await exec(db, sql);
    return db;
  } catch (error) { await db.close(); throw error; }
}

async function seed(db, count = 40) {
  const chat = await setup(db);
  await db.query(`insert into public.user_push_devices(id,user_id,platform,provider,token,token_hash,session_id,voice_call_protocol)
    select gen_random_uuid(),$1,'android','fcm','synthetic-'||n,'synthetic-'||n,$2,1 from generate_series(1,$3) n`,
  [B, uid(12), count - 3]);
  return chat;
}
async function vault(db, url = 'http://kong:8000') {
  await db.query("insert into vault.decrypted_secrets values ('kub_project_url',$1),('kub_push_dispatch_token','synthetic-auth')", [url]);
}
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const tick = (db) => scalar(db, 'select private.voice_push_tick()');
const health = async (db) => (await service(db, 'select * from public.voice_push_health()')).rows[0];
async function drain(db, limit = 20) {
  let total = 0;
  while (total < limit) {
    const rows = await claim(db, uid(1000 + total), Math.min(4, limit - total));
    if (!rows.length) break;
    for (const row of rows) {
      assert.equal((await prepare(db, row)).length, 1);
      assert.equal(await complete(db, row), true);
    }
    total += rows.length;
  }
  return total;
}
function scenario(name, fn) {
  test(name, async () => { const db = await database(); try { await fn(db); } finally { await db.close(); } });
}

scenario('regression: overlapping outstanding waves stop at sixteen globally', async (db) => {
  await ring(db, await seed(db)); await enable(db);
  for (let n = 0; n < 4; n++) assert.equal((await claim(db, uid(100 + n), 4)).length, 4);
  assert.deepEqual(await claim(db, uid(110), 4), [], 'a fifth wave oversubscribed sixteen live claims');
  assert.equal(await scalar(db, "select count(*)::int from public.voice_ring_push_devices where state='claimed'"), 16);
});

scenario('regression: recovery is installed at five seconds but remains inactive', async (db) => {
  const jobs = (await db.query("select jobname,schedule,command,username,active from cron.job where jobname like 'letscube-voice-push-%' order by jobname")).rows;
  assert.deepEqual(jobs, [
    { jobname: 'letscube-voice-push-cleanup', schedule: '* * * * *', command: 'select private.voice_push_cleanup();', username: 'supabase_admin', active: false },
    { jobname: 'letscube-voice-push-recovery', schedule: '5 seconds', command: 'select private.voice_push_tick();', username: 'supabase_admin', active: false },
  ]);
  assert.equal(await scalar(db, "select active from cron.job where jobname='generic-minute'"), true);
});

scenario('regression: residual targets beyond a twenty-claim drain recover after the immediate wake is lost', async (db) => {
  await ring(db, await seed(db)); await vault(db); await enable(db);
  assert.equal(await drain(db), 20);
  const commands = (await db.query("select command from cron.job where jobname='letscube-voice-push-recovery'")).rows;
  for (const { command } of commands) await db.exec(command);
  const queued = await scalar(db, 'select count(*)::int from net.http_request_queue');
  if (queued) await drain(db);
  assert.equal(await scalar(db, "select count(*)::int from public.voice_ring_push_devices where state='pending'"), 0, 'residual target backlog stranded');
});

if (!baseline) {
scenario('disabled gate returns before Vault/net access and before retention writes', async (db) => {
  await ring(db, await seed(db, 3));
  await ageEvents(db, "interval '25 hours'");
  await db.exec('drop schema vault cascade; drop schema net cascade');
  assert.equal(await tick(db), 0);
  assert.deepEqual((await db.query('select * from private.voice_push_cleanup()')).rows, [{ outcomes_deleted: 0, events_deleted: 0 }]);
  assert.deepEqual(await claim(db), []);
  const h = await health(db);
  assert.equal(h.enabled, false);
  assert.equal(Number(h.expired_count), 3);
});

scenario('owner/service aggregate health denies clients and private state denies service access', async (db) => {
  await ring(db, await seed(db));
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => db.query('select * from public.voice_push_health()'), /permission denied/);
    await db.exec('reset role; set role supabase_admin');
  }
  for (const statement of [
    'select private.voice_push_tick()', 'select private.voice_push_cleanup()',
    'select * from private.voice_push_wake_slots', 'select * from private.voice_push_wake_stats',
    'update private.voice_push_wake_slots set request_id=null,started_at=null',
  ]) await assert.rejects(() => service(db, statement), /permission denied/);
  const h = await health(db);
  assert.deepEqual(Object.keys(h).sort(), ['enabled', 'ready_count', 'live_claimed_count', 'oldest_ready_age_seconds',
    'expired_count', 'wake_http_success_count', 'wake_http_failure_count', 'wake_http_timeout_count', 'inflight_slots'].sort());
  assert.equal(Number(h.ready_count), 40);
  assert.equal(Number(h.live_claimed_count), 0);
  assert.ok(h.oldest_ready_age_seconds >= 0);
});

scenario('four fixed slots bound repeated wakes, HTTP payload and transaction rollback', async (db) => {
  const chat = await seed(db, 83); await vault(db); await enable(db);
  await db.exec('begin'); await ring(db, chat);
  assert.equal(await scalar(db, 'select count(*)::int from net.http_request_queue'), 4);
  assert.equal(await tick(db), 0);
  const requests = (await db.query('select url,body,timeout_ms from net.requests')).rows;
  for (const request of requests) {
    assert.equal(request.url, 'http://kong:8000/functions/v1/send-push-notifications');
    assert.deepEqual(request.body, { scope: 'voice', limit: 20 });
    assert.equal(request.timeout_ms, 25000);
  }
  await db.exec('rollback');
  assert.equal(await scalar(db, 'select count(*)::int from net.http_request_queue'), 0);
  assert.equal((await health(db)).inflight_slots, 0);
  assert.equal(await tick(db), 0, 'empty backlog must not wake');
  await assert.rejects(() => db.exec('insert into private.voice_push_wake_slots(slot) values(5)'), /check constraint/);
});

scenario('transport status frees completed slots, counts only acknowledgements and never reads response text', async (db) => {
  await ring(db, await seed(db, 83)); await vault(db); await enable(db);
  assert.equal(await tick(db), 4);
  await db.exec(`insert into net._http_response(id,status_code,timed_out,error_msg,content,headers)
    select request_id,case slot when 1 then 204 when 2 then 503 when 3 then 200 else null end,
      slot=4,case when slot=3 then 'synthetic-secret-must-not-escape' else null end,
      'synthetic-private-response', '{"authorization":"synthetic-private"}'::jsonb
    from private.voice_push_wake_slots;
    delete from net.http_request_queue;`);
  await db.exec("alter table net._http_response drop column content, drop column headers, drop column content_type");
  assert.equal(await tick(db), 4);
  const h = await health(db);
  assert.equal(Number(h.wake_http_success_count), 1);
  assert.equal(Number(h.wake_http_failure_count), 2);
  assert.equal(Number(h.wake_http_timeout_count), 1);
  assert.equal(h.inflight_slots, 4);
  assert.equal(JSON.stringify(h).includes('synthetic'), false);
});

scenario('missing responses recover after thirty seconds, not twenty-nine; stale queued work is removed', async (db) => {
  await ring(db, await seed(db, 3)); await vault(db); await enable(db);
  assert.equal(await tick(db), 1);
  await db.exec("update private.voice_push_wake_slots set started_at=clock_timestamp()-interval '29 seconds' where request_id is not null");
  assert.equal(await tick(db), 0);
  await db.exec("update private.voice_push_wake_slots set started_at=clock_timestamp()-interval '30 seconds' where request_id is not null");
  assert.equal(await tick(db), 1);
  assert.equal(await scalar(db, 'select count(*)::int from net.http_request_queue'), 1);
  assert.equal(Number((await health(db)).wake_http_timeout_count), 1);
});

scenario('stale slots remain occupied if the exact queued request was not removed', async (db) => {
  await ring(db, await seed(db, 3)); await vault(db); await enable(db); await tick(db);
  // A real SQL deletion refusal is the single-backend control; the coordinator
  // separately exercises SKIP LOCKED with a second PG17 connection.
  await db.exec(`create function net.synthetic_keep_request() returns trigger language plpgsql as $$ begin return null; end $$;
    create trigger synthetic_keep_request before delete on net.http_request_queue for each row execute function net.synthetic_keep_request();
    update private.voice_push_wake_slots set started_at=clock_timestamp()-interval '31 seconds' where request_id is not null`);
  assert.equal(await tick(db), 0, 'unremoved stale request lost its admission slot');
  assert.equal(await scalar(db, 'select count(*)::int from net.http_request_queue'), 1);
  assert.equal((await health(db)).inflight_slots, 1);
  await db.exec('drop trigger synthetic_keep_request on net.http_request_queue');
  assert.equal(await tick(db), 1);
});

scenario('health uses the current instant after readiness changes inside the same statement', async (db) => {
  await ring(db, await seed(db, 3));
  await db.exec(`do $$ declare h record; t timestamptz := clock_timestamp(); begin
    update public.voice_ring_push_events set ring_started_at=t,expires_at=t+interval '45 seconds';
    update public.voice_channels set ring_started_at=t where ring_caller is not null;
    update public.voice_ring_push_devices set next_attempt_at=clock_timestamp();
    select * into h from public.voice_push_health();
    if h.ready_count<>3 then raise exception 'health sampled an earlier statement instant'; end if;
  end $$`);
});

scenario('enqueue failure is contained and the next recovery tick can wake within absolute event expiry', async (db) => {
  const chat = await seed(db, 3); await vault(db); await enable(db);
  const original = await scalar(db, "select pg_get_functiondef('net.http_post(text,jsonb,jsonb,jsonb,integer)'::regprocedure)");
  await db.exec(`create or replace function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,
    headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$
    begin raise exception 'synthetic-secret-must-not-propagate'; end $$;`);
  await ring(db, chat);
  assert.equal((await health(db)).inflight_slots, 0);
  assert.equal(Number((await health(db)).wake_http_failure_count), 1);
  await db.exec(original);
  assert.equal(await tick(db), 1);
  assert.equal(await drain(db), 3);
  assert.equal(Number((await health(db)).ready_count), 0);
});

scenario('retry backoff, accepted deduplication and outage beyond expiry stay authoritative', async (db) => {
  await ring(db, await seed(db, 3)); await vault(db); await enable(db);
  const rows = await claim(db, uid(201), 3);
  await complete(db, rows[0]);
  await complete(db, rows[1], 'retry', 4000);
  await complete(db, rows[2], 'retry', 60000);
  assert.equal(await tick(db), 0, 'provider backoff is not ready backlog');
  await db.exec("update public.voice_ring_push_devices set next_attempt_at=clock_timestamp()-interval '1 second' where state='pending'");
  assert.equal(await tick(db), 1);
  assert.equal(await drain(db), 1);
  assert.equal(await scalar(db, "select count(*)::int from public.voice_ring_push_devices where state='accepted'"), 2);
  await ageEvents(db, "interval '46 seconds'");
  assert.equal(await tick(db), 0);
  assert.deepEqual(await claim(db), []);
});

scenario('global admissions count only unexpired leases and completion immediately restores capacity', async (db) => {
  await ring(db, await seed(db)); await enable(db);
  const rows = await claim(db, uid(210), 20);
  assert.equal(rows.length, 16);
  assert.deepEqual(await claim(db, uid(211), 4), []);
  await complete(db, rows[0]);
  assert.equal((await claim(db, uid(212), 4)).length, 1);
  await db.exec("update public.voice_ring_push_devices set claimed_until=clock_timestamp()-interval '1 second' where state='claimed'");
  assert.equal((await claim(db, uid(213), 20)).length, 16);
});

scenario('repeatable-read stale snapshots fail closed instead of bypassing global admission', async (db) => {
  await ring(db, await seed(db)); await enable(db);
  await db.exec('begin isolation level repeatable read');
  assert.deepEqual(await claim(db), []);
  await db.exec('rollback');
});

for (const url of ['https://example.invalid','https://core.letscube.ru.evil.invalid','http://core.letscube.ru','http://kong:8000/other']) {
  scenario(`recovery rejects unapproved origin ${url}`, async (db) => {
    await ring(db, await seed(db, 3)); await vault(db, url); await enable(db);
    assert.equal(await tick(db), 0);
    assert.equal(await scalar(db, 'select count(*)::int from net.http_request_queue'), 0);
  });
}

scenario('cleanup strictly protects the 24-hour boundary and live children; repeat runs are idempotent', async (db) => {
  await ring(db, await seed(db, 3)); await enable(db);
  await db.exec('begin');
  await ageEvents(db, "interval '24 hours'", 'transaction_timestamp()');
  assert.deepEqual((await db.query('select * from private.voice_push_cleanup()')).rows, [{ outcomes_deleted: 0, events_deleted: 0 }]);
  await db.exec("update public.voice_ring_push_events set ring_started_at=ring_started_at-interval '1 microsecond', expires_at=expires_at-interval '1 microsecond'");
  assert.deepEqual((await db.query('select * from private.voice_push_cleanup()')).rows, [{ outcomes_deleted: 3, events_deleted: 2 }]);
  assert.deepEqual((await db.query('select * from private.voice_push_cleanup()')).rows, [{ outcomes_deleted: 0, events_deleted: 0 }]);
  assert.equal(await scalar(db, 'select count(*)::int from public.chats'), 1);
  assert.equal(await scalar(db, 'select count(*)::int from auth.sessions'), 4);
  assert.equal(await scalar(db, 'select count(*)::int from public.user_push_devices'), 5);
  await db.exec('rollback');
});

scenario('cleanup deletes at most five hundred outcomes without cascading residual children', async (db) => {
  await ring(db, await seed(db, 603)); await ageEvents(db, "interval '25 hours'"); await enable(db);
  const first = (await db.query('select * from private.voice_push_cleanup()')).rows[0];
  assert.equal(first.outcomes_deleted, 500);
  assert.equal(await scalar(db, 'select count(*)::int from public.voice_ring_push_devices'), 103);
  const second = (await db.query('select * from private.voice_push_cleanup()')).rows[0];
  assert.equal(second.outcomes_deleted, 103);
  assert.equal(first.events_deleted + second.events_deleted, 2);
});

scenario('cleanup deletes at most five hundred empty expired events and leaves fresh events alone', async (db) => {
  await ring(db, await seed(db, 3));
  await db.exec(`insert into public.voice_ring_push_events(channel_id,chat_id,caller_user_id,recipient_user_id,
    recipient_session_id,ring_started_at,event,expires_at)
    select e.channel_id,e.chat_id,e.caller_user_id,e.recipient_user_id,gen_random_uuid(),
      transaction_timestamp()-interval '25 hours 45 seconds',e.event,transaction_timestamp()-interval '25 hours'
    from (select * from public.voice_ring_push_events limit 1) e cross join generate_series(1,503) n`);
  await enable(db);
  assert.deepEqual((await db.query('select * from private.voice_push_cleanup()')).rows, [{ outcomes_deleted: 0, events_deleted: 500 }]);
  assert.deepEqual((await db.query('select * from private.voice_push_cleanup()')).rows, [{ outcomes_deleted: 0, events_deleted: 3 }]);
  assert.equal(await scalar(db, 'select count(*)::int from public.voice_ring_push_events'), 2);
  assert.equal(await scalar(db, 'select count(*)::int from public.voice_ring_push_devices'), 3);
});

test('rollback restores exact Task3 catalog, ACLs, jobs and data; reapply stays disabled', async () => {
  const db = await database('');
  try {
    const before = await catalog(db);
    await exec(db, source());
    await ring(db, await seed(db));
    const data = (await db.query('select * from public.voice_ring_push_devices order by event_id,push_device_id')).rows;
    await exec(db, source('.rollback'));
    assert.deepEqual(await catalog(db), before);
    assert.deepEqual((await db.query('select * from public.voice_ring_push_devices order by event_id,push_device_id')).rows, data);
    await exec(db, source());
    assert.equal((await health(db)).enabled, false);
  } finally { await db.close(); }
});

scenario('repeat apply and dependent-object rollback fail atomically', async (db) => {
  const before = await catalog(db);
  await assert.rejects(() => exec(db, source()), /already installed|drift/);
  assert.deepEqual(await catalog(db), before);
  await db.exec('create view public.synthetic_operations_dependency as select slot from private.voice_push_wake_slots');
  await assert.rejects(() => exec(db, source('.rollback')), /depend|cannot drop/i);
  assert.equal(await scalar(db, 'select count(*)::int from private.voice_push_wake_slots'), 4);
});

scenario('rollback refuses outstanding wake slots without leaving a partial catalog change', async (db) => {
  await ring(db, await seed(db)); await vault(db); await enable(db); await tick(db);
  await db.exec('update private.voice_push_dispatch_config set enabled=false');
  const before = await catalog(db);
  await assert.rejects(() => exec(db, source('.rollback')), /disabled gate and reconciled slots/);
  assert.deepEqual(await catalog(db), before);
});

scenario('completed slots reconcile once even with no ready backlog', async (db) => {
  await ring(db, await seed(db, 3)); await vault(db); await enable(db); await tick(db);
  await drain(db);
  await db.exec('insert into net._http_response(id,status_code,timed_out) select request_id,200,false from private.voice_push_wake_slots where request_id is not null; delete from net.http_request_queue');
  assert.equal(await tick(db), 0);
  assert.equal(await tick(db), 0);
  assert.equal(Number((await health(db)).wake_http_success_count), 1);
  assert.equal((await health(db)).inflight_slots, 0);
  assert.equal(await scalar(db, 'select count(*)::int from net.http_request_queue'), 0);
});

test('rehearsal requires explicit opt-in, executes SQL assertions and rolls back every fixture and request', async () => {
  const db = await database();
  try {
    const before = await catalog(db);
    await assert.rejects(() => exec(db, source('.rehearsal')), /isolated-schema-copy opt-in/);
    await db.exec("set letscube.task5.isolated_schema_copy='yes'");
    await exec(db, source('.rehearsal'));
    assert.deepEqual(await catalog(db), before);
    for (const table of ['auth.users','auth.sessions','public.chats','public.voice_ring_push_events',
      'public.voice_ring_push_devices','net.http_request_queue','vault.decrypted_secrets']) {
      assert.equal(await scalar(db, `select count(*)::int from ${table}`), 0);
    }
    assert.equal((await health(db)).enabled, false);
    assert.equal((await health(db)).inflight_slots, 0);
  } finally { await db.close(); }
});

test('manual proposal and companions stay outside CLI discovery with byte-identical backup copies', () => {
  for (const suffix of ['', '.rollback', '.rehearsal']) {
    assert.equal(existsSync(new URL(`../../supabase/migrations/${stem}${suffix}.sql`, import.meta.url)), false);
    assert.deepEqual(readFileSync(new URL(`../../supabase/migration-proposals/${stem}${suffix}.sql`, import.meta.url)),
      readFileSync(new URL(`../../.migration-backup/supabase/migrations/${stem}${suffix}.sql`, import.meta.url)));
  }
});

const mutations = [
  {
    name: 'global cap sixteen', from: 'v_limit := least(v_limit, 16 - v_live);', to: 'v_limit := least(v_limit, 32 - v_live);',
    oracle: async (db) => {
      await ring(db, await seed(db)); await enable(db);
      for (let i = 0; i < 4; i++) await claim(db, uid(800 + i), 4);
      assert.deepEqual(await claim(db, uid(810), 4), [], 'global cap lost');
    }, error: /global cap lost/,
  },
  {
    name: 'tick disabled gate',
    from: 'if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return 0; end if;', to: '',
    oracle: async (db) => {
      await ring(db, await seed(db, 3)); await vault(db);
      assert.equal(await tick(db), 0, 'disabled tick queued');
    }, error: /disabled tick queued/,
  },
  {
    name: 'cleanup disabled gate',
    from: 'if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return next; return; end if;', to: '',
    oracle: async (db) => {
      await ring(db, await seed(db, 3)); await ageEvents(db, "interval '25 hours'");
      assert.equal((await db.query('select * from private.voice_push_cleanup()')).rows[0].outcomes_deleted, 0, 'disabled cleanup purged');
    }, error: /disabled cleanup purged/,
  },
  {
    name: 'stale slot deadline thirty seconds', from: "v_now - interval '30 seconds'", to: "v_now - interval '31 seconds'",
    oracle: async (db) => {
      await ring(db, await seed(db, 3)); await vault(db); await enable(db); await tick(db);
      await db.exec("update private.voice_push_wake_slots set started_at=clock_timestamp()-interval '30.1 seconds' where request_id is not null");
      assert.equal(await tick(db), 1, 'stale slot stranded');
    }, error: /stale slot stranded/,
  },
  {
    name: 'actual response error presence', from: 'elsif not v_response.has_error and v_response.status_code between 200 and 299',
    to: 'elsif v_response.status_code between 200 and 299',
    oracle: async (db) => {
      await ring(db, await seed(db, 3)); await vault(db); await enable(db); await tick(db);
      await db.exec("insert into net._http_response(id,status_code,timed_out,error_msg) select request_id,200,false,'synthetic' from private.voice_push_wake_slots where request_id is not null; delete from net.http_request_queue");
      await tick(db);
      assert.equal(Number((await health(db)).wake_http_success_count), 0, 'error response classified success');
    }, error: /error response classified success/,
  },
  {
    name: 'HTTP status classification', from: 'v_response.status_code between 200 and 299', to: 'v_response.status_code between 200 and 599',
    oracle: async (db) => {
      await ring(db, await seed(db, 3)); await vault(db); await enable(db); await tick(db);
      await db.exec('insert into net._http_response(id,status_code,timed_out) select request_id,503,false from private.voice_push_wake_slots where request_id is not null; delete from net.http_request_queue');
      await tick(db);
      assert.equal(Number((await health(db)).wake_http_failure_count), 1, '503 was acknowledged as success');
    }, error: /503 was acknowledged as success/,
  },
  {
    name: 'HTTP timeout classification', from: 'if coalesce(v_response.timed_out,false) then', to: 'if false then',
    oracle: async (db) => {
      await ring(db, await seed(db, 3)); await vault(db); await enable(db); await tick(db);
      await db.exec('insert into net._http_response(id,status_code,timed_out) select request_id,null,true from private.voice_push_wake_slots where request_id is not null; delete from net.http_request_queue');
      await tick(db);
      assert.equal(Number((await health(db)).wake_http_timeout_count), 1, 'timeout misclassified');
    }, error: /timeout misclassified/,
  },
  {
    name: 'bounded HTTP timeout', from: 'timeout_milliseconds := 25000', to: 'timeout_milliseconds := 1000',
    oracle: async (db) => {
      await ring(db, await seed(db, 3)); await vault(db); await enable(db); await tick(db);
      assert.equal(await scalar(db, 'select timeout_ms from net.requests limit 1'), 25000, 'HTTP ended before drain budget');
    }, error: /HTTP ended before drain budget/,
  },
  {
    name: 'exact per-request twenty-claim body', from: 'body := \'{"scope":"voice","limit":20}\'::jsonb', to: 'body := \'{"scope":"voice","limit":40}\'::jsonb',
    oracle: async (db) => {
      await ring(db, await seed(db, 3)); await vault(db); await enable(db); await tick(db);
      assert.deepEqual(await scalar(db, 'select body from net.requests limit 1'), { scope: 'voice', limit: 20 }, 'request body widened');
    }, error: /request body widened/,
  },
  {
    name: 'retry backoff in wake predicate', from: "d.state='pending' and d.next_attempt_at <= v_now", to: "d.state='pending'",
    oracle: async (db) => {
      await ring(db, await seed(db, 3)); await vault(db); await enable(db);
      for (const row of await claim(db)) await complete(db, row, 'retry', 20000);
      assert.equal(await tick(db), 0, 'backoff caused wake');
    }, error: /backoff caused wake/,
  },
  {
    name: 'retention strict older-than boundary', from: 'where e.expires_at < v_cutoff order by', to: 'where e.expires_at <= v_cutoff order by',
    oracle: async (db) => {
      await ring(db, await seed(db, 3)); await enable(db); await db.exec('begin');
      await ageEvents(db, "interval '24 hours'", 'transaction_timestamp()');
      assert.equal((await db.query('select * from private.voice_push_cleanup()')).rows[0].outcomes_deleted, 0, 'fresh boundary purged');
    }, error: /fresh boundary purged/,
  },
  {
    name: 'retention 500-outcome bound', from: 'limit 500 for update of d skip locked', to: 'limit 501 for update of d skip locked',
    oracle: async (db) => {
      await ring(db, await seed(db, 603)); await ageEvents(db, "interval '25 hours'"); await enable(db);
      assert.equal((await db.query('select * from private.voice_push_cleanup()')).rows[0].outcomes_deleted, 500, 'outcome deletion bound exceeded');
    }, error: /outcome deletion bound exceeded/,
  },
  {
    name: 'retention child safeguards never cascade residual children',
    from: 'and not exists (select 1 from public.voice_ring_push_devices d where d.event_id=e.id)', to: '',
    alsoFrom: 'and not exists (select 1 from public.voice_ring_push_devices child where child.event_id=e.id)',
    oracle: async (db) => {
      await ring(db, await seed(db, 603)); await ageEvents(db, "interval '25 hours'"); await enable(db);
      await db.query('select * from private.voice_push_cleanup()');
      assert.equal(await scalar(db, 'select count(*)::int from public.voice_ring_push_devices'), 103, 'parent cascaded residual children');
    }, error: /parent cascaded residual children/,
  },
  { name: 'health public ACL', from: 'revoke all on function public.voice_push_health() from public, anon, authenticated;', to: '', error: /function owner\/security\/ACL self-check/ },
  { name: 'private table RLS', from: 'alter table private.voice_push_wake_slots enable row level security;', to: '', error: /private table owner\/RLS\/ACL self-check/ },
  { name: 'inactive recovery schedule', from: "'select private.voice_push_tick();',current_database(),'supabase_admin',false)",
    to: "'select private.voice_push_tick();',current_database(),'supabase_admin',true)", error: /inactive schedules\/service RPC self-check/ },
];
for (const mutation of mutations) {
  test(`mutation killed: ${mutation.name}`, async () => {
    const sql = source();
    assert.equal(sql.split(mutation.from).length - 1, 1, 'mutation must match exactly one site');
    let changed = sql.replace(mutation.from, mutation.to);
    if (mutation.alsoFrom) {
      assert.equal(changed.split(mutation.alsoFrom).length - 1, 1, 'paired guard mutation must match exactly one site');
      changed = changed.replace(mutation.alsoFrom, '');
    }
    if (mutation.oracle) {
      const db = await database(changed);
      try { await assert.rejects(() => mutation.oracle(db), mutation.error); }
      finally { await db.close(); }
    } else {
      const db = await database('');
      try {
        const before = await catalog(db);
        await assert.rejects(() => exec(db, changed), mutation.error);
        assert.deepEqual(await catalog(db), before, 'self-check failure leaked catalog changes');
      } finally { await db.close(); }
    }
  });
}
}

async function ageEvents(db, interval, clock = 'clock_timestamp()') {
  await db.exec(`update public.voice_ring_push_events set ring_started_at=${clock}-${interval}-interval '45 seconds', expires_at=${clock}-${interval}`);
}
async function catalog(db) {
  return {
    functions: (await db.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,
      pg_get_functiondef(p.oid) as definition,p.proowner::regrole::text as owner,p.proacl::text as acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.prokind='f' order by 1,2,3`)).rows,
    relations: (await db.query(`select n.nspname,c.relname,c.relkind,c.relowner::regrole::text as owner,c.relacl::text as acl,
      c.relrowsecurity,case when c.relkind='i' then pg_get_indexdef(c.oid) end as indexdef,
      obj_description(c.oid,'pg_class') as comment from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private','net') order by 1,2`)).rows,
    triggers: (await db.query("select tgname,pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal order by tgname")).rows,
    cron: (await db.query('select * from cron.job order by jobid')).rows,
  };
}
