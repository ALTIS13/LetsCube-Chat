import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const A = "11111111-1111-4111-8111-000000000001";
const B = "11111111-1111-4111-8111-000000000002";
const CHAT = "22222222-2222-4222-8222-000000000001";
const PREFIX = "55555555-5555-4555-8555-000000000001";
const MEDIA = "55555555-5555-4555-8555-000000000002";
const literal = '{"version":1,"revision":"33333333-3333-4333-8333-000000000001","items":[{"kind":"user","user_id":"11111111-1111-4111-8111-000000000002","offset":0,"length":4,"label":"@Ada"}]}';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean) {
  for (let i = 0; i < 40 && !check(); i++) await flush();
  assert.equal(check(), true, "actual runtime boundary not reached");
}
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => { resolve = done; });
  return { promise, resolve };
}
function canonical(payload: any) {
  return { data: { ...payload, id: `server:${payload.client_message_id}`, created_at: payload.client_sent_at }, error: null, status: 201 };
}
const refused = () => ({ data: null, error: { code: "42501", message: "synthetic refusal" }, status: 403 });

type Omission = { file: string; before: string; after: string };
function source(relative: string, omission?: Omission) {
  let result = readFileSync(path.join(root, relative), "utf8");
  if (omission?.file === relative) {
    assert.equal(result.split(omission.before).length - 1, 1, `unique omission anchor: ${relative}`);
    result = result.replace(omission.before, omission.after);
  }
  return result;
}

// Real modules and runner; only remote I/O, monitoring and device storage are replaced.
function modules(stubs: Record<string, any>, omission?: Omission) {
  const cache = new Map<string, any>();
  const load = (relative: string): any => {
    let filename = path.resolve(root, relative);
    if (!existsSync(filename)) filename += existsSync(`${filename}.ts`) ? ".ts" : ".tsx";
    const key = path.relative(root, filename).replaceAll("\\", "/");
    if (Object.hasOwn(stubs, key)) return stubs[key];
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const compiled = ts.transpileModule(source(key, omission).replaceAll("import.meta.env", "({DEV:false})"), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    }).outputText;
    const require = (name: string): any => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith("@/")) return load(name.slice(2));
      if (name.startsWith(".")) return load(path.relative(root, path.resolve(path.dirname(filename), name)));
      return kubRequire(name);
    };
    const timer = (run: () => void, ms: number) => { const handle = setTimeout(run, ms); handle.unref(); return handle; };
    runInThisContext(`(function(require,module,exports,setTimeout){${compiled}\n})`, { filename })(require, module, module.exports, timer);
    return module.exports;
  };
  return load;
}

async function backgroundHarness(answer: (payload: any) => Promise<any> = async () => refused(), omission?: Omission,
  upload?: (onProgress: (progress: number) => void) => Promise<any>, textPut?: (entry: any) => Promise<void>) {
  const payloads: any[] = [];
  let uploads = 0;
  const client = { from: () => {
    let payload: any;
    const query: any = { insert: (value: any) => { payload = structuredClone(value); payloads.push(payload); return query; },
      select: () => query, eq: () => query, lt: () => query, update: () => query,
      single: () => answer(payload), maybeSingle: async () => ({ data: null }),
      then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve) };
    return query;
  } };
  const stubs: Record<string, any> = {
    "lib/supabase/client.ts": { createClient: () => client },
    "lib/monitoring.ts": { reportError: () => {} },
    "lib/personalModeration.ts": { blockedSendRefusal: () => null },
    "lib/messageAckError.ts": { getMessageAckUserMessage: () => "synthetic refusal", sanitizeMessageAckError: () => ({}) },
    "lib/attachmentUpload.ts": { uploadAttachmentBytes: async (_client: any, _userId: string, _chatId: string,
      _attachment: any, options: { onProgress: (progress: number) => void }) => {
      uploads++; return upload ? upload(options.onProgress) : { bucket: "media", path: "synthetic/audio", publicUrl: "synthetic" };
    } },
  };
  const load = modules(stubs, omission);
  const textStorageModule = load("lib/outbox/outboxStorage.ts");
  const textStorage = textStorageModule.memoryOutboxStorage();
  if (textPut) {
    const put = textStorage.put.bind(textStorage);
    textStorage.put = async (entry: any) => { await textPut(entry); await put(entry); };
  }
  stubs["lib/outbox/outboxStorage.ts"] = { ...textStorageModule, browserOutboxStorage: () => textStorage };
  const mediaStorageModule = load("lib/outbox/outgoingMediaStorage.ts");
  const mediaStorage = mediaStorageModule.memoryOutgoingMediaStorage();
  stubs["lib/outbox/outgoingMediaStorage.ts"] = { ...mediaStorageModule, browserOutgoingMediaStorage: () => mediaStorage };
  const store = load("store/app.store.ts").useAppStore;
  store.getState().setCurrentUser({ id: A });
  const outbox = load("lib/outbox/appOutbox.ts").appOutbox;
  const out = load("lib/outgoingMedia.ts");
  const mediaDevice = load("lib/outbox/appOutgoingMedia.ts");
  const prefix = { userId: A, chatId: CHAT, topicId: null, type: "text", content: "@Ada", mentionEntities: JSON.parse(literal),
    clientMessageId: PREFIX, tempId: `tmp:${PREFIX}`, replyToId: null, forwardedFromId: null,
    mediaBucket: null, mediaPath: null, mediaUrl: null, clientSentAt: "2026-10-01T12:00:00.000Z", attempts: 0, nextAttemptAt: 0 };
  const file = new File(["retained synthetic voice bytes"], "voice.webm", { type: "audio/webm" });
  const entry = { tempId: `tmp:${MEDIA}`, chatId: CHAT, topicId: null, replyToId: null, caption: null,
    clientSentAt: "2026-10-01T12:00:00.001Z", captionPrefix: { entry: structuredClone(prefix), accepted: false },
    attachment: { id: MEDIA, clientMessageId: MEDIA, kind: "voice", file, name: file.name, size: file.size,
      mimeType: file.type, durationMs: 1000, previewUrl: null, uploaded: null, status: "failed", progress: null, error: null } };
  await mediaStorage.save(A, entry);
  mediaDevice.keepOutgoingMediaFor(A);
  const restored = await mediaDevice.restoreOutgoingMedia(A);
  const build = load("lib/attachmentPlaceholder.ts").buildAttachmentPlaceholder;
  for (const item of restored) store.getState().addMessage(CHAT, { ...build({ ...item, user: { id: A } }), upload_waiting: true });
  const background = load("lib/outbox/appBackgroundUploads.ts").appBackgroundUploads;
  await outbox.start(A);
  return { store, outbox, out, prefix, entry, background, textStorage, mediaStorage, mediaDevice, build, payloads,
    uploads: () => uploads,
    shown: () => store.getState().messages[CHAT]?.find((message: any) => message.id === `tmp:${MEDIA}`),
    cleanup: () => { outbox.stop(); out.cancelAllOutgoing(); out.persistOutgoingWith(null); } };
}

async function refusalThenAck(omission?: Omission) {
  let allowPrefix = false;
  const h = await backgroundHarness(async (payload) => payload.type === "text" && !allowPrefix ? refused() : canonical(payload), omission);
  try {
    await h.textStorage.put(h.prefix);
    h.outbox.stop(); await h.outbox.start(A);
    await until(() => h.payloads.length === 1 && !h.outbox.has(PREFIX));
    await h.background.run();
    assert.equal(h.uploads(), 0, "a refused prefix must not release media bytes");
    assert.equal(h.payloads.filter((payload) => payload.type !== "text").length, 0);
    assert.ok(h.payloads.filter((payload) => payload.type === "text").every((payload) => payload.client_message_id === PREFIX));
    assert.equal(JSON.stringify(h.payloads.at(-1).mention_entities), literal);
    assert.equal((await h.textStorage.list(A))[0]?.clientMessageId, PREFIX);
    assert.equal(h.shown().failed, true);
    const kept = (await h.mediaStorage.list(A))[0];
    assert.equal(await kept.attachment.file.text(), "retained synthetic voice bytes");
    assert.equal(kept.tempId, `tmp:${MEDIA}`);
    assert.equal(kept.captionPrefix.entry.clientMessageId, PREFIX);
    assert.ok(h.out.outgoingEntry(`tmp:${MEDIA}`));
    allowPrefix = true;
    const ack = await h.outbox.enqueue(structuredClone(h.prefix));
    assert.equal(ack.kind, "sent");
    await h.background.run();
    assert.equal(h.uploads(), 1);
    const media = h.payloads.filter((payload) => payload.type !== "text");
    assert.equal(media.length, 1);
    assert.equal(media[0].client_message_id, MEDIA);
    assert.deepEqual(h.payloads.map((payload) => payload.client_message_id), [PREFIX, PREFIX, PREFIX, MEDIA]);
    assert.equal(Object.hasOwn(media[0], "mention_entities"), false);
    assert.equal(h.out.outgoingEntry(`tmp:${MEDIA}`), null);
    assert.equal((await h.mediaStorage.list(A)).length, 0);
    assert.equal((await h.textStorage.list(A)).length, 0);
  } finally { h.cleanup(); }
}

test("actual background restore retains refused voice prefix UUID and bytes, then resumes after its ACK", async () => {
  await refusalThenAck();
});

test("an in-flight prefix is not re-enqueued or overtaken by background media", async () => {
  const held = deferred();
  const h = await backgroundHarness(async (payload) => payload.type === "text" ? held.promise : canonical(payload));
  try {
    const sending = h.outbox.enqueue(structuredClone(h.prefix));
    await until(() => h.payloads.length === 1);
    const backgroundRun = h.background.run();
    await flush();
    assert.equal(h.uploads(), 0);
    assert.equal(h.payloads.length, 1);
    assert.equal(h.outbox.has(PREFIX), true);
    assert.equal(h.shown().upload_waiting, true);
    held.resolve(canonical(h.payloads[0])); await sending;
    await backgroundRun;
    await h.background.run();
    assert.equal(h.uploads(), 1);
    assert.deepEqual(h.payloads.map((payload) => payload.client_message_id), [PREFIX, MEDIA]);
  } finally { held.resolve(refused()); h.cleanup(); }
});

test("a prefix marked accepted retains the ordinary background media flow", async () => {
  const h = await backgroundHarness(async (payload) => canonical(payload));
  try {
    const entry = h.out.outgoingEntry(`tmp:${MEDIA}`);
    h.out.rememberOutgoing({ ...entry, captionPrefix: { ...entry.captionPrefix, accepted: true } });
    await h.background.run();
    assert.equal(h.uploads(), 1);
    assert.deepEqual(h.payloads.map((payload) => payload.client_message_id), [MEDIA]);
  } finally { h.cleanup(); }
});

test("another account's prefix cannot be retried or release the restored media", async () => {
  const h = await backgroundHarness(async (payload) => canonical(payload));
  try {
    const entry = h.out.outgoingEntry(`tmp:${MEDIA}`);
    h.out.rememberOutgoing({ ...entry, captionPrefix: { ...entry.captionPrefix, entry: { ...entry.captionPrefix.entry, userId: B } } });
    await h.background.run();
    assert.equal(h.uploads(), 0);
    assert.equal(h.payloads.length, 0);
    assert.equal((await h.textStorage.list(B)).length, 0);
    assert.ok(h.out.outgoingEntry(`tmp:${MEDIA}`));
  } finally { h.cleanup(); }
});

for (const transition of ["A-B", "A-null-A"]) {
  test(`background prefix gate cannot upload in a new ${transition} account epoch`, async () => {
    const h = await backgroundHarness(async (payload) => canonical(payload));
    try {
      const entry = h.out.outgoingEntry(`tmp:${MEDIA}`);
      h.out.rememberOutgoing({ ...entry, captionPrefix: { ...entry.captionPrefix, accepted: true } });
      const sending = h.background.run();
      h.store.getState().setCurrentUser(transition === "A-B" ? { id: B } : null);
      if (transition === "A-null-A") h.store.getState().setCurrentUser({ id: A });
      await sending;
      assert.equal(h.uploads(), 0);
      assert.equal(h.payloads.length, 0);
      assert.equal((await h.mediaStorage.list(A)).length, 1);
    } finally { h.cleanup(); }
  });
}

test("ordinary media without a prefix still sends once", async () => {
  const h = await backgroundHarness(async (payload) => canonical(payload));
  try {
    const { captionPrefix: _prefix, ...entry } = h.out.outgoingEntry(`tmp:${MEDIA}`);
    h.out.rememberOutgoing(entry);
    await h.background.run();
    assert.equal(h.uploads(), 1);
    assert.deepEqual(h.payloads.map((payload) => payload.client_message_id), [MEDIA]);
    assert.equal((await h.mediaStorage.list(A)).length, 0);
  } finally { h.cleanup(); }
});

test("a late background upload cannot INSERT or drop bytes after same-account relogin", async () => {
  const held = deferred();
  const h = await backgroundHarness(async (payload) => canonical(payload), undefined, () => held.promise);
  try {
    const entry = h.out.outgoingEntry(`tmp:${MEDIA}`);
    h.out.rememberOutgoing({ ...entry, captionPrefix: { ...entry.captionPrefix, accepted: true } });
    const sending = h.background.run();
    await until(() => h.uploads() === 1);
    h.store.getState().setCurrentUser(null);
    h.store.getState().setCurrentUser({ id: A });
    await h.outbox.start(A);
    held.resolve({ bucket: "media", path: "synthetic/audio", publicUrl: "synthetic" });
    await sending;
    assert.equal(h.payloads.length, 0);
    assert.ok(h.out.outgoingEntry(`tmp:${MEDIA}`));
    assert.equal(await (await h.mediaStorage.list(A))[0].attachment.file.text(), "retained synthetic voice bytes");
  } finally { held.resolve({}); h.cleanup(); }
});

test("discard during background refusal retention cannot resurrect the prefix on disk", async () => {
  const held = deferred();
  let puts = 0;
  const h = await backgroundHarness(undefined, undefined, undefined, async () => {
    if (++puts === 2) await held.promise;
  });
  try {
    const sending = h.background.run();
    await until(() => puts === 2);
    h.store.getState().removeMessage(CHAT, `tmp:${PREFIX}`);
    const { captionPrefix: _prefix, ...entry } = h.out.outgoingEntry(`tmp:${MEDIA}`);
    h.out.rememberOutgoing(entry);
    await h.outbox.discard(PREFIX);
    held.resolve(undefined); await sending;
    assert.equal((await h.textStorage.list(A)).length, 0);
    assert.equal(h.uploads(), 0);
    assert.equal((await h.mediaStorage.list(A)).length, 1);
  } finally { held.resolve(undefined); h.cleanup(); }
});

async function restoreSameIDInNewEpoch(h: Awaited<ReturnType<typeof backgroundHarness>>) {
  h.store.getState().setCurrentUser(null);
  h.out.cancelAllOutgoing();
  h.mediaDevice.keepOutgoingMediaFor(null);
  h.store.getState().setCurrentUser({ id: A });
  h.mediaDevice.keepOutgoingMediaFor(A);
  const restored = await h.mediaDevice.restoreOutgoingMedia(A);
  for (const entry of restored) h.store.getState().addMessage(CHAT, {
    ...h.build({ ...entry, user: { id: A } }), upload_waiting: true,
  });
  assert.equal(restored.length, 1);
  assert.equal(restored[0].tempId, "tmp:55555555-5555-4555-8555-000000000002");
  assert.equal(h.store.getState().accountEpoch, 3);
}

async function assertLateRestoredCatch(omission?: Omission) {
  const held = deferred();
  const h = await backgroundHarness(async (payload) => canonical(payload), omission, () => held.promise);
  try {
    const entry = h.out.outgoingEntry(`tmp:${MEDIA}`);
    h.out.rememberOutgoing({ ...entry, captionPrefix: { ...entry.captionPrefix, accepted: true } });
    const sending = h.background.run();
    await until(() => h.uploads() === 1);
    await restoreSameIDInNewEpoch(h);
    h.store.getState().updateMessage(CHAT, { ...h.shown(), pending: false, failed: true,
      upload_waiting: false, send_error: "new-session refusal", upload_progress: 73 });
    held.resolve({ bucket: "media", path: "synthetic/audio", publicUrl: "synthetic" });
    await sending;
    const shown = h.shown();
    assert.deepEqual({ pending: shown.pending, failed: shown.failed, waiting: shown.upload_waiting,
      error: shown.send_error, progress: shown.upload_progress },
    { pending: false, failed: true, waiting: false, error: "new-session refusal", progress: 73 },
    "old scope catch must not overwrite the new session refusal");
    assert.equal(h.payloads.length, 0);
    assert.equal((await h.mediaStorage.list(A)).length, 1);
  } finally { held.resolve({}); h.cleanup(); }
}

async function assertLateRestoredProgress(omission?: Omission) {
  const held = deferred();
  let progress!: (progress: number) => void;
  const h = await backgroundHarness(async (payload) => canonical(payload), omission, (onProgress) => {
    progress = onProgress;
    return held.promise;
  });
  try {
    const entry = h.out.outgoingEntry(`tmp:${MEDIA}`);
    h.out.rememberOutgoing({ ...entry, captionPrefix: { ...entry.captionPrefix, accepted: true } });
    const sending = h.background.run();
    await until(() => h.uploads() === 1);
    await restoreSameIDInNewEpoch(h);
    h.store.getState().updateMessage(CHAT, { ...h.shown(), upload_waiting: false, upload_progress: 73 });
    progress(99);
    assert.equal(h.shown().upload_progress, 73, "old upload progress must not patch a restored same-ID placeholder");
    held.resolve({ bucket: "media", path: "synthetic/audio", publicUrl: "synthetic" });
    await sending;
    assert.equal(h.payloads.length, 0);
    assert.equal((await h.mediaStorage.list(A)).length, 1);
  } finally { held.resolve({}); h.cleanup(); }
}

async function assertLateRestoredForget(omission?: Omission) {
  const ack = deferred();
  const h = await backgroundHarness(() => ack.promise, omission);
  try {
    const entry = h.out.outgoingEntry(`tmp:${MEDIA}`);
    h.out.rememberOutgoing({ ...entry, captionPrefix: { ...entry.captionPrefix, accepted: true } });
    const sending = h.background.run();
    await until(() => h.payloads.length === 1);
    await restoreSameIDInNewEpoch(h);
    await sending;
    assert.ok(h.out.outgoingEntry(`tmp:${MEDIA}`), "old insert completion must not forget the restored entry");
    const files = await h.mediaStorage.list(A);
    assert.equal(files.length, 1, "old insert completion must not drop the new session's local bytes");
    assert.equal(await files[0].attachment.file.text(), "retained synthetic voice bytes");
    assert.equal((await h.textStorage.list(A)).length, 1);
    const shown = h.shown();
    ack.resolve(canonical(h.payloads[0])); await flush();
    assert.equal(h.shown(), shown, "late old ACK must leave the restored placeholder unchanged");
    assert.ok(h.out.outgoingEntry(`tmp:${MEDIA}`));
    assert.equal((await h.mediaStorage.list(A)).length, 1);
  } finally { ack.resolve(refused()); h.cleanup(); }
}

test("late generic catch preserves a restored same-ID new-session refusal", async () => {
  await assertLateRestoredCatch();
});
test("late generic progress cannot patch a restored same-ID new-session placeholder", async () => {
  await assertLateRestoredProgress();
});
test("old insert completion and late ACK cannot forget same-ID bytes restored after relogin", async () => {
  await assertLateRestoredForget();
});

async function epochFixture(omission?: Omission) {
  const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");
  const stubs: Record<string, string> = {
    "lib/supabase/client": `export function createClient(){return {from(){let payload;const q={insert(p){payload=p;window.proof.sends.push(p);return q},select(){return q},eq(){return q},lt(){return q},update(){return q},single:async()=>({data:{...payload,id:'server:'+payload.client_message_id,created_at:payload.client_sent_at},error:null,status:201}),maybeSingle:async()=>({data:null}),then(done){return Promise.resolve({}).then(done)}};return q}}}`,
    "lib/monitoring": "export const reportError=()=>{};",
    "lib/personalModeration": "export const blockedSendRefusal=()=>null;",
    "lib/messageAckError": "export const getMessageAckUserMessage=()=>'';export const sanitizeMessageAckError=()=>({});",
    "lib/realtimeRevival": "export const CONNECTION_REVIVED_EVENT='synthetic-revived';",
    "lib/attachmentUpload": "export const uploadAttachmentBytes=async()=>{throw Error('unexpected upload')};",
    "lib/outbox/outboxStorage": `import {memoryOutboxStorage} from '${path.join(root, "lib/outbox/outboxStorage.ts").replaceAll("\\", "/")}'; const storage=memoryOutboxStorage();export const browserOutboxStorage=()=>storage;`,
    "lib/outbox/outgoingMediaStorage": `import {memoryOutgoingMediaStorage} from '${path.join(root, "lib/outbox/outgoingMediaStorage.ts").replaceAll("\\", "/")}'; const storage=memoryOutgoingMediaStorage();export const browserOutgoingMediaStorage=()=>storage;`,
  };
  return build({ write: false, bundle: true, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "isolated-outbox-fixture", setup(build: any) {
      build.onResolve({ filter: /^@\// }, (args: any) => {
        const relative = args.path.slice(2);
        if (stubs[relative]) return { path: relative, namespace: "fixture" };
        return { path: path.join(root, relative + (existsSync(path.join(root, relative + ".ts")) ? ".ts" : ".tsx")) };
      });
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args: any) => ({ contents: stubs[args.path], loader: "ts", resolveDir: root }));
      if (omission) build.onLoad({ filter: /useOutbox\.ts$/ }, () => ({ contents: source("hooks/useOutbox.ts", omission), loader: "ts", resolveDir: path.join(root, "hooks") }));
    } }],
    stdin: { resolveDir: root, sourcefile: "outbox-epoch-fixture.tsx", loader: "tsx", contents: `
      import React,{useEffect} from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {useOutbox} from './hooks/useOutbox'; import {useAppStore} from './store/app.store'; import {appOutbox} from './lib/outbox/appOutbox';
      window.proof={starts:[],sends:[],mountedEpoch:null};const start=appOutbox.start.bind(appOutbox);
      appOutbox.start=(id)=>{window.proof.starts.push(id);return start(id)};
      useAppStore.getState().setCurrentUser({id:${JSON.stringify(A)}});
      function Fixture(){const epoch=useAppStore(s=>s.accountEpoch);useOutbox();useEffect(()=>{window.proof.mountedEpoch=epoch},[epoch]);return null}
      createRoot(document.getElementById('root')).render(<Fixture/>);
      window.relogin=()=>flushSync(()=>{useAppStore.getState().setCurrentUser(null);useAppStore.getState().setCurrentUser({id:${JSON.stringify(A)}})});
      window.heartbeat=()=>flushSync(()=>useAppStore.getState().setCurrentUser({...useAppStore.getState().currentUser,online_at:'2026-10-01T12:00:00Z'}));
      window.send=()=>appOutbox.enqueue({userId:${JSON.stringify(A)},chatId:${JSON.stringify(CHAT)},topicId:null,type:'text',content:'synthetic',
        clientMessageId:${JSON.stringify(PREFIX)},tempId:'tmp:'+${JSON.stringify(PREFIX)},clientSentAt:'2026-10-01T12:00:00Z',
        replyToId:null,forwardedFromId:null,mediaBucket:null,mediaPath:null,mediaUrl:null,attempts:0,nextAttemptAt:0});
    ` } });
}

async function assertEpochRestart(omission?: Omission) {
  const { chromium } = kubRequire("@playwright/test");
  const bundle = await epochFixture(omission);
  const browser = await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    let requests = 0;
    await context.route("**/*", (route: any) => { requests++; return route.abort(); });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => (window as any).proof.mountedEpoch === 1);
    assert.deepEqual(await page.evaluate(() => (window as any).proof.starts), [A]);
    await page.evaluate(() => (window as any).heartbeat());
    assert.deepEqual(await page.evaluate(() => (window as any).proof.starts), [A]);
    await page.evaluate(() => (window as any).relogin());
    await page.waitForFunction(() => (window as any).proof.mountedEpoch === 3);
    assert.deepEqual(await page.evaluate(() => (window as any).proof.starts), [A, A], "same-account new epoch must restart the actual runner");
    assert.equal(await page.evaluate(async () => (await (window as any).send()).kind), "sent");
    assert.deepEqual(await page.evaluate(() => (window as any).proof.sends.map((row: any) => row.client_message_id)), [PREFIX]);
    assert.deepEqual(errors, []);
    assert.equal(requests, 0);
  } finally { await browser.close(); }
}

test("mounted useOutbox restarts and actually sends after batched same-account relogin, not heartbeat", { timeout: 30000 }, async () => {
  await assertEpochRestart();
});

test("omission mutant: epoch dependency is load-bearing in the mounted hook", { timeout: 30000 }, async () => {
  await assert.rejects(assertEpochRestart({ file: "hooks/useOutbox.ts", before: "[userId, accountEpoch]", after: "[userId]" }),
    { code: "ERR_ASSERTION", message: /same-account new epoch/ });
});

for (const [name, before, after] of [
  ["prefix gate", "await ensureCaptionPrefix(entry);", ""],
  ["stable prefix UUID", "appOutbox.enqueue(structuredClone(prefix.entry))", "appOutbox.enqueue({ ...structuredClone(prefix.entry), clientMessageId: crypto.randomUUID() })"],
  ["refusal retention", "await browserOutboxStorage().put(structuredClone(prefix.entry));", ""],
] as const) {
  test(`omission mutant: ${name} is caught by actual restore/refusal/ACK behavior`, async () => {
    await assert.rejects(refusalThenAck({ file: "lib/outbox/appBackgroundUploads.ts", before, after }), { code: "ERR_ASSERTION" });
  });
}

test("omission mutant: prefix owner guard prevents another account's retry", async () => {
  const h = await backgroundHarness(async (payload) => canonical(payload), {
    file: "lib/outbox/appBackgroundUploads.ts", before: "!userId || prefix.entry.userId !== userId ||", after: "!userId ||",
  });
  try {
    const entry = h.out.outgoingEntry(`tmp:${MEDIA}`);
    h.out.rememberOutgoing({ ...entry, captionPrefix: { ...entry.captionPrefix, entry: { ...entry.captionPrefix.entry, userId: B } } });
    await h.background.run();
    assert.equal((await h.textStorage.list(B)).length, 1, "removed ownership guard writes a forbidden other-account retry");
    assert.equal(h.payloads.length, 0, "the runner still independently refuses to send for the other account");
    assert.equal(h.uploads(), 0);
  } finally { h.cleanup(); }
});

for (const [name, omission, check] of [
  ["progress ownership", { file: "lib/outbox/backgroundUploads.ts",
    before: "if (!ownsEntry()) return;", after: "" }, assertLateRestoredProgress],
  ["catch ownership", { file: "lib/outbox/backgroundUploads.ts",
    before: "} catch (error) {\n        if (!ownsEntry()) continue;", after: "} catch (error) {" }, assertLateRestoredCatch],
  ["post-insert ownership", { file: "lib/outbox/backgroundUploads.ts",
    before: "await deps.insert(entry, uploaded);\n        if (!ownsEntry()) continue;", after: "await deps.insert(entry, uploaded);" }, assertLateRestoredForget],
  ["app epoch binding", { file: "lib/outbox/appBackgroundUploads.ts",
    before: "currentAccountEpoch: () => useAppStore.getState().accountEpoch,", after: "" }, assertLateRestoredCatch],
] as const) {
  test(`omission mutant: ${name} protects the restored same-ID new session`, async () => {
    await assert.rejects(check(omission), { code: "ERR_ASSERTION" });
  });
}
