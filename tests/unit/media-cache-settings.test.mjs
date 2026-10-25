import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { startMediaCacheFixture } from "../e2e/media-cache-settings-fixture.mjs";

const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium, expect } = kubRequire("@playwright/test");
let fixture, browser;
const mutant = process.env.MEDIA_CACHE_UI_MUTANT;

test.before(async () => {
  fixture = await startMediaCacheFixture(mutant);
  browser = await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
  console.log(`Synthetic media-cache fixture: ${fixture.url}`);
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

async function withPage(run, { width = 390, theme = "dark", largeText = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const errors = [], external = [];
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === fixture.origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.goto(fixture.url);
    await page.evaluate(({theme, largeText}) => {
      document.documentElement.className = theme;
      if (largeText) document.documentElement.style.fontSize = "200%";
    }, {theme, largeText});
    await expect(page.getByRole("heading", {name: "Медиакэш", exact: true})).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await run(page);
    assert.deepEqual(errors, [], "no runtime or console errors");
    assert.deepEqual(external, [], "synthetic section must not contact external services");
  } finally { await context.close(); }
}

const update = (page, next) => page.evaluate(next => window.mediaCacheFixture.update(next), next);
const reset = (page, next) => page.evaluate(next => window.mediaCacheFixture.reset(next), next);
const calls = page => page.evaluate(() => window.mediaCacheFixture.calls);
const clear = page => page.getByRole("button", {name: "Очистить медиакэш", exact: true});

test("reports actual bytes/count and a bounded semantic meter, including over-limit usage", () => withPage(async page => {
  const meter = page.getByRole("progressbar", {name: "Занято медиакэшем"});
  await expect(meter).toHaveAttribute("aria-valuenow", "25165824");
  await expect(meter).toHaveAttribute("aria-valuemax", "134217728");
  await expect(meter).toHaveAttribute("aria-valuetext", "24 МБ из 128 МБ");
  await expect(page.getByTestId("media-cache-count")).toHaveText("Файлов: 12");
  await update(page, {stats: {bytes: 900, count: 2, limitBytes: 67108864}});
  await expect(page.getByTestId("media-cache-usage")).toHaveText("900 Б из 64 МБ");
  await update(page, {stats: {bytes: 268435456, count: 81, limitBytes: 67108864}});
  await expect(meter).toHaveAttribute("aria-valuenow", "67108864");
  await expect(meter).toHaveAttribute("aria-valuetext", "256 МБ из 64 МБ");
  assert.ok((await meter.evaluate(node => node.firstElementChild.getBoundingClientRect().width / node.getBoundingClientRect().width)) <= 1.01);
}));

test("64/128/256 MB controls emit exact binary byte literals, not optimistic selection", () => withPage(async page => {
  await expect(page.getByRole("radio")).toHaveCount(3);
  await expect(page.getByRole("radio")).toHaveText(["64 МБ", "128 МБ", "256 МБ"]);
  await expect(page.getByRole("radio", {name: "128 МБ", exact: true})).toHaveAttribute("aria-checked", "true");
  for (const [label, bytes] of [["64 МБ", 67108864], ["256 МБ", 268435456], ["128 МБ", 134217728]]) {
    await page.getByRole("radio", {name: label, exact: true}).click();
    assert.equal((await calls(page)).limits.at(-1), bytes);
    await expect(clear(page)).toBeDisabled();
    await update(page, {pending: false, stats: {bytes: 25165824, count: 12, limitBytes: bytes}});
    await expect(page.getByRole("radio", {name: label, exact: true})).toHaveAttribute("aria-checked", "true");
  }
  await page.getByRole("radio", {name: "128 МБ", exact: true}).click();
  assert.deepEqual((await calls(page)).limits, [67108864, 268435456, 134217728]);
}));

test("segmented limits support arrow/Home/End keys with roving focus, even for an unknown limit", () => withPage(async page => {
  const middle = page.getByRole("radio", {name: "128 МБ", exact: true});
  await middle.focus(); await middle.press("ArrowRight");
  await expect(page.getByRole("radio", {name: "256 МБ", exact: true})).toBeFocused();
  assert.deepEqual((await calls(page)).limits, [268435456]);
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("radio", {name: "64 МБ", exact: true}).dispatchEvent("click");
  assert.deepEqual((await calls(page)).limits, [268435456], "pending radio ignores keyboard and pointer commands");
  await reset(page, {stats: {bytes: 0, count: 0, limitBytes: 1000}});
  await expect(page.getByRole("radio").first()).toHaveAttribute("tabindex", "0");
  await page.getByRole("radio").first().focus(); await page.keyboard.press("End");
  assert.deepEqual((await calls(page)).limits, [268435456]);
  await update(page, {pending: false}); await page.keyboard.press("Home");
  assert.deepEqual((await calls(page)).limits, [268435456, 67108864]);
}));

test("clear locks all commands pending, reports verified success, and never claims messages/account removal", () => withPage(async page => {
  await clear(page).click();
  assert.equal((await calls(page)).clear, 1);
  await expect(clear(page)).toBeDisabled();
  for (const radio of await page.getByRole("radio").all()) await expect(radio).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Очищаем медиакэш");
  await update(page, {pending: false});
  await expect(page.getByRole("status")).not.toContainText("Медиакэш очищен");
  await clear(page).click();
  await update(page, {pending: false, stats: {bytes: 0, count: 0, limitBytes: 134217728}});
  await expect(page.getByRole("status")).toContainText("Медиакэш очищен");
  await expect(clear(page)).toBeDisabled();
  await expect(page.getByText("Переписка и вход в аккаунт сохранятся.", {exact: false})).toBeVisible();
}));

test("empty, loading and unavailable states cannot clear; zero-byte cached files still can", () => withPage(async page => {
  await reset(page, {stats: null});
  await expect(page.getByRole("status")).toContainText("Считаем медиакэш");
  await expect(page.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow", /./);
  await expect(clear(page)).toBeDisabled();
  for (const radio of await page.getByRole("radio").all()) await expect(radio).toBeDisabled();
  await update(page, {error: "private diagnostic must never render"});
  await expect(page.getByRole("alert")).toContainText("Не удалось");
  await expect(page.locator("body")).not.toContainText("private diagnostic");
  await reset(page, {stats: {bytes: 0, count: 0, limitBytes: 134217728}});
  await expect(page.getByRole("status")).toContainText("Медиакэш пуст");
  await expect(page.getByRole("status")).not.toContainText("Медиакэш очищен");
  await expect(clear(page)).toBeDisabled();
  await update(page, {stats: {bytes: 0, count: 3, limitBytes: 134217728}});
  await expect(clear(page)).toBeEnabled();
  await update(page, {stats: {bytes: 4, count: 0, limitBytes: 134217728}});
  await expect(clear(page)).toBeEnabled();
}));

test("unknown statistics pending a read are loading, not a claimed limit save", () => withPage(async page => {
  await reset(page, {stats: null, pending: true});
  await expect(page.getByRole("status")).toContainText("Считаем медиакэш");
  await expect(page.getByRole("status")).not.toContainText("Сохраняем лимит");
}));

test("failed clear keeps real usage, offers retry, and cannot become a success from pending alone", () => withPage(async page => {
  await clear(page).click();
  await update(page, {pending: false, error: "storage write failure"});
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("status")).not.toContainText("Медиакэш очищен");
  await expect(page.getByTestId("media-cache-usage")).toHaveText("24 МБ из 128 МБ");
  await clear(page).click();
  assert.equal((await calls(page)).clear, 2);
  await update(page, {pending: false, error: null, stats: {bytes: 0, count: 0, limitBytes: 134217728}});
  await expect(page.getByRole("status")).toContainText("Медиакэш очищен");
}));

test("limit changes never announce cache clearing; restored usage retires prior success", () => withPage(async page => {
  await clear(page).click();
  await update(page, {pending: false, stats: {bytes: 0, count: 0, limitBytes: 134217728}});
  await expect(page.getByRole("status")).toContainText("Медиакэш очищен");
  await page.getByRole("radio", {name: "64 МБ", exact: true}).click();
  await update(page, {pending: false, stats: {bytes: 0, count: 0, limitBytes: 67108864}});
  await expect(page.getByRole("status")).toContainText("Медиакэш пуст");
  await update(page, {stats: {bytes: 800, count: 1, limitBytes: 67108864}});
  await expect(page.getByRole("status")).not.toContainText("Медиакэш очищен");
}));

if (!mutant) for (const width of [360, 390, 1440]) for (const theme of ["dark", "light"]) for (const largeText of [false, true]) {
  test(`synthetic layout ${width}/${theme}/${largeText ? "200%" : "100%"}: reachable and unclipped in all states`, () => withPage(async page => {
    assert.equal(await page.title(), "LETSCUBE synthetic media cache settings");
    assert.ok((await page.locator("main").boundingBox()).width <= 476, "fixture reproduces the bounded settings column at desktop widths");
    for (const [state, next] of [
      ["usage", {}], ["loading", {stats: null}],
      ["empty", {stats: {bytes: 0, count: 0, limitBytes: 134217728}}],
      ["pending", null], ["error", {error: "synthetic failure"}],
    ]) {
      await reset(page, next ?? {});
      if (next === null) await clear(page).click();
      const overflow = await page.evaluate(() => [...document.querySelectorAll("section, section *")].filter(node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect();
        return box.width > 0 && (box.left < -0.5 || box.right > innerWidth + 0.5 || node.scrollWidth > node.clientWidth + 1 && style.display !== "inline" && !(node instanceof SVGElement));
      }).map(node => `${node.tagName}:${node.getAttribute("data-testid") ?? node.getAttribute("role") ?? ""}`));
      assert.deepEqual(overflow, [], `no clipped content: ${state}`);
      for (const button of await page.getByRole("button").or(page.getByRole("radio")).all()) {
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport({ratio: 1});
        const box = await button.boundingBox();
        assert.ok(box.height >= 44, "44px minimum target");
      }
      if (await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1)) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.mouse.wheel(0, 10000);
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
      }
      if (process.env.MEDIA_CACHE_UI_CAPTURE_DIR) {
        await mkdir(process.env.MEDIA_CACHE_UI_CAPTURE_DIR, {recursive: true});
        await page.screenshot({path: join(process.env.MEDIA_CACHE_UI_CAPTURE_DIR, `${width}-${theme}-${largeText ? "large" : "normal"}-${state}.png`), fullPage: true});
      }
    }
    await reset(page);
    await clear(page).click();
    await update(page, {pending: false, stats: {bytes: 0, count: 0, limitBytes: 134217728}});
    if (process.env.MEDIA_CACHE_UI_CAPTURE_DIR) await page.screenshot({path: join(process.env.MEDIA_CACHE_UI_CAPTURE_DIR, `${width}-${theme}-${largeText ? "large" : "normal"}-success.png`), fullPage: true});
  }, {width, theme, largeText}));
}
