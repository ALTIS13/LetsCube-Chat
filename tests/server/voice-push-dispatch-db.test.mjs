import assert from 'node:assert/strict';
import test from 'node:test';
import { database, setup, ring, enable, claim, prepare, complete, outcomes, events, asUser, service, exec, sql, A, B, C, uid, claimId } from '../helpers/voice-push-dispatch-fixture.mjs';

test('Task 3 starts disabled; service claims require the owner gate and prepare returns the exact live binding', async () => {
  const db = await database();
  try {
    const chat = await setup(db);
    await ring(db, chat);
    assert.equal((await db.query("select to_regprocedure('public.voice_push_claim(integer,uuid)')::text as rpc")).rows[0].rpc,
      'voice_push_claim(integer,uuid)', 'Task 2 has captured rows but no gated claim RPC');
    assert.deepEqual(await claim(db), []);
    assert.ok((await outcomes(db)).every((r) => r.attempts === 0));
    await enable(db);
    const claims = await claim(db);
    assert.equal(claims.length, 3);
    const prepared = await prepare(db, claims[0]);
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].protocol_version, 1);
    assert.equal(prepared[0].event, 'ring');
    assert.equal(await complete(db, claims[0]), true);
    assert.deepEqual(await prepare(db, claims[0]), []);
  } finally { await db.close(); }
});

function scenario(name, run) {
  test(name, async () => {
    const db = await database();
    try { await run(db, await setup(db)); }
    finally { await db.close(); }
  });
}
const stop = (db, room) => asUser(db, A, 'select public.voice_call_stop($1, $2)', [room, 'cancelled']);
const wakeCount = async (db) => (await db.query('select count(*)::int as n from net.requests')).rows[0].n;
const rowState = async (db, row) => (await db.query(`select * from public.voice_ring_push_devices
  where event_id = $1 and push_device_id = $2`, [row.event_id, row.push_device_id])).rows[0];
async function expireLease(db, row) {
  await db.query(`update public.voice_ring_push_devices set claimed_until = clock_timestamp() - interval '1 second'
    where event_id = $1 and push_device_id = $2`, [row.event_id, row.push_device_id]);
}
async function ready(db, row) {
  await db.query(`update public.voice_ring_push_devices set next_attempt_at = clock_timestamp() - interval '1 second'
    where event_id = $1 and push_device_id = $2`, [row.event_id, row.push_device_id]);
}
async function syntheticVault(db, url = 'http://kong:8000') {
  await db.query(`insert into vault.decrypted_secrets(name, decrypted_secret) values
    ('kub_project_url', $1), ('kub_push_dispatch_token', 'synthetic-dispatch-auth')`, [url]);
}

scenario('the disabled gate avoids Vault/net entirely, including when those schemas do not exist', async (db, chat) => {
  await db.exec('alter schema vault rename to synthetic_hidden_vault; alter schema net rename to synthetic_hidden_net');
  await ring(db, chat);
  assert.equal((await outcomes(db)).length, 3);
  assert.deepEqual(await claim(db), []);
  assert.equal((await db.query('select count(*)::int as n from synthetic_hidden_net.requests')).rows[0].n, 0);
});

scenario('gate off after claim returns no prepare token and cannot acknowledge or wake', async (db, chat) => {
  await ring(db, chat);
  await enable(db);
  const [row] = await claim(db);
  await db.exec('update private.voice_push_dispatch_config set enabled = false');
  assert.deepEqual(await prepare(db, row), []);
  assert.equal(await complete(db, row), false);
  assert.equal((await rowState(db, row)).state, 'claimed');
});

async function assertPrepareDeviceLock(db, chat) {
  await ring(db, chat);
  await enable(db);
  const [row] = await claim(db);
  await db.exec('begin');
  try {
    assert.equal((await prepare(db, row)).length, 1);
    const locks = (await db.query(`select mode from pg_locks where pid = pg_backend_pid()
      and relation = 'public.user_push_devices'::regclass and granted`)).rows.map((r) => r.mode);
    assert.ok(locks.includes('RowShareLock'), 'prepare must hold the device row-lock relation lock through token projection');
  } finally { await db.exec('rollback; set role supabase_admin'); }
}

scenario('prepare retains the device lock through DTO projection until transaction end', assertPrepareDeviceLock);

test('mutation killed: removing the prepare device lock exposes the binding-to-token race', async () => {
  const source = sql();
  const from = 'perform 1 from public.user_push_devices where id = p_push_device_id for share;';
  assert.equal(source.split(from).length - 1, 1);
  const db = await database(source.replace(from, 'perform 1 from public.user_push_devices where id = p_push_device_id;'));
  try {
    const chat = await setup(db);
    await assert.rejects(() => assertPrepareDeviceLock(db, chat), /prepare must hold the device row-lock/);
  } finally { await db.close(); }
});

scenario('RPC names, arguments, result fields and protocol are the agreed PostgREST boundary', async (db, chat) => {
  await ring(db, chat);
  await enable(db);
  const [row] = await claim(db);
  assert.deepEqual(Object.keys(row).sort(), ['claim_id', 'event_id', 'push_device_id']);
  const [payload] = await prepare(db, row);
  assert.deepEqual(Object.keys(payload).sort(), ['event_id', 'push_device_id', 'claim_id', 'protocol_version', 'event',
    'chat_id', 'channel_id', 'caller_id', 'recipient_id', 'recipient_session_id', 'ring_started_at', 'expires_at', 'claimed_until', 'token', 'token_hash'].sort());
  assert.equal(payload.protocol_version, 1);
  assert.equal(payload.recipient_id, B);
  assert.equal(payload.caller_id, A);
  assert.equal(payload.chat_id, chat);
  assert.ok(payload.claimed_until <= payload.expires_at);
  const args = (await db.query(`select proname, proargnames from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('voice_push_claim','voice_push_prepare','voice_push_complete') order by proname`)).rows;
  assert.deepEqual(args.map((r) => [r.proname, r.proargnames.slice(0, r.proname === 'voice_push_claim' ? 2 : r.proname === 'voice_push_prepare' ? 3 : 6)]), [
    ['voice_push_claim', ['p_limit', 'p_claim_id']],
    ['voice_push_complete', ['p_event_id', 'p_push_device_id', 'p_claim_id', 'p_result', 'p_retry_after_ms', 'p_token_hash']],
    ['voice_push_prepare', ['p_event_id', 'p_push_device_id', 'p_claim_id']],
  ]);
});

scenario('a claim uses 15 seconds, never duplicates an unexpired lease, and prepare never increments attempts', async (db, chat) => {
  await ring(db, chat);
  await enable(db);
  const claims = await claim(db);
  assert.deepEqual(await claim(db, uid(102)), []);
  for (const row of claims) {
    assert.equal((await rowState(db, row)).claimed_until - (await rowState(db, row)).last_attempt_at, 15000);
    assert.equal((await rowState(db, row)).attempts, 1);
    assert.equal((await prepare(db, row)).length, 1);
    assert.equal((await prepare(db, row)).length, 1);
    assert.equal((await rowState(db, row)).attempts, 1);
  }
});

scenario('lease cap follows absolute expiry, including a nearly expired generation', async (db, chat) => {
  const { channel_id: room } = await ring(db, chat);
  await db.exec('alter table public.voice_channels disable trigger trg_voice_ring_push_capture');
  await db.query("update public.voice_channels set ring_started_at = ring_started_at - interval '40 seconds' where id = $1", [room]);
  await db.exec(`update public.voice_ring_push_events set ring_started_at = ring_started_at - interval '40 seconds',
    expires_at = expires_at - interval '40 seconds'; alter table public.voice_channels enable trigger trg_voice_ring_push_capture`);
  await enable(db);
  const [row] = await claim(db);
  const [payload] = await prepare(db, row);
  assert.equal(+payload.claimed_until, +payload.expires_at);
  assert.ok(payload.claimed_until - (await rowState(db, row)).last_attempt_at < 5000);
});

scenario('claim is bounded to twenty and clamps a nonpositive limit to one', async (db, chat) => {
  for (let i = 30; i < 60; i++) {
    await db.query(`insert into public.user_push_devices(id,user_id,platform,provider,token,token_hash,session_id,voice_call_protocol)
      values ($1,$2,'android','fcm',$3,$3,$4,1)`, [uid(i), B, `synthetic-${i}`, uid(12)]);
  }
  await ring(db, chat);
  await enable(db);
  assert.equal((await claim(db, uid(102), 100000)).length, 20);
  assert.equal((await claim(db, uid(103), 0)).length, 1);
  await assert.rejects(() => claim(db, null), /voice_push_bad_claim/);
});

scenario('expired lease can be reclaimed, but an old or duplicate claim cannot prepare/complete', async (db, chat) => {
  await ring(db, chat);
  await enable(db);
  const [old] = await claim(db);
  await expireLease(db, old);
  assert.deepEqual(await prepare(db, old), []);
  assert.equal(await complete(db, old), false);
  const [next] = await claim(db, uid(102));
  assert.equal(next.event_id, old.event_id);
  assert.equal(next.push_device_id, old.push_device_id);
  assert.equal((await rowState(db, next)).attempts, 2);
  assert.deepEqual(await prepare(db, old), []);
  assert.equal(await complete(db, old), false);
  assert.equal(await complete(db, next), true);
  assert.equal(await complete(db, next), false);
  assert.equal((await rowState(db, next)).state, 'accepted');
});

scenario('SQL owns literal 2s then 4s exponential retries and terminalizes the third attempt', async (db, chat) => {
  await ring(db, chat);
  await enable(db);
  let [row] = await claim(db);
  for (const [attempt, delay] of [[1, 2000], [2, 4000]]) {
    assert.equal(await complete(db, row, 'retry', attempt === 1 ? null : 1000), true);
    const state = await rowState(db, row);
    assert.equal(state.attempts, attempt);
    assert.equal(state.state, 'pending');
    assert.equal(state.next_attempt_at - state.updated_at, delay);
    assert.deepEqual(await claim(db, uid(110 + attempt)), [], 'not ready before backoff');
    await ready(db, row);
    [row] = await claim(db, uid(120 + attempt));
  }
  assert.equal(await complete(db, row, 'retry'), true);
  assert.equal((await rowState(db, row)).state, 'terminal');
  assert.equal((await rowState(db, row)).attempts, 3);
  assert.deepEqual(await claim(db, uid(150)), []);
});

scenario('provider Retry-After wins over backoff; a 60s/429 delay never gets shortened to fit a 45s ring', async (db, chat) => {
  await ring(db, chat);
  await enable(db);
  const [row, other] = await claim(db);
  assert.equal(await complete(db, row, 'retry', 7000), true);
  let state = await rowState(db, row);
  assert.equal(state.next_attempt_at - state.updated_at, 7000);
  assert.equal(await complete(db, other, 'retry', 60000), true);
  state = await rowState(db, other);
  assert.equal(state.state, 'terminal');
  assert.equal(state.claim_id, null);
});

scenario('attempt three is not reclaimed after a lost response; accepted/terminal rows are never claimed', async (db, chat) => {
  await ring(db, chat);
  await enable(db);
  const [row, accepted, discarded] = await claim(db);
  await db.query('update public.voice_ring_push_devices set attempts = 3 where event_id=$1 and push_device_id=$2', [row.event_id, row.push_device_id]);
  await expireLease(db, row);
  await complete(db, accepted);
  await complete(db, discarded, 'discarded');
  assert.deepEqual(await claim(db, uid(105)), []);
});

scenario('an expired event is never claimed and an exact expired prepare terminalizes it, not a newer lease', async (db, chat) => {
  await ring(db, chat);
  await enable(db);
  const [row] = await claim(db);
  await expireLease(db, row);
  await db.query("update public.voice_ring_push_events set expires_at = ring_started_at + interval '0.001 seconds' where id=$1", [row.event_id]);
  assert.deepEqual(await prepare(db, { ...row, claim_id: uid(199) }), []);
  assert.equal((await rowState(db, row)).state, 'claimed', 'wrong claim cannot modify an outcome');
  assert.deepEqual(await prepare(db, row), []);
  assert.equal((await rowState(db, row)).state, 'terminal');
  assert.equal(await complete(db, row), false);
  assert.deepEqual(await claim(db, uid(106)), []);
});

scenario('cancel is prioritized and retains the old generation after a new ring starts; old ack cannot revive a ring', async (db, chat) => {
  const { channel_id: room } = await ring(db, chat);
  await enable(db);
  const [old] = await claim(db);
  await stop(db, room);
  await ring(db, chat);
  assert.equal(await complete(db, old, 'invalid_token', null, 'synthetic-device-22'), false);
  assert.deepEqual(await prepare(db, old), []);
  const [cancel] = await claim(db, uid(103), 1);
  assert.equal((await prepare(db, cancel))[0].event, 'cancel');
  assert.equal(await complete(db, cancel), true);
  assert.equal((await rowState(db, old)).state, 'terminal');
});

const invalidations = [
  ['session deleted', `delete from auth.sessions where id = '${uid(12)}'`],
  ['session expired', `update auth.sessions set not_after = clock_timestamp() where id = '${uid(12)}'`],
  ['session ownership changed', `update auth.sessions set user_id = '${C}' where id = '${uid(12)}'`],
  ['device rebound', `update public.user_push_devices set user_id = '${C}', session_id = '${uid(14)}' where session_id = '${uid(12)}'`],
  ['device disabled', `update public.user_push_devices set enabled = false where session_id = '${uid(12)}'`],
  ['device revoked', `update public.user_push_devices set revoked_at = clock_timestamp() where session_id = '${uid(12)}'`],
  ['capability withdrawn', `update public.user_push_devices set voice_call_protocol = null where session_id = '${uid(12)}'`],
  ['device no longer Android', `update public.user_push_devices set platform = 'ios' where session_id = '${uid(12)}'`],
  ['device no longer FCM', `update public.user_push_devices set provider = 'apns' where session_id = '${uid(12)}'`],
  ['calls disabled', `insert into public.user_session_settings(session_id,user_id,calls_enabled) values ('${uid(12)}','${B}',false)`],
];
for (const [label, change] of invalidations) {
  scenario(`claim and prepare share eligibility: ${label}`, async (db, chat) => {
    await ring(db, chat);
    await enable(db);
    const claims = await claim(db);
    await db.exec(change);
    for (const row of claims) {
      const valid = row.push_device_id === uid(24);
      assert.equal((await prepare(db, row)).length, valid ? 1 : 0);
      assert.equal((await rowState(db, row)).state, valid ? 'claimed' : 'terminal');
      if (valid) await expireLease(db, row);
    }
    const remaining = await claim(db, uid(103));
    assert.deepEqual(remaining.map((r) => r.push_device_id), [uid(24)]);
  });
}

for (const [label, change] of [
  ['caller left', `delete from public.chat_members where user_id = '${A}'`],
  ['recipient left', `delete from public.chat_members where user_id = '${B}'`],
  ['recipient muted', `insert into public.mutes(user_id) values ('${B}')`],
  ['caller banned', `insert into public.bans(user_id) values ('${A}')`],
  ['recipient blocked caller', `insert into public.user_blocks values ('${B}', '${A}')`],
  ['caller blocked recipient', `insert into public.user_blocks values ('${A}', '${B}')`],
]) {
  scenario(`prepare terminalizes captured rows when ${label}`, async (db, chat) => {
    await ring(db, chat);
    await enable(db);
    const claims = await claim(db);
    await db.exec(change);
    for (const row of claims) assert.deepEqual(await prepare(db, row), []);
    assert.ok((await outcomes(db)).every((r) => r.state === 'terminal'));
  });
}

scenario('fresh sessions and mutes in another chat remain eligible at send time', async (db, chat) => {
  await ring(db, chat);
  await db.exec('update auth.sessions set refreshed_at = null');
  const other = (await db.query("insert into public.chats(type) values ('group') returning id")).rows[0].id;
  await db.query('insert into public.mutes(user_id,chat_id) values ($1,$2)', [B, other]);
  await enable(db);
  const claims = await claim(db);
  assert.equal(claims.length, 3);
  assert.equal((await prepare(db, claims[0])).length, 1);
});

scenario('an invalid-token response revokes only the current opaque token hash for that binding', async (db, chat) => {
  await ring(db, chat);
  await enable(db);
  const [row] = await claim(db);
  const [payload] = await prepare(db, row);
  assert.equal(await complete(db, row, 'invalid_token', null, payload.token_hash), true);
  const device = (await db.query('select enabled, revoked_at from public.user_push_devices where id=$1', [row.push_device_id])).rows[0];
  assert.equal(device.enabled, false);
  assert.ok(device.revoked_at);
});

for (const mode of ['rotation', 'rebind']) {
  scenario(`old invalid-token response cannot revoke a ${mode}`, async (db, chat) => {
    await ring(db, chat);
    await enable(db);
    const [row] = await claim(db);
    const [payload] = await prepare(db, row);
    if (mode === 'rotation') {
      await db.query("update public.user_push_devices set token='synthetic-rotated', token_hash='opaque-rotated' where id=$1", [row.push_device_id]);
    } else {
      await db.query('update public.user_push_devices set user_id=$2, session_id=$3 where id=$1', [row.push_device_id, C, uid(14)]);
    }
    assert.equal(await complete(db, row, 'invalid_token', null, payload.token_hash), mode === 'rotation');
    const device = (await db.query('select enabled, revoked_at from public.user_push_devices where id=$1', [row.push_device_id])).rows[0];
    assert.equal(device.enabled, true);
    assert.equal(device.revoked_at, null);
  });
}

scenario('permissions admit service RPCs only, deny spoofed client claims and direct service mutations/config', async (db, chat) => {
  await ring(db, chat);
  for (const role of ['anon','authenticated']) {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: 'service_role', sub: B })]);
    await db.exec(`set role ${role}`);
    await assert.rejects(() => db.query('select * from public.voice_push_claim(1,$1)', [claimId]), /permission denied/);
    await db.exec('reset role; set role supabase_admin');
  }
  for (const command of [
    "update public.voice_ring_push_devices set state='terminal', claim_id=null, claimed_until=null",
    "update public.voice_ring_push_events set state='terminal', terminal_at=now()",
    'update private.voice_push_dispatch_config set enabled=true',
    'select * from private.voice_push_dispatch_config',
    'select private.voice_push_eligible(null,null,now())',
  ]) await assert.rejects(() => service(db, command), /permission denied/);
  assert.equal((await service(db, 'select count(*)::int as n from public.voice_ring_push_events')).rows[0].n, 2);
});

scenario('enabled wake is one statement-level transactional request after all target rows exist', async (db, chat) => {
  await syntheticVault(db);
  await enable(db);
  await db.exec('begin');
  await ring(db, chat);
  assert.equal(await wakeCount(db), 1);
  const request = (await db.query('select url, body, headers, timeout_ms from net.requests')).rows[0];
  assert.equal(request.url, 'http://kong:8000/functions/v1/send-push-notifications');
  assert.deepEqual(request.body, { scope: 'voice', limit: 20 });
  assert.deepEqual(request.headers, { 'Content-Type': 'application/json', 'x-kub-push-token': 'synthetic-dispatch-auth' });
  assert.equal(request.timeout_ms, 25000);
  await db.exec('rollback; set role supabase_admin');
  assert.equal(await wakeCount(db), 0);
  assert.equal((await outcomes(db)).length, 0);
});

scenario('cancel wake follows inserted outcomes; a duplicate stop creates no extra request', async (db, chat) => {
  await syntheticVault(db, 'https://core.letscube.ru');
  await enable(db);
  const { channel_id: room } = await ring(db, chat);
  await stop(db, room);
  await stop(db, room);
  assert.equal(await wakeCount(db), 2);
});

for (const url of ['https://example.invalid', 'https://core.letscube.ru.evil.invalid', 'http://core.letscube.ru', 'http://kong:8000/other']) {
  scenario(`wake rejects non-allowlisted base URL: ${url}`, async (db, chat) => {
    await syntheticVault(db, url);
    await enable(db);
    await ring(db, chat);
    assert.equal(await wakeCount(db), 0);
    assert.equal((await outcomes(db)).length, 3);
  });
}

scenario('missing/duplicate Vault secrets or a net exception never abort the authoritative ring', async (db, chat) => {
  await enable(db);
  const { channel_id: room } = await ring(db, chat);
  assert.equal(await wakeCount(db), 0);
  await syntheticVault(db);
  await db.exec("insert into vault.decrypted_secrets values ('kub_project_url','http://kong:8000')");
  await stop(db, room);
  assert.equal(await wakeCount(db), 0);
  await db.exec("delete from vault.decrypted_secrets where ctid not in (select min(ctid) from vault.decrypted_secrets group by name)");
  await db.exec(`create or replace function net.http_post(url text, body jsonb default '{}'::jsonb,
    params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
    returns bigint language plpgsql as $$ begin raise exception 'synthetic secret-bearing error: MUST NOT PROPAGATE'; end $$`);
  await ring(db, chat);
  assert.equal((await events(db)).filter((e) => e.state === 'pending' && e.event === 'ring').length, 2);
});

async function task2Shape(db) {
  const functions = (await db.query(`select p.oid::regprocedure::text as name, md5(pg_get_functiondef(p.oid)) as definition, p.proacl::text as acl
    from pg_proc p where p.pronamespace in ('public'::regnamespace,'private'::regnamespace)
      and p.prokind = 'f' and p.proname not like 'voice_push_%' order by name`)).rows;
  const tables = (await db.query(`select c.relname, c.relowner::regrole::text as owner, c.relacl::text as acl, c.relrowsecurity,
      a.attname, a.attacl::text as column_acl
    from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where c.oid in ('public.voice_ring_push_events'::regclass,'public.voice_ring_push_devices'::regclass,
      'public.user_push_devices'::regclass) order by c.relname,a.attnum`)).rows;
  const triggers = (await db.query(`select tgname, md5(pg_get_triggerdef(oid)) as definition from pg_trigger
    where not tgisinternal and tgname <> 'trg_voice_push_wake' order by tgname`)).rows;
  const privateAcl = (await db.query("select nspowner::regrole::text as owner,nspacl::text as acl from pg_namespace where nspname='private'")).rows;
  return { functions, tables, triggers, privateAcl };
}

test('rollback restores exact Task 2 definitions, owners, table/column/private ACLs and preserves outcome data', async () => {
  const db = await database('');
  try {
    const before = await task2Shape(db);
    const chat = await setup(db);
    await exec(db, sql());
    await ring(db, chat);
    await enable(db);
    const [row] = await claim(db);
    await complete(db, row);
    const beforeRollback = await outcomes(db);
    await exec(db, sql('.rollback'));
    assert.deepEqual(await task2Shape(db), before);
    assert.deepEqual(await outcomes(db), beforeRollback);
    assert.equal((await db.query("select to_regclass('private.voice_push_dispatch_config') as t")).rows[0].t, null);
    await exec(db, sql());
    assert.deepEqual(await claim(db), [], 'reapply returns to disabled, not prior enabled state');
  } finally { await db.close(); }
});

scenario('repeat refusal and dependent-object rollback refusal are atomic', async (db, chat) => {
  await ring(db, chat);
  const before = await outcomes(db);
  await assert.rejects(() => exec(db, sql()), /already installed or object drift/);
  assert.deepEqual(await outcomes(db), before);
  await db.exec('create view public.synthetic_dispatch_dependency as select enabled from private.voice_push_dispatch_config');
  await assert.rejects(() => exec(db, sql('.rollback')), /depend|cannot drop/i);
  await enable(db);
  assert.equal((await claim(db)).length, 3);
});

const mutations = [
  {
    name: 'claim disabled gate',
    from: "if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return; end if;\n  if p_claim_id is null",
    to: 'if p_claim_id is null',
    oracle: async (db, chat) => { await ring(db, chat); assert.deepEqual(await claim(db), [], 'disabled gate admitted claims'); },
    error: /disabled gate admitted claims/,
  },
  {
    name: 'wake disabled gate',
    from: 'if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return null; end if;', to: '',
    oracle: async (db, chat) => { await syntheticVault(db); await ring(db, chat); assert.equal(await wakeCount(db), 0, 'disabled gate queued wake'); },
    error: /disabled gate queued wake/,
  },
  {
    name: 'voice capability', from: "and device.platform = 'android' and device.provider = 'fcm' and device.voice_call_protocol = 1\n       and device.enabled",
    to: "and device.platform = 'android' and device.provider = 'fcm'\n       and device.enabled",
    oracle: async (db, chat) => {
      await ring(db, chat); await enable(db);
      await db.exec('update public.user_push_devices set voice_call_protocol = null');
      assert.deepEqual(await claim(db), [], 'withdrawn capability admitted');
    }, error: /withdrawn capability admitted/,
  },
  {
    name: 'event expiry', from: 'and e.ring_started_at <= p_now and e.expires_at > p_now', to: 'and e.ring_started_at <= p_now',
    oracle: async (db, chat) => {
      await ring(db, chat); await enable(db); const [row] = await claim(db);
      await db.query("update public.voice_ring_push_events set expires_at=ring_started_at+interval '0.001 seconds' where id=$1", [row.event_id]);
      assert.deepEqual(await prepare(db, row), [], 'expired event exposed a token');
    }, error: /expired event exposed a token/,
  },
  {
    name: 'completion claim CAS',
    from: "if not found or v_claim.state <> 'claimed' or v_claim.claim_id is distinct from p_claim_id\n     or v_claim.claimed_until <= v_now then return false; end if;",
    to: "if not found or v_claim.state <> 'claimed' or v_claim.claimed_until <= v_now then return false; end if;",
    oracle: async (db, chat) => {
      await ring(db, chat); await enable(db); const [row] = await claim(db);
      assert.equal(await complete(db, { ...row, claim_id: uid(999) }), false, 'wrong claim acknowledged');
    }, error: /wrong claim acknowledged/,
  },
  {
    name: 'invalid-token hash CAS', from: 'where device.id = p_push_device_id and device.token_hash = p_token_hash', to: 'where device.id = p_push_device_id',
    oracle: async (db, chat) => {
      await ring(db, chat); await enable(db); const [row] = await claim(db); const [payload] = await prepare(db, row);
      await db.query("update public.user_push_devices set token_hash='opaque-rotation' where id=$1", [row.push_device_id]);
      await complete(db, row, 'invalid_token', null, payload.token_hash);
      assert.equal((await db.query('select enabled from public.user_push_devices where id=$1', [row.push_device_id])).rows[0].enabled,
        true, 'rotated token revoked');
    }, error: /rotated token revoked/,
  },
  {
    name: 'public RPC permission', from: 'revoke all on function public.voice_push_prepare(uuid, uuid, uuid) from public, anon, authenticated;', to: '',
    error: /function owner\/security\/ACL self-check/,
  },
  {
    name: 'direct service mutation permission',
    from: 'revoke update (state, attempts, next_attempt_at, claim_id, claimed_until, last_attempt_at, updated_at)\n  on public.voice_ring_push_devices from service_role;', to: '',
    error: /direct service write privilege self-check/,
  },
  {
    name: 'exponential second retry', from: '2000 * (1 << greatest(v_claim.attempts - 1, 0))', to: '2000',
    oracle: async (db, chat) => {
      await ring(db, chat); await enable(db); let [row] = await claim(db);
      await complete(db, row, 'retry'); await ready(db, row); [row] = await claim(db, uid(102));
      await complete(db, row, 'retry'); const state = await rowState(db, row);
      assert.equal(state.next_attempt_at - state.updated_at, 4000, 'second retry lost exponential backoff');
    }, error: /second retry lost exponential backoff/,
  },
  {
    name: 'bounded drain wake timeout', from: 'timeout_milliseconds := 25000', to: 'timeout_milliseconds := 1000',
    oracle: async (db, chat) => {
      await syntheticVault(db); await enable(db); await ring(db, chat);
      assert.equal((await db.query('select timeout_ms from net.requests')).rows[0].timeout_ms, 25000, 'wake ended before bounded drain');
    }, error: /wake ended before bounded drain/,
  },
];
for (const mutation of mutations) {
  test(`mutation killed: ${mutation.name}`, async () => {
    const source = sql();
    assert.equal(source.split(mutation.from).length - 1, 1, 'mutation must match exactly one site');
    const changed = source.replace(mutation.from, mutation.to);
    if (mutation.oracle) {
      const db = await database(changed);
      try { const chat = await setup(db); await assert.rejects(() => mutation.oracle(db, chat), mutation.error); }
      finally { await db.close(); }
    } else {
      const db = await database('');
      try {
        const before = await task2Shape(db);
        await assert.rejects(() => exec(db, changed), mutation.error);
        assert.deepEqual(await task2Shape(db), before, 'failed self-check leaked Task 2 changes');
      } finally { await db.close(); }
    }
  });
}

test('the SQL rehearsal uses the task3 opt-in, executes all assertions and rolls back gate, fixtures, grants and queued wakes', async () => {
  const db = await database();
  try {
    await assert.rejects(() => exec(db, sql('.rehearsal')), /isolated-schema-copy opt-in/);
    await db.exec("set letscube.task3.isolated_schema_copy='yes'");
    await exec(db, sql('.rehearsal'));
    assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from net.http_request_queue')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from vault.decrypted_secrets')).rows[0].n, 0);
    assert.equal((await db.query('select enabled from private.voice_push_dispatch_config')).rows[0].enabled, false);
    assert.deepEqual(await claim(db), []);
  } finally { await db.close(); }
});
