import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseEnv } from 'node:util';

const origin = 'https://core.letscube.ru';
const fixtureSha = '1d35ba9565d0781d0733c8e5ab5fa027381b2570eeb41a608fdda8d932c08b56';
const fixtureSize = 3608655;
const fixture = new URL('../../.ops-private/gallery-fixture39-20261025/runs/c0a3901e-220d-468f-9f54-3aac3db7a8c1/original.png', import.meta.url);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (value, code) => { if (!value) throw Error(code); };
const lit = value => "'" + value.replaceAll("'", "''") + "'";
const claims = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
const safe = error => /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'PRIVATE_ERROR';

test('Task 5: source membership revoke versus live Storage signing and byte access', {
  skip: process.env.LETSCUBE_TASK5_SOURCE_REVOKE !== '1' && 'explicit scoped live QA only',
  timeout: 300_000,
}, async t => {
  let stage = 'PREFLIGHT';
  try {
    need(process.env.KUB_QA_ALLOW_MUTATIONS === '0', 'BROWSER_MUTATION_FLAG_REFUSED');
    const { exactTarget, sql, remote } = await import('../../.ops-private/native-preview-task5-metadata-observer-20261009/retirement-db.mjs');
    const target = exactTarget();
    const query = text => JSON.parse(sql(`BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='2s'; ${text}; ROLLBACK;`));
    const bytes = readFileSync(fixture);
    need(bytes.length === fixtureSize && sha(bytes) === fixtureSha, 'FIXTURE_BYTES_REFUSED');
    const config = parseEnv(readFileSync(new URL('../../artifacts/kub/.env.local', import.meta.url), 'utf8'));
    const qa = parseEnv(readFileSync(join(homedir(), '.kub-messenger-qa.env'), 'utf8'));
    const key = config.VITE_SUPABASE_PUBLISHABLE_KEY || config.VITE_SUPABASE_ANON_KEY;
    need(config.VITE_SUPABASE_URL?.replace(/\/$/, '') === origin && key &&
      (key.startsWith('sb_publishable_') || claims(key).role === 'anon'), 'PUBLIC_CONFIG_REFUSED');
    const users = ['OWNER', 'CLIENT'].map(role => ({
      email: qa[`KUB_QA_${role}_EMAIL`], password: qa[`KUB_QA_${role}_PASSWORD`],
    }));
    need(users.every(u => /^[A-Za-z0-9_.+@-]{1,254}$/.test(u.email ?? '') && u.password) &&
      users[0].email.toLowerCase() !== users[1].email.toLowerCase(), 'QA_CREDENTIALS_REFUSED');
    const accounts = () => query(`SELECT json_agg(json_build_object('uid',u.id,
      'eligible',p.is_test_account AND u.email_confirmed_at IS NOT NULL AND NOT public.is_banned(u.id),
      'sids',ARRAY(SELECT id FROM auth.sessions WHERE user_id=u.id ORDER BY id))
      ORDER BY lower(u.email) <> lower(${lit(users[0].email)}))
      FROM auth.users u JOIN public.profiles p ON p.id=u.id
      WHERE lower(u.email) IN (lower(${lit(users[0].email)}),lower(${lit(users[1].email)}))`);
    const before = accounts();
    need(before?.length === 2 && before.every(a => a.eligible && uuid(a.uid)), 'QA_ACCOUNT_NOT_CONFIRMED');
    const [owner, reader] = before.map((a, i) => ({ ...a, ...users[i] }));
    const posture = query(`SELECT json_build_object('public',(SELECT public FROM storage.buckets WHERE id='media'),
      'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='storage.objects'::regclass),
      'scoped',EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
        AND policyname='media authenticated scoped read' AND cmd='SELECT'))`);
    need(posture.public === true && posture.rls === true && posture.scoped === true, 'STORAGE_POSTURE_CHANGED');
    const image = remote(['docker','ps','--filter','name=^/supabase-storage$','--format','{{.Image}}']);
    need(/^supabase\/storage-api:v[0-9.]+$/.test(image), 'STORAGE_RUNTIME_REFUSED');

    const chat = randomUUID(), message = randomUUID();
    const name = `QA Task5 ${chat}`;
    const path = `${owner.uid}/${chat}-task5-original.png`;
    const messageFilter = `id=eq.${message}&chat_id=eq.${chat}`;
    const memberFilter = `chat_id=eq.${chat}&user_id=eq.${reader.uid}`;
    const chatFilter = `id=eq.${chat}&created_by=eq.${owner.uid}&type=eq.group&name=eq.${encodeURIComponent(name)}`;
    const object = `/storage/v1/object`;
    const stats = () => query(`SELECT json_build_object(
      'group',(SELECT count(*) FROM public.chats WHERE id='${chat}'),
      'owned',(SELECT count(*) FROM public.chats WHERE id='${chat}' AND created_by='${owner.uid}' AND type='group' AND name=${lit(name)}),
      'members',(SELECT count(*) FROM public.chat_members WHERE chat_id='${chat}'),
      'ownerMember',(SELECT count(*) FROM public.chat_members WHERE chat_id='${chat}' AND user_id='${owner.uid}' AND role='owner'),
      'readerMember',(SELECT count(*) FROM public.chat_members WHERE chat_id='${chat}' AND user_id='${reader.uid}' AND role='member'),
      'messages',(SELECT count(*) FROM public.messages WHERE chat_id='${chat}' OR id='${message}'),
      'foreignMessages',(SELECT count(*) FROM public.messages WHERE chat_id='${chat}' AND id<>'${message}' AND type IS DISTINCT FROM 'system'),
      'file',(SELECT count(*) FROM public.messages WHERE id='${message}'),
      'fileBound',(SELECT count(*) FROM public.messages WHERE id='${message}' AND chat_id='${chat}' AND user_id='${owner.uid}'
        AND ((deleted_at IS NULL AND media_bucket='media' AND media_path='${path}') OR (deleted_at IS NOT NULL AND media_path IS NULL))),
      'live',(SELECT count(*) FROM public.messages WHERE id='${message}' AND deleted_at IS NULL),
      'otherReferences',(SELECT count(*) FROM public.messages WHERE media_bucket='media' AND media_path='${path}' AND id<>'${message}'),
      'invites',(SELECT count(*) FROM public.group_invites WHERE chat_id='${chat}'),
      'objects',(SELECT count(*) FROM storage.objects WHERE bucket_id='media' AND name='${path}'),
      'ownedObject',(SELECT count(*) FROM storage.objects WHERE bucket_id='media' AND name='${path}' AND owner_id='${owner.uid}'
        AND metadata->>'size'='${fixtureSize}'),
      'variants',(SELECT count(*) FROM public.media_variants WHERE chat_id='${chat}' OR message_id='${message}'),
      'purge',(SELECT count(*) FROM private.message_media_purge WHERE message_id='${message}' AND (status<>'done' OR finished_at IS NULL OR claimed_until IS NOT NULL)),
      'purgedExact',(SELECT count(*) FROM private.message_media_purge WHERE message_id='${message}' AND bucket='media' AND path='${path}' AND status='done' AND finished_at IS NOT NULL AND claimed_until IS NULL))`);
    need(Object.values(stats()).every(n => n === 0), 'FIXTURE_PRESTATE_NOT_EMPTY');
    console.log(JSON.stringify({ stage: 'armed', chat, message, storageImage: image }));

    const http = async (url, { actor, api = true, method = 'GET', body, upload = false, rows = false } = {}) => {
      const targetUrl = new URL(url, origin);
      need(targetUrl.origin === origin && !targetUrl.username && !targetUrl.password, 'HTTP_TARGET_REFUSED');
      return fetch(targetUrl, {
        method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
        headers: {
          ...(api ? { apikey: key } : {}),
          ...(actor?.token ? { Authorization: `Bearer ${actor.token}` } : {}),
          ...(body === undefined ? {} : upload
            ? { 'Content-Type': 'image/png', 'cache-control': 'max-age=0', 'x-upsert': 'false' }
            : { 'Content-Type': 'application/json' }),
          ...(rows ? { Prefer: 'return=representation' } : {}),
        },
        body: body === undefined || upload ? body : JSON.stringify(body),
      });
    };
    const accepted = async (response, label) => {
      need(response.ok, `${label}_HTTP_${response.status}`);
      await response.body?.cancel();
    };
    const signIn = async actor => {
      const res = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: actor.email, password: actor.password } });
      need(res.ok, `QA_AUTH_HTTP_${res.status}`);
      const { access_token: token } = await res.json();
      const { sub, role, session_id: sid } = claims(token);
      need(sub === actor.uid && role === 'authenticated' && uuid(sid) && !actor.sids.includes(sid), 'QA_SESSION_NOT_OWNED');
      Object.assign(actor, { token, sid });
      need(accounts().find(a => a.uid === actor.uid)?.sids.includes(sid), 'QA_SESSION_NOT_LIVE');
    };
    const write = (table, body, method = 'POST', actor = owner, rows = false) => http(`/rest/v1/${table}`, { actor, method, body, rows });
    const sign = async actor => {
      const res = await http(`${object}/sign/media/${path}`, { actor, method: 'POST', body: { expiresIn: 60 } });
      const payload = await res.json();
      if (!res.ok) return { status: res.status, code: Number(payload.statusCode ?? res.status) };
      need(typeof payload.signedURL === 'string' && payload.signedURL.startsWith('/object/sign/media/'), 'SIGNED_RESPONSE_REFUSED');
      const url = new URL(`/storage/v1${payload.signedURL}`, origin);
      need(url.pathname === `${object}/sign/media/${path}` && url.searchParams.has('token'), 'SIGNED_OBJECT_REFUSED');
      return { status: res.status, url };
    };
    const denied = result => !result.url && [400, 403, 404].includes(result.status) && [403, 404].includes(result.code);
    const readBytes = async (url, label, actor) => {
      const res = await http(url, { api: Boolean(actor), actor });
      need(res.status === 200, `${label}_HTTP_${res.status}`);
      const stream = res.body.getReader();
      const digest = createHash('sha256');
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await stream.read();
          if (done) break;
          size += value.byteLength;
          need(size <= fixtureSize, `${label}_TOO_LARGE`);
          digest.update(value);
        }
      } finally {
        await stream.cancel().catch(() => {});
        stream.releaseLock();
      }
      need(size === fixtureSize && digest.digest('hex') === fixtureSha, `${label}_BYTES_REFUSED`);
      return res.status;
    };
    const visible = async () => {
      const res = await http(`/rest/v1/messages?select=id&${messageFilter}`, { actor: reader });
      need(res.ok, `MESSAGE_VISIBILITY_HTTP_${res.status}`);
      const rows = await res.json();
      need(Array.isArray(rows) && rows.length <= 1 && rows.every(row => row.id === message), 'MESSAGE_VISIBILITY_REFUSED');
      return rows.length;
    };
    let mainFailure, cleanupFailure, authFailure;
    let creationDispatched = false;
    try {
      stage = 'AUTH';
      await signIn(owner);
      await signIn(reader);
      stage = 'SEED';
      creationDispatched = true;
      await accepted(await write('chats', { id: chat, created_by: owner.uid, type: 'group', name }), 'CREATE_GROUP');
      let state = stats();
      need(state.owned === 1 && state.members === 1 && state.ownerMember === 1, 'SENDER_ONLY_SCOPE_REQUIRED');
      await accepted(await http(`${object}/media/${path}`, { actor: owner, method: 'POST', body: bytes, upload: true }), 'UPLOAD');
      await accepted(await write('messages', { id: message, chat_id: chat, user_id: owner.uid, type: 'file',
        media_bucket: 'media', media_path: path, media_url: `${origin}${object}/public/media/${path}`,
        media_metadata: { file_name: 'task5-original.png', mime_type: 'image/png', size_bytes: fixtureSize },
      }), 'INSERT_FILE');
      state = stats();
      need(state.ownedObject === 1 && state.fileBound === 1 && state.live === 1 && state.members === 1 && state.variants === 0, 'SEED_BINDING_REFUSED');

      stage = 'NONMEMBER_CONTROL';
      const outsider = await sign(reader);
      t.diagnostic(`pre-join sign: HTTP ${outsider.status}, Storage ${outsider.code ?? 'signed'}`);
      need(denied(outsider) && await visible() === 0, 'NONMEMBER_SHOULD_NOT_SIGN');

      stage = 'MEMBER_CONTROL';
      await accepted(await write('chat_members', { chat_id: chat, user_id: reader.uid, role: 'member' }), 'ADD_QA_MEMBER');
      state = stats();
      need(state.members === 2 && state.ownerMember === 1 && state.readerMember === 1 && await visible() === 1, 'MEMBER_CONTROL_REFUSED');
      const issued = await sign(reader);
      need(issued.status === 200 && issued.url, `MEMBER_SIGN_HTTP_${issued.status}`);
      t.diagnostic(`member sign/byte GET: ${issued.status}/${await readBytes(issued.url, 'MEMBER_BYTES')}; SHA-256 matched`);

      stage = 'REVOKE';
      const revoke = await write(`chat_members?${memberFilter}&role=eq.member&select=user_id`, undefined, 'DELETE', owner, true);
      need(revoke.ok, `REVOKE_HTTP_${revoke.status}`);
      const removed = await revoke.json();
      need(removed.length === 1 && removed[0].user_id === reader.uid, 'EXACT_MEMBERSHIP_NOT_REVOKED');
      state = stats();
      need(state.members === 1 && state.ownerMember === 1 && state.readerMember === 0 && state.live === 1 && state.ownedObject === 1, 'REVOKE_POSTSTATE_REFUSED');
      const after = await sign(reader);
      t.diagnostic(`post-revoke sign, same JWT: HTTP ${after.status}, Storage ${after.code ?? 'signed'}`);
      need(denied(after) && await visible() === 0, 'REVOKED_READER_CAN_STILL_SIGN_OR_SEE_MESSAGE');

      stage = 'POST_REVOKE_BYTE_CONTROLS';
      const old = await readBytes(issued.url, 'PREVIOUSLY_SIGNED_BYTES');
      const publicRead = await readBytes(`${object}/public/media/${path}`, 'ANONYMOUS_PUBLIC_BYTES');
      const own = await readBytes(`${object}/authenticated/media/${path}`, 'UPLOADER_BYTES', owner);
      t.diagnostic(`after revoke: old signature/public anonymous/authenticated uploader GET ${old}/${publicRead}/${own}; all SHA-256 matched`);
    } catch (error) {
      mainFailure = `${stage}_${safe(error)}`;
    } finally {
      if (creationDispatched) try {
        let state = stats();
        need(state.group === state.owned && state.members === state.ownerMember + state.readerMember &&
          state.foreignMessages === 0 && state.otherReferences === 0 && state.invites === 0 &&
          state.file === state.fileBound && state.objects === state.ownedObject && state.variants === 0, 'CLEANUP_SCOPE_REFUSED');
        if (state.live) await accepted(await write('rpc/delete_messages_for_everyone', { p_message_ids: [message] }), 'DELETE_FIXTURE_MESSAGE');
        if (!state.file && state.objects) await accepted(await http(object + '/media', {
          actor: owner, method: 'DELETE', body: { prefixes: [path] },
        }), 'REMOVE_UNREFERENCED_FIXTURE');
        const deadline = Date.now() + 145_000;
        for (state = stats(); state.objects || state.purge; state = stats()) {
          need(Date.now() < deadline, 'EXACT_PURGE_NOT_SETTLED');
          await sleep(2500);
        }
        need(state.live === 0 && (!state.file || state.purgedExact === 1), 'PURGE_TERMINAL_STATE_REFUSED');
        if (state.owned) await accepted(await write(`chats?${chatFilter}`, undefined, 'DELETE'), 'DELETE_FIXTURE_CHAT');
        state = stats();
        const { purgedExact, ...active } = state;
        need(Object.values(active).every(n => n === 0), 'FIXTURE_ROWS_OR_OBJECT_REMAIN');
        const absent = await http(`${object}/public/media/${path}`, { api: false, method: 'HEAD' });
        need([400, 404].includes(absent.status), `EXACT_OBJECT_STILL_REACHABLE_HTTP_${absent.status}`);
        t.diagnostic(`cleanup: exact fixture counts zero, terminal purge receipts ${purgedExact}, anonymous HEAD ${absent.status}`);
      } catch (error) { cleanupFailure = safe(error); }
      for (const actor of [reader, owner]) if (actor.sid) try {
        await accepted(await http('/auth/v1/logout?scope=local', { actor, method: 'POST' }), 'LOCAL_LOGOUT');
      } catch (error) { authFailure = safe(error); }
      try {
        const after = accounts();
        need(after.length === 2 && [owner, reader].every(actor => {
          const current = after.find(a => a.uid === actor.uid);
          return current && current.sids.length === actor.sids.length && actor.sids.every(sid => current.sids.includes(sid));
        }), 'AUTH_BASELINE_NOT_RESTORED');
        need(JSON.stringify(exactTarget()) === JSON.stringify(target), 'DB_TARGET_CHANGED');
        t.diagnostic('Auth audit: both original SID sets unchanged, no new SID remains');
      } catch (error) { authFailure ||= safe(error); }
    }
    if (mainFailure || cleanupFailure || authFailure) {
      t.diagnostic(`run=${mainFailure ?? 'OK'} cleanup=${cleanupFailure ?? 'OK'} auth=${authFailure ?? 'OK'}`);
      throw Error('SCOPED_QA_NOT_ACCEPTED');
    }
  } catch (error) {
    // Never pass response bodies, assertion operands, URLs or credentials to TAP.
    throw Error(`${stage}_${safe(error)}`);
  }
});
