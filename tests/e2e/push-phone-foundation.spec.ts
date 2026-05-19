import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

test.describe("KUB push and phone production foundation", () => {
  test("settings expose push preferences and require OTP for phone changes", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin", "location_admin", "location_staff", "client"], {
      includeDefault: true,
    });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    await page.getByRole("button", { name: "Меню" }).click();
    await page.getByRole("button", { name: "Настройки" }).click();

    await expect(page.getByText("Редактировать профиль").first()).toBeVisible();
    await page.getByText("Push-уведомления").scrollIntoViewIfNeeded();
    await expect(page.getByText("Push-уведомления")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Push: Сообщения" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Push: Задачи" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Push: Приглашения" })).toBeVisible();
    const dialogBox = await page.getByRole("dialog").boundingBox();
    expect(dialogBox).not.toBeNull();
    for (const name of ["Push: Сообщения", "Push: Задачи", "Push: Приглашения"]) {
      const box = await page.getByRole("switch", { name }).boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) + 1);
    }
    await expect(page.getByRole("button", { name: /Сохранить без/ })).toHaveCount(0);
  });

  test("service worker contains safe push and click routing handlers", async () => {
    const swSource = readFileSync(resolve("artifacts/kub/public/sw.js"), "utf8");
    expect(swSource).toContain('self.addEventListener("push"');
    expect(swSource).toContain('self.addEventListener("notificationclick"');
    expect(swSource).toContain("Новое уведомление");
    expect(swSource).toContain("kub-open");
    expect(swSource).toContain("messageId");
    expect(swSource).toContain("message_id");
    expect(swSource).toContain("message:chat:");
    expect(swSource).toContain("isMessagePush");
    expect(swSource).toContain("renotify: !data.isMessagePush");
    expect(swSource).not.toMatch(/media_url|signedUrl|access_token|refresh_token/i);
  });
});
