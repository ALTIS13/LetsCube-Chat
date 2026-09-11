/**
 * Why an upload failed, read from the server's own answer, and what to tell
 * the person whose file it was.
 *
 * D-113, «видео не отправляется», could not be diagnosed, and the send path is
 * why. The resumable path's `onError` threw tus-js-client's error away, HTTP
 * status and all. The multipart path's error was flattened into one string and
 * searched for «413», «network» or «fetch», so a failure whose text merely
 * contained those digits — an object path is full of digits — read as «too
 * large», and anything else became one sentence that said nothing. A 413 read
 * «Максимум 250 МБ» whatever the server's limit was: the client's own limit,
 * guessed onto a refusal that came from somewhere else.
 *
 * Here the status is taken from the response object, the limit only from a
 * header the server sent — never guessed — and the message names the file.
 *
 * Imports nothing, so `node --test` loads it directly:
 * `tests/unit/upload-failure.test.mts`.
 */

export type UploadFailureReason =
  /** The server refused the size: 413. */
  | "too_large"
  /** The server refused the type: 415. */
  | "unsupported_type"
  /** No answer came back at all: the connection dropped or timed out. */
  | "network"
  /** There was no session to upload with, or the server answered 401. */
  | "session"
  | "unknown";

export interface UploadFailure {
  reason: UploadFailureReason;
  /** The HTTP status the server answered with; null when no answer arrived. */
  status: number | null;
  /** The largest upload the server said it accepts, in bytes; null when it did not say. */
  limitBytes: number | null;
}

/**
 * The one place a response states a size limit: the tus protocol's
 * `Tus-Max-Size`. A storage 413 over multipart carries a sentence, not a number,
 * and then no number is shown.
 */
export const TUS_MAX_SIZE_HEADER = "Tus-Max-Size";

const NBSP = String.fromCharCode(0xa0);
const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;

const REASONS: ReadonlySet<string> = new Set(["too_large", "unsupported_type", "network", "session", "unknown"]);

/** Words, never digits: a path or a request id carries digits by chance. */
const TOO_LARGE_WORDS = [
  "payload too large",
  "entity too large",
  "entitytoolarge",
  "exceeded the maximum allowed size",
  "maximum size exceeded",
  "too large",
];
const UNSUPPORTED_TYPE_WORDS = ["invalid_mime_type", "invalidmimetype", "unsupported media type", "mime type"];
const NETWORK_WORDS = [
  "failed to fetch",
  "networkerror",
  "network error",
  "network request failed",
  "timed out",
  "timeout",
];
/** Safari's whole message for a fetch that got no answer. As a fragment it is inside «upload failed». */
const SAFARI_NETWORK_MESSAGE = "load failed";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null;
}

function readSafely<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

function httpStatus(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  const number = typeof value === "number" ? value : /^[0-9]{3}$/.test(text) ? Number(text) : Number.NaN;
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null;
}

/** A positive whole number of bytes, from a number or from a header's digits. */
export function parseByteCount(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  const number = typeof value === "number" ? value : /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

interface ResponseLike {
  getStatus: () => unknown;
  getHeader?: unknown;
}

/** tus-js-client's `DetailedError.originalResponse`: there only when the server replied. */
function responseOf(record: UnknownRecord | null): ResponseLike | null {
  const response = asRecord(record?.originalResponse);
  return response && typeof response.getStatus === "function" ? (response as unknown as ResponseLike) : null;
}

/** A failure this module already described, kept on the error that carries it. */
function keptFailure(record: UnknownRecord | null): UploadFailure | null {
  if (!record || typeof record.reason !== "string" || !REASONS.has(record.reason)) return null;
  const status = record.status === null ? null : httpStatus(record.status);
  const limitBytes = record.limitBytes === null ? null : parseByteCount(record.limitBytes);
  if (record.status !== null && status === null) return null;
  if (record.limitBytes !== null && limitBytes === null) return null;
  return { reason: record.reason as UploadFailureReason, status, limitBytes };
}

/**
 * What an upload's failure was, from whatever the transport threw.
 *
 * Read in this order: a failure already described here (the resumable wrapper
 * keeps one), the status on tus-js-client's response, storage-js's `status`
 * and the `statusCode` its body declared, and only then words.
 */
export function describeUploadFailure(error: unknown): UploadFailure {
  const record = asRecord(error);
  const kept = keptFailure(record);
  if (kept) return kept;

  const response = responseOf(record);
  const answered = response ? httpStatus(readSafely(() => response.getStatus())) : null;
  const status = answered ?? httpStatus(record?.status);
  // storage-api has answered a size refusal as HTTP 400 with `statusCode: "413"`
  // in its body, so what the body declared counts as well.
  const declared = httpStatus(record?.statusCode);
  const getHeader = response?.getHeader;
  const limitBytes = typeof getHeader === "function"
    ? parseByteCount(readSafely(() => (getHeader as (name: string) => unknown).call(response, TUS_MAX_SIZE_HEADER)))
    : null;
  const message = (typeof error === "string" ? error : typeof record?.message === "string" ? record.message : "").toLowerCase();

  return { reason: reasonFor({ status, declared, message, record, error }), status, limitBytes };
}

function reasonFor(input: {
  status: number | null;
  declared: number | null;
  message: string;
  record: UnknownRecord | null;
  error: unknown;
}): UploadFailureReason {
  const codes = [input.status, input.declared];
  if (codes.includes(413)) return "too_large";
  if (codes.includes(415)) return "unsupported_type";
  if (codes.includes(401)) return "session";
  if (TOO_LARGE_WORDS.some((word) => input.message.includes(word))) return "too_large";
  if (UNSUPPORTED_TYPE_WORDS.some((word) => input.message.includes(word))) return "unsupported_type";
  if (input.status === null && unanswered(input.record, input.error, input.message)) return "network";
  return "unknown";
}

function unanswered(record: UnknownRecord | null, error: unknown, message: string): boolean {
  // fetch's own failure, as the page sees it.
  if (error instanceof TypeError) return true;
  const name = typeof record?.name === "string" ? record.name : "";
  if (name === "TimeoutError" || name === "NetworkError") return true;
  // storage-js wraps fetch's failure and keeps it.
  if (record?.originalError instanceof TypeError) return true;
  // tus-js-client: a request went out and no response came back.
  if (record && "originalRequest" in record && !responseOf(record)) return true;
  if (message.trim() === SAFARI_NETWORK_MESSAGE) return true;
  return NETWORK_WORDS.some((word) => message.includes(word));
}

/** A limit as a person reads it, rounded down so it is never overstated. */
export function formatByteLimit(bytes: number): string {
  if (bytes >= GiB) {
    const tenths = Math.floor((bytes / GiB) * 10) / 10;
    return `${String(tenths).replace(".", ",")}${NBSP}ГБ`;
  }
  if (bytes >= MiB) return `${Math.floor(bytes / MiB)}${NBSP}МБ`;
  return `${Math.max(1, Math.floor(bytes / KiB))}${NBSP}КБ`;
}

/**
 * What the tile of a failed attachment says.
 *
 * It starts with the file, because a send can carry ten and only one failed;
 * then what the server said, in words; then the way out that is on the screen —
 * the tile keeps «Повторить» beside it. A number is never left at the end of a
 * line without its unit, and the dash never starts one.
 */
export function uploadFailureMessage(fileName: string, failure: UploadFailure): string {
  const subject = `${fileName.trim() || "Файл"}${NBSP}—`;
  switch (failure.reason) {
    case "too_large":
      return failure.limitBytes
        ? `${subject} файл больше, чем принимает сервер: до${NBSP}${formatByteLimit(failure.limitBytes)}.`
        : `${subject} файл больше, чем принимает сервер.`;
    case "unsupported_type":
      return `${subject} сервер не принимает файлы такого типа.`;
    case "network":
      return `${subject} не удалось загрузить: прервалась связь. Проверьте соединение и нажмите «Повторить».`;
    case "session":
      return `${subject} не удалось загрузить: сессия истекла. Войдите снова.`;
    default:
      return failure.status
        ? `${subject} сервер не принял файл, ошибка${NBSP}${failure.status}. Нажмите «Повторить».`
        : `${subject} не удалось загрузить. Нажмите «Повторить».`;
  }
}

/**
 * The notice a send shows when attachments in it fail.
 *
 * A tile has one truncated line for its state, and beside a size label that
 * line is next to nothing wide, so the reason is also said where it can be
 * read. One notice per send, replaced as failures add up: the count, and the
 * latest reason.
 */
export function uploadFailureFeedback(messages: readonly string[]): { title: string; detail: string } | null {
  if (!messages.length) return null;
  return {
    title: messages.length === 1 ? "Вложение не отправлено" : `Не отправлено вложений: ${messages.length}`,
    detail: messages[messages.length - 1],
  };
}
