import type { StagedAttachment, StagedAttachmentUpload } from "./stagedAttachments";
import { createElement } from "react";

const SEND_FAILED_MESSAGE = "Не удалось отправить сообщение.";
const ATTACHMENT_SIZE_LABEL = "50 МБ";
const VIDEO_ATTACHMENT_SIZE_LABEL = "250 МБ";

export interface StagedUploadScopeToken {
  readonly chatId: string;
  readonly generation: number;
}

export interface StagedUploadScope {
  activate(chatId: string): void;
  capture(): StagedUploadScopeToken;
  invalidate(): void;
  isActive(token: StagedUploadScopeToken): boolean;
}

export interface StagedUploadAbortHandle {
  abort(terminate?: boolean): Promise<void>;
}

export interface StagedUploadHandleRegistry {
  abort(attachmentId: string): Promise<void>;
  abortAll(): Promise<void>;
  has(attachmentId: string): boolean;
  register(attachmentId: string, handle: StagedUploadAbortHandle): void;
  release(attachmentId: string, handle: StagedUploadAbortHandle): void;
}

export interface MutableStagedAttachmentRef {
  current: StagedAttachment[];
}

export type StagedSendAttemptResult<T> =
  | { status: "sent"; value: T }
  | { status: "failed" }
  | { status: "stale" };

export type StagedPreparationResult<T> =
  | { status: "ready"; value: T }
  | { status: "stale" };

export function createStagedUploadScope(initialChatId: string): StagedUploadScope {
  let active = true;
  let chatId = initialChatId;
  let generation = 0;

  return {
    activate(nextChatId) {
      if (active && chatId === nextChatId) return;
      active = true;
      chatId = nextChatId;
      generation += 1;
    },
    capture() {
      return { chatId, generation };
    },
    invalidate() {
      if (!active) return;
      active = false;
      generation += 1;
    },
    isActive(token) {
      return active && token.chatId === chatId && token.generation === generation;
    },
  };
}

export function clearStagedAttachmentChat(
  scope: StagedUploadScope,
  stagedRef: MutableStagedAttachmentRef,
  abortActiveUploads: () => void = () => undefined,
): StagedAttachment[] {
  abortActiveUploads();
  scope.invalidate();
  const staleAttachments = stagedRef.current;
  stagedRef.current = [];
  return staleAttachments;
}

export function transitionStagedAttachmentChat(
  scope: StagedUploadScope,
  nextChatId: string,
  stagedRef: MutableStagedAttachmentRef,
  abortActiveUploads: () => void = () => undefined,
): StagedAttachment[] {
  const staleAttachments = clearStagedAttachmentChat(scope, stagedRef, abortActiveUploads);
  scope.activate(nextChatId);
  return staleAttachments;
}

export async function runScopedStagedPreparation<T>(
  scope: StagedUploadScope,
  token: StagedUploadScopeToken,
  prepare: () => Promise<T>,
): Promise<StagedPreparationResult<T>> {
  if (!scope.isActive(token)) return { status: "stale" };
  const value = await prepare();
  return scope.isActive(token) ? { status: "ready", value } : { status: "stale" };
}

export function commitPreparedStagedAttachments(
  scope: StagedUploadScope,
  token: StagedUploadScopeToken,
  attachments: StagedAttachment[],
  commit: (attachments: StagedAttachment[]) => void,
): boolean {
  if (!scope.isActive(token)) return false;
  commit(attachments);
  return true;
}

export function selectStagedAttachmentsForSend(
  attachments: StagedAttachment[],
  onlyAttachmentId?: string,
): StagedAttachment[] {
  return attachments.filter((attachment) => {
    if (onlyAttachmentId && attachment.id !== onlyAttachmentId) return false;
    return attachment.status !== "uploading" && attachment.status !== "sending";
  });
}

export function createStagedUploadHandleRegistry(): StagedUploadHandleRegistry {
  const handles = new Map<string, StagedUploadAbortHandle>();

  const terminate = async (handle: StagedUploadAbortHandle) => {
    try {
      await handle.abort(true);
    } catch {
      // Termination is best-effort and transport details stay private.
    }
  };

  return {
    async abort(attachmentId) {
      const handle = handles.get(attachmentId);
      if (!handle) return;
      handles.delete(attachmentId);
      await terminate(handle);
    },
    async abortAll() {
      const activeHandles = [...handles.values()];
      handles.clear();
      await Promise.all(activeHandles.map(terminate));
    },
    has(attachmentId) {
      return handles.has(attachmentId);
    },
    register(attachmentId, handle) {
      const current = handles.get(attachmentId);
      if (current && current !== handle) {
        throw new Error("attachment_upload_already_active");
      }
      handles.set(attachmentId, handle);
    },
    release(attachmentId, handle) {
      if (handles.get(attachmentId) === handle) handles.delete(attachmentId);
    },
  };
}

export async function runScopedStagedSendAttempt<T>(
  scope: StagedUploadScope,
  token: StagedUploadScopeToken,
  send: () => Promise<T | null | undefined | false>,
): Promise<StagedSendAttemptResult<T>> {
  if (!scope.isActive(token)) return { status: "stale" };
  try {
    const value = await send();
    if (!scope.isActive(token)) return { status: "stale" };
    return value ? { status: "sent", value } : { status: "failed" };
  } catch {
    return scope.isActive(token) ? { status: "failed" } : { status: "stale" };
  }
}

export function markStagedAttachmentSendFailed(
  attachment: StagedAttachment,
  uploaded: StagedAttachmentUpload | null,
): StagedAttachment {
  return {
    ...attachment,
    status: "failed",
    uploaded,
    error: SEND_FAILED_MESSAGE,
  };
}

export function getAttachmentUploadErrorMessage(
  error: unknown,
  kind: StagedAttachment["kind"],
): string {
  const status = typeof error === "object" && error
    ? String((error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode ?? "")
    : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const details = `${status} ${message}`.toLowerCase();
  if (
    details.includes("413") ||
    details.includes("payload") ||
    details.includes("too large") ||
    details.includes("file size") ||
    details.includes("size limit") ||
    details.includes("exceeded")
  ) {
    const maxLabel = kind === "video" || kind === "video_message"
      ? VIDEO_ATTACHMENT_SIZE_LABEL
      : ATTACHMENT_SIZE_LABEL;
    return `Файл слишком большой для загрузки. Максимум ${maxLabel}.`;
  }
  if (details.includes("network") || details.includes("fetch") || details.includes("timeout")) {
    return "Не удалось загрузить файл. Проверьте соединение и попробуйте снова.";
  }
  return "Не удалось загрузить файл. Попробуйте ещё раз.";
}

export function StagedAttachmentTransferProgress({ attachment }: { attachment: StagedAttachment }) {
  const progress = attachment.status === "uploading" && typeof attachment.progress === "number"
    ? Math.min(100, Math.max(0, Math.round(attachment.progress)))
    : null;

  const content = progress !== null
    ? createElement(
      "div",
      { className: "flex h-full items-center gap-2" },
      createElement(
        "div",
        {
          "data-testid": "staged-attachment-upload-progress",
          role: "progressbar",
          "aria-label": "Загрузка вложения",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": progress,
          className: "h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--kub-surface-3)]",
        },
        createElement("div", {
          className: "h-full rounded-full bg-[var(--kub-cyan)] transition-[width] duration-150",
          style: { width: `${progress}%` },
        }),
      ),
      createElement(
        "span",
        { className: "w-8 shrink-0 text-right text-[10px] tabular-nums text-[color:var(--kub-muted)]" },
        `${progress}%`,
      ),
    )
    : attachment.status === "sending"
      ? createElement(
        "div",
        {
          "data-testid": "staged-attachment-sending-progress",
          role: "progressbar",
          className: "flex h-full items-center",
          "aria-label": "Отправка вложения",
        },
        createElement(
          "div",
          { className: "h-1 w-full overflow-hidden rounded-full bg-[var(--kub-surface-3)]" },
          createElement("div", {
            className: "h-full w-2/3 animate-pulse rounded-full bg-[var(--kub-cyan)]",
          }),
        ),
      )
      : null;

  return createElement("div", { className: "mt-1 h-5", "aria-live": "polite" }, content);
}

export function VoicePlaybackProgress({ progress }: { progress: number }) {
  const percentage = Math.min(100, Math.max(0, Math.round(progress * 100)));
  return createElement(
    "div",
    {
      "data-testid": "staged-voice-playback-progress",
      role: "progressbar",
      "aria-label": "Прогресс голосового сообщения",
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": percentage,
      className: "mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--kub-surface-3)]",
    },
    createElement("div", {
      className: "h-full rounded-full bg-[var(--kub-cyan)]",
      style: { width: `${percentage}%` },
    }),
  );
}
