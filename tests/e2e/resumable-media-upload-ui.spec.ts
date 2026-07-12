import { expect, test } from "@playwright/test";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test.describe("resumable media upload UI", () => {
  test("shows TUS progress and cancels the active upload", async ({ page }) => {
    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    let deleteRequested = false;
    const uploadLocation = "https://core.letscube.ru/storage/v1/upload/resumable/qa-ui-upload";
    const corsHeaders = {
      "access-control-allow-origin": "http://127.0.0.1:5173",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, HEAD, PATCH, OPTIONS, DELETE",
      "access-control-expose-headers": "Location, Upload-Offset, Tus-Resumable",
      "tus-resumable": "1.0.0",
    };

    await page.route("**/storage/v1/upload/resumable**", async (route) => {
      const request = route.request();
      const method = request.method();

      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      if (method === "POST") {
        await route.fulfill({
          status: 201,
          headers: { ...corsHeaders, location: uploadLocation, "upload-offset": "0" },
        });
        return;
      }
      if (method === "PATCH") {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        await route.fulfill({
          status: 204,
          headers: { ...corsHeaders, "upload-offset": String(6 * 1024 * 1024) },
        }).catch(() => undefined);
        return;
      }
      if (method === "DELETE") {
        deleteRequested = true;
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders });
    });

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const firstChat = page.getByTestId("chat-list-item").first();
    test.skip((await firstChat.count()) === 0, "QA account has no visible chats");
    await firstChat.click();

    const payload = Buffer.alloc(7 * 1024 * 1024, 0x4c);
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: `qa-resumable-${Date.now()}.bin`,
      mimeType: "application/octet-stream",
      buffer: payload,
    });

    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(1);
    await page.getByRole("button", { name: "Отправить" }).click();

    const progress = page.getByTestId("staged-attachment-upload-progress");
    await expect(progress).toBeVisible();
    await expect.poll(async () => Number(await progress.getAttribute("aria-valuenow"))).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Отменить загрузку" }).click();
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
    await expect.poll(() => deleteRequested).toBe(true);
  });
});
