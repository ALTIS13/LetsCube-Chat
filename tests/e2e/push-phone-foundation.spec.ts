import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

test.describe("LETSCUBE push and phone production foundation", () => {
  test("settings expose push preferences and require OTP for phone changes", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin", "location_admin", "location_staff", "client"], {
      includeDefault: true,
    });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    await page.getByRole("button", { name: "Меню" }).click();
    await page.getByRole("button", { name: "Настройки" }).click();

    await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
    await page.getByText("Push-уведомления").scrollIntoViewIfNeeded();
    await expect(page.getByText("Push-уведомления")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Push: Сообщения" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Push: Задачи" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Push: Приглашения" })).toBeVisible();
    const dialogBox = await page.getByRole("dialog").boundingBox();
    expect(dialogBox).not.toBeNull();
    for (const name of ["Push: Сообщения", "Push: Задачи", "Push: Приглашения"]) {
      const switchControl = page.getByRole("switch", { name });
      const box = await switchControl.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) + 1);
      const thumbBox = await switchControl.locator('[data-testid="kub-switch-thumb"]').boundingBox();
      expect(thumbBox).not.toBeNull();
      expect(thumbBox?.x ?? 0).toBeGreaterThanOrEqual((box?.x ?? 0) - 1);
      expect((thumbBox?.x ?? 0) + (thumbBox?.width ?? 0)).toBeLessThanOrEqual((box?.x ?? 0) + (box?.width ?? 0) + 1);
    }
    await expect(page.getByRole("button", { name: /Сохранить без/ })).toHaveCount(0);
  });

  test("native Android settings show FCM setup state instead of browser push placeholder", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin", "location_admin", "location_staff", "client"], {
      includeDefault: true,
    });
    test.skip(!role, "QA credentials or auth state are not configured");

    await page.addInitScript(() => {
      Object.defineProperty(window, "androidBridge", {
        configurable: true,
        value: {},
      });
    });

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    await page.getByRole("button", { name: "Меню" }).click();
    await page.getByRole("button", { name: "Настройки" }).click();

    await page.getByText("Push-уведомления").scrollIntoViewIfNeeded();
    await expect(page.getByText("Push-уведомления")).toBeVisible();
    await expect(page.getByText(/Firebase\/FCM|Android-приложении/i).first()).toBeVisible();
    await expect(page.getByText(/следующем этапе/i)).toHaveCount(0);
    await expect(page.getByText(/настройках браузера/i)).toHaveCount(0);
  });

  test("phone verification requires international format and hides SMS provider details", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin", "location_admin", "location_staff", "client"], {
      includeDefault: true,
    });
    test.skip(!role, "QA credentials or auth state are not configured");

    const phoneFlowCalls: string[] = [];
    await page.route("**/functions/v1/phone-verification-gateway", async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      phoneFlowCalls.push(`gateway:${body.action ?? "unknown"}`);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "delivery_unavailable" }),
      });
    });

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    await page.getByRole("button", { name: "Меню" }).click();
    await page.getByRole("button", { name: "Настройки" }).click();
    await page.getByRole("tab", { name: "Профиль" }).click();
    await expect(page.getByText("Личная информация")).toBeVisible();

    const phoneInput = page.getByPlaceholder("+7 999 123 45 67");
    await phoneInput.scrollIntoViewIfNeeded();
    await phoneInput.fill("89991234567");
    await expect(page.getByText("Введите номер в международном формате, например +79991234567.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Подтвердить номер|Изменить номер/ })).toBeDisabled();

    await phoneInput.fill("+1 (555) 123-45-67");
    await page.getByRole("button", { name: /Подтвердить номер|Изменить номер/ }).click();
    await expect(
      page.getByText("Сервис доставки кода не настроен. Обратитесь к администратору."),
    ).toBeVisible();
    await expect(page.getByText(/Twilio|account SID|missing Twilio/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Сохранить без/ })).toHaveCount(0);
    expect(phoneFlowCalls).toEqual(["gateway:begin"]);
  });

  test("profile usernames reserve admin-looking handles for real admins", async () => {
    const profileValidationSource = readFileSync(resolve("artifacts/kub/src/lib/profileValidation.ts"), "utf8");
    const settingsSource = readFileSync(resolve("artifacts/kub/src/components/sidebar/SettingsModal.tsx"), "utf8");
    const errorsSource = readFileSync(resolve("artifacts/kub/src/lib/errors.ts"), "utf8");
    const migrationSource = readFileSync(
      resolve(".migration-backup/supabase/migrations/20260622_reserved_profile_usernames.sql"),
      "utf8",
    );

    expect(profileValidationSource).toContain("RESERVED_USERNAME_KEYS");
    expect(profileValidationSource).toContain('"admin"');
    expect(profileValidationSource).toContain('"support"');
    expect(profileValidationSource).toContain('"letscube"');
    expect(profileValidationSource).toContain("reservedUsernameKey");
    expect(profileValidationSource).toContain("Этот никнейм зарезервирован для администраторов.");
    expect(settingsSource).toContain("useIsAdmin");
    expect(settingsSource).toContain("allowReserved: isAdmin");
    expect(errorsSource).toContain("reserved_username_requires_admin");
    expect(migrationSource).toContain("profiles_reserved_username_guard");
    expect(migrationSource).toContain("user_global_roles_reserved_username_guard");
    expect(migrationSource).toContain("public.is_admin(p_user_id)");
    expect(migrationSource).toContain("new.role::text = 'admin'");
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
    expect(swSource).toContain("closePushNotificationTag(data.tag)");
    expect(swSource).toContain("getNotifications({ tag })");
    expect(swSource).toContain('event.data?.type === "KUB_CLOSE_NOTIFICATION"');
    expect(swSource).toContain('self.addEventListener("pushsubscriptionchange"');
    expect(swSource).toContain("KUB_PUSH_SUBSCRIPTION_CHANGED");
    expect(swSource).toContain("data.notification");
    expect(swSource).toContain("data.navigate");
    expect(swSource).toContain("notification.close()");
    expect(swSource).toContain("renotify: data.renotify");
    expect(swSource).toContain('data.renotify === "boolean" ? data.renotify : true');
    expect(swSource).toContain("timestamp: data.timestamp");
    expect(swSource).not.toMatch(/media_url|signedUrl|access_token|refresh_token/i);
  });

  test("native push adapter keeps FCM tokens out of logs and defines Android channels", async () => {
    const nativePushSource = readFileSync(resolve("artifacts/kub/src/lib/platform/nativePush.ts"), "utf8");
    const usePushSource = readFileSync(resolve("artifacts/kub/src/hooks/usePush.ts"), "utf8");
    expect(nativePushSource).not.toContain("async function loadPushNotifications");
    expect(nativePushSource).not.toContain("await loadPushNotifications()");
    expect(nativePushSource).toContain('id: "messages"');
    expect(nativePushSource).toContain('id: "tasks"');
    expect(nativePushSource).toContain('id: "system"');
    expect(nativePushSource).toContain("pushNotificationActionPerformed");
    expect(usePushSource).toContain("register_push_device");
    expect(usePushSource).toContain("unregister_push_device");
    expect(`${nativePushSource}\n${usePushSource}`).not.toMatch(/console\.(log|debug)\(/);
    expect(`${nativePushSource}\n${usePushSource}`).not.toMatch(/localStorage\.setItem\([^)]*token/i);
  });
});
