export function shouldStartLegacyPushDispatcher(value: string | undefined): boolean {
  return value === "1";
}

export function buildLegacyWebPushPayload(
  payload: Record<string, unknown>,
  subscriptionId: string,
  configuredAppOrigin?: string,
): Record<string, unknown> {
  const text = (value: unknown, fallback: string, limit: number) => typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) || fallback : fallback;
  const uuid = (value: unknown): value is string => typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const kind = text(payload["kind"], "notification", 60);
  const url = typeof payload["url"] === "string" && payload["url"].length <= 1024 &&
    payload["url"].startsWith("/") && !payload["url"].startsWith("//") &&
    !/[\u0000-\u0020\u007f\\]/.test(payload["url"]) ? payload["url"] : "/";
  const chatId = uuid(payload["chatId"]) ? payload["chatId"].toLowerCase() : "";
  const messageId = uuid(payload["messageId"]) ? payload["messageId"].toLowerCase() : "";
  const tag = text(payload["tag"], chatId ? `message:chat:${chatId}` : "kub-notification", 100);
  const result: Record<string, unknown> = {
    title: "LETSCUBE", body: "Новое уведомление", kind, url, tag, chatId, messageId,
    renotify: typeof payload["renotify"] === "boolean" ? payload["renotify"] : true,
  };
  if (kind === "message" && uuid(subscriptionId) && uuid(payload["notificationId"])) {
    result["web_preview"] = { preview_v: 1, subscription_id: subscriptionId.toLowerCase(),
      notification_id: payload["notificationId"].toLowerCase() };
  }
  if (configuredAppOrigin) {
    try {
      const origin = new URL(configuredAppOrigin);
      if (origin.protocol === "https:" && !origin.username && !origin.password && origin.hostname !== "localhost") {
        result["web_push"] = 8030;
        result["notification"] = { title: "LETSCUBE", body: "Новое уведомление",
          navigate: new URL(url, origin.origin).href, tag };
      }
    } catch { /* Invalid operator configuration keeps the safe legacy fallback. */ }
  }
  return result;
}

export function sanitizeLegacyWebPushFailure(error: unknown): {
  status: number | null;
  reason: string;
} {
  if (!error || typeof error !== "object") return { status: null, reason: "unknown" };
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  const status = typeof statusCode === "number" && Number.isFinite(statusCode) ? statusCode : null;
  const body = (error as { body?: unknown }).body;
  let parsed: unknown = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
  }
  const reason = parsed && typeof parsed === "object"
    ? (parsed as { reason?: unknown }).reason
    : null;
  return {
    status,
    reason: typeof reason === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(reason)
      ? reason
      : "unknown",
  };
}
