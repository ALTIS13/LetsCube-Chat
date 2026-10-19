import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../artifacts/kub/src/', import.meta.url));
const require = createRequire(new URL('../../artifacts/kub/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const { build } = createRequire(require.resolve('vite'))('esbuild');
let browser, bundle;
async function buildFixture(omission) {
  const result = await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': root }, define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'android-update-native-leaves', setup(plugin) {
      if (omission) plugin.onLoad({ filter: /(?:androidUpdates\.ts|AndroidUpdateBanner\.tsx|AndroidUpdateStatus\.tsx)$/ }, async args => {
        const source = await readFile(args.path, 'utf8');
        const changed = omission === 'paused' ? source.replace('"downloading", "paused", "verifying"', '"downloading", "verifying"')
          : omission === 'wrapper' ? source.replace('return <AndroidUpdateStatus compact />;', 'return <div className="mb-2"><AndroidUpdateStatus compact /></div>;')
          : omission === 'progress' ? source.replace('percent / 100', 'percent / 10')
          : omission === 'install-loss' ? source.replace('if (reloadWouldLose().length || voiceRingsSnapshot().length)', 'if (false)')
          : omission === 'install-call' ? source.replace('if (active && confirmation !== live)', 'if (false)')
          : omission === 'late-call' ? source.replace('&& latest !== authorized', '&& false')
          : omission === 'install-intent' ? source.replace('mine !== intent.current || ', '')
          : omission === 'discovery' ? source.replace('5 * 60_000', '50 * 60_000')
          : source.replace('if (id >= accepted)', 'if (true)');
        return { contents: changed, loader: args.path.endsWith('tsx') ? 'tsx' : 'ts', resolveDir: dirname(args.path) };
      });
      plugin.onResolve({ filter: /appOutgoingMedia(?:\.ts)?$/ }, () => ({ path: 'outbox', namespace: 'fixture' }));
      plugin.onResolve({ filter: /^(?:@capacitor\/core|@\/components\/kub|@\/components\/settings\/InfoHint|@\/hooks\/useVoiceCall|@\/hooks\/useVoiceRing|@\/hooks\/usePwa|@\/hooks\/useReleaseCatalog|@\/hooks\/useDesktopUpdate|@\/lib\/monitoring|.*\/capabilities)$/ },
        args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'jsx', resolveDir: root, contents:
        args.path === 'outbox' ? 'export const outgoingMediaPersistenceWouldLose=()=>false;'
        : args.path.endsWith('useVoiceCall') ? `import {useSyncExternalStore} from 'react';const listeners=new Set();
          window.callChanged=()=>listeners.forEach(f=>f());export const voiceCallSnapshot=()=>window.callState;
          export const useVoiceCall=()=>useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f)},voiceCallSnapshot);`
        : args.path.endsWith('useVoiceRing') ? 'export const voiceRingsSnapshot=()=>window.rings;'
        : args.path === '@capacitor/core' ? `export const registerPlugin=()=>new Proxy({},{get:(_target,key)=>(...args)=>window.nativeUpdates[key](...args)});
          export const Capacitor={isNativePlatform:()=>true,getPlatform:()=>'android',isPluginAvailable:()=>true};`
        : args.path.endsWith('capabilities') ? `export const getCurrentDistributionTarget=()=>window.fixtureTarget??'android_native';
          export const isNativeAndroid=()=>!window.fixtureTarget||window.fixtureTarget==='android_native';export const supportsCapacitorPlugin=()=>window.fixturePlugin!==false;`
        : args.path.endsWith('/kub') ? `import React from 'react';export const KubIcon=()=>null;
          export const KubButton=({children,leftIcon,loading,...props})=><button {...props} disabled={props.disabled||loading}>{children}</button>;`
        : args.path.endsWith('InfoHint') ? 'export const InfoHint=()=>null;'
        : args.path.endsWith('usePwa') ? `export const usePwaInstall=()=>({installCopy:{title:'LETSCUBE Android',description:'Обновления',variantLabel:'Android APK',modeLabel:'Приложение'},showInstallButton:false,instructionsOpen:false});`
        : args.path.endsWith('useReleaseCatalog') ? `export const useReleaseCatalog=()=>({platform:'android',state:'update_available',snapshot:{manifest:{available:true,version:'0.1.31',publishedAt:'2026-10-19T00:00:00Z',artifact:{url:'https://api.letscube.ru/releases/files/android/0.1.31/letscube-0.1.31.apk',size:100,sha256:'0'.repeat(64)}}},refresh:async()=>{}});`
        : args.path.endsWith('useDesktopUpdate') ? 'export const useDesktopUpdate=()=>null;'
        : `export const getBuildMetadata=()=>({version:'0.1.30',commit:'synthetic'});export const reportError=()=>{};`
      }));
    } }],
    stdin: { sourcefile: 'android-update-fixture.tsx', resolveDir: root, loader: 'tsx', contents: `
      import React,{act} from 'react';import {createRoot} from 'react-dom/client';
      import {ReleaseDistributionSection} from './components/settings/ReleaseDistributionSection';
      import {AndroidUpdateBanner} from './components/AndroidUpdateBanner';
      import {guardAgainstReload} from './lib/reloadGuard';
      globalThis.IS_REACT_ACT_ENVIRONMENT=true;
      let snapshot={phase:'available',version:'0.1.31',bytes:0,total:100,canInstall:false,error:null};const calls=[];
      window.callState={phase:'idle',channelId:null};window.rings=[];
      const holds=new Map();
      let holdStatus=false,releaseStatus;
      window.nativeUpdates=Object.fromEntries(['status','check','start','cancel','install','permission'].map(name=>[name,async(...args)=>{
        calls.push({name,args});if(name==='status'&&holdStatus){holdStatus=false;const old={...snapshot};return new Promise(resolve=>{releaseStatus=()=>resolve(old);});}
        if(name==='start')snapshot={...snapshot,phase:'downloading'};
        if(name==='cancel')snapshot={phase:'idle',bytes:0,total:0,canInstall:false,error:null};
        if(name==='install')snapshot={...snapshot,phase:'installing'};return {...snapshot};}]));
      const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
      const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
      window.fixture={async mount(){await act(async()=>{root.render(<ReleaseDistributionSection onBeforeInstall={window.beforeInstall?()=>window.beforeInstall():undefined}/>);await drain();});},
        async banner(){await act(async()=>{root.render(<AndroidUpdateBanner/>);await drain();});},
        async detach(){await act(async()=>{root.render(null);await drain();});},
        async state(patch){snapshot={...snapshot,...patch};await act(async()=>{window.dispatchEvent(new Event('focus'));await drain();});},
        quietState(patch){snapshot={...snapshot,...patch};},async settle(){await act(drain);},
        hold(loss){holds.get(loss)?.();holds.set(loss,guardAgainstReload(loss));},
        release(loss){holds.get(loss)?.();holds.delete(loss);},
        async call(patch){await act(async()=>{window.callState={...patch};window.callChanged?.();await drain();});},
        ring(value){window.rings=value?[{}]:[];},
        gate(){window.beforeInstall=()=>new Promise(resolve=>{window.finishInstallClose=()=>{holds.get('dialog')?.();holds.delete('dialog');resolve();};});},
        async finishClose(){await act(async()=>{window.finishInstallClose();await new Promise(r=>setTimeout(r,0));await drain();});},
        childCount:()=>host.children.length,
        holdRead(){holdStatus=true;},async releaseRead(){await act(async()=>{releaseStatus();await drain();});},
        calls:()=>calls,async close(){await act(async()=>root.unmount());}};
    ` } });
  return result.outputFiles[0].text;
}
test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, '0');
  bundle = await buildFixture();
  browser = await chromium.launch();
});

test('native install is vetoed by every real reload hold and a ringing call', async t => {
  const page = await fixture(t);
  await page.evaluate(() => window.fixture.state({ phase: 'ready', bytes: 100, canInstall: true }));
  for (const loss of ['staged-attachments', 'outgoing-in-memory', 'dialog']) {
    await page.evaluate(loss => window.fixture.hold(loss), loss);
    await page.getByTestId('android-update-install').click();
    assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, 0, `INSTALL_LOSS_${loss}`);
    await page.evaluate(loss => window.fixture.release(loss), loss);
  }
  await page.evaluate(() => window.fixture.ring(true));
  await page.getByTestId('android-update-install').click();
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, 0, 'INSTALL_RING_VETO');
});

test('native call confirmation is explicit, cancellable and permits only the same live call', async t => {
  const page = await fixture(t);
  await page.evaluate(async () => { await window.fixture.state({ phase: 'ready', bytes: 100, canInstall: true });
    await window.fixture.call({ phase: 'connected', channelId: 'synthetic-a' }); });
  await page.getByTestId('android-update-install').click();
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, 0, 'INSTALL_CALL_REQUIRES_CONFIRMATION');
  await page.getByRole('button', { name: 'Отменить установку' }).click();
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, 0);
  await page.getByTestId('android-update-install').click();
  await page.getByTestId('android-update-install').click();
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, 1);
});

for (const late of ['none', 'staged-attachments', 'ring', 'new-call', 'call-a-null-a']) test(`guarded Settings close rechecks native install safety: ${late}`, async t => {
  const page = await fixture(t);
  await page.evaluate(async () => { await window.fixture.state({ phase: 'ready', bytes: 100, canInstall: true });
    await window.fixture.call({ phase: 'connected', channelId: 'synthetic-a' });
    window.fixture.hold('dialog');window.fixture.gate();await window.fixture.mount(); });
  await page.getByTestId('android-update-install').click();
  await page.getByTestId('android-update-install').click();
  await page.waitForFunction(() => typeof window.finishInstallClose === 'function');
  if (late === 'staged-attachments') await page.evaluate(() => window.fixture.hold('staged-attachments'));
  if (late === 'ring') await page.evaluate(() => window.fixture.ring(true));
  if (late === 'new-call') await page.evaluate(() => window.fixture.call({ phase: 'connected', channelId: 'synthetic-b' }));
  if (late === 'call-a-null-a') await page.evaluate(async () => { await window.fixture.call({ phase: 'idle', channelId: null });
    await window.fixture.call({ phase: 'connected', channelId: 'synthetic-a' }); });
  await page.evaluate(() => window.fixture.finishClose());
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, late === 'none' ? 1 : 0, 'LATE_INSTALL_MUST_RECHECK');
});

test('foreground and literal five-minute discovery check a current native release without downloading', async t => {
  const page = await fixture(t, { clock: true });
  await page.evaluate(() => window.fixture.quietState({ phase: 'current' }));
  const before = (await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'check').length;
  await page.clock.runFor(299999);await page.evaluate(() => window.fixture.settle());
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'check').length, before);
  await page.clock.runFor(1);await page.evaluate(() => window.fixture.settle());
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'check').length, before + 1, 'NATIVE_DISCOVERY_5_MINUTES');
  await page.evaluate(() => window.fixture.state({ phase: 'current' }));
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'check').length, before + 2, 'NATIVE_FOREGROUND_DISCOVERY');
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'start').length, 0);
});

test('foreground discovery never replaces ready, partial or busy native work', async t => {
  const page = await fixture(t, { clock: true });
  for (const phase of ['ready', 'paused', 'checking', 'downloading', 'verifying', 'installing']) {
    const before = (await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'check').length;
    await page.evaluate(phase => window.fixture.state({ phase }), phase);
    await page.clock.fastForward(300000);await page.evaluate(() => window.fixture.settle());
    assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'check').length, before, `KEEP_NATIVE_${phase}`);
  }
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'start').length, 0);
});

test('an explicitly refused Settings close cannot install even with no remaining holds', async t => {
  const page = await fixture(t);
  await page.evaluate(async () => { window.beforeInstall=()=>false;await window.fixture.mount();
    await window.fixture.state({ phase: 'ready', bytes: 100, canInstall: true }); });
  await page.getByTestId('android-update-install').click();
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, 0);
});

test('compact ready has one short action row and retains explicit call feedback', async t => {
  const page = await fixture(t);
  await page.evaluate(async () => { await window.fixture.banner();await window.fixture.state({ phase: 'ready', bytes: 100, canInstall: false }); });
  assert.equal(await page.getByTestId('android-update-permission').innerText(), 'Разрешить');
  assert.match(await page.getByTestId('android-update-state').innerText(), /Готово к установке/);
  assert.doesNotMatch(await page.getByTestId('android-update-state').innerText(), /затем нажмите/);
  assert.equal(await page.getByRole('button', { name: 'Отменить обновление' }).getAttribute('title'), 'Отменить обновление');
  await page.evaluate(async () => { await window.fixture.state({ canInstall: true });
    await window.fixture.call({ phase: 'connected', channelId: 'synthetic-a' }); });
  await page.getByTestId('android-update-install').click();
  assert.match(await page.getByTestId('android-update-state').innerText(), /Звонок прервётся/);
  assert.equal(await page.getByRole('button', { name: 'Отменить установку' }).count(), 1);
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, 0);
});

for (const omission of ['install-loss', 'install-call']) test(`loaded ${omission} omission crosses the actual native bridge once`, async t => {
  const page = await fixture(t, { source: await buildFixture(omission) });
  await page.evaluate(() => window.fixture.state({ phase: 'ready', bytes: 100, canInstall: true }));
  if (omission === 'install-loss') await page.evaluate(() => window.fixture.hold('staged-attachments'));
  else await page.evaluate(() => window.fixture.call({ phase: 'connected', channelId: 'synthetic-a' }));
  await page.getByTestId('android-update-install').click();
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, 1);
});

test('loaded late-call omission authorizes a changed call after held Settings close', async t => {
  const page = await fixture(t, { source: await buildFixture('late-call') });
  await page.evaluate(async () => { await window.fixture.state({ phase: 'ready', bytes: 100, canInstall: true });
    await window.fixture.call({ phase: 'connected', channelId: 'synthetic-a' });
    window.fixture.hold('dialog');window.fixture.gate();await window.fixture.mount(); });
  await page.getByTestId('android-update-install').click();await page.getByTestId('android-update-install').click();
  await page.waitForFunction(() => typeof window.finishInstallClose === 'function');
  await page.evaluate(() => window.fixture.call({ phase: 'connected', channelId: 'synthetic-b' }));
  await page.evaluate(() => window.fixture.finishClose());
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, 1);
});

test('loaded discovery omission misses the literal five-minute check', async t => {
  const page = await fixture(t, { source: await buildFixture('discovery'), clock: true });
  await page.evaluate(() => window.fixture.quietState({ phase: 'current' }));
  const before = (await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'check').length;
  await page.clock.runFor(300000);await page.evaluate(() => window.fixture.settle());
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'check').length, before);
});

test('cancelled held install intent stays retired; loaded omission demonstrates one stale dispatch', async t => {
  for (const omitted of [false, true]) {
    const page = await fixture(t, { source: omitted ? await buildFixture('install-intent') : bundle });
    await page.evaluate(async () => { await window.fixture.state({ phase: 'ready', bytes: 100, canInstall: true });
      await window.fixture.call({ phase: 'connected', channelId: 'synthetic-a' });
      window.fixture.hold('dialog');window.fixture.gate();await window.fixture.mount(); });
    await page.getByTestId('android-update-install').click();await page.getByTestId('android-update-install').click();
    await page.waitForFunction(() => typeof window.finishInstallClose === 'function');
    await page.getByRole('button', { name: 'Отменить установку' }).click();
    await page.evaluate(() => window.fixture.finishClose());
    assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, omitted ? 1 : 0, 'CANCELLED_INSTALL_INTENT');
    assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'cancel').length, 0, 'CANCELLING_INTENT_KEEPS_APK');
  }
});
test.after(async () => browser?.close());
async function fixture(t, { target, plugin, clock = false, source = bundle } = {}) {
  const context = await browser.newContext();
  t.after(async () => context.close());
  const page = await context.newPage();
  await page.route('**/*', route => route.abort());
  await page.goto('about:blank');
  if (clock) {
    await page.clock.install({ time: new Date('2026-10-19T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-19T12:00:01Z'));
  }
  await page.evaluate(({ target, plugin }) => { window.fixtureTarget = target; window.fixturePlugin = plugin; }, { target, plugin });
  await page.addScriptTag({ content: source });
  await page.evaluate(() => window.fixture.mount());
  t.after(async () => { if (!page.isClosed()) await page.evaluate(() => window.fixture.close()); });
  return page;
}
test('mounted Android update downloads natively without opening the APK in a browser', async t => {
  const page = await fixture(t);
  assert.equal(await page.locator('a[href$=".apk"]').count(), 0, 'ANDROID_UPDATE_MUST_NOT_OPEN_BROWSER');
  await page.getByTestId('android-update-download').click();
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'start').length, 1);
  assert.equal(await page.getByTestId('android-update-state').getAttribute('data-phase'), 'downloading');
});
test('mounted Android progress and ready survive focus and remount until an explicit action', async t => {
  const page = await fixture(t);
  await page.evaluate(() => window.fixture.state({ phase: 'downloading', bytes: 42 }));
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '42');
  assert.equal(await page.getByRole('progressbar').locator(':scope > div').evaluate(node => node.style.transform), 'scaleX(0.42)');
  await page.evaluate(() => window.fixture.state({ phase: 'ready', bytes: 100, canInstall: true }));
  await page.evaluate(async () => { await window.fixture.detach(); await window.fixture.mount(); });
  assert.equal(await page.getByTestId('android-update-state').getAttribute('data-phase'), 'ready');
  assert.equal((await page.evaluate(() => window.fixture.calls())).some(c => c.name === 'install'), false);
  assert.equal((await page.evaluate(() => window.fixture.calls())).some(c => c.name === 'cancel'), false);
  await page.getByTestId('android-update-install').click();
  assert.deepEqual((await page.evaluate(() => window.fixture.calls())).find(c => c.name === 'install').args, []);
});

test('loaded progress scale mutation cannot pass the literal 42 percent visual control', async t => {
  const page = await fixture(t, { source: await buildFixture('progress') });
  await page.evaluate(() => window.fixture.state({ phase: 'downloading', bytes: 42 }));
  const transform = await page.getByRole('progressbar').locator(':scope > div').evaluate(node => node.style.transform);
  assert.throws(() => assert.equal(transform, 'scaleX(0.42)'), { name: 'AssertionError' });
});
test('permission requires its own explicit action and never automatically installs', async t => {
  const page = await fixture(t);
  await page.evaluate(() => window.fixture.state({ phase: 'ready', bytes: 100, canInstall: false }));
  await page.getByTestId('android-update-permission').click();
  const calls = await page.evaluate(() => window.fixture.calls());
  assert.equal(calls.filter(c => c.name === 'permission').length, 1);
  assert.equal(calls.filter(c => c.name === 'install').length, 0);
});
test('failed and paused downloads expose retry/resume instead of browser fallback', async t => {
  const page = await fixture(t);
  for (const phase of ['failed', 'paused']) {
    await page.evaluate(phase => window.fixture.state({ phase, error: 'NETWORK' }), phase);
    assert.equal(await page.getByTestId('android-update-download').count(), 1);
    assert.equal(await page.locator('a[href$=".apk"]').count(), 0);
  }
  await page.getByTestId('android-update-cancel').click();
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'cancel').length, 1);
});
test('a held old native status cannot restore ready after explicit cancellation', async t => {
  const page = await fixture(t);
  await page.evaluate(() => window.fixture.state({ phase: 'ready', bytes: 100, canInstall: true }));
  await page.evaluate(async () => { window.fixture.holdRead(); await window.fixture.state({}); });
  await page.getByTestId('android-update-cancel').click();
  await page.evaluate(() => window.fixture.releaseRead());
  assert.equal(await page.getByTestId('android-update-state').getAttribute('data-phase'), 'idle');
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, 0);
});

test('ordinary Android browser keeps the existing public APK download, without native calls', async t => {
  const page = await fixture(t, { target: 'android_download' });
  assert.equal(await page.locator('a[href$=".apk"]').count(), 1);
  assert.equal(await page.getByTestId('android-update-state').count(), 0);
  assert.equal((await page.evaluate(() => window.fixture.calls())).length, 0);
});

test('an older Android shell reports an unavailable bridge instead of pretending a download started', async t => {
  const page = await fixture(t, { plugin: false });
  assert.equal(await page.getByTestId('android-update-state').getAttribute('data-phase'), 'unavailable');
  assert.equal(await page.getByTestId('android-update-download').count(), 0);
  assert.equal(await page.locator('a[href$=".apk"]').count(), 0);
  assert.equal((await page.evaluate(() => window.fixture.calls())).length, 0);
});

test('a foreground paused snapshot is polled through ready without any focus event', async t => {
  const page = await fixture(t, { clock: true });
  await page.evaluate(() => window.fixture.state({ phase: 'paused' }));
  await page.evaluate(() => window.fixture.quietState({ phase: 'ready', bytes: 100, canInstall: true }));
  await page.clock.fastForward(1100);
  await page.evaluate(() => window.fixture.settle());
  assert.equal(await page.getByTestId('android-update-state').getAttribute('data-phase'), 'ready');
  assert.equal((await page.evaluate(() => window.fixture.calls())).filter(c => c.name === 'install').length, 0);
});

test('the compact shell banner has no wrapper or reserved gap while current or idle', async t => {
  const page = await fixture(t);
  await page.evaluate(() => window.fixture.banner());
  assert.equal(await page.getByTestId('android-update-state').count(), 1);
  for (const phase of ['current', 'idle', 'unavailable']) {
    await page.evaluate(phase => window.fixture.state({ phase }), phase);
    assert.equal(await page.evaluate(() => window.fixture.childCount()), 0, `NO_EMPTY_BANNER_${phase}`);
  }
});

test('loaded paused-poll omission leaves the literal foreground transition behind', async t => {
  const page = await fixture(t, { source: await buildFixture('paused'), clock: true });
  await page.evaluate(() => window.fixture.state({ phase: 'paused' }));
  await page.evaluate(() => window.fixture.quietState({ phase: 'ready', bytes: 100 }));
  await page.clock.fastForward(1100);
  await page.evaluate(() => window.fixture.settle());
  assert.equal(await page.getByTestId('android-update-state').getAttribute('data-phase'), 'paused');
});

test('loaded empty-wrapper omission is caught by actual rendered child presence', async t => {
  const page = await fixture(t, { source: await buildFixture('wrapper') });
  await page.evaluate(async () => { await window.fixture.banner(); await window.fixture.state({ phase: 'current' }); });
  assert.equal(await page.getByTestId('android-update-state').count(), 0);
  assert.equal(await page.evaluate(() => window.fixture.childCount()), 1);
});

test('loaded stale-status omission restores the actual old ready snapshot after cancellation', async t => {
  const page = await fixture(t, { source: await buildFixture('stale') });
  await page.evaluate(() => window.fixture.state({ phase: 'ready', canInstall: true, bytes: 100 }));
  await page.evaluate(async () => { window.fixture.holdRead(); await window.fixture.state({}); });
  await page.getByTestId('android-update-cancel').click();
  await page.evaluate(() => window.fixture.releaseRead());
  assert.equal(await page.getByTestId('android-update-state').getAttribute('data-phase'), 'ready');
});
