import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// No live SQL connection exists: every SQL process targets this exact new container.
const root = new URL('../../../', import.meta.url);
const image = 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00';
const token = randomUUID();
const name = `letscube-presence-quiet-${token}`;
const db = 'presence_quiet_qa';
const stamp = process.env.PRESENCE_REHEARSAL_BACKUP_STAMP ?? '20261002-003342';
const hash = process.env.PRESENCE_REHEARSAL_BACKUP_SHA256 ?? 'fbb7b3ad00150d66b6a76b9e4ac0e530475b031b3d9f26ffd78036630b321b16';
const tables = Number(process.env.PRESENCE_REHEARSAL_EXPECTED_TABLES ?? 164);
const dataEntries = Number(process.env.PRESENCE_REHEARSAL_EXPECTED_TABLE_DATA ?? 162);
assert.match(stamp, /^20\d{6}-\d{6}$/);
assert.match(hash, /^[a-f0-9]{64}$/);
assert.ok(Number.isSafeInteger(tables) && tables >= 164);
assert.ok(Number.isSafeInteger(dataEntries) && dataEntries >= 162);
const backup = `/srv/letscube/backups/automated/${stamp}/db/supabase-postgres.custom`;
const migrationURL = new URL('supabase/migrations/20261001213205_presence_push_quiet.sql', root);
const rollbackURL = new URL('supabase/migrations/20261001213205_presence_push_quiet.rollback.sql', root);
const red = process.argv.includes('--red');
const mutations = process.argv.includes('--mutations');
const terminalOnly = process.argv.includes('--terminal-only');
const admissionOnly = process.argv.includes('--admission-only');
const observedOnly = process.argv.includes('--observed-only');
const claimMutations = process.argv.includes('--claim-mutations');
const claimOnly = process.argv.includes('--claim-only')||admissionOnly||observedOnly||claimMutations;
const U = n => `81000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C = '82000000-0000-4000-8000-000000000001';
const V = '82000000-0000-4000-8000-000000000002';
const V2 = '82000000-0000-4000-8000-000000000003';
const M = '85000000-0000-4000-8000-000000000001';
const N = '85000000-0000-4000-8000-000000000002';
const claim = '86000000-0000-4000-8000-000000000001';
const targets = ['public._notification_push_allowed(uuid,text,jsonb)', 'private.voice_push_eligible(uuid,uuid,timestamp with time zone)',
  'public.voice_push_claim(integer,uuid)', 'public.album_push_recheck(uuid,uuid)'];
const claimTarget = targets[2];
const claimPreHash = '61dc21c395bc2e15b4090b9a6278c6b57d1b22cde96f0a5898e1e98f55250355';
let id;
let statements = 0;
let checks = 0;
let kills = 0;
const quote = s => `'${s.replaceAll("'", "''")}'`;
const shellQuote = s => `'${s.replaceAll("'", "'\\''")}'`;

function command(args, input = '', timeout = 45000) {
  const child = spawn('ssh', ['-i', 'C:/Users/maksi/.ssh/letscube_ed25519', '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10', 'root@ms.letscube.ru', args.map(shellQuote).join(' ')]);
  let stdout = '', stderr = '';
  child.stdout.on('data', c => { stdout += c; });
  child.stderr.on('data', c => { stderr += c; });
  child.stdin.on('error', () => {});
  const timer = setTimeout(() => child.kill(), timeout);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout: stdout.trim(), stderr }); });
  });
  if (input !== null) child.stdin.end(input);
  return { child, done };
}

async function docker(args, input = '') {
  const r = await command(['docker', ...args], input).done;
  assert.equal(r.code, 0, `isolated Docker ${args[0]} failed; private diagnostics suppressed`);
  return r.stdout;
}

async function owned() {
  assert.match(id, /^[a-f0-9]{64}$/);
  const [c] = JSON.parse(await docker(['inspect', id]));
  assert.equal(c.Id, id);
  assert.equal(c.Name, `/${name}`);
  assert.equal(c.Image, image);
  assert.equal(c.Config.Labels['letscube.presence-quiet.owner'], token);
  assert.equal(c.HostConfig.NetworkMode, 'none');
  assert.equal(c.HostConfig.Privileged, false);
  assert.deepEqual(c.HostConfig.PortBindings, {});
  assert.ok(c.Mounts.every(m => !['bind', 'volume'].includes(m.Type)));
}

function sql(text, database = db) {
  assert.ok(id);
  statements++;
  return command(['docker', 'exec', '-i', id, 'psql', '-X', '-qAt', '-h', '/tmp', '-U',
    'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], text).done;
}
async function q(text, database) {
  const r = await sql(text, database);
  const code = r.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? 'unknown';
  const identifier = r.stderr.match(/constraint "([a-z_][a-z_0-9]*)"/)?.[1]
    ?? r.stderr.match(/(?:column|relation|function) "([a-z_][a-z_0-9]*)"/)?.[1] ?? 'unknown';
  assert.equal(r.code, 0, `isolated SQL failed SQLSTATE=${code} identifier=${identifier}; raw diagnostics suppressed`);
  return r.stdout;
}
const auth = (who, text) => `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${who}"}'; ${text} RESET ROLE; SET LOCAL request.jwt.claims='{}';`;
const tx = text => q(`BEGIN; SET LOCAL statement_timeout='20s'; ${text} ROLLBACK;`);
const status = (value, until = 'NULL', who = U(2), visible = 'true') =>
  `UPDATE public.privacy_preferences SET manual_status=${quote(value)},manual_status_until=${until},presence_visible=${visible} WHERE user_id='${who}';`;
const message = (album = false, messageId = M) => auth(U(1), album
  ? `INSERT INTO public.messages(id,chat_id,user_id,type,content,media_url,media_metadata) VALUES('${messageId}','${C}','${U(1)}','image','synthetic caption','https://invalid.example/presence-image','{"album_id":"presence-isolated-album","album_count":2,"album_index":0}');`
  : `INSERT INTO public.messages(id,chat_id,user_id,content) VALUES('${messageId}','${C}','${U(1)}','synthetic alert');`);
const noteFilter = `user_id='${U(2)}' AND payload->>'message_id'='${M}'`;
const runtime = `UPDATE public.album_push_runtime SET enabled=false,legacy_wns_enabled=true WHERE singleton;`;
const notificationState = `SELECT json_build_array(
  (SELECT count(*) FROM public.notifications WHERE ${noteFilter}),
  (SELECT count(*) FROM public.notifications WHERE ${noteFilter} AND read_at IS NULL),
  (SELECT count(*) FROM public.notifications_push_outbox WHERE user_id='${U(2)}' AND notification_id IN(SELECT id FROM public.notifications WHERE ${noteFilter})),
  (SELECT count(*) FROM public.notifications_native_push_outbox WHERE user_id='${U(2)}' AND notification_id IN(SELECT id FROM public.notifications WHERE ${noteFilter})));`;
const legacySetup = `${runtime} ${message()} UPDATE public.notifications_push_outbox SET claim_token='${claim}',claimed_until=clock_timestamp()+interval '5 minutes' WHERE user_id='${U(2)}' AND notification_id IN(SELECT id FROM public.notifications WHERE ${noteFilter});
  UPDATE public.notifications_native_push_outbox SET claim_token='${claim}',claimed_until=clock_timestamp()+interval '5 minutes' WHERE user_id='${U(2)}' AND notification_id IN(SELECT id FROM public.notifications WHERE ${noteFilter});`;
const legacyRecheck = `SET LOCAL ROLE service_role; SELECT json_build_array(
  (SELECT public.push_outbox_delivery_recheck(id,'${claim}') FROM public.notifications_push_outbox WHERE user_id='${U(2)}' AND notification_id IN(SELECT id FROM public.notifications WHERE ${noteFilter})),
  (SELECT json_agg(public.native_push_outbox_delivery_recheck(o.id,'${claim}') ORDER BY d.provider) FROM public.notifications_native_push_outbox o JOIN public.user_push_devices d ON d.id=o.device_id WHERE o.user_id='${U(2)}' AND o.notification_id IN(SELECT id FROM public.notifications WHERE ${noteFilter}))); RESET ROLE;`;
const ring = auth(U(1), `SELECT count(*) FROM public.voice_call_ring('${V}');`);
const cancel = `${ring} ${status('dnd')} ${auth(U(1),`SELECT public.voice_call_stop(id,'cancelled') IS NOT NULL FROM public.voice_channels WHERE chat_id='${V}' AND ring_caller='${U(1)}';`)}`;
const voiceIsolated = `DELETE FROM vault.secrets WHERE name IN('kub_project_url','kub_push_dispatch_token');
  UPDATE private.voice_push_dispatch_config SET enabled=true WHERE singleton;
  UPDATE public.voice_ring_push_devices SET state='terminal',claim_id=NULL,claimed_until=NULL WHERE event_id IN(SELECT id FROM public.voice_ring_push_events WHERE chat_id NOT IN('${V}','${V2}'));
  UPDATE public.voice_ring_push_events SET state='terminal',terminal_at=clock_timestamp() WHERE state='pending' AND chat_id NOT IN('${V}','${V2}');`;
const fortyVoiceDevices = `INSERT INTO public.user_push_devices(id,user_id,platform,provider,token,token_hash,enabled,session_id,voice_call_protocol)
  SELECT ('89000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${U(2)}','android','fcm','synthetic-bounded-'||n,
    md5('synthetic-bounded-'||n)||md5('synthetic-bounded-'||n),true,'84000000-0000-4000-8000-000000000002',1 FROM generate_series(1,39) n;`;
const invokeRing = (who,chat,table) => auth(who,`CREATE TEMP TABLE ${table} AS SELECT * FROM public.voice_call_ring('${chat}');`);
const voiceAdmissionProbe = (privacy,event='ring') => `${voiceIsolated} ${invokeRing(U(1),V,'admission_room')} ${privacy}
  ${event==='cancel'?auth(U(1),`DO $stop$ BEGIN PERFORM public.voice_call_stop(channel_id,'cancelled') FROM admission_room; END $stop$;`):''}
  SET LOCAL ROLE service_role;
  CREATE TEMP TABLE admission_claims AS SELECT * FROM public.voice_push_claim(20,'${claim}');
  CREATE TEMP TABLE admission_delivery AS SELECT count(*) AS n FROM admission_claims c JOIN public.voice_ring_push_events e ON e.id=c.event_id
    CROSS JOIN LATERAL public.voice_push_prepare(c.event_id,c.push_device_id,c.claim_id) p WHERE e.chat_id='${V}' AND e.event='${event}'; RESET ROLE;
  SELECT json_build_array((SELECT count(*) FROM public.voice_ring_push_events WHERE chat_id='${V}' AND event='${event}'),
    (SELECT count(*) FROM admission_claims c JOIN public.voice_ring_push_events e ON e.id=c.event_id WHERE e.chat_id='${V}' AND e.event='${event}'),
    (SELECT count(*) FROM public.voice_ring_push_devices d JOIN public.voice_ring_push_events e ON e.id=d.event_id
      WHERE e.chat_id='${V}' AND e.event='${event}' AND d.state='terminal' AND d.claim_id IS NULL AND d.claimed_until IS NULL),
    (SELECT n FROM admission_delivery));`;
const voiceLiveLeaseProbe = `${voiceIsolated} ${invokeRing(U(1),V,'lease_room')}
  SET LOCAL ROLE service_role;
  CREATE TEMP TABLE lease_owner_claims AS SELECT * FROM public.voice_push_claim(20,'${claim}'); RESET ROLE;
  ${status('dnd')}
  SET LOCAL ROLE service_role;
  CREATE TEMP TABLE lease_other_claims AS SELECT * FROM public.voice_push_claim(20,'86000000-0000-4000-8000-000000000002'); RESET ROLE;
  CREATE TEMP TABLE lease_retained AS SELECT count(*) AS n FROM public.voice_ring_push_devices d JOIN public.voice_ring_push_events e ON e.id=d.event_id
    WHERE e.chat_id='${V}' AND e.event='ring' AND d.state='claimed' AND d.claim_id='${claim}' AND d.claimed_until>clock_timestamp();
  SET LOCAL ROLE service_role;
  CREATE TEMP TABLE lease_prepare AS SELECT count(*) AS n FROM lease_owner_claims c CROSS JOIN LATERAL public.voice_push_prepare(c.event_id,c.push_device_id,c.claim_id) p; RESET ROLE;
  SELECT json_build_array((SELECT count(*) FROM lease_owner_claims),(SELECT count(*) FROM lease_other_claims),(SELECT n FROM lease_retained),
    (SELECT count(*) FROM public.voice_ring_push_devices d JOIN public.voice_ring_push_events e ON e.id=d.event_id
      WHERE e.chat_id='${V}' AND e.event='ring' AND d.state='terminal' AND d.claim_id IS NULL AND d.claimed_until IS NULL));`;
const albumSuppressionProbe = privacy => `UPDATE public.album_push_runtime SET enabled=true WHERE singleton; ${message(true)}
  UPDATE public.notifications_album_push_outbox SET suppressed_at=clock_timestamp(),claim_token=NULL,claimed_until=NULL
    WHERE sent_at IS NULL AND suppressed_at IS NULL AND group_id NOT IN(SELECT id FROM public.album_push_groups WHERE chat_id='${C}');
  UPDATE public.album_push_groups SET ready_at=clock_timestamp()-interval '1 second' WHERE chat_id='${C}';
  SET LOCAL ROLE service_role;
  CREATE TEMP TABLE suppression_claims AS SELECT * FROM public.album_push_claim(20,'${claim}'); RESET ROLE;
  ${privacy}
  SET LOCAL ROLE service_role;
  CREATE TEMP TABLE suppression_rechecks AS SELECT c.id,r.status FROM suppression_claims c CROSS JOIN LATERAL public.album_push_recheck(c.id,'${claim}') r; RESET ROLE;
  SELECT json_build_array((SELECT count(*) FROM suppression_claims),(SELECT count(*) FROM suppression_rechecks WHERE status='not_eligible'),
    (SELECT count(*) FROM public.notifications_album_push_outbox WHERE id IN(SELECT id FROM suppression_claims) AND suppressed_at IS NOT NULL AND suppression_reason='not_eligible'),
    (SELECT count(*) FROM public.notifications_album_push_outbox WHERE id IN(SELECT id FROM suppression_claims) AND claim_token IS NULL AND claimed_until IS NULL),
    (SELECT count(*) FROM public.notifications WHERE ${noteFilter} AND read_at IS NULL),(SELECT count(*) FROM suppression_rechecks WHERE status='deliver'));`;
const voiceEligible = (now = 'now()', event = 'ring') => `SELECT private.voice_push_eligible(e.id,d.push_device_id,${now}) FROM public.voice_ring_push_events e JOIN public.voice_ring_push_devices d ON d.event_id=e.id WHERE e.chat_id='${V}' AND e.recipient_user_id='${U(2)}' AND e.event='${event}';`;
async function check(label, fn) { await fn(); checks++; console.log(`PASS ${label}`); }

// Lex SQL rather than treating BEGIN/COMMIT strings inside bodies as transaction tags.
function transactionCheck(source) {
  let i = 0, statement = '';
  const out = [];
  while (i < source.length) {
    if (source.startsWith('--', i)) { const n = source.indexOf('\n', i); i = n < 0 ? source.length : n + 1; continue; }
    if (source.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) { depth++; i += 2; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      assert.equal(depth, 0); continue;
    }
    const tag = source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if (tag) { const n = source.indexOf(tag, i + tag.length); assert.ok(n >= 0); statement += ' BODY '; i = n + tag.length; continue; }
    if (source[i] === "'" || source[i] === '"') {
      const ch = source[i++]; let closed = false;
      while (i < source.length) { if (source[i++] === ch) { if (source[i] === ch) i++; else { closed = true; break; } } }
      assert.ok(closed); statement += ' QUOTE '; continue;
    }
    if (source[i] === ';') { if (statement.trim()) out.push(statement.trim().toLowerCase()); statement = ''; i++; }
    else statement += source[i++];
  }
  assert.equal(statement.trim(), '');
  assert.equal(out[0], 'begin'); assert.equal(out.at(-1), 'commit');
  assert.deepEqual(out.filter(s => /^(begin|commit|rollback|abort|end|start|savepoint|release)\b/.test(s)), ['begin', 'commit']);
}

async function catalog() {
  return JSON.parse(await q(`SELECT json_build_object(
    'functions',(SELECT json_agg(json_build_object('identity',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
      'language',p.prolang,'definer',p.prosecdef,'volatile',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,
      'args',p.proargnames,'result',pg_get_function_result(p.oid),'config',p.proconfig,'acl',p.proacl,
      'body',md5(p.prosrc),'ddl',md5(pg_get_functiondef(p.oid))) ORDER BY p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.prokind='f'),
    'relations',(SELECT json_agg(json_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) ORDER BY c.oid)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private') AND c.relkind IN('r','v','m')),
    'triggers',(SELECT json_agg(json_build_object('oid',t.oid,'mode',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.oid)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','auth') AND NOT t.tgisinternal),
    'policies',(SELECT json_agg(json_build_object('oid',p.oid,'name',p.polname,'table',p.polrelid,'command',p.polcmd,'roles',p.polroles,
      'permissive',p.polpermissive,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.oid) FROM pg_policy p),
    'indexes',(SELECT json_agg(json_build_object('oid',i.indexrelid,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid)
      FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private')));`));
}

async function prestate() {
  const actual = JSON.parse(await q(`SELECT json_agg(json_build_array(n.nspname,p.proname,md5(p.prosrc),pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proconfig,p.proacl) ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname,p.proname) IN(('public','_notification_push_allowed'),('private','voice_push_eligible'),('public','presence_beat'));`));
  assert.deepEqual(actual, [
    ['public','_notification_push_allowed','392afad477f324c2a8411df6ff3d0a66','postgres',true,'s',['search_path=""'],['postgres=X/postgres','service_role=X/postgres']],
    ['public','presence_beat','4a5b6de73e542de337633bf6740fd2fe','postgres',false,'v',['search_path=""'],['postgres=X/postgres','authenticated=X/postgres','service_role=X/postgres']],
    ['private','voice_push_eligible','a8d644f63948df3f813641ae2fb6eec0','supabase_admin',true,'s',['search_path=""'],['supabase_admin=X/supabase_admin']],
  ], 'restored function prestate must match the separately observed shipped catalog');
  assert.deepEqual(JSON.parse(await q(`SELECT json_build_array(encode(sha256(convert_to(prosrc,'UTF8')),'hex'),pg_get_userbyid(proowner),prosecdef,provolatile,proconfig,proacl)
    FROM pg_proc WHERE oid=${quote(claimTarget)}::regprocedure;`)),
    [claimPreHash,'supabase_admin',true,'v',['search_path=""'],['supabase_admin=X/supabase_admin','service_role=X/supabase_admin']],
    'restored voice claim exact source/owner/security/volatility/path/ACL');
  assert.deepEqual(JSON.parse(await q(`SELECT json_build_array(encode(sha256(convert_to(prosrc,'UTF8')),'hex'),pg_get_userbyid(proowner),prosecdef,provolatile,proconfig,proacl)
    FROM pg_proc WHERE oid=${quote(targets[3])}::regprocedure;`)),
    ['a696a59fc42f0a3976f01d9894b725a86e60560669af2001a3c47e23cc9825ec','postgres',true,'v',['search_path=pg_catalog'],['postgres=X/postgres','service_role=X/postgres']],
    'restored album recheck exact source/owner/security/volatility/path/ACL');
  assert.deepEqual(JSON.parse(await q(`SELECT json_agg(json_build_array(p.proname,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY p.proname)
    FROM pg_proc p WHERE p.oid IN('public._notification_push_allowed(uuid,text,jsonb)'::regprocedure,'private.voice_push_eligible(uuid,uuid,timestamptz)'::regprocedure);`)), [
    ['_notification_push_allowed','6f560e8edc5ce3d3038f2cc42c6998c1c74b25d566f5a6cfa865ea8d102871f5'],
    ['voice_push_eligible','713baac9ea3adac5b2ccec7b2025cc4e021df429d88cdcb5b47c9a3a8ad43eae'],
  ]);
}

async function create() {
  assert.equal(await docker(['ps','-a','--filter',`name=^/${name}$`,'--format','{{.ID}}']), '');
  assert.equal(await docker(['image','inspect',image,'--format','{{.Id}}']), image);
  const checksum = await command(['sha256sum', backup]).done;
  assert.equal(checksum.code, 0, 'approved backup unreadable');
  assert.equal(checksum.stdout.split(/\s+/)[0], hash, 'approved fresh full backup hash');
  id = await docker(['run','-d','--name',name,'--label',`letscube.presence-quiet.owner=${token}`,'--network','none',
    '--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/tmp:rw,size=256m,mode=1777','--user','postgres','--entrypoint','/bin/sleep',image,'infinity']);
  await owned();
  console.log('TARGET exact-owned PG17.6 network=none ports=0 host-mounts=0; NOT live acceptance');
  await docker(['exec',id,'initdb','-D','/tmp/presence-quiet','-U','supabase_admin','--auth=trust','--no-locale','--encoding=UTF8']);
  await docker(['exec','-d',id,'postgres','-D','/tmp/presence-quiet','-c','listen_addresses=','-c','unix_socket_directories=/tmp',
    '-c','max_connections=40','-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements,supabase_vault',
    '-c',`cron.database_name=${db}`,'-c','cron.launch_active_jobs=off','-c','pg_net.database_name=postgres']);
  let ready = false;
  for (let n = 0; n < 80; n++) {
    if ((await command(['docker','exec',id,'pg_isready','-h','/tmp']).done).code === 0) { ready = true; break; }
    await delay(100);
  }
  assert.ok(ready, 'owned PostgreSQL must actually start');
  await q(`CREATE DATABASE ${db};`, 'postgres');
  const roles = ['anon','authenticated','authenticator','dashboard_user','pgbouncer','postgres','service_role','supabase_auth_admin','supabase_etl_admin',
    'supabase_functions_admin','supabase_privileged_role','supabase_read_only_user','supabase_realtime_admin','supabase_replication_admin','supabase_storage_admin'];
  const bypass = new Set(['postgres','service_role','supabase_etl_admin','supabase_read_only_user']);
  await q(roles.map(r => `CREATE ROLE ${r} NOLOGIN ${bypass.has(r) ? 'BYPASSRLS' : 'NOBYPASSRLS'};`).join('\n'), 'postgres');
  await owned();
  const listing = await command(['bash','-c',`set -o pipefail; docker exec -i ${id} pg_restore --list < ${backup} | awk '/ TABLE DATA / {n++} END {print n+0}'`]).done;
  assert.equal(listing.code, 0, 'backup inventory failed; raw diagnostics suppressed');
  assert.equal(listing.stdout, String(dataEntries));
  // The dump never reaches local disk or tool output. Network-none precedes restore.
  const restore = command(['bash','-c',`docker exec -i ${id} pg_restore --exit-on-error --single-transaction -h /tmp -U supabase_admin -d ${db} < ${backup}`], '', 120000);
  assert.equal((await restore.done).code, 0, 'full restore failed; raw private diagnostics suppressed');
  assert.equal(await q(`SELECT current_setting('server_version')||':'||current_setting('cron.launch_active_jobs')||':'||current_setting('pg_net.database_name');`), '17.6:off:postgres');
  assert.equal(await q(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%';`), String(tables));
  await q('ALTER ROLE supabase_admin SET search_path TO public,auth,extensions; ALTER ROLE postgres SUPERUSER;', 'postgres');
  await prestate();
  console.log(`RESTORE fresh backup SHA256 verified; TABLE DATA=${dataEntries} regular tables=${tables}; shipped function MD5/owner/ACL matched`);
  console.log('RESTORED CONTRACT native WNS declared=' + await q("SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.user_push_devices'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%wns%');"));
  await q(await readFile(new URL('./fixture.sql', import.meta.url), 'utf8'));
}

async function positive() {
  await check('real authenticated message controls: notification=1 unread=1 web=1 FCM=1', async () => {
    assert.deepEqual(JSON.parse(await tx(runtime + message() + notificationState)), [1,1,1,1]);
    assert.deepEqual(JSON.parse(await tx(legacySetup + legacyRecheck)), ['deliver',['deliver']]);
  });
  await check('real voice_call_ring captures one eligible recipient/device, distinct from caller', async () => {
    assert.equal(await tx(ring + voiceEligible()), '1\nt');
  });
}

async function redCases() {
  await positive();
  let failed = 0;
  const actual = JSON.parse(await tx(legacySetup + status('dnd') + legacyRecheck));
  try { assert.deepEqual(actual, ['not_eligible',['not_eligible']]); }
  catch (e) {
    assert.equal(e.code, 'ERR_ASSERTION');
    assert.deepEqual(actual, ['deliver',['deliver']]);
    failed++; console.log('EXPECTED RED message web/FCM predelivery recheck: deliver x2, expected not_eligible x2');
  }
  const actualRing = await tx(ring + status('dnd') + voiceEligible());
  try { assert.equal(actualRing, '1\nf'); }
  catch (e) {
    assert.equal(e.code, 'ERR_ASSERTION'); assert.equal(actualRing, '1\nt');
    failed++; console.log('EXPECTED RED real captured voice RING eligible=true under recipient DND, expected=false');
  }
  assert.equal(failed, 2, 'both shipped omissions must be reached, not harness failures');
  assert.deepEqual(JSON.parse(await tx(runtime + status('dnd') + message() + notificationState)), [1,1,1,1], 'RED enqueue confirms notification survives and both alert targets are still queued');
  console.log('RED SUMMARY expected failures=2 positive controls=2; no migration applied');
}

async function behavior() {
  await positive();
  await check('recipient DND suppresses enqueue, retains in-app row/unread and owner RLS', async () => {
    for (const until of ['NULL', "now()+interval '1 hour'"]) {
      for (const visible of ['true','false']) {
        assert.deepEqual(JSON.parse(await tx(runtime + status('dnd',until,U(2),visible) + message() + notificationState)), [1,1,0,0]);
      }
    }
    assert.equal(await tx(runtime + status('dnd') + message() + auth(U(2),`SELECT count(*) FROM public.notifications WHERE ${noteFilter} AND read_at IS NULL;`)), '1');
    assert.equal(await tx(runtime + status('dnd') + message() + auth(U(3),`SELECT count(*) FROM public.notifications WHERE ${noteFilter};`)), '0');
  });
  await check('expiry equality/past resume new alerts; idle/invisible/absent and caller DND do not suppress', async () => {
    const setups = [status('dnd','now()'),status('dnd',"now()-interval '1 microsecond'"),status('idle'),status('invisible'),
      `DELETE FROM public.privacy_preferences WHERE user_id='${U(2)}';`,status('dnd','NULL',U(1))];
    for (const setup of setups) assert.deepEqual(JSON.parse(await tx(runtime + setup + message() + notificationState)), [1,1,1,1]);
  });
  await check('all provider alert kinds share DND gate without deleting notification rows', async () => {
    for (const kind of ['task_assigned','task_waiting_confirmation','task_confirmed','task_rejected','group_invite','chat_added','mute_issued','ban_issued']) {
      const insert = `INSERT INTO public.notifications(id,user_id,kind,payload) VALUES('${N}','${U(2)}','${kind}','{}');`;
      const counts = `SELECT (SELECT count(*) FROM public.notifications WHERE id='${N}' AND read_at IS NULL)||':'||(SELECT count(*) FROM public.notifications_push_outbox WHERE notification_id='${N}')||':'||(SELECT count(*) FROM public.notifications_native_push_outbox WHERE notification_id='${N}');`;
      assert.equal(await tx(runtime + insert + counts), '1:1:1', kind + ' positive');
      assert.equal(await tx(runtime + status('dnd') + insert + counts), '1:0:0', kind + ' DND');
    }
  });
  await check('already queued legacy web/FCM return supported not_eligible, settle claims, retain unread', async () => {
    assert.deepEqual(JSON.parse(await tx(legacySetup + status('dnd') + legacyRecheck)), ['not_eligible',['not_eligible']]);
    const settlement = `SELECT (SELECT count(*) FROM public.notifications_push_outbox WHERE user_id='${U(2)}' AND suppressed_at IS NOT NULL AND claim_token IS NULL AND claimed_until IS NULL)||':'||(SELECT count(*) FROM public.notifications_native_push_outbox WHERE user_id='${U(2)}' AND last_error='suppressed:not_eligible' AND sent_at IS NOT NULL AND claim_token IS NULL AND claimed_until IS NULL)||':'||(SELECT count(*) FROM public.notifications WHERE ${noteFilter} AND read_at IS NULL);`;
    assert.equal(await tx(legacySetup + status('dnd') + legacyRecheck + settlement), '["not_eligible", ["not_eligible"]]\n1:1:1');
  });
  await albumCases();
  await voiceCases();
  await terminalCases();
}

async function albumCases() {
  const setup = `UPDATE public.album_push_runtime SET enabled=true,legacy_wns_enabled=true WHERE singleton; ${message(true)}
    UPDATE public.notifications_album_push_outbox SET claim_token='${claim}',claimed_until=clock_timestamp()+interval '5 minutes' WHERE group_id IN(SELECT id FROM public.album_push_groups WHERE chat_id='${C}' AND user_id='${U(2)}');`;
  const call = `SELECT r.status FROM public.notifications_album_push_outbox o CROSS JOIN LATERAL public.album_push_recheck(o.id,'${claim}') r WHERE o.group_id IN(SELECT id FROM public.album_push_groups WHERE chat_id='${C}' AND user_id='${U(2)}') ORDER BY o.id;`;
  await check('actual album enqueue/recheck cover web+FCM; DND retains feed', async () => {
    assert.equal(await tx(setup + call), 'deliver\ndeliver');
    assert.equal(await tx(setup + status('dnd') + call), 'not_eligible\nnot_eligible');
    assert.deepEqual(JSON.parse(await tx(status('dnd') + setup + notificationState)), [1,1,0,0]);
    assert.equal(await tx(status('dnd') + setup + `SELECT count(*) FROM public.notifications_album_push_outbox WHERE group_id IN(SELECT id FROM public.album_push_groups WHERE chat_id='${C}' AND user_id='${U(2)}');`), '0');
    for (const until of ['now()', "now()-interval '1 microsecond'"]) assert.equal(await tx(status('dnd',until) + setup + call), 'deliver\ndeliver');
  });
  await check('partial album exact settlement controls distinguish active/expired/caller DND',async () => {
    assert.deepEqual(JSON.parse(await tx(albumSuppressionProbe(status('dnd')))),[2,2,2,2,1,0]);
    for (const privacy of [status('dnd','now()'),status('dnd',"now()-interval '1 microsecond'"),status('dnd','NULL',U(1))]) {
      assert.deepEqual(JSON.parse(await tx(albumSuppressionProbe(privacy))),[2,0,0,0,1,2]);
    }
  });
}

async function voiceCases() {
  await check('real recipient DND gates RING only; supplied p_now decides expiry exactly', async () => {
    for (const visible of ['true','false']) assert.equal(await tx(ring + status('dnd','NULL',U(2),visible) + voiceEligible()), '1\nf');
    assert.equal(await tx(ring + status('dnd',"now()+interval '5 seconds'") + voiceEligible('now()')), '1\nf');
    assert.equal(await tx(ring + status('dnd',"now()+interval '5 seconds'") + voiceEligible("now()+interval '5 seconds'")), '1\nt');
    assert.equal(await tx(ring + status('dnd',"now()+interval '5 seconds'") + voiceEligible("now()+interval '5 seconds 1 microsecond'")), '1\nt');
    for (const setup of [status('idle'),status('invisible'),status('dnd','NULL',U(1)),`DELETE FROM public.privacy_preferences WHERE user_id='${U(2)}';`]) {
      assert.equal(await tx(ring + setup + voiceEligible()), '1\nt');
    }
  });
  await check('real voice cancellation remains eligible under DND, while existing safety gates still refuse', async () => {
    assert.equal(await tx(cancel + voiceEligible('now()','cancel')), '1\nt\nt');
    for (const action of [`UPDATE public.user_push_devices SET enabled=false WHERE user_id='${U(2)}';`,
      `UPDATE auth.sessions SET not_after=now() WHERE user_id='${U(2)}';`,
      `INSERT INTO public.user_blocks(blocker_id,blocked_id) VALUES('${U(2)}','${U(1)}');`]) {
      assert.equal(await tx(cancel + action + voiceEligible('now()','cancel')), '1\nt\nf');
    }
  });
}

async function terminalCases() {
  let failures=0;
  const bounded = async (label,fn) => {
    try { await check(label,fn); }
    catch (e) {
      if (e.code!=='ERR_ASSERTION'||!e.message.startsWith('old refused ')) throw e;
      failures++;
      console.log(`TERMINAL RED ${label}: ${e.message}`);
    }
  };
  const nextClaim = '86000000-0000-4000-8000-000000000002';
  const newId = n => `87000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const albumMessage = (messageId,index,albumId) => auth(U(1),
    `INSERT INTO public.messages(id,chat_id,user_id,type,content,media_url,media_metadata) VALUES('${messageId}','${C}','${U(1)}','image','synthetic terminal control','https://invalid.example/terminal-image',jsonb_build_object('album_id','${albumId}','album_count',2,'album_index',${index}));`);
  for (const complete of [true,false]) {
    for (const dndBeforeClaim of [false,true]) {
    await bounded(`actual ${complete?'complete':'partial'} album DND ${dndBeforeClaim?'before':'after'} claim never replays; new cohort delivers`,async () => {
      const oldAlbum='presence-terminal-old', newAlbum='presence-terminal-new';
      const query=`UPDATE public.album_push_runtime SET enabled=true WHERE singleton;
        ${albumMessage(M,0,oldAlbum)} ${complete?albumMessage(N,1,oldAlbum):''}
        UPDATE public.notifications_album_push_outbox SET suppressed_at=clock_timestamp(),claim_token=NULL,claimed_until=NULL
          WHERE sent_at IS NULL AND suppressed_at IS NULL AND group_id NOT IN(SELECT id FROM public.album_push_groups WHERE chat_id='${C}');
        UPDATE public.album_push_groups SET ready_at=clock_timestamp()-interval '1 second' WHERE chat_id='${C}';
        ${dndBeforeClaim?status('dnd'):''}
        SET LOCAL ROLE service_role;
        CREATE TEMP TABLE old_album_claims AS SELECT * FROM public.album_push_claim(20,'${claim}'); RESET ROLE;
        ${dndBeforeClaim?'':status('dnd')}
        SET LOCAL ROLE service_role;
        CREATE TEMP TABLE album_refusals AS SELECT c.id,r.status FROM old_album_claims c CROSS JOIN LATERAL public.album_push_recheck(c.id,'${claim}') r; RESET ROLE;
        CREATE TEMP TABLE album_settlement AS SELECT count(*) AS terminal,
          (SELECT count(*) FROM public.notifications WHERE user_id='${U(2)}' AND read_at IS NULL AND payload->>'message_id' IN('${M}','${N}')) AS unread
          FROM public.notifications_album_push_outbox WHERE id IN(SELECT id FROM old_album_claims)
          AND suppressed_at IS NOT NULL AND sent_at IS NULL AND claim_token IS NULL AND claimed_until IS NULL;
        ${status('online')}
        ${complete?'':albumMessage(N,1,oldAlbum)}
        -- Make only synthetic retry deadlines overdue, not lease/state/settlement fields.
        UPDATE public.notifications_album_push_outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id IN(SELECT id FROM old_album_claims);
        UPDATE public.album_push_groups SET first_at=clock_timestamp()-interval '61 seconds' WHERE chat_id='${C}' AND album_id='${oldAlbum}';
        ${albumMessage(newId(1),0,newAlbum)} ${albumMessage(newId(2),1,newAlbum)}
        UPDATE public.album_push_groups SET ready_at=clock_timestamp()-interval '1 second' WHERE chat_id='${C}' AND album_id='${newAlbum}';
        SET LOCAL ROLE service_role;
        CREATE TEMP TABLE resumed_album_claims AS SELECT * FROM public.album_push_claim(20,'${nextClaim}');
        CREATE TEMP TABLE resumed_album_delivery AS SELECT c.id,r.status FROM resumed_album_claims c
          CROSS JOIN LATERAL public.album_push_recheck(c.id,'${nextClaim}') r; RESET ROLE;
        SELECT json_build_array((SELECT count(*) FROM old_album_claims),
          (SELECT count(*) FROM album_refusals WHERE status='not_eligible'),(SELECT terminal FROM album_settlement),
          (SELECT unread FROM album_settlement),
          (SELECT count(*) FROM resumed_album_claims WHERE id IN(SELECT id FROM old_album_claims)),
          (SELECT count(*) FROM resumed_album_claims c JOIN public.notifications_album_push_outbox o ON o.id=c.id JOIN public.album_push_groups g ON g.id=o.group_id WHERE g.album_id='${newAlbum}' AND g.chat_id='${C}'),
          (SELECT count(*) FROM resumed_album_delivery r JOIN public.notifications_album_push_outbox o ON o.id=r.id JOIN public.album_push_groups g ON g.id=o.group_id
            WHERE r.status='deliver' AND g.album_id='${newAlbum}' AND g.chat_id='${C}'),
          (SELECT count(*) FROM public.notifications WHERE user_id='${U(2)}' AND read_at IS NULL AND payload->>'message_id' IN('${M}','${N}')));`;
      const actual=JSON.parse(await tx(query));
      assert.deepEqual([actual[0],actual[1],actual[3],actual[5],actual[6]],[2,2,complete?2:1,2,2], 'actual claim/refusal/unread/new-delivery positive controls must all be reached');
      assert.equal(actual[7],2,'late album part remains in unread/feed without reviving old suppressed targets');
      console.log(`TERMINAL ARRAY ${complete?'complete':'partial'} album DND-${dndBeforeClaim?'before':'after'}-claim ${JSON.stringify(actual)}`);
      assert.deepEqual([actual[2],actual[4]],[2,0], 'old refused album targets must settle permanently, not become claimable after DND');
    });
    }
  }
  for (const mode of ['live','pending','expired']) {
    const claimedBeforeDnd=mode!=='pending';
    await bounded(`actual ${mode} RING is terminal after DND; new RING delivers`,async () => {
      const query=`${voiceIsolated}
        ${invokeRing(U(1),V,'old_room')}
        CREATE TEMP TABLE old_voice_events AS SELECT id FROM public.voice_ring_push_events WHERE chat_id='${V}' AND recipient_user_id='${U(2)}' AND event='ring';
        ${claimedBeforeDnd?'':status('dnd')}
        SET LOCAL ROLE service_role;
        CREATE TEMP TABLE old_voice_claims AS SELECT * FROM public.voice_push_claim(20,'${claim}'); RESET ROLE;
        ${claimedBeforeDnd?status('dnd'):''}
        ${mode==='expired'?`UPDATE public.voice_ring_push_devices SET claimed_until=clock_timestamp()-interval '1 microsecond' WHERE event_id IN(SELECT id FROM old_voice_events);`:''}
        SET LOCAL ROLE service_role;
        CREATE TEMP TABLE dnd_voice_admission AS SELECT * FROM public.voice_push_claim(20,'${nextClaim}'); RESET ROLE;
        CREATE TEMP TABLE retained_voice_lease AS SELECT count(*) AS n FROM public.voice_ring_push_devices WHERE event_id IN(SELECT id FROM old_voice_events)
          AND state='claimed' AND claim_id='${claim}' AND claimed_until>clock_timestamp();
        SET LOCAL ROLE service_role;
        CREATE TEMP TABLE refused_prepare AS SELECT count(*) AS n FROM old_voice_claims c CROSS JOIN LATERAL public.voice_push_prepare(c.event_id,c.push_device_id,'${claim}') p; RESET ROLE;
        CREATE TEMP TABLE voice_settlement AS SELECT count(*) AS terminal FROM public.voice_ring_push_devices WHERE event_id IN(SELECT id FROM old_voice_events)
          AND state='terminal' AND claim_id IS NULL AND claimed_until IS NULL;
        ${status('online')}
        SET LOCAL ROLE service_role;
        CREATE TEMP TABLE resumed_old_voice_claims AS SELECT * FROM public.voice_push_claim(20,'${nextClaim}'); RESET ROLE;
        CREATE TEMP TABLE old_voice_still_live AS SELECT count(*) AS n FROM public.voice_ring_push_events WHERE id IN(SELECT id FROM old_voice_events) AND expires_at>clock_timestamp();
        ${auth(U(1),`DO $stop$ BEGIN PERFORM public.voice_call_stop(channel_id,'cancelled') FROM old_room; END $stop$;`)}
        ${invokeRing(U(3),V2,'new_room')}
        SET LOCAL ROLE service_role;
        CREATE TEMP TABLE new_voice_claims AS SELECT * FROM public.voice_push_claim(20,'86000000-0000-4000-8000-000000000003');
        CREATE TEMP TABLE new_voice_delivery AS SELECT count(*) AS n FROM new_voice_claims c JOIN public.voice_ring_push_events e ON e.id=c.event_id
          CROSS JOIN LATERAL public.voice_push_prepare(c.event_id,c.push_device_id,c.claim_id) p WHERE e.chat_id='${V2}' AND e.event='ring'; RESET ROLE;
        SELECT json_build_array((SELECT count(*) FROM old_voice_events),(SELECT count(*) FROM old_voice_claims),
          (SELECT n FROM refused_prepare),(SELECT terminal FROM voice_settlement),(SELECT n FROM old_voice_still_live),
          (SELECT count(*) FROM resumed_old_voice_claims WHERE event_id IN(SELECT id FROM old_voice_events)),
          (SELECT count(*) FROM new_voice_claims c JOIN public.voice_ring_push_events e ON e.id=c.event_id WHERE e.chat_id='${V2}' AND e.event='ring'),
          (SELECT n FROM new_voice_delivery),(SELECT count(*) FROM dnd_voice_admission),(SELECT n FROM retained_voice_lease));`;
      const actual=JSON.parse(await tx(query));
      assert.deepEqual([actual[0],actual[1],actual[2],actual[4],actual[6],actual[7]],[1,claimedBeforeDnd?1:0,0,1,1,1], 'actual claim/refusal/live-old/new-prepare controls must all be reached without projecting tokens');
      assert.deepEqual([actual[8],actual[9]],[0,mode==='live'?1:0], 'DND admission must not steal a live claim from its prepare owner');
      console.log(`TERMINAL ARRAY ${mode} RING ${JSON.stringify(actual)}`);
      assert.deepEqual([actual[3],actual[5]],[1,0], 'old refused RING must be terminal and never claimable after DND, while still unexpired');
    });
  }
  await check('actual CANCEL claim/prepare survives recipient DND',async () => {
    const actual=JSON.parse(await tx(`${voiceIsolated} ${invokeRing(U(1),V,'cancel_room')} ${status('dnd')}
      ${auth(U(1),`DO $stop$ BEGIN PERFORM public.voice_call_stop(channel_id,'cancelled') FROM cancel_room; END $stop$;`)}
      SET LOCAL ROLE service_role;
      CREATE TEMP TABLE cancel_claims AS SELECT * FROM public.voice_push_claim(20,'${claim}');
      CREATE TEMP TABLE cancel_delivery AS SELECT count(*) AS n FROM cancel_claims c JOIN public.voice_ring_push_events e ON e.id=c.event_id
        CROSS JOIN LATERAL public.voice_push_prepare(c.event_id,c.push_device_id,c.claim_id) p WHERE e.chat_id='${V}' AND e.event='cancel'; RESET ROLE;
      SELECT json_build_array((SELECT count(*) FROM public.voice_ring_push_events WHERE chat_id='${V}' AND event='cancel'),
        (SELECT count(*) FROM cancel_claims c JOIN public.voice_ring_push_events e ON e.id=c.event_id WHERE e.chat_id='${V}' AND e.event='cancel'),
        (SELECT n FROM cancel_delivery));`));
    assert.deepEqual(actual,[1,1,1],'a real CANCEL event must remain claimable and preparable under DND');
  });
  await check('actual claim/prepare resumes expiry<=now; recipient identity and presence visibility are independent',async () => {
    for (const privacy of [status('dnd','now()'),status('dnd',"now()-interval '1 microsecond'"),
      status('idle'),status('invisible'),status('dnd','NULL',U(1)),`DELETE FROM public.privacy_preferences WHERE user_id='${U(2)}';`]) {
      assert.deepEqual(JSON.parse(await tx(voiceAdmissionProbe(privacy))),[1,1,0,1], 'expired/non-DND/absent/other-user DND must not terminalize a recipient RING');
    }
    assert.deepEqual(JSON.parse(await tx(voiceAdmissionProbe(status('dnd','NULL',U(2),'false')))),[1,0,1,0], 'private presence must not bypass DND admission suppression');
  });
  console.log(`TERMINAL SUMMARY cases=9 failures=${failures}; actual claims/recheck/prepare; provider sends=0`);
  assert.equal(failures,0,'terminal no-replay contract is not yet satisfied');
}

async function race() {
  await check('two real PG connections serialize stale heartbeat/status writer in both orderings', async () => {
    for (const heartbeatFirst of [true,false]) {
      await q(status('online') + `UPDATE public.privacy_preferences SET last_active_at=now() WHERE user_id='${U(2)}'; UPDATE public.profiles SET online_at=now(),presence_status=NULL WHERE id='${U(2)}';`);
      const firstName = `pq-${token}-holder`, secondName = `pq-${token}-waiter`;
      assert.ok(Buffer.byteLength(firstName)<64 && Buffer.byteLength(secondName)<64, 'PostgreSQL must not truncate observer labels');
      const heartbeat = auth(U(2), `SELECT public.presence_beat(now()-interval '1 hour');`);
      const writer = auth(U(2), "SELECT public.presence_set_status('invisible',NULL);");
      const holder = command(['docker','exec','-i',id,'psql','-X','-qAt','-h','/tmp','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1'], null, 90000);
      let waiter;
      try {
        const barrier = new Promise((resolve,reject) => {
          let output = '';
          const timer = setTimeout(() => reject(new Error('synthetic connection barrier timeout')), 15000);
          holder.child.stdout.on('data', c => { output += c; if (output.includes('PRESENCE_LOCK_HELD')) { clearTimeout(timer); resolve(); } });
          holder.done.then(() => { clearTimeout(timer); reject(new Error('barrier holder ended early')); }, reject);
        });
        holder.child.stdin.write(`BEGIN; SET LOCAL application_name='${firstName}'; SET LOCAL idle_in_transaction_session_timeout='30s'; ${heartbeatFirst ? heartbeat : writer}\n\\echo PRESENCE_LOCK_HELD\n`);
        await barrier;
        assert.equal(await q(`SELECT count(*) FROM pg_stat_activity WHERE datname='${db}' AND application_name='${firstName}';`),'1','observer positive control must find the real barrier holder');
        waiter = sql(`BEGIN; SET LOCAL application_name='${secondName}'; SET LOCAL lock_timeout='25s'; ${heartbeatFirst ? writer : heartbeat} COMMIT;`);
        let blocking = false;
        for (let attempt=0; attempt<40; attempt++) {
          blocking = await q(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.application_name='${firstName}' AND h.datname='${db}' WHERE w.datname='${db}' AND w.application_name='${secondName}' AND w.wait_event_type='Lock' AND h.pid=ANY(pg_blocking_pids(w.pid)));`) === 't';
          if (blocking) break;
          await delay(50);
        }
        assert.ok(blocking, 'second real backend must be blocked by the first transaction, even when heartbeat UPSERT WHERE is false');
        holder.child.stdin.end('COMMIT;\n');
        assert.equal((await holder.done).code,0,'first connection failed; raw diagnostics suppressed');
        const result = await waiter;
        assert.equal(result.code,0,'second connection failed; raw diagnostics suppressed');
        assert.equal(result.stdout,'hidden');
        assert.equal(await q(`SELECT manual_status||':'||(p.online_at IS NULL)||':'||(p.presence_status IS NULL) FROM public.privacy_preferences s JOIN public.profiles p ON p.id=s.user_id WHERE s.user_id='${U(2)}';`),'invisible:true:true');
        console.log(`RACE ${heartbeatFirst ? 'stale-heartbeat -> status-writer' : 'status-writer -> stale-heartbeat'} actual blocking_pids matched holder; final hidden; no false RED`);
      } finally {
        if (!holder.child.stdin.destroyed) holder.child.stdin.end('ROLLBACK;\n');
        await holder.done;
        if (waiter) await waiter;
      }
    }
    await q(status('online'));
  });
}

async function claimFocusedCases(options={}) {
  let failures=0;
  const runSweep=options.sweep??(!admissionOnly&&!observedOnly);
  const phases=options.phases??(admissionOnly?['admission']:observedOnly?['cursor-observed','repeat-observed']:['loop','admission','cursor-observed','repeat-observed']);
  const contract = (actual,expected,label) => {
    console.log(`CLAIM ARRAY ${label} ${JSON.stringify(actual)}`);
    if(options.mutant) {
      const wrong=label.startsWith('two backend')?options.wrongRace:label.startsWith('quiet-only')?options.wrongQuiet:options.wrongMixed;
      assert.deepEqual(actual,wrong,'timing/sweep mutant must reach its literal wrong result, not a setup failure');
      assert.throws(()=>assert.deepEqual(actual,expected),{code:'ERR_ASSERTION'});
      return;
    }
    try { assert.deepEqual(actual,expected,label); checks++; console.log(`PASS ${label}`); }
    catch (e) { if(e.code!=='ERR_ASSERTION') throw e; failures++; console.log(`CLAIM RED ${label}: ${e.message}`); }
  };
  if(runSweep) {
  const wave = n => `SET LOCAL ROLE service_role;
    CREATE TEMP TABLE wave_${n} AS SELECT * FROM public.voice_push_claim(200,'86000000-0000-4000-8000-${String(n+10).padStart(12,'0')}');
    CREATE TEMP TABLE prepare_${n} AS SELECT count(*) AS n FROM wave_${n} c CROSS JOIN LATERAL public.voice_push_prepare(c.event_id,c.push_device_id,c.claim_id) p;
    CREATE TEMP TABLE complete_${n} AS SELECT count(*) FILTER(WHERE public.voice_push_complete(c.event_id,c.push_device_id,c.claim_id,'discarded',NULL,NULL)) AS n FROM wave_${n} c;
    RESET ROLE;
    CREATE TEMP TABLE quiet_${n} AS SELECT count(*) AS n FROM public.voice_ring_push_devices d JOIN public.voice_ring_push_events e ON e.id=d.event_id
      WHERE e.id IN(SELECT id FROM quiet_events) AND d.state='terminal' AND d.claim_id IS NULL AND d.claimed_until IS NULL;`;
  const bounded=JSON.parse(await tx(`${voiceIsolated} ${fortyVoiceDevices}
    ${invokeRing(U(1),V,'quiet_room')} ${invokeRing(U(3),V2,'progress_room')}
    ${status('dnd')}
    ${auth(U(3),`DO $stop$ BEGIN PERFORM public.voice_call_stop(channel_id,'cancelled') FROM progress_room; END $stop$;`)}
    -- The stopped control room is not part of the forty quiet-target cohort.
    UPDATE public.voice_ring_push_devices SET state='terminal',claim_id=NULL,claimed_until=NULL WHERE event_id IN(SELECT id FROM public.voice_ring_push_events WHERE chat_id='${V2}' AND event='ring');
    UPDATE public.voice_ring_push_events SET state='terminal',terminal_at=clock_timestamp() WHERE chat_id='${V2}' AND event='ring';
    CREATE TEMP TABLE quiet_events AS SELECT id FROM public.voice_ring_push_events WHERE chat_id='${V}' AND event='ring' AND state='pending';
    CREATE TEMP TABLE progress_events AS SELECT id FROM public.voice_ring_push_events WHERE chat_id='${V2}' AND event='cancel' AND state='pending';
    CREATE TEMP TABLE quiet_initial AS SELECT count(*) AS n FROM public.voice_ring_push_devices WHERE event_id IN(SELECT id FROM quiet_events) AND state='pending';
    ${wave(1)} ${wave(2)} ${wave(3)} ${wave(4)}
    SELECT json_build_array((SELECT n FROM quiet_initial),(SELECT n FROM quiet_1),(SELECT n FROM quiet_2),(SELECT n FROM quiet_3),(SELECT n FROM quiet_4),
      (SELECT count(*) FROM wave_1),(SELECT n FROM prepare_1),(SELECT n FROM complete_1),
      (SELECT count(*) FROM wave_2),(SELECT n FROM prepare_2),(SELECT n FROM complete_2),
      (SELECT count(*) FROM wave_3),(SELECT n FROM prepare_3),(SELECT n FROM complete_3),(SELECT count(*) FROM wave_4),
      (SELECT count(*) FROM public.voice_ring_push_events WHERE id IN(SELECT id FROM quiet_events) AND expires_at>clock_timestamp()),
      (SELECT count(*) FROM public.voice_ring_push_devices WHERE event_id IN(SELECT id FROM progress_events) AND state='terminal'));`));
  assert.deepEqual([bounded[0],...bounded.slice(5)],[40,16,16,16,16,16,16,8,8,8,0,1,40],
    'forty real captured quiet devices, CANCEL claim/prepare/complete waves and live deadline positive controls');
  contract(bounded.slice(1,5),[20,40,40,40],'bounded sweep literal20 repeated waves/drain with CANCEL progress');
  const quietOnly=JSON.parse(await tx(`${voiceIsolated} ${fortyVoiceDevices} ${invokeRing(U(1),V,'quiet_only_room')} ${status('dnd')}
    CREATE TEMP TABLE quiet_events AS SELECT id FROM public.voice_ring_push_events WHERE chat_id='${V}' AND event='ring' AND state='pending';
    CREATE TEMP TABLE quiet_initial AS SELECT count(*) AS n FROM public.voice_ring_push_devices WHERE event_id IN(SELECT id FROM quiet_events) AND state='pending';
    ${wave(1)} ${wave(2)} ${wave(3)}
    SELECT json_build_array((SELECT n FROM quiet_initial),(SELECT n FROM quiet_1),(SELECT n FROM quiet_2),(SELECT n FROM quiet_3),
      (SELECT count(*) FROM wave_1),(SELECT count(*) FROM wave_2),(SELECT count(*) FROM wave_3),
      (SELECT count(*) FROM public.voice_ring_push_events WHERE id IN(SELECT id FROM quiet_events) AND expires_at>clock_timestamp()),
      (SELECT count(*) FROM public.voice_ring_push_devices WHERE event_id IN(SELECT id FROM quiet_events) AND state='pending'));`));
  assert.deepEqual([quietOnly[0],...quietOnly.slice(4)],[40,0,0,0,1,0],'forty real quiet targets remain unexpired and never produce a provider claim');
  contract(quietOnly.slice(1,4),[36,40,40],'quiet-only literal36 bounded first wave then drain');
  }

  for(const phase of phases) {
  const phaseChat=['loop','cursor-observed'].includes(phase)?V:V2, phaseCaller=phaseChat===V?U(1):U(3);
  const endsAfterObservation=phase.endsWith('-observed');
  const original=await q(`SELECT pg_get_functiondef(${quote(claimTarget)}::regprocedure);`);
  const hookCatalog=await catalog();
  const holderName=`pq-${token}-dnd`, claimantName=`pq-${token}-claim`;
  let holder,claimant,claimResponse;
  try {
    const seed=JSON.parse(await q(`BEGIN; ${voiceIsolated} ${status('online')} ${invokeRing(phaseCaller,phaseChat,'race_room')}
      SELECT json_build_array(count(DISTINCT e.id),min(e.id::text),count(*),sum(private.voice_push_eligible(e.id,d.push_device_id,clock_timestamp())::integer),
        sum((e.expires_at>clock_timestamp())::integer)) FROM public.voice_ring_push_devices d JOIN public.voice_ring_push_events e ON e.id=d.event_id
      WHERE e.chat_id='${phaseChat}' AND e.event='ring' AND d.state='pending'; COMMIT;`));
    assert.deepEqual([seed[0],seed[2],seed[3],seed[4]],[1,1,1,1],'one real eligible unexpired pending RING/device before DND admission race');
    const eventId=seed[1];
    assert.match(eventId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    const loopAnchor='  loop\n    v_now := pg_catalog.clock_timestamp();', cursorAnchor='  for v_row in\n';
    const lock = key => `    perform pg_catalog.pg_advisory_xact_lock(20261002,${key});\n`;
    const firstInLoop=['loop','repeat-observed'].includes(phase);
    const anchor=firstInLoop?loopAnchor:cursorAnchor;
    assert.equal(original.split(anchor).length-1,1,'one real admission-loop timing anchor');
    let instrumented=original.replace(anchor,firstInLoop
      ? `  loop\n    if v_row.event_id='${eventId}'::uuid then\n${lock(37)}    end if;\n    v_now := pg_catalog.clock_timestamp();`
      : `  if p_claim_id='${claim}'::uuid then\n${lock(37)}  end if;\n  for v_row in\n`);
    if(phase==='cursor-observed') instrumented=instrumented.replace(loopAnchor,
      `  loop\n    if v_row.event_id='${eventId}'::uuid then\n${lock(38)}    end if;\n    v_now := pg_catalog.clock_timestamp();`);
    if(phase==='repeat-observed') {
      const observed=/\binto\s+v_eligible\s*,\s*v_quiet\s*;/gi;
      assert.equal([...instrumented.matchAll(observed)].length,1,'one repeat eligibility/quiet observation statement');
      instrumented=instrumented.replace(observed,m=>`${m}\n    if v_row.event_id='${eventId}'::uuid then\n${lock(38)}    end if;`);
    }
    await q(instrumented+'\n;');
    holder=command(['docker','exec','-i',id,'psql','-X','-qAt','-h','/tmp','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1'],null,90000);
    const barrier=new Promise((resolve,reject)=>{
      let output='';
      const timer=setTimeout(()=>reject(new Error('claim timing barrier timeout')),15000);
      holder.child.stdout.on('data',c=>{output+=c;if(output.includes('CLAIM_BARRIER_HELD')){clearTimeout(timer);resolve();}});
      holder.done.then(()=>{clearTimeout(timer);reject(new Error('claim barrier holder ended early'));},reject);
    });
    holder.child.stdin.write(`BEGIN; SET application_name='${holderName}'; SET LOCAL idle_in_transaction_session_timeout='30s';
      SELECT pg_catalog.pg_advisory_xact_lock(20261002,37); ${endsAfterObservation?'SELECT pg_catalog.pg_advisory_lock(20261002,38);':''}\n\\echo CLAIM_BARRIER_HELD\n`);
    await barrier;
    assert.equal(await q(`SELECT count(*) FROM pg_stat_activity WHERE datname='${db}' AND application_name='${holderName}';`),'1','observer finds the real barrier owner');
    claimant=sql(`BEGIN; SET LOCAL application_name='${claimantName}'; SET LOCAL lock_timeout='25s'; SET LOCAL ROLE service_role;
      CREATE TEMP TABLE racing_claim AS SELECT * FROM public.voice_push_claim(20,'${claim}'); RESET ROLE;
      SELECT json_build_array((SELECT count(*) FROM racing_claim WHERE event_id='${eventId}'),
        (SELECT count(*) FROM public.voice_ring_push_devices WHERE event_id='${eventId}' AND state='terminal' AND claim_id IS NULL AND claimed_until IS NULL),
        (SELECT count(*) FROM public.voice_ring_push_events WHERE id='${eventId}' AND expires_at>clock_timestamp())); COMMIT;`);
    claimant.then(r=>{claimResponse=r;});
    const waitBlocked = async key => {
      for(let n=0;n<40;n++) {
        const blocked=await q(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity c JOIN pg_stat_activity h ON h.datname='${db}' AND h.application_name='${holderName}'
          JOIN pg_locks l ON l.pid=c.pid AND NOT l.granted AND l.locktype='advisory' AND l.classid=20261002::oid AND l.objid=${key}::oid
          WHERE c.datname='${db}' AND c.application_name='${claimantName}' AND c.wait_event_type='Lock' AND h.pid=ANY(pg_blocking_pids(c.pid)));`)==='t';
        if(blocked) return;
        if(claimResponse) {
          const sqlstate=claimResponse.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]??'unknown';
          assert.equal(claimResponse.code,0,`timing hook ${key} phase=${phase} SQLSTATE=${sqlstate}; raw diagnostics suppressed`);
          assert.fail(`timing hook ${key} phase=${phase} was not reached; controlled claim result=${JSON.stringify(JSON.parse(claimResponse.stdout))}`);
        }
        await delay(50);
      }
      assert.fail(`actual claimant must reach timing hook ${key} phase=${phase} and block on the real DND writer`);
    };
    await waitBlocked(37);
    const enableDnd=`${auth(U(2),"SELECT public.presence_set_status('dnd',NULL);")} COMMIT;\n`;
    if(endsAfterObservation) {
      holder.child.stdin.write(enableDnd);
      await waitBlocked(38);
      assert.equal(await q(`SELECT manual_status FROM public.privacy_preferences WHERE user_id='${U(2)}';`),'dnd','DND is active at the completed cursor/repeat observation');
      holder.child.stdin.end(`BEGIN; ${auth(U(2),"SELECT public.presence_set_status('online',NULL);")} COMMIT; SELECT pg_catalog.pg_advisory_unlock(20261002,38);\n`);
    } else holder.child.stdin.end(enableDnd);
    assert.equal((await holder.done).code,0,'DND writer failed; raw private diagnostics suppressed');
    assert.equal(await q(`SELECT manual_status FROM public.privacy_preferences WHERE user_id='${U(2)}';`),endsAfterObservation?'online':'dnd','real writer commits the requested state before the final claim decision');
    const response=await claimant;
    assert.equal(response.code,0,'real claim response failed; raw private diagnostics suppressed');
    const actual=JSON.parse(response.stdout);
    assert.equal(actual[2],1,'racing RING is still unexpired, not expired by the probe');
    const replay=Number(await q(`BEGIN; ${status('online')} SET LOCAL ROLE service_role;
      CREATE TEMP TABLE replay_claim AS SELECT * FROM public.voice_push_claim(20,'86000000-0000-4000-8000-000000000004'); RESET ROLE;
      SELECT count(*) FROM replay_claim WHERE event_id='${eventId}'; COMMIT;`));
    contract([actual[0],actual[1],actual[2],replay],[0,1,1,0],`two backend DND-before-${phase} refusal is terminal/no-replay`);
  } finally {
    if(holder&&!holder.child.stdin.destroyed) holder.child.stdin.end('ROLLBACK;\n');
    if(holder) await holder.done;
    if(claimant) await claimant;
    await q(original+'\n;');
    assert.deepEqual(await catalog(),hookCatalog,'timing-only instrumentation restores its exact pre-hook catalog');
    await q(`BEGIN; ${auth(phaseCaller,`DO $stop$ BEGIN PERFORM public.voice_call_stop(id,'cancelled') FROM public.voice_channels WHERE chat_id='${phaseChat}'; END $stop$;`)}
      UPDATE public.voice_ring_push_devices SET state='terminal',claim_id=NULL,claimed_until=NULL WHERE event_id IN(SELECT id FROM public.voice_ring_push_events WHERE chat_id='${phaseChat}');
      UPDATE public.voice_ring_push_events SET state='terminal',terminal_at=clock_timestamp() WHERE chat_id='${phaseChat}'; COMMIT;`);
  }
  }
  console.log(`CLAIM ${options.mutant?'MUTANT':'FOCUSED'} SUMMARY groups=${phases.length+(runSweep?2:0)} failures=${failures}; timing-only hooks removed; provider sends=0`);
  assert.equal(failures,0,'claim admission race and bounded sweep contracts must both pass');
}

async function claimTimingMutations() {
  const original=await q(`SELECT pg_get_functiondef(${quote(claimTarget)}::regprocedure);`);
  const before=await catalog();
  const once=(source,pattern,replacement)=>{
    assert.equal([...source.matchAll(new RegExp(pattern.source,'gi'))].length,1,'one unique focused claim semantic-mutation anchor');
    return source.replace(pattern,replacement);
  };
  const badPending=[0,0,1,1],badClaimed=[1,0,1,0];
  const cases=[
    ['sweep LIMIT omission',s=>once(s,/    limit v_limit\n    for update of d skip locked/i,'    for update of d skip locked'),
      {sweep:true,phases:[],wrongMixed:[40,40,40,40],wrongQuiet:[40,40,40]}],
    ['cursor active-DND admission omission',s=>once(s,/q\.quiet or private\.voice_push_eligible\(d\.event_id, d\.push_device_id, pg_catalog\.clock_timestamp\(\)\)/i,
      'private.voice_push_eligible(d.event_id, d.push_device_id, pg_catalog.clock_timestamp())'),
      {sweep:false,phases:['admission'],wrongRace:badPending}],
    ['carried cursor quiet observation omission',s=>once(s,/v_row\.quiet or exists/i,'exists'),
      {sweep:false,phases:['cursor-observed'],wrongRace:badClaimed}],
    ['quiet-or-ineligible settlement condition omission',s=>once(s,/if v_quiet or not v_eligible then/i,'if not v_eligible then'),
      {sweep:false,phases:['cursor-observed'],wrongRace:badClaimed}],
    ['locked loop DND terminalization omission',s=>once(s,/if v_quiet then/i,'if false then'),
      {sweep:false,phases:['loop'],wrongRace:badPending}],
    ['repeat quiet cause wrongly reread after observation',s=>once(s,/if v_quiet then/i,`if exists (
        select 1 from public.voice_ring_push_events e join public.privacy_preferences p on p.user_id=e.recipient_user_id
        where e.id=v_row.event_id and e.event='ring' and p.manual_status='dnd'
          and (p.manual_status_until is null or p.manual_status_until>pg_catalog.clock_timestamp())
      ) then`),{sweep:false,phases:['repeat-observed'],wrongRace:badPending}],
  ];
  for(const [label,change,probe] of cases) {
    try {
      await q(change(original)+'\n;');
      await claimFocusedCases({...probe,mutant:true});
      kills++; console.log(`KILLED ${label}`);
    } finally {
      await q(original+'\n;');
      await poststate();
      assert.deepEqual(await catalog(),before,'focused semantic mutant restores the exact frozen candidate catalog');
    }
  }
}

function contracts(value) {
  return {...value,functions:value.functions.map(({body,ddl,...metadata}) => metadata)};
}

async function artifacts() {
  const [migrationBytes,rollbackBytes] = await Promise.all([readFile(migrationURL),readFile(rollbackURL)]);
  for (const [url,bytes,hash] of [[migrationURL,migrationBytes,'9bb6f9fdc0917f33b7ba97b4c2d35927ef3dc28b2c6e2d9bc6c3e6242b182d97'],
    [rollbackURL,rollbackBytes,'2eff120ce0ab0399ebb7c7929efc69f321b9f15ae49d7c1bf659131594046466']]) {
    const source=bytes.toString('utf8');
    assert.ok(Buffer.from(source,'utf8').equals(bytes),'migration/rollback must contain valid UTF8');
    transactionCheck(source);
    assert.ok(bytes.equals(await readFile(new URL('.migration-backup/'+url.href.slice(root.href.length),root))),'migration/rollback byte parity');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,'independently supplied frozen raw artifact hash');
    console.log(`ARTIFACT SHA256=${hash}`);
  }
  const migration=migrationBytes.toString('utf8'),rollback=rollbackBytes.toString('utf8');
  assert.throws(() => transactionCheck(migration+'\nROLLBACK;'));
  return {migration,rollback};
}

async function poststate() {
  assert.deepEqual(JSON.parse(await q(`SELECT json_agg(json_build_array(p.proname,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY p.proname)
    FROM pg_proc p WHERE p.oid IN(${targets.map(t=>`${quote(t)}::regprocedure`).join(',')});`)), [
    ['_notification_push_allowed','b143091b64cf9f1ccf1c1fcef7970411270d2dd4dacbbf8cc1ea002dc6176846'],
    ['album_push_recheck','277bf3db9264699c3cc8743ce25e597bc0321a8cd5f1c6595a1ddb7d0277233b'],
    ['voice_push_claim','5af34854c7fd96923baf85191db2af06333a6f932600c93974e0e9dcb1af5f9c'],
    ['voice_push_eligible','86208b67c5cd15c86316ca459d0681511aef44b7bbbfc7a7e240851de25454ce'],
  ],'literal independently supplied poststate source hashes');
}

async function mutationCases(migration,rollback,before) {
  // Mutate the installed bodies inside one rolled-back transaction, never files.
  const replaceOnce = (source,pattern,replacement) => {
    assert.equal([...source.matchAll(new RegExp(pattern.source,'gi'))].length,1,'one reached mutation anchor, not a silent omission');
    return source.replace(pattern,replacement);
  };
  const replaceMany = (source,pattern,replacement,count) => {
    const all=new RegExp(pattern.source,'gi');
    assert.equal([...source.matchAll(all)].length,count,'literal expected claim mutation anchors, not an assumed exactly-once rule');
    return source.replace(all,replacement);
  };
  const cases = [
    ['message DND omission',targets[0],s => replaceOnce(s,/manual_status\s*=\s*'dnd'/i,"manual_status = 'idle'"),
      runtime+status('dnd')+message()+notificationState,'[1, 1, 0, 0]','[1, 1, 1, 1]'],
    ['ring DND omission',targets[1],s => replaceOnce(s,/manual_status\s*=\s*'dnd'/i,"manual_status = 'idle'"),
      ring+status('dnd')+voiceEligible(),'1\nf','1\nt'],
    ['message expiry equality',targets[0],s => replaceOnce(s,/manual_status_until\s*>\s*(?:pg_catalog\.)?now\(\)/i,m => m.replace('>','>=')),
      runtime+status('dnd','now()')+message()+notificationState,'[1, 1, 1, 1]','[1, 1, 0, 0]'],
    ['ring expiry equality',targets[1],s => replaceOnce(s,/manual_status_until\s*>\s*p_now/i,m => m.replace('>','>=')),
      ring+status('dnd',"now()+interval '5 seconds'")+voiceEligible("now()+interval '5 seconds'"),'1\nt','1\nf'],
    ['ring wrong clock',targets[1],s => replaceOnce(s,/manual_status_until\s*>\s*p_now/i,m => m.replace('p_now','pg_catalog.now()')),
      ring+status('dnd',"now()+interval '5 seconds'")+voiceEligible("now()+interval '5 seconds'"),'1\nt','1\nf'],
    ['message caller mistaken for recipient',targets[0],s => replaceOnce(s,/p\.user_id\s*=\s*p_user_id/i,'p.user_id = auth.uid()'),
      runtime+status('dnd')+message()+notificationState,'[1, 1, 0, 0]','[1, 1, 1, 1]'],
    ['ring caller mistaken for recipient',targets[1],s => replaceOnce(s,/p\.user_id\s*=\s*e\.recipient_user_id/i,'p.user_id = e.caller_user_id'),
      ring+status('dnd')+voiceEligible(),'1\nf','1\nt'],
    ['ring cancellation wrongly quieted',targets[1],s => replaceOnce(s,/e\.event\s*=\s*'cancel'/i,m => `(${m} and not exists(select 1 from public.privacy_preferences p where p.user_id=e.recipient_user_id and p.manual_status='dnd' and (p.manual_status_until is null or p.manual_status_until>p_now)))`),
      cancel+voiceEligible('now()','cancel'),'1\nt\nt','1\nt\nf'],
    ['pending RING terminalization omission',targets[2],s => replaceMany(s,/p\.manual_status\s*=\s*'dnd'/i,"p.manual_status = 'idle'",3),
      voiceAdmissionProbe(status('dnd')),'[1, 0, 1, 0]','[1, 0, 0, 0]'],
    ['pending RING expiry omitted',targets[2],s => replaceMany(s,/p\.manual_status_until\s*>\s*(?:v_now|pg_catalog\.clock_timestamp\(\))/i,'true',3),
      voiceAdmissionProbe(status('dnd','now()')),'[1, 1, 0, 1]','[1, 0, 1, 0]'],
    ['pending RING caller mistaken for recipient',targets[2],s => replaceMany(s,/p\.user_id\s*=\s*e\.recipient_user_id/i,'p.user_id = e.caller_user_id',3),
      voiceAdmissionProbe(status('dnd')),'[1, 0, 1, 0]','[1, 0, 0, 0]'],
    ['pending RING guard wrongly terminalizes CANCEL',targets[2],s => replaceMany(s,/e\.event\s*=\s*'ring'/i,"e.event in ('ring','cancel')",3),
      voiceAdmissionProbe(status('dnd'),'cancel'),'[1, 1, 0, 1]','[1, 0, 1, 0]'],
    ['pending RING guard steals live prepare ownership',targets[2],s => replaceMany(s,/d\.claimed_until\s*<=\s*v_now/i,'true',2),
      voiceLiveLeaseProbe,'[1, 0, 1, 1]','[1, 0, 0, 1]'],
    ['partial album terminalization omission',targets[3],s => replaceOnce(s,/p\.manual_status\s*=\s*'dnd'/i,"p.manual_status = 'idle'"),
      albumSuppressionProbe(status('dnd')),'[2, 2, 2, 2, 1, 0]','[2, 2, 0, 2, 1, 0]'],
    ['partial album expiry omitted',targets[3],s => replaceOnce(s,/p\.manual_status_until\s*>\s*v_now/i,'true'),
      albumSuppressionProbe(status('dnd','now()')),'[2, 0, 0, 0, 1, 2]','[2, 2, 2, 2, 1, 0]'],
    ['partial album sender mistaken for recipient',targets[3],s => replaceOnce(s,/p\.user_id\s*=\s*v_outbox\.user_id/i,'p.user_id = v_outbox.sender_id'),
      albumSuppressionProbe(status('dnd')),'[2, 2, 2, 2, 1, 0]','[2, 2, 0, 2, 1, 0]'],
  ];
  for (const [label,signature,change,probe,expected,unfixed] of cases) {
    const original = await q(`SELECT pg_get_functiondef(${quote(signature)}::regprocedure);`);
    const changed = change(original);
    assert.match(changed,/\$[A-Za-z_0-9]*\$\s*;?\s*$/,'pg_get_functiondef must end with its dollar quote, not a psql command tag');
    assert.equal(await tx(probe),expected,'unmutated positive control must reach the literal acceptance result');
    const actual = await tx(changed+'\n;\n'+probe);
    assert.equal(actual,unfixed,'mutant must reach the intended wrong behavior, not SQL/setup failure');
    assert.throws(() => assert.equal(actual,expected), {code:'ERR_ASSERTION'});
    kills++; console.log(`KILLED ${label}`);
  }
  const applied = await catalog();
  for (const originalRestoredHash of ['6f560e8edc5ce3d3038f2cc42c6998c1c74b25d566f5a6cfa865ea8d102871f5',
    '713baac9ea3adac5b2ccec7b2025cc4e021df429d88cdcb5b47c9a3a8ad43eae',claimPreHash,
    'a696a59fc42f0a3976f01d9894b725a86e60560669af2001a3c47e23cc9825ec']) {
  assert.equal(rollback.split(originalRestoredHash).length-1,1,'one rollback post-hash anchor');
  const brokenRollback = await sql(rollback.replace(originalRestoredHash,'0'.repeat(64)));
  assert.notEqual(brokenRollback.code,0);
  assert.match(brokenRollback.stderr,/presence_quiet_rollback_selfcheck_failed/);
  assert.deepEqual(await catalog(),applied,'wrong rollback post-hash rolls back all four restored bodies');
  kills++; console.log('KILLED rollback wrong post-hash; patched catalog retained atomically');
  }
  await q(rollback);
  assert.deepEqual(await catalog(),before);
  const blocks = [...migration.matchAll(/\bDO\s+(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)/gi)];
  assert.ok(blocks.length>=2,'migration must include both real prestate and raising poststate blocks');
  const first = blocks[0].index, last = blocks.at(-1).index;
  for (const drift of [`ALTER FUNCTION public._notification_push_allowed(uuid,text,jsonb) SECURITY INVOKER;`,
    `ALTER FUNCTION public._notification_push_allowed(uuid,text,jsonb) OWNER TO supabase_admin;`,
    `GRANT EXECUTE ON FUNCTION private.voice_push_eligible(uuid,uuid,timestamptz) TO authenticated;`,
    `ALTER FUNCTION public.album_push_recheck(uuid,uuid) SECURITY INVOKER;`,
    `REVOKE EXECUTE ON FUNCTION public.voice_push_claim(integer,uuid) FROM service_role;`]) {
    const r = await sql(migration.slice(0,first)+`SET LOCAL ROLE supabase_admin; ${drift}\n`+migration.slice(first));
    assert.notEqual(r.code,0,'migration prestate drift guard must raise');
    assert.ok(/drift|prestate/i.test(r.stderr),'failure must be the intended migration guard, not arbitrary SQL');
    kills++; console.log('KILLED migration prestate owner/security/ACL drift');
    assert.deepEqual(await catalog(),before,'failed prestate transaction must restore catalog');
  }
  for (const change of [`ALTER FUNCTION public._notification_push_allowed(uuid,text,jsonb) SECURITY INVOKER;`,
    `ALTER FUNCTION private.voice_push_eligible(uuid,uuid,timestamptz) SET search_path=public;`,
    `GRANT EXECUTE ON FUNCTION private.voice_push_eligible(uuid,uuid,timestamptz) TO authenticated;`,
    `ALTER FUNCTION public.album_push_recheck(uuid,uuid) IMMUTABLE;`,
    `GRANT EXECUTE ON FUNCTION public.voice_push_claim(integer,uuid) TO anon;`]) {
    const r = await sql(migration.slice(0,last)+`SET LOCAL ROLE supabase_admin; ${change}\n`+migration.slice(last));
    assert.notEqual(r.code,0,'migration selfcheck must actually raise');
    assert.ok(/selfcheck|poststate|incomplete/i.test(r.stderr),'failure must be the intended poststate selfcheck');
    assert.deepEqual(await catalog(),before,'failed selfcheck must roll back all four patched bodies and catalog');
    kills++; console.log('KILLED migration selfcheck security/search_path/ACL; atomic rollback');
  }
  for (const expectedPostHash of ['b143091b64cf9f1ccf1c1fcef7970411270d2dd4dacbbf8cc1ea002dc6176846',
    '86208b67c5cd15c86316ca459d0681511aef44b7bbbfc7a7e240851de25454ce',
    '5af34854c7fd96923baf85191db2af06333a6f932600c93974e0e9dcb1af5f9c',
    '277bf3db9264699c3cc8743ce25e597bc0321a8cd5f1c6595a1ddb7d0277233b']) {
  assert.equal(migration.split(expectedPostHash).length-1,1,'one migration post-hash anchor');
  const brokenHash = await sql(migration.replace(expectedPostHash,'0'.repeat(64)));
  assert.notEqual(brokenHash.code,0);
  assert.match(brokenHash.stderr,/presence_quiet_selfcheck_failed/);
  assert.deepEqual(await catalog(),before,'wrong post-hash selfcheck atomically rolls back all four body insertions');
  kills++; console.log('KILLED migration wrong post-hash; original catalog restored atomically');
  }
  await q(migration);
}

try {
  assert.ok(process.argv.slice(2).every(a => ['--red','--mutations','--terminal-only','--claim-only','--admission-only','--observed-only','--claim-mutations'].includes(a)));
  assert.ok(!(red && mutations),'choose RED baseline or migration mutations');
  assert.ok(!terminalOnly||(!red&&!mutations),'terminal-only runs alone');
  assert.ok(!claimOnly||(!red&&!mutations&&!terminalOnly),'claim-only runs alone');
  const savedArtifacts=red?null:await artifacts();
  await create();
  const before = await catalog();
  if (red) {
    await redCases();
    await race();
    assert.deepEqual(await catalog(),before,'RED and race must not change source/catalog');
  } else {
    const {migration,rollback} = savedArtifacts;
    await owned();
    await q(migration);
    await poststate();
    const after = await catalog();
    assert.deepEqual(contracts(after),contracts(before),'endpoints/signatures/owners/ACL/RLS/triggers unchanged');
    assert.deepEqual(after.functions.filter((f,i) => f.body!==before.functions[i].body).map(f => f.identity).sort(),
      targets.map(t=>t.replace(/^public\./,'')).sort(),'only four intended function bodies change');
    if (claimOnly) {
      await claimFocusedCases();
      if(claimMutations) await claimTimingMutations();
      assert.deepEqual(await catalog(),after,'timing instrumentation restores the exact candidate catalog');
      console.log(`CLAIM GREEN groups=${checks} mutant kills=${kills} SQL calls=${statements} skips=0`);
    } else if (terminalOnly) {
      await terminalCases();
      console.log(`TERMINAL GREEN groups=${checks} SQL calls=${statements} skips=0`);
    } else {
    await behavior();
    await race();
    if (mutations) await mutationCases(migration,rollback,before);
    await q(rollback);
    assert.deepEqual(await catalog(),before,'rollback exact catalog parity');
    console.log('PASS rollback exact function body/owner/ACL/RLS/trigger/index parity');
    await q(migration);
    await poststate();
    await behavior();
    console.log('PASS reapply with repeated literal behavior acceptance');
    await claimFocusedCases();
    if(mutations) await claimTimingMutations();
    console.log(`GREEN SUMMARY groups=${checks} mutant kills=${kills} SQL calls=${statements} skips=0; isolated SQL only, provider sends=0`);
    }
  }
} catch (e) {
  // Only controlled assertions may carry synthetic results; never expose SQL diagnostics.
  console.error(`FAIL ${e.message}`);
  process.exitCode=1;
} finally {
  if (id) { await owned(); await docker(['rm','-f',id]); console.log('CLEANUP exact owned container removed'); }
}
