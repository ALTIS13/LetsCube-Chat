import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

test("changing a phone keeps the code target clear without showing the old verified state", async ({
  page,
}, testInfo) => {
  const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
  test.skip(!role, "QA auth state or credentials are not configured");

  await page.route("**/rest/v1/profile_contacts?*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const requestedId = new URL(route.request().url()).searchParams
      .get("user_id")
      ?.replace(/^eq\./, "");
    await route.fulfill({
      status: 200,
      contentType: "application/vnd.pgrst.object+json",
      body: JSON.stringify({
        user_id: requestedId,
        phone: "+79990000000",
        phone_verified: true,
        phone_verified_at: "2026-09-01T12:00:00Z",
      }),
    });
  });
  await page.route("**/functions/v1/phone-verification-gateway", async (route) => {
    const action = (route.request().postDataJSON() as { action?: string }).action;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        action === "verify" ? { ok: false, error: "invalid_code" } : { ok: true },
      ),
    });
  });

  await gotoOrSkip(page, "/");
  await loginAsRoleOrSkip(page, role);
  await page.getByRole("button", { name: "Меню" }).click();
  await page.getByRole("button", { name: "Настройки" }).click();
  await page.getByTestId("settings-open-phone").click();

  const section = page.getByTestId("settings-section-phone");
  await expect(section.getByText("Подтверждён", { exact: true })).toBeVisible();
  const phone = section.getByPlaceholder("+7 999 123 45 67");
  await phone.fill("+15551234567");
  await expect(section.getByText("Подтверждён", { exact: true })).toHaveCount(0);

  await section.getByRole("button", { name: "Изменить номер" }).click();
  const code = section.locator('input[inputmode="numeric"]');
  await expect(code).toBeVisible();
  await expect(section.getByRole("textbox", { name: "Код подтверждения (4 цифры)" })).toBeVisible();
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await expect(code).not.toHaveAttribute("placeholder", /.+/);
  await expect(section.getByText("Код отправлен на номер +15551234567")).toHaveCount(1);
  await expect(section.getByText("Подтверждён", { exact: true })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Удалить" })).toHaveCount(0);
  await expect(section.getByRole("button", { name: /Повторно через/ })).toHaveCount(0);
  await expect(section.getByText(/Повторная отправка через/)).toBeVisible();
  await testInfo.attach("phone-code-step", {
    body: await section.screenshot(),
    contentType: "image/png",
  });

  await code.fill("0000");
  await section.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(section.getByText("Неверный код подтверждения.")).toBeVisible();
  await expect(section.getByText("Код отправлен на номер +15551234567")).toBeVisible();
});
