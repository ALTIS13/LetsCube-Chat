import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium } = kubRequire("@playwright/test");
const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");
const tailwindRequire = createRequire(kubRequire.resolve("@tailwindcss/vite"));
const { compile, optimize } = tailwindRequire("@tailwindcss/node");
const { Scanner } = tailwindRequire("@tailwindcss/oxide");
const sourceRoot = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const bubblePath = join(sourceRoot, "components/chat/MessageBubble.tsx");
const cssPath = join(sourceRoot, "index.css");
const origin = "https://bubble-readability.invalid";
const output = mkdtempSync(join(tmpdir(), "letscube-bubble-readability-"));
const results = [];
let browser;
let bundle;
let css;

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0", "synthetic browser tests require QA0");
  const built = await build({
    write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": sourceRoot },
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env": JSON.stringify({
        VITE_SUPABASE_URL: origin, VITE_SUPABASE_ANON_KEY: "synthetic-anon-fixture",
        VITE_MEDIA_SIGNED_URLS: "signed-only", VITE_ACCESS_SNAPSHOT_RPC_ENABLED: "0",
      }),
    },
    stdin: { resolveDir: sourceRoot, sourcefile: "bubble-readability.tsx", loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {MessageBubble} from './components/chat/MessageBubble';
      import {ChatMediaPlaybackProvider} from './components/chat/ChatMediaPlayback';
      import {getMessageDeliveryState} from './lib/messageDelivery';
      const uid = 'synthetic-owner';
      const states = [
        {name:'failed', label:'Ошибка отправки', failed:true, pending:false},
        {name:'mixed', label:'Ошибка при незавершённой отправке', failed:true, pending:true},
        {name:'pending', label:'Отправляется', failed:false, pending:true},
        {name:'sent', label:'Отправлено — контроль', failed:false, pending:false},
      ];
      window.actionCalls = {retry:0, edit:0, discard:0};
      const root = createRoot(document.getElementById('root'));
      flushSync(() => root.render(<ChatMediaPlaybackProvider items={[]}>
        {states.map(state => {
          const message = {
            id:'tmp:synthetic-'+state.name, client_message_id:'synthetic-'+state.name,
            chat_id:'synthetic-chat', user_id:uid, type:'text',
            content:'Синтетическое сообщение. Проверяем читаемость текста и действий после ошибки отправки.',
            created_at:'2026-10-18T12:00:00.000Z', edited_at:null, deleted_at:null,
            reply_to_id:null, forwarded_from_id:null, pinned:false,
            sender:{id:uid,full_name:'Synthetic author',username:'fixture',avatar_url:null},
            reactions:[],media_bucket:null,media_path:null,media_url:null,media_metadata:null,
            failed:state.failed,pending:state.pending,checking:false,
            send_error:state.failed ? 'Не удалось сохранить сообщение на устройстве. Повторите отправку.' : null,
          };
          return <section key={state.name} data-fixture={state.name}>
            <h2>{state.label}</h2>
            <MessageBubble message={message} isMe isFirstInGroup={false} isLastInGroup
              onReaction={() => {}}
              onRetrySend={() => window.actionCalls.retry++}
              onEditFailedSend={() => window.actionCalls.edit++}
              onDiscardLocalMessage={() => window.actionCalls.discard++}
              deliveryState={getMessageDeliveryState(message,{currentUserId:uid,chatType:'private',members:[]})} />
          </section>;
        })}
      </ChatMediaPlaybackProvider>));
    ` },
  });
  bundle = built.outputFiles[0].text;
  // Compile the real stylesheet for the mounted component, without an app build or dist dependency.
  const compiler = await compile(readFileSync(cssPath, "utf8"), { base: sourceRoot, onDependency() {} });
  const candidates = new Scanner({}).scanFiles([{ content: bundle, extension: "js" }]);
  css = optimize(compiler.build(candidates)).code;
  browser = await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
});

test.after(async () => {
  await browser?.close();
  writeFileSync(join(output, "metadata.json"), JSON.stringify({
    syntheticOnly: true, auth: false, serviceWorkers: false,
    sourceSha256: createHash("sha256").update(readFileSync(bubblePath)).digest("hex"),
    cssSourceSha256: createHash("sha256").update(readFileSync(cssPath)).digest("hex"),
    results,
  }, null, 2));
  console.log(`Synthetic bubble renders and metadata: ${output}`);
});

function measureReadability() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const paint = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (color) => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = color;
    paint.fillRect(0, 0, 1, 1);
    const pixel = paint.getImageData(0, 0, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
  };
  const over = (front, back, alpha = front[3]) => front.slice(0, 3).map((value, i) => value * alpha + back[i] * (1 - alpha));
  const luminance = (rgb) => rgb.map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const rect = node => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  };
  const ground = rgba(getComputedStyle(document.getElementById("root")).backgroundColor);
  return Object.fromEntries([...document.querySelectorAll("[data-fixture]")].map(section => {
    const bubble = section.querySelector('[data-message-bubble="true"]');
    const background = rgba(getComputedStyle(bubble).backgroundColor);
    const targets = [
      ["message", section.querySelector('[data-message-text-flow="true"]')],
      ...[...section.querySelectorAll('[data-message-send-error="true"] > *')].map((node, i) => [`error-${i}`, node]),
    ];
    const samples = targets.map(([name, node]) => {
      let opacity = 1;
      for (let parent = node; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
      const foreground = over(rgba(getComputedStyle(node).color), background);
      return { name, opacity, contrast: contrast(over(foreground, ground, opacity), over(background, ground, opacity)), rect: rect(node) };
    });
    return [section.dataset.fixture, { bubble: rect(bubble), background, samples }];
  }));
}

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
  test(`${width}px ${theme}: failed actions readable; pending clock retained`, { timeout: 30_000 }, async () => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    const unexpectedRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || route.request().method() !== "GET") {
        unexpectedRequests.push("external-or-non-GET");
        return route.abort();
      }
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html>
        <html class="${theme}" lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css">
        <style>#root{min-height:100vh;padding:24px 16px;background:var(--kub-chat-ground)}
        section{max-width:760px;margin:0 auto 24px}h2{font-size:12px;font-weight:500;margin:0 0 8px;color:var(--kub-muted)}
        </style></head><body><main id="root" class="kub-chat-screen"></main><script src="/fixture.js"></script></body></html>` });
      if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
      if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
      if (/^\/fonts\/inter\/inter-(cyrillic|cyrillic-ext|latin|latin-ext)\.woff2$/.test(url.pathname)) {
        return route.fulfill({ contentType: "font/woff2", body: readFileSync(new URL(`../../artifacts/kub/public${url.pathname}`, import.meta.url)) });
      }
      unexpectedRequests.push("unlisted-path");
      return route.abort();
    });
    try {
      await page.goto(origin);
      await page.locator('[data-fixture="sent"] [data-message-bubble="true"]').waitFor();
      await page.evaluate(async () => { await document.fonts.ready; });
      const readings = await page.evaluate(measureReadability);
      const fit = await page.evaluate(() => ({
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
        interLoaded: document.fonts.check('14px Inter'),
      }));
      await page.screenshot({ path: join(output, `${width}-${theme}.png`), fullPage: true });
      results.push({ width, theme, readings, fit, errors, unexpectedRequests });

      assert.deepEqual(errors, [], "actual component must render without errors");
      assert.deepEqual(unexpectedRequests, [], "only local synthetic assets may be requested");
      assert.equal(fit.interLoaded, true, "real bundled Inter must be loaded");
      assert.equal(fit.noHorizontalOverflow, true, "bubbles must fit the viewport");
      for (const [state, reading] of Object.entries(readings)) {
        assert.equal(reading.background[3], 1, "calibration requires the actual opaque own-bubble color");
        for (const sample of reading.samples) {
          assert.equal(sample.opacity, 1, `${state}/${sample.name}: whole-bubble fade must not dim text or actions`);
          assert.ok(sample.contrast >= 4.5, `${state}/${sample.name}: effective contrast ${sample.contrast.toFixed(2)} must reach literal 4.5:1`);
          assert.ok(sample.rect.x >= reading.bubble.x - 1 && sample.rect.x + sample.rect.width <= reading.bubble.x + reading.bubble.width + 1,
            `${state}/${sample.name}: text and actions must remain inside the bubble`);
        }
      }
      await page.locator('[data-fixture="pending"] [role="img"][aria-label="Отправляется"]').waitFor();
      await page.locator('[data-fixture="mixed"] [role="img"][aria-label="Не удалось отправить"]').waitFor();
      for (const label of ["Повторить", "Изменить", "Удалить"]) {
        await page.locator('[data-fixture="failed"]').getByRole("button", { name: label, exact: true }).click();
      }
      assert.deepEqual(await page.evaluate(() => window.actionCalls), { retry: 1, edit: 1, discard: 1 });

      // Calibrate the same rendered oracle against the removed failure mode, not a source-text assertion.
      await page.locator('[data-fixture="failed"] [data-message-bubble="true"]').evaluate(node => {
        node.style.transition = "none";
        node.style.opacity = "0.6";
      });
      const faded = (await page.evaluate(measureReadability)).failed.samples;
      assert.ok(faded.every(sample => sample.opacity === 0.6));
      assert.ok(faded.some(sample => sample.contrast < 4.5), "the contrast oracle must reject the original blanket opacity");
    } finally {
      await context.close();
    }
  });
}
