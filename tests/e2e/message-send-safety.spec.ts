import { expect, test } from "@playwright/test";

test.describe("message send safety", () => {
  test("sanitizes acknowledgement errors before logging or monitoring", async () => {
    const { sanitizeMessageAckError } = await import(
      "../../artifacts/kub/src/lib/messageAckError"
    );
    const rawError = {
      code: "42501",
      name: "PostgrestError",
      message: "permission denied at https://project.supabase.co/rest/v1/messages?token=secret",
      details: "private row user@example.test",
      hint: "Bearer raw-access-token",
    };

    const first = sanitizeMessageAckError(rawError);
    const second = sanitizeMessageAckError(rawError);
    const serialized = JSON.stringify({
      code: first.code,
      name: first.name,
      message: first.error.message,
    });

    expect(first).toMatchObject({
      code: "permission_denied",
      name: "MessageSendAckError",
    });
    expect(first.error).toBeInstanceOf(Error);
    expect(first.error).not.toBe(second.error);
    expect(first.error.message).toBe("message_send_failed:permission_denied");
    expect(serialized).not.toContain("project.supabase.co");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("user@example.test");
    expect(serialized).not.toContain("raw-access-token");
    expect(serialized).not.toContain("PostgrestError");
  });
});
