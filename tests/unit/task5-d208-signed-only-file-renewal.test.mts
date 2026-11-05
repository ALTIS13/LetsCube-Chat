import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { Browser, Page } from "@playwright/test";

const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium, expect } = kubRequire("@playwright/test") as typeof import("@playwright/test");
const { build } = createRequire(kubRequire.resolve("vite"))("esbuild") as typeof import("esbuild");
const source = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const origin = "https://d208-file.invalid";
const file = "renewal.txt";
const path = `fictional-sender/${file}`;
const text = "Synthetic D-208 FILE\nSecond line\n";
const staleText = "Superseded D-208 response\n";
const sign = "/storage/v1/object/sign/media";
const publicPath = `/storage/v1/object/public/media/${path}`;
const epoch = new Date("2026-11-05T20:00:00Z").getTime();
const renewalMs = 48 * 60_000;
const mutants = {
  "sticky-error": ["if (!controller.signal.aborted) setTextPreview({ text });",
    'if (!controller.signal.aborted) setTextPreview(current => current === "failed" ? current : { text });'],
  "late-success": ["if (!controller.signal.aborted) setTextPreview({ text });", "setTextPreview({ text });"],
  "late-error": ['if (!controller.signal.aborted) setTextPreview("failed");', 'setTextPreview("failed");'],
} as const;
const mutant = process.env.LETSCUBE_D208_FILE_MUTANT;
assert.ok(!mutant || Object.hasOwn(mutants, mutant), "unknown D-208 FILE mutant");

async function bundle() {
  let transformed = 0;
  const result = await build({
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": source }, logLevel: "silent",
    plugins: mutant ? [{ name: "d208-in-memory-regression-control", setup(plugin) {
      plugin.onLoad({ filter: /FileMessageRow\.tsx$/ }, async args => {
        assert.equal(resolve(args.path), resolve(source, "components/chat/FileMessageRow.tsx"));
        const code = await readFile(args.path, "utf8");
        const [anchor, replacement] = mutants[mutant as keyof typeof mutants];
        assert.equal(code.split(anchor).length, 2, "one actual viewer state write");
        transformed++;
        return { loader: "tsx", contents: code.replace(anchor, replacement) };
      });
    } }] : [],
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": JSON.stringify({
        VITE_SUPABASE_URL: origin, VITE_SUPABASE_ANON_KEY: "fictional-anon", VITE_MEDIA_SIGNED_URLS: "signed-only",
      }),
    },
    stdin: { resolveDir: source, loader: "tsx", contents: `
      import { createRoot } from 'react-dom/client';
      import { MessageBubble } from './components/chat/MessageBubble';
      import { ChatMediaPlaybackProvider } from './components/chat/ChatMediaPlayback';
      import { mediaUrlMode, signedMediaUrls } from './lib/media/mediaUrl';
      import { managedMedia } from './lib/mediaCache/appMediaCache';
      const message = {
        id:'fixture-file', chat_id:'fixture-chat', user_id:'fictional-sender', type:'file', content:${JSON.stringify(file)},
        created_at:'2026-11-05T20:00:00Z', deleted_at:null, edited_at:null, reply_to_id:null,
        forwarded_from_id:null, pinned:false, reactions:[], sender:{id:'fictional-sender', full_name:'Fictional sender'},
        media_bucket:'media', media_path:${JSON.stringify(path)}, media_url:${JSON.stringify(origin + publicPath)},
        media_metadata:{file_name:${JSON.stringify(file)},mime_type:'text/plain',size_bytes:${Buffer.byteLength(text)}},
      };
      signedMediaUrls().setAccount('fictional-reader');
      window.fixtureMode = mediaUrlMode();
      window.fixturePartition = managedMedia.partition();
      const root = createRoot(document.querySelector('#root'));
      window.disposeFixture = () => root.unmount();
      root.render(<ChatMediaPlaybackProvider chatId={message.chat_id} playlist={[]}>
        <MessageBubble message={message} isMe={false} isFirstInGroup={true} isLastInGroup={true} onReaction={()=>{}} />
      </ChatMediaPlaybackProvider>);
    ` },
  });
  assert.equal(transformed, mutant ? 1 : 0);
  return result.outputFiles[0].text;
}

async function savedFile(page: Page) {
  const downloaded = page.waitForEvent("download");
  await page.getByTestId("document-viewer").getByRole("button", { name: "Скачать", exact: true }).first().click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), file);
  assert.equal(await download.failure(), null);
  assert.equal(await readFile((await download.path())!, "utf8"), text);
}

async function exercise(browser: Browser, script: string, firstRead: 200 | 400 | "late-success" | "late-error") {
  const late = typeof firstRead === "string" ? firstRead : null;
  const firstGet = typeof firstRead === "number" ? firstRead : 200;
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const posts: unknown[] = [];
    const gets: Array<{ token: string | null; status: number }> = [];
    const unexpected: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.routeWebSocket(/.*/, socket => { unexpected.push("websocket"); socket.close(); });
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname === "/" && request.method() === "GET") {
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><div id=root></div>" });
      }
      if (url.origin === origin && url.pathname === sign && request.method() === "POST") {
        posts.push(request.postDataJSON());
        const token = posts.length === 1 ? "a" : "b";
        return route.fulfill({ json: [{ path, error: null, signedURL: `/object/sign/media/${path}?token=${token}` }] });
      }
      if (url.origin === origin && url.pathname === `${sign}/${path}` && request.method() === "GET") {
        const token = url.searchParams.get("token");
        const status = token === "a" ? firstGet : token === "b" ? 200 : 404;
        gets.push({ token, status });
        return route.fulfill({ status, contentType: "text/plain; charset=utf-8", headers: { "Cache-Control": "no-store" },
          body: status !== 200 ? "Synthetic Storage refusal" : token === "a" && late ? staleText : text });
      }
      unexpected.push(url.origin === origin && url.pathname === publicPath ? "public-fallback" : "unexpected-request");
      return route.abort("blockedbyclient");
    });
    await page.goto(origin);
    await page.evaluate(() => {
      const raf = requestAnimationFrame.bind(window);
      (window as any).settleRender = () => new Promise<void>(done => raf(() => raf(() => done())));
    });
    await page.clock.install({ time: epoch - 60_000 });
    await page.clock.pauseAt(epoch);
    // Hold a decoded body, so abort cannot hide a missing post-await state guard.
    await page.evaluate(({ signedPath, expected, stale, late }) => {
      const probe = { decodedB: 0, heldA: false, abortedA: false, releasedA: false, releaseA: () => {} };
      (window as any).readProbe = probe;
      const held = new Promise<void>(release => { probe.releaseA = release; });
      const tokenOf = (value: string) => {
        const url = new URL(value, window.location.href);
        return url.pathname === signedPath ? url.searchParams.get("token") : null;
      };
      if (late) {
        const fetchOriginal = window.fetch.bind(window);
        window.fetch = (input, init) => {
          if (typeof input === "string" && tokenOf(input) === "a") {
            init?.signal?.addEventListener("abort", () => { probe.abortedA = true; }, { once: true });
          }
          return fetchOriginal(input, init);
        };
      }
      const read = Response.prototype.text;
      Response.prototype.text = async function () {
        const value = await read.call(this);
        const token = this.url && tokenOf(this.url);
        if (token === "b" && value === expected) probe.decodedB++;
        if (late && token === "a" && value === stale) {
          probe.heldA = true;
          await held;
          probe.releasedA = true;
          if (late === "late-error") throw new Error("synthetic late TXT read failure");
        }
        return value;
      };
    }, { signedPath: `${sign}/${path}`, expected: text, stale: staleText, late });
    await page.addScriptTag({ content: script });
    assert.deepEqual(await page.evaluate(() => [(window as any).fixtureMode, (window as any).fixturePartition]), ["signed-only", null]);
    const row = page.getByTestId("file-message");
    await expect(row).toBeEnabled();
    await row.click();
    const viewer = page.getByTestId("document-viewer");
    const preview = viewer.getByTestId("document-viewer-text");
    const failure = viewer.getByRole("alert");
    if (late) {
      await expect.poll(() => page.evaluate(() => (window as any).readProbe.heldA)).toBe(true);
      await expect(preview).toHaveCount(0);
      await expect(failure).toHaveCount(0);
    } else if (firstGet === 200) await expect(preview).toHaveText(text);
    else await expect(failure).toContainText("Не удалось открыть файл");
    assert.deepEqual(gets, [{ token: "a", status: firstGet }]);
    assert.deepEqual(posts, [{ expiresIn: 3600, paths: [path] }]);
    await viewer.evaluate(node => { (window as any).openedViewer = node; });

    await page.clock.fastForward(renewalMs - 1);
    assert.equal(posts.length, 1, "no early renewal at 47:59.999");
    // The foreground event asks the real store to evaluate the exact boundary.
    await page.clock.runFor(1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => gets.length).toBe(2);
    await expect.poll(() => page.evaluate(() => (window as any).readProbe.decodedB)).toBe(1);
    assert.deepEqual(posts, [{ expiresIn: 3600, paths: [path] }, { expiresIn: 3600, paths: [path] }]);
    assert.deepEqual(gets, [{ token: "a", status: firstGet }, { token: "b", status: 200 }]);
    assert.equal(await viewer.evaluate(node => node === (window as any).openedViewer), true, "viewer was not reopened");
    await savedFile(page);
    assert.deepEqual(gets, [{ token: "a", status: firstGet }, { token: "b", status: 200 }, { token: "b", status: 200 }]);
    assert.deepEqual(unexpected, [], "no public fallback or network escape");
    assert.deepEqual(errors, [], "no unhandled browser error");
    await expect(preview, "the mounted TXT viewer must recover after decoding the renewed signed response").toHaveText(text);
    await expect(failure).toHaveCount(0);
    if (late) {
      assert.equal(await page.evaluate(() => (window as any).readProbe.abortedA), true, "renewal aborts A");
      await page.evaluate(async () => {
        (window as any).readProbe.releaseA();
        await (window as any).settleRender();
      });
      assert.equal(await page.evaluate(() => (window as any).readProbe.releasedA), true, "A really settled after B");
      assert.equal(await failure.count(), 0, "aborted A must not restore its error");
      assert.equal(await preview.textContent(), text, "aborted A must not replace B's text");
    }
    await page.evaluate(() => (window as any).disposeFixture());
  } finally {
    await context.close();
  }
}

let script: string;
let browser: Browser;
test.before(async () => { script = await bundle(); browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const [name, firstRead] of [
  ["keeps a successful preview and saves exact renewed bytes", 200],
  ["recovers the mounted TXT preview after a GET refusal", 400],
  ["ignores late text from an aborted read", "late-success"],
  ["ignores a late error from an aborted read", "late-error"],
] as const) {
  test(`Task 5/D-208 signed-only FILE: ${name}`, { timeout: 30_000 }, () => exercise(browser, script, firstRead));
}
