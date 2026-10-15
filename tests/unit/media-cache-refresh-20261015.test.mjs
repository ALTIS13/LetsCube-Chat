import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Actual compiled utilities; only signer, clock and scheduling are controlled.
// Historical playback RED evidence stays in the private audit, not this suite.
const root = new URL('../../artifacts/kub/src/', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const storePath = 'lib/media/signedMediaUrlStore.ts';
const cachePath = 'lib/mediaCacheControl.ts';
function pure(path, overrides = {}, globals = {}) {
  const source = overrides[path] ?? read(path), imports = {};
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  for (const node of parsed.statements) if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
    const name = node.moduleSpecifier.text;
    assert.ok(name.startsWith('.'), `blocked import ${name}`);
    const url = new URL(name, new URL(path, root));
    imports[name] = pure(url.href.slice(root.href.length), overrides, globals);
  }
  const module = { exports: {} };
  const result = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports, Date, URL,
    require(name) { assert.ok(Object.hasOwn(imports, name)); return imports[name]; }, ...globals });
  return module.exports;
}
function signing({ source, ttlSeconds, failureCooldownMs, globals } = {}) {
  const { createSignedMediaUrlStore } = pure(storePath, source ? { [storePath]: source } : {}, globals);
  let now = 0; const queued = [], calls = [];
  const store = createSignedMediaUrlStore({ now: () => now, schedule: fn => queued.push(fn), ttlSeconds, failureCooldownMs,
    sign: (bucket, paths, ttl) => new Promise((resolve, reject) => calls.push({ bucket, paths: [...paths], ttl,
      answer: url => resolve(paths.map(path => ({ path, signedUrl: url }))),
      refuse: () => resolve(paths.map(path => ({ path, signedUrl: null, error: 'fixture refusal' }))), reject,
    })),
  });
  return { store, calls, clock: ms => { now = ms; }, flush() {
    let steps = 0;
    while (queued.length) { assert.ok(++steps < 20, 'unbounded scheduling'); queued.shift()(); }
  } };
}
const ref = { bucket: 'media', path: 'fictional-owner/voice.ogg' };
const oldUrl = 'https://media.invalid/storage/v1/object/sign/media/fictional-owner/voice.ogg?fixture=old';
const newUrl = 'https://media.invalid/storage/v1/object/sign/media/fictional-owner/voice.ogg?fixture=new';
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
async function issue(f, url = oldUrl) {
  f.store.get(ref); f.flush(); f.calls.at(-1).answer(url); await tick();
}

test('normal issuance renews at 2880000ms and withholds below the 3300000ms floor', async () => {
  const f = signing(); await issue(f);
  assert.equal(f.calls[0].bucket, 'media'); assert.equal(f.calls[0].ttl, 3600);
  f.clock(2_879_999); assert.equal(f.store.get(ref), oldUrl); f.flush(); assert.equal(f.calls.length, 1);
  f.clock(2_880_000); assert.equal(f.store.get(ref), oldUrl); f.flush(); assert.equal(f.calls.length, 2);
  f.clock(3_299_999); assert.equal(f.store.get(ref), oldUrl);
  f.clock(3_300_000); assert.equal(f.store.get(ref), null);
  f.calls[1].answer(newUrl); await tick(); assert.equal(f.store.get(ref), newUrl);
});

test('response latency is charged to lifetime, but queue delay before signing is not', async () => {
  const f = signing(); f.store.get(ref); f.clock(1_000_000); f.flush();
  f.clock(1_001_000); f.calls[0].answer(oldUrl); await tick();
  f.clock(3_879_999); f.store.get(ref); f.flush(); assert.equal(f.calls.length, 1);
  f.clock(3_880_000); assert.equal(f.store.get(ref), oldUrl); f.flush(); assert.equal(f.calls.length, 2);
});

async function delayedResponseContract(source) {
  const f = signing({ source }); f.store.get(ref); f.flush();
  f.clock(3_600_001); f.calls[0].answer(oldUrl); await tick();
  assert.equal(f.store.get(ref), null, 'DELAYED_SIGN_RESPONSE_MUST_NOT_REDATE_EXPIRY');
  assert.equal(f.store.hasCachedSignatureFor(oldUrl), false);
  for (let i = 0; i < 50; i++) f.store.get(ref);
  f.flush(); assert.equal(f.calls.length, 1);
  f.clock(3_630_000); f.store.get(ref); f.flush(); assert.equal(f.calls.length, 1);
  f.clock(3_630_001); f.store.get(ref); f.flush(); assert.equal(f.calls.length, 2);
  f.calls[1].answer(newUrl); await tick(); assert.equal(f.store.get(ref), newUrl);
}
test('a response delivered after expiry is not redated fresh and waits 30000ms before retry', async () => {
  await delayedResponseContract();
});

test('an unusably short TTL cannot create an immediate subscribed signing loop', async () => {
  const f = signing({ ttlSeconds: 60 });
  const stop = f.store.subscribe(() => f.store.get(ref));
  await issue(f); assert.equal(f.store.get(ref), null);
  f.flush(); assert.equal(f.calls.length, 1, 'spent offer must cool down even during notification');
  f.clock(29_999); f.store.get(ref); f.flush(); assert.equal(f.calls.length, 1);
  f.clock(30_000); f.store.get(ref); f.flush(); assert.equal(f.calls.length, 2); stop();
});

test('a zero failure-cooldown option still cannot reschedule in the same clock instant', async () => {
  const f = signing({ ttlSeconds: 60, failureCooldownMs: 0 }); await issue(f);
  for (let i = 0; i < 50; i++) f.store.get(ref);
  f.flush(); assert.equal(f.calls.length, 1);
  f.clock(1); f.store.get(ref); f.flush(); assert.equal(f.calls.length, 2);
});

test('a stale renewal preserves buffered identity and arms its 30000ms retry boundary', async () => {
  let id = 0; const timers = new Map();
  const window = { addEventListener() {}, removeEventListener() {},
    setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id; },
    clearTimeout(timer) { timers.delete(timer); } };
  const f = signing({ globals: { window } });
  const stop = f.store.subscribe(() => f.store.get(ref)); await issue(f);
  f.clock(2_880_000); f.store.get(ref); f.flush();
  f.clock(6_480_001); f.calls[1].answer(newUrl); await tick();
  assert.equal(f.store.get(ref), null);
  assert.equal(f.store.hasCachedSignatureFor(oldUrl), true, 'expiry is not buffer revocation');
  f.flush(); assert.equal(f.calls.length, 2);
  assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 30_000);
  f.clock(6_510_001); [...timers.values()][0].fn(); f.flush();
  assert.equal(f.calls.length, 3); stop();
});

test('transient renewal failure preserves the old usable URL and cannot publish an access refusal', async () => {
  const f = signing(); await issue(f);
  f.clock(2_880_000); f.store.get(ref); f.flush();
  f.calls[1].reject(new Error('fixture offline')); await tick();
  assert.equal(f.store.hasCachedSignatureFor(oldUrl), true);
  assert.equal(f.store.get(ref), oldUrl);
  f.clock(3_300_000); assert.equal(f.store.get(ref), null);
});

test('explicit refusal revokes the cached signature and observes the literal cooldown', async () => {
  const f = signing(); await issue(f);
  f.clock(2_880_000); f.store.get(ref); f.flush(); f.calls[1].refuse(); await tick();
  assert.equal(f.store.get(ref), null); assert.equal(f.store.isSettled(ref), true);
  assert.equal(f.store.hasCachedSignatureFor(oldUrl), false);
  f.clock(2_909_999); f.store.get(ref); f.flush(); assert.equal(f.calls.length, 2);
  f.clock(2_910_000); f.store.get(ref); f.flush(); assert.equal(f.calls.length, 3);
});

for (const outcome of ['answer', 'reject']) test(`retired account ${outcome} cannot change the new account's signature`, async () => {
  const f = signing(); f.store.setAccount('fictional-a'); f.store.get(ref); f.flush();
  f.store.setAccount('fictional-b'); f.store.get(ref); f.flush();
  f.calls[1].answer(newUrl); await tick();
  if (outcome === 'answer') f.calls[0].answer(oldUrl); else f.calls[0].reject(new Error('fixture old account'));
  await tick(); assert.equal(f.store.get(ref), newUrl);
  f.store.setAccount('fictional-b'); assert.equal(f.store.get(ref), newUrl);
  f.store.setAccount(null); assert.equal(f.store.hasCachedSignatureFor(newUrl), false);
});

test('same UID after sign-out rejects its pre-retirement response', async () => {
  const f = signing(); f.store.setAccount('fictional-a'); f.store.get(ref); f.flush();
  f.store.setAccount(null); f.store.setAccount('fictional-a');
  f.calls[0].answer(oldUrl); await tick(); assert.equal(f.store.get(ref), null);
});

const avatar = 'https://media.invalid/avatar.webp';
const version = () => pure(cachePath).withVersionToken;
test('fractional revisions preserve microsecond precision with literal tokens', () => {
  const v = version();
  assert.equal(v(avatar, '2026-10-15T11:00:01.100001Z'), `${avatar}?v=20261015110001100001`);
  assert.equal(v(avatar, '2026-10-15T11:00:01.100002Z'), `${avatar}?v=20261015110001100002`);
  assert.equal(v(avatar, '2026-10-15T11:00:01.000000001Z'), `${avatar}?v=20261015110001000000001`);
  assert.notEqual(v(avatar, '2026-10-15T11:00:01.100Z'), v(avatar, '2026-10-15T11:00:01.900Z'));
});
test('equivalent timezones and trailing fractional zeroes share one canonical token', () => {
  const v = version();
  for (const stamp of ['2026-10-15T11:00:01.100000Z', '2026-10-15T14:00:01.1+03:00', '2026-10-15T06:00:01.100-05:00']) {
    assert.equal(v(avatar, stamp), `${avatar}?v=202610151100011`);
  }
  assert.equal(v(avatar, '2026-10-15T11:00:01.000000Z'), `${avatar}?v=20261015110001`);
  assert.equal(v(avatar, '2026-10-15T01:00:01.100000+02:00'), `${avatar}?v=202610142300011`);
});
test('revision query precedes fragment without rewriting existing query bytes', () => {
  const v = version(), stamp = '2026-10-15T11:00:01Z';
  assert.equal(v(`${avatar}?width=128&fixture=a%2Fb#crop?x`, stamp), `${avatar}?width=128&fixture=a%2Fb&v=20261015110001#crop?x`);
  assert.equal(v(`${avatar}#crop?width=128`, stamp), `${avatar}?v=20261015110001#crop?width=128`);
});
test('missing or invalid timestamps do not create misleading revision tokens', () => {
  const v = version();
  for (const stamp of [null, '', 'not-a-date', '2026-02-30T00:00:00Z', '2026-10-15T25:00:00Z', '2026-10-15T11:00:01+99:00']) {
    assert.equal(v(avatar, stamp), avatar);
  }
  assert.equal(v(null, '2026-10-15T11:00:01Z'), null);
});

function replaceOne(source, before, after) {
  assert.equal(source.split(before).length, 2, `mutation anchor ${before}`);
  return source.replace(before, after);
}
for (const [name, before, after] of [
  ['receipt-time lifetime', 'const lifetime = signedUrlLifetime(issuedAtMs, ttlSeconds);', 'const lifetime = signedUrlLifetime(receivedAtMs, ttlSeconds);'],
  ['expired offer admitted', 'if (url && isSignedUrlUsable(lifetime, receivedAtMs)) {', 'if (url) {'],
  ['cooldown admission removed', 'if (nowMs < entry.retryAtMs) return false;', ''],
]) test(`compiled mutant killed: ${name}`, async () => {
  const source = replaceOne(read(storePath), before, after);
  await assert.rejects(() => delayedResponseContract(source), { code: 'ERR_ASSERTION' });
});

test('compiled mutant killed: retired signing response admitted', async () => {
  const source = replaceOne(read(storePath), 'if (flushGeneration !== generation) return;', '');
  const f = signing({ source }); f.store.setAccount('fictional-a'); f.store.get(ref); f.flush();
  f.store.setAccount('fictional-b'); f.store.get(ref); f.flush();
  f.calls[1].answer(newUrl); await tick(); f.calls[0].answer(oldUrl); await tick();
  assert.notEqual(f.store.get(ref), newUrl, 'removing generation fencing must be observable');
});

test('compiled mutant killed: zero cooldown permits same-instant rescheduling', async () => {
  const source = replaceOne(read(storePath),
    'Math.max(1, options.failureCooldownMs ?? SIGN_FAILURE_COOLDOWN_MS)',
    'Math.max(0, options.failureCooldownMs ?? SIGN_FAILURE_COOLDOWN_MS)');
  const f = signing({ source, ttlSeconds: 60, failureCooldownMs: 0 }); await issue(f);
  f.store.get(ref); f.flush(); assert.equal(f.calls.length, 2, 'mutant must violate the one-request literal control');
});

for (const [name, before, after, input, stamp, expected] of [
  ['fraction discarded', '(stamp[3] ?? "").replace(/0+$/, "")', '""', avatar,
    '2026-10-15T11:00:01.100001Z', `${avatar}?v=20261015110001100001`],
  ['timezone ignored', 'new Date(`${base}${stamp[4]}`).toISOString()', 'new Date(`${base}Z`).toISOString()', avatar,
    '2026-10-15T14:00:01.1+03:00', `${avatar}?v=202610151100011`],
  ['fragment treated as query', 'const hashAt = url.indexOf("#");', 'const hashAt = -1;', `${avatar}#crop`,
    '2026-10-15T11:00:01Z', `${avatar}?v=20261015110001#crop`],
]) test(`compiled mutant killed: ${name}`, () => {
  const source = replaceOne(read(cachePath), before, after);
  const v = pure(cachePath, { [cachePath]: source }).withVersionToken;
  assert.notEqual(v(input, stamp), expected, 'literal contract must detect this mutation');
});
