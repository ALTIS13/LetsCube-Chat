import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync } from 'node:fs';
import { database, setup, ring, events, outcomes, asUser, exec, sql, functionSql, chain, A, B, C, uid } from '../helpers/voice-ring-push-fixture.mjs';

test('the actual ring RPC atomically captures two recipient sessions and three Android devices', async () => {
  const db = await database();
  try {
    const chat = await setup(db);
    const started = await ring(db, chat);
    assert.equal((await db.query("select to_regclass('public.voice_ring_push_events')::text as name")).rows[0].name,
      'voice_ring_push_events', 'a successful authoritative ring has no delivery queue');
    const rows = await events(db);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.recipient_user_id), [B, B]);
    assert.deepEqual(rows.map((r) => r.recipient_session_id), [uid(12), uid(13)]);
    assert.ok(rows.every((r) => r.event === 'ring' && r.channel_id === started.channel_id));
    assert.ok(rows.every((r) => r.expires_at - r.ring_started_at === 45000));
    assert.equal((await outcomes(db)).length, 3);
    assert.equal((await db.query('select count(*)::int as n from public.messages')).rows[0].n, 0);
  } finally { await db.close(); }
});

function scenario(name, run) {
  test(name, async () => {
    const db = await database();
    try { await run(db, await setup(db)); }
    finally { await db.close(); }
  });
}
const count = async (db, table) => (await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n;
const stop = (db, channel, user = A) => asUser(db, user, 'select public.voice_call_stop($1, $2)', [channel, 'cancelled']);

async function assertCancelled(db, before) {
  const all = await events(db);
  const originals = all.filter((r) => r.event === 'ring');
  const cancelled = all.filter((r) => r.event === 'cancel');
  assert.equal(originals.length, before.length);
  assert.ok(originals.every((r) => r.state === 'terminal' && r.terminal_at));
  const key = (r) => [r.recipient_user_id, r.recipient_session_id, r.channel_id, +r.ring_started_at, +r.expires_at];
  assert.deepEqual(cancelled.map(key), before.map(key), 'cancel targets and deadline must match the captured generation');
  const devices = await outcomes(db);
  assert.ok(devices.filter((d) => originals.some((r) => r.id === d.event_id)).every((d) =>
    d.state === 'terminal' && d.claim_id === null && d.claimed_until === null));
  for (const old of before) {
    const cancel = cancelled.find((r) => r.recipient_session_id === old.recipient_session_id);
    assert.deepEqual(devices.filter((d) => d.event_id === cancel.id).map((d) => d.push_device_id),
      devices.filter((d) => d.event_id === old.id).map((d) => d.push_device_id));
  }
}

scenario('answer through the recorded RPC terminates claimed rings and queues matching cancels once', async (db, chat) => {
  const { channel_id: room } = await ring(db, chat);
  const before = await events(db);
  await db.exec(`update public.voice_ring_push_devices set state = 'claimed', attempts = 1,
    claim_id = gen_random_uuid(), claimed_until = now() + interval '20 seconds', last_attempt_at = now()`);
  await asUser(db, B, 'select public.voice_call_answer($1)', [room]);
  await assertCancelled(db, before);
  assert.equal(await count(db, 'messages'), 0);
  await stop(db, room, B);
  await stop(db, room, B);
  await assertCancelled(db, before);
  assert.equal(await count(db, 'messages'), 1, 'only the existing call history row is written');
  assert.equal((await db.query("select system_payload->>'outcome' as outcome from public.messages")).rows[0].outcome, 'answered');
});

for (const [label, user, expected] of [['caller cancel', A, 'cancelled'], ['callee decline', B, 'declined']]) {
  scenario(`${label} preserves call history and cancels each captured device`, async (db, chat) => {
    const { channel_id: room } = await ring(db, chat);
    const before = await events(db);
    await stop(db, room, user);
    await stop(db, room, user);
    await assertCancelled(db, before);
    assert.equal(await count(db, 'messages'), 1);
    assert.equal((await db.query("select system_payload->>'outcome' as outcome from public.messages")).rows[0].outcome, expected);
  });
}

scenario('same values and participant ticks do not recapture devices or duplicate events', async (db, chat) => {
  const { channel_id: room } = await ring(db, chat);
  const before = await events(db), devices = await outcomes(db);
  await db.query(`update public.voice_channels set ring_started_at = ring_started_at, ring_caller = ring_caller,
    ring_answered_at = ring_answered_at, archived = archived where id = $1`, [room]);
  await db.query('update public.voice_channels set participant_count = 1 where id = $1', [room]);
  await db.query('update public.voice_channels set participant_count = 0 where id = $1', [room]);
  assert.deepEqual(await events(db), before);
  assert.deepEqual(await outcomes(db), devices);
  const { rows: [trigger] } = await db.query(`select array_agg(a.attname order by a.attname) as cols
    from pg_trigger t join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any(t.tgattr)
    where t.tgname = 'trg_voice_ring_push_capture'`);
  assert.deepEqual(trigger.cols, ['archived', 'chat_id', 'ring_answered_at', 'ring_caller', 'ring_started_at']);
  assert.equal(await count(db, 'messages'), 0);
});

const exclusions = [
  ['calls disabled', `insert into public.user_session_settings(session_id, user_id, calls_enabled) values ('${uid(12)}', '${B}', false)`],
  ['expired session', `update auth.sessions set not_after = now() - interval '1 second' where id = '${uid(12)}'`],
  ['deleted session', `delete from auth.sessions where id = '${uid(12)}'`],
  ['session belongs to caller', `update auth.sessions set user_id = '${A}' where id = '${uid(12)}'`],
  ['mismatched device owner', `update public.user_push_devices set user_id = '${C}' where session_id = '${uid(12)}'`],
  ['unbound devices', `update public.user_push_devices set session_id = null where session_id = '${uid(12)}'`],
  ['unsupported protocol', `update public.user_push_devices set voice_call_protocol = null where session_id = '${uid(12)}'`],
  ['disabled devices', `update public.user_push_devices set enabled = false where session_id = '${uid(12)}'`],
  ['revoked devices', `update public.user_push_devices set revoked_at = now() where session_id = '${uid(12)}'`],
  ['wrong platform', `update public.user_push_devices set platform = 'ios' where session_id = '${uid(12)}'`],
  ['wrong provider', `update public.user_push_devices set provider = 'apns' where session_id = '${uid(12)}'`],
];
for (const [label, prepare] of exclusions) {
  scenario(`ring excludes ${label}, with a valid second session as positive control`, async (db, chat) => {
    await db.exec(prepare);
    await ring(db, chat);
    assert.deepEqual((await events(db)).map((r) => r.recipient_session_id), [uid(13)]);
    assert.deepEqual((await outcomes(db)).map((r) => r.push_device_id), [uid(24)]);
  });
}

scenario('a future not_after and never-refreshed but live session remain eligible', async (db, chat) => {
  await db.exec("update auth.sessions set not_after = now() + interval '1 hour', refreshed_at = null");
  await ring(db, chat);
  assert.equal((await events(db)).length, 2, 'the device-list freshness window is not session revocation');
});

for (const [label, prepare, rpcRefuses] of [
  ['recipient mute', `insert into public.mutes(user_id, chat_id) values ('${B}', $CHAT)`, false],
  ['recipient global mute', `insert into public.mutes(user_id) values ('${B}')`, false],
  ['recipient ban', `insert into public.bans(user_id) values ('${B}')`, false],
  ['caller mute', `insert into public.mutes(user_id, chat_id) values ('${A}', $CHAT)`, false],
  ['caller ban', `insert into public.bans(user_id) values ('${A}')`, false],
  ['recipient blocked caller', `insert into public.user_blocks values ('${B}', '${A}')`, true],
  ['caller blocked recipient', `insert into public.user_blocks values ('${A}', '${B}')`, false],
  ['recipient no longer a member', `delete from public.chat_members where user_id = '${B}'`, false],
]) {
  scenario(`ring eligibility uses explicit user IDs: ${label}`, async (db, chat) => {
    await db.exec(prepare.replace('$CHAT', `'${chat}'`));
    if (rpcRefuses) await assert.rejects(() => ring(db, chat), /blocked/);
    else await ring(db, chat);
    assert.equal((await events(db)).length, 0);
  });
}

scenario('expired moderation does not suppress an eligible recipient', async (db, chat) => {
  await db.query("insert into public.mutes(user_id, chat_id, expires_at) values ($1, $2, now() - interval '1 second')", [B, chat]);
  await db.query("insert into public.bans(user_id, expires_at) values ($1, now() - interval '1 second')", [B]);
  await ring(db, chat);
  assert.equal((await events(db)).length, 2);
});

scenario('a mute in an unrelated chat is not a global mute', async (db, chat) => {
  const other = (await db.query("insert into public.chats(type) values ('group') returning id")).rows[0].id;
  await db.query('insert into public.mutes(user_id, chat_id) values ($1, $2), ($3, $2)', [B, other, A]);
  await ring(db, chat);
  assert.equal((await events(db)).length, 2);
});

scenario('a nonmember caller cannot create a ring even through a trusted direct insert', async (db, chat) => {
  await db.query(`insert into public.voice_channels(chat_id, name, max_participants, ring_started_at, ring_caller)
    values ($1, 'fixture', 2, now(), $2)`, [chat, C]);
  assert.equal((await events(db)).length, 0);
});

scenario('invalid/dead ring states do not enqueue even through trusted SQL', async (db, chat) => {
  for (const started of ["now() - interval '45 seconds'", "now() - interval '90 seconds'", "now() + interval '1 hour'"]) {
    await db.query(`insert into public.voice_channels(chat_id, name, max_participants, ring_started_at, ring_caller)
      values ($1, 'fixture', 2, ${started}, $2)`, [chat, A]);
  }
  await db.query(`insert into public.voice_channels(chat_id, name, max_participants, ring_started_at, ring_caller, ring_answered_at)
    values ($1, 'fixture', 2, now(), $2, now())`, [chat, A]);
  await db.query(`insert into public.voice_channels(chat_id, name, max_participants, archived, ring_started_at, ring_caller)
    values ($1, 'fixture', 2, true, now(), $2)`, [chat, A]);
  assert.equal((await events(db)).length, 0);
});

scenario('same-token account rebind never retargets an old ring or its cancel', async (db, chat) => {
  const { channel_id: room } = await ring(db, chat);
  const before = await events(db);
  // Simulates Task 2a's result, not its registration RPC implementation.
  await db.exec(`update public.user_push_devices set user_id = '${C}', session_id = '${uid(14)}' where id = '${uid(22)}';
    insert into auth.sessions(id, user_id) values ('${uid(15)}', '${B}');
    insert into public.user_push_devices(id, user_id, platform, provider, token, token_hash, session_id, voice_call_protocol)
      values ('${uid(26)}', '${B}', 'android', 'fcm', 'synthetic-new', 'synthetic-new', '${uid(15)}', 1);
    delete from auth.sessions where id = '${uid(13)}';
    delete from public.user_push_devices where id = '${uid(23)}';`);
  await stop(db, room);
  await assertCancelled(db, before);
  assert.equal((await outcomes(db)).length, 6);
  assert.ok(!(await outcomes(db)).some((d) => d.push_device_id === uid(26)));
  assert.ok((await events(db)).every((r) => r.recipient_user_id === B));
});

// Local-only clock passage fixture. The original RPC starts the generation;
// age BOTH canonical timestamps together without pretending this is a new ring.
// No source RPC is replaced, and the recorded sweeper/replacement RPC still runs.
async function ageRing(db) {
  await db.exec(`begin;
    alter table public.voice_channels disable trigger trg_voice_ring_push_capture;
    update public.voice_channels set ring_started_at = ring_started_at - interval '90 seconds' where ring_started_at is not null;
    update public.voice_ring_push_events set ring_started_at = ring_started_at - interval '90 seconds', expires_at = expires_at - interval '90 seconds';
    alter table public.voice_channels enable trigger trg_voice_ring_push_capture;
    commit;`);
}

scenario('the recorded missed sweep clears an aged ring and makes ring/cancel terminal without extending expiry', async (db, chat) => {
  await ring(db, chat);
  await ageRing(db);
  const before = await events(db);
  assert.equal((await db.query('select public.voice_rings_sweep_expired() as n')).rows[0].n, 1);
  assert.equal((await db.query('select public.voice_rings_sweep_expired() as n')).rows[0].n, 0);
  await assertCancelled(db, before);
  assert.ok((await events(db)).every((r) => r.state === 'terminal'));
  assert.ok((await outcomes(db)).every((r) => r.state === 'terminal'));
  assert.equal(await count(db, 'messages'), 1);
  assert.equal((await db.query("select system_payload->>'outcome' as outcome from public.messages")).rows[0].outcome, 'missed');
});

scenario('the recorded ring RPC replaces an expired generation and terminalizes only the old one', async (db, chat) => {
  await ring(db, chat);
  await ageRing(db);
  const before = await events(db);
  await ring(db, chat);
  const all = await events(db);
  assert.equal(all.length, 6);
  assert.ok(all.filter((r) => before.some((b) => +b.ring_started_at === +r.ring_started_at)).every((r) => r.state === 'terminal'));
  assert.equal(all.filter((r) => r.event === 'ring' && r.state === 'pending').length, 2);
  assert.equal(await count(db, 'messages'), 0, 'the outbox does not invent missing history during replacement');
});

for (const table of ['voice_channels', 'chats']) {
  scenario(`deleting ${table} cascades only owned transient events/devices and leaves no sendable rows`, async (db, chat) => {
    const { channel_id: room } = await ring(db, chat);
    await db.query(`delete from public.${table} where id = $1`, [table === 'chats' ? chat : room]);
    assert.equal((await events(db)).length, 0);
    assert.equal((await outcomes(db)).length, 0);
    assert.equal(await count(db, 'user_push_devices'), 5);
  });
}

scenario('archiving and reopening cannot revive or expand the same generation', async (db, chat) => {
  const { channel_id: room } = await ring(db, chat);
  const before = await events(db);
  await db.query('update public.voice_channels set archived = true where id = $1', [room]);
  await db.exec(`insert into auth.sessions(id, user_id) values ('${uid(15)}', '${B}');
    update public.user_push_devices set session_id = '${uid(15)}' where id = '${uid(24)}'`);
  await db.query('update public.voice_channels set archived = false where id = $1', [room]);
  await assertCancelled(db, before);
});

scenario('chat type changes terminalize the old generation', async (db, chat) => {
  await ring(db, chat);
  const before = await events(db);
  await db.query("update public.chats set type = 'group' where id = $1", [chat]);
  await assertCancelled(db, before);
});

scenario('the caller transaction rollback removes the new room and every captured outcome', async (db, chat) => {
  await db.exec('begin');
  await ring(db, chat);
  assert.equal((await events(db)).length, 2);
  await db.exec('rollback; set role supabase_admin');
  assert.equal((await events(db)).length, 0);
  assert.equal((await outcomes(db)).length, 0);
  assert.equal(await count(db, 'voice_channels'), 0);
});

scenario('outbox failure aborts the actual RPC instead of committing an undeliverable ring', async (db, chat) => {
  await db.exec("alter table public.voice_ring_push_devices add constraint injected_failure check (state <> 'pending')");
  await assert.rejects(() => ring(db, chat), /injected_failure/);
  assert.equal(await count(db, 'voice_channels'), 0);
  assert.equal((await events(db)).length, 0);
});

scenario('expiry and identity constraints reject caller self-delivery, duplicates, zero and extended deadlines', async (db, chat) => {
  await ring(db, chat);
  await assert.rejects(() => db.exec('update public.voice_ring_push_events set recipient_user_id = caller_user_id'), /recipient_check/);
  for (const interval of ['0 seconds', '46 seconds']) {
    await assert.rejects(() => db.exec(`update public.voice_ring_push_events set expires_at = ring_started_at + interval '${interval}'`), /expiry_check/);
  }
  await assert.rejects(() => db.exec(`insert into public.voice_ring_push_events
    (recipient_user_id, recipient_session_id, channel_id, chat_id, caller_user_id, ring_started_at, event, expires_at)
    select recipient_user_id, recipient_session_id, channel_id, chat_id, caller_user_id, ring_started_at, event, expires_at
    from public.voice_ring_push_events limit 1`), /voice_ring_push_events_identity/);
  await assert.rejects(() => db.exec(`insert into public.voice_ring_push_devices(event_id, push_device_id)
    select event_id, push_device_id from public.voice_ring_push_devices limit 1`), /voice_ring_push_devices_identity/);
});

scenario('RLS denies client reads even after a test-only SELECT grant; service can lease but cannot author targets', async (db, chat) => {
  await ring(db, chat);
  for (const table of ['voice_ring_push_events', 'voice_ring_push_devices']) {
    await assert.rejects(() => asUser(db, B, `select * from public.${table}`), /permission denied/);
    await db.exec(`grant select on public.${table} to authenticated`);
    assert.deepEqual((await asUser(db, B, `select * from public.${table}`)).rows, []);
    await db.exec(`revoke select on public.${table} from authenticated`);
  }
  await db.exec('set role service_role');
  assert.equal((await events(db)).length, 2);
  await db.exec(`update public.voice_ring_push_devices set state = 'claimed', attempts = attempts + 1,
    claim_id = gen_random_uuid(), claimed_until = now() + interval '5 seconds'`);
  await assert.rejects(() => db.exec(`update public.voice_ring_push_events set recipient_user_id = '${C}'`), /permission denied/);
  await assert.rejects(() => db.exec('delete from public.voice_ring_push_events'), /permission denied/);
  await assert.rejects(() => db.exec('insert into public.voice_ring_push_devices(event_id, push_device_id) values (gen_random_uuid(), gen_random_uuid())'), /permission denied/);
  await db.exec('reset role; set role supabase_admin');
  assert.ok((await outcomes(db)).every((d) => d.state === 'claimed' && d.attempts === 1));
});

scenario('the transient schema contains only identities, times and delivery state, with timestamptz everywhere', async (db) => {
  const columns = (await db.query(`select table_name, column_name, data_type from information_schema.columns
    where table_schema = 'public' and table_name in ('voice_ring_push_events', 'voice_ring_push_devices')`)).rows;
  assert.ok(!columns.some((c) => /token|name|body|content|media|route|notification/.test(c.column_name)));
  assert.ok(columns.filter((c) => /(_at|_until)$/.test(c.column_name)).every((c) => c.data_type === 'timestamp with time zone'));
  assert.deepEqual(columns.filter((c) => c.table_name === 'voice_ring_push_events').map((c) => c.column_name).sort(),
    ['id', 'recipient_user_id', 'recipient_session_id', 'channel_id', 'chat_id', 'caller_user_id', 'ring_started_at',
      'event', 'expires_at', 'state', 'terminal_at', 'created_at', 'updated_at'].sort());
  assert.deepEqual(columns.filter((c) => c.table_name === 'voice_ring_push_devices').map((c) => c.column_name).sort(),
    ['event_id', 'push_device_id', 'state', 'attempts', 'next_attempt_at', 'claim_id', 'claimed_until', 'last_attempt_at', 'updated_at'].sort());
});

async function existingShape(db) {
  return (await db.query(`select n.nspname, p.proname, p.oid::regprocedure::text as signature,
      md5(pg_get_functiondef(p.oid)) as definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f' and p.proname not like 'voice_ring_push_%'
    order by 1, 3`)).rows;
}

test('rollback preserves every existing function byte-for-byte, leaves binding intact, and permits clean reapply', async () => {
  const db = await database('');
  try {
    const before = await existingShape(db);
    const chat = await setup(db);
    await exec(db, sql());
    assert.deepEqual(await existingShape(db), before);
    const { channel_id: room } = await ring(db, chat);
    await stop(db, room);
    await exec(db, sql('20260921114127_android_voice_ring_outbox.rollback'));
    assert.deepEqual(await existingShape(db), before);
    assert.equal((await db.query("select to_regclass('public.voice_ring_push_events') as t")).rows[0].t, null);
    assert.equal(await count(db, 'messages'), 1);
    assert.equal(await count(db, 'user_push_devices'), 5);
    assert.equal((await db.query('select count(session_id)::int as n from public.user_push_devices')).rows[0].n, 5);
    await exec(db, sql());
    await ring(db, chat);
    assert.equal((await events(db)).length, 2);
  } finally { await db.close(); }
});

scenario('replay safely refuses existing/drifted objects without altering queued rows', async (db, chat) => {
  await ring(db, chat);
  const before = await events(db), devices = await outcomes(db);
  await assert.rejects(() => exec(db, sql()), /already installed or object drift/);
  assert.deepEqual(await events(db), before);
  assert.deepEqual(await outcomes(db), devices);
});

scenario('rollback refuses a later dependency instead of cascading into another feature', async (db, chat) => {
  await ring(db, chat);
  await db.exec('create view public.synthetic_future_dependency as select id from public.voice_ring_push_events');
  await assert.rejects(() => exec(db, sql('20260921114127_android_voice_ring_outbox.rollback')), /depend|cannot drop/i);
  assert.equal((await events(db)).length, 2);
  await stop(db, (await events(db))[0].channel_id);
  assert.equal((await events(db)).length, 4, 'failed rollback restored the trigger too');
});

const mutants = [
  {
    name: 'caller exclusion', from: 'and member.user_id <> new.ring_caller', to: '',
    oracle: async (db, chat) => { await ring(db, chat); }, failure: /recipient_check/,
  },
  {
    name: 'session ownership', from: 'session.user_id = member.user_id', to: 'true',
    oracle: async (db, chat) => {
      await db.exec(`update auth.sessions set user_id = '${A}' where id = '${uid(12)}'`);
      await ring(db, chat);
      assert.deepEqual((await events(db)).map((r) => r.recipient_session_id), [uid(13)], 'session ownership leaked');
    }, failure: /session ownership leaked/,
  },
  {
    name: '45-second deadline',
    from: "'ring', new.ring_started_at + interval '45 seconds' from eligible",
    to: "'ring', new.ring_started_at + interval '44 seconds' from eligible",
    oracle: async (db, chat) => {
      await ring(db, chat);
      assert.equal((await events(db))[0].expires_at - (await events(db))[0].ring_started_at, 45000, 'expiry changed');
    }, failure: /expiry changed/,
  },
  {
    name: 'terminal cancellation',
    from: "set state = 'terminal', terminal_at = coalesce(terminal_at, v_now), updated_at = v_now",
    to: 'set updated_at = v_now',
    oracle: async (db, chat) => {
      const { channel_id: room } = await ring(db, chat);
      await stop(db, room);
      assert.ok((await events(db)).filter((r) => r.event === 'ring').every((r) => r.state === 'terminal'), 'stale ring remains sendable');
    }, failure: /stale ring remains sendable/,
  },
  {
    name: 'RLS', from: 'alter table public.voice_ring_push_events enable row level security;', to: '',
    failure: /RLS\/owner self-check/,
  },
  {
    name: 'PUBLIC execute revoke',
    from: 'revoke all on function private.voice_ring_push_capture() from public, anon, authenticated, service_role;', to: '',
    failure: /EXECUTE self-check/,
  },
  {
    name: 'client table revoke',
    from: 'revoke all on table public.voice_ring_push_devices from public, anon, authenticated, service_role;', to: '',
    failure: /client privilege self-check/,
  },
  {
    name: 'unique event identity',
    from: 'unique (recipient_user_id, recipient_session_id, channel_id, ring_started_at, event)',
    to: 'unique (recipient_user_id, recipient_session_id, channel_id, ring_started_at, event, id)',
    oracle: async (db, chat) => {
      await ring(db, chat);
      await assert.rejects(() => db.exec(`insert into public.voice_ring_push_events
        (recipient_user_id, recipient_session_id, channel_id, chat_id, caller_user_id, ring_started_at, event, expires_at)
        select recipient_user_id, recipient_session_id, channel_id, chat_id, caller_user_id, ring_started_at, event, expires_at
        from public.voice_ring_push_events limit 1`), /voice_ring_push_events_identity/, 'duplicate generation accepted');
    }, failure: /duplicate generation accepted/,
  },
  {
    name: 'function owner', from: 'alter function private.voice_ring_push_capture() owner to supabase_admin;',
    to: 'alter function private.voice_ring_push_capture() owner to postgres;', failure: /owner\/security/,
  },
];
for (const mutant of mutants) {
  test(`mutation killed: ${mutant.name}`, async () => {
    const source = sql();
    assert.equal(source.split(mutant.from).length - 1, 1, 'mutation must change exactly one site');
    const changed = source.replace(mutant.from, mutant.to);
    if (!mutant.oracle) {
      const db = await database('');
      try {
        await assert.rejects(() => exec(db, changed), mutant.failure);
        assert.equal((await db.query("select to_regclass('public.voice_ring_push_events') as t")).rows[0].t, null, 'self-check failure committed DDL');
      } finally { await db.close(); }
    } else {
      const db = await database(changed);
      try {
        const chat = await setup(db);
        await assert.rejects(() => mutant.oracle(db, chat), mutant.failure);
      }
      finally { await db.close(); }
    }
  });
}

test('the schema-copy rehearsal executes, uses real RPCs and rolls back every fixture and temporary grant', async () => {
  const db = await database();
  try {
    await assert.rejects(() => exec(db, sql('20260921114127_android_voice_ring_outbox.rehearsal')), /isolated-schema-copy opt-in/);
    await db.exec("set letscube.task2b.isolated_schema_copy = 'yes'");
    await exec(db, sql('20260921114127_android_voice_ring_outbox.rehearsal'));
    assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n, 0);
    assert.equal(await count(db, 'chats'), 0);
    assert.equal((await events(db)).length, 0);
    assert.equal((await db.query("select has_table_privilege('authenticated', 'public.voice_ring_push_events', 'SELECT') as granted")).rows[0].granted, false);
  } finally { await db.close(); }
});

test('every recorded definition of the measured call RPCs belongs to this fixture chain', () => {
  const directory = new URL('../../.migration-backup/supabase/migrations/', import.meta.url);
  const recorded = readdirSync(directory).filter((n) => n.endsWith('.sql') && !/\.(rehearsal|rollback)\.sql$/.test(n));
  const included = new Set([...chain, '20260918260000_a_missed_call_is_recorded_even_if_nobody_is_there']);
  const missing = recorded.filter((file) => {
    const source = sql(file.slice(0, -4)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    return /(?:create(?:\s+or\s+replace)?|drop)\s+function\s+public\.(voice_call_ring|voice_call_answer|voice_call_stop|voice_rings_sweep_expired)\s*\(/i.test(source)
      && !included.has(file.slice(0, -4));
  });
  assert.deepEqual(missing, [], 'a recorded RPC changed outside the behavioral fixture chain');
});

scenario('legacy devices keep ordinary native notification admission while receiving no voice rows', async (db, chat) => {
  // Only ordinary notification policy/payload are stubbed. The actual recorded
  // fan-out trigger must still admit enabled legacy devices, independent of 2a.
  await db.exec(`
    create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid, kind text, payload jsonb);
    create table public.push_subscriptions(id uuid primary key, user_id uuid, is_active boolean);
    create table public.notifications_push_outbox(notification_id uuid, subscription_id uuid, user_id uuid, payload jsonb, unique(notification_id, subscription_id));
    create table public.notifications_native_push_outbox(notification_id uuid, device_id uuid, user_id uuid, payload jsonb, unique(notification_id, device_id));
    create function public._notification_push_allowed(uuid, text, jsonb) returns boolean language sql as $$ select true $$;
    create function public._notification_push_payload(text, jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
  `);
  await db.exec(functionSql('20260724_windows_wns_push_devices', 'public._enqueue_push_after_notification_insert'));
  await db.exec(`create trigger synthetic_notification_fanout after insert on public.notifications
    for each row execute function public._enqueue_push_after_notification_insert()`);
  await db.exec(`update public.user_push_devices set session_id = null, voice_call_protocol = null where id = '${uid(22)}';
    update public.user_push_devices set voice_call_protocol = null where id = '${uid(23)}'`);
  await ring(db, chat);
  assert.deepEqual((await outcomes(db)).map((d) => d.push_device_id), [uid(24)]);
  assert.equal(await count(db, 'notifications'), 0);
  assert.equal(await count(db, 'notifications_native_push_outbox'), 0);
  await db.query("insert into public.notifications(user_id, kind, payload) values ($1, 'message', '{}'::jsonb)", [B]);
  assert.deepEqual((await db.query('select device_id from public.notifications_native_push_outbox order by device_id')).rows.map((r) => r.device_id),
    [uid(22), uid(23), uid(24)]);
});
