"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, type CSSProperties, type DragEvent } from "react";
import { ChatHeader } from "./ChatHeader";
import { PinnedMessage } from "./PinnedMessage";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ChatSearchBar } from "./ChatSearchBar";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChatInfoPanel } from "./ChatInfoPanel";
import { ChatSelectionBar } from "./ChatSelectionBar";
import { ForwardModal } from "./ForwardModal";
import { MessageDeleteDialogHost, copySelectedMessages, useChatMessageSelection } from "./MessageSelectionChrome";
import { MediaViewer, type MediaViewerItem } from "./MediaViewer";
import { ChatMediaPlaybackBar, ChatMediaPlaybackProvider, type ChatMediaPlaybackItem } from "./ChatMediaPlayback";
import { TopicStrip } from "./TopicStrip";
import { useTopics } from "@/hooks/useTopics";
import { useMessages } from "@/hooks/useMessages";
import { useMessageMediaVariantUrls, type MessageMediaVariantUrls } from "@/hooks/useMediaVariants";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { useAppStore } from "@/store/app.store";
import { createClient, getSupabasePublicUrl } from "@/lib/supabase/client";
import { KubEmptyState, KubIcon } from "@/components/kub";
import { showAppAlert } from "@/lib/appDialogs";
import { showActionFeedback } from "@/lib/actionFeedback";
import { mapPgError } from "@/lib/errors";
import { visibleConversation } from "@/lib/deletedMessages";
import { readTimesLoader } from "@/hooks/useMessageReadTimes";
import { forwardFeedback } from "@/lib/messageForward";
import { KUB_CHAT_MESSAGE_JUMP_EVENT, requestChatMessageJump, type ChatMessageJumpDetail } from "@/lib/chatJumpEvents";
import { getChatDisplayInfo, isSavedChat } from "@/lib/chatDisplay";
import { reportError } from "@/lib/monitoring";
import { messageActorDisplayName, resolveMessageActor } from "@/lib/messageActor";
// One copy of "is this a voice note / a round video", shared with the profile
// card's shared-media sections. A second copy drifts, and then playback and the
// gallery disagree about the same row.
import { isRoundVideoMessageContent, isVoiceMessageContent } from "@/lib/messageMediaSections";
import { bumpMount, bumpUnmount } from "@/lib/dev/instrumentation";
import {
  DEFAULT_MEDIA_QUALITY,
  DEFAULT_PHOTO_SEND_QUALITY,
  selectVideoPlaybackUrl,
  type MediaQuality,
} from "@/lib/mediaQuality";
import { prepareChatImageAttachment, prepareOriginalPreview, readMediaDimensions, type MediaDimensions } from "@/lib/mediaUpload";
import {
  buildAttachmentMediaMetadata,
  originalLimitMessage,
  originalPreviewDimensions,
  originalPreviewPath,
  planAttachmentPreparation,
  shouldBuildOriginalPreview,
  type IncomingFilesSource,
} from "@/lib/mediaCompression";
import { removeLocation } from "@/lib/mediaLocation";
import { useIncomingMediaFiles } from "@/hooks/useIncomingMediaFiles";
import type { AttachSendRequest } from "@/lib/attachSheet";
import { recordingMinimumMs } from "@/lib/recordingGesture";
import {
  CHAT_MEDIA_BUCKET,
  MAX_STAGED_ATTACHMENTS,
  chatAttachmentUploadPath,
  createStagedAttachment,
  createStagedVideoMessageAttachment,
  createStagedVoiceAttachment,
  revokeAttachmentPreview,
  stagedAttachmentTextContent,
  validateStagedAttachment,
  type StagedAttachment,
  type StagedAttachmentUpload,
} from "@/lib/stagedAttachments";
import {
  shouldUseResumableUpload,
  startResumableStorageUpload,
} from "@/lib/resumableStorageUpload";
import {
  createStagedUploadHandleRegistry,
  createStagedUploadScope,
  clearStagedAttachmentChat,
  commitPreparedStagedAttachments,
  markStagedAttachmentSendFailed,
  runScopedStagedPreparation,
  runScopedStagedSendAttempt,
  selectStagedAttachmentsForSend,
  transitionStagedAttachmentChat,
  type StagedUploadScopeToken,
} from "@/lib/stagedUploadWorkflow";
import { describeUploadFailure, uploadFailureFeedback, uploadFailureMessage } from "@/lib/uploadFailure";
import { ATTACHMENT_UPLOAD_CONCURRENCY, nextClientSentAt, runOrderedSend } from "@/lib/attachmentSendQueue";
import type { Json, MessageWithSender } from "@/types/database";
import { cacheControlFor } from "@/lib/mediaCacheControl";

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
  // This chat, not the list: every message, receipt and read anywhere in the
  // sidebar replaced the list, and the whole conversation rendered with it. The
  // store keeps an unchanged chat as the same object, so this only changes when
  // this chat does.
  const chat = useAppStore((s) => s.chats.find((c) => c.id === chatId));
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const markChatRead = useAppStore((s) => s.markChatRead);
  const setEditingMessage = useAppStore((s) => s.setEditingMessage);
  const setForwardingMessages = useAppStore((s) => s.setForwardingMessages);
  const forwardingMessages = useAppStore((s) => s.forwardingMessages);
  const pendingForward = useAppStore((s) => s.pendingForward);
  const setPendingForward = useAppStore((s) => s.setPendingForward);
  const setMessageSelection = useAppStore((s) => s.setMessageSelection);
  const setMessageDeleteRequest = useAppStore((s) => s.setMessageDeleteRequest);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const selectedTopicId = useAppStore((s) => s.selectedTopicId);
  const setSelectedTopicId = useAppStore((s) => s.setSelectedTopicId);
  const chatPanelRequest = useAppStore((s) => s.chatPanelRequest);
  const clearChatPanelRequest = useAppStore((s) => s.clearChatPanelRequest);
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
    editMessage, deleteMessage, hideMessageForMe, hideMessagesForMe, deleteMessagesForEveryone, togglePin, forwardMessage, clearChatForMe,
    loadOlderMessages, ensureMessageLoaded,
  } = useMessages(chatId, messageTopicId, messageGeneralTopicIds);

  useEffect(() => { markChatRead(chatId); }, [chatId, markChatRead]);
  // What the conversation shows: a private chat draws no deleted message, since
  // delete for both leaves no trace there (lib/deletedMessages.ts). The same
  // array when nothing is taken out, so the list does not render for nothing.
  const conversation = useMemo(() => visibleConversation(messages, chat?.type), [chat?.type, messages]);
  const selection = useChatMessageSelection(chatId, conversation);
  const forwardDraft = pendingForward?.chatId === chatId ? pendingForward.messages : null;

  const [replyTo, setReplyTo] = useState<MessageWithSender | null>(null);
  const [replyFocusKey, setReplyFocusKey] = useState(0);
  // In-chat search is in the store since 2026-09-12, because from `md` it is a
  // state of the LIST COLUMN (`ChatSearchPanel`, mounted by `Sidebar`) while
  // the thing being searched is this pane. Below `md` that column is off screen
  // and this pane keeps the floating capsule. Only ever one of the two is
  // mounted — the gate is `useIsMobile()` rather than a CSS `hidden`, because
  // two mounted copies would each run the query and each jump the conversation.
  const chatSearch = useAppStore((s) => s.chatSearch);
  const openChatSearch = useAppStore((s) => s.openChatSearch);
  const closeChatSearch = useAppStore((s) => s.closeChatSearch);
  const isPhone = useIsMobile();
  const searchOpen = chatSearch?.chatId === chatId;
  const [showInfo, setShowInfo] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [openMedia, setOpenMedia] = useState<MediaViewerItem | null>(null);
  const [draftRestore, setDraftRestore] = useState<{ id: string; text: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Both pieces of chrome run over the conversation, so both have to report the
  // height the list pads itself by. The composer is the one that moves most —
  // reply preview, attachments, a draft that wraps — and it was already
  // measured; the header stack grows too, when a message is pinned or the
  // in-chat search opens.
  const {
    ref: composerRef,
    height: composerHeight,
    measure: measureComposerHeight,
    node: composerNode,
  } = useMeasuredHeight<HTMLDivElement>(chatId);
  const { ref: chromeRef, height: chromeHeight } = useMeasuredHeight<HTMLDivElement>(chatId);
  const messageRefs = useRef<Record<string, HTMLDivElement>>({});
  const pendingJumpRef = useRef<string | null>(null);
  const initialUnreadRef = useRef<{ chatId: string; count: number; since: string | null } | null>(null);
  const supabase = createClient();
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [keyboardInset, setKeyboardInset] = useState(0);
  /** The installed iPhone app with its keyboard up, its shell fitted to what is visible (D-111). */
  const [shellFitsKeyboard, setShellFitsKeyboard] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const stagedAttachmentsRef = useRef<StagedAttachment[]>([]);
  const cancelledAttachmentIdsRef = useRef<Set<string>>(new Set());
  const uploadRegistryRef = useRef<ReturnType<typeof createStagedUploadHandleRegistry> | null>(null);
  const uploadScopeRef = useRef<ReturnType<typeof createStagedUploadScope> | null>(null);
  if (!uploadRegistryRef.current) uploadRegistryRef.current = createStagedUploadHandleRegistry();
  if (!uploadScopeRef.current) uploadScopeRef.current = createStagedUploadScope(chatId);
  const uploadRegistry = uploadRegistryRef.current;
  const uploadScope = uploadScopeRef.current;
  const dragDepthRef = useRef(0);
  const [draggingFiles, setDraggingFiles] = useState(false);

  useLayoutEffect(() => {
    stagedAttachmentsRef.current = stagedAttachments;
  }, [stagedAttachments]);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const root = document.documentElement;
    // The installed iPhone app. iOS does not resize it for the keyboard; it pans
    // what is visible up over the page. Lifting the composer by the keyboard's
    // height put it on the keys but took the chat header off the top of the
    // screen, and on a shell iOS had already made short it left a band between
    // the composer and the keys as well (D-111). There, while the keys are up,
    // the shell is fitted to what is visible and the pan is taken back, so the
    // header stays at the top and the composer sits on the keys. Phones and
    // browsers that resize for their keyboard keep the lift below.
    const installedIos = root.hasAttribute("data-ios-standalone");
    const releaseShell = () => {
      root.style.removeProperty("--kub-app-height");
      setShellFitsKeyboard(false);
    };
    const updateKeyboardInset = () => {
      const mobile = window.innerWidth < 768;
      const composerHasFocus = Boolean(composerNode?.contains(document.activeElement));
      if (!mobile || !visualViewport || !isComposerFocused || !composerHasFocus) {
        if (installedIos) releaseShell();
        setKeyboardInset(0);
        return;
      }
      if (installedIos) {
        // What the keys cover, whether iOS has panned or not.
        if (window.innerHeight - visualViewport.height > 80) {
          root.style.setProperty("--kub-app-height", `${Math.round(visualViewport.height)}px`);
          setShellFitsKeyboard(true);
          if (window.scrollY !== 0 || visualViewport.offsetTop !== 0) window.scrollTo(0, 0);
        } else {
          releaseShell();
        }
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
      if (installedIos) releaseShell();
    };
  }, [composerNode, isComposerFocused]);

  useLayoutEffect(() => {
    measureComposerHeight();
  }, [
    measureComposerHeight,
    keyboardInset,
    stagedAttachments.length,
    replyTo?.id,
    draftRestore?.id,
  ]);

  useLayoutEffect(() => {
    const staleAttachments = transitionStagedAttachmentChat(
      uploadScope,
      chatId,
      stagedAttachmentsRef,
      () => { void uploadRegistry.abortAll(); },
    );
    staleAttachments.forEach(revokeAttachmentPreview);
    setStagedAttachments((current) => current.length ? [] : current);
    cancelledAttachmentIdsRef.current.clear();
    setDraggingFiles(false);
    dragDepthRef.current = 0;

    return () => {
      const abandonedAttachments = clearStagedAttachmentChat(
        uploadScope,
        stagedAttachmentsRef,
        () => { void uploadRegistry.abortAll(); },
      );
      abandonedAttachments.forEach(revokeAttachmentPreview);
      cancelledAttachmentIdsRef.current.clear();
    };
  }, [chatId, uploadRegistry, uploadScope]);

  useEffect(() => {
    if (!chatPanelRequest || chatPanelRequest.chatId !== chatId) return;
    if (chatPanelRequest.panel === "info") setShowInfo(true);
    if (chatPanelRequest.panel === "search") openChatSearch(chatId);
    clearChatPanelRequest(chatPanelRequest.key);
  }, [chatId, chatPanelRequest, clearChatPanelRequest, openChatSearch]);

  const myRole = (chat?.members?.find((m) => m.user_id === userId)?.role ?? null) as
    | "owner" | "admin" | "member" | null;
  const canManageTopics = myRole === "owner" || myRole === "admin";
  if (chat && initialUnreadRef.current?.chatId !== chatId) {
    const myMembership = chat.members?.find((member) => member.user_id === userId) ?? null;
    initialUnreadRef.current = {
      chatId,
      count: chat.unread_count ?? 0,
      since: latestTimestamp(myMembership?.last_read_at, myMembership?.joined_at, myMembership?.cleared_at),
    };
  }

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
    void uploadRegistry.abort(attachmentId);
    setStagedAttachments((current) => {
      const target = current.find((attachment) => attachment.id === attachmentId);
      if (target) revokeAttachmentPreview(target);
      return current.filter((attachment) => attachment.id !== attachmentId);
    });
  }, [uploadRegistry]);

  const cancelStagedAttachment = useCallback((attachmentId: string) => {
    cancelledAttachmentIdsRef.current.add(attachmentId);
    removeStagedAttachment(attachmentId);
  }, [removeStagedAttachment]);

  /**
   * Prepares files for the tray and returns the ones it staged.
   *
   * `compress: false` is a person asking for the original: the picked file is
   * staged as it is — no canvas, no WebP, only the place it was taken removed —
   * and marked so, with a light preview made beside it for the conversation.
   * See `lib/mediaCompression.ts` for every rule this follows.
   */
  const stageFiles = useCallback(async (
    files: File[],
    _source: IncomingFilesSource,
    options: {
      compress?: boolean;
      photoQuality?: MediaQuality;
      /** What a file weighed before the sheet replaced it with a smaller one (D-175). */
      originalSizes?: ReadonlyMap<File, number>;
    } = {},
  ): Promise<StagedAttachment[]> => {
    if (!files.length) return [];
    const compress = options.compress !== false;
    // What a photograph is re-encoded at (D-174). Absent means SD, which is
    // what a send that never mentioned quality asked for. Deliberately not
    // DEFAULT_MEDIA_QUALITY: that constant is the camera recorder bitrates,
    // and answering a question about photographs with it would re-tune video
    // recording as a side effect.
    const photoQuality = options.photoQuality ?? DEFAULT_PHOTO_SEND_QUALITY;
    const scopeToken = uploadScope.capture();
    const existingCount = stagedAttachmentsRef.current.length;
    const availableSlots = Math.max(0, MAX_STAGED_ATTACHMENTS - existingCount);
    const accepted: StagedAttachment[] = [];
    const errors: string[] = [];

    if (!availableSlots) {
      showAppAlert(`Можно подготовить не больше ${MAX_STAGED_ATTACHMENTS} вложений за раз.`, "Вложения");
      return [];
    }

    for (const sourceFile of files.slice(0, availableSlots)) {
      if (!uploadScope.isActive(scopeToken)) {
        accepted.forEach(revokeAttachmentPreview);
        return [];
      }
      const preparation = planAttachmentPreparation(sourceFile.type, compress);
      let file = sourceFile;
      // A video the attach sheet already encoded arrives here as the small file,
      // so nothing downstream can tell it was made smaller. The sheet hands over
      // what it weighed before, which is both the truth and the only way the
      // tray can say «после сжатия» about a wait somebody sat through (D-175).
      const pickedSize = options.originalSizes?.get(sourceFile) ?? sourceFile.size;
      let optimized = pickedSize > sourceFile.size;
      let decodedDimensions: MediaDimensions | null = null;
      if (preparation === "original") {
        // Before anything reads the file: a refused original costs no decode.
        // The attach sheet refuses an oversized original before staging, so what
        // reaches here is a send that already stated its choice.
        const limitError = originalLimitMessage(sourceFile);
        if (limitError) {
          errors.push(limitError);
          continue;
        }
      } else if (preparation === "compress") {
        const prepared = await runScopedStagedPreparation(
          uploadScope,
          scopeToken,
          () => prepareChatImageAttachment(sourceFile, photoQuality),
        );
        if (prepared.status === "stale") {
          accepted.forEach(revokeAttachmentPreview);
          return [];
        }
        file = prepared.value.file;
        // Measured by the decode that encoded it: the photo is not decoded again to read its size.
        decodedDimensions = prepared.value.dimensions;
        optimized = file !== sourceFile || file.size !== sourceFile.size || file.type !== sourceFile.type;
      }
      // Whatever is uploaded as it was picked goes without the place it was
      // taken: an original, a video, and a picture the canvas could not make
      // smaller. A JPEG's GPS directory and a movie's location items are
      // emptied in place and nothing else about the file changes; a picture
      // the canvas re-encoded has none left. See `lib/mediaLocation.ts`.
      const located = await runScopedStagedPreparation(uploadScope, scopeToken, () => removeLocation(file));
      if (located.status === "stale") {
        accepted.forEach(revokeAttachmentPreview);
        return [];
      }
      file = located.value.file;
      const error = validateStagedAttachment(file);
      if (error) {
        errors.push(`${sourceFile.name || file.name || "Файл"}: ${error}`);
        continue;
      }
      let dimensions = decodedDimensions;
      if (!dimensions) {
        const preparedDimensions = await runScopedStagedPreparation(
          uploadScope,
          scopeToken,
          () => readMediaDimensions(file),
        );
        if (preparedDimensions.status === "stale") {
          accepted.forEach(revokeAttachmentPreview);
          return [];
        }
        dimensions = preparedDimensions.value;
      }
      const uncompressed = preparation === "original";
      let previewFile: File | null = null;
      let previewSize: { width: number; height: number } | null = null;
      if (
        uncompressed &&
        dimensions &&
        shouldBuildOriginalPreview({ mimeType: file.type, width: dimensions.width, height: dimensions.height, size: file.size })
      ) {
        const preparedPreview = await runScopedStagedPreparation(
          uploadScope,
          scopeToken,
          () => prepareOriginalPreview(file),
        );
        if (preparedPreview.status === "stale") {
          accepted.forEach(revokeAttachmentPreview);
          return [];
        }
        previewFile = preparedPreview.value;
        previewSize = previewFile ? originalPreviewDimensions(dimensions.width, dimensions.height) : null;
      }
      accepted.push(createStagedAttachment(file, {
        width: dimensions?.width,
        height: dimensions?.height,
        optimized,
        originalSize: pickedSize,
        originalMimeType: sourceFile.type || undefined,
        // No quality is chosen any more (D-119): a video goes at the standard one.
        // A video carries the recorder vocabulary; a photograph now carries
        // what it was actually encoded at, so what was sent stays readable
        // afterwards. An uncompressed one carries neither: it was not
        // re-encoded at all, and a quality would be a claim about nothing.
        mediaQuality: file.type.startsWith("video/")
          ? (uncompressed ? "original" : DEFAULT_MEDIA_QUALITY)
          : uncompressed
            ? undefined
            : photoQuality,
        uncompressed,
        previewFile,
        previewWidth: previewSize?.width,
        previewHeight: previewSize?.height,
      }));
    }

    if (files.length > availableSlots) {
      errors.push(`Добавлено ${availableSlots} из ${files.length}: максимум ${MAX_STAGED_ATTACHMENTS} вложений за раз.`);
    }

    if (accepted.length) {
      const committed = commitPreparedStagedAttachments(
        uploadScope,
        scopeToken,
        accepted,
        (attachments) => {
          setStagedAttachments((current) => {
            if (!uploadScope.isActive(scopeToken)) {
              attachments.forEach(revokeAttachmentPreview);
              return current;
            }
            return [...current, ...attachments];
          });
        },
      );
      if (!committed) {
        accepted.forEach(revokeAttachmentPreview);
        return [];
      }
    }
    if (errors.length && uploadScope.isActive(scopeToken)) {
      showAppAlert(errors.slice(0, 3).join("\n"), "Вложения");
    }
    return accepted;
  }, [uploadScope]);

  /** Returns what it staged, so a recording can be sent in the same breath (D-130). */
  const stageVoiceRecording = useCallback((blob: Blob, durationMs: number, mimeType: string): StagedAttachment | null => {
    const error = validateStagedAttachment(new File([blob], "voice.webm", { type: mimeType || blob.type || "audio/webm" }));
    if (error) {
      showAppAlert(error, "Голосовое сообщение");
      return null;
    }
    const currentVoice = stagedAttachmentsRef.current.find((attachment) => attachment.kind === "voice");
    if (currentVoice) removeStagedAttachment(currentVoice.id);
    if (!currentVoice && stagedAttachmentsRef.current.length >= MAX_STAGED_ATTACHMENTS) {
      showAppAlert(`Можно подготовить не больше ${MAX_STAGED_ATTACHMENTS} вложений за раз.`, "Голосовое сообщение");
      return null;
    }
    const staged = createStagedVoiceAttachment(blob, durationMs, mimeType);
    setStagedAttachments((current) => [...current, staged]);
    return staged;
  }, [removeStagedAttachment]);

  /** As above: what it staged goes straight out, rather than waiting in the tray. */
  const stageVideoMessageRecording = useCallback((blob: Blob, durationMs: number, mimeType: string): StagedAttachment | null => {
    const error = validateStagedAttachment(new File([blob], "video-message.webm", { type: mimeType || blob.type || "video/webm" }));
    if (error) {
      showAppAlert(error, "Видео-сообщение");
      return null;
    }
    const currentVideoMessage = stagedAttachmentsRef.current.find((attachment) => attachment.kind === "video_message");
    if (currentVideoMessage) removeStagedAttachment(currentVideoMessage.id);
    if (!currentVideoMessage && stagedAttachmentsRef.current.length >= MAX_STAGED_ATTACHMENTS) {
      showAppAlert(`Можно подготовить не больше ${MAX_STAGED_ATTACHMENTS} вложений за раз.`, "Видео-сообщение");
      return null;
    }
    const staged = createStagedVideoMessageAttachment(blob, durationMs, mimeType, DEFAULT_MEDIA_QUALITY);
    setStagedAttachments((current) => [...current, staged]);
    return staged;
  }, [removeStagedAttachment]);

  const uploadStagedAttachment = useCallback(async (
    attachment: StagedAttachment,
    scopeToken: StagedUploadScopeToken,
  ): Promise<StagedAttachmentUpload> => {
    if (!userId) throw new Error("auth");
    const sourceChatId = scopeToken.chatId;
    const path = chatAttachmentUploadPath(sourceChatId, userId, attachment);
    const contentType = attachment.mimeType || attachment.file.type || "application/octet-stream";
    let uploadedPath = path;

    if (shouldUseResumableUpload(attachment.file.size)) {
      const handle = startResumableStorageUpload({
        supabaseClient: supabase,
        supabaseUrl: getSupabasePublicUrl(),
        file: attachment.file,
        bucketName: CHAT_MEDIA_BUCKET,
        objectName: path,
        contentType,
        onProgress: (progress) => {
          if (
            !uploadScope.isActive(scopeToken) ||
            cancelledAttachmentIdsRef.current.has(attachment.id)
          ) return;
          updateStagedAttachment(attachment.id, (current) => ({ ...current, progress }));
        },
      });
      uploadRegistry.register(attachment.id, handle);
      try {
        const result = await handle.result;
        uploadedPath = result.path;
      } finally {
        uploadRegistry.release(attachment.id, handle);
      }
    } else {
      const { data, error } = await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .upload(path, attachment.file, {
          contentType,
          upsert: false,
          cacheControl: cacheControlFor(path),
        });
      if (error || !data) throw error ?? new Error("upload_failed");
      uploadedPath = data.path;
    }

    // An original's preview goes beside it, at the address a reader derives from
    // the original's own path. It is small, so a plain upload; and it is only a
    // lighter picture for the conversation, so a failure costs the bubble a
    // heavier download and never fails the send.
    let previewPath: string | null = null;
    if (
      attachment.uncompressed &&
      attachment.previewFile &&
      uploadScope.isActive(scopeToken) &&
      !cancelledAttachmentIdsRef.current.has(attachment.id)
    ) {
      // `.preview.webp`, or `.preview.jpg` from an engine that cannot write WebP.
      const candidate = originalPreviewPath(uploadedPath, attachment.previewFile.type);
      const { error: previewError } = await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .upload(candidate, attachment.previewFile, {
          contentType: attachment.previewFile.type || "image/webp",
          upsert: false,
          cacheControl: cacheControlFor(candidate),
        });
      if (previewError) console.warn("[attachments] preview upload failed.");
      else previewPath = candidate;
    }

    const { data: publicData } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(uploadedPath);
    return {
      bucket: CHAT_MEDIA_BUCKET,
      path: uploadedPath,
      publicUrl: publicData.publicUrl,
      previewPath,
    };
  }, [supabase, updateStagedAttachment, uploadRegistry, uploadScope, userId]);

  const sendStagedAttachments = useCallback(async (
    caption: string,
    onlyAttachmentId?: string,
    // What the desktop send dialog just staged: sent by itself, and without
    // waiting for the ref to catch up with the render that added it.
    explicitTargets?: StagedAttachment[],
  ): Promise<boolean> => {
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять файлы.", "Вложения");
      return false;
    }

    const scopeToken = uploadScope.capture();
    const captionText = caption.trim();
    const targets = selectStagedAttachmentsForSend(
      explicitTargets ?? stagedAttachmentsRef.current,
      onlyAttachmentId,
    );
    if (!targets.length) return false;

    let sentAny = false;
    const firstTarget = targets[0];
    if (captionText && (firstTarget?.kind === "voice" || firstTarget?.kind === "video_message")) {
      const textResult = await runScopedStagedSendAttempt(
        uploadScope,
        scopeToken,
        () => sendMessage(captionText, replyTo?.id ?? undefined),
      );
      if (textResult.status === "stale") return false;
      if (textResult.status === "failed") {
        updateStagedAttachment(firstTarget.id, (current) =>
          markStagedAttachmentSendFailed(current, current.uploaded)
        );
        return false;
      }
      sentAny = true;
    }

    // Every attachment of this send is under way from here, the ones waiting for
    // a free upload too: they read as loading, with no number to freeze (D-114),
    // and a second send cannot pick them up.
    for (const attachment of targets) {
      updateStagedAttachment(attachment.id, (current) => ({
        ...current,
        status: "uploading",
        progress: null,
        error: null,
      }));
    }

    const replyToId = replyTo?.id ?? null;
    const failures: string[] = [];
    const failureNoticeKey = `attachment-upload:${scopeToken.chatId}:${targets[0].id}`;
    let previousSentAt: string | null = null;

    // Three uploads at a time, and the messages inserted in the order the files
    // were picked. A failure is that attachment's alone: it keeps its reason and
    // «Повторить», and the attachments after it still go (D-113, D-114). The
    // order and the concurrency are decided in `lib/attachmentSendQueue.ts`.
    await runOrderedSend(targets, {
      concurrency: ATTACHMENT_UPLOAD_CONCURRENCY,
      isActive: () => uploadScope.isActive(scopeToken),
      isWanted: (attachment) => !cancelledAttachmentIdsRef.current.has(attachment.id),
      upload: (attachment) => attachment.uploaded
        ? Promise.resolve(attachment.uploaded)
        : uploadStagedAttachment(attachment, scopeToken),
      onUploaded: (attachment, uploaded) => {
        updateStagedAttachment(attachment.id, (current) => ({
          ...current,
          status: "sending",
          progress: 100,
          uploaded,
          error: null,
        }));
      },
      onUploadFailed: (attachment, error) => {
        // Why, as the server's answer says it, and the file's name (D-113).
        // The reason and the status say nothing about what the file holds.
        const failure = describeUploadFailure(error);
        const uploadErrorMessage = uploadFailureMessage(attachment.name, failure);
        console.warn("[attachments] upload failed.", failure.reason, failure.status ?? "no answer");
        reportError(new Error("attachment_upload_failed"), {
          category: "attachment_upload_failed",
          attachmentKind: attachment.kind,
          mimeType: attachment.mimeType,
          fileSize: attachment.file.size,
          reason: failure.reason,
          status: failure.status,
          limitBytes: failure.limitBytes,
        });
        updateStagedAttachment(attachment.id, (current) => ({
          ...current,
          status: "failed",
          progress: null,
          error: uploadErrorMessage,
        }));
        failures.push(uploadErrorMessage);
        const feedback = uploadFailureFeedback(failures);
        if (feedback) showActionFeedback({ kind: "error", key: failureNoticeKey, ...feedback });
      },
      insert: async (attachment, uploaded) => {
        // Later than the message before it, so the conversation keeps the pick
        // order even when two inserts start within one millisecond.
        const clientSentAt = nextClientSentAt(previousSentAt, Date.now());
        previousSentAt = clientSentAt;
        const content = getStagedAttachmentMessageContent(attachment, sentAny || !captionText ? null : captionText);
        const sendResult = await runScopedStagedSendAttempt(
          uploadScope,
          scopeToken,
          () => sendMediaMessage({
            type: getStagedAttachmentMessageType(attachment),
            content,
            mediaBucket: uploaded.bucket,
            mediaPath: uploaded.path,
            mediaUrl: uploaded.publicUrl,
            replyToId,
            clientMessageId: attachment.clientMessageId,
            clientSentAt,
            mediaMetadata: getStagedAttachmentMediaMetadata(attachment, uploaded),
          }),
        );

        if (sendResult.status === "stale") return false;
        if (sendResult.status === "failed") {
          reportError(new Error("staged_attachment_send_failed"), {
            category: "attachment_send_failed",
            attachmentKind: attachment.kind,
            mimeType: attachment.mimeType,
            fileSize: attachment.file.size,
          });
          updateStagedAttachment(attachment.id, (current) =>
            markStagedAttachmentSendFailed(current, uploaded)
          );
          return false;
        }

        sentAny = true;
        removeStagedAttachment(attachment.id);
        return true;
      },
    });

    if (sentAny) setReplyTo(null);
    return sentAny;
  }, [replyTo?.id, removeStagedAttachment, sendMediaMessage, sendMessage, updateStagedAttachment, uploadScope, uploadStagedAttachment, userId]);

  const retryStagedAttachment = useCallback((attachmentId: string) => {
    void sendStagedAttachments("", attachmentId);
  }, [sendStagedAttachments]);

  /**
   * The send that forwards what waits above the composer: the comment first,
   * as Telegram sends it, then the messages in their order. A refusal puts
   * the ones not yet delivered back above the composer, which is where the
   * next attempt starts, and says why.
   *
   * Each message goes through `forwardMessage`, which has the server copy it
   * with its media and its previews (D-083).
   */
  const sendForwardDraft = useCallback(async (comment: string, draft: MessageWithSender[]) => {
    setPendingForward(null);
    if (comment.trim()) await sendMessage(comment.trim());
    // The messages go to the chat on screen, so its name is the one this
    // window already reads — not the whole list, which D-088 took this window
    // off so that every list change stopped rendering the open chat.
    const targetName = chat?.name;
    for (let index = 0; index < draft.length; index += 1) {
      const result = await forwardMessage(draft[index], chatId)
        .catch((cause: unknown) => ({ ok: false as const, error: mapPgError(cause) }));
      if (!result.ok) {
        setPendingForward({ chatId, messages: draft.slice(index) });
        showActionFeedback(forwardFeedback(result, targetName));
        return;
      }
    }
    showActionFeedback(forwardFeedback({ ok: true, error: null }, targetName, draft.length));
  }, [chat?.name, chatId, forwardMessage, sendMessage, setPendingForward]);

  const stageIncomingFiles = useCallback(
    (files: File[], source: IncomingFilesSource, compress: boolean) => stageFiles(files, source, { compress }),
    [stageFiles],
  );
  // The attach sheet (D-122) is the send step for pasted and dropped photos too.
  const {
    request: mediaSendRequest,
    handleIncomingFiles,
    closeRequest: closeMediaSendRequest,
  } = useIncomingMediaFiles(stageIncomingFiles);

  // Files picked for one chat are not sent into the next.
  useLayoutEffect(() => {
    closeMediaSendRequest();
  }, [chatId, closeMediaSendRequest]);

  // The attach sheet (D-122) sends what it picked: staged as chosen, compressed
  // or as originals, then sent with its caption.
  const sendMediaFromSheet = useCallback(async (request: AttachSendRequest) => {
    const staged = await stageFiles(request.files, request.source, {
      compress: request.compress,
      photoQuality: request.photoQuality,
      originalSizes: request.originalSizes,
    });
    if (!staged.length) return;
    await sendStagedAttachments(request.caption, undefined, staged);
  }, [sendStagedAttachments, stageFiles]);

  const handleSend = useCallback((content: string) => {
    if (forwardDraft) {
      void sendForwardDraft(content, forwardDraft);
      return true;
    }
    if (stagedAttachmentsRef.current.length) {
      return sendStagedAttachments(content);
    }
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять сообщения.", "Сообщение");
      return false;
    }
    const replyToId = replyTo?.id;
    void sendMessage(content, replyToId);
    setReplyTo(null);
    return true;
  }, [forwardDraft, replyTo?.id, sendForwardDraft, sendMessage, sendStagedAttachments, userId]);

  const handleReply = useCallback((msg: MessageWithSender) => {
    setReplyTo(msg);
    setReplyFocusKey((key) => key + 1);
  }, []);

  /**
   * A released recording is sent, not parked (D-130, audit row R6).
   *
   * Staged and sent in one step, the way the attach sheet sends what it picked:
   * the tray carries it only while it is on its way, and there is no second
   * «Отправить» to go and find. A press too short to be a recording never gets
   * here — the composer refuses it with a hint beside the button instead of the
   * modal this used to raise (R7) — so the guard left here is silent.
   */
  const handleSendVoice = useCallback(async (blob: Blob, durationMs: number, mimeType: string) => {
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять голосовые сообщения.", "Голосовое сообщение");
      return;
    }
    if (!blob || blob.size === 0 || durationMs < recordingMinimumMs("voice")) return;
    const staged = stageVoiceRecording(blob, durationMs, mimeType);
    if (!staged) return;
    await sendStagedAttachments("", undefined, [staged]);
  }, [sendStagedAttachments, stageVoiceRecording, userId]);

  /** The round video goes the same way: released means sent (D-130). */
  const handleSendVideoMessage = useCallback(async (blob: Blob, durationMs: number, mimeType: string) => {
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять видео-сообщения.", "Видео-сообщение");
      return;
    }
    if (!blob || blob.size === 0 || durationMs < recordingMinimumMs("video")) return;
    const staged = stageVideoMessageRecording(blob, durationMs, mimeType);
    if (!staged) return;
    await sendStagedAttachments("", undefined, [staged]);
  }, [sendStagedAttachments, stageVideoMessageRecording, userId]);

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

  const handleSearchJump = useCallback((messageId: string, topicId?: string | null) => {
    if (isForum && topicId !== undefined && (topicId ?? null) !== (selectedTopicId ?? null)) {
      setSelectedTopicId(topicId ?? null);
      pendingJumpRef.current = messageId;
      window.setTimeout(() => requestChatMessageJump(chatId, messageId), 250);
      return;
    }
    void handleJumpToReply(messageId);
  }, [chatId, handleJumpToReply, isForum, selectedTopicId, setSelectedTopicId]);

  useEffect(() => {
    const handleGlobalJump = (event: Event) => {
      const detail = (event as CustomEvent<ChatMessageJumpDetail>).detail;
      if (!detail || detail.chatId !== chatId) return;
      // A jump that names a topic comes from outside this pane — the list
      // column's in-chat search — and a forum has to switch topic before the
      // message exists to scroll to. That handshake is `handleSearchJump`,
      // which is what the phone's overlay already calls, so the column takes
      // the same road rather than a second copy of it. Notifications, global
      // search and push name no topic and keep the plain jump.
      if (detail.topicId !== undefined) {
        void handleSearchJump(detail.messageId, detail.topicId);
        return;
      }
      void handleJumpToReply(detail.messageId);
    };

    window.addEventListener(KUB_CHAT_MESSAGE_JUMP_EVENT, handleGlobalJump);
    return () => window.removeEventListener(KUB_CHAT_MESSAGE_JUMP_EVENT, handleGlobalJump);
  }, [chatId, handleJumpToReply, handleSearchJump]);

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

  /**
   * What the one «Удалить» dialog does.
   *
   * Unticked, it hides the messages for the reader only. Ticked, it deletes
   * them for everyone through `delete_messages_for_everyone`: in a private chat
   * anyone's message, leaving no trace; in a group the reader's own, which leave
   * «Сообщение удалено». Where the server lacks that function, own messages get
   * the soft delete they always had and anyone else's are hidden for the reader.
   */
  const handleDeleteMessages = useCallback(async (items: MessageWithSender[], forEveryone: boolean) => {
    if (!forEveryone) {
      const result = await hideMessagesForMe(items.map((item) => item.id));
      return { ok: result.ok, error: result.error };
    }
    return deleteMessagesForEveryone(items);
  }, [deleteMessagesForEveryone, hideMessagesForMe]);

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
    if (files.length) handleIncomingFiles(files, "drop");
  }, [handleIncomingFiles]);

  // The conversation runs the full height of the pane, under both pieces of
  // chrome, so its padding is exactly what they cover. Note what this does
  // *not* change: the list gains `chromeHeight + composerHeight` of client
  // height and the same amount of padding, so `scrollHeight - clientHeight` —
  // every anchor in this chat is expressed in it — comes out unmoved.
  const messageListTopInset = chromeHeight;
  const messageListBottomInset = composerHeight;
  const messageMediaVariants = useMessageMediaVariantUrls(messages);
  const mediaPlaylist = useMemo(
    () => messages
      .map((message) => createMediaPlaybackItem(message, chatId, userId, messageMediaVariants[message.id]))
      .filter((item): item is ChatMediaPlaybackItem => Boolean(item)),
    [chatId, messageMediaVariants, messages, userId],
  );

  return (
    <ChatMediaPlaybackProvider chatId={chatId} playlist={mediaPlaylist}>
      <div
        // The pane paints no fill of its own. It used to paint --kub-chat-bg,
        // which never showed, and was the flat sheet behind the header and the
        // composer that their blur had to sample. Now the list runs the whole
        // height of the pane and passes under both, so what they sample is the
        // conversation — which is the only thing that reads as frosted.
        //
        // `kub-chat-screen` gives everything in the pane the chat screen's
        // text and accent tokens, which were measured over its wallpaper and
        // under its capsules (index.css).
        //
        // This box is already the row the contact card docks into: the
        // conversation is the `flex-1` child below and `ChatInfoPanel` is its
        // sibling, floating out of the flow today and a column beside it when
        // the pane is wide enough (D-161). The attribute is how the card finds
        // the row to measure — its own width is what decides the shape, and it
        // is a stable number either way, because a floating card is out of flow
        // and a column takes its width from inside this box rather than from
        // outside it.
        //
        // Named for the conversation rather than for the chat, and that is not
        // a preference: the attribute namespace the retired chat-chrome DEV
        // switch used is kept empty by tests/unit/chat-chrome.test.mts, so the
        // options the owner chose between cannot creep back. That guard reads
        // raw file text, so the prefix fails it even inside a sentence — which
        // is how both the first spelling of this attribute and the first
        // attempt at this very comment were caught.
        className="kub-chat-screen relative flex h-full w-full min-w-0 overflow-hidden"
        data-kub-conversation-pane=""
        style={{
          "--kub-keyboard-inset": `${keyboardInset}px`,
          // The keys cover the home indicator, so while they are up in the
          // installed iPhone app nothing in the conversation pads for it (D-111).
          ...(shellFitsKeyboard ? { "--kub-safe-bottom": "0px" } : {}),
          "--kub-composer-height": `${composerHeight}px`,
          "--kub-chat-chrome-height": `${chromeHeight}px`,
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
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center chat-bg">
            <KubIcon name="spinner" size={28} className="text-[color:var(--kub-cyan)]" />
          </div>
        ) : conversation.length === 0 ? (
          <div className="flex-1 flex items-center justify-center chat-bg">
            <KubEmptyState
              icon={<KubIcon name="chatRect" size={24} />}
              title="Сообщений пока нет"
              description="Поздоровайтесь и начните разговор."
            />
          </div>
        ) : (
          <MessageList
            chatId={chatId}
            messages={conversation}
            loadReadTimes={readTimesLoader()}
            onReply={handleReply}
            onJumpToReply={handleJumpToReply}
            onReaction={toggleReaction}
            onEdit={(msg) => setEditingMessage(msg)}
            onDelete={savedChat ? undefined : (msg) => deleteMessage(msg.id)}
            onHideForMe={handleHideForMe}
            onTogglePin={userId ? handleTogglePin : undefined}
            onForward={(msg) => setForwardingMessages([msg])}
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
            topInset={messageListTopInset}
            layoutKey={chatId}
            layoutVersion={composerHeight}
            initialUnreadCount={initialUnreadRef.current?.chatId === chatId ? initialUnreadRef.current.count : 0}
            initialUnreadSince={initialUnreadRef.current?.chatId === chatId ? initialUnreadRef.current.since : null}
          />
        )}

        <div
          ref={chromeRef}
          // Over the conversation, not above it. Taken out of the column's flow
          // so the list can have the whole pane and the glass something to
          // frost; the list pays it back as padding, measured from this box.
          //
          // D-062: last in the column's markup, and that is load-bearing. The
          // header, the list and the composer are all positioned boxes with
          // `z-index: auto`, so what paints on top is decided by tree order.
          // This block used to come first and `order: -1` on the list was what
          // moved the list underneath it — but `order` only re-orders painting
          // for flex *items*, and WebKit does not apply it to positioned ones
          // at all. Measured on Safari 26.4 at 390x844: the topmost element at
          // the header's centre was a message bubble, the back button's own
          // centre hit-tested to a bubble, and the header's menu could not be
          // opened at any width. Nobody could leave a conversation on iPhone.
          //
          // Tree order is the only mechanism here that costs nothing else. A
          // `z-index` on this box, or an `isolation` on the column, would make
          // a stacking context and clamp every `fixed` overlay hosted in this
          // subtree — this header's menu and its modals, the composer's camera
          // and video recorder, a bubble's context menu — inside it; whichever
          // of the two chrome boxes then lost would have its full-screen dialog
          // covered by the other. A negative `z-index` on the list is worse: it
          // stops being the hit-test target, measured false in both engines.
          //
          // The cost paid instead is reading order: the conversation is read
          // before its header. `KubGlassLayer`'s note explains why the header
          // still keeps a plain `relative` box.
          //
          // `kub-chat-chrome-stack` paints the scroll edge behind the chrome
          // (index.css): the conversation dimmed and frosted under the status
          // bar and the capsules, and let go just below them.
          className="kub-chat-chrome-stack absolute inset-x-0 top-0 flex flex-col"
          data-testid="chat-chrome-stack"
        >
          {/* While messages are selected their bar stands where the header
              was, at the header's height, so nothing under it moves. */}
          {selection.active ? (
            <ChatSelectionBar
              count={selection.selected.length}
              canForward
              canCopy
              canDelete
              onForward={() => setForwardingMessages(selection.selected)}
              onCopy={() => {
                copySelectedMessages(selection.selected, userId);
                selection.clear();
              }}
              onDelete={() => setMessageDeleteRequest({ chatId, ids: selection.selected.map((message) => message.id) })}
              onCancel={selection.clear}
            />
          ) : (
            <ChatHeader
              chatId={chatId}
              chat={chat}
              onSearchOpen={() => openChatSearch(chatId)}
              onInfoOpen={() => setShowInfo(true)}
              onClearForMe={clearChatForMe}
              mediaPlayback={<ChatMediaPlaybackBar compact />}
            />
          )}

          {isForum && (
            <TopicStrip
              topics={topics}
              canManage={canManageTopics}
              onCreate={createTopic}
            />
          )}

          {/* The phone's form only. From `md` this same search is the list
              column's body — `ChatSearchPanel` — where it covers none of the
              conversation and renders every match instead of the first six. */}
          {searchOpen && isPhone && (
            <ChatSearchBar
              chatId={chatId}
              currentTopicId={messageTopicId}
              isForum={isForum}
              messages={conversation}
              onClose={closeChatSearch}
              onJumpTo={handleSearchJump}
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
        </div>

        <div
          ref={composerRef}
          data-testid="chat-composer-dock"
          // Over the conversation for the same reason the header is, and last
          // in the column's markup for the same reason it was: nothing about
          // the composer's own box changes, so the camera, the video recorder
          // and the attachment backdrop still lay out against the viewport.
          //
          // The larger of the keyboard and the home indicator, never their
          // sum. An open keyboard covers the home indicator, so adding the two
          // left a strip of the inset's height between the composer and the
          // keys on an iPhone; with the keyboard closed the inset is all that
          // is left, and on a device without one this is the keyboard alone.
          //
          // `kub-chat-composer-dock` paints the scroll edge under the
          // composer's capsules, as the chrome stack does above them.
          className="kub-chat-composer-dock absolute inset-x-0 bottom-0 transition-[padding-bottom] duration-150 ease-out"
          style={{ paddingBottom: "max(var(--kub-keyboard-inset, 0px), var(--kub-safe-bottom))" }}
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
            onStageFiles={handleIncomingFiles}
            onRemoveAttachment={removeStagedAttachment}
            onRetryAttachment={retryStagedAttachment}
            onCancelAttachment={cancelStagedAttachment}
            draftOverride={draftRestore}
            focusRequestKey={replyFocusKey}
            onFocusChange={setIsComposerFocused}
            forwardDraft={forwardDraft}
            onCancelForward={() => setPendingForward(null)}
            onSendMedia={sendMediaFromSheet}
            incomingMedia={mediaSendRequest}
            onIncomingMediaTaken={closeMediaSendRequest}
          />
        </div>
      </div>
      {showInfo && chat && (
        <ChatInfoPanel chat={chat} onClose={() => setShowInfo(false)} onClearForMe={clearChatForMe} />
      )}
      {forwardingMessages && (
        <ForwardModal
          messages={forwardingMessages}
          onClose={() => setForwardingMessages(null)}
          onForward={(targetChatId) => {
            // Telegram's order: the chat first. Nothing is sent here — the chat
            // opens with the messages waiting above its composer, a comment
            // can be added, and the send forwards them (`sendForwardDraft`).
            setPendingForward({ chatId: targetChatId, messages: forwardingMessages });
            setForwardingMessages(null);
            setMessageSelection(null);
            if (targetChatId !== chatId) setSelectedChatId(targetChatId);
          }}
        />
      )}
      <MessageDeleteDialogHost
        chatId={chatId}
        messages={conversation}
        chatType={chat?.type}
        isSavedChat={savedChat}
        otherName={chat?.type === "private" ? getChatDisplayInfo(chat, userId).title : null}
        currentUserId={userId}
        onDelete={handleDeleteMessages}
      />
        <MediaViewer media={openMedia} onClose={() => setOpenMedia(null)} />
      </div>
    </ChatMediaPlaybackProvider>
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
  return stagedAttachmentTextContent(attachment.kind, caption, attachment.name);
}

function getStagedAttachmentMediaMetadata(
  attachment: StagedAttachment,
  uploaded: StagedAttachmentUpload,
): Json | null | undefined {
  // Built in `lib/mediaCompression.ts`, where the unit suite can reach it.
  return buildAttachmentMediaMetadata(attachment, uploaded) as Json | undefined;
}

function formatVoiceDurationLabel(durationMs: number): string {
  const totalSec = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function createMediaPlaybackItem(
  message: MessageWithSender,
  chatId: string,
  currentUserId: string | null,
  mediaVariant?: MessageMediaVariantUrls,
): ChatMediaPlaybackItem | null {
  if (!message.media_url || message.deleted_at) return null;
  if (message.type !== "audio" && message.type !== "video") return null;
  const kind: ChatMediaPlaybackItem["kind"] = message.type === "video"
    ? isRoundVideoMessageContent(message)
      ? "video_message"
      : "video"
    : isVoiceMessageContent(message)
      ? "voice"
      : "audio";
  const actor = resolveMessageActor(message);
  const senderName = actor.kind === "user" && actor.id === currentUserId
    ? "Вы"
    : messageActorDisplayName(actor);
  return {
    id: message.id,
    chatId,
    kind,
    url: message.type === "video"
      ? selectVideoPlaybackUrl({
        originalUrl: message.media_url,
        video720pUrl: mediaVariant?.video720pUrl,
        mediaMetadata: message.media_metadata,
      })
      : message.media_url,
    title: kind === "video_message"
      ? "Видеосообщение"
      : kind === "voice"
        ? "Голосовое сообщение"
        : kind === "audio"
          ? "Аудио"
          : "Видео",
    subtitle: senderName,
    durationMs: getMessageMediaMetadataNumber(message, "duration_ms") ?? parseMessageDurationMs(message.content),
  };
}

function getMessageMediaMetadataNumber(message: MessageWithSender, key: string): number | null {
  const metadata = message.media_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseMessageDurationMs(content: string | null | undefined): number | null {
  const match = content?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return (minutes * 60 + seconds) * 1000;
}

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time) || time <= latestTime) continue;
    latest = value;
    latestTime = time;
  }
  return latest;
}
