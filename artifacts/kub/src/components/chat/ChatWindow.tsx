"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, type CSSProperties, type DragEvent } from "react";
import { ChatHeader } from "./ChatHeader";
import { PinnedMessage } from "./PinnedMessage";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ChatSearchBar } from "./ChatSearchBar";
import { ChatInfoPanel } from "./ChatInfoPanel";
import { ForwardModal } from "./ForwardModal";
import { MediaViewer, type MediaViewerItem } from "./MediaViewer";
import { TopicStrip } from "./TopicStrip";
import { useTopics } from "@/hooks/useTopics";
import { useMessages } from "@/hooks/useMessages";
import { useAppStore } from "@/store/app.store";
import { createClient } from "@/lib/supabase/client";
import { KubEmptyState, KubIcon } from "@/components/kub";
import { showAppAlert } from "@/lib/appDialogs";
import { KUB_CHAT_MESSAGE_JUMP_EVENT, type ChatMessageJumpDetail } from "@/lib/chatJumpEvents";
import { isSavedChat } from "@/lib/chatDisplay";
import { bumpMount, bumpUnmount } from "@/lib/dev/instrumentation";
import {
  CHAT_MEDIA_BUCKET,
  MAX_STAGED_ATTACHMENTS,
  chatAttachmentUploadPath,
  createStagedAttachment,
  createStagedVideoMessageAttachment,
  createStagedVoiceAttachment,
  revokeAttachmentPreview,
  validateStagedAttachment,
  type StagedAttachment,
  type StagedAttachmentUpload,
} from "@/lib/stagedAttachments";
import type { Json, MessageWithSender } from "@/types/database";

interface ChatWindowProps {
  chatId: string;
}

const EMPTY_GENERAL_TOPIC_IDS: string[] = [];

export function ChatWindow({ chatId }: ChatWindowProps) {
  // Dev-only mount/unmount счётчик. Должен скакать только при смене чата
  // (новый key={chatId} в родителе), не при heartbeat-эхо (Task #48).
  useEffect(() => {
    bumpMount("ChatWindow");
    return () => bumpUnmount("ChatWindow");
  }, []);
  const chats = useAppStore((s) => s.chats);
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const markChatRead = useAppStore((s) => s.markChatRead);
  const setEditingMessage = useAppStore((s) => s.setEditingMessage);
  const setForwardingMessage = useAppStore((s) => s.setForwardingMessage);
  const forwardingMessage = useAppStore((s) => s.forwardingMessage);
  const selectedTopicId = useAppStore((s) => s.selectedTopicId);
  const chatPanelRequest = useAppStore((s) => s.chatPanelRequest);
  const clearChatPanelRequest = useAppStore((s) => s.clearChatPanelRequest);
  const chat = chats.find((c) => c.id === chatId);
  const savedChat = chat ? isSavedChat(chat, userId) : false;
  const isForum = !!chat?.is_forum;
  const { topics, createTopic } = useTopics(chatId, isForum);
  const generalTopicIds = useMemo(
    () => topics.filter((topic) => topic.is_general).map((topic) => topic.id),
    [topics],
  );
  const messageTopicId = isForum ? selectedTopicId : undefined;
  const messageGeneralTopicIds = isForum ? generalTopicIds : EMPTY_GENERAL_TOPIC_IDS;
  const {
    messages, pinnedMessages, pinnedReady, loading, loadingOlder, hasMoreOlder, olderError, isTyping,
    sendMessage, sendMediaMessage, sendTyping, toggleReaction,
    retryMessageSend, discardLocalMessage,
    editMessage, deleteMessage, hideMessageForMe, hideMessagesForMe, togglePin, forwardMessage, clearChatForMe,
    loadOlderMessages, ensureMessageLoaded,
  } = useMessages(chatId, messageTopicId, messageGeneralTopicIds);

  useEffect(() => { markChatRead(chatId); }, [chatId, markChatRead]);

  const [replyTo, setReplyTo] = useState<MessageWithSender | null>(null);
  const [replyFocusKey, setReplyFocusKey] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [openMedia, setOpenMedia] = useState<MediaViewerItem | null>(null);
  const [draftRestore, setDraftRestore] = useState<{ id: string; text: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement>>({});
  const pendingJumpRef = useRef<string | null>(null);
  const supabase = createClient();
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [composerHeight, setComposerHeight] = useState(0);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const stagedAttachmentsRef = useRef<StagedAttachment[]>([]);
  const cancelledAttachmentIdsRef = useRef<Set<string>>(new Set());
  const dragDepthRef = useRef(0);
  const [draggingFiles, setDraggingFiles] = useState(false);

  useEffect(() => {
    stagedAttachmentsRef.current = stagedAttachments;
  }, [stagedAttachments]);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const updateKeyboardInset = () => {
      const mobile = window.innerWidth < 768;
      const composerHasFocus = Boolean(composerRef.current?.contains(document.activeElement));
      if (!mobile || !visualViewport || !isComposerFocused || !composerHasFocus) {
        setKeyboardInset(0);
        return;
      }
      const rawInset = Math.max(0, Math.round(window.innerHeight - visualViewport.height - visualViewport.offsetTop));
      setKeyboardInset(rawInset > 80 ? rawInset : 0);
    };

    updateKeyboardInset();
    visualViewport?.addEventListener("resize", updateKeyboardInset);
    visualViewport?.addEventListener("scroll", updateKeyboardInset);
    window.addEventListener("resize", updateKeyboardInset);
    window.addEventListener("orientationchange", updateKeyboardInset);
    return () => {
      visualViewport?.removeEventListener("resize", updateKeyboardInset);
      visualViewport?.removeEventListener("scroll", updateKeyboardInset);
      window.removeEventListener("resize", updateKeyboardInset);
      window.removeEventListener("orientationchange", updateKeyboardInset);
    };
  }, [isComposerFocused]);

  const measureComposerHeight = useCallback(() => {
    const node = composerRef.current;
    const nextHeight = node ? Math.ceil(node.getBoundingClientRect().height) : 0;
    setComposerHeight((current) => current === nextHeight ? current : nextHeight);
  }, []);

  useLayoutEffect(() => {
    measureComposerHeight();
    const node = composerRef.current;
    if (!node) return;

    let frame = window.requestAnimationFrame(measureComposerHeight);
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(measureComposerHeight);
      })
      : null;

    observer?.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [measureComposerHeight, chatId]);

  useLayoutEffect(() => {
    measureComposerHeight();
  }, [
    measureComposerHeight,
    keyboardInset,
    stagedAttachments.length,
    replyTo?.id,
    draftRestore?.id,
  ]);

  useEffect(() => {
    setStagedAttachments((current) => {
      current.forEach(revokeAttachmentPreview);
      return [];
    });
    cancelledAttachmentIdsRef.current.clear();
    setDraggingFiles(false);
    dragDepthRef.current = 0;
    return () => {
      stagedAttachmentsRef.current.forEach(revokeAttachmentPreview);
      cancelledAttachmentIdsRef.current.clear();
    };
  }, [chatId]);

  useEffect(() => {
    if (!chatPanelRequest || chatPanelRequest.chatId !== chatId) return;
    if (chatPanelRequest.panel === "info") setShowInfo(true);
    if (chatPanelRequest.panel === "search") setShowSearch(true);
    clearChatPanelRequest(chatPanelRequest.key);
  }, [chatId, chatPanelRequest, clearChatPanelRequest]);

  const myRole = (chat?.members?.find((m) => m.user_id === userId)?.role ?? null) as
    | "owner" | "admin" | "member" | null;
  const canManageTopics = myRole === "owner" || myRole === "admin";

  const updateStagedAttachment = useCallback((
    attachmentId: string,
    updater: (attachment: StagedAttachment) => StagedAttachment,
  ) => {
    setStagedAttachments((current) => current.map((attachment) =>
      attachment.id === attachmentId ? updater(attachment) : attachment
    ));
  }, []);

  const removeStagedAttachment = useCallback((attachmentId: string) => {
    cancelledAttachmentIdsRef.current.add(attachmentId);
    setStagedAttachments((current) => {
      const target = current.find((attachment) => attachment.id === attachmentId);
      if (target) revokeAttachmentPreview(target);
      return current.filter((attachment) => attachment.id !== attachmentId);
    });
  }, []);

  const cancelStagedAttachment = useCallback((attachmentId: string) => {
    cancelledAttachmentIdsRef.current.add(attachmentId);
    removeStagedAttachment(attachmentId);
  }, [removeStagedAttachment]);

  const stageFiles = useCallback((files: File[], _source: "picker" | "paste" | "drop" | "camera") => {
    if (!files.length) return;
    const existingCount = stagedAttachmentsRef.current.length;
    const availableSlots = Math.max(0, MAX_STAGED_ATTACHMENTS - existingCount);
    const accepted: StagedAttachment[] = [];
    const errors: string[] = [];

    if (!availableSlots) {
      showAppAlert(`Можно подготовить не больше ${MAX_STAGED_ATTACHMENTS} вложений за раз.`, "Вложения");
      return;
    }

    for (const file of files.slice(0, availableSlots)) {
      const error = validateStagedAttachment(file);
      if (error) {
        errors.push(`${file.name || "Файл"}: ${error}`);
        continue;
      }
      accepted.push(createStagedAttachment(file));
    }

    if (files.length > availableSlots) {
      errors.push(`Добавлено ${availableSlots} из ${files.length}: максимум ${MAX_STAGED_ATTACHMENTS} вложений за раз.`);
    }

    if (accepted.length) {
      setStagedAttachments((current) => [...current, ...accepted]);
    }
    if (errors.length) {
      showAppAlert(errors.slice(0, 3).join("\n"), "Вложения");
    }
  }, []);

  const stageVoiceRecording = useCallback((blob: Blob, durationMs: number, mimeType: string) => {
    const error = validateStagedAttachment(new File([blob], "voice.webm", { type: mimeType || blob.type || "audio/webm" }));
    if (error) {
      showAppAlert(error, "Голосовое сообщение");
      return;
    }
    const currentVoice = stagedAttachmentsRef.current.find((attachment) => attachment.kind === "voice");
    if (currentVoice) removeStagedAttachment(currentVoice.id);
    if (!currentVoice && stagedAttachmentsRef.current.length >= MAX_STAGED_ATTACHMENTS) {
      showAppAlert(`Можно подготовить не больше ${MAX_STAGED_ATTACHMENTS} вложений за раз.`, "Голосовое сообщение");
      return;
    }
    setStagedAttachments((current) => [...current, createStagedVoiceAttachment(blob, durationMs, mimeType)]);
  }, [removeStagedAttachment]);

  const stageVideoMessageRecording = useCallback((blob: Blob, durationMs: number, mimeType: string) => {
    const error = validateStagedAttachment(new File([blob], "video-message.webm", { type: mimeType || blob.type || "video/webm" }));
    if (error) {
      showAppAlert(error, "Видео-сообщение");
      return;
    }
    const currentVideoMessage = stagedAttachmentsRef.current.find((attachment) => attachment.kind === "video_message");
    if (currentVideoMessage) removeStagedAttachment(currentVideoMessage.id);
    if (!currentVideoMessage && stagedAttachmentsRef.current.length >= MAX_STAGED_ATTACHMENTS) {
      showAppAlert(`Можно подготовить не больше ${MAX_STAGED_ATTACHMENTS} вложений за раз.`, "Видео-сообщение");
      return;
    }
    setStagedAttachments((current) => [...current, createStagedVideoMessageAttachment(blob, durationMs, mimeType)]);
  }, [removeStagedAttachment]);

  const uploadStagedAttachment = useCallback(async (attachment: StagedAttachment): Promise<StagedAttachmentUpload> => {
    if (!userId) throw new Error("auth");
    const path = chatAttachmentUploadPath(chatId, userId, attachment);
    const { data, error } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(path, attachment.file, {
        contentType: attachment.mimeType || attachment.file.type || "application/octet-stream",
        upsert: false,
      });
    if (error || !data) throw error ?? new Error("upload_failed");
    const { data: publicData } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(data.path);
    return {
      bucket: CHAT_MEDIA_BUCKET,
      path: data.path,
      publicUrl: publicData.publicUrl,
    };
  }, [chatId, supabase, userId]);

  const sendStagedAttachments = useCallback(async (caption: string, onlyAttachmentId?: string): Promise<boolean> => {
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять файлы.", "Вложения");
      return false;
    }

    const captionText = caption.trim();
    const targets = stagedAttachmentsRef.current.filter((attachment) => {
      if (onlyAttachmentId && attachment.id !== onlyAttachmentId) return false;
      return attachment.status !== "uploading" && attachment.status !== "sending";
    });
    if (!targets.length) return false;

    let sentAny = false;
    const firstTarget = targets[0];
    if (captionText && (firstTarget?.kind === "voice" || firstTarget?.kind === "video_message")) {
      const textMessage = await sendMessage(captionText, replyTo?.id ?? undefined);
      if (!textMessage) return false;
      sentAny = true;
    }

    for (const attachment of targets) {
      if (cancelledAttachmentIdsRef.current.has(attachment.id)) continue;
      updateStagedAttachment(attachment.id, (current) => ({
        ...current,
        status: "uploading",
        progress: null,
        error: null,
      }));

      let uploaded: StagedAttachmentUpload | null = attachment.uploaded;
      if (!uploaded) {
        try {
          uploaded = await uploadStagedAttachment(attachment);
        } catch (error) {
          console.warn("[attachments] upload failed:", error);
          updateStagedAttachment(attachment.id, (current) => ({
            ...current,
            status: "failed",
            error: "Не удалось загрузить файл.",
          }));
          return sentAny;
        }
      }

      if (cancelledAttachmentIdsRef.current.has(attachment.id)) continue;

      updateStagedAttachment(attachment.id, (current) => ({
        ...current,
        status: "sending",
        uploaded,
        error: null,
      }));

      const content = getStagedAttachmentMessageContent(attachment, sentAny || !captionText ? null : captionText);
      const message = await sendMediaMessage({
        type: getStagedAttachmentMessageType(attachment),
        content,
        mediaUrl: uploaded.publicUrl,
        replyToId: replyTo?.id ?? null,
        clientMessageId: attachment.clientMessageId,
        mediaMetadata: getStagedAttachmentMediaMetadata(attachment),
      });

      if (!message) {
        updateStagedAttachment(attachment.id, (current) => ({
          ...current,
          status: "failed",
          uploaded,
          error: "Не удалось отправить сообщение.",
        }));
        return sentAny;
      }

      sentAny = true;
      removeStagedAttachment(attachment.id);
    }

    if (sentAny) setReplyTo(null);
    return sentAny;
  }, [replyTo?.id, removeStagedAttachment, sendMediaMessage, sendMessage, updateStagedAttachment, uploadStagedAttachment, userId]);

  const retryStagedAttachment = useCallback((attachmentId: string) => {
    void sendStagedAttachments("", attachmentId);
  }, [sendStagedAttachments]);

  const handleSend = async (content: string) => {
    if (stagedAttachmentsRef.current.length) {
      return sendStagedAttachments(content);
    }
    const replyToId = replyTo?.id;
    await sendMessage(content, replyToId);
    setReplyTo(null);
    return true;
  };

  const handleReply = useCallback((msg: MessageWithSender) => {
    setReplyTo(msg);
    setReplyFocusKey((key) => key + 1);
  }, []);

  const handleSendVoice = useCallback(async (blob: Blob, durationMs: number, mimeType: string) => {
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять голосовые сообщения.", "Голосовое сообщение");
      return;
    }
    if (!blob || blob.size === 0 || durationMs < 1000) {
      showAppAlert("Запись слишком короткая или пустая.", "Голосовое сообщение");
      return;
    }
    stageVoiceRecording(blob, durationMs, mimeType);
  }, [stageVoiceRecording, userId]);

  const handleSendVideoMessage = useCallback(async (blob: Blob, durationMs: number, mimeType: string) => {
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять видео-сообщения.", "Видео-сообщение");
      return;
    }
    if (!blob || blob.size === 0 || durationMs < 500) {
      showAppAlert("Запись слишком короткая или пустая.", "Видео-сообщение");
      return;
    }
    stageVideoMessageRecording(blob, durationMs, mimeType);
  }, [stageVideoMessageRecording, userId]);

  const showJumpNotice = useCallback((message: string) => {
    setPinError(message);
    window.setTimeout(() => setPinError(null), 4000);
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = messageRefs.current[messageId];
    if (!el) return false;
    setHighlightedId(messageId);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setHighlightedId(null), 2000);
    return true;
  }, []);

  const jumpToMessage = useCallback((messageId: string) => {
    if (!scrollToMessage(messageId)) showJumpNotice("Сообщение пока не загружено.");
  }, [scrollToMessage, showJumpNotice]);

  const handleJumpToReply = useCallback(async (messageId: string) => {
    const localTarget = messages.find((message) => message.id === messageId);
    if (localTarget?.deleted_at) {
      showJumpNotice("Исходное сообщение недоступно.");
      return;
    }
    if (scrollToMessage(messageId)) return;
    const result = await ensureMessageLoaded(messageId);
    if (!result.ok || result.message.deleted_at) {
      const message =
        !result.ok && result.reason === "topic"
          ? "Сообщение находится в другом топике."
          : "Исходное сообщение недоступно.";
      showJumpNotice(message);
      return;
    }
    pendingJumpRef.current = messageId;
    requestAnimationFrame(() => {
      if (scrollToMessage(messageId)) pendingJumpRef.current = null;
    });
  }, [ensureMessageLoaded, messages, scrollToMessage, showJumpNotice]);

  useEffect(() => {
    const handleGlobalJump = (event: Event) => {
      const detail = (event as CustomEvent<ChatMessageJumpDetail>).detail;
      if (!detail || detail.chatId !== chatId) return;
      void handleJumpToReply(detail.messageId);
    };

    window.addEventListener(KUB_CHAT_MESSAGE_JUMP_EVENT, handleGlobalJump);
    return () => window.removeEventListener(KUB_CHAT_MESSAGE_JUMP_EVENT, handleGlobalJump);
  }, [chatId, handleJumpToReply]);

  useEffect(() => {
    const pendingId = pendingJumpRef.current;
    if (!pendingId) return;
    if (scrollToMessage(pendingId)) pendingJumpRef.current = null;
  }, [messages, scrollToMessage]);

  const handleJumpToPinned = useCallback((msg: MessageWithSender) => {
    const el = messageRefs.current[msg.id];
    if (!el) return showJumpNotice("Сообщение пока не загружено.");
    jumpToMessage(msg.id);
  }, [jumpToMessage, showJumpNotice]);

  const handleTogglePin = useCallback(async (msg: MessageWithSender) => {
    setPinError(null);
    const result = await togglePin(msg.id, msg.pinned);
    if (!result.ok) {
      setPinError(result.error ?? "Недостаточно прав для закрепления сообщения.");
      window.setTimeout(() => setPinError(null), 5000);
    }
  }, [togglePin]);

  const handleHideForMe = useCallback(async (msg: MessageWithSender) => {
    const result = await hideMessageForMe(msg.id);
    if (!result.ok) {
      showAppAlert(result.error ?? "Не удалось скрыть сообщение.", "Ошибка");
    }
  }, [hideMessageForMe]);

  const handleBulkHideForMe = useCallback(async (items: MessageWithSender[]) => {
    const result = await hideMessagesForMe(items.map((item) => item.id));
    if (!result.ok) {
      throw new Error(result.error ?? "Не удалось скрыть выбранные сообщения.");
    }
  }, [hideMessagesForMe]);

  const handleBulkDeleteForEveryone = useCallback(async (items: MessageWithSender[]) => {
    const failures: string[] = [];
    for (const item of items) {
      const result = await deleteMessage(item.id);
      if (!result?.ok) failures.push(result?.error ?? "Не удалось удалить сообщение.");
    }
    if (failures.length) {
      throw new Error(`Не удалось удалить ${failures.length} из ${items.length} сообщений.`);
    }
  }, [deleteMessage]);

  const handleEditFailedSend = useCallback((msg: MessageWithSender) => {
    if (msg.type !== "text") return;
    discardLocalMessage(msg.id);
    setDraftRestore({ id: `${msg.id}:${Date.now()}`, text: msg.content ?? "" });
  }, [discardLocalMessage]);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length) stageFiles(files, "drop");
  }, [stageFiles]);

  const messageListBottomInset = 0;

  return (
    <div
      className="relative flex h-full w-full min-w-0 overflow-hidden bg-[var(--kub-chat-bg)]"
      style={{
        "--kub-keyboard-inset": `${keyboardInset}px`,
        "--kub-composer-height": `${composerHeight}px`,
        "--kub-message-list-bottom-inset": `${messageListBottomInset}px`,
      } as CSSProperties}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {draggingFiles && (
        <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-3xl border-2 border-dashed border-[color:var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-bg)_76%,var(--kub-cyan)_10%)] shadow-2xl">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-5 py-4 text-center">
            <KubIcon name="attach" size={28} tone="accent" />
            <div className="text-sm font-semibold text-[color:var(--kub-text)]">Отпустите, чтобы добавить вложения</div>
            <div className="text-xs text-[color:var(--kub-muted)]">Файлы будут загружены только после отправки.</div>
          </div>
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ChatHeader
          chatId={chatId}
          chat={chat}
          onSearchOpen={() => setShowSearch(true)}
          onInfoOpen={() => setShowInfo(true)}
          onClearForMe={clearChatForMe}
        />

        {isForum && (
          <TopicStrip
            topics={topics}
            canManage={canManageTopics}
            onCreate={createTopic}
          />
        )}

        {showSearch && (
          <ChatSearchBar
            messages={messages}
            onClose={() => setShowSearch(false)}
            onJumpTo={jumpToMessage}
          />
        )}

        {pinError && (
          <div className="mx-3 mt-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
            {pinError}
          </div>
        )}

        {pinnedReady && pinnedMessages.length > 0 && (
          <PinnedMessage
            messages={pinnedMessages}
            onJump={handleJumpToPinned}
            onUnpin={userId ? (msg) => void handleTogglePin(msg) : undefined}
          />
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center chat-bg">
            <KubIcon name="spinner" size={28} className="text-[color:var(--kub-cyan)]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center chat-bg">
            <KubEmptyState
              icon={<KubIcon name="chatRect" size={24} />}
              title="Сообщений пока нет"
              description="Поздоровайтесь и начните разговор."
            />
          </div>
        ) : (
          <MessageList
            messages={messages}
            onReply={handleReply}
            onJumpToReply={handleJumpToReply}
            onReaction={toggleReaction}
            onEdit={(msg) => setEditingMessage(msg)}
            onDelete={(msg) => deleteMessage(msg.id)}
            onHideForMe={handleHideForMe}
            onBulkHideForMe={handleBulkHideForMe}
            onBulkDeleteForEveryone={savedChat ? undefined : handleBulkDeleteForEveryone}
            onTogglePin={userId ? handleTogglePin : undefined}
            onForward={(msg) => setForwardingMessage(msg)}
            onRetrySend={(msg) => void retryMessageSend(msg)}
            onEditFailedSend={handleEditFailedSend}
            onDiscardLocalMessage={(msg) => discardLocalMessage(msg.id)}
            onOpenMedia={setOpenMedia}
            bottomRef={bottomRef}
            isTyping={isTyping}
            highlightedId={highlightedId}
            messageRefs={messageRefs}
            chatMembers={chat?.members}
            chatType={chat?.type}
            isSavedChat={savedChat}
            myRole={myRole}
            onLoadOlder={loadOlderMessages}
            hasMoreOlder={hasMoreOlder}
            loadingOlder={loadingOlder}
            olderError={olderError}
            bottomInset={messageListBottomInset}
            layoutKey={chatId}
            layoutVersion={composerHeight}
          />
        )}

        <div
          ref={composerRef}
          className="shrink-0 transition-[padding-bottom] duration-150 ease-out"
          style={{ paddingBottom: "calc(var(--kub-keyboard-inset, 0px) + env(safe-area-inset-bottom))" }}
        >
          <MessageInput
            chatId={chatId}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onSend={handleSend}
            onEdit={editMessage}
            onSendVoice={handleSendVoice}
            onSendVideoMessage={handleSendVideoMessage}
            onTyping={sendTyping}
            attachments={stagedAttachments}
            onStageFiles={(files, source) => stageFiles(files, source)}
            onRemoveAttachment={removeStagedAttachment}
            onRetryAttachment={retryStagedAttachment}
            onCancelAttachment={cancelStagedAttachment}
            draftOverride={draftRestore}
            focusRequestKey={replyFocusKey}
            onFocusChange={setIsComposerFocused}
          />
        </div>
      </div>
      {showInfo && chat && (
        <ChatInfoPanel chat={chat} onClose={() => setShowInfo(false)} onClearForMe={clearChatForMe} />
      )}
      {forwardingMessage && (
        <ForwardModal
          message={forwardingMessage}
          onClose={() => setForwardingMessage(null)}
          onForward={async (targetChatId) => {
            await forwardMessage(forwardingMessage, targetChatId);
            setForwardingMessage(null);
          }}
        />
      )}
      <MediaViewer media={openMedia} onClose={() => setOpenMedia(null)} />
    </div>
  );
}

function hasDraggedFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes("Files");
}

function filesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files ?? []).filter((file) => file instanceof File);
}

function getStagedAttachmentMessageType(attachment: StagedAttachment): "image" | "video" | "audio" | "file" {
  if (attachment.kind === "voice") return "audio";
  if (attachment.kind === "video_message") return "video";
  if (attachment.kind === "image" || attachment.kind === "video" || attachment.kind === "audio") return attachment.kind;
  return "file";
}

function getStagedAttachmentMessageContent(attachment: StagedAttachment, caption: string | null): string {
  if (attachment.kind === "voice") {
    return `🎤 Голосовое сообщение (${formatVoiceDurationLabel(attachment.durationMs ?? 0)})`;
  }
  if (attachment.kind === "video_message") {
    return `Видео-сообщение (${formatVoiceDurationLabel(attachment.durationMs ?? 0)})`;
  }
  return caption?.trim() || attachment.name;
}

function getStagedAttachmentMediaMetadata(attachment: StagedAttachment): Json | null | undefined {
  if (attachment.kind === "video_message") {
    return {
      kind: "video_message",
      shape: "round",
      duration_ms: attachment.durationMs ?? null,
      mime_type: attachment.mimeType,
    };
  }
  return undefined;
}

function formatVoiceDurationLabel(durationMs: number): string {
  const totalSec = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
