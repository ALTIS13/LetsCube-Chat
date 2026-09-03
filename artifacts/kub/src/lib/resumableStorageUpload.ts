import { Upload } from "tus-js-client";
import { cacheControlFor } from "@/lib/mediaCacheControl";

export const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 6 * 1024 * 1024;
export const RESUMABLE_UPLOAD_CHUNK_BYTES = 6 * 1024 * 1024;
export const RESUMABLE_UPLOAD_RETRY_DELAYS = [0, 3000, 5000, 10000, 20000] as const;

const AUTH_UNAVAILABLE_MESSAGE = "Сессия истекла. Войдите снова.";
const UPLOAD_FAILED_MESSAGE = "Не удалось загрузить файл. Повторите попытку.";
const UPLOAD_ABORTED_MESSAGE = "Загрузка отменена.";

export type ResumableStorageUploadErrorCode =
  | "auth_unavailable"
  | "upload_failed"
  | "upload_aborted";

export class ResumableStorageUploadError extends Error {
  readonly code: ResumableStorageUploadErrorCode;

  constructor(code: ResumableStorageUploadErrorCode, message: string) {
    super(message);
    this.name = "ResumableStorageUploadError";
    this.code = code;
  }
}

export interface ResumableTusPreviousUpload {
  uploadUrl?: string | null;
  metadata?: Record<string, string>;
}

export interface ResumableTusUploadOptions {
  endpoint: string;
  retryDelays: number[];
  headers: Record<string, string>;
  uploadDataDuringCreation: boolean;
  removeFingerprintOnSuccess: boolean;
  metadata: Record<string, string>;
  chunkSize: number;
  onError(error: Error): void;
  onProgress(bytesUploaded: number, bytesTotal: number): void;
  onSuccess(payload?: unknown): void;
}

export interface ResumableTusUpload {
  findPreviousUploads(): Promise<ResumableTusPreviousUpload[]>;
  resumeFromPreviousUpload(previousUpload: ResumableTusPreviousUpload): void;
  start(): void;
  abort(terminate?: boolean): Promise<void>;
}

export type ResumableTusUploadFactory = (
  file: File,
  options: ResumableTusUploadOptions,
) => ResumableTusUpload;

export interface ResumableStorageSupabaseClient {
  auth: {
    getSession(): Promise<{
      data: { session: { access_token: string } | null };
      error: unknown;
    }>;
  };
}

export interface StartResumableStorageUploadOptions {
  supabaseClient: ResumableStorageSupabaseClient;
  supabaseUrl: string;
  file: File;
  bucketName: string;
  objectName: string;
  contentType: string;
  onProgress?: (percentage: number) => void;
  uploadFactory?: ResumableTusUploadFactory;
}

export interface ResumableStorageUploadHandle {
  result: Promise<{ path: string }>;
  abort(terminate?: boolean): Promise<void>;
}

/**
 * What makes a previous upload the *same* upload.
 *
 * Deliberately not every metadata field. Matching on all of them once meant
 * that changing `cacheControl` — a header preference that says nothing about
 * which bytes these are — orphaned every half-finished upload in the world:
 * the fingerprint on disk still held the old value, no candidate matched, and
 * a large file that was nearly done started again from zero. Found when the
 * cache lifetimes changed and this stopped resuming.
 *
 * These three are what identify a destination: which bucket, which object, and
 * what kind of file. Anything else is how it should be served once it arrives.
 */
const RESUME_IDENTITY_KEYS = ["bucketName", "objectName", "contentType"] as const;

export function shouldUseResumableUpload(fileSize: number): boolean {
  return fileSize > RESUMABLE_UPLOAD_THRESHOLD_BYTES;
}

export function buildResumableUploadEndpoint(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/upload/resumable`;
}

export function normalizeUploadProgress(bytesUploaded: number, bytesTotal: number): number {
  if (!Number.isFinite(bytesUploaded) || !Number.isFinite(bytesTotal) || bytesTotal <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((bytesUploaded / bytesTotal) * 100)));
}

export function startResumableStorageUpload(
  options: StartResumableStorageUploadOptions,
): ResumableStorageUploadHandle {
  let upload: ResumableTusUpload | null = null;
  let settled = false;
  let aborted = false;

  let resolveResult: (value: { path: string }) => void = () => undefined;
  let rejectResult: (reason: ResumableStorageUploadError) => void = () => undefined;
  const result = new Promise<{ path: string }>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const settleFailure = (code: ResumableStorageUploadErrorCode, message: string) => {
    if (settled) return;
    settled = true;
    rejectResult(new ResumableStorageUploadError(code, message));
  };

  const initialize = async () => {
    try {
      const { data, error } = await options.supabaseClient.auth.getSession();
      if (error || !data.session?.access_token) {
        settleFailure("auth_unavailable", AUTH_UNAVAILABLE_MESSAGE);
        return;
      }
      if (aborted) return;

      const uploadOptions: ResumableTusUploadOptions = {
        endpoint: buildResumableUploadEndpoint(options.supabaseUrl),
        retryDelays: [...RESUMABLE_UPLOAD_RETRY_DELAYS],
        headers: {
          authorization: `Bearer ${data.session.access_token}`,
          "x-upsert": "false",
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: options.bucketName,
          objectName: options.objectName,
          contentType: options.contentType,
          cacheControl: cacheControlFor(options.objectName),
        },
        chunkSize: RESUMABLE_UPLOAD_CHUNK_BYTES,
        onError: () => {
          settleFailure("upload_failed", UPLOAD_FAILED_MESSAGE);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          if (!settled) {
            options.onProgress?.(normalizeUploadProgress(bytesUploaded, bytesTotal));
          }
        },
        onSuccess: () => {
          if (settled) return;
          settled = true;
          resolveResult({ path: options.objectName });
        },
      };

      const uploadFactory = options.uploadFactory ?? defaultUploadFactory;
      upload = uploadFactory(options.file, uploadOptions);
      const previousUploads = await upload.findPreviousUploads();
      if (aborted || settled) return;
      const previousUpload = previousUploads.find((candidate) =>
        RESUME_IDENTITY_KEYS.every(
          (key) => candidate.metadata?.[key] === uploadOptions.metadata[key],
        ),
      );
      if (previousUpload) {
        upload.resumeFromPreviousUpload(previousUpload);
      }
      upload.start();
    } catch {
      settleFailure("upload_failed", UPLOAD_FAILED_MESSAGE);
    }
  };

  void initialize();

  return {
    result,
    async abort(terminate = false) {
      if (settled) return;
      aborted = true;
      try {
        await upload?.abort(terminate);
        settleFailure("upload_aborted", UPLOAD_ABORTED_MESSAGE);
      } catch {
        settleFailure("upload_failed", UPLOAD_FAILED_MESSAGE);
      }
    },
  };
}

function defaultUploadFactory(file: File, options: ResumableTusUploadOptions): ResumableTusUpload {
  return new Upload(file, options) as ResumableTusUpload;
}
