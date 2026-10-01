import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium, devices, type Page } from "@playwright/test";
import sharp from "sharp";
import { chat, membership, openFixture, person, requireFixtureServer } from "../e2e/helpers/messageActionsFixture.ts";

// Opt-in: this is an actual mounted-app paint test, never a production session.
const baseURL = process.env.KUB_MENTION_VISUAL_BASE_URL;
const ME = person("76111111-1111-4111-8111-000000000001", "Owner", "owner");
const ANNA = person("76111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const OTHER = person("76111111-1111-4111-8111-000000000003", "Анна Смирнова", "anna_second");
const CHAT = "76222222-2222-4222-8222-000000000001";
const AT = "2026-10-01T12:00:00Z";
const SOLID = "bg-[var(--kub-surface-3)]";
type Surface = "caption" | "menu";

async function paint(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    // Follow real transition completion and ResizeObserver-driven height updates.
    // The paint assertions below also force an overlapping backdrop, so waiting
    // for this geometry cannot hide a translucent surface regression.
    for (let turn = 0; turn < 6; turn += 1) {
      await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {})));
      await new Promise(requestAnimationFrame);
    }
  });
}

async function boot(page: Page, theme: "dark" | "light", mutation?: Surface) {
  const fixture = await openFixture(page, { me: ME, theme, people: [ANNA, OTHER],
    chats: [chat(CHAT, "group", "Упоминания", AT)],
    memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT), membership(CHAT, OTHER, "member", AT)],
    messages: [] });
  if (mutation) {
    const file = mutation === "caption" ? "chat/attach/AttachSendBar.tsx" : "chat/MemberMentionMenu.tsx";
    await page.route(`**/src/components/${file}*`, async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      assert.equal(source.split(SOLID).length - 1, 1, `one served ${mutation} boundary`);
      await route.fulfill({ response, body: source.replace(SOLID, "") });
    });
  }
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-list-item").filter({ hasText: "Упоминания" }).click();
  await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
  const sheet = page.getByTestId("attach-sheet");
  await sheet.getByRole("tab", { name: "Файл", exact: true }).click();
  await sheet.locator('[data-attach-picker="file"]').setInputFiles([
    { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic first file") },
    { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic second file") },
  ]);
  await sheet.getByTestId("attach-caption").fill("@Ан");
  await sheet.getByTestId("member-mention-menu").waitFor();
  await settle(page);
  assert.equal(fixture.restCalls("messages", "POST").length, 0);
  return sheet;
}

async function assertOpaquePaint(page: Page, surface: Surface) {
  const selector = surface === "caption" ? "[data-attach-send-bar]" : "[data-testid=member-mention-menu]";
  const clip = await page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect();
    // Empty interior, away from rounded edges, focus rings, labels and avatars.
    return { x: Math.floor(box.right - (element.matches("[data-attach-send-bar]") ? 85 : 20)),
      y: Math.floor(box.top + box.height / 2), width: 3, height: 3 };
  });
  const frames: Buffer[] = [];
  for (const background of ["rgb(255, 0, 0)", "rgb(0, 255, 0)"]) {
    await page.locator("[data-attach-scroll]").evaluate((element, color) => {
      (element as HTMLElement).style.backgroundColor = color;
      // Keep the actual scroller's layout and padding; change only its paint.
      (element.firstElementChild as HTMLElement).style.visibility = "hidden";
    }, background);
    await paint(page);
    const png = await page.screenshot({ clip, scale: "css", caret: "hide" });
    frames.push(await sharp(png).removeAlpha().raw().toBuffer());
  }
  let delta = 0;
  for (let index = 0; index < frames[0].length; index += 1) {
    delta = Math.max(delta, Math.abs(frames[0][index] - frames[1][index]));
  }
  console.log(`PAINT ${surface}: max backdrop channel delta ${delta}`);
  await page.locator("[data-attach-scroll]").evaluate((element) => {
    (element as HTMLElement).style.backgroundColor = "";
    (element.firstElementChild as HTMLElement).style.visibility = "";
  });
  assert.ok(delta <= 2, `${surface} must not paint underlying file/source content into its readable interior; delta=${delta}`);
}

async function assertEndReserve(page: Page) {
  const sheet = page.getByTestId("attach-sheet");
  await sheet.getByTestId("attach-caption").press("Escape");
  await sheet.locator('[data-attach-picker="file"]').setInputFiles(Array.from({ length: 8 }, (_, index) => ({
    name: `more-${index}.txt`, mimeType: "text/plain", buffer: Buffer.from("synthetic overflow file"),
  })));
  await sheet.getByTestId("attach-caption").fill("line one\nline two\nline three\nline four\nline five");
  await settle(page);
  await sheet.locator("[data-attach-scroll]").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await paint(page);
  const geometry = await sheet.evaluate((element) => {
    const scroller = element.querySelector("[data-attach-scroll]")!;
    const panel = element.querySelector("[data-testid=attach-sheet-panel]")!;
    const files = element.querySelector("[data-attach-file-picks]")!;
    const bar = element.querySelector("[data-attach-send-bar]")!;
    const last = files.lastElementChild!.getBoundingClientRect();
    return { lastBottom: last.bottom, barTop: bar.getBoundingClientRect().top,
      panelBottom: panel.getBoundingClientRect().bottom, scrollBottom: scroller.getBoundingClientRect().bottom,
      overflow: scroller.scrollHeight - scroller.clientHeight,
      reserve: parseFloat(getComputedStyle(files.parentElement!).paddingBottom), barHeight: bar.getBoundingClientRect().height };
  });
  assert.ok(geometry.overflow > 0, "the fixture must force actual scrolling");
  assert.ok(geometry.lastBottom <= geometry.barTop - 8, "the last file must scroll clear of the caption");
  assert.ok(geometry.reserve >= geometry.barHeight + 24, "end padding must follow the grown caption");
  assert.ok(Math.abs(geometry.scrollBottom - geometry.panelBottom) <= 1, "reserve must not shrink the scroller viewport");
}

for (const width of [390, 1440]) for (const theme of ["dark", "light"] as const) {
  test(`mounted surfaces ${width}/${theme}: readable float and full-height end reserve`, { skip: !baseURL }, async (t) => {
    assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
    assert.equal(baseURL, "http://127.0.0.1:5218");
    const browser = await chromium.launch();
    try {
      // The supplied captures use coarse-pointer sheets at both widths.
      const context = await browser.newContext({ ...devices["Pixel 7"], viewport: { width, height: 900 },
        deviceScaleFactor: 1, baseURL, serviceWorkers: "block" });
      await requireFixtureServer(context.request);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await boot(page, theme);
      assert.equal(new URL(page.url()).origin, baseURL);
      assert.equal(await page.locator("vite-error-overlay").count(), 0);
      await page.screenshot({ path: join(tmpdir(), `mentions-surface-${width}-${theme}.png`), scale: "css", caret: "hide" });
      await t.test("caption blocks overlapping file paint", () => assertOpaquePaint(page, "caption"));
      await t.test("menu blocks overlapping source paint", () => assertOpaquePaint(page, "menu"));
      await t.test("the grown caption keeps end padding, not a reduced viewport", () => assertEndReserve(page));
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  });
}

for (const surface of ["caption", "menu"] as const) for (const theme of ["dark", "light"] as const) {
  test(`mutation ${surface}/${theme}: removing the surface boundary exposes backdrop pixels`, { skip: !baseURL }, async () => {
    assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
    assert.equal(baseURL, "http://127.0.0.1:5218");
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 900 },
        deviceScaleFactor: 1, baseURL, serviceWorkers: "block" });
      await requireFixtureServer(context.request);
      const page = await context.newPage();
      await boot(page, theme, surface);
      await assert.rejects(() => assertOpaquePaint(page, surface), { code: "ERR_ASSERTION" });
      await context.close();
    } finally { await browser.close(); }
  });
}
