import { expect, test } from "@playwright/test";
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

function attachmentStub(): StagedAttachment {
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
  };
}

function fileStub(): File {
  return {
    name: "clip.mp4",
    size: FILE_SIZE,
    type: "video/mp4",
    lastModified: 0,
  } as File;
}
