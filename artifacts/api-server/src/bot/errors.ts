import { ZodError } from "zod";

export const BOT_API_ERROR_STATUS = {
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  bot_creation_not_allowed: 403,
  not_found: 404,
  method_not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
} as const;

export type BotApiErrorCode = keyof typeof BOT_API_ERROR_STATUS;

const BOT_API_ERROR_MESSAGE: Record<BotApiErrorCode, string> = {
  validation_failed: "Invalid request",
  unauthorized: "Unauthorized",
  forbidden: "Forbidden",
  bot_creation_not_allowed: "Bot creation is not allowed",
  not_found: "Not found",
  method_not_found: "Method not found",
  conflict: "Conflict",
  payload_too_large: "Payload too large",
  rate_limited: "Too many requests",
  internal_error: "Internal server error",
};

export type BotApiSuccess<T> = {
  ok: true;
  result: T;
};

export type BotApiFailure = {
  ok: false;
  error: {
    code: BotApiErrorCode;
    message: string;
    request_id: string;
    retry_after?: number;
  };
};

export class BotApiError extends Error {
  readonly code: BotApiErrorCode;
  readonly status: number;
  readonly retryAfter?: number;

  constructor(code: BotApiErrorCode, retryAfter?: number) {
    super(`bot_api_${code}`);
    this.name = "BotApiError";
    this.code = code;
    this.status = BOT_API_ERROR_STATUS[code];
    if (
      code === "rate_limited" &&
      Number.isSafeInteger(retryAfter) &&
      (retryAfter ?? 0) > 0 &&
      (retryAfter ?? 0) <= 86_400
    ) {
      this.retryAfter = retryAfter;
    }
  }
}

export function botSuccess<T>(result: T): BotApiSuccess<T> {
  return { ok: true, result };
}

export function botFailure(
  code: BotApiErrorCode,
  message: string,
  requestId: string,
  retryAfter?: number,
): BotApiFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      request_id: requestId,
      ...(retryAfter !== undefined ? { retry_after: retryAfter } : {}),
    },
  };
}

function sanitizeRequestId(requestId: string): string {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ? requestId : "unknown";
}

export function toBotApiErrorResponse(
  error: unknown,
  requestId: string,
): { status: number; body: BotApiFailure } {
  const safeError =
    error instanceof BotApiError
      ? error
      : error instanceof ZodError
        ? new BotApiError("validation_failed")
        : new BotApiError("internal_error");
  return {
    status: safeError.status,
    body: botFailure(
      safeError.code,
      BOT_API_ERROR_MESSAGE[safeError.code],
      sanitizeRequestId(requestId),
      safeError.retryAfter,
    ),
  };
}
