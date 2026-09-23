import { expect, test } from "@playwright/test";
import { chat, membership, message, openChat, openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const CHAT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3310";
const ME = person("11111111-1111-4111-8111-111111111101", "Sender");
const RECIPIENT = person("22222222-2222-4222-8222-222222222202", "Recipient");
const CASES = [
  { id: "read", text: "Read fixture", at: "2026-09-01T09:10:00.000Z", label: "Прочитано" },
  { id: "delivered", text: "Delivered fixture", at: "2026-09-01T09:20:00.000Z", label: "Доставлено" },
  { id: "sent", text: "Sent fixture", at: "2026-09-01T09:30:00.000Z", label: "Отправлено" },
] as const;

for (const width of [1440, 390]) {
  for (const theme of ["dark", "light"] as const) {
    test(`own-message delivery checks distinguish sent, delivered and read at ${width}px in ${theme}`, async ({ page, request }, testInfo) => {
      await requireFixtureServer(request);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const recipient = membership(CHAT_ID, RECIPIENT, "member", "2026-09-01T09:15:00.000Z");
      recipient.last_delivered_at = "2026-09-01T09:25:00.000Z";
      await openFixture(page, {
        me: ME,
        chats: [chat(CHAT_ID, "private", null, "2026-09-01T09:30:00.000Z")],
        memberships: [membership(CHAT_ID, ME, "owner", "2026-09-01T09:30:00.000Z"), recipient],
        messages: CASES.map(({ id, text, at }) => message(id, CHAT_ID, ME, text, at)),
      });
      await openChat(page, RECIPIENT.full_name, CASES[0].text);
      await page.evaluate((selectedTheme) => {
        const root = document.documentElement;
        root.classList.toggle("dark", selectedTheme === "dark");
        root.classList.toggle("light", selectedTheme === "light");
        root.dataset.theme = selectedTheme;
        root.style.colorScheme = selectedTheme;
      }, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const colors: Record<string, string> = {};
      const paths: Record<string, string | null> = {};
      for (const { id, label } of CASES) {
        const bubble = page.locator(`[data-message-id="${id}"] [data-message-bubble="true"]`);
        await expect(bubble).toHaveAttribute("data-message-own", "true");
        expect(await bubble.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(59, 92, 207)");
        const status = bubble.locator('[data-message-delivery-slot="true"] [role="img"]');
        await expect(status).toHaveAttribute("aria-label", label);
        const icon = status.locator("svg");
        colors[id] = await icon.evaluate((svg) => getComputedStyle(svg).color);
        paths[id] = await icon.locator("path").getAttribute("d");
      }

      expect(paths.delivered).toBe(paths.read);
      expect(paths.delivered).not.toBe(paths.sent);
      expect(colors.sent).toBe(colors.delivered);
      expect(colors.read).toBe("rgb(108, 245, 185)");
      expect(colors.read).not.toBe(colors.delivered);
      await page.screenshot({ path: testInfo.outputPath(`message-delivery-${width}-${theme}.png`) });
    });
  }
}
