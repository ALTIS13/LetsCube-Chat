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

  test("maps acknowledgement UI copy to a bounded friendly message", async () => {
    const { getMessageAckUserMessage } = await import(
      "../../artifacts/kub/src/lib/messageAckError"
    );
    const rawCyrillic = "Секретная серверная ошибка для пользователя user@example.test";

    const message = getMessageAckUserMessage({ code: "P0001", message: rawCyrillic });

    expect(message).toBe("Не удалось отправить сообщение.");
    expect(message).not.toContain(rawCyrillic);
    expect(message).not.toContain("user@example.test");
  });

  test("builds timeout telemetry without a chat UUID", async () => {
    const { createMessageSendTimeoutContext } = await import(
      "../../artifacts/kub/src/lib/messageAckError"
    );

    const context = createMessageSendTimeoutContext("video", true);

    expect(context).toEqual({
      category: "message_send_timeout",
      type: "video",
      hasMedia: true,
    });
    expect(JSON.stringify(context)).not.toContain("chat-a-uuid");
    expect(context).not.toHaveProperty("chatId");
  });

  test("does not restore stale composer text or write it into the next chat draft", async () => {
    const {
      createComposerSendScope,
      restoreComposerTextIfCurrent,
    } = await import("../../artifacts/kub/src/lib/composerSendScope");
    const scope = createComposerSendScope("chat-a");
    const token = scope.capture();
    let resolveSend: (() => void) | undefined;
    const send = new Promise<void>((resolve) => { resolveSend = resolve; });
    const restoredText: string[] = [];
    const draftWrites: Array<{ chatId: string; text: string }> = [];
    const completion = (async () => {
      await send;
      return restoreComposerTextIfCurrent(scope, token, "draft from chat A", {
        restoreText: (text) => restoredText.push(text),
        writeDraft: (chatId, text) => draftWrites.push({ chatId, text }),
      });
    })();

    scope.activate("chat-b");
    resolveSend?.();

    await expect(completion).resolves.toBe(false);
    expect(restoredText).toEqual([]);
    expect(draftWrites).toEqual([]);
  });

  test("ignores a location result that resolves after the composer changes chat", async () => {
    const {
      createComposerSendScope,
      runComposerCompletionIfCurrent,
    } = await import("../../artifacts/kub/src/lib/composerSendScope");
    const scope = createComposerSendScope("chat-a");
    const token = scope.capture();
    let resolveLocation: ((position: { latitude: number; longitude: number }) => void) | undefined;
    const location = new Promise<{ latitude: number; longitude: number }>((resolve) => {
      resolveLocation = resolve;
    });
    const sent: string[] = [];
    const completion = (async () => {
      const position = await location;
      return runComposerCompletionIfCurrent(scope, token, () => {
        sent.push(`${position.latitude},${position.longitude}`);
      });
    })();

    scope.invalidate();
    scope.activate("chat-b");
    resolveLocation?.({ latitude: 55.75, longitude: 37.62 });

    await expect(completion).resolves.toEqual({ status: "stale" });
    expect(sent).toEqual([]);
  });

  test("ignores voice and video recorder completions from the previous chat", async () => {
    const {
      createComposerSendScope,
      runComposerCompletionIfCurrent,
    } = await import("../../artifacts/kub/src/lib/composerSendScope");
    const scope = createComposerSendScope("chat-a");
    const voiceToken = scope.capture();
    const roundVideoToken = scope.capture();
    const regularVideoToken = scope.capture();
    const staged: string[] = [];

    scope.invalidate();
    scope.activate("chat-b");

    const results = await Promise.all([
      runComposerCompletionIfCurrent(scope, voiceToken, () => staged.push("voice")),
      runComposerCompletionIfCurrent(scope, roundVideoToken, () => staged.push("round-video")),
      runComposerCompletionIfCurrent(scope, regularVideoToken, () => staged.push("regular-video")),
    ]);

    expect(results).toEqual([
      { status: "stale" },
      { status: "stale" },
      { status: "stale" },
    ]);
    expect(staged).toEqual([]);
  });
});
