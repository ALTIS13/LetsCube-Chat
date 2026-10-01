import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// No committed fixtures, message bodies, credentials or production captures.
// SQL exercises the live authenticated roles inside one rolled-back transaction.
function parse(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
  }));
}
const env = parse(await readFile(new URL('../../../artifacts/kub/.env.local', import.meta.url), 'utf8'));
const qa = parse(await readFile(process.env.KUB_QA_ENV_FILE ?? join(homedir(), '.kub-messenger-qa.env'), 'utf8'));
const base = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
assert.equal(new URL(base).origin, 'https://core.letscube.ru');
assert.equal(JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role, 'anon');
const sessions = [];
async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}
async function login(role) {
  const email = qa[`KUB_QA_${role}_EMAIL`];
  const password = qa[`KUB_QA_${role}_PASSWORD`];
  assert.ok(email && password, `configured ${role} QA account required`);
  const result = await request('/auth/v1/token?grant_type=password', null, 'POST', { email, password });
  assert.equal(result.status, 200, `QA login HTTP ${result.status}`);
  assert.match(result.data.user.id, /^[0-9a-f-]{36}$/);
  sessions.push(result.data.access_token);
  return { id: result.data.user.id, token: result.data.access_token };
}
async function sql(text) {
  const child = spawn('ssh', ['-i', 'C:/Users/maksi/.ssh/letscube_ed25519', '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10', 'root@ms.letscube.ru',
    'docker exec -i supabase-db psql -X -qAt -v ON_ERROR_STOP=1 -U supabase_admin -d postgres']);
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.resume(); // Never relay database diagnostics containing private values.
  const timer = setTimeout(() => child.kill(), 45000);
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  child.stdin.end(text);
  const code = await done;
  clearTimeout(timer);
  assert.equal(code, 0, 'live SQL acceptance failed; raw diagnostics suppressed');
  return out.trim();
}
const cid = randomUUID();
const mid = randomUUID();
const rev = randomUUID();
const auth = (id) => `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${id}","role":"authenticated"}';`;
const reset = 'RESET ROLE; SET LOCAL request.jwt.claims=\'{}\';';
try {
  const sender = await login('CLIENT');
  const recipient = await login('LOCATION_STAFF');
  assert.notEqual(sender.id, recipient.id);
  const fields = `messages?select=id,mention_entities&id=eq.${mid}`;
  for (const token of [null, sender.token]) {
    const projected = await request(`/rest/v1/${fields}`, token);
    assert.equal(projected.status, 200, `mention projection HTTP ${projected.status}`);
    assert.deepEqual(projected.data, []);
  }
  const denied = await request('/rest/v1/rpc/message_notification_visible', null, 'POST', { p_message_id: mid });
  assert.ok([401, 403].includes(denied.status), 'anonymous helper execution denied');
  const invisible = await request('/rest/v1/rpc/message_notification_visible', recipient.token, 'POST', { p_message_id: mid });
  assert.equal(invisible.status, 200);
  assert.equal(invisible.data, false);
  const entities = JSON.stringify({ version: 1, revision: rev,
    items: [{ kind: 'user', user_id: recipient.id, offset: 0, length: 7, label: '@Member' }] });
  const result = await sql(`BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s';
DO $pre$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id='${sender.id}')
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id='${recipient.id}')
    OR public.is_banned('${sender.id}') OR public.is_banned('${recipient.id}')
    OR EXISTS (SELECT 1 FROM public.user_blocks WHERE blocker_id='${recipient.id}' AND blocked_id='${sender.id}')
    THEN RAISE EXCEPTION 'qa_pair_not_eligible'; END IF;
  IF EXISTS (SELECT 1 FROM public.chats WHERE id='${cid}')
    OR EXISTS (SELECT 1 FROM public.messages WHERE id='${mid}') THEN RAISE EXCEPTION 'fixture_collision'; END IF;
END $pre$;
INSERT INTO public.chats(id,name,type,created_by) VALUES('${cid}','D331 rollback-only acceptance','group','${sender.id}');
INSERT INTO public.chat_members(chat_id,user_id,role,joined_at)
VALUES('${cid}','${recipient.id}','member',clock_timestamp()-interval '1 hour');
UPDATE public.chat_members SET joined_at=clock_timestamp()-interval '1 hour' WHERE chat_id='${cid}';
${auth(sender.id)}
INSERT INTO public.messages(id,chat_id,user_id,content,mention_entities)
VALUES('${mid}','${cid}','${sender.id}','@Member','${entities}'::jsonb);
DO $sender$ BEGIN
  IF (SELECT mention_entities->'items'->0->>'user_id' FROM public.messages WHERE id='${mid}') IS DISTINCT FROM '${recipient.id}'
    THEN RAISE EXCEPTION 'identity_admission_failed'; END IF;
END $sender$;
${reset}
DO $fanout$ BEGIN
  IF (SELECT count(*) FROM public.notifications WHERE kind='message' AND payload->>'message_id'='${mid}')<>1
    THEN RAISE EXCEPTION 'fanout_not_exactly_once'; END IF;
END $fanout$;
${auth(recipient.id)}
DO $recipient$ BEGIN
  IF NOT public.message_notification_visible('${mid}') OR NOT EXISTS (
    SELECT 1 FROM public.notifications WHERE payload->>'message_id'='${mid}'
      AND user_id='${recipient.id}' AND payload->>'mentioned'='true') THEN RAISE EXCEPTION 'recipient_marker_failed'; END IF;
END $recipient$;
${reset}
INSERT INTO public.user_blocks(blocker_id,blocked_id) VALUES('${recipient.id}','${sender.id}');
${auth(recipient.id)}
DO $blocked$ BEGIN
  IF public.message_notification_visible('${mid}') OR EXISTS (
    SELECT 1 FROM public.notifications WHERE payload->>'message_id'='${mid}') THEN RAISE EXCEPTION 'blocked_source_leak'; END IF;
END $blocked$;
${reset}
DELETE FROM public.user_blocks WHERE blocker_id='${recipient.id}' AND blocked_id='${sender.id}';
${auth(sender.id)}
UPDATE public.messages SET content='plain edited text' WHERE id='${mid}';
DO $legacy$ BEGIN
  IF (SELECT jsonb_array_length(mention_entities->'items') FROM public.messages WHERE id='${mid}')<>0
    THEN RAISE EXCEPTION 'legacy_edit_not_cleared'; END IF;
END $legacy$;
${reset}
DO $edit$ BEGIN
  IF (SELECT count(*) FROM public.notifications WHERE kind='message' AND payload->>'message_id'='${mid}')<>1
    OR NOT EXISTS (SELECT 1 FROM public.notifications WHERE payload->>'message_id'='${mid}' AND payload->>'mentioned'='false')
    THEN RAISE EXCEPTION 'edit_repings_or_stale_marker'; END IF;
END $edit$;
ROLLBACK;
DO $clean$ BEGIN
  IF EXISTS (SELECT 1 FROM public.chats WHERE id='${cid}') OR EXISTS(SELECT 1 FROM public.messages WHERE id='${mid}')
    OR EXISTS(SELECT 1 FROM public.notifications WHERE payload->>'message_id'='${mid}')
    THEN RAISE EXCEPTION 'fixture_not_rolled_back'; END IF;
END $clean$;
SELECT 'live_roles_and_rollback_ok';`);
  assert.equal(result, 'live_roles_and_rollback_ok');
  console.log('PASS live PostgREST projection and anonymous denial; authenticated sender/recipient, exactly-once marker, block RLS, legacy edit, rollback leaves no fixtures');
} finally {
  for (const token of sessions) {
    const logout = await request('/auth/v1/logout?scope=local', token, 'POST');
    assert.ok(logout.status >= 200 && logout.status < 300, 'QA session cleanup');
  }
}
