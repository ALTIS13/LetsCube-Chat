import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// No production connection option: --ssh can only CREATE a fresh, labelled,
// network-none PG17 container on the authorized host. No dumps or host mounts.
const remote = process.argv.includes('--ssh');
const syntaxOnly = process.argv.includes('--syntax-only');
const mutations = process.argv.includes('--mutations');
const freshBackup = process.argv.includes('--fresh-backup');
const inputMutation = process.argv.includes('--input-mutation');
const selected = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
const token = randomUUID();
const name = `letscube-phone-item74-${token}`;
const image = 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00';
const actor = '00000000-0000-0000-0000-000000000001';
const target = '00000000-0000-0000-0000-000000000002';
const staff = '00000000-0000-0000-0000-000000000003';
const banned = '00000000-0000-0000-0000-000000000004';
const other = '00000000-0000-0000-0000-000000000005';
const backupPath = '/srv/letscube/backups/automated/20261001-155443/db/supabase-postgres.custom';
const migration = await readFile(new URL('../../../supabase/migrations/20260930235000_phone_search_for_everybody.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../../../supabase/migrations/20260930235000_phone_search_for_everybody.rollback.sql', import.meta.url), 'utf8');
const fixture = await readFile(new URL('./fixture.sql', import.meta.url), 'utf8');
let containerId;
let checks = 0;
let selectedChecks = 0;

function command(args, input, timeout = 45000) {
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const child = remote
    ? spawn('ssh', ['-i', 'C:/Users/maksi/.ssh/letscube_ed25519', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'root@ms.letscube.ru', ['docker', ...args].map(quote).join(' ')])
    : spawn('docker', args);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  // Only terminate this owned CLI process on timeout, never host services.
  const timer = setTimeout(() => child.kill(), timeout);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }); });
  });
  if (input !== undefined) child.stdin.end(input);
  return { child, done, output: () => stdout };
}

async function docker(args, input) {
  const result = await command(args, input).done;
  assert.equal(result.code, 0, `docker ${args[0]}: ${result.stderr}`);
  return result.stdout;
}

function session(sql, database = 'phone_item74') {
  assert.ok(containerId, 'an owned container must exist');
  return command(['exec', '-i', containerId, 'psql', '-X', '-qAt', '-h', '/tmp', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], sql);
}

async function query(sql, database) {
  const result = await session(sql, database).done;
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}

function rpc(who = actor, number = '+19995550199', transaction = 'read committed') {
  const claims = JSON.stringify(who ? { sub: who } : {});
  return `begin isolation level ${transaction}; set local statement_timeout = '20s';
    set local role authenticated; set local request.jwt.claims = '${claims}';
    select count(*) from public.search_profiles_by_phone('${number}', 10); commit;`;
}

// Top-level lexer: ignore nested comments, quoted identifiers, strings and
// dollar-quoted function bodies. Command-tag ROLLBACK must never slip through.
function transactionCheck(sql) {
  let i = 0, statement = '', statements = [];
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith('--')) { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue; }
    if (rest.startsWith('/*')) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      assert.equal(depth, 0, 'unterminated SQL comment'); continue;
    }
    const dollar = rest.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length);
      assert.ok(end >= 0, 'unterminated dollar quote');
      statement += ' BODY '; i = end + dollar.length; continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++]; let closed = false;
      while (i < sql.length) {
        if (sql[i++] === quote) {
          if (sql[i] === quote) i++;
          else { closed = true; break; }
        }
      }
      assert.ok(closed, 'unterminated quote'); statement += ' QUOTED '; continue;
    }
    if (sql[i] === ';') {
      if (statement.trim()) statements.push(statement.trim().toLowerCase());
      statement = ''; i++; continue;
    }
    statement += sql[i++];
  }
  assert.equal(statement.trim(), '', 'all top-level SQL must end in semicolons');
  assert.equal(statements[0], 'begin', 'BEGIN must be first');
  assert.equal(statements.at(-1), 'commit', 'COMMIT must be last');
  assert.deepEqual(statements.filter((s) => /^(begin|commit|rollback|abort|end|start|savepoint|release)\b/.test(s)), ['begin', 'commit']);
}

async function check(label, action) {
  if (selected && !label.includes(selected)) return;
  await action(); checks++;
  if (selected) selectedChecks++;
  console.log(`PASS ${label}`);
}

async function waitFor(predicate, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`timeout: ${label}`);
}

async function inspectOwned() {
  const [c] = JSON.parse(await docker(['inspect', containerId]));
  assert.equal(c.Id, containerId);
  assert.equal(c.Name, `/${name}`);
  assert.equal(c.Image, image);
  assert.equal(c.Config.Labels['letscube.phone-item74.owner'], token);
  assert.equal(c.HostConfig.NetworkMode, 'none');
  assert.equal(c.HostConfig.Privileged, false);
  assert.deepEqual(c.HostConfig.PortBindings, {});
  assert.ok(c.Mounts.every((mount) => mount.Type !== 'bind' && mount.Type !== 'volume'));
}

async function restoreFreshBackup() {
  assert.equal(remote, true, '--fresh-backup requires the authorized SSH host');
  assert.equal(mutations, false, 'mutations use synthetic fixtures, never restored personal rows');
  await inspectOwned();
  const roles = ['anon', 'authenticated', 'authenticator', 'dashboard_user', 'pgbouncer', 'postgres', 'service_role',
    'supabase_auth_admin', 'supabase_etl_admin', 'supabase_functions_admin', 'supabase_privileged_role',
    'supabase_read_only_user', 'supabase_realtime_admin', 'supabase_replication_admin', 'supabase_storage_admin'];
  const bypass = new Set(['postgres', 'service_role', 'supabase_etl_admin', 'supabase_read_only_user']);
  await query(roles.map((role) => `create role ${role} nologin ${bypass.has(role) ? 'bypassrls' : 'nobypassrls'};`).join('\n'), 'postgres');
  const result = await new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-i', 'C:/Users/maksi/.ssh/letscube_ed25519', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
      'root@ms.letscube.ru', `docker exec -i ${containerId} pg_restore --exit-on-error --single-transaction -h /tmp -U supabase_admin -d phone_item74 < ${backupPath}`]);
    let diagnostics = '';
    child.stderr.on('data', (chunk) => { diagnostics += chunk; });
    // Never surface raw restore diagnostics: dumps can carry personal data.
    child.stdout.resume();
    const timer = setTimeout(() => child.kill(), 120000);
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, diagnostics }); });
  });
  if (result.code !== 0) {
    const firstError = result.diagnostics.split('\n').find((line) => /error:/i.test(line)) ?? '';
    const vocabulary = new Set('pg_restore error could not execute query schema relation function type extension publication tablespace role parameter archive input file unsupported version header valid format does exist already permission denied must be owner create read load open access initialize configuration server shared memory out locks transaction too many invalid syntax restore SET timeout compression algorithm unexpected end EOF table constraint'.toLowerCase().split(' '));
    const hint = (firstError.toLowerCase().match(/[a-z_]+/g) ?? []).filter((word) => vocabulary.has(word)).join(' ');
    const components = ['pg_net', 'pg_cron', 'pg_stat_statements', 'supabase_vault', 'pgsodium', 'pgaudit', 'shared_preload_libraries'].filter((word) => firstError.includes(word));
    const missingRole = /role "([a-z_]+)" does not exist/.exec(result.diagnostics)?.[1];
    const parameter = /unrecognized configuration parameter "([a-z_]+)"/.exec(result.diagnostics)?.[1];
    const schemaExists = /schema "([a-z_]+)" already exists/.exec(result.diagnostics)?.[1];
    const preload = /([a-z_]+) is not in shared_preload_libraries/.exec(result.diagnostics)?.[1];
    const category = missingRole ? `missing role ${missingRole}`
      : parameter ? `unrecognized configuration parameter ${parameter}`
        : schemaExists ? `schema already exists: ${schemaExists}`
          : preload && ['pg_net', 'pg_cron', 'pg_stat_statements', 'supabase_vault'].includes(preload) ? `preload prerequisite ${preload}`
      : /pg_cron/.test(result.diagnostics) ? 'pg_cron prerequisite'
        : /could not open extension control file/.test(result.diagnostics) ? 'extension prerequisite'
          : /No space left/.test(result.diagnostics) ? 'isolated storage capacity' : 'restore failed (private diagnostics suppressed)';
    throw new Error(`Full custom-dump restore exit=${result.code}: ${category}; allowlisted error keywords: ${hint}; components=${components.join(',')}`);
  }
  assert.equal(await query("select current_setting('cron.launch_active_jobs');"), 'off');
  assert.equal(await query("select current_setting('pg_net.database_name');"), 'postgres', 'HTTP worker cannot read the restored phone_item74 DB');
  assert.equal(await query(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%';`), '163', 'full restore matches the live 163-table catalog (backup has 161 TABLE DATA entries)');
  assert.equal(await query(`select count(*) from auth.users where id in ('${actor}','${target}','${staff}','${banned}','${other}');`), '0', 'synthetic account ids must not collide with restored rows');
  assert.equal(await query("select count(*) from public.profile_contacts where phone='+19995550199';"), '0', 'synthetic lookup must not touch a restored phone');
  // Temporarily admit synthetic users only in this owned restore, in one
  // transaction. Restore the real invite flag before testing the migration;
  // do not disable any RLS policy or trigger or change their definitions.
  await query(`begin; do $seed$
    declare v_invite_only boolean;
    begin
      select invite_only_enabled into strict v_invite_only from public.registration_invite_settings where id=true;
      update public.registration_invite_settings set invite_only_enabled=false where id=true;
      insert into auth.users(id, raw_user_meta_data)
        select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
          '{"full_name":"Item74 Isolated Fixture"}'::jsonb from generate_series(1,5) as n;
      update public.registration_invite_settings set invite_only_enabled=v_invite_only where id=true;
    end;
    $seed$;
    set app.profile_contacts_bypass='on';
    update public.profile_contacts set phone='+19995550199',phone_verified=true,phone_verified_at=now() where user_id='${target}';
    insert into public.privacy_preferences(user_id) select id from auth.users
      where id in ('${actor}','${target}','${staff}','${banned}','${other}') on conflict(user_id) do nothing; commit;`);
  assert.equal(await query(`select public.has_permission('${actor}','users.view');`), 'f');
  console.log('EVIDENCE full fresh custom-dump restore: exit=0 tables=163 cron=off pg_net_worker_database=empty_postgres; no personal rows logged');
}

async function resetLog() { await query('delete from private.phone_lookups;'); }

async function race(seed, age, expectedSuccess, expectedTotal, label) {
  await resetLog();
  if (seed) await query(`insert into private.phone_lookups(user_id, looked_up_at)
    select '${actor}', clock_timestamp() - interval '${age}' from generate_series(1, ${seed});`);
  await query(`create or replace function private.item74_insert_barrier() returns trigger
    language plpgsql as $gate$ begin perform pg_advisory_xact_lock_shared(744001); return new; end $gate$;
    create trigger item74_insert_barrier before insert on private.phone_lookups
    for each row execute function private.item74_insert_barrier();`);
  const gate = session();
  const workers = [];
  try {
    gate.child.stdin.write("select pg_advisory_lock(744001);\n\\echo ITEM74_GATE_HELD\n");
    await waitFor(() => gate.output().includes('ITEM74_GATE_HELD'), 'insert barrier held');
    for (let i = 0; i < 12; i++) {
      workers.push(session(`set application_name = 'item74_wave_${i}'; ${rpc()}`));
      // Avoid simultaneous SSH authentication bursts (server MaxStartups).
      // SQL connections still overlap: none can leave the held insert barrier.
      await waitFor(async () => {
        if (workers[i].child.exitCode !== null) {
          const result = await workers[i].done;
          throw new Error(`SQL backend ${i} exited before barrier: ${result.stderr || result.stdout}`);
        }
        return Number(await query(`select count(*) from pg_stat_activity
          where application_name = 'item74_wave_${i}' and wait_event_type = 'Lock'
            and lower(wait_event) = 'advisory';`)) === 1;
      }, `SQL backend ${i} blocked`);
    }
    // This witnesses twelve distinct live backends, not twelve promises or
    // a scheduler delay: all have reached an advisory-lock wait before release.
    await waitFor(async () => Number(await query(`select count(distinct pid) from pg_stat_activity
      where application_name like 'item74_wave_%' and wait_event_type = 'Lock'
        and lower(wait_event) = 'advisory';`)) === 12, '12 simultaneous SQL connections');
    gate.child.stdin.end('select pg_advisory_unlock(744001);\n');
    assert.equal((await gate.done).code, 0);
    const results = await Promise.all(workers.map((worker) => worker.done));
    const success = results.filter((result) => result.code === 0).length;
    const refused = results.filter((result) => result.code !== 0 && result.stderr.includes('phone_lookup_rate_limited')).length;
    const total = Number(await query(`select count(*) from private.phone_lookups where user_id = '${actor}';`));
    console.log(`EVIDENCE ${label}: concurrent_backends=12 success=${success} limited=${refused} rows=${total}`);
    assert.equal(success, expectedSuccess, `${label}: allowed calls`);
    assert.equal(refused, 12 - expectedSuccess, `${label}: rate-limit refusals`);
    assert.equal(total, expectedTotal, `${label}: literal quota`);
  } finally {
    if (!gate.child.stdin.writableEnded) gate.child.stdin.end('select pg_advisory_unlock(744001);\n');
    await gate.done;
    await Promise.all(workers.map((worker) => worker.done));
    await query('drop trigger item74_insert_barrier on private.phone_lookups; drop function private.item74_insert_barrier();');
  }
}

async function baselineCatalog(database = 'phone_item74') {
  return query(`select jsonb_build_object('body', p.prosrc, 'volatility', p.provolatile,
      'definer', p.prosecdef, 'path', p.proconfig, 'acl', p.proacl::text,
      'definition_sha256', encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
      'owner', pg_get_userbyid(p.proowner), 'comment', obj_description(p.oid, 'pg_proc'),
      'old_column_comment', col_description('public.profile_contacts'::regclass,
        (select attnum from pg_attribute where attrelid='public.profile_contacts'::regclass and attname='phone_discoverable')),
      'old_setter_comment', obj_description('public.profile_phone_set_discoverable(boolean)'::regprocedure, 'pg_proc'))
    from pg_proc p where oid = 'public.search_profiles_by_phone(text,integer)'::regprocedure;`, database);
}

async function functionalChecks() {
  await resetLog();
  assert.equal(await query(rpc()), '1', 'ordinary authenticated account finds synthetic target');
  assert.equal(await query(rpc(actor, '+19995550198')), '0', 'missing phone is empty');
  await query(`update public.privacy_preferences set phone_findable_by = 'contacts' where user_id = '${target}';`);
  assert.equal(await query(rpc()), '0', 'contact-only result is hidden');
  await query(`insert into public.user_contacts values ('${target}', '${actor}');`);
  assert.equal(await query(rpc()), '1', 'owner-saved searcher is allowed');
  await query(`insert into public.user_blocks values ('${target}', '${actor}');`);
  assert.equal(await query(rpc()), '0', 'blocked searcher is hidden');
  assert.equal(await query(`select count(*) from private.phone_lookups;`), '5', 'every valid hidden/missing lookup consumes quota');
  assert.equal(await query(rpc(banned)), '0');
  assert.equal(await query(rpc(actor, 'bad input')), '0');
  assert.equal(await query(rpc('')), '0', 'missing auth cannot look up');
  assert.equal(await query(`select count(*) from private.phone_lookups;`), '5', 'invalid/unauthenticated/banned inputs do not write');
  await query('delete from public.user_contacts; delete from public.user_blocks;');
  await query(`update public.privacy_preferences set phone_findable_by = 'everybody';`);
  for (let i = 0; i < 12; i++) assert.equal(await query(rpc(staff)), '1', 'staff keeps unrestricted lookup');
  assert.equal(await query(`select count(*) from private.phone_lookups where user_id = '${staff}';`), '0');
  const denied = await session('set role authenticated; select * from private.phone_lookups;').done;
  assert.notEqual(denied.code, 0); assert.match(denied.stderr, /permission denied/);
  const anon = await session("set role anon; select * from public.search_profiles_by_phone('+19995550199',10);").done;
  assert.notEqual(anon.code, 0); assert.match(anon.stderr, /permission denied/);
  const service = await session("set role service_role; select * from public.search_profiles_by_phone('+19995550199',10);").done;
  assert.notEqual(service.code, 0); assert.match(service.stderr, /permission denied/);
}

async function privacyWrites() {
  await query(`update public.privacy_preferences set phone_findable_by='contacts',
    presence_visible=false, forward_origin_visible=false, manual_status='dnd',
    manual_status_until=now() + interval '1 hour', last_active_at=now() - interval '5 minutes'
    where user_id='${actor}';`);
  const row = async () => JSON.parse(await query(`select to_jsonb(p) from public.privacy_preferences p where user_id='${actor}';`));
  const before = await row();
  const write = (sql, who = actor, role = 'authenticated') => `begin; set local role ${role};
    set local request.jwt.claims='${JSON.stringify(who ? { sub: who } : {})}'; ${sql} commit;`;
  // Supabase upsert({user_id}, {ignoreDuplicates:true}) -> ON CONFLICT DO NOTHING.
  assert.equal(await query(write(`insert into public.privacy_preferences(user_id) values ('${actor}') on conflict(user_id) do nothing returning user_id;`)), '');
  assert.deepEqual(await row(), before, 'ignored insert must not reset contacts, forward, presence or status');
  assert.equal(await query(write(`update public.privacy_preferences set phone_findable_by='everybody', updated_at=now()
    where user_id='${actor}' returning user_id;`)), actor, 'partial PATCH select(user_id).single() returns exactly own row');
  const after = await row();
  assert.equal(after.phone_findable_by, 'everybody');
  for (const column of ['presence_visible', 'forward_origin_visible', 'manual_status', 'manual_status_until', 'last_active_at', 'created_at']) {
    assert.deepEqual(after[column], before[column], `PATCH preserves ${column}`);
  }
  assert.ok(after.updated_at > before.updated_at, 'live trigger refreshes updated_at');
  assert.equal(await query(write(`update public.privacy_preferences set forward_origin_visible=true, updated_at=now()
    where user_id='${actor}' returning user_id;`)), actor);
  const forward = await row();
  assert.equal(forward.forward_origin_visible, true);
  assert.equal(forward.phone_findable_by, 'everybody');
  assert.equal(forward.manual_status, 'dnd');
  // PostgREST .single() refuses these zero-row updates; SQL does not raise for
  // an UPDATE whose USING policy filters its target out.
  for (const [who, role] of [[other, 'authenticated'], ['', 'anon']]) {
    assert.equal(await query(write(`update public.privacy_preferences set phone_findable_by='contacts', updated_at=now()
      where user_id='${actor}' returning user_id;`, who, role)), '', `${role}/other-account PATCH returns no row`);
    const denied = await session(write(`insert into public.privacy_preferences(user_id) values ('${actor}')
      on conflict(user_id) do nothing returning user_id;`, who, role)).done;
    assert.notEqual(denied.code, 0);
    assert.match(denied.stderr, /row-level security/, 'INSERT is refused even with ignoreDuplicates');
  }
  assert.deepEqual(await row(), forward, 'outsider writes did not alter the row');
  await query(`delete from public.privacy_preferences where user_id='${other}';`);
  assert.equal(await query(write(`insert into public.privacy_preferences(user_id) values ('${other}')
    on conflict(user_id) do nothing returning user_id;`, other)), other, 'absent own row initializes');
  assert.equal(await query(`select phone_findable_by || ':' || forward_origin_visible::text || ':' || manual_status
    from public.privacy_preferences where user_id='${other}';`), 'everybody:true:online');
  console.log('EVIDENCE real-schema privacy slice: ignored insert preserves exact row; partial PATCH returns 1; outsiders return 0/refused');
}

async function retentionChecks() {
  await resetLog();
  await query(`insert into private.phone_lookups values ('${actor}', clock_timestamp() - interval '2 days');`);
  assert.equal(await query(rpc()), '1');
  assert.equal(await query(`select count(*) from private.phone_lookups where user_id='${actor}';`), '1', 'next successful lookup removes stale cache');
  assert.equal(await query(rpc(other)), '1');
  await query(`delete from auth.users where id='${other}';`);
  assert.equal(await query(`select count(*) from private.phone_lookups where user_id='${other}';`), '0', 'account deletion cascades log');
  assert.equal(await query(`select count(*) from private.phone_lookups where user_id='${actor}';`), '1', 'another account cache survives');
  assert.equal(await query(`select string_agg(attname, ',' order by attnum) from pg_attribute
    where attrelid='private.phone_lookups'::regclass and attnum>0 and not attisdropped;`), 'user_id,looked_up_at', 'no raw numbers/queries');
}

async function transactionChecks() {
  await resetLog();
  for (const isolation of ['repeatable read', 'serializable']) {
    const refused = await session(rpc(actor, '+19995550199', isolation)).done;
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /phone_lookup_requires_read_committed/);
  }
  assert.equal(await query('select count(*) from private.phone_lookups;'), '0');
  const holder = session();
  let waiter;
  try {
    holder.child.stdin.write(`begin; set local role authenticated; set local request.jwt.claims='{"sub":"${actor}"}';
      select count(*) from public.search_profiles_by_phone('+19995550199',10);\n\\echo ACCOUNT_LOCK_HELD\n`);
    await waitFor(() => holder.output().includes('ACCOUNT_LOCK_HELD'), 'account lock held after RPC');
    waiter = session(`set application_name='item74_transaction_waiter'; ${rpc()}`);
    await waitFor(async () => Number(await query(`select count(*) from pg_stat_activity
      where application_name='item74_transaction_waiter' and wait_event_type='Lock' and lower(wait_event)='advisory';`)) === 1, 'same-account waits through transaction');
    assert.equal(await query(rpc(other)), '1', 'different account is not serialized behind actor');
    holder.child.stdin.end('rollback;\n');
    assert.equal((await holder.done).code, 0);
    const result = await waiter.done;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await query(`select count(*) from private.phone_lookups where user_id='${actor}';`), '1', 'rollback frees lock and consumes no quota');
  } finally {
    if (!holder.child.stdin.writableEnded) holder.child.stdin.end('rollback;\n');
    await holder.done;
    if (waiter) await waiter.done;
  }
  await resetLog();
  const old = session();
  try {
    old.child.stdin.write("set application_name='item74_old_transaction'; begin; select now();\n\\echo OLD_TRANSACTION_STARTED\n");
    await waitFor(() => old.output().includes('OLD_TRANSACTION_STARTED'), 'transaction started');
    await waitFor(async () => await query(`select clock_timestamp()-xact_start > interval '1 second'
      from pg_stat_activity where application_name='item74_old_transaction';`) === 't', 'old transaction timestamp');
    old.child.stdin.end(`set local role authenticated; set local request.jwt.claims='{"sub":"${actor}"}';
      select count(*) from public.search_profiles_by_phone('+19995550199',10); reset role;
      select looked_up_at > transaction_timestamp()+interval '1 second' from private.phone_lookups where user_id='${actor}'; commit;`);
    const result = await old.done;
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.endsWith('1\nt'), 'quota timestamp is current wall time, not old transaction start');
  } finally {
    if (!old.child.stdin.writableEnded) old.child.stdin.end('rollback;\n');
    await old.done;
  }
}

async function normalizationChecks() {
  await resetLog();
  assert.equal(await query(rpc(actor, '+1 (999) 555-0199')), '1', 'formatted explicit international number');
  assert.equal(await query(rpc(actor, '9995550199')), '0', 'local ten digits without country marker rejected');
  assert.equal(await query(rpc(actor, '19995550199')), '0', 'naked non-Russian international digits rejected');
  assert.equal(await query(rpc(actor, '+1999555')), '0', 'partial explicit international number rejected');
  assert.equal(await query('select count(*) from private.phone_lookups;'), '1', 'invalid guesses consume no quota');
  await query(`set app.profile_contacts_bypass='on'; update public.profile_contacts
    set phone='+79991234567' where user_id='${target}';`);
  try {
    for (const number of ['+7 (999) 123-45-67', '8 (999) 123-45-67', '7 (999) 123-45-67']) {
      assert.equal(await query(rpc(actor, number)), '1', 'whole formatted Russian number accepted');
    }
    assert.equal(await query(rpc(actor, '9991234567')), '0', 'Russian local ten digits rejected, not globally normalized');
    assert.equal(await query('select count(*) from private.phone_lookups;'), '4');
  } finally {
    await query(`set app.profile_contacts_bypass='on'; update public.profile_contacts
      set phone='+19995550199' where user_id='${target}';`);
  }
}

async function localNumberCheck() {
  await resetLog();
  await query(`set app.profile_contacts_bypass='on'; update public.profile_contacts
    set phone='+79991234567' where user_id='${target}';`);
  try {
    assert.equal(await query(rpc(actor, '+7 (999) 123-45-67')), '1', 'known stored whole-number control');
    assert.equal(await query(rpc(actor, '9991234567')), '0', 'ten digits must not find a real matching fixture');
    assert.equal(await query('select count(*) from private.phone_lookups;'), '1', 'local guess does not write log');
  } finally {
    await query(`set app.profile_contacts_bypass='on'; update public.profile_contacts
      set phone='+19995550199' where user_id='${target}';`);
  }
}

async function main() {
  await check('transaction boundaries and injected command-tag guards', async () => {
    for (const sql of [migration, rollback, fixture]) {
      transactionCheck(sql);
      assert.throws(() => transactionCheck(sql.replace(/commit;\s*$/i, 'rollback;\ncommit;')));
      assert.throws(() => transactionCheck(`select 1;\n${sql}`));
      assert.throws(() => transactionCheck(`${sql}\nselect 1;`));
      assert.throws(() => transactionCheck(sql.replace(/commit;\s*$/i, 'commit;\nbegin;\ncommit;')));
    }
    transactionCheck("/* outer /* BEGIN; */ COMMIT; */ begin; do $x$ begin perform 'ROLLBACK;'; end $x$; -- COMMIT;\ncommit;");
  });
  if (syntaxOnly) return;
  const collision = await docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.ID}}']);
  assert.equal(collision, '', 'never reuse or overwrite an existing rehearsal');
  assert.equal(await docker(['image', 'inspect', image, '--format', '{{.Id}}']), image, 'use existing exact PG17 image; never pull');
  containerId = await docker(['run', '-d', '--name', name, '--label', `letscube.phone-item74.owner=${token}`,
    '--network', 'none', '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
    '--tmpfs', '/tmp:rw,size=256m,mode=1777', '--user', 'postgres', '--entrypoint', '/bin/sleep', image, 'infinity']);
  await inspectOwned();
  console.log(`TARGET ${name}: exact_image=PG17.6 network=none host_mounts=0 published_ports=0`);
  await docker(['exec', containerId, 'initdb', '-D', '/tmp/phone-item74', '-U', 'supabase_admin', '--auth=trust', '--no-locale', '--encoding=UTF8']);
  const settings = freshBackup
    ? ['-c', 'shared_preload_libraries=pg_cron,pg_net,pg_stat_statements,supabase_vault', '-c', 'cron.database_name=phone_item74', '-c', 'cron.launch_active_jobs=off', '-c', 'pg_net.database_name=postgres']
    : ['-c', 'shared_preload_libraries='];
  await docker(['exec', '-d', containerId, 'postgres', '-D', '/tmp/phone-item74', '-c', 'listen_addresses=', '-c', 'unix_socket_directories=/tmp', '-c', 'max_connections=40', ...settings]);
  await waitFor(async () => (await command(['exec', containerId, 'pg_isready', '-h', '/tmp', '-U', 'supabase_admin']).done).code === 0, 'owned postgres ready');
  await query('create database phone_item74;', 'postgres');
  // Live supabase_admin exposes auth in its default path; FK rendering must
  // not make migration self-checks depend on that ambient role configuration.
  await query('alter role supabase_admin set search_path to public, auth, extensions;', 'postgres');
  if (freshBackup) await restoreFreshBackup();
  else await query(fixture);
  const before = JSON.parse(await baselineCatalog());
  assert.equal(before.definition_sha256, '53e17a81ab737d08e419aeaffbef8a16593c76ecd4e80c88afdb59b77006bbe6', 'fixture must match the exact read-only production RPC prestate');
  await query(migration);
  if (process.argv.includes('--quota-control-owner-grant')) {
    await query('grant select, insert, delete on private.phone_lookups to postgres;');
    console.log('CONTROL quota baseline only: log grant supplied to existing RPC owner; quota code unchanged');
  }
  await check('12 simultaneous calls at empty minute quota', () => race(0, '0 seconds', 10, 10, 'minute-empty'));
  await check('12 simultaneous calls at minute boundary 9', () => race(9, '0 seconds', 1, 10, 'minute-nine'));
  await check('12 simultaneous calls at day boundary 99', () => race(99, '2 hours', 1, 100, 'day-99'));
  if (!freshBackup) await check('auth, grants, staff and privacy behavior', functionalChecks);
  await check('real-schema authenticated privacy writes', privacyWrites);
  await check('local ten-digit rejection', localNumberCheck);
  await check('whole-number normalization contract', normalizationChecks);
  await check('transaction lifetime, isolation and current clock', transactionChecks);
  await check('quota retention and account deletion cascade', retentionChecks);
  await check('rollback catalog, staff-only behavior and reapply', async () => {
    await query(rollback);
    assert.deepEqual(JSON.parse(await baselineCatalog()), before, 'rollback restores actual independent prestate including owner, ACL and comments');
    assert.equal(await query("select to_regclass('private.phone_lookups') is null;"), 't');
    assert.equal(await query(rpc()), '0');
    if (!freshBackup) assert.equal(await query(rpc(staff)), '1');
    await query(rollback); // explicitly idempotent
    await query(migration);
    await query(migration);
    await resetLog();
    assert.equal(await query(rpc()), '1');
  });
  if (mutations) await mutationChecks();
  if (inputMutation) await inputMutationCheck();
}

async function mutationChecks() {
  const replace = (source, from, to) => {
    assert.ok(source.includes(from), `mutation anchor missing: ${from}`);
    return source.replace(from, () => to);
  };
  const beforeCheck = (source, statement) => replace(source, 'do $$\n', `${statement}\ndo $$\n`);
  const cases = [
    ['ambient migration path', (s) => replace(s, 'set local search_path = pg_catalog, pg_temp;', ''), 'phone_search_log_shape_incomplete'],
    ['nullable preference', (s) => replace(s, "phone_findable_by text not null default 'everybody'", "phone_findable_by text default 'everybody'"), 'phone_search_preference_incomplete'],
    ['wrong preference default', (s) => replace(s, "default 'everybody'", "default 'contacts'"), 'phone_search_preference_incomplete'],
    ['broadened check', (s) => replace(s, "in ('everybody', 'contacts')", "in ('everybody', 'contacts', 'anything')"), 'phone_search_preference_incomplete'],
    ['lost preference update grant', (s) => beforeCheck(s, 'revoke update on public.privacy_preferences from authenticated;'), 'phone_search_preference_incomplete'],
    ['wrong log owner', (s) => replace(s, 'alter table private.phone_lookups owner to postgres;', ''), 'phone_search_log_owner_incomplete'],
    ...['select', 'insert', 'delete'].map((grant) => [`lost owner ${grant}`, (s) => beforeCheck(s, `revoke ${grant} on private.phone_lookups from postgres;`), 'phone_search_log_owner_incomplete']),
    ['lost cascade', (s) => replace(s, 'references auth.users(id) on delete cascade', 'references auth.users(id)'), 'phone_search_log_shape_incomplete'],
    ['extra log query column', (s) => beforeCheck(s, 'alter table private.phone_lookups add column raw_query text;'), 'phone_search_log_shape_incomplete'],
    ...['public', 'anon', 'authenticated', 'service_role'].map((role) => [`log grant to ${role}`, (s) => beforeCheck(s, `grant insert on private.phone_lookups to ${role};`), 'phone_search_log_permissions_incomplete']),
    ['column-level log grant', (s) => beforeCheck(s, 'grant select(user_id) on private.phone_lookups to authenticated;'), 'phone_search_log_permissions_incomplete'],
    ['lost RPC grant', (s) => replace(s, 'grant execute on function public.search_profiles_by_phone(text, integer)\n  to authenticated;', ''), 'phone_search_rpc_permissions_incomplete'],
    ...['public', 'anon', 'service_role'].map((role) => [`RPC grant to ${role}`, (s) => beforeCheck(s, `grant execute on function public.search_profiles_by_phone(text,integer) to ${role};`), 'phone_search_rpc_permissions_incomplete']),
    ['lost volatile', (s) => replace(s, '\nvolatile\n', '\nstable\n'), 'phone_search_rpc_attributes_incomplete'],
    ['lost definer', (s) => replace(s, '\nsecurity definer\n', '\nsecurity invoker\n'), 'phone_search_rpc_attributes_incomplete'],
    ['unsafe search_path', (s) => replace(s, 'set search_path = pg_catalog, pg_temp', 'set search_path = public, pg_catalog'), 'phone_search_rpc_attributes_incomplete'],
  ];
  await query('create database phone_item74_mutations;', 'postgres');
  const reusableFixture = fixture.replace(/create role [^;]+;/g, '');
  await query(reusableFixture, 'phone_item74_mutations');
  const before = JSON.parse(await baselineCatalog('phone_item74_mutations'));
  for (const [label, mutate, expectedError] of cases) {
    const changed = mutate(migration);
    transactionCheck(changed);
    const result = await session(changed, 'phone_item74_mutations').done;
    assert.notEqual(result.code, 0, `${label}: self-check must abort`);
    assert.ok(result.stderr.includes(expectedError), `${label}: wrong failure: ${result.stderr}`);
    assert.deepEqual(JSON.parse(await baselineCatalog('phone_item74_mutations')), before, `${label}: transaction restores exact RPC`);
    assert.equal(await query(`select to_regclass('private.phone_lookups') is null and not exists
      (select 1 from pg_attribute where attrelid='public.privacy_preferences'::regclass and attname='phone_findable_by' and not attisdropped);`, 'phone_item74_mutations'), 't', `${label}: no partial DDL`);
    console.log(`KILLED self-check mutation: ${label}`);
  }
  checks++;
  console.log(`PASS raising migration self-check mutations=${cases.length}`);
  const afterMigration = JSON.parse(await baselineCatalog());
  const rollbackCases = [
    ['left column', (s) => replace(s, 'alter table public.privacy_preferences drop column if exists phone_findable_by;', '')],
    ['left log', (s) => replace(s, 'drop table if exists private.phone_lookups;', '')],
    ['wrong volatility', (s) => replace(s, '\nstable\n', '\nvolatile\n')],
    ['wrong definer', (s) => replace(s, '\nsecurity definer\n', '\nsecurity invoker\n')],
    ['wrong path', (s) => replace(s, 'set search_path = pg_catalog, public', 'set search_path = public, pg_catalog')],
    ['lost auth grant', (s) => replace(s, 'grant execute on function public.search_profiles_by_phone(text, integer)\n  to authenticated;', '')],
    ...['anon', 'service_role'].map((role) => [`unsafe ${role} grant`, (s) => beforeCheck(s, `grant execute on function public.search_profiles_by_phone(text,integer) to ${role};`)]),
    ['old column comment', (s) => replace(s, 'comment on column public.profile_contacts.phone_discoverable is null;', '')],
    ['old setter comment', (s) => replace(s, 'comment on function public.profile_phone_set_discoverable(boolean) is null;', '')],
  ];
  for (const [label, mutate] of rollbackCases) {
    const changed = mutate(rollback);
    transactionCheck(changed);
    const result = await session(changed).done;
    assert.notEqual(result.code, 0, `${label}: rollback self-check must abort`);
    assert.match(result.stderr, /phone_search_rollback_incomplete/);
    assert.deepEqual(JSON.parse(await baselineCatalog()), afterMigration, `${label}: failed rollback is atomic`);
    console.log(`KILLED rollback self-check mutation: ${label}`);
  }
  checks++;
  console.log(`PASS raising rollback self-check mutations=${rollbackCases.length}`);
  // These mutations pass catalog self-checks; only concurrent behavior can kill them.
  const quotaCases = [
    ['removed account lock', (s) => replace(s, "perform pg_catalog.pg_advisory_xact_lock(\n      pg_catalog.hashtextextended('phone_lookup:' || v_actor::text, 0));", 'null;'), 9, '0 seconds', 1, 10],
    ['removed account lock day', (s) => replace(s, "perform pg_catalog.pg_advisory_xact_lock(\n      pg_catalog.hashtextextended('phone_lookup:' || v_actor::text, 0));", 'null;'), 99, '2 hours', 1, 100],
    ['minute changed to 11', (s) => replace(s, 'v_last_minute >= 10', 'v_last_minute >= 11'), 9, '0 seconds', 1, 10],
    ['day changed to 101', (s) => replace(s, 'v_last_day >= 100', 'v_last_day >= 101'), 99, '2 hours', 1, 100],
  ];
  for (const [label, mutate, seed, age, success, total] of quotaCases) {
    await query(mutate(migration));
    await assert.rejects(() => race(seed, age, success, total, label), { code: 'ERR_ASSERTION' });
    console.log(`KILLED concurrent behavior mutation: ${label}`);
  }
  await query(migration);
  checks++;
  console.log('PASS concurrent quota behavior mutations=4');
  await query(replace(migration, "if current_setting('transaction_isolation') <> 'read committed' then\n      raise exception 'phone_lookup_requires_read_committed' using errcode = '25001';\n    end if;", 'null;'));
  await assert.rejects(transactionChecks, { code: 'ERR_ASSERTION' });
  console.log('KILLED behavior mutation: removed isolation gate');
  await query(replace(migration, 'v_lookup_at := clock_timestamp();', 'v_lookup_at := now();'));
  await assert.rejects(transactionChecks, { code: 'ERR_ASSERTION' });
  console.log('KILLED behavior mutation: transaction-start clock');
  await query(migration);
  checks++;
  console.log('PASS transaction behavior mutations=2');
  await inputMutationCheck();
}

async function inputMutationCheck() {
  const guard = "if left(btrim(p_query), 1) <> '+'\n     and regexp_replace(btrim(p_query), '[ ()-]', '', 'g') !~ '^[78][0-9]{10}$' then\n    return;\n  end if;";
  assert.ok(migration.includes(guard), 'whole-number guard mutation anchor');
  await query(migration.replace(guard, () => 'null;'));
  await assert.rejects(localNumberCheck, { code: 'ERR_ASSERTION' });
  await assert.rejects(normalizationChecks, { code: 'ERR_ASSERTION' });
  console.log('KILLED behavior mutation: removed whole-number input guard (local and international)');
  await query(migration);
  checks++;
  console.log('PASS whole-number behavior mutation=1');
}

try {
  await main();
  assert.ok(checks > 0 && (!selected || selectedChecks > 0), 'no checks matched the requested rehearsal stage');
  console.log(`PASS SUMMARY checks=${checks} skips=0`);
} catch (error) {
  console.error(`FAIL ${error.stack}`);
  process.exitCode = 1;
} finally {
  if (containerId) {
    await inspectOwned();
    await docker(['rm', '-f', containerId]);
    console.log('CLEANUP exact owned container removed; existing containers untouched');
  }
}
