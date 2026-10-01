import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium } = kubRequire("@playwright/test");
const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");
const sourceRoot = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const ORIGIN = "https://renewal.invalid";
const T0 = 1_700_000_000_000;

async function until(check: () => Promise<boolean> | boolean, message: string) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(20);
  }
  assert.equal(await check(), true, message);
}

let clip: Buffer;
let browser: any;
test.before(async () => {
  browser = await chromium.launch({ headless: true,
    env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" },
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const bytes = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 160; canvas.height = 90;
      const ctx = canvas.getContext("2d")!;
      const stream = canvas.captureStream(10);
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      recorder.start();
      for (let i = 0; i < 20; i++) {
        ctx.fillStyle = i % 2 ? "#205c40" : "#eeeeee";
        ctx.fillRect(0, 0, 160, 90);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    });
    clip = Buffer.from(bytes);
    assert.ok(clip.length > 1000, "control WebM contains recorded frames");
  } finally { await context.close(); }
});
test.after(async () => { await browser?.close(); });

function toneWav(): Buffer {
  const rate = 8000;
  const samples = rate * 120;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  const body = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) body[i] = 128 + Math.round(8 * Math.sin(2 * Math.PI * 440 * i / rate));
  return Buffer.concat([header, body]);
}

function instrumentStoreClock(contents: string): string {
  const anchor = "let clockTimer: number | null = null;";
  assert.equal(contents.split(anchor).length - 1, 1, "observe exactly one real store clock");
  return contents.replace(anchor, `${anchor}\n  (clockWindow as any)?.__signedMediaClockCallbacks?.add(checkClock);`);
}

async function consumerBundle(kind = "audio"): Promise<string> {
  const path = kind === "audio" ? "owner/voice.wav" : "owner/clip.webm";
  let mutations = 0;
  const result = await build({
    write: false, bundle: true, platform: "browser", format: "iife",
    alias: { "@": sourceRoot },
    plugins: [{ name: "in-memory-clock-and-omission-proof", setup(plugin: any) {
      plugin.onLoad({ filter: /(?:useMediaObjectUrl|signedMediaUrlStore|playbackUrlPin|signedUrlLifetime)\.ts$/ }, (args: any) => {
        let contents = readFileSync(args.path, "utf8").replace(/\r\n/g, "\n");
        if (/signedMediaUrlStore\.ts$/.test(args.path)) contents = instrumentStoreClock(contents);
        const changes: Record<string, [string, string]> = {
          "omit-clock": ["clockTimer = clockWindow.setTimeout(checkClock, nextCheckDelayMs());", "clockTimer = null;"],
          "omit-deadline": ["setTimeout(checkClock, nextCheckDelayMs())", "setTimeout(checkClock, 60_000)"],
          "omit-resume": ['clockWindow.addEventListener("pageshow", checkClock);', ""],
          "omit-online": ['clockWindow.addEventListener("online", checkClock);', ""],
          "omit-cleanup": ['clockWindow.removeEventListener("online", checkClock);', ""],
          "omit-clock-clear": [
            "function stopClock(): void {\n    if (!clockWindow) return;\n    if (clockTimer !== null) clockWindow.clearTimeout(clockTimer);",
            "function stopClock(): void {\n    if (!clockWindow) return;",
          ],
          "omit-account-clear": ["if (accountId === nextAccountId) return;", "if (accountId !== undefined) return;"],
          "omit-position": ["element.currentTime = at;", "void at;"],
          "omit-play": ["if (wasPlaying) void element.play().catch(() => {});", "void wasPlaying;"],
          "omit-pin": ["return pinned;", "return incoming;"],
          "omit-offline-pin": ["if (!incoming && retained && engaged) return current;", ""],
          "omit-revocation": ["if (!identity) return false;", "return Boolean(url);"],
          "omit-floor": ["return isSignedUrlUsable(entry.lifetime, nowMs) ? entry.url : null;", "return entry.url;"],
          "late-renewal": ["SIGNED_URL_REFRESH_RATIO = 0.8", "SIGNED_URL_REFRESH_RATIO = 0.9"],
        };
        if (process.env.SIGNED_RENEWAL_MUTANT) {
          const change = changes[process.env.SIGNED_RENEWAL_MUTANT];
          assert.ok(change, "unknown mutation selection");
          if (contents.includes(change[0])) {
            mutations++;
            contents = contents.replace(change[0], change[1]);
          }
        }
        return { contents, loader: "ts" };
      });
    } }],
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": JSON.stringify({
        VITE_SUPABASE_URL: ORIGIN,
        VITE_SUPABASE_ANON_KEY: "synthetic-anon-fixture",
        VITE_MEDIA_SIGNED_URLS: "signed-only",
      }),
    },
    stdin: { resolveDir: sourceRoot, sourcefile: "mounted-renewal.tsx", loader: "tsx", contents: `
      import React, {useRef} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {useMessageMediaSource, usePlaybackUrl} from './hooks/useMediaObjectUrl';
      import {signedMediaUrls, mediaUrlMode} from './lib/media/mediaUrl';
      const root = createRoot(document.getElementById('root'));
      const secondRoot = createRoot(document.getElementById('second-root'));
      const row = {media_bucket:'media', media_path:'${path}',
        media_url:'${ORIGIN}/storage/v1/object/public/media/${path}'};
      window.proof = {metadata:0, loadstarts:0, errors:0, recovered:0, download:[]};
      function Consumer({message = row, suffix = ''}) {
        const ref = useRef(null);
        const source = useMessageMediaSource(message);
        const playback = usePlaybackUrl(source.url, ref);
        return <>
          <output id={'offered'+suffix} data-url={source.url ?? ''} data-settled={String(source.settled)} />
          <${kind} id={'media'+suffix} ref={ref} src={playback.url ?? undefined} preload="auto" muted loop
            onLoadStart={() => window.proof.loadstarts++}
            onLoadedMetadata={() => window.proof.metadata++}
            onError={() => {window.proof.errors++; if(playback.recoverFromError()) window.proof.recovered++;}} />
          <button id={'download'+suffix} disabled={!source.url} onClick={async () => {
            const response = await fetch(source.url);
            window.proof.download.push({status:response.status, bytes:(await response.arrayBuffer()).byteLength});
          }}>Download</button>
          <button id={'range'+suffix} onClick={async () => {
            const response = await fetch(playback.url, {headers:{Range:'bytes=100000-110000'}});
            window.proof.rangeStatus = response.status;
            if(response.status === 400) ref.current.dispatchEvent(new Event('error'));
          }}>Range</button>
        </>;
      }
      function TinyConsumer({index}) {
        const source = useMessageMediaSource({...row, media_path:'owner/many-'+index+'.wav'});
        return <output data-many="true" data-url={source.url ?? ''} />;
      }
      window.mount = () => flushSync(() => root.render(<Consumer />));
      window.mountSecond = () => flushSync(() => secondRoot.render(<Consumer
        message={{...row, media_path:'owner/second.wav'}} suffix='-second' />));
      window.unmount = () => flushSync(() => root.render(null));
      window.mountMany = (count) => flushSync(() => secondRoot.render(<>
        {Array.from({length:count}, (_, index) => <TinyConsumer key={index} index={index} />)}
      </>));
      window.unmountMany = () => flushSync(() => secondRoot.render(null));
      window.account = (id) => signedMediaUrls().setAccount(id);
      window.mode = mediaUrlMode();
      window.account('account-a');
      window.mount();
    ` },
  });
  if (process.env.SIGNED_RENEWAL_MUTANT) assert.equal(mutations, 1, "exactly one omission mutant must be applied in memory");
  return result.outputFiles[0].text;
}

let bubbleBundlePromise: Promise<string> | undefined;
function bubbleBundle(): Promise<string> {
  return bubbleBundlePromise ??= (async () => {
    let mutations = 0;
    const result = await build({
      write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      alias: { "@": sourceRoot },
      plugins: [{ name: "in-memory-store-clock-observer", setup(plugin: any) {
        plugin.onLoad({ filter: /signedMediaUrlStore\.ts$/ }, (args: any) => ({
          contents: instrumentStoreClock(readFileSync(args.path, "utf8")), loader: "ts",
        }));
      } }, ...(process.env.SIGNED_MEDIA_IDENTITY_MUTANT ? [{ name: "in-memory-identity-mutant", setup(plugin: any) {
        plugin.onLoad({ filter: /MessageBubble\.tsx$/ }, (args: any) => {
          let contents = readFileSync(args.path, "utf8");
          const changes: Record<string, [string, string]> = {
            "omit-audio-key": ["<AudioMessage\n                key={mediaIdentity}", "<AudioMessage"],
            "omit-video-key": ["<MediaVideo\n                    key={mediaIdentity}", "<MediaVideo"],
            "omit-circle-key": ["<RoundVideoMessage\n                  key={mediaIdentity}", "<RoundVideoMessage"],
            "signed-url-key": ["const mediaIdentity = originalMediaRef ? mediaObjectRefKey(originalMediaRef) : message.media_url;",
              "const mediaIdentity = originalUrl;"],
            "legacy-url-key": ["const mediaIdentity = originalMediaRef ? mediaObjectRefKey(originalMediaRef) : message.media_url;",
              "const mediaIdentity = message.media_url;"],
            "path-only-key": ["mediaObjectRefKey(originalMediaRef) : message.media_url", "originalMediaRef.path : message.media_url"],
            "omit-original-fallback": ["mediaObjectRefKey(originalMediaRef) : message.media_url", "mediaObjectRefKey(originalMediaRef) : null"],
          };
          const change = changes[process.env.SIGNED_MEDIA_IDENTITY_MUTANT!];
          assert.ok(change, "unknown identity mutant");
          // Work on LF in memory; the shared checkout may use CRLF.
          contents = contents.replace(/\r\n/g, "\n");
          assert.ok(contents.includes(change[0]), "identity omission must match the real call site");
          contents = contents.replace(change[0], change[1]);
          mutations++;
          return { contents, loader: "tsx" };
        });
      } }] : [])],
      define: {
        "process.env.NODE_ENV": '"development"',
        "import.meta.env": JSON.stringify({ VITE_SUPABASE_URL: ORIGIN,
          VITE_SUPABASE_ANON_KEY: "synthetic-anon-fixture", VITE_MEDIA_SIGNED_URLS: "signed-only" }),
      },
      stdin: { resolveDir: sourceRoot, sourcefile: "mounted-bubble-renewal.tsx", loader: "tsx", contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import {MessageBubble} from './components/chat/MessageBubble';
        import {ChatMediaPlaybackProvider} from './components/chat/ChatMediaPlayback';
        import {messageEntranceKey} from './lib/messageEntrance';
        import {useMessageMediaSource} from './hooks/useMediaObjectUrl';
        import {signedMediaUrls,mediaUrlMode} from './lib/media/mediaUrl';
        const {kind,legacy,blobUrls} = window.bubbleFixture;
        const path = kind === 'audio' ? 'owner/voice.wav' : 'owner/clip.webm';
        let row = {id:'same-row',client_message_id:'same-client',chat_id:'synthetic-chat',user_id:'synthetic-author',
          type:kind === 'audio' ? 'audio' : 'video',content:null,created_at:'2023-11-14T22:13:20.000Z',
          edited_at:null,deleted_at:null,reply_to_id:null,forwarded_from_id:null,pinned:false,
          sender:{id:'synthetic-author',full_name:'Synthetic author',username:'fixture',avatar_url:null},reactions:[],
          media_bucket:legacy || blobUrls ? null : 'media',media_path:legacy || blobUrls ? null : path,
          media_url:blobUrls?.[0] ?? '${ORIGIN}/storage/v1/object/public/media/'+path,
          media_metadata:{kind:kind === 'circle' ? 'video_message' : kind,duration_ms:120000,width:160,height:90}};
        const root=createRoot(document.getElementById('root'));
        const playlist=[];
        window.proof={metadata:0,loadstarts:0};
        // Observe native elements from the real components, including remounts.
        const label=()=>{const el=document.querySelector('#bubble audio,#bubble video');if(el)el.id='media';};
        new MutationObserver(label).observe(document.getElementById('root'),{childList:true,subtree:true});
        for(const [event,key] of [['loadedmetadata','metadata'],['loadstart','loadstarts']]) {
          document.addEventListener(event,e=>{if(e.target.closest('#bubble'))window.proof[key]++;},true);
        }
        function MountedRow({message}) {
          const source=useMessageMediaSource(message);
          return <><output id="offered" data-url={source.url??''} data-settled={String(source.settled)}/>
            <div id="bubble"><MessageBubble message={message} isMe={false} isFirstInGroup={false}
              isLastInGroup={true} onReaction={()=>{}} /></div></>;
        }
        const render=()=>flushSync(()=>root.render(<ChatMediaPlaybackProvider chatId={row.chat_id} playlist={playlist}>
          <MountedRow key={messageEntranceKey(row)} message={row}/></ChatMediaPlaybackProvider>));
        window.switchObject=(bucket,path)=>{row={...row,media_bucket:legacy?null:bucket,media_path:legacy?null:path,
          media_url:'${ORIGIN}/storage/v1/object/public/'+bucket+'/'+path};render();};
        window.updateOriginalUrl=()=>{row={...row,media_url:row.media_url+'?version=next'};render();};
        window.switchBlobObject=()=>{row={...row,media_url:blobUrls[1]};render();};
        window.account=id=>signedMediaUrls().setAccount(id);
        window.mode=mediaUrlMode();window.account('account-a');render();label();
      ` },
    });
    if (process.env.SIGNED_MEDIA_IDENTITY_MUTANT) assert.equal(mutations, 1, "exactly one identity mutant applied in memory");
    return result.outputFiles[0].text;
  })();
}

async function fixture(bundle: string, kind = "audio", initialDelay = 0, bubble?: {kind: string; legacy: boolean; blob?: boolean}) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const wav = kind === "audio" ? toneWav() : clip;
  const path = kind === "audio" ? "owner/voice.wav" : "owner/clip.webm";
  let now = T0;
  let offline = false;
  let refused = false;
  let releaseObject!: () => void;
  let objectGate: Promise<void> | undefined;
  let objectRefused = false;
  const signs: Array<{at: number; ttl: number; paths: string[]}> = [];
  const loads: Array<{status: number; token: string; range: string | null}> = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
  page.on("pageerror", (error: Error) => errors.push(error.message));
  await context.route("**/*", async (route: any) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === ORIGIN && url.pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><div id="second-root"></div>' });
    }
    if (url.origin === ORIGIN && /^\/storage\/v1\/object\/sign\/(media|other)$/.test(url.pathname) && request.method() === "POST") {
      const body = request.postDataJSON();
      signs.push({ at: now - T0, ttl: body.expiresIn, paths: body.paths });
      if (signs.length === 1 && initialDelay) await firstResponse;
      const bucket = url.pathname.split("/").at(-1);
      const isOtherObject = bucket !== "media" || body.paths.includes("owner/second.wav");
      if (isOtherObject && objectGate) await objectGate;
      if (offline) return route.abort("internetdisconnected");
      return route.fulfill({ json: body.paths.map((path: string) => refused || (isOtherObject && objectRefused)
        ? { path, signedURL: null, error: "Object not found" }
        : { path, signedURL: `/object/sign/${bucket}/${path}?token=${now}`, error: null }) });
    }
    if (url.origin === ORIGIN && [path, "owner/second.wav"].some((object) => url.pathname === `/storage/v1/object/sign/media/${object}`)) {
      const token = url.searchParams.get("token") ?? "";
      const status = now >= Number(token) + 3_600_000 ? 400 : 200;
      loads.push({ status, token, range: request.headers()["range"] ?? null });
      if (status === 400) return route.fulfill({ status, json: { error: "expired" } });
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers()["range"] ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
      return route.fulfill({ status: range ? 206 : 200, contentType: kind === "audio" ? "audio/wav" : "video/webm",
        headers: { "accept-ranges": "bytes", "cache-control": "no-store",
          ...(range ? { "content-range": `bytes ${start}-${end}/${wav.length}` } : {}) },
        body: wav.subarray(start, end + 1) });
    }
    unexpected.push(url.pathname);
    return route.abort();
  });
  await page.goto(ORIGIN);
  if (bubble) await page.evaluate(() => {
    (window as any).nativeAnimationFrame = window.requestAnimationFrame.bind(window);
    (window as any).nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  });
  // install starts running immediately; pause at a future instant so host load
  // cannot turn the setup itself into a backwards clock jump.
  await page.clock.install({ time: T0 - 60_000 });
  await page.clock.pauseAt(T0);
  // Only URL lifetime timers advance by hours. Native playback/progress stays
  // on the browser's animation clock, not thousands of synthetic RAF ticks.
  if (bubble) await page.evaluate(() => {
    window.requestAnimationFrame = (window as any).nativeAnimationFrame;
    window.cancelAnimationFrame = (window as any).nativeCancelAnimationFrame;
  });
  await page.evaluate(() => {
    const w = window as any;
    w.__signedMediaClockCallbacks = new WeakSet<Function>();
    w.resources = { timers: new Map<number, number>(), clockRuns: 0, events: new Map<string, Set<unknown>>() };
    const set = window.setTimeout.bind(window);
    const clear = window.clearTimeout.bind(window);
    window.setTimeout = ((callback: TimerHandler, ms?: number, ...args: any[]) => {
      const owned = typeof callback === "function" && w.__signedMediaClockCallbacks.has(callback);
      let handle: number;
      handle = set(() => {
        w.resources.timers.delete(handle);
        if (owned) w.resources.clockRuns++;
        if (typeof callback === "function") callback(...args);
      }, ms);
      if (owned) w.resources.timers.set(handle, ms ?? 0);
      return handle;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((handle: number) => { w.resources.timers.delete(handle); clear(handle); }) as typeof window.clearTimeout;
    for (const [target, names] of [[window, ["online", "focus", "pageshow"]], [document, ["visibilitychange"]]] as const) {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      (target as any).addEventListener = (name: string, callback: any, options?: any) => {
        if (names.includes(name as any)) {
          if (!w.resources.events.has(name)) w.resources.events.set(name, new Set());
          w.resources.events.get(name).add(callback);
        }
        add(name, callback, options);
      };
      (target as any).removeEventListener = (name: string, callback: any, options?: any) => {
        w.resources.events.get(name)?.delete(callback);
        remove(name, callback, options);
      };
    }
    w.resourceCounts = () => ({ timers: w.resources.timers.size,
      events: Object.fromEntries([...w.resources.events].map(([name, callbacks]: any) => [name, callbacks.size])) });
    w.storeClockState = () => ({ delays: [...w.resources.timers.values()], runs: w.resources.clockRuns });
  });
  if (bubble) await page.evaluate(({options, bytes, contentType}) => {
    (window as any).bubbleFixture = {...options, ...(bytes ? {blobUrls: [0, 1].map(() =>
      URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: contentType})))} : {})};
  }, {options: bubble, bytes: bubble.blob ? [...wav] : null, contentType: kind === "audio" ? "audio/wav" : "video/webm"});
  await page.addScriptTag({ content: bundle });
  if (initialDelay) {
    await until(() => signs.length === 1, "initial delayed signing request was not reached");
    now += initialDelay;
    await page.clock.runFor(initialDelay);
    releaseFirst();
  }
  await page.waitForFunction(() => (document.getElementById("media") as HTMLMediaElement)?.readyState >= 1);
  assert.equal(await page.evaluate(() => (window as any).mode), "signed-only");
  assert.deepEqual(signs, bubble?.blob ? [] : [{ at: 0, ttl: 3600, paths: [path] }]);
  if (!bubble?.blob) assert.ok(loads.some((load) => load.status === 200), "control actually fetched signed media bytes");
  const duration = await page.evaluate(() => (document.getElementById("media") as HTMLMediaElement).duration);
  if (kind === "audio") assert.equal(duration, 120);
  else {
    assert.ok(duration > 1, "native video metadata decoded");
    assert.equal(await page.evaluate(() => (document.getElementById("media") as HTMLVideoElement).videoWidth), 160);
  }
  return {
    page, signs, loads, unexpected, errors,
    setOffline(value: boolean) { offline = value; },
    setRefused(value: boolean) { refused = value; },
    holdOtherObject() { objectGate = new Promise<void>((resolve) => { releaseObject = resolve; }); },
    refuseOtherObject() { objectRefused = true; releaseObject(); },
    async advance(to: number) {
      const delta = T0 + to - now;
      assert.ok(delta >= 0);
      now = T0 + to;
      await page.clock.runFor(delta);
      // Cross the actual browser task boundary without asking the resolver/store to read.
      await page.evaluate(() => new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
        channel.port2.postMessage(null);
      }));
    },
    async resumeAt(to: number, event: string) {
      now = T0 + to;
      await page.clock.setSystemTime(now);
      await page.evaluate((name: string) => window.dispatchEvent(new Event(name)), event);
    },
    async close() {
      releaseObject?.();
      await context.close();
    },
  };
}

for (const kind of ["audio", "video", "circle"]) {
  test(`real ${kind} ORIGINAL blob URL fallback resets same-row native identity`, { timeout: 30000 }, async () => {
    const f = await fixture(await bubbleBundle(), kind === "audio" ? "audio" : "video", 0,
      {kind, legacy: false, blob: true});
    try {
      await f.page.evaluate(() => {
        const element = document.getElementById("media") as HTMLMediaElement;
        (window as any).oldElement = element;
        element.currentTime = 0.75;
        (window as any).switchBlobObject();
      });
      assert.equal(await f.page.evaluate(() => (window as any).oldElement.isConnected), false,
        "ORIGINAL unpersisted media_url fallback must reset the player, not reuse A");
      await f.page.waitForFunction(() => (document.getElementById("media") as HTMLMediaElement)?.readyState >= 1);
      assert.equal(await f.page.evaluate(() => (document.getElementById("media") as HTMLMediaElement).currentTime), 0);
      assert.deepEqual(f.signs, [], "local blob preview must not request a signed/public fallback");
      assert.deepEqual(f.unexpected, []);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
  for (const shape of ["path", "legacy", "bucket-only"]) {
    test(`real ${kind} same-row ${shape} A to pending/refused B discards the old native element`, { timeout: 30000 }, async () => {
      const f = await fixture(await bubbleBundle(), kind === "audio" ? "audio" : "video", 0,
        { kind, legacy: shape === "legacy" });
      try {
        await f.page.evaluate(() => {
          const element = document.getElementById("media") as HTMLMediaElement;
          (window as any).oldElement = element;
          element.currentTime = 0.75;
        });
        await f.page.waitForFunction(() => (document.getElementById("media") as HTMLMediaElement).currentTime >= 0.75);
        const controlLoads = f.loads.length;
        f.holdOtherObject();
        await f.page.evaluate(({bucket, path}) => (window as any).switchObject(bucket, path), {
          bucket: shape === "bucket-only" ? "other" : "media",
          path: shape === "bucket-only" ? kind === "audio" ? "owner/voice.wav" : "owner/clip.webm" : "owner/second.wav",
        });
        await until(() => f.signs.length === 2, "real same-row B reaches the signing provider");
        assert.equal(await f.page.locator("#offered").getAttribute("data-url"), "", "B has no signed URL while pending");
        assert.equal(await f.page.locator("#offered").getAttribute("data-settled"), "false");
        assert.equal(await f.page.evaluate(() => (window as any).oldElement.isConnected), false,
          "same-row object replacement must detach A even while B is pending");
        assert.equal(await f.page.evaluate(() => document.getElementById("media")?.getAttribute("src") ?? null), null,
          "pending B must not expose A's cached signature");
        f.refuseOtherObject();
        await f.page.waitForFunction(() => document.getElementById("offered")!.dataset.settled === "true");
        assert.equal(await f.page.evaluate(() => document.getElementById("media")?.getAttribute("src") ?? null), null,
          "refused B must not revive A's cached signature");
        assert.equal(await f.page.evaluate(() => (window as any).oldElement.isConnected), false);
        assert.equal(f.loads.length, controlLoads, "replacement/refusal must not fetch old A again");
        assert.deepEqual(f.unexpected, [], "neither public fallback nor an unrelated provider request");
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });
  }
  for (const legacy of [false, true]) {
    for (const playing of [false, true]) {
      test(`real ${kind} ${legacy ? "legacy" : "path"} ${playing ? "playing" : "paused"} identity holds at literal 48/55/60 minutes`, { timeout: 30000 }, async () => {
        const f = await fixture(await bubbleBundle(), kind === "audio" ? "audio" : "video", 0, {kind, legacy});
        try {
          const original = await f.page.locator("#media").getAttribute("src");
          await f.page.evaluate(async (play) => {
            const element = document.getElementById("media") as HTMLMediaElement;
            (window as any).oldElement = element;
            element.currentTime = 0.75;
            element.muted = true;
            element.loop = true;
            if (play) await element.play();
          }, playing);
          await f.page.waitForFunction(() => (document.getElementById("media") as HTMLMediaElement).currentTime > 0);
          await f.page.evaluate(() => (window as any).updateOriginalUrl());
          const checkPin = async (boundary: string) => {
            assert.equal(await f.page.evaluate(() => document.getElementById("media") === (window as any).oldElement), true,
              `${boundary}: stable persisted identity must not remount the real consumer`);
            assert.equal(await f.page.locator("#media").getAttribute("src"), original,
              `${boundary}: signature renewal/offline must not reload engaged media`);
            assert.equal(await f.page.evaluate(() => (document.getElementById("media") as HTMLMediaElement).paused), !playing);
            const at = await f.page.evaluate(() => (document.getElementById("media") as HTMLMediaElement).currentTime);
            if (!playing) assert.equal(at, 0.75, `${boundary}: paused native position remains 0.75s`);
            else assert.ok(at > 0, `${boundary}: playing native position was not reset`);
          };
          await checkPin("same-object ORIGINAL URL metadata update");
          await f.advance(2_879_999);
          assert.equal(f.signs.length, 1, "47:59.999 does not renew");
          await f.advance(2_880_000);
          await until(() => f.signs.length === 2, "real consumer renews at literal 48:00");
          await until(async () => (await f.page.locator("#offered").getAttribute("data-url")) !== original,
            "renewed signed URL actually reaches the parent");
          await checkPin("48:00");
          const loads = await f.page.evaluate(() => (window as any).proof.loadstarts);
          f.setOffline(true);
          await f.advance(6_180_000);
          assert.equal(await f.page.locator("#offered").getAttribute("data-url"), "", "renewed URL hits its 55-minute download floor");
          await checkPin("renewed token 55:00 offline");
          await f.advance(6_480_000);
          await checkPin("renewed token 60:00 offline");
          assert.equal(await f.page.evaluate(() => (window as any).proof.loadstarts), loads,
            "no forced loadstart while the same object stays engaged offline");
          assert.deepEqual(f.unexpected, []);
          assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
      });
    }
  }
}

test("mounted idle consumer renews at literal 48 minutes without render or store.get", { timeout: 30000 }, async () => {
  const f = await fixture(await consumerBundle());
  try {
    const before = await f.page.locator("#media").getAttribute("src");
    await f.advance(2_879_999);
    assert.equal(f.signs.length, 1, "47:59.999 is still fresh");
    await f.advance(2_880_000);
    // The virtual clock stays at 48:00 while the HTTP event crosses into Node.
    await until(() => f.signs.length === 2, "48:00 must reach the signing provider");
    assert.equal(f.signs.length, 2, "48:00 must renew an already mounted idle consumer");
    await f.page.waitForFunction(() => document.getElementById("media")?.getAttribute("src")?.includes("1700002880000"));
    assert.notEqual(await f.page.locator("#media").getAttribute("src"), before);
    assert.deepEqual(f.signs[1], { at: 2_880_000, ttl: 3600, paths: ["owner/voice.wav"] });
    await f.advance(3_300_000);
    await f.advance(3_600_000);
    await f.page.locator("#download").click();
    await f.page.waitForFunction(() => (window as any).proof.download.length === 1);
    assert.deepEqual(await f.page.evaluate(() => (window as any).proof.download), [{ status: 200, bytes: 960044 }]);
    assert.equal(f.signs.length, 2, "55/60 minutes use the already renewed address");
    assert.deepEqual(f.unexpected, []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("mounted renewal deadline follows delayed provider response, not the subscription minute", { timeout: 30000 }, async () => {
  const f = await fixture(await consumerBundle(), "audio", 1234);
  try {
    await f.advance(2_880_000);
    assert.equal(f.signs.length, 1, "48 minutes since mount is too early for the delayed signature");
    await f.advance(2_881_233);
    assert.equal(f.signs.length, 1, "one millisecond before actual renewal deadline stays fresh");
    await f.advance(2_881_234);
    await until(() => f.signs.length === 2, "exact 48-minute lifetime deadline must renew, not wait another subscription minute");
    assert.deepEqual(f.signs[1], { at: 2_881_234, ttl: 3600, paths: ["owner/voice.wav"] });
  } finally { await f.close(); }
});

test("mounted delayed signature releases its shortened store clock on last unsubscribe", { timeout: 30000 }, async () => {
  const f = await fixture(await consumerBundle(), "audio", 1234);
  try {
    await f.advance(2_880_000);
    await f.resumeAt(2_880_000, "focus");
    assert.equal(f.signs.length, 1, "the delayed signature is not due at 48 minutes since mount");
    const before = await f.page.evaluate(() => (window as any).storeClockState());
    assert.deepEqual(before.delays, [1234], "focus must arm the real store clock for its remaining lifetime");

    await f.page.evaluate(() => {
      const w = window as any;
      w.foreignClockRuns = 0;
      w.foreignTimers = [60_000, 1234].map((ms) => window.setTimeout(() => w.foreignClockRuns++, ms));
    });
    assert.deepEqual(await f.page.evaluate(() => (window as any).storeClockState()), before,
      "unregistered callbacks must not enter the store clock counter, regardless of delay");
    assert.deepEqual(await f.page.evaluate(() => (window as any).resourceCounts()), {
      timers: 1, events: { online: 1, focus: 1, pageshow: 2, visibilitychange: 1 },
    });

    await f.page.evaluate(() => (window as any).unmount());
    assert.deepEqual(await f.page.evaluate(() => (window as any).resourceCounts()), {
      timers: 0, events: { online: 0, focus: 0, pageshow: 1, visibilitychange: 0 },
    }, "last unsubscribe must cancel even a shortened store deadline timer");
    await f.advance(2_881_234);
    assert.deepEqual(await f.page.evaluate(() => (window as any).storeClockState()), {
      delays: [], runs: before.runs,
    }, "the cancelled store callback must not run after its deadline");
    assert.equal(await f.page.evaluate(() => (window as any).foreignClockRuns), 1,
      "the foreign short timer actually fires without being counted as store-owned");
    assert.equal(f.signs.length, 1, "unmounted delayed objects must not renew");
    await f.page.evaluate(() => (window as any).foreignTimers.forEach((handle: number) => window.clearTimeout(handle)));
    assert.deepEqual(f.unexpected, []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("staggered mounted objects renew independently at their literal 48-minute deadlines", { timeout: 30000 }, async () => {
  const f = await fixture(await consumerBundle());
  try {
    await f.advance(1234);
    await f.page.evaluate(() => (window as any).mountSecond());
    await until(async () => await f.page.evaluate(() => (document.getElementById("media-second") as HTMLMediaElement).readyState >= 1),
      "second mounted control never decoded");
    assert.deepEqual(f.signs[1], { at: 1234, ttl: 3600, paths: ["owner/second.wav"] });
    await f.advance(2_879_999);
    assert.equal(f.signs.length, 2);
    await f.advance(2_880_000);
    await until(() => f.signs.length === 3, "first object's literal 48:00 cannot follow second object's subscription phase");
    assert.deepEqual(f.signs[2], { at: 2_880_000, ttl: 3600, paths: ["owner/voice.wav"] });
    await f.advance(2_881_233);
    assert.equal(f.signs.length, 3, "second object remains fresh one millisecond before its own deadline");
    await f.advance(2_881_234);
    await until(() => f.signs.length === 4, "second object must renew exactly 48:00 after its own response");
    assert.deepEqual(f.signs[3], { at: 2_881_234, ttl: 3600, paths: ["owner/second.wav"] });
    assert.deepEqual(f.unexpected, []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("100 mounted consumers share one clock scheduler and release every owned resource on unsubscribe", { timeout: 30000 }, async () => {
  const f = await fixture(await consumerBundle());
  try {
    await f.page.evaluate(() => (window as any).mountMany(100));
    assert.equal(await f.page.locator('[data-many="true"]').count(), 100);
    await until(async () => await f.page.locator('[data-many="true"][data-url*="/object/sign/"]').count() === 100,
      "100 distinct mounted objects must resolve through the real signing store");
    assert.equal(await f.page.locator('[data-many="true"][data-url*="/object/sign/"]').count(), 100);
    assert.deepEqual(await f.page.evaluate(() => (window as any).resourceCounts()), {
      // supabase-js owns one additional pageshow handler, retained after unmount.
      timers: 1, events: { online: 1, focus: 1, pageshow: 2, visibilitychange: 1 },
    }, "one shared scheduler, not two timers and four listeners per source subscription");
    assert.equal(f.signs.length, 2, "100 new mounted objects must coalesce into one additional POST");
    assert.equal(f.signs[1].paths.length, 100, "literal provider batch cap");
    await f.advance(2_880_000);
    await until(() => f.signs.length === 4, "101 mounted objects renew at literal 48:00 in two bounded POSTs");
    await f.page.evaluate(() => { (window as any).unmountMany(); (window as any).unmount(); });
    assert.deepEqual(await f.page.evaluate(() => (window as any).resourceCounts()), {
      timers: 0, events: { online: 0, focus: 0, pageshow: 1, visibilitychange: 0 },
    }, "last unsubscribe releases the timer and every lifecycle listener");
    await f.advance(7_200_000);
    await f.page.evaluate(() => window.dispatchEvent(new Event("online")));
    assert.equal(f.signs.length, 4, "unobserved objects cannot keep renewing");
    assert.deepEqual(f.unexpected, []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const kind of ["audio", "video"]) {
  for (const playing of [false, true]) {
    test(`mounted ${kind} ${playing ? "playing" : "paused"} survives offline floor without reload, but drops a refused pin`, { timeout: 30000 }, async () => {
      const f = await fixture(await consumerBundle(kind), kind);
      try {
        await f.page.evaluate(async (active: boolean) => {
          const element = document.getElementById("media") as HTMLMediaElement;
          element.currentTime = 0.75;
          if (active) await element.play();
        }, playing);
        const src = await f.page.locator("#media").getAttribute("src");
        const loadstarts = await f.page.evaluate(() => (window as any).proof.loadstarts);
        f.setOffline(true);
        await f.advance(2_880_000);
        await until(() => f.signs.length === 2, "offline renewal was not attempted");
        await f.advance(3_300_000);
        await until(async () => await f.page.locator("#offered").getAttribute("data-url") === "", "download floor not reached");
        assert.equal(await f.page.locator("#media").getAttribute("src"), src,
          "offline floor must withhold new downloads, not unload engaged playback");
        assert.equal(await f.page.evaluate(() => (window as any).proof.loadstarts), loadstarts);
        assert.equal(await f.page.locator("#download").isDisabled(), true);
        assert.equal(await f.page.evaluate(() => (document.getElementById("media") as HTMLMediaElement).paused), !playing);
        if (!playing) assert.equal(await f.page.evaluate(() => (document.getElementById("media") as HTMLMediaElement).currentTime), 0.75);
        f.setOffline(false);
        await f.resumeAt(3_360_000, "online");
        await until(async () => (await f.page.locator("#offered").getAttribute("data-url"))?.includes("1700003360000") === true,
          "mounted offline playback did not get a fresh offer on reconnect");
        assert.equal(await f.page.locator("#media").getAttribute("src"), src, "online renewal must also avoid forced reload");
        assert.equal(await f.page.evaluate(() => (window as any).proof.loadstarts), loadstarts);
        // If the offer becomes null while offline again, a later provider refusal
        // must still revoke the pin even though the source snapshot stays null.
        f.setOffline(true);
        await f.advance(6_660_000);
        await until(async () => await f.page.locator("#offered").getAttribute("data-url") === "", "second offline floor not reached");
        f.setOffline(false);
        f.setRefused(true);
        await f.resumeAt(6_660_001, "online");
        await until(async () => await f.page.locator("#offered").getAttribute("data-settled") === "true"
          && await f.page.locator("#media").getAttribute("src") === null, "a refusal must revoke even an already withheld source");
        assert.equal(await f.page.locator("#download").isDisabled(), true);
        assert.deepEqual(f.unexpected, []);
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });

    test(`mounted ${kind} ${playing ? "playing" : "paused"} keeps its source and position through 48/55/60`, { timeout: 30000 }, async () => {
      const f = await fixture(await consumerBundle(kind), kind);
      try {
        await f.page.evaluate(async (active: boolean) => {
          const element = document.getElementById("media") as HTMLMediaElement;
          element.currentTime = 0.75;
          if (active) await element.play();
        }, playing);
        const src = await f.page.locator("#media").getAttribute("src");
        const loadstarts = await f.page.evaluate(() => (window as any).proof.loadstarts);
        await f.advance(2_880_000);
        await until(() => f.signs.length === 2, "48-minute mounted renewal did not reach provider");
        await until(async () => (await f.page.locator("#offered").getAttribute("data-url"))?.includes("1700002880000") === true,
          "fresh signature did not reach mounted source hook");
        await f.advance(3_300_000);
        await f.advance(3_600_000);
        assert.equal(await f.page.locator("#media").getAttribute("src"), src, "renewal must not reload engaged media");
        assert.equal(await f.page.evaluate(() => (window as any).proof.loadstarts), loadstarts);
        assert.equal(await f.page.evaluate(() => (document.getElementById("media") as HTMLMediaElement).paused), !playing);
        const position = await f.page.evaluate(() => (document.getElementById("media") as HTMLMediaElement).currentTime);
        if (playing) assert.ok(position > 0, "native playing position remains live");
        else assert.equal(position, 0.75);
        await f.page.locator("#download").click();
        await until(async () => await f.page.evaluate(() => (window as any).proof.download.length === 1), "download did not complete");
        assert.equal(await f.page.evaluate(() => (window as any).proof.download[0].status), 200);
        assert.deepEqual(f.unexpected, []);
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });

    test(`mounted ${kind} ${playing ? "playing" : "paused"} recovers an expired Range at 60 minutes at its previous position`, { timeout: 30000 }, async () => {
      const f = await fixture(await consumerBundle(kind), kind);
      try {
        await f.page.evaluate(async (active: boolean) => {
          const element = document.getElementById("media") as HTMLMediaElement;
          element.currentTime = 0.75;
          if (active) await element.play();
        }, playing);
        await f.advance(2_880_000);
        await until(async () => (await f.page.locator("#offered").getAttribute("data-url"))?.includes("1700002880000") === true,
          "mounted hook did not receive a fresh signature");
        await f.advance(3_600_000);
        // Chromium may have the complete clip buffered. The fixture consumer's
        // Range press forces the provider boundary, then delivers that 400 as
        // an element error; metadata/reload/seek/play are the real browser's.
        await f.page.evaluate(() => { (document.getElementById("media") as HTMLMediaElement).currentTime = 0.75; });
        await f.page.locator("#range").click();
        await until(async () => await f.page.evaluate(() => (window as any).proof.recovered === 1 && (window as any).proof.metadata >= 2),
          "expired provider Range did not recover through mounted playback hook");
        assert.equal(await f.page.evaluate(() => (window as any).proof.rangeStatus), 400);
        assert.ok(f.loads.some((load) => load.status === 400 && load.range === "bytes=100000-110000"));
        assert.ok(await f.page.evaluate(() => (document.getElementById("media") as HTMLMediaElement).currentTime >= 0.75),
          "loadedmetadata must restore the interrupted position");
        assert.equal(await f.page.evaluate(() => (document.getElementById("media") as HTMLMediaElement).paused), !playing,
          "recovery must preserve playing/paused state, not leave a playing consumer paused");
        assert.deepEqual(f.unexpected, []);
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });
  }
}

test("mounted idle consumer withholds offline URL at literal 55 minutes and reconnects without public fallback", { timeout: 30000 }, async () => {
  const f = await fixture(await consumerBundle());
  try {
    const original = await f.page.locator("#offered").getAttribute("data-url");
    f.setOffline(true);
    await f.advance(2_880_000);
    await until(() => f.signs.length >= 2, "offline renewal was never attempted");
    await f.advance(3_299_999);
    assert.equal(await f.page.locator("#offered").getAttribute("data-url"), original, "54:59.999 retains valid download margin");
    await f.advance(3_300_000);
    await until(async () => await f.page.locator("#offered").getAttribute("data-url") === "", "55:00 must withhold the spent download URL");
    assert.equal(await f.page.locator("#download").isDisabled(), true);
    await f.advance(3_600_000);
    assert.equal(await f.page.locator("#offered").getAttribute("data-url"), "");
    f.setOffline(false);
    await f.resumeAt(3_600_001, "online");
    await until(async () => (await f.page.locator("#offered").getAttribute("data-url"))?.includes("1700003600001") === true,
      "online event did not heal an idle mounted consumer");
    await f.page.locator("#download").click();
    await until(async () => await f.page.evaluate(() => (window as any).proof.download.length === 1), "reconnected download did not finish");
    assert.deepEqual(await f.page.evaluate(() => (window as any).proof.download), [{ status: 200, bytes: 960044 }]);
    assert.deepEqual(f.unexpected, []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("background resume after 60 minutes renews mounted consumer and unmount stops renewal", { timeout: 30000 }, async () => {
  const f = await fixture(await consumerBundle());
  try {
    await f.resumeAt(3_600_000, "pageshow");
    await until(async () => (await f.page.locator("#offered").getAttribute("data-url"))?.includes("1700003600000") === true,
      "pageshow must catch up after suspended timers");
    assert.equal(f.signs.length, 2);
    await f.page.evaluate(() => (window as any).unmount());
    await f.advance(7_200_000);
    await f.page.evaluate(() => window.dispatchEvent(new Event("online")));
    assert.equal(f.signs.length, 2, "unmounted cache entries must not renew forever");
    assert.deepEqual(f.unexpected, []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("account/refusal removes the old mounted source and never requests public fallback", { timeout: 30000 }, async () => {
  const f = await fixture(await consumerBundle());
  try {
    await f.page.evaluate(async () => {
      const element = document.getElementById("media") as HTMLMediaElement;
      element.currentTime = 0.75;
      await element.play();
    });
    f.setRefused(true);
    await f.page.evaluate(() => (window as any).account("account-b"));
    await until(async () => await f.page.locator("#offered").getAttribute("data-settled") === "true"
      && await f.page.locator("#offered").getAttribute("data-url") === "", "account refusal did not settle without a URL");
    assert.equal(await f.page.locator("#media").getAttribute("src"), null);
    assert.equal(await f.page.locator("#download").isDisabled(), true);
    assert.equal(f.signs.length, 2);
    await f.advance(29_999);
    assert.equal(f.signs.length, 2, "refusal cannot spin inside literal 30-second cooldown");
    f.setRefused(false);
    await f.resumeAt(30_000, "focus");
    await until(async () => (await f.page.locator("#offered").getAttribute("data-url"))?.includes("1700000030000") === true,
      "allowed account did not heal after literal 30-second refusal cooldown");
    assert.equal(f.signs.length, 3);
    assert.deepEqual(f.unexpected, []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
