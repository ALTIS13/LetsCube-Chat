import assert from "node:assert/strict";
import test from "node:test";

import {
  TUS_MAX_SIZE_HEADER,
  describeUploadFailure,
  formatByteLimit,
  parseByteCount,
  uploadFailureFeedback,
  uploadFailureMessage,
} from "../../artifacts/kub/src/lib/uploadFailure.ts";

/**
 * D-113: a video did not send and nothing said why. The status is now kept
 * from the server's own answer, the limit is shown only when the server stated
 * it, and the message names the file. The browser half is
 * `tests/e2e/media-send-path.spec.ts`.
 */

const NBSP = String.fromCharCode(0xa0);
const MiB = 1024 * 1024;

/** tus-js-client's `DetailedError`, as `onError` receives it. Its text carries the URL, digits and all. */
function tusError(status: number | null, headers: Record<string, string> = {}) {
  const error = new Error(
    `tus: unexpected response while uploading chunk, originated from request (method: PATCH, url: https://core.example.invalid/storage/v1/upload/resumable/41304134, response code: ${status ?? "n/a"}, response text: n/a, request id: n/a)`,
  );
  return Object.assign(error, {
    originalRequest: { getMethod: () => "PATCH" },
    originalResponse: status === null
      ? null
      : {
        getStatus: () => status,
        getHeader: (name: string) => headers[name],
        getBody: () => "",
      },
    causingError: status === null ? new Error("xhr failed") : null,
  });
}

/** storage-js's `StorageApiError`: the HTTP status, and the code its body declared. */
function storageError(status: number, statusCode: string, message: string) {
  return Object.assign(new Error(message), { name: "StorageApiError", status, statusCode, __isStorageError: true });
}

test("a tus refusal keeps its status, and a limit only when the server stated one", () => {
  assert.deepEqual(
    describeUploadFailure(tusError(413, { [TUS_MAX_SIZE_HEADER]: "52428800" })),
    { reason: "too_large", status: 413, limitBytes: 52_428_800 },
  );
  assert.deepEqual(describeUploadFailure(tusError(413)), { reason: "too_large", status: 413, limitBytes: null });
  assert.deepEqual(describeUploadFailure(tusError(415)), { reason: "unsupported_type", status: 415, limitBytes: null });
  assert.deepEqual(describeUploadFailure(tusError(401)), { reason: "session", status: 401, limitBytes: null });
  assert.deepEqual(describeUploadFailure(tusError(null)), { reason: "network", status: null, limitBytes: null });

  // The URL in its text holds «413» twice over. A 500 is still a 500.
  assert.deepEqual(describeUploadFailure(tusError(500)), { reason: "unknown", status: 500, limitBytes: null });

  assert.equal(describeUploadFailure(tusError(413, { [TUS_MAX_SIZE_HEADER]: "lots" })).limitBytes, null, "a header that is not a number is no limit");
  const unreadable = Object.assign(new Error("x"), {
    originalRequest: {},
    originalResponse: { getStatus: () => { throw new Error("gone"); } },
  });
  assert.deepEqual(describeUploadFailure(unreadable), { reason: "unknown", status: null, limitBytes: null });
});

test("storage-js: its status, and the 413 a 400 body declared", () => {
  assert.deepEqual(
    describeUploadFailure(storageError(413, "413", "The object exceeded the maximum allowed size")),
    { reason: "too_large", status: 413, limitBytes: null },
  );
  // How storage-api has answered a size refusal: HTTP 400 with 413 in its body.
  assert.deepEqual(
    describeUploadFailure(storageError(400, "413", "The object exceeded the maximum allowed size")),
    { reason: "too_large", status: 400, limitBytes: null },
  );
  assert.deepEqual(
    describeUploadFailure(storageError(400, "InvalidMimeType", "mime type image/heic is not supported")),
    { reason: "unsupported_type", status: 400, limitBytes: null },
  );
  assert.deepEqual(describeUploadFailure(storageError(415, "415", "Unsupported Media Type")), { reason: "unsupported_type", status: 415, limitBytes: null });
  assert.deepEqual(
    describeUploadFailure(storageError(403, "403", "new row violates row-level security policy")),
    { reason: "unknown", status: 403, limitBytes: null },
  );

  // storage-js wraps fetch's own failure and keeps it; Safari calls it «Load failed».
  const wrapped = Object.assign(new Error("Failed to fetch"), { name: "StorageUnknownError", originalError: new TypeError("Failed to fetch") });
  assert.deepEqual(describeUploadFailure(wrapped), { reason: "network", status: null, limitBytes: null });
  assert.equal(describeUploadFailure(new TypeError("Load failed")).reason, "network");
  assert.equal(describeUploadFailure(Object.assign(new Error("signal timed out"), { name: "TimeoutError" })).reason, "network");
});

test("digits in a message are never read as a status, and words are read only when nothing else says", () => {
  assert.equal(describeUploadFailure(new Error("upload failed for u1/c1-413a5b.webp")).reason, "unknown");
  assert.equal(describeUploadFailure("payload too large").reason, "too_large");
  assert.equal(describeUploadFailure(new Error("Maximum size exceeded")).reason, "too_large");
  assert.equal(describeUploadFailure(null).reason, "unknown");
  assert.equal(describeUploadFailure(undefined).reason, "unknown");
  assert.deepEqual(describeUploadFailure({ status: 413 }), { reason: "too_large", status: 413, limitBytes: null });
});

test("the resumable wrapper's own error is read back as it was kept, and a malformed one is not trusted", () => {
  const kept = Object.assign(new Error("Не удалось загрузить файл. Повторите попытку."), {
    name: "ResumableStorageUploadError",
    code: "upload_failed",
    reason: "too_large",
    status: 413,
    limitBytes: 262_144_000,
  });
  assert.deepEqual(describeUploadFailure(kept), { reason: "too_large", status: 413, limitBytes: 262_144_000 });
  assert.deepEqual(
    describeUploadFailure({ reason: "session", status: null, limitBytes: null }),
    { reason: "session", status: null, limitBytes: null },
  );
  assert.deepEqual(describeUploadFailure({ reason: "too_large", status: "big", limitBytes: null }), { reason: "unknown", status: null, limitBytes: null });
  assert.deepEqual(describeUploadFailure({ reason: "made_up", status: 413, limitBytes: null }), { reason: "too_large", status: 413, limitBytes: null });
});

test("the message names the file, says what the server said, and never guesses a limit", () => {
  const video = "IMG_0042.MOV";
  const refused = uploadFailureMessage(video, { reason: "too_large", status: 413, limitBytes: null });
  assert.ok(refused.startsWith(`${video}${NBSP}—`), refused);
  assert.ok(!refused.includes("МБ"), `the server stated no limit, so none is printed: ${refused}`);

  const stated = uploadFailureMessage(video, { reason: "too_large", status: 413, limitBytes: 50 * MiB });
  assert.ok(stated.includes(`до${NBSP}50${NBSP}МБ`), stated);
  assert.ok(!stated.includes("250"), stated);

  const type = uploadFailureMessage("IMG_0043.HEIC", { reason: "unsupported_type", status: 415, limitBytes: null });
  assert.ok(type.startsWith(`IMG_0043.HEIC${NBSP}—`) && type.includes("типа"), type);

  const offline = uploadFailureMessage("facade.png", { reason: "network", status: null, limitBytes: null });
  assert.ok(offline.includes("соединение") && offline.includes("«Повторить»"), offline);

  const session = uploadFailureMessage("facade.png", { reason: "session", status: null, limitBytes: null });
  assert.ok(session.includes("сессия"), session);

  const server = uploadFailureMessage("facade.png", { reason: "unknown", status: 503, limitBytes: null });
  assert.ok(server.includes(`ошибка${NBSP}503`) && server.includes("«Повторить»"), server);

  const bare = uploadFailureMessage("   ", { reason: "unknown", status: null, limitBytes: null });
  assert.ok(bare.startsWith(`Файл${NBSP}—`), bare);

  // The product's typography: a number keeps its unit, a dash never starts a
  // line, and «до» is never left at the end of one.
  for (const message of [refused, stated, type, offline, session, server, bare]) {
    assert.ok(!message.includes(" —"), `a dash can start a line: ${message}`);
    assert.ok(!message.includes(" МБ"), `a number can lose its unit: ${message}`);
    assert.ok(!message.includes(" до "), `«до» can be left at the end of a line: ${message}`);
  }
});

test("a limit reads rounded down, and a byte count is only a positive whole number", () => {
  assert.equal(formatByteLimit(50 * MiB), `50${NBSP}МБ`);
  assert.equal(formatByteLimit(262_144_000), `250${NBSP}МБ`);
  assert.equal(formatByteLimit(50 * MiB - 1), `49${NBSP}МБ`, "never overstated");
  assert.equal(formatByteLimit(5 * 1024 * MiB), `5${NBSP}ГБ`);
  assert.equal(formatByteLimit(1.5 * 1024 * MiB), `1,5${NBSP}ГБ`);
  assert.equal(formatByteLimit(512 * 1024), `512${NBSP}КБ`);

  assert.equal(parseByteCount("52428800"), 52_428_800);
  assert.equal(parseByteCount(" 1024 "), 1024);
  assert.equal(parseByteCount(4096), 4096);
  for (const bad of ["", "0", "-5", "1e9", "12.5", "lots", null, undefined, 0, -1, 1.5, Number.NaN]) {
    assert.equal(parseByteCount(bad), null, String(bad));
  }
});

test("one notice per send: the count of what failed, and the latest reason", () => {
  assert.equal(uploadFailureFeedback([]), null);
  assert.deepEqual(uploadFailureFeedback(["a.png — x."]), { title: "Вложение не отправлено", detail: "a.png — x." });
  assert.deepEqual(uploadFailureFeedback(["a.png — x.", "b.mov — y."]), { title: "Не отправлено вложений: 2", detail: "b.mov — y." });
});
