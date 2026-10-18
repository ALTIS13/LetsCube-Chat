import { expect, test } from "@playwright/test";
import path from "node:path";
import { FIXTURE_HOST, chat, membership, openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

test.use({ screenshot: "off", trace: "off", video: "off" });

for (const theme of ["dark", "light"] as const) {
  test(`access hydration exposes only the final navbar hitboxes (${theme})`, async ({ page, request }) => {
    expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
    await requireFixtureServer(request);
    await page.setViewportSize({ width: 390, height: 960 });
    const me = { ...person("10000000-0000-4000-8000-000000000001", "Synthetic receiver"), role: "location_admin" };
    const group = chat("20000000-0000-4000-8000-000000000001", "group", "Synthetic group", "2026-10-18T09:00:00.000Z");
    await openFixture(page, { me, theme, chats: [group], memberships: [membership(String(group.id), me, "owner", null)], messages: [] });

    let release!: () => void;
    let held = 0;
    const permissionReply = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`${FIXTURE_HOST}/rest/v1/rpc/has_permission`, async (route) => {
      held += 1;
      await permissionReply;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(route.request().postDataJSON().p_permission_key === "tasks.view") });
    });
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const nav = page.getByRole("navigation", { name: "Навигация", exact: true });
      await expect(nav).toBeVisible();
      await expect.poll(() => held).toBeGreaterThan(0);
      await expect(page.getByTestId("chat-list-item")).toBeVisible();
      await expect(nav).toHaveAttribute("aria-busy", "true");
      await expect(nav.getByRole("status")).toBeVisible();
      await expect(nav.getByRole("button")).toHaveCount(0);
      if (process.env.KUB_BOTTOM_NAV_CAPTURE_DIR) {
        await page.screenshot({ path: path.join(process.env.KUB_BOTTOM_NAV_CAPTURE_DIR, `nav-pending-390-${theme}.png`) });
      }

      const frame = await nav.boundingBox();
      expect(frame).not.toBeNull();
      // The former rightmost Profile hitbox must not activate another surface.
      await page.mouse.click(frame!.x + frame!.width * 0.87, frame!.y + frame!.height / 2);
      await expect(page.getByTestId("settings-field-name")).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe("/");

      release();
      await expect(nav).toHaveAttribute("aria-busy", "false");
      await expect(nav.getByRole("button")).toHaveCount(4);
      expect(await nav.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))))
        .toEqual(["Чаты", "Контакты", "Профиль", "Задачи"]);
      await page.evaluate(() => document.fonts.ready);
      if (process.env.KUB_BOTTOM_NAV_CAPTURE_DIR) {
        await page.screenshot({ path: path.join(process.env.KUB_BOTTOM_NAV_CAPTURE_DIR, `nav-ready-390-${theme}.png`) });
      }
      expect(await nav.getByRole("button").evaluateAll((buttons) => buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button") === button;
      }))).toBe(true);
      await nav.getByRole("button", { name: "Профиль", exact: true }).click();
      await expect(page.getByTestId("settings-field-name")).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(nav).toBeHidden();
      await expect(page.getByTestId("settings-overlay")).toBeVisible();
      await expect.poll(() => page.getByTestId("settings-overlay").evaluate((node) => {
        let opacity = 1;
        for (let element: Element | null = node; element; element = element.parentElement) {
          opacity *= Number(getComputedStyle(element).opacity);
        }
        return opacity;
      })).toBe(1);
      await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) =>
        Number.isFinite(animation.effect?.getComputedTiming().endTime),
      ).every((animation) => animation.playState !== "running"))).toBe(true);
      if (process.env.KUB_BOTTOM_NAV_CAPTURE_DIR) {
        await page.screenshot({ path: path.join(process.env.KUB_BOTTOM_NAV_CAPTURE_DIR, `nav-desktop-1440-${theme}.png`) });
      }
    } finally {
      release();
    }
  });
}
