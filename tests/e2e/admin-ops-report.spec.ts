import { expect, test, type Page } from "@playwright/test";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test.describe("LETSCUBE admin ops report", () => {
  test("opens the admin ops report without exposing raw technical data", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/ops", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("admin-ops-report")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Операционная безопасность" })).toBeVisible();
    await expect(page.getByTestId("admin-ops-captcha-status")).toBeVisible();
    await expect(page.getByTestId("admin-ops-summary-cards")).toBeVisible();
    await expect(page.getByTestId("admin-ops-controls")).toBeVisible();

    const warning = page.getByTestId("admin-ops-migration-warning");
    const events = page.getByTestId("admin-ops-events");
    await expect(events).toBeVisible();
    if (await warning.isVisible().catch(() => false)) {
      await expect(warning).toContainText("admin_ops_security_report");
    }

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/PGRST|DOMException|stack|payload|JSON\.stringify|captchaToken|recovery token/i);
    expect(bodyText).not.toMatch(/Admin \/ Ops|Invite-only|invite-code|invite-link|Direct Auth|Auth gateway|Audit log|sanitised|Email/i);
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });
});

function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  return consoleErrors;
}

function unexpectedConsoleErrors(messages: string[]): string[] {
  return messages.filter(
    (message) =>
      !message.includes("Failed to load resource") &&
      !message.includes("Missing Supabase environment variables") &&
      !(message.includes("TypeError: Failed to fetch") && message.includes("@supabase_supabase-js")),
  );
}
