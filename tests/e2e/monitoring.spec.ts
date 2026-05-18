import { expect, test } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

test.describe("KUB monitoring foundation", () => {
  test("redacts sensitive monitoring context and stays disabled without DSN", async ({ page }) => {
    await gotoOrSkip(page, "/");

    const result = await page.evaluate(async () => {
      const monitoring = await import("/src/lib/monitoring.ts");
      return {
        enabled: monitoring.isMonitoringEnabled(),
        redacted: monitoring.sanitizeMonitoringContext({
          email: "user@example.test",
          password: "Secret123",
          access_token: "access-token-value",
          refresh_token: "refresh-token-value",
          authorization: "Bearer token-value",
          messageContent: "private chat text",
          mediaUrl: "https://project.supabase.co/storage/v1/object/sign/media/file.png?token=secret",
          nested: {
            supabaseKey: "sb_publishable_test_value",
            safeCategory: "send_message",
          },
        }),
      };
    });

    expect(result.enabled).toBe(false);
    expect(JSON.stringify(result.redacted)).not.toContain("user@example.test");
    expect(JSON.stringify(result.redacted)).not.toContain("Secret123");
    expect(JSON.stringify(result.redacted)).not.toContain("access-token-value");
    expect(JSON.stringify(result.redacted)).not.toContain("refresh-token-value");
    expect(JSON.stringify(result.redacted)).not.toContain("Bearer token-value");
    expect(JSON.stringify(result.redacted)).not.toContain("private chat text");
    expect(JSON.stringify(result.redacted)).not.toContain("token=secret");
    expect(JSON.stringify(result.redacted)).not.toContain("sb_publishable_test_value");
    expect(result.redacted.nested.safeCategory).toBe("send_message");
  });
});
