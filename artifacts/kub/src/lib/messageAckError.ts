export type MessageAckErrorCode =
  | "permission_denied"
  | "conflict"
  | "constraint_violation"
  | "network_error"
  | "api_error"
  | "database_error"
  | "unknown_error";

export interface SanitizedMessageAckError {
  code: MessageAckErrorCode;
  name: "MessageSendAckError";
  error: Error;
}

const SAFE_ERROR_NAME = "MessageSendAckError" as const;

export function sanitizeMessageAckError(error: unknown): SanitizedMessageAckError {
  const code = classifyMessageAckError(error);
  const safeError = new Error(`message_send_failed:${code}`);
  safeError.name = SAFE_ERROR_NAME;
  return {
    code,
    name: SAFE_ERROR_NAME,
    error: safeError,
  };
}

function classifyMessageAckError(error: unknown): MessageAckErrorCode {
  const rawCode = readStringField(error, "code").toUpperCase();
  if (rawCode === "42501" || rawCode === "PGRST301" || rawCode === "PGRST302") {
    return "permission_denied";
  }
  if (rawCode === "23505") return "conflict";
  if (rawCode.startsWith("23")) return "constraint_violation";
  if (rawCode.startsWith("PGRST")) return "api_error";

  const message = error instanceof Error
    ? error.message
    : readStringField(error, "message");
  const normalizedMessage = message.toLowerCase();
  if (
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("fetch") ||
    normalizedMessage.includes("timeout")
  ) {
    return "network_error";
  }
  if (rawCode) return "database_error";
  return "unknown_error";
}

function readStringField(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : "";
}
