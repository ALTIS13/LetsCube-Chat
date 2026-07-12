import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildResumableUploadEndpoint,
  normalizeUploadProgress,
  RESUMABLE_UPLOAD_CHUNK_BYTES,
  RESUMABLE_UPLOAD_RETRY_DELAYS,
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  type ResumableTusUpload,
  type ResumableTusUploadOptions,
  shouldUseResumableUpload,
  startResumableStorageUpload,
} from "../../artifacts/kub/src/lib/resumableStorageUpload";
import {
  chatAttachmentUploadPath,
  type StagedAttachment,
} from "../../artifacts/kub/src/lib/stagedAttachments";

const FILE_SIZE = RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1;

test.describe("resumable media upload contracts", () => {
  test("uses TUS only above the exact 6 MiB boundary", () => {
    expect(RESUMABLE_UPLOAD_THRESHOLD_BYTES).toBe(6 * 1024 * 1024);
    expect(RESUMABLE_UPLOAD_CHUNK_BYTES).toBe(6 * 1024 * 1024);
    expect(RESUMABLE_UPLOAD_RETRY_DELAYS).toEqual([0, 3000, 5000, 10000, 20000]);
    expect(shouldUseResumableUpload(RESUMABLE_UPLOAD_THRESHOLD_BYTES)).toBe(false);
    expect(shouldUseResumableUpload(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1)).toBe(true);
  });

  test("normalizes the configured Supabase URL into the TUS endpoint", () => {
    expect(buildResumableUploadEndpoint("https://project.supabase.co")).toBe(
      "https://project.supabase.co/storage/v1/upload/resumable",
    );
    expect(buildResumableUploadEndpoint("https://project.supabase.co///")).toBe(
      "https://project.supabase.co/storage/v1/upload/resumable",
    );
  });

  test("clamps upload progress to an integer percentage", () => {
    expect(normalizeUploadProgress(1, 3)).toBe(33);
    expect(normalizeUploadProgress(-20, 100)).toBe(0);
    expect(normalizeUploadProgress(120, 100)).toBe(100);
    expect(normalizeUploadProgress(50, 0)).toBe(0);
  });

  test("builds a stable attachment path with the user as the first segment", () => {
    const attachment = attachmentStub();
    const first = chatAttachmentUploadPath("chat-123", "user-456", attachment);
    const second = chatAttachmentUploadPath("chat-123", "user-456", attachment);

    expect(first).toBe("user-456/chat-123-attachment-789.mp4");
    expect(second).toBe(first);
  });

  test("configures TUS and resumes the first compatible previous upload before starting", async () => {
    const previousUploads = [
      {
        uploadUrl: "previous-one",
        metadata: {
          bucketName: "media",
          objectName: "user-456/another-object.mp4",
          contentType: "video/mp4",
          cacheControl: "3600",
        },
      },
      {
        uploadUrl: "previous-two",
        metadata: {
          bucketName: "media",
          objectName: "user-456/chat-123-attachment-789.mp4",
          contentType: "video/mp4",
          cacheControl: "3600",
        },
      },
    ];
    const harness = createUploadHarness({ previousUploads });
    const handle = startResumableStorageUpload(harness.adapterOptions());

    await harness.started;

    expect(harness.events).toEqual(["find", "resume:previous-two", "start"]);
    expect(harness.options).toMatchObject({
      endpoint: "https://project.supabase.co/storage/v1/upload/resumable",
      retryDelays: [0, 3000, 5000, 10000, 20000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: "Bearer access-token",
        "x-upsert": "false",
      },
      metadata: {
        bucketName: "media",
        objectName: "user-456/chat-123-attachment-789.mp4",
        contentType: "video/mp4",
        cacheControl: "3600",
      },
    });
    expect(harness.getSessionCalls).toBe(1);

    harness.options?.onSuccess?.({} as never);
    await expect(handle.result).resolves.toEqual({
      path: "user-456/chat-123-attachment-789.mp4",
    });
  });

  test("forwards normalized progress to the caller", async () => {
    const progress: number[] = [];
    const harness = createUploadHarness();
    const handle = startResumableStorageUpload({
      ...harness.adapterOptions(),
      onProgress: (percentage) => progress.push(percentage),
    });

    await harness.started;
    harness.options?.onProgress?.(FILE_SIZE / 2, FILE_SIZE);
    harness.options?.onProgress?.(FILE_SIZE * 2, FILE_SIZE);
    harness.options?.onSuccess?.({} as never);

    await handle.result;
    expect(progress).toEqual([50, 100]);
  });

  test("resolves the stable object path after a successful upload", async () => {
    const harness = createUploadHarness({ succeedOnStart: true });
    const handle = startResumableStorageUpload(harness.adapterOptions());

    await expect(handle.result).resolves.toEqual({
      path: "user-456/chat-123-attachment-789.mp4",
    });
  });

  test("rejects final failures with a bounded error that drops sensitive details", async () => {
    const harness = createUploadHarness();
    const handle = startResumableStorageUpload(harness.adapterOptions());
    const rawFailure = new Error(
      "PATCH https://project.supabase.co/storage/v1/upload/resumable/private response-body-secret",
    );

    await harness.started;
    harness.options?.onError?.(rawFailure);
    const error = await handle.result.catch((failure: unknown) => failure);

    expect(error).toMatchObject({
      name: "ResumableStorageUploadError",
      code: "upload_failed",
      message: "Не удалось загрузить файл. Повторите попытку.",
    });
    expect(String(error)).not.toContain("project.supabase.co");
    expect(String(error)).not.toContain("response-body-secret");
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });

  test("terminates the remote partial upload when abort requests termination", async () => {
    const harness = createUploadHarness();
    const handle = startResumableStorageUpload(harness.adapterOptions());

    await harness.started;
    const resultFailure = handle.result.catch((failure: unknown) => failure);
    await handle.abort(true);

    expect(harness.abortCalls).toEqual([true]);
    await expect(resultFailure).resolves.toMatchObject({
      name: "ResumableStorageUploadError",
      code: "upload_aborted",
    });
  });

  test("renders determinate upload progress and keeps sending indeterminate", async () => {
    const { StagedAttachmentTransferProgress } = await loadStagedUploadWorkflow();
    const uploading = attachmentStub({ status: "uploading", progress: 42 });
    const sending = attachmentStub({ status: "sending", progress: 100 });

    const uploadingMarkup = renderToStaticMarkup(
      createElement(StagedAttachmentTransferProgress, { attachment: uploading }),
    );
    const sendingMarkup = renderToStaticMarkup(
      createElement(StagedAttachmentTransferProgress, { attachment: sending }),
    );

    expect(uploadingMarkup).toContain('role="progressbar"');
    expect(uploadingMarkup).toContain('aria-valuenow="42"');
    expect(uploadingMarkup).toContain('style="width:42%"');
    expect(uploadingMarkup).toContain("42%");
    expect(sendingMarkup).toContain('data-testid="staged-attachment-sending-progress"');
    expect(sendingMarkup).not.toContain("aria-valuenow");
  });

  test("terminates registered uploads and releases only the matching handle", async () => {
    const { createStagedUploadHandleRegistry } = await loadStagedUploadWorkflow();
    const registry = createStagedUploadHandleRegistry();
    const abortCalls: boolean[] = [];
    const firstHandle = { abort: async (terminate = false) => { abortCalls.push(terminate); } };
    const secondHandle = { abort: async (terminate = false) => { abortCalls.push(terminate); } };

    registry.register("attachment-1", firstHandle);
    registry.release("attachment-1", secondHandle);
    expect(registry.has("attachment-1")).toBe(true);

    await registry.abort("attachment-1");
    expect(abortCalls).toEqual([true]);
    expect(registry.has("attachment-1")).toBe(false);

    registry.register("attachment-2", secondHandle);
    await registry.abortAll();
    expect(abortCalls).toEqual([true, true]);
    expect(registry.has("attachment-2")).toBe(false);
  });

  test("invalidates an old chat scope before a completed upload can create a message", async () => {
    const { createStagedUploadScope, runScopedStagedSendAttempt } = await loadStagedUploadWorkflow();
    const scope = createStagedUploadScope("chat-a");
    const token = scope.capture();
    let resolveUpload: (() => void) | undefined;
    const upload = new Promise<void>((resolve) => { resolveUpload = resolve; });
    let sendCalls = 0;
    const completion = (async () => {
      await upload;
      return runScopedStagedSendAttempt(scope, token, async () => {
        sendCalls += 1;
        return { id: "message-1" };
      });
    })();

    scope.invalidate();
    scope.activate("chat-b");
    resolveUpload?.();

    await expect(completion).resolves.toEqual({ status: "stale" });
    expect(sendCalls).toBe(0);
  });

  test("clears old staged attachments before activating the next chat scope", async () => {
    const {
      createStagedUploadScope,
      selectStagedAttachmentsForSend,
      transitionStagedAttachmentChat,
    } = await loadStagedUploadWorkflow();
    const baseScope = createStagedUploadScope("chat-a");
    const oldToken = baseScope.capture();
    const events: string[] = [];
    const scope = {
      activate(chatId: string) {
        events.push(`activate:${chatId}`);
        baseScope.activate(chatId);
      },
      capture: () => baseScope.capture(),
      invalidate() {
        events.push("invalidate");
        baseScope.invalidate();
      },
      isActive: (token: typeof oldToken) => baseScope.isActive(token),
    };
    let current = [attachmentStub({
      status: "failed",
      uploaded: {
        bucket: "media",
        path: "user/chat-a-attachment.mp4",
        publicUrl: "https://example.invalid/old.mp4",
      },
    })];
    const stagedRef = {
      get current() {
        return current;
      },
      set current(value: StagedAttachment[]) {
        events.push("clear");
        current = value;
      },
    };

    const staleAttachments = transitionStagedAttachmentChat(
      scope,
      "chat-b",
      stagedRef,
      () => events.push("abort"),
    );
    const newToken = scope.capture();

    expect(events).toEqual(["abort", "invalidate", "clear", "activate:chat-b"]);
    expect(staleAttachments).toHaveLength(1);
    expect(stagedRef.current).toEqual([]);
    expect(scope.isActive(oldToken)).toBe(false);
    expect(scope.isActive(newToken)).toBe(true);
    expect(selectStagedAttachmentsForSend(stagedRef.current)).toEqual([]);
  });

  test("drops file preparation that completes after its chat scope changes", async () => {
    const {
      commitPreparedStagedAttachments,
      createStagedUploadScope,
      runScopedStagedPreparation,
    } = await loadStagedUploadWorkflow();
    const scope = createStagedUploadScope("chat-a");
    const token = scope.capture();
    let resolvePreparation: ((file: File) => void) | undefined;
    const preparation = new Promise<File>((resolve) => { resolvePreparation = resolve; });
    const prepared = runScopedStagedPreparation(scope, token, () => preparation);
    const staged: StagedAttachment[] = [];

    scope.invalidate();
    scope.activate("chat-b");
    resolvePreparation?.(fileStub());

    const result = await prepared;
    const committed = result.status === "ready"
      ? commitPreparedStagedAttachments(scope, token, [attachmentStub()], (attachments) => {
        staged.push(...attachments);
      })
      : false;

    expect(result).toEqual({ status: "stale" });
    expect(committed).toBe(false);
    expect(staged).toEqual([]);
  });

  test("converts rejected attachment sends into a friendly failed staged state", async () => {
    const {
      createStagedUploadScope,
      markStagedAttachmentSendFailed,
      runScopedStagedSendAttempt,
    } = await loadStagedUploadWorkflow();
    const scope = createStagedUploadScope("chat-a");
    const token = scope.capture();
    const uploaded = {
      bucket: "media",
      path: "user/chat-attachment.mp4",
      publicUrl: "https://example.invalid/media.mp4",
    };

    const result = await runScopedStagedSendAttempt(scope, token, async () => {
      throw new Error("raw backend rejection");
    });
    const failed = markStagedAttachmentSendFailed(
      attachmentStub({ status: "sending", progress: 100, uploaded }),
      uploaded,
    );

    expect(result).toEqual({ status: "failed" });
    expect(failed).toMatchObject({
      status: "failed",
      progress: 100,
      uploaded,
      error: "Не удалось отправить сообщение.",
    });
    expect(failed.error).not.toContain("raw backend rejection");
  });

  test("keeps voice playback progress separate from one sending indicator", async () => {
    const {
      StagedAttachmentTransferProgress,
      VoicePlaybackProgress,
    } = await loadStagedUploadWorkflow();
    const markup = renderToStaticMarkup(createElement(
      "div",
      null,
      createElement(VoicePlaybackProgress, { progress: 0.25 }),
      createElement(StagedAttachmentTransferProgress, {
        attachment: attachmentStub({ kind: "voice", status: "sending", progress: 100 }),
      }),
    ));

    expect(markup).toContain('data-testid="staged-voice-playback-progress"');
    expect(markup).toContain('aria-valuenow="25"');
    expect(markup).toContain('data-testid="staged-attachment-sending-progress"');
    expect(markup.match(/animate-pulse/g)).toHaveLength(1);
  });
});

interface HarnessOptions {
  previousUploads?: Array<{
    uploadUrl: string;
    metadata?: Record<string, string>;
  }>;
  succeedOnStart?: boolean;
}

function createUploadHarness(options: HarnessOptions = {}) {
  let resolveStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const events: string[] = [];
  const abortCalls: boolean[] = [];
  let capturedOptions: ResumableTusUploadOptions | undefined;
  let getSessionCalls = 0;

  const uploadFactory = (
    _file: File,
    uploadOptions: ResumableTusUploadOptions,
  ): ResumableTusUpload => {
    capturedOptions = uploadOptions;
    return {
      async findPreviousUploads() {
        events.push("find");
        return options.previousUploads ?? [];
      },
      resumeFromPreviousUpload(previousUpload) {
        events.push(`resume:${(previousUpload as { uploadUrl: string }).uploadUrl}`);
      },
      start() {
        events.push("start");
        resolveStarted?.();
        if (options.succeedOnStart) uploadOptions.onSuccess?.({} as never);
      },
      async abort(terminate = false) {
        abortCalls.push(terminate);
      },
    };
  };

  return {
    abortCalls,
    adapterOptions: () => ({
      supabaseClient: {
        auth: {
          async getSession() {
            getSessionCalls += 1;
            return {
              data: { session: { access_token: "access-token" } },
              error: null,
            };
          },
        },
      },
      supabaseUrl: "https://project.supabase.co///",
      file: fileStub(),
      bucketName: "media",
      objectName: "user-456/chat-123-attachment-789.mp4",
      contentType: "video/mp4",
      uploadFactory,
    }),
    events,
    get getSessionCalls() {
      return getSessionCalls;
    },
    get options() {
      return capturedOptions;
    },
    started,
  };
}

function attachmentStub(overrides: Partial<StagedAttachment> = {}): StagedAttachment {
  return {
    id: "attachment-789",
    file: fileStub(),
    kind: "video",
    previewUrl: null,
    name: "clip.mp4",
    size: FILE_SIZE,
    mimeType: "video/mp4",
    status: "staged",
    progress: null,
    error: null,
    clientMessageId: "client-message-123",
    uploaded: null,
    ...overrides,
  };
}

function loadStagedUploadWorkflow() {
  return import("../../artifacts/kub/src/lib/stagedUploadWorkflow");
}

function fileStub(): File {
  return {
    name: "clip.mp4",
    size: FILE_SIZE,
    type: "video/mp4",
    lastModified: 0,
  } as File;
}
