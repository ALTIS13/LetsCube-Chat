import { expect, test, type Locator } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chat, membership, message, openChat, openDesktopMenu, openFixture, openPhoneMenu, person, requireFixtureServer } from "./helpers/messageActionsFixture";

test.use({ screenshot: "off", trace: "off", video: "off" });

const CHAT_ID = "34343434-3434-4434-8434-343434343434";
const ME = person("12121212-1212-4212-8212-121212121212", "Fixture Reader");
const PEER = person("23232323-2323-4232-8232-232323232323", "Fixture Peer");
const AT = "2026-09-01T09:10:00.000Z";
const CASES = [
  { id: "plain", content: "Reference", own: false },
  { id: "single", content: "\u{1F600}", own: true },
  { id: "multiple", content: "\u{1F600}\u{1F642}\u{1F643}", own: false },
  { id: "family", content: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}", own: true },
  { id: "skin-tone", content: "\u{1F44D}\u{1F3FD}", own: false },
  { id: "keycap-reply", content: "1\uFE0F\u20E3", own: true },
  { id: "mixed", content: "Looks good \u{1F600}", own: false },
] as const;

async function measure(bubble: Locator) {
  return bubble.evaluate((node) => {
    const flow = node.querySelector<HTMLElement>("[data-message-text-flow]");
    const content = flow?.querySelector("[data-message-text-content]") ?? flow?.firstElementChild;
    const footer = node.querySelector<HTMLElement>("[data-message-footer]");
    if (!flow || !content || !footer) throw new Error("A required text/footer measurement target is absent");
    const box = node.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(content);
    const lines = Array.from(range.getClientRects());
    const lastLine = lines.at(-1);
    if (!lastLine) throw new Error("The message has no rendered glyph rectangle");
    const time = footer.getBoundingClientRect();
    const style = getComputedStyle(flow);
    const overlap = Math.min(lastLine.right, time.right) - Math.max(lastLine.left, time.left) > 1
      && Math.min(lastLine.bottom, time.bottom) - Math.max(lastLine.top, time.top) > 1;
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
      bubbleHeight: box.height,
      glyphHeight: lastLine.height,
      footerInside: time.left >= box.left - 1 && time.right <= box.right + 1
        && time.top >= box.top - 1 && time.bottom <= box.bottom + 1,
      overlap,
      glyphsInside: lines.every((line) => line.left >= box.left - 1 && line.right <= box.right + 1
        && line.top >= box.top - 1 && line.bottom <= box.bottom + 1),
    };
  });
}

async function measureReply(bubble: Locator) {
  return bubble.evaluate((node) => {
    const previews = node.querySelectorAll<HTMLElement>('[data-message-reply-preview="true"]');
    const preview = previews[0];
    const flow = node.querySelector<HTMLElement>("[data-message-text-flow]");
    const footer = node.querySelector<HTMLElement>("[data-message-footer]");
    if (!preview || !flow || !footer) throw new Error("A required reply measurement target is absent");
    const box = node.getBoundingClientRect();
    const quote = preview.getBoundingClientRect();
    const text = flow.getBoundingClientRect();
    const time = footer.getBoundingClientRect();
    const style = getComputedStyle(preview);
    return {
      count: previews.length,
      visible: quote.width > 0 && quote.height > 0 && style.display !== "none"
        && style.visibility === "visible" && Number(style.opacity) > 0,
      referencedText: preview.querySelector("span > span:last-child")?.textContent,
      inside: quote.left >= box.left - 1 && quote.right <= box.right + 1
        && quote.top >= box.top - 1 && quote.bottom <= box.bottom + 1,
      separated: quote.bottom <= text.top + 1 && quote.bottom <= time.top + 1,
    };
  });
}

function assertReply(metrics: Awaited<ReturnType<typeof measureReply>>) {
  expect(metrics.count).toBe(1);
  expect(metrics.visible).toBe(true);
  expect(metrics.referencedText).toBe("Reference");
  expect(metrics.inside).toBe(true);
  expect(metrics.separated).toBe(true);
}

for (const theme of ["dark", "light"] as const) {
  for (const size of [16, 13, 22]) {
    test(`emoji keep ordinary text sizing and readable metadata (${theme}, ${size}px)`, async ({ page, request }, info) => {
      await requireFixtureServer(request);
      await page.addInitScript((value) => {
        if (value === 16) localStorage.removeItem("letscube:message-text-size");
        else localStorage.setItem("letscube:message-text-size", String(value));
      }, size);
      const fixture = await openFixture(page, {
        me: ME,
        theme,
        chats: [chat(CHAT_ID, "private", null, AT)],
        memberships: [membership(CHAT_ID, ME, "member", AT), membership(CHAT_ID, PEER, "member", AT)],
        messages: CASES.map(({ id, content, own }) => message(id, CHAT_ID, own ? ME : PEER, content, AT,
          id === "keycap-reply" ? { reply_to_id: "plain" } : {})),
      });
      await openChat(page, PEER.full_name, "Looks good \u{1F600}");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const measurements: Record<string, Awaited<ReturnType<typeof measure>>> = {};
      for (const entry of CASES) {
        const bubble = page.locator(`[data-message-id="${entry.id}"] [data-message-bubble="true"]`);
        await bubble.scrollIntoViewIfNeeded();
        await expect(bubble).toBeVisible();
        await expect(bubble).toHaveAttribute("data-message-own", String(entry.own));
        const metrics = await measure(bubble);
        measurements[entry.id] = metrics;
        expect(metrics.fontSize, entry.id).toBe(size);
        expect(metrics.lineHeight, entry.id).toBeCloseTo(size === 16 ? 26 : size === 13 ? 21.13 : 35.75, 2);
        expect(metrics.glyphHeight, entry.id).toBeLessThanOrEqual(size * 2);
        expect(metrics.footerInside, entry.id).toBe(true);
        expect(metrics.overlap, entry.id).toBe(false);
        expect(metrics.glyphsInside, entry.id).toBe(true);
      }
      for (const id of ["single", "multiple", "family", "skin-tone"]) {
        expect(measurements[id].bubbleHeight).toBeLessThanOrEqual(measurements.plain.bubbleHeight + 2);
      }

      const reply = page.locator('[data-message-id="keycap-reply"] [data-message-bubble="true"]');
      await reply.scrollIntoViewIfNeeded();
      const replyMeasurements = await measureReply(reply);
      assertReply(replyMeasurements);
      for (const mutation of ["display: none !important", "transform: translateX(600px) !important"]) {
        const style = await page.addStyleTag({
          content: `[data-message-id="keycap-reply"] [data-message-reply-preview="true"] { ${mutation}; }`,
        });
        try {
          const mutated = await measureReply(reply);
          expect(() => assertReply(mutated), mutation).toThrow();
          if (mutation.startsWith("display")) expect(mutated.visible).toBe(false);
          else expect(mutated.inside).toBe(false);
        } finally {
          await style.evaluate((node) => node.remove());
        }
        await expect.poll(async () => (await measureReply(reply)).visible).toBe(true);
        assertReply(await measureReply(reply));
      }

      // Calibrate the probe against an actual oversized rendered subject, not
      // another reading of the application's size constant.
      const oversized = await page.addStyleTag({
        content: '[data-message-id="single"] .kub-message-text { font-size: 48px !important; line-height: 78px !important; }',
      });
      const calibration = await measure(page.locator('[data-message-id="single"] [data-message-bubble="true"]'));
      expect(calibration.fontSize).toBe(48);
      expect(calibration.glyphHeight).toBeGreaterThan(measurements.single.glyphHeight);
      await oversized.evaluate((node) => node.remove());
      await expect.poll(async () => (await measure(page.locator('[data-message-id="single"] [data-message-bubble="true"]'))).fontSize).toBe(size);

      if (size === 16) {
        const single = page.locator('[data-message-id="single"] [data-message-bubble="true"]');
        await single.scrollIntoViewIfNeeded();
        const menu = info.project.use.isMobile
          ? await openPhoneMenu(page, single)
          : await openDesktopMenu(page, single);
        await expect(menu.getByRole("menuitem", { name: "Ответить", exact: true })).toBeVisible();
        await expect(menu.getByRole("menuitem", {
          name: info.project.use.isMobile ? "Копировать" : "Копировать текст", exact: true,
        })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
      }

      expect(fixture.restCalls("messages", "POST")).toHaveLength(0);
      const metricsPath = info.outputPath("metrics.json");
      mkdirSync(dirname(metricsPath), { recursive: true });
      writeFileSync(metricsPath, JSON.stringify({ theme, size, measurements, replyMeasurements, calibration }, null, 2));
      if (size === 16) await page.screenshot({ path: info.outputPath("ordinary-emoji.png") });
    });
  }
}
