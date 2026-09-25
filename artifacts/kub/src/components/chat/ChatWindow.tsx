"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, type CSSProperties, type DragEvent } from "react";
import { ChatHeader } from "./ChatHeader";
import { PinnedMessage } from "./PinnedMessage";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ChatSearchBar } from "./ChatSearchBar";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChatInfoPanel } from "./ChatInfoPanel";
import { ReportDialogHost } from "./ReportDialog";
import { ChatSelectionBar } from "./ChatSelectionBar";
import { ForwardModal } from "./ForwardModal";
import { MessageDeleteDialogHost, copySelectedMessages, useChatMessageSelection } from "./MessageSelectionChrome";
import { MediaViewer, type MediaViewerItem } from "./MediaViewer";
import { ChatMediaPlaybackBar, ChatMediaPlaybackProvider, type ChatMediaPlaybackItem } from "./ChatMediaPlayback";
import { TopicStrip } from "./TopicStrip";
import { ChannelRail, ChannelRailSheet, ChannelRailTrigger } from "./ChannelRail";
import { ChannelManageDialogHost, requestChannelManage } from "./ChannelManageModal";
import { VoiceCallCapsule } from "./VoiceCallCapsule";
import { useTopics } from "@/hooks/useTopics";
import { useServerChannels } from "@/hooks/useServerChannels";
import { useChatRoles } from "@/hooks/useChatRoles";
import { topChatRolesByMember } from "@/lib/chatRoles";
import { useVoiceChannel } from "@/hooks/useVoiceChannel";
import { useVoiceElsewhere } from "@/hooks/useVoiceElsewhere";
import { voiceJoinIsAMove } from "@/lib/voiceElsewhere";
import {
  capsuleNamesARoom,
  currentTextChannelId,
  paneFitsChannelRail,
  railIsOffered,
  topicIdForChannel,
} from "@/lib/channelRail";
import { listReadFailed } from "@/lib/listReadState";
import { publicMediaObjectUrl } from "@/lib/media/mediaUrl";
import type { ServerChannel } from "@/lib/serverChannels";
import {
  joinVoiceChannel,
  leaveVoiceCall,
  setVoiceMuted,
  useVoiceCall,
  voiceCallSnapshot, setVoiceDeafened } from "@/hooks/useVoiceCall";
import {
  renameVoiceParticipants,
  resolveVoiceParticipants,
  voiceCallLostItsChannel,
  voiceCapsuleState,
} from "@/lib/voiceChannel";
import { useMessages } from "@/hooks/useMessages";
import { resolveOriginalPreviewUrl, useMessageMediaVariantUrls, type MessageMediaVariantUrls } from "@/hooks/useMediaVariants";
import { useMessageMediaUrl } from "@/hooks/useMediaObjectUrl";
import { conversationMediaIndex, conversationMediaRows } from "@/lib/conversationMedia";
import { isUncompressedMedia } from "@/lib/mediaCompression";
import { mediaOriginality } from "@/lib/mediaOriginality";
import { mediaDayLabel } from "@/lib/sharedMediaBrowsing";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { useAppStore } from "@/store/app.store";
import { createClient, getSupabasePublicUrl } from "@/lib/supabase/client";
import { KubButton, KubEmptyState, KubIcon } from "@/components/kub";
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
import { useBotChat } from "@/hooks/useBotChat";
import type { BotCommandsInText } from "@/lib/formatText";
import { BOT_START_COMMAND, botChatNeedsStart, type BotChatAddressing } from "@/lib/botChatSurfaces";
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
import { ATTACHMENT_UPLOAD_CONCURRENCY, captionCarrierId, nextClientSentAt, runOrderedSend } from "@/lib/attachmentSendQueue";
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
  const { topics, createTopic, view: topicsView, refetch: refetchTopics } = useTopics(chatId, isForum);
  const generalTopicIds = useMemo(
    () => topics.filter((topic) => topic.is_general).map((topic) => topic.id),
    [topics],
  );
  const messageTopicId = isForum ? selectedTopicId : undefined;
  const messageGeneralTopicIds = isForum ? generalTopicIds : EMPTY_GENERAL_TOPIC_IDS;
  const {
    messages, pinnedMessages, pinnedReady, loading, historyPending, historyError,
    loadingOlder, hasMoreOlder, olderError, isTyping,
    sendMessage, sendMediaMessage, sendTyping, toggleReaction,
    actionRefusal, clearActionRefusal,
    retryMessageSend, discardLocalMessage,
    editMessage, deleteMessage, hideMessageForMe, hideMessagesForMe, deleteMessagesForEveryone, togglePin, forwardMessage, clearChatForMe,
    loadOlderMessages, ensureMessageLoaded, refetch: refetchMessages,
  } = useMessages(chatId, messageTopicId, messageGeneralTopicIds);

  /**
   * The bot this chat holds, if it holds one (D-126, D-127).
   *
   * `needsStart` is decided over `messages` and not over `conversation`: a
   * message the reader deleted for themselves is still a message they sent, and
   * a composer that turned back into «Запустить» after a cleared chat would
   * offer to start a bot that has been running for months. `hasMoreOlder` is
   * what makes the inference sound — see `botChatNeedsStart`.
   */
  const botChat = useBotChat(chatId);
  const botNeedsStart = botChat.ready && botChatNeedsStart({
    hasBot: botChat.botId !== null,
    // The fact D-243 was missing. A group that holds a bot is still a group,
    // and «I have not written here» is not «I have not started this bot».
    chatType: chat?.type ?? null,
    currentUserId: userId,
    messages,
    historyComplete: !hasMoreOlder,
  });
  /**
   * What a command has to carry here for the bot to hear it (D-244).
   *
   * The username is `useBotChat`'s, read in the same row as the bot whose
   * commands the menu is about; the type is the chat's own. A chat still
   * settling into the store answers `null`, which addresses the command — the
   * form a private chat accepts as well, so an unknown type costs a few
   * characters rather than a message nobody receives.
   */
  const botAddressing = useMemo<BotChatAddressing>(
    () => ({ chatType: chat?.type ?? null, botUsername: botChat.botUsername }),
    [chat?.type, botChat.botUsername],
  );

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
  /**
   * The picture or video the viewer is on, held by **message id** (D-288).
   *
   * An index would drift: a page of older history lands at the front of the
   * conversation and shifts every index behind it. An id cannot, so the viewer
   * survives a prepend that happens while it is open — which is exactly what a
   * step past the oldest loaded picture asks for.
   */
  const [openMediaId, setOpenMediaId] = useState<string | null>(null);
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
  /** The installed iPhone app with its keyboard up; its shell is always fitted to what is visible (D-111). */
  const [shellFitsKeyboard, setShellFitsKeyboard] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const restingVisualHeightRef = useRef<number | null>(null);
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
    // the composer and the keys as well (D-111). There, the shell is fitted
    // to what is visible and the keyboard pan is taken back, so the
    // header stays at the top and the composer sits on the keys. Phones and
    // browsers that resize for their keyboard keep the lift below.
    const installedIos = root.hasAttribute("data-ios-standalone");
    const releaseShell = () => {
      root.style.removeProperty("--kub-app-height");
      root.style.removeProperty("--kub-app-top");
      setShellFitsKeyboard(false);
    };
    const updateKeyboardInset = () => {
      const mobile = window.innerWidth < 768;
      const composerHasFocus = Boolean(composerNode?.contains(document.activeElement));
      if (!mobile || !visualViewport) {
        if (installedIos) releaseShell();
        setKeyboardInset(0);
        return;
      }
      if (installedIos) {
        // A Home Screen app can be given less visible height than 100vh even
        // before the keyboard opens. Fit the shell to that real visible area.
        root.style.setProperty("--kub-app-height", `${Math.round(visualViewport.height)}px`);
        if (!isComposerFocused || !composerHasFocus) {
          restingVisualHeightRef.current = visualViewport.height;
        }
        // Some iOS versions shrink innerHeight with visualViewport, so the
        // current difference alone cannot identify an open keyboard.
        const restingHeight = restingVisualHeightRef.current ?? visualViewport.height;
        const keyboardVisible = isComposerFocused && composerHasFocus
          && Math.max(window.innerHeight - visualViewport.height, restingHeight - visualViewport.height) > 80;
        // On iOS 26 the system can pan the document without changing scrollY;
        // scrollTo(0, 0) cannot undo it. Follow the visual viewport instead.
        const pan = keyboardVisible
          ? Math.max(0, Math.round(visualViewport.pageTop), Math.round(-document.body.getBoundingClientRect().top))
          : 0;
        root.style.setProperty("--kub-app-top", `${pan}px`);
        setShellFitsKeyboard(keyboardVisible);
        setKeyboardInset(0);
        return;
      }
      if (!isComposerFocused || !composerHasFocus) {
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

  // The channels, and the call.
  //
  // Two readers with very different lifetimes, deliberately.
  // `useServerChannels` belongs to this conversation and dies with it — it is
  // the group's own view of its rooms and of who is in each, read from the
  // database for everyone outside the call. `useVoiceCall` reads module state
  // that outlives every component, so opening another conversation unmounts
  // this whole tree without touching the connection or the microphone.
  //
  // `useVoiceChannel` reads nothing any more: it is the derivation that names
  // **one** room for the two surfaces that only ever knew about one, and which
  // room it names is decided against the call rather than against the list —
  // see the note there, and `voiceCallLostItsChannel`.
  const voiceEnabled = chat?.type === "group";
  /**
   * The group's own vocabulary, read once for the whole conversation (D-215).
   *
   * **Here rather than in the bubble, and rather than in `MessageList`**, for
   * the two reasons `useProfileBadges` and `useChatRoles` both state. In the
   * bubble it would be one round trip per message — two hundred for a chat
   * somebody has scrolled — and in `MessageList` it would be a second copy
   * beside `ChatInfoPanel`'s, because both are children of this component and
   * the panel is on screen at the same time as the list. This is the one place
   * that owns the conversation and everything drawn around it, so the answer is
   * fetched once here and handed to both.
   *
   * `enabled` is the chat's own type, because `private.enforce_chat_role_scope`
   * refuses a role in a private chat outright: a private conversation must not
   * spend a request finding out what the schema already guarantees.
   */
  const chatRolesEnabled = chat?.type === "group" || chat?.type === "channel";
  const chatRoles = useChatRoles(chatRolesEnabled ? chatId : null, chatRolesEnabled);
  /**
   * Whose name takes a colour, resolved once per read rather than per bubble.
   *
   * A primitive-stable map: the same `ChatRole` objects the hook holds, so a
   * memoised row that is handed one keeps comparing equal and does not render
   * again. See `topChatRolesByMember`.
   */
  const authorChatRoles = useMemo(
    () => topChatRolesByMember(chatRoles.assignments, chatRoles.roles),
    [chatRoles.assignments, chatRoles.roles],
  );
  const call = useVoiceCall();
  const serverChannels = useServerChannels(voiceEnabled ? chatId : null, voiceEnabled, topics);
  const voice = useVoiceChannel(serverChannels, call.channelId);
  // Whether this group gets the rail instead of the topic strip: anything at
  // all besides the one general channel. Read here rather than in the rail's
  // own section below, because the capsule under the header is drawn
  // differently once a list of rooms is on screen — see `capsuleChannel`.
  // F-6. The rooms have said «this read failed» since 2026-09-14; the text
  // channels are `useTopics`, which used to answer a refusal with `[]` — so a
  // forum whose `topics` read was refused drew itself as an ordinary chat, with
  // the rail gone and nothing anywhere saying a channel list existed. One
  // failure, told once, by the surface that was already built for it.
  const channelsUnreadable = serverChannels.failed || listReadFailed(topicsView);
  // `serverChannels` itself is a fresh object every render, so the dependency
  // is its `refresh` — which is a `useCallback` with no dependencies and really
  // is stable, and makes this one stable too.
  const refreshServerChannels = serverChannels.refresh;
  const retryChannels = useCallback(() => {
    refreshServerChannels();
    void refetchTopics();
  }, [refreshServerChannels, refetchTopics]);
  const railOffered =
    voiceEnabled && railIsOffered(serverChannels.channels, serverChannels.categories, channelsUnreadable, canManageTopics);
  const voiceDirectory = useMemo(() => {
    const names = new Map<string, string>();
    const faces = new Map<string, string | null>();
    // Roles too, from the same pass, for the moderation menu on an occupant
    // row (D-221). Without them the rail would have to offer «Заглушить» on
    // the owner of the group and let the gateway refuse — telling the reader a
    // rule the interface already knew.
    const roles = new Map<string, string | null>();
    for (const member of chat?.members ?? []) {
      names.set(member.user_id, member.profile?.full_name ?? "");
      faces.set(member.user_id, member.profile?.avatar_url ?? null);
      roles.set(member.user_id, (member.role as string | null) ?? null);
    }
    return { names, faces, roles };
  }, [chat?.members]);
  // A function rather than the map, because `null` and «absent» mean the same
  // thing to the rules and the caller should not have to know which it got:
  // somebody in the room with no membership row is a real state, and the one
  // where disconnecting them is the point.
  const voiceRoleOf = useCallback(
    (userId: string) => voiceDirectory.roles.get(userId) ?? null,
    [voiceDirectory.roles],
  );
  const inThisChannel = voice.channel !== null && call.channelId === voice.channel.id;
  // While connected the SDK is the truth (section 3.1): it holds a live
  // connection to every participant, where the table is a mirror that can be up
  // to one reconciliation period stale. Outside the call the table is all there
  // is.
  const voiceParticipants = useMemo(
    () =>
      inThisChannel && (call.phase === "connected" || call.phase === "reconnecting")
        ? renameVoiceParticipants(call.participants, voiceDirectory.names)
        : resolveVoiceParticipants(voice.participantIds, voiceDirectory.names),
    [call.participants, call.phase, inThisChannel, voice.participantIds, voiceDirectory.names],
  );
  /**
   * The channel the capsule under the header speaks for, which is now a
   * question it did not use to have: `capsuleNamesARoom`.
   *
   * One room, or a call — the capsule names it, exactly as it did. Several
   * rooms and no call — nothing, because the room it would name is whichever
   * one came first rather than a fact about the group. Photographed in the
   * rail's first capture as «Курилка · Никого нет · Присоединиться» beside a
   * rail listing three rooms and saying where everybody was.
   *
   * `voice.channel` itself is untouched: `voiceCallLostItsChannel` reads it to
   * decide whether an administrator ended the call, and it has to keep seeing
   * the room the call is in whatever the capsule draws.
   */
  const capsuleChannel = capsuleNamesARoom(serverChannels.channels, call.channelId) ? voice.channel : null;
  /**
   * The room this person is in on another of their devices, read once here and
   * handed to all three surfaces that offer a way into a room.
   *
   * One answer rather than three, for the reason the bar and the capsule share
   * one `VoiceCallState`: a rail that thought the press was a join while the
   * capsule thought it was a move would be two answers to one question. The
   * fact itself is global — the reader is mounted by `Sidebar` — so this is a
   * subscription, not a read.
   */
  const voiceElsewhereRoom = useVoiceElsewhere();
  const voiceCapsule = voiceCapsuleState({
    channel: capsuleChannel,
    phase: call.phase,
    callChannelId: call.channelId,
    participants: voiceParticipants,
    selfId: userId,
    micMuted: call.micMuted,
    canPublish: call.canPublish,
    refusal: call.refusal,
    // The browser's answer to «send this call to that headset», carried through
    // so the capsule can decline to claim a move that did not happen.
    outputDeviceRefused: call.outputDeviceRefused,
    deafened: call.deafened,
    // Never a plain «Присоединиться» to a room this person is already in
    // somewhere else: that is the press that takes the conversation off their
    // other device without saying so. `lib/voiceElsewhere.ts` holds the rule.
    elsewhere: voiceJoinIsAMove(capsuleChannel?.id ?? null, voiceElsewhereRoom),
  });
  const joinVoice = useCallback(() => {
    if (!voice.channel || !chat) return;
    void joinVoiceChannel({ channelId: voice.channel.id, chatId: chat.id, channelName: voice.channel.name });
  }, [chat, voice.channel]);
  const leaveVoice = useCallback(() => {
    void leaveVoiceCall();
  }, []);
  const toggleVoiceMute = useCallback(() => {
    void setVoiceMuted(!voiceCallSnapshot().micMuted);
  }, []);
  /**
   * Deafen, read from the snapshot rather than from `call`.
   *
   * The same reason the mute above does it: this callback has no dependencies
   * and is therefore stable, so the capsule does not get a new function on every
   * render of this component — and a stale `call.deafened` captured in a closure
   * is how a toggle stops toggling.
   */
  const toggleVoiceDeafen = useCallback(() => {
    void setVoiceDeafened(!voiceCallSnapshot().deafened);
  }, []);

  // ── The channel rail ─────────────────────────────────────────────────────
  //
  // It replaces the topic strip for a group that has anything besides the one
  // general channel, which is the shape change the owner asked for: a forum's
  // horizontal capsules become a server's vertical list. `railOffered` is
  // decided above, beside the capsule that changes with it.
  const [railOpen, setRailOpen] = useState(false);
  // Whether there is room for the rail as a column, measured against the pane
  // and never against the viewport — for the reason `ChatInfoPanel` measures
  // the pane: the chat list is dragged by hand, so one window width gives many
  // pane widths, and a breakpoint would put a 224px column into a 336px pane at
  // exactly `md`. Only the ANSWER is state, so a drag re-renders this once, when
  // the pane crosses the width at which the shape actually changes.
  //
  // `useLayoutEffect`, so the answer is in before the browser paints: in an
  // effect the conversation would be laid out full width for one frame and lose
  // 224px in the next, which is a flinch on every open.
  const paneRef = useRef<HTMLDivElement>(null);
  const [railFitsColumn, setRailFitsColumn] = useState(false);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return undefined;
    const read = () => {
      const next = paneFitsChannelRail(pane.getBoundingClientRect().width);
      setRailFitsColumn((current) => (current === next ? current : next));
    };
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    // The pane, not the rail: the rail takes its width out of the pane, so the
    // pane's own width is the same number either way and this cannot feed itself.
    const observer = new ResizeObserver(read);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  // A window widened while the sheet is open has nowhere to put it.
  useEffect(() => {
    if (railFitsColumn) setRailOpen(false);
  }, [railFitsColumn]);

  const railTextChannelId = currentTextChannelId(serverChannels.channels, selectedTopicId);
  const railTextChannel = serverChannels.channels.find((channel) => channel.id === railTextChannelId) ?? null;
  // Who is in a room. The SDK while connected, the table otherwise — the same
  // split `voiceParticipants` makes for the capsule, applied per room, because
  // only one of these rooms can be the one this client is connected to.
  const occupantsOf = useCallback(
    (channelId: string) =>
      channelId === call.channelId && (call.phase === "connected" || call.phase === "reconnecting")
        ? renameVoiceParticipants(call.participants, voiceDirectory.names)
        : resolveVoiceParticipants(serverChannels.participants.get(channelId) ?? [], voiceDirectory.names),
    [call.channelId, call.participants, call.phase, serverChannels.participants, voiceDirectory.names],
  );
  const occupiedRooms = serverChannels.channels.filter(
    (channel) => channel.kind === "voice" && occupantsOf(channel.id).length > 0,
  ).length;
  const selectChannel = useCallback(
    (channel: ServerChannel) => {
      // `null` for the general channel: the store holds the general stream as
      // null and `useTopics` resets anything else to it within a render.
      setSelectedTopicId(topicIdForChannel(channel));
      setRailOpen(false);
    },
    [setSelectedTopicId],
  );
  const joinVoiceRoom = useCallback(
    (channel: ServerChannel) => {
      if (!chat) return;
      // One click on another room is the whole switch: `joinVoiceChannel`
      // leaves the room it finds this client in before it joins the next.
      void joinVoiceChannel({ channelId: channel.id, chatId: chat.id, channelName: channel.name });
      setRailOpen(false);
    },
    [chat],
  );
  // Creating, renaming, reordering and deleting channels is `ChannelManageModal`,
  // built beside this rail and raised through an event rather than mounted per
  // surface — so the settings screen and the rail open one dialog with one
  // state rather than two copies of it. The rail knows only this callback; the
  // dialog decides for itself whether this reader may see it.
  const manageChannels = useCallback(() => {
    requestChannelManage({ chatId, chatName: chat?.name ?? null, role: myRole });
    setRailOpen(false);
  }, [chat?.name, chatId, myRole]);
  const railProps = {
    groups: serverChannels.groups,
    currentTextChannelId: railTextChannelId,
    occupantsOf,
    faces: voiceDirectory.faces,
    roleOf: voiceRoleOf,
    selfId: userId,
    role: myRole,
    callChannelId: call.channelId,
    // The room on another device, so a row for it says «Перейти» rather than
    // drawing as an ordinary room somebody may walk into twice.
    elsewhereChannelId: voiceElsewhereRoom?.channelId ?? null,
    joining: call.phase === "joining",
    onSelectText: selectChannel,
    onJoinVoice: joinVoiceRoom,
    // The rail draws the control for an administrator; the dialog refuses to
    // open for anyone else. Both, because a control that does nothing is worse
    // than no control and a dialog that trusts its caller is worse than both.
    onManageChannels: canManageTopics ? manageChannels : undefined,
    // A read that failed keeps the rail on screen and says so, instead of
    // taking the channels away with no sentence anywhere. See
    // `ServerChannelsView.failed`.
    failed: channelsUnreadable,
    onRetry: retryChannels,
  };

  /**
   * An administrator ended the voice chat, so this client's call ends too.
   *
   * Ending is a DELETE of the channel row; the SFU keeps the room for another
   * minute and no client call closes it sooner. Without this the capsule — the
   * only «Выйти» there is in slice 2 — would disappear from under somebody who
   * is still connected and still audible, and the only way out would be a
   * reload. The rule itself is in `lib/voiceChannel.ts`, including why only
   * this chat's own view is allowed to speak for this chat's channel.
   */
  useEffect(() => {
    if (
      !voiceCallLostItsChannel({
        callChannelId: call.channelId,
        callChatId: call.chatId,
        // The chat the view was **read for**, not the one that is open: they
        // differ for as long as a read takes, and reading the wrong one hangs
        // up a live call on the way back to the conversation it is in.
        chatId: voice.chatId,
        // A read that failed is not evidence that the room is gone. `ready`
        // means «an answer came back», and an error is an answer that says
        // nothing about this group — see `ServerChannelsView.failed`.
        ready: voice.ready && !voice.failed,
        supported: voice.supported,
        channel: voice.channel,
        // Only a group's call is the rail's to end. A private chat's call
        // room is not listed there, so «no channel» is the ordinary state
        // rather than evidence that anybody ended anything.
        chatType: chat?.type ?? null,
      })
    ) {
      return;
    }
    void leaveVoiceCall();
  }, [
    call.channelId,
    call.chatId,
    chat?.type,
    voice.chatId,
    voice.channel,
    voice.ready,
    voice.supported,
  ]);

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

    // D-208: the row records the bucket and the path beside this, and those two
    // are what a reader resolves from. The URL is still written because 20 rows
    // predate the columns and the projection reads it as a fallback; it is the
    // public one, because a signature would be dead long before the message is.
    const publicUrl = publicMediaObjectUrl({ bucket: CHAT_MEDIA_BUCKET, path: uploadedPath });
    return {
      bucket: CHAT_MEDIA_BUCKET,
      path: uploadedPath,
      publicUrl: publicUrl ?? "",
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

    // D-286: from here the caption belongs to the attachment, not to this
    // call. The attach sheet closes on send and keeps nothing; the composer
    // restores what it cleared, but a sheet has nowhere to restore to. Without
    // this the retry of a failed send had no caption to send.
    const captionCarrier = captionCarrierId(targets, captionText, false);
    for (const attachment of targets) {
      updateStagedAttachment(attachment.id, (current) => ({
        ...current,
        caption: attachment.id === captionCarrier ? captionText : null,
      }));
    }

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
      // The caption is a message of its own now, so the attachment must not
      // send it a second time when it is retried.
      if (captionCarrier) {
        updateStagedAttachment(captionCarrier, (current) => ({ ...current, caption: null }));
      }
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
    // With the caption the send was asked for, not without it (D-286).
    const attachment = stagedAttachmentsRef.current.find((item) => item.id === attachmentId);
    void sendStagedAttachments(attachment?.caption ?? "", attachmentId);
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

  /**
   * Running a command that is already in the conversation (D-263).
   *
   * `sendMessage` directly rather than `handleSend`, and that is the decision
   * rather than a shortcut: `handleSend` gives the text to whatever the
   * composer is holding — a forward waiting for a comment, a staged
   * attachment, the reply a different message is aimed at — and a command
   * pressed in the scrollback asked for none of them. Measured on the device,
   * Telegram's tap sends the command and nothing else.
   */
  const runBotCommand = useCallback((content: string) => {
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять сообщения.", "Сообщение");
      return;
    }
    void sendMessage(content);
  }, [sendMessage, userId]);

  /**
   * What makes a `/command` in the conversation pressable, or null (D-263).
   *
   * Null unless this chat holds a reachable bot **that registered at least one
   * command**: with an empty vocabulary nothing can match, so the scan is not
   * worth running over every message on screen. `botAddressing` is the one the
   * composer's menu uses, so the token a reader presses and the draft the menu
   * writes address the same bot by construction.
   */
  const botCommandsInText = useMemo<BotCommandsInText | null>(
    () =>
      botChat.botId && botChat.commands.length > 0
        ? { commands: botChat.commands, addressing: botAddressing, onRun: runBotCommand }
        : null,
    [botAddressing, botChat.botId, botChat.commands, runBotCommand],
  );

  /**
   * A draft asked for from outside the pane — a command chosen on a bot's card
   * (D-263).
   *
   * The card is mounted over the shell, not inside this tree, so the request
   * travels through the store the way `chatPanelRequest` already does, and the
   * `key` is what makes the same command chosen twice arrive twice. It lands in
   * the composer through `draftOverride`, which is the door a restored draft
   * already uses: one way in, so the focus and the edit-cancel that come with
   * it are not written a second time.
   */
  const composerDraftRequest = useAppStore((s) => s.composerDraftRequest);
  const clearComposerDraftRequest = useAppStore((s) => s.clearComposerDraftRequest);
  useEffect(() => {
    if (!composerDraftRequest || composerDraftRequest.chatId !== chatId) return;
    setDraftRestore({ id: `composer-request:${composerDraftRequest.key}`, text: composerDraftRequest.text });
    clearComposerDraftRequest(composerDraftRequest.key);
  }, [chatId, clearComposerDraftRequest, composerDraftRequest]);

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

  /**
   * The conversation's own pictures and videos, and where the open one stands
   * among them (D-288).
   *
   * What the sequence *is* — the chat rather than the message, chronological
   * rather than the grid's order — is decided in `lib/conversationMedia.ts`
   * against a measurement of Telegram; this is only the wiring.
   *
   * The item is built here rather than in the bubble's press, for the reason
   * `ChatInfoPanel` gives for doing the same: a photograph reached by a swipe
   * must be the same object a tap on it would have produced, or the «Оригинал»
   * badge and the preview would depend on how the reader arrived.
   */
  const conversationMedia = useMemo(() => conversationMediaRows(conversation), [conversation]);
  const openMediaIndex = conversationMediaIndex(conversationMedia, openMediaId);
  const openMediaRow = openMediaIndex === null ? null : conversationMedia[openMediaIndex] ?? null;
  const openMediaUrl = useMessageMediaUrl(openMediaRow);
  const openMediaItem: MediaViewerItem | null = openMediaRow && openMediaUrl
    ? {
      type: openMediaRow.type === "video" ? "video" : "image",
      url: openMediaUrl,
      title: openMediaRow.content ?? (openMediaRow.type === "video" ? "Видео" : "Фото"),
      originality: mediaOriginality(openMediaRow.media_metadata),
      ...(isUncompressedMedia(openMediaRow.media_metadata)
        ? {
          original: true,
          previewUrl:
            messageMediaVariants[openMediaRow.id]?.previewUrl ?? resolveOriginalPreviewUrl(openMediaRow)?.url,
        }
        : {}),
    }
    : null;
  /**
   * A step past the oldest loaded picture, waiting for the history it asked for.
   *
   * The grid's `pendingViewerStep` pointed at the forward end; this one points
   * backward, because a conversation's next page is *older* and lands in front.
   * Held until the rows arrive and then taken, so the reader ends up on the
   * previous photograph rather than on the one they were already looking at.
   * Released either way: a page that failed or brought no picture ends the wait.
   */
  const [pendingMediaStepBack, setPendingMediaStepBack] = useState(false);
  useEffect(() => {
    if (!pendingMediaStepBack) return;
    if (openMediaIndex === null) {
      setPendingMediaStepBack(false);
      return;
    }
    if (openMediaIndex > 0) {
      setOpenMediaId(conversationMedia[openMediaIndex - 1]?.id ?? null);
      setPendingMediaStepBack(false);
    } else if (!loadingOlder && !hasMoreOlder) {
      setPendingMediaStepBack(false);
    }
  }, [conversationMedia, hasMoreOlder, loadingOlder, openMediaIndex, pendingMediaStepBack]);

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
        ref={paneRef}
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
      {/* The rail before the conversation, as a server puts it. In flow, so the
          conversation loses exactly its width and the chrome measured inside
          that column is unaffected — the header, the composer and the scroll
          insets all belong to the conversation, not to the pane. */}
      {railOffered && railFitsColumn && <ChannelRail {...railProps} />}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {loading || historyPending ? (
          <div className="flex-1 flex items-center justify-center chat-bg">
            <KubIcon name="spinner" size={28} className="text-[color:var(--kub-cyan)]" />
          </div>
        ) : historyError ? (
          <div className="flex-1 flex items-center justify-center chat-bg">
            <KubEmptyState
              icon={<KubIcon name="chatRect" size={24} />}
              title="Историю не удалось проверить"
              description={historyError}
              action={<KubButton type="button" variant="secondary" onClick={() => void refetchMessages()}>Повторить</KubButton>}
            />
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
            onOpenMedia={setOpenMediaId}
            bottomRef={bottomRef}
            isTyping={isTyping}
            highlightedId={highlightedId}
            messageRefs={messageRefs}
            chatMembers={chat?.members}
            chatType={chat?.type}
            isSavedChat={savedChat}
            myRole={myRole}
            authorChatRoles={authorChatRoles}
            botCommands={botCommandsInText}
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

          {/* Above the rail's trigger, because the call is about the chat and
              the trigger is about the conversation (section 4.1). Once the rail
              is offered this draws only a call this client is in: joining is
              the rail's job — see `capsuleChannel`. */}
          <VoiceCallCapsule
            channel={capsuleChannel}
            participants={voiceParticipants}
            faces={voiceDirectory.faces}
            selfId={userId}
            view={voiceCapsule}
            onJoin={joinVoice}
            onLeave={leaveVoice}
            onToggleMute={toggleVoiceMute}
            onToggleDeafen={toggleVoiceDeafen}
          />

          {/* The strip survives exactly where the rail is not offered: a forum
              whose only channel is the conversation. Everything else — a second
              text channel, a room, a heading — gets the rail instead, which is
              the shape change rather than a rename of this one. */}
          {isForum && !railOffered && (
            <TopicStrip
              topics={topics}
              canManage={canManageTopics}
              onCreate={createTopic}
              unreadable={channelsUnreadable}
              onRetry={retryChannels}
            />
          )}

          {/* Where the strip was, when the pane has no room for a column: the
              channel being read, and how many rooms have somebody in them. */}
          {railOffered && !railFitsColumn && railTextChannel && (
            <ChannelRailTrigger
              channelName={railTextChannel.name}
              emoji={railTextChannel.emoji}
              occupiedRooms={occupiedRooms}
              open={railOpen}
              onOpen={() => setRailOpen(true)}
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
            refusal={actionRefusal}
            onDismissRefusal={clearActionRefusal}
            bot={
              botChat.botId
                ? {
                    commands: botChat.commands,
                    needsStart: botNeedsStart,
                    addressing: botAddressing,
                    // «Запустить» sends `/start`, which is the whole of what
                    // Telegram's Start does: the bot learns about the person
                    // from an ordinary message, and the composer comes back
                    // because `botChatNeedsStart` now finds one from them.
                    onStart: () => { handleSend(BOT_START_COMMAND); },
                  }
                : null
            }
          />
        </div>
      </div>
      {showInfo && chat && (
        <ChatInfoPanel
          chat={chat}
          onClose={() => setShowInfo(false)}
          onClearForMe={clearChatForMe}
          // The same read the conversation is drawn from. The panel used to
          // mount `useChatRoles` itself; with the author line now needing the
          // answer too, that would have been two identical round trips
          // whenever the card is open beside the list.
          chatRoles={chatRoles}
          voice={{
            // The same rule the capsule uses, and for the same reason: with
            // several rooms in the group, naming one of them here would be
            // naming whichever came first, which is not a fact about the
            // group. The rail is where a choice between rooms is made.
            channel: capsuleChannel,
            participants: voiceParticipants,
            faces: voiceDirectory.faces,
            inCall: inThisChannel && (call.phase === "connected" || call.phase === "reconnecting"),
            // The same answer the capsule takes, from the same place.
            elsewhere: voiceJoinIsAMove(capsuleChannel?.id ?? null, voiceElsewhereRoom),
            busy: inThisChannel && call.phase === "joining",
            refusal: call.refusal,
            supported: voice.supported,
            ready: voice.ready,
            viewChatId: voice.chatId,
            onJoin: joinVoice,
            onLeave: leaveVoice,
            onRefresh: voice.refresh,
          }}
        />
      )}
      {/* Out here rather than inside the chrome stack: the sheet is `fixed`,
          and a stack that ever gains a `backdrop-filter` of its own would
          become its containing block (rule 3). Its siblings here — the contact
          card, the viewer, the dialogs — are placed for the same reason. */}
      {railOffered && !railFitsColumn && railOpen && (
        <ChannelRailSheet {...railProps} onClose={() => setRailOpen(false)} />
      )}
      {/* The dialog the rail's control asks for. Mounted here because the one
          in the settings screen only exists while that screen is open, and the
          rail's control is offered while it is not. The host claims the event
          once per document, so the two never answer one request twice.
          Unconditional on purpose: the claim is taken by whichever host mounts
          first and a host that loses it never asks again, so this one has to be
          in place from the moment the conversation opens rather than from the
          moment the rail is first offered. */}
      <ChannelManageDialogHost />
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
      {/* One picker for every «Пожаловаться» in this pane — the message menus,
          the header menu and the contact card all sit inside it. */}
      <ReportDialogHost />
      <MessageDeleteDialogHost
        chatId={chatId}
        messages={conversation}
        chatType={chat?.type}
        isSavedChat={savedChat}
        otherName={chat?.type === "private" ? getChatDisplayInfo(chat, userId).title : null}
        currentUserId={userId}
        onDelete={handleDeleteMessages}
      />
        {/* A place in the conversation, not a single detached picture (D-288).
            Stepping past the oldest loaded one asks the conversation for its
            next page of history instead of stopping — the mechanic the grid
            already runs at its own far end, pointed the other way. */}
        <MediaViewer
          media={openMediaItem}
          onClose={() => setOpenMediaId(null)}
          sequence={openMediaRow && openMediaIndex !== null ? {
            state: {
              index: openMediaIndex,
              loaded: conversationMedia.length,
              total: conversationMedia.length,
              // Never exact while older history is unread: this surface counts
              // what it has loaded, not what the chat holds, so «7+» is the
              // true answer and «7» would be a claim it cannot make.
              totalExact: !hasMoreOlder,
              hasMore: hasMoreOlder,
              loading: loadingOlder,
              moreAt: "start",
            },
            onSelect: (index) => setOpenMediaId(conversationMedia[index]?.id ?? null),
            onNeedMore: () => {
              setPendingMediaStepBack(true);
              void loadOlderMessages();
            },
            stamp: mediaDayLabel(openMediaRow.created_at, Date.now()),
          } : undefined}
        />
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
