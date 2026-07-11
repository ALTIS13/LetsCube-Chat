export function shouldStartLegacyPushDispatcher(value: string | undefined): boolean {
  return value === "1";
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
