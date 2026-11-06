import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium, expect } = kubRequire("@playwright/test");
const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");
const origin = "https://variant-owner.invalid";
const oldPoster = "fixture/old.webp";
const currentPoster = "fixture/current.webp";
const chatA = "11111111-1111-4111-8111-0000000000a1";
const chatB = "11111111-1111-4111-8111-0000000000b1";
const oldId = "22222222-2222-4222-8222-0000000000a1";
const newId = "22222222-2222-4222-8222-0000000000b1";
const keepId = "22222222-2222-4222-8222-0000000000c1";
const keptPoster = "fixture/kept.webp";

async function bundle(): Promise<string> {
  let receipts = 0;
  const result = await build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    alias: { "@": fileURLToPath(new URL("../../artifacts/kub/src", import.meta.url)) },
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": JSON.stringify({
        VITE_SUPABASE_URL: origin,
        VITE_SUPABASE_ANON_KEY: "fixture-anon",
        VITE_MEDIA_SIGNED_URLS: "signed-only",
      }),
    },
    plugins: [{
      name: "observe-real-variant-get-settlement",
      setup(plugin: any) {
        plugin.onLoad({ filter: /[\\/]useMediaVariants\.ts$/ }, ({ path }: { path: string }) => {
          let source = readFileSync(path, "utf8");
          const mutant = process.env.KUB_TASK3_VARIANT_OWNER_MUTANT;
          if (mutant) {
            const changes: Record<string, [string, string]> = {
              entry: ["entry.disposed || entry.listeners.size === 0", "false"],
              batch: ["entry.refreshState.messageIds !== messageIds", "false"],
              generation: ["signedMediaUrls().getGeneration() !== signingGeneration", "false"],
              "settled-generation": ["entry.signingGeneration !== generation", "false"],
              "settled-rows": ["entry.lastRows = entry.lastRows.filter((row) => row.message_id && expectedKinds.has(row.message_id));", ""],
              "neutral-generation": ["entry.variants = {};", ""],
              "neutral-batch": ["() => selectVisibleMessageVariantUrls(variantsByMessageId, expectedKinds)", "() => variantsByMessageId"],
            };
            const change = changes[mutant];
            assert.ok(change, "known variant owner mutation");
            assert.equal(source.split(change[0]).length, 2, "mutate exactly one ownership condition");
            source = source.replace(...change);
          }
          const anchor = "if (transition.startNow) scheduleMessageVariantLoad(entry, MESSAGE_VARIANT_REFRESH_DEBOUNCE_MS);";
          assert.equal(source.split(anchor).length, 2, "exactly one completion path must be observed");
          receipts++;
          return {
            contents: source.replace(anchor, `${anchor}\n    window.variantSettlements.push(messageIds.join("|"));`),
            loader: "ts",
          };
        });
      },
    }],
    stdin: {
      loader: "jsx",
      resolveDir: fileURLToPath(new URL("../../artifacts/kub", import.meta.url)),
      contents: `
        import React from "react";
        import { flushSync } from "react-dom";
        import { createRoot } from "react-dom/client";
        import { useMessageMediaVariantUrls } from "@/hooks/useMediaVariants";
        import { signedMediaUrls } from "@/lib/media/mediaUrl";
        const root = createRoot(document.getElementById("root"));
        function Fixture({ rows }) {
          const urls = useMessageMediaVariantUrls(rows);
          const [first] = rows;
          window.variantRenderKeys.push(Object.keys(urls));
          return <output data-chat={first.chat_id} data-message={first.id} data-variants={JSON.stringify(urls)}>{urls[first.id]?.videoPosterUrl}</output>;
        }
        window.variantSettlements = [];
        window.variantRenderKeys = [];
        window.mountVariantBatch = (chat, ids, legacy) => flushSync(() => root.render(<Fixture rows={ids.map(id => ({
          id, chat_id: chat, type: "video", media_bucket: "album-media", media_path: "fixture/clip.mp4",
          media_url: legacy ? "${origin}/storage/v1/object/public/album-media/fixture/clip.mp4" : null,
          deleted_at: null,
        }))} />));
        window.mountVariant = (chat, id, legacy) => window.mountVariantBatch(chat, [id], legacy);
        window.advanceVariantAccount = () => {
          const store = signedMediaUrls();
          const before = store.getGeneration();
          store.setAccount("fixture-owner-b");
          return store.getGeneration() - before;
        };
        const realNow = Date.now;
        let timeOffset = 0;
        Date.now = () => realNow() + timeOffset;
        window.renewVariantUrls = () => {
          timeOffset += 48 * 60_000 + 1000;
          window.dispatchEvent(new Event("online"));
        };
        signedMediaUrls().setAccount("fixture-owner-a");
      `,
    },
  });
  assert.equal(receipts, 1, "the compiled fixture must load the real hook once");
  return result.outputFiles[0].text;
}

for (const boundary of ["settled generation", "settled batch"] as const) {
  test(`settled variant projection stays owned across a ${boundary} change`, { timeout: 20_000 }, async () => {
    const rotates = boundary === "settled generation";
    const initialIds = rotates ? [oldId] : [oldId, keepId];
    const currentIds = rotates ? [oldId] : [newId, keepId];
    const initialPaths = rotates ? [oldPoster] : [oldPoster, keptPoster];
    const nextPaths = rotates ? [currentPoster] : [currentPoster, keptPoster];
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const releaseCurrent = Promise.withResolvers<void>();
    const queries: string[] = [];
    const signedPaths: string[] = [];
    const unexpected: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await context.route("**/*", async (route: any) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname === "/") {
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      }
      if (url.origin === origin && url.pathname === "/rest/v1/media_variants" && request.method() === "GET") {
        const initial = queries.length === 0;
        queries.push(url.searchParams.get("message_id") ?? "");
        if (!initial) await releaseCurrent.promise;
        const ids = initial ? initialIds : currentIds;
        const paths = initial ? initialPaths : nextPaths;
        return route.fulfill({ json: ids.flatMap((id, index) => {
          const row = { id, message_id: id, variant_bucket: "album-media", updated_at: "2026-09-13T09:00:00Z" };
          return [
            { ...row, variant_kind: "video_poster", variant_path: paths[index], status: "ready" },
            { ...row, variant_kind: "video_720p", status: "failed", error_code: "source_missing" },
          ];
        }) });
      }
      if (url.origin === origin && url.pathname === "/storage/v1/object/sign/album-media" && request.method() === "POST") {
        const { paths } = request.postDataJSON() as { paths: string[] };
        return route.fulfill({ json: paths.map((path) => {
          signedPaths.push(path);
          return { path, signedURL: `/object/sign/album-media/${path}?token=fixture-${signedPaths.length}`, error: null };
        }) });
      }
      unexpected.push(url.pathname);
      return route.abort();
    });
    try {
      await page.goto(origin);
      await page.addScriptTag({ content: compiled });
      const output = page.locator("output");
      const mount = (ids: string[]) => page.evaluate(([chat, ids]: [string, string[]]) => {
        (window as any).mountVariantBatch(chat, ids, false);
      }, [chatA, ids]);
      const projected = async () =>
        JSON.parse((await output.getAttribute("data-variants"))!) as Record<string, { videoPosterUrl: string }>;
      const renew = () => page.evaluate(() => (window as any).renewVariantUrls());
      const renderedRetired = () => page.evaluate((id: string) =>
        (window as any).variantRenderKeys.some((keys: string[]) => keys.includes(id)), oldId);
      const renewed = async (id: string, previous: string) => {
        const next = (await projected())[id]?.videoPosterUrl;
        return Boolean(next && next !== previous);
      };
      await mount(initialIds);
      await expect.poll(async () => Object.keys(await projected()).sort()).toEqual([...initialIds].sort());
      const before = await projected();
      assert.equal(new URL(before[oldId].videoPosterUrl).pathname, `/storage/v1/object/sign/album-media/${oldPoster}`);
      assert.deepEqual([...signedPaths].sort(), [...initialPaths].sort());
      const signedBefore = signedPaths.length;
      await page.evaluate(() => { (window as any).variantRenderKeys.length = 0; });

      if (rotates) {
        assert.equal(await page.evaluate(() => (window as any).advanceVariantAccount()), 1);
        await expect.poll(() => queries.length > 1 || signedPaths.length > signedBefore).toBe(true);
        assert.deepEqual(signedPaths.slice(signedBefore), [], "settled retired generation must not sign during rotation");
        assert.deepEqual(await projected(), {}, "old URL must be neutral before fresh metadata resolves");
        assert.equal(await renderedRetired(), false, "no retired URL render while the new generation waits");
      } else {
        await mount(currentIds);
        await expect.poll(() => queries.length).toBe(2);
        const pending = await projected();
        assert.equal(pending[keepId].videoPosterUrl, before[keepId].videoPosterUrl, "visible intersection must keep its URL");
        await renew();
        await expect.poll(() => signedPaths.slice(signedBefore)).toContain(keptPoster);
        await expect.poll(() => renewed(keepId, before[keepId].videoPosterUrl)).toBe(true);
        assert.deepEqual({
          requested: signedPaths.slice(signedBefore),
          removedProjected: Object.hasOwn(await projected(), oldId),
          renderedRemoved: await renderedRetired(),
        }, { requested: [keptPoster], removedProjected: false, renderedRemoved: false },
        "only still-visible rows may renew or project before the next batch completes");
      }

      assert.deepEqual(queries, [initialIds, currentIds].map((ids) => `in.(${[...ids].sort().join(",")})`));
      releaseCurrent.resolve();
      await expect.poll(async () => Object.keys(await projected()).sort()).toEqual([...currentIds].sort());
      const latest = await projected();
      const posterId = currentIds[0];
      assert.equal(new URL(latest[posterId].videoPosterUrl).pathname, `/storage/v1/object/sign/album-media/${currentPoster}`);
      if (rotates) {
        assert.deepEqual(signedPaths.slice(signedBefore), [currentPoster]);
        await renew();
        await expect.poll(() => renewed(posterId, latest[posterId].videoPosterUrl)).toBe(true);
        assert.deepEqual(signedPaths.slice(signedBefore), [currentPoster, currentPoster]);
        assert.equal(queries.length, 2, "signature renewal must not reload settled metadata");
      }
      assert.deepEqual(unexpected, []);
      assert.deepEqual(errors, []);
    } finally {
      releaseCurrent.resolve();
      await context.close();
    }
  });
}

let browser: any;
let compiled: string;
test.before(async () => {
  compiled = await bundle();
  browser = await chromium.launch({ env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
});
test.after(async () => { await browser?.close(); });

for (const scope of ["different chat", "same-chat batch", "signing generation"] as const) {
  test(`a completed obsolete variant GET does not sign after ${scope} changes`, { timeout: 20_000 }, async () => {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const releaseOld = Promise.withResolvers<void>();
    const queries: string[] = [];
    const signedPaths: string[] = [];
    const unexpected: string[] = [];
    const errors: string[] = [];
    const nextChat = scope === "different chat" ? chatB : chatA;
    const nextId = scope === "signing generation" ? oldId : newId;
    const legacy = scope === "different chat";
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await context.route("**/*", async (route: any) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname === "/") {
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      }
      if (url.origin === origin && url.pathname === "/rest/v1/media_variants" && request.method() === "GET") {
        const old = queries.length === 0;
        queries.push(url.searchParams.get("message_id") ?? "");
        if (old) await releaseOld.promise;
        const id = old ? oldId : nextId;
        const row = { id, message_id: id, variant_bucket: "album-media", updated_at: "2026-09-13T09:00:00Z" };
        return route.fulfill({ json: [
          { ...row, variant_kind: "video_poster", variant_path: old ? oldPoster : currentPoster, status: "ready" },
          ...(old ? [] : [{ ...row, variant_kind: "video_720p", status: "failed", error_code: "source_missing" }]),
        ] });
      }
      if (url.origin === origin && url.pathname === "/storage/v1/object/sign/album-media" && request.method() === "POST") {
        const { paths } = request.postDataJSON() as { paths: string[] };
        signedPaths.push(...paths);
        return route.fulfill({ json: paths.map((path) => path === currentPoster
          ? { path, signedURL: `/object/sign/album-media/${path}?token=fictional`, error: null }
          : { path, signedURL: null, error: "Fixture refusal" }) });
      }
      unexpected.push(url.pathname);
      return route.abort();
    });

    try {
      await page.goto(origin);
      await page.addScriptTag({ content: compiled });
      const mount = (chat: string, id: string) =>
        page.evaluate(([chat, id, legacy]: [string, string, boolean]) => {
          (window as any).mountVariant(chat, id, legacy);
        }, [chat, id, legacy]);
      const settlements = () => page.evaluate(() => (window as any).variantSettlements as string[]);
      await mount(chatA, oldId);
      await expect.poll(() => queries.slice()).toEqual([`in.(${oldId})`]);
      if (scope === "signing generation") {
        assert.equal(await page.evaluate(() => (window as any).advanceVariantAccount()), 1);
      } else {
        await mount(nextChat, nextId);
        await expect(page.locator("output")).toHaveAttribute("data-message", nextId);
        if (scope === "different chat") {
          await expect(page.locator("output")).toHaveAttribute("data-chat", chatB);
        } else {
          assert.equal(queries.length, 1, "same-chat reload must stay queued while old GET is in flight");
        }
      }
      assert.deepEqual(signedPaths.filter((path) => path === oldPoster), []);
      assert.equal((await settlements()).includes(oldId), false, "old request is still held");
      const oldResponse = page.waitForResponse((response: { url(): string }) => {
        const url = new URL(response.url());
        return url.pathname === "/rest/v1/media_variants" && url.searchParams.get("message_id") === `in.(${oldId})`;
      });
      releaseOld.resolve();
      const response = await oldResponse;
      assert.equal(response.status(), 200);
      assert.equal(await response.finished(), null, "the late GET must reach the browser, not be aborted");
      assert.equal((await response.json())[0].variant_path, oldPoster);
      await expect.poll(settlements).toContain(oldId);
      if (scope === "signing generation") {
        // Exercise the existing mounted focus retry after the old request drains.
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      }
      await expect(page.locator("output")).toContainText("/object/sign/album-media/fixture/current.webp");
      await expect.poll(settlements).toHaveLength(2);
      assert.deepEqual(queries, [`in.(${oldId})`, `in.(${nextId})`]);
      assert.deepEqual(signedPaths, [currentPoster], "only current metadata may request signing after the old GET completed");
      assert.deepEqual(unexpected, []);
      assert.deepEqual(errors, []);
    } finally {
      releaseOld.resolve();
      await context.close();
    }
  });
}
