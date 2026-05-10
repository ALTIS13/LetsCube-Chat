"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent, ClipboardEvent } from "react";
import type { MessageWithSender } from "@/types/database";
import { cn } from "@/lib/utils";
import { VoiceRecorder } from "./VoiceRecorder";
import { useAppStore } from "@/store/app.store";
import { useMuteState } from "@/hooks/useMuteState";
import { KubIcon, type KubIconName } from "@/components/kub";
import { showAppAlert } from "@/lib/appDialogs";
import { formatReplyMessagePreview } from "@/lib/messagePreview";
import {
  formatAttachmentSize,
  normalizeClipboardFile,
  type StagedAttachment,
} from "@/lib/stagedAttachments";

const DRAFT_PREFIX = "kub:draft:";
const draftKey = (chatId: string) => `${DRAFT_PREFIX}${chatId}`;

const EMOJI_PANEL = [
  "😀","😂","🥰","😎","🤔","😭","🔥","❤️","👍","👏",
  "🎉","🚀","💯","✨","🙏","😅","🤣","😊","😍","🥳",
  "😤","🤯","😱","🤩","😴","🥺","😇","🤗","😏","😬",
];

interface MessageInputProps {
  chatId: string;
  replyTo: MessageWithSender | null;
  onCancelReply: () => void;
  onSend: (content: string) => void | boolean | Promise<unknown>;
  onEdit?: (messageId: string, newContent: string) => Promise<void>;
  onSendVoice?: (blob: Blob, durationMs: number, mimeType: string) => void | Promise<void>;
  onTyping?: () => void;
  attachments?: StagedAttachment[];
  onStageFiles?: (files: File[], source: "picker" | "paste") => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  onRetryAttachment?: (attachmentId: string) => void;
  onCancelAttachment?: (attachmentId: string) => void;
  draftOverride?: { id: string; text: string } | null;
  focusRequestKey?: number;
}

export function MessageInput({
  chatId,
  replyTo,
  onCancelReply,
  onSend,
  onEdit,
  onSendVoice,
  onTyping,
  attachments = [],
  onStageFiles,
  onRemoveAttachment,
  onRetryAttachment,
  onCancelAttachment,
  draftOverride,
  focusRequestKey = 0,
}: MessageInputProps) {
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const hasText = text.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const hasStagedVoice = attachments.some((item) => item.kind === "voice");
  const isAttachmentBusy = attachments.some((item) => item.status === "uploading" || item.status === "sending");
  const editingMessage = useAppStore((s) => s.editingMessage);
  const setEditingMessage = useAppStore((s) => s.setEditingMessage);
  const isEditing = editingMessage !== null && editingMessage.chat_id === chatId;
  const muteState = useMuteState(chatId);
  const preEditTextRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(draftKey(chatId));
    setText(saved ?? "");
    preEditTextRef.current = null;
    setEditingMessage(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isEditing) return;
    if (text) localStorage.setItem(draftKey(chatId), text);
    else localStorage.removeItem(draftKey(chatId));
  }, [text, chatId, isEditing]);

  useEffect(() => {
    if (!isEditing || !editingMessage) return;
    if (preEditTextRef.current === null) preEditTextRef.current = text;
    setText(editingMessage.content ?? "");
    setTimeout(() => textareaRef.current?.focus(), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMessage?.id]);

  useEffect(() => {
    if (!draftOverride) return;
    setEditingMessage(null);
    preEditTextRef.current = null;
    setText(draftOverride.text);
    setShowEmoji(false);
    setShowAttach(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [draftOverride, setEditingMessage]);

  useEffect(() => {
    if (!replyTo || isEditing) return;
    setShowEmoji(false);
    setShowAttach(false);
    setShowVoice(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [focusRequestKey, isEditing, replyTo]);

  const exitEditMode = useCallback(() => {
    setEditingMessage(null);
    setText(preEditTextRef.current ?? "");
    preEditTextRef.current = null;
  }, [setEditingMessage]);

  const stagePickedFiles = useCallback((fileList: FileList | null) => {
    if (!fileList?.length || !onStageFiles) return;
    onStageFiles(Array.from(fileList), "picker");
    setShowAttach(false);
  }, [onStageFiles]);

  const handleLocation = useCallback(() => {
    setShowAttach(false);
    if (!navigator.geolocation) { showAppAlert("Геолокация не поддерживается", "Геолокация"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        void onSend(`📍 Местоположение: https://maps.google.com/?q=${latitude},${longitude}`);
      },
      () => showAppAlert("Не удалось определить местоположение", "Геолокация")
    );
  }, [onSend]);

  const handleSend = useCallback(async () => {
    const currentText = textareaRef.current?.value ?? text;
    const trimmed = currentText.trim();
    if (!trimmed && !hasAttachments) return;
    if (isEditing && editingMessage && onEdit) {
      if (!trimmed) return;
      await onEdit(editingMessage.id, trimmed);
      setEditingMessage(null);
      setText(preEditTextRef.current ?? "");
      preEditTextRef.current = null;
    } else {
      const result = await onSend(trimmed);
      if (result === false) {
        textareaRef.current?.focus();
        return;
      }
      setText("");
      if (typeof window !== "undefined") localStorage.removeItem(draftKey(chatId));
    }
    setShowEmoji(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
  }, [text, hasAttachments, onSend, isEditing, editingMessage, onEdit, setEditingMessage, chatId]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      if (showEmoji || showAttach) {
        e.preventDefault();
        setShowEmoji(false);
        setShowAttach(false);
      } else if (!isEditing && replyTo) {
        e.preventDefault();
        onCancelReply();
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isComposing) {
      e.preventDefault();
      if (!isAttachmentBusy && (hasText || hasAttachments)) void handleSend();
      return;
    }
    onTyping?.();
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const data = event.clipboardData;
    if (!data || !onStageFiles || isEditing) return;
    const files: File[] = [];
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;
      files.push(normalizeClipboardFile(file));
    }
    if (!files.length) return;
    onStageFiles(files, "paste");
    setShowAttach(false);
    if (!data.getData("text/plain")) event.preventDefault();
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) { setText((t) => t + emoji); return; }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setText(text.slice(0, start) + emoji + text.slice(end));
    setTimeout(() => { el.selectionStart = el.selectionEnd = start + emoji.length; el.focus(); }, 0);
  };

  if (muteState.muted) {
    const expires = muteState.mute?.expires_at
      ? new Date(muteState.mute.expires_at).toLocaleString("ru-RU", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        })
      : null;
    return (
      <div className="flex-shrink-0 px-3 pb-3 pt-2 bg-[var(--kub-chat-bg)]">
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-[var(--kub-surface-2)] border border-[color:var(--kub-danger)]/30">
          <KubIcon name="muted" size={18} tone="danger" className="flex-shrink-0" />
          <div className="flex-1 min-w-0 text-xs">
            <div className="font-semibold text-[color:var(--kub-text)]">
              {muteState.scope === "global"
                ? "Вы лишены права отправлять сообщения"
                : "В этом чате вы заблокированы для отправки"}
            </div>
            <div className="truncate text-[color:var(--kub-muted)]">
              {muteState.mute?.reason ?? ""}
              {expires ? ` · до ${expires}` : " · бессрочно"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (showVoice) {
    return (
      <div className="flex-shrink-0 px-3 pb-3 pt-2 bg-[var(--kub-chat-bg)]">
        <VoiceRecorder
          onSend={async (blob, durMs, mime) => {
            try { await onSendVoice?.(blob, durMs, mime); }
            finally { setShowVoice(false); }
          }}
          onCancel={() => setShowVoice(false)}
        />
      </div>
    );
  }

  const attachItems: Array<{ icon: KubIconName; label: string; tone: string; action: () => void }> = [
    { icon: "image",   label: "Фото или видео", tone: "var(--kub-cyan)",   action: () => photoInputRef.current?.click() },
    { icon: "file",    label: "Файл",            tone: "var(--kub-pink)",   action: () => fileInputRef.current?.click() },
    { icon: "camera",  label: "Камера",          tone: "var(--kub-danger)", action: () => cameraInputRef.current?.click() },
    { icon: "voice",   label: "Голосовое",       tone: "var(--kub-cyan)",   action: () => {
      if (hasStagedVoice) {
        showAppAlert("Удалите текущую запись или используйте «Перезаписать».", "Голосовое сообщение");
        return;
      }
      setShowVoice(true);
      setShowAttach(false);
      setShowEmoji(false);
    } },
    { icon: "mapPin",  label: "Местоположение",  tone: "var(--kub-online)", action: handleLocation },
  ];

  return (
    <div className="flex-shrink-0 bg-[var(--kub-chat-bg)]">
      {showEmoji && (
        <div className="px-3 py-3 grid grid-cols-8 sm:grid-cols-10 gap-1 bg-[var(--kub-surface-2)] border-t border-[color:var(--kub-border-color)]">
          {EMOJI_PANEL.map((emoji) => (
            <button
              key={emoji}
              onClick={() => insertEmoji(emoji)}
              className="text-xl min-w-[40px] min-h-[40px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-lg hover:bg-[var(--kub-surface-3)] transition-all hover:scale-125 active:scale-95"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <input ref={photoInputRef} type="file" accept="image/*,video/*" multiple className="hidden"
        onChange={(e) => { stagePickedFiles(e.target.files); e.target.value = ""; }} />
      <input ref={fileInputRef} type="file" multiple className="hidden"
        onChange={(e) => { stagePickedFiles(e.target.files); e.target.value = ""; }} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { stagePickedFiles(e.target.files); e.target.value = ""; }} />

      {showAttach && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowAttach(false)} />
          <div className="mx-3 mb-2 rounded-2xl shadow-2xl relative z-20 overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] kub-glow-soft">
            {attachItems.map(({ icon, label, tone, action }) => (
              <button
                key={label}
                onClick={action}
                className="flex items-center gap-3 w-full px-4 py-3 text-sm transition-colors hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-text)]"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    background: `color-mix(in srgb, ${tone} 18%, transparent)`,
                    color: tone,
                  }}
                >
                  <KubIcon name={icon} size={15} tone="currentColor" />
                </div>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="px-3 pb-3 pt-2">
        {isEditing && editingMessage && (
          <div className="flex items-center gap-2 rounded-t-xl px-3 py-2 mb-1 bg-[var(--kub-surface-2)] border-l-2 border-[color:var(--kub-cyan)]">
            <KubIcon name="edit" size={13} tone="accent" className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--kub-cyan)]">Редактирование</div>
              <div className="text-xs truncate text-[color:var(--kub-muted)]">{editingMessage.content}</div>
            </div>
            <button
              onClick={exitEditMode}
              aria-label="Отменить редактирование"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-[var(--kub-surface-3)] flex-shrink-0 text-[color:var(--kub-muted)]"
            >
              <KubIcon name="close" size={16} />
            </button>
          </div>
        )}

        {!isEditing && replyTo && (
          <div className="flex items-center gap-2 rounded-t-xl px-3 py-2 mb-1 bg-[var(--kub-surface-2)] border-l-2 border-[color:var(--kub-cyan)]">
            <KubIcon name="reply" size={13} tone="accent" className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-[color:var(--kub-cyan)]">
                {replyTo.sender?.full_name ?? "Вы"}
              </div>
              <div className="text-xs truncate text-[color:var(--kub-muted)]">{formatReplyMessagePreview(replyTo)}</div>
            </div>
            <button
              onClick={onCancelReply}
              aria-label="Отменить ответ"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-[var(--kub-surface-3)] flex-shrink-0 text-[color:var(--kub-muted)]"
            >
              <KubIcon name="close" size={16} />
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <AttachmentTray
            attachments={attachments}
            onRemove={onRemoveAttachment}
            onRetry={onRetryAttachment}
            onCancel={onCancelAttachment}
            onRerecord={(attachmentId) => {
              onRemoveAttachment?.(attachmentId);
              setShowVoice(true);
              setShowAttach(false);
              setShowEmoji(false);
            }}
          />
        )}

        <div className="flex items-end gap-1 rounded-2xl px-2 py-1 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all">
          <button
            onClick={() => { setShowAttach(!showAttach); setShowEmoji(false); }}
            className={cn(
              "flex-shrink-0 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors hover:text-[color:var(--kub-cyan)]",
              showAttach ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)]"
            )}
            aria-label="Прикрепить"
          >
            <KubIcon name="attach" size={20} />
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder="Сообщение…"
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-base sm:text-sm leading-6 py-2 max-h-[140px] overflow-y-auto text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
          />

          <button
            onClick={() => { setShowEmoji(!showEmoji); setShowAttach(false); }}
            className={cn(
              "flex-shrink-0 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors hover:text-[color:var(--kub-cyan)]",
              showEmoji ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)]"
            )}
            aria-label="Эмодзи"
          >
            <KubIcon name="smile" size={20} />
          </button>

          <button
            onClick={(hasText || hasAttachments) ? handleSend : () => { setShowVoice(true); setShowEmoji(false); setShowAttach(false); }}
            disabled={isAttachmentBusy}
            className={cn(
              "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all",
              isAttachmentBusy
                ? "text-[color:var(--kub-muted)] opacity-60 cursor-not-allowed"
                : (hasText || hasAttachments)
                ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan hover:brightness-110"
                : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-3)]"
            )}
            aria-label={(hasText || hasAttachments) ? "Отправить" : "Записать голосовое"}
          >
            {isAttachmentBusy ? (
              <KubIcon name="spinner" size={18} className="animate-spin" />
            ) : (hasText || hasAttachments) ? (
              <KubIcon name="send" size={18} className="ml-0.5" />
            ) : (
              <KubIcon name="microphone" size={20} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function AttachmentTray({
  attachments,
  onRemove,
  onRetry,
  onCancel,
  onRerecord,
}: {
  attachments: StagedAttachment[];
  onRemove?: (attachmentId: string) => void;
  onRetry?: (attachmentId: string) => void;
  onCancel?: (attachmentId: string) => void;
  onRerecord?: (attachmentId: string) => void;
}) {
  return (
    <div className="mb-2 rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-2 py-2">
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {attachments.map((attachment) => {
          const busy = attachment.status === "uploading" || attachment.status === "sending";
          const failed = attachment.status === "failed";
          const isVoice = attachment.kind === "voice";
          return (
            <div
              key={attachment.id}
              className={cn(
                "relative flex min-w-[210px] shrink-0 items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-2",
                isVoice ? "max-w-[320px]" : "max-w-[260px]"
              )}
            >
              {isVoice ? (
                <VoiceAttachmentPreview attachment={attachment} busy={busy} failed={failed} />
              ) : (
                <>
                  <AttachmentThumb attachment={attachment} />
                  <div className="min-w-0 flex-1">
                    <AttachmentMeta attachment={attachment} busy={busy} failed={failed} />
                  </div>
                </>
              )}
              <div className="flex shrink-0 items-center gap-1">
                {isVoice && !busy && onRerecord && (
                  <button
                    type="button"
                    onClick={() => onRerecord(attachment.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-3)]"
                    aria-label="Перезаписать голосовое"
                    title="Перезаписать"
                  >
                    <KubIcon name="microphone" size={15} />
                  </button>
                )}
                {failed && onRetry && (
                  <button
                    type="button"
                    onClick={() => onRetry(attachment.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-3)]"
                    aria-label="Повторить отправку"
                    title="Повторить"
                  >
                    <KubIcon name="rotate" size={15} />
                  </button>
                )}
                {busy && onCancel ? (
                  <button
                    type="button"
                    onClick={() => onCancel(attachment.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-3)]"
                    aria-label="Отменить загрузку"
                    title="Отменить"
                  >
                    <KubIcon name="close" size={15} />
                  </button>
                ) : (
                  onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(attachment.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-3)]"
                      aria-label="Убрать вложение"
                      title="Убрать"
                    >
                      <KubIcon name="close" size={15} />
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttachmentThumb({ attachment }: { attachment: StagedAttachment }) {
  const icon = attachment.kind === "image"
    ? "image"
    : attachment.kind === "video"
    ? "video"
    : attachment.kind === "audio" || attachment.kind === "voice"
    ? "voice"
    : "file";

  if (attachment.kind === "image" && attachment.previewUrl) {
    return (
      <img
        src={attachment.previewUrl}
        alt=""
        className="h-12 w-12 shrink-0 rounded-lg object-cover"
        draggable={false}
      />
    );
  }

  if (attachment.kind === "video" && attachment.previewUrl) {
    return (
      <video
        src={attachment.previewUrl}
        className="h-12 w-12 shrink-0 rounded-lg object-cover"
        muted
        playsInline
      />
    );
  }

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--kub-surface-3)] text-[color:var(--kub-cyan)]">
      <KubIcon name={icon} size={19} />
    </div>
  );
}

function AttachmentMeta({
  attachment,
  busy,
  failed,
}: {
  attachment: StagedAttachment;
  busy: boolean;
  failed: boolean;
}) {
  return (
    <>
      <div className="truncate text-xs font-medium text-[color:var(--kub-text)]">
        {attachment.name}
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-[color:var(--kub-muted)]">
        <span className="shrink-0">{formatAttachmentSize(attachment.size)}</span>
        <span className="shrink-0">·</span>
        <span className={cn("truncate", failed && "text-[color:var(--kub-danger)]")}>
          {attachment.error ?? attachmentStatusLabel(attachment.status)}
        </span>
      </div>
      {busy && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--kub-surface-3)]">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-[var(--kub-cyan)]" />
        </div>
      )}
    </>
  );
}

function VoiceAttachmentPreview({
  attachment,
  busy,
  failed,
}: {
  attachment: StagedAttachment;
  busy: boolean;
  failed: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const durationMs = attachment.durationMs ?? 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sync = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationMs / 1000;
      setProgress(duration > 0 ? Math.min(1, audio.currentTime / duration) : 0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const finish = () => {
      setPlaying(false);
      setProgress(0);
    };
    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("ended", finish);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", sync);
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
    };
  }, [durationMs, attachment.previewUrl]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !attachment.previewUrl) return;
    if (playing) {
      audio.pause();
      return;
    }
    void audio.play().catch(() => setPlaying(false));
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <audio ref={audioRef} src={attachment.previewUrl ?? undefined} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        disabled={!attachment.previewUrl || busy}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={playing ? "Пауза предпросмотра" : "Прослушать голосовое"}
      >
        <KubIcon name={playing ? "pause" : "play"} size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-[color:var(--kub-text)]">Голосовое</span>
          <span className="shrink-0 text-[11px] tabular-nums text-[color:var(--kub-muted)]">
            {formatDurationLabel(durationMs)}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--kub-surface-3)]">
          <div
            className={cn("h-full rounded-full bg-[var(--kub-cyan)]", busy && "w-2/3 animate-pulse")}
            style={busy ? undefined : { width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className={cn("mt-1 truncate text-[11px] text-[color:var(--kub-muted)]", failed && "text-[color:var(--kub-danger)]")}>
          {attachment.error ?? attachmentStatusLabel(attachment.status)}
        </div>
      </div>
    </div>
  );
}

function attachmentStatusLabel(status: StagedAttachment["status"]): string {
  if (status === "uploading") return "Загрузка…";
  if (status === "sending") return "Отправка…";
  if (status === "failed") return "Ошибка";
  if (status === "cancelled") return "Отменено";
  return "Готово к отправке";
}

function formatDurationLabel(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSec / 60).toString();
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
