import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, makeBundle, fixture, data, CHAT, MESSAGE } from '../e2e/cold-media-open-fixture.mjs';

let browser, bundle;
const once = (text, from, to) => {
  assert.equal(text.split(from).length, 2, 'EXACT_OBSERVER_ANCHOR_REQUIRED');
  return text.replace(from, to);
};

async function observedBundle(mutation) {
  let js = await makeBundle(mutation);
  js = once(js, 'historyError: !!view.historyError', 'historyError: !!view.historyError, loading: view.loading');
  // Observe the actual hook, service and privacy module. Only SHA completion is
  // held; payloads, service results and isCurrent verdicts are never replaced.
  return once(js, 'window.start = () => {', `
    window.qa = { writes: [], held: false, current: null };
    const qaDigest = crypto.subtle.digest.bind(crypto.subtle);
    let qaArmed = window.input.holdPrivacyDigest === true;
    crypto.subtle.digest = async (...args) => {
      const result = await qaDigest(...args);
      if (qaArmed && new TextDecoder().decode(args[1]).includes('"key":"messages:') &&
          !new TextDecoder().decode(args[1]).includes(':default-scope"')) {
        qaArmed = false;
        await new Promise(resolve => { window.qa.held = true; window.qa.release = resolve; });
      }
      return result;
    };
    const qaCapture = offlineHistory.capture;
    offlineHistory.capture = (...args) => {
      const owner = qaCapture(...args); if (!owner) return owner;
      return new Proxy(owner, { get(target, key) {
        const value = target[key];
        if (key !== 'writeMessages') return value;
        return (...input) => {
          const ticket = input[3]; window.qa.current = ticket;
          const observation = { complete: false, result: null, current: ticket };
          window.qa.writes.push(observation);
          return value(...input).then(result => {
            observation.complete = true; observation.result = result;
            return result;
          });
        };
      }});
    };
    window.qa.joinAfterFinally = () => {
      const before = window.qa.writes[0].current();
      hiddenMessagesLive.joined(); hiddenMessagesLive.pingReturned();
      return { before, after: window.qa.writes[0].current(), live: hiddenMessagesLive.isLive(),
        canSkip: hiddenMessagesLive.canSkip('${CHAT}', ['${MESSAGE}']) };
    };
    window.qa.saved = () => offlineHistory.capture().readDefaultMessages('${CHAT}');
    window.qa.offline = () => {
      window.input.offline = true;
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    };
    window.qa.retireAccount = () => {
      useAppStore.setState({ currentUser: null, accountEpoch: 2 });
      offlineHistory.setIdentity(null);
    };
    const qaTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args) {
      if (window.qa.failDiskOnce && args[1] === 'readwrite') {
        window.qa.failDiskOnce = false; window.qa.diskFaultRaised = true;
        throw Error('SYNTHETIC_IDB_UNAVAILABLE');
      }
      return qaTransaction.apply(this, args);
    };
    window.start = () => {`);
}
test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, '0');
  bundle = await observedBundle();
  browser = await chromium.launch({ headless: true });
});
test.after(async () => browser?.close());

async function open(hold = false, js = bundle) {
  const input = data('private'); input.holdPrivacyDigest = hold;
  const f = await fixture(browser, js, input);
  await f.page.waitForFunction(() => window.snapshot?.().count === 1 && window.snapshot().loading === false);
  return f;
}

async function retireAfterFinally(f, transition = 'none') {
  await f.page.waitForFunction(() => window.qa.held && window.qa.writes.length > 0);
  assert.equal(await f.page.evaluate(() => window.snapshot().loading), false,
    'the REST finally has finished before privacy generation changes');
  assert.deepEqual(await f.page.evaluate(() => window.qa.joinAfterFinally()),
    { before: true, after: false, live: true, canSkip: false });
  if (transition === 'offline') await f.page.evaluate(() => window.qa.offline());
  if (transition === 'scope') await f.page.evaluate(() => window.dispose());
  if (transition === 'account') await f.page.evaluate(() => window.qa.retireAccount());
  await f.page.evaluate(() => window.qa.release());
  await f.page.waitForFunction(() => window.qa.writes[0].complete);
  assert.equal(await f.page.evaluate(() => window.qa.writes[0].result), false,
    'the real service must refuse the retired privacy ticket');
}

async function savedEventually(f) {
  // Poll the resolved IDB result from Node, never a Promise's truthiness in a
  // browser predicate. No native/device/network paths are involved.
  for (let i = 0; i < 50; i++) {
    if (await f.page.evaluate(async () => (await window.qa.saved())?.messages.length === 1)) return true;
    await sleep(50);
  }
  return false;
}

test('known control: actual hook/PostgREST-shaped media row persists through real offline service and IDB', { timeout: 20000 }, async () => {
  const f = await open();
  try {
    assert.equal(await savedEventually(f), true);
    const saved = await f.page.evaluate(async () => {
      const row = (await window.qa.saved()).messages[0];
      return { id: row.id, mediaPathPresent: !!row.media_path, senderPresent: !!row.sender, transientUrl: row.media_url };
    });
    assert.deepEqual(saved, { id: MESSAGE, mediaPathPresent: true, senderPresent: true, transientUrl: null });
    assert.equal(f.errors(), 0); assert.equal(f.blocked(), 0);
  } finally { await f.close(); }
});

async function recoveryCase(js = bundle, t) {
  const f = await open(true, js);
  try {
    await retireAfterFinally(f);
    // Give the actual 300ms follow-up effect its opportunity; completion of the
    // first real write is separately witnessed above, not inferred from delay.
    await f.page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1100)));
    const result = await f.page.evaluate(async () => ({
      warmRow: window.snapshot().count === 1,
      firstWriteRefused: window.qa.writes[0].result === false,
      defaultSaved: (await window.qa.saved())?.messages.length === 1,
      hiddenReads: window.readCalls.filter(c => c.table === 'message_hidden_for_users').length,
      writes: window.qa.writes.length,
    }));
    t?.diagnostic(JSON.stringify(result));
    assert.equal(result.warmRow, true); assert.equal(result.firstWriteRefused, true);
    assert.equal(f.errors(), 0); assert.equal(f.blocked(), 0);
    assert.equal(result.defaultSaved, true, 'POST_FINALLY_PRIVACY_WRITE_REFUSAL_MUST_NOT_SILENTLY_LOSE_HISTORY');
  } finally { await f.close(); }
}
test('post-finally privacy join during disk digest must revalidate then persist the received history', { timeout: 20000 }, t => recoveryCase(bundle, t));

test('known recovery control: an ordinary online event rechecks privacy and saves the same received row', { timeout: 20000 }, async () => {
  const f = await open(true);
  try {
    await retireAfterFinally(f);
    const before = await f.page.evaluate(() => window.readCalls.filter(c => c.table === 'message_hidden_for_users').length);
    await f.page.evaluate(() => window.dispatchEvent(new Event('online')));
    assert.equal(await savedEventually(f), true, 'ordinary online reconciliation must save a fresh received projection');
    const after = await f.page.evaluate(() => window.readCalls.filter(c => c.table === 'message_hidden_for_users').length);
    assert.ok(after > before, 'a fresh hidden-ID read, not a weakened generation guard, restores persistence');
    assert.equal(await f.page.evaluate(() => window.snapshot().count), 1);
    assert.equal(f.errors(), 0); assert.equal(f.blocked(), 0);
  } finally { await f.close(); }
});

async function noRetryCase(transition, js = bundle) {
  const f = await open(true, js);
  try {
    await retireAfterFinally(f, transition);
    const reads = await f.page.evaluate(() => window.readCalls.length);
    await sleep(1150);
    assert.equal(await f.page.evaluate(() => window.readCalls.length), reads,
      transition === 'offline' ? 'OFFLINE_REFUSED_DISK_WRITE_MUST_NOT_RETRY_REST' : 'RETIRED_OWNER_OR_SCOPE_MUST_NOT_RETRY_REST');
    assert.equal(await f.page.evaluate(() => window.qa.writes.length), 1);
    assert.equal(f.errors(), 0); assert.equal(f.blocked(), 0);
  } finally { await f.close(); }
}
for (const transition of ['offline', 'scope', 'account']) test(
  `privacy-refused disk write: no recovery after ${transition}`, { timeout: 20000 }, () => noRetryCase(transition));

async function diskRefusalCase(js = bundle) {
  const f = await open(true, js);
  try {
    await f.page.waitForFunction(() => window.qa.held);
    assert.equal(await f.page.evaluate(() => window.qa.writes[0].current()), true);
    await f.page.evaluate(() => { window.qa.failDiskOnce = true; window.qa.release(); });
    await f.page.waitForFunction(() => window.qa.writes[0].complete);
    assert.deepEqual(await f.page.evaluate(() => ({
      refused: window.qa.writes[0].result === false, fault: window.qa.diskFaultRaised,
      privacyStillCurrent: window.qa.writes[0].current(),
    })), { refused: true, fault: true, privacyStillCurrent: true });
    const reads = await f.page.evaluate(() => window.readCalls.length);
    await sleep(1150);
    assert.equal(await f.page.evaluate(() => window.readCalls.length), reads,
      'ORDINARY_DISK_REFUSAL_MUST_NOT_RETRY_REST');
    assert.equal(f.errors(), 0); assert.equal(f.blocked(), 0);
  } finally { await f.close(); }
}
test('ordinary actual IndexedDB refusal with current privacy must not trigger REST recovery', { timeout: 20000 }, () => diskRefusalCase());

const condition = 'if (!saved && isCurrent() && !privacyIsCurrent() && navigator.onLine !== false) {';
for (const [name, to, run, oracle] of [
  ['recovery omitted', 'if (false) {', recoveryCase, 'POST_FINALLY_PRIVACY_WRITE_REFUSAL_MUST_NOT_SILENTLY_LOSE_HISTORY'],
  ['offline guard omitted', 'if (!saved && isCurrent() && !privacyIsCurrent()) {', js => noRetryCase('offline', js), 'OFFLINE_REFUSED_DISK_WRITE_MUST_NOT_RETRY_REST'],
  ['privacy-only refusal guard omitted', 'if (!saved && isCurrent() && navigator.onLine !== false) {', diskRefusalCase, 'ORDINARY_DISK_REFUSAL_MUST_NOT_RETRY_REST'],
]) test(`actual compiled mutation killed: ${name}`, { timeout: 20000 }, async () => {
  const js = await observedBundle({ file: 'hooks/useMessages.ts', from: condition, to });
  await assert.rejects(() => run(js), error => {
    assert.equal(error.code, 'ERR_ASSERTION'); assert.ok(error.message.includes(oracle)); return true;
  });
});
