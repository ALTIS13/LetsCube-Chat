"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { publicMediaObjectUrl } from "@/lib/media/mediaUrl";
import { useMessageMediaUrl } from "@/hooks/useMediaObjectUrl";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar, UserAvatar } from "@/components/ui/ChatAvatar";
import { KubBadge, KubButton, KubIcon, KubModal, KubNotice, KubStableSkeleton, type KubIconName } from "@/components/kub";
import { cn } from "@/lib/utils";
import { mapPgError, prefixError } from "@/lib/errors";
import { avatarUploadPath, prepareAvatarImage, validateAvatarImage, validateAvatarUploadImage } from "@/lib/mediaUpload";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { chatVocabulary, countedMemberLabel } from "@/lib/chatVocabulary";
import { usePermissionAccess } from "@/hooks/useRole";
import type { ChatRolesView } from "@/hooks/useChatRoles";
import { ChatRolesModal } from "./ChatRolesModal";
import { ChatRoleChip } from "./ChatRoleChip";
import { MemberCard, type MemberRow } from "./MemberCard";
import { DISABLED_SINK } from "@/lib/controlSurface";
import { chatRoleAssignDenial, topChatRole, type ChatRole } from "@/lib/chatRoles";
import { chatInviteAdmission } from "@/lib/chatInviteAccess";
import {
  inviteState,
  invitesEmptyText,
  invitesWaitingLine,
  type InviteTone,
} from "@/lib/groupInviteCopy";
import { dispatchChatsRefresh, KUB_CHATS_REFRESH_EVENT, type ChatsRefreshDetail } from "@/lib/chatEvents";
import { requestAppConfirm, showAppAlert } from "@/lib/appDialogs";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import { MediaViewer, type MediaViewerItem } from "./MediaViewer";
import { ChatSettingsView } from "./ChatSettingsView";
import {
  chatProfileDirty,
  chatSettingsRows,
  type ChatSettingsRowId,
} from "@/lib/chatSettings";
import { BotLikeAvatar } from "@/components/bots/BotAvatar";
import { BotTag } from "@/components/bots/BotTag";
import {
  type ChatBotMember,
  fetchChatBotMemberships,
  removeChatBot,
} from "@/lib/chatBotMembership";
import {
  BOT_MEMBERS_EMPTY,
  BOT_MEMBERS_HEADING,
  BOT_MEMBERS_HISTORY_NOTE,
  BOT_REMOVE_FAILED,
  BOT_REMOVE_LABEL,
  BOT_REMOVING_LABEL,
  botDisplayName,
  botMemberStatusLine,
  botMembershipFailureMessage,
  chatBotPartner,
  type BotLike,
} from "@/lib/chatBots";
import { GroupInviteModal } from "./GroupInviteModal";
import { VoiceChannelRow } from "./VoiceChannelRow";
import {
  voiceChannelRowOffer,
  type VoiceChannelSummary,
  type VoiceParticipant,
} from "@/lib/voiceChannel";
import { ProfileBadgeChip } from "@/components/profile/ProfileBadgeChip";
import { ProfileRoleSummary } from "@/components/profile/ProfileRoleSummary";
import {
  chatMemberRowFacts,
  formatJoinedAt,
  formatUsername,
  memberDisplayName,
  memberListFailure,
  sortChatMembers,
  MEMBERS_EMPTY,
  MEMBERS_UNAVAILABLE_DETAIL,
  type ChatMemberRowFacts,
} from "@/lib/chatMemberList";
import { getUserPresenceState } from "@/lib/presence";
import { usePresenceNow } from "@/hooks/usePresenceNow";
import { useCreateChat } from "@/hooks/useCreateChat";
import { CHAT_OPEN_FAILED } from "@/lib/plainMessages";
import { KUB_ICON_NAMES } from "@/components/kub/icons";
import { useProfileBadges } from "@/hooks/useProfileBadges";
import {
  badgeStrip,
  projectProfileBadges,
  type BadgeStrip,
} from "@/lib/profileBadges";
import {
  cancelGroupInvite,
  createGroupInvite,
  formatGroupInviteError,
  GROUP_INVITES_MIGRATION_REQUIRED,
  INVITE_POLICY_MIGRATION_REQUIRED,
  isGroupInviteUnavailableError,
  isInvitePolicyUnavailableError,
} from "@/lib/groupInvites";
import type { GroupInviteStatus, InvitePolicy } from "@/lib/groupInvites";
import type { ChatWithLastMessage, Profile, Message } from "@/types/database";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { CHAT_NAME_MAX_LENGTH, limitText } from "@/lib/entityLimits";
import { resolveOriginalPreviewUrl, useMessageMediaVariantUrls, type MessageMediaVariantUrls } from "@/hooks/useMediaVariants";
import { isUncompressedMedia } from "@/lib/mediaCompression";
import { cacheControlFor } from "@/lib/mediaCacheControl";
import { useRowPressActions } from "@/hooks/useRowPressActions";
import {
  RowActionHeader,
  RowActionMenu,
  RowActionSheet,
  rowMenuPlacement,
  type RowAction,
  type RowMenuPlacement,
} from "@/components/kub/RowActions";
import {
  canDemoteFromAdmin,
  canPromoteToAdmin,
  canRemoveMember,
  canTransferOwnership,
  chatRoleLabel,
  hasAnyMemberAction,
  type ChatMemberSubject,
} from "@/lib/chatMemberRules";
import { currentViewport, type Point, type WindowPlacement } from "@/lib/floatingWindow";
import { NO_SAFE_AREA_INSETS, readSafeAreaInsets, safeViewport, type SafeAreaInsets } from "@/lib/safeArea";
import {
  paneFitsProfileColumn,
  profileDragPosition,
  profileWindowFrame,
  readProfileWindowPlacement,
  resolveProfileWindowEscape,
  resolveProfileWindowPlacement,
  shouldStartProfileDrag,
  writeProfileWindowPlacement,
} from "@/lib/profileWindow";
import {
  buildMessageMediaSections,
  extractFirstLink,
  isGridMediaKind,
  parseMessageMediaCounts,
  resolveActiveMediaSection,
  type ChatMediaCountRow,
  type MessageMediaCounts,
  type MessageMediaKind,
} from "@/lib/messageMediaSections";
import {
  MEDIA_MONTH_MARKER_LINGER_MS,
  SHARED_MEDIA_PAGE_FAILED_ACTION,
  currentMediaMonth,
  groupMediaByMonth,
  mediaDayLabel,
  mediaEmptyState,
  mediaMonthMarkerShown,
  mediaTailState,
  type MediaMonthAnchor,
} from "@/lib/sharedMediaBrowsing";
import { copyWithFeedback, showActionFeedback } from "@/lib/actionFeedback";
import {
  BLOCK_LABEL,
  REPORT_LABEL,
  UNBLOCK_LABEL,
  blockPrompt,
  canBlockInChat,
  unblockPrompt,
} from "@/lib/personalModeration";
import { usePersonalBlocks } from "@/hooks/usePersonalModeration";
import { requestContentReport } from "./ReportDialog";
import { useChatMute } from "@/hooks/useChatMute";
import {
  chatMuteChoiceTitle,
  chatMuteMenuEntries,
  type ChatMuteOptionId,
} from "@/lib/chatMute";

/**
 * The voice channel, handed down rather than read here.
 *
 * `ChatWindow` owns the subscription because the capsule under its header needs
 * the same two tables: reading them in both places would be two Realtime
 * channels and two queries per chat, and — worse — two views that can disagree
 * about who is in the room while the panel is open beside the capsule.
 */
export interface ChatInfoVoice {
  channel: VoiceChannelSummary | null;
  participants: readonly VoiceParticipant[];
  faces?: ReadonlyMap<string, string | null>;
  /** True when this client is connected to this chat's channel. */
  inCall: boolean;
  /**
   * True when this person is in this chat's channel on **another** of their
   * devices. The row then offers the move and not the ordinary join — see
   * `lib/voiceElsewhere.ts`.
   */
  elsewhere: boolean;
  /** True while a join to this chat's channel is in flight. */
  busy: boolean;
  refusal: string | null;
  /**
   * False where this deployment has no voice tables at all, and false until the
   * first read has come back. Both are states in which the row must draw
   * nothing rather than a way into a room it cannot describe yet.
   */
  supported: boolean;
  ready: boolean;
  /**
   * The chat this voice view was read for. This card stays open across a change
   * of conversation and the hook keeps the previous answer until the new read
   * lands, so an administrator handed a stale one would be offered a control
   * that deletes a **different** conversation's channel.
   */
  viewChatId: string | null;
  onJoin: () => void;
  onLeave: () => void;
  /** Re-read the channel after this panel has written one, or deleted one. */
  onRefresh: () => void;
}

interface ChatInfoPanelProps {
  chat: ChatWithLastMessage;
  onClose: () => void;
  onClearForMe?: () => Promise<{ ok: boolean; error: string | null }>;
  voice?: ChatInfoVoice;
  /**
   * The group's own vocabulary and who wears what (D-215), read by whoever owns
   * the conversation rather than here.
   *
   * It was `useChatRoles(chat.id, isGroup)` in this component until the author
   * line of a message needed the same answer. Two mounts are two identical
   * round trips whenever this card is open beside the conversation — which is
   * its normal state on a wide window — so the read moved up to `ChatWindow`,
   * the one component that renders both. A prop rather than a context because
   * there is exactly one caller and a context would hide the count.
   */
  chatRoles: ChatRolesView;
}

type Tab = "info" | "members";

/**
 * The card root, and the contents of one media kind.
 *
 * The division used to live behind this boundary: «Общие медиа» pushed into a
 * sub-view whose own strip of tabs said what the chat contained. The counts are
 * in the card's scroll now — one row per kind, «1543 фотографии» — and the
 * sub-view is only the contents of the row that was pressed. What is left of
 * the push is the same push: one layer at a time, a back control, Escape to pop.
 */
// `member` is the fourth, added by D-168: a member row had no way to reach the
// person it draws. It rides the same machinery deliberately — the header's back
// arrow, Escape, and the title bar all key off `view !== "root"` and needed no
// change to carry it.
type CardView = "root" | "gallery" | "settings" | "member";

const MEDIA_PAGE_SIZE = 24;

/**
 * Links live in ordinary text messages, so they are paged by a query of their
 * own rather than with the media.
 */
const LINK_PAGE_SIZE = 60;

/** The message types that can carry an attachment worth listing. */
type MediaMessageType = Message["type"];
const MEDIA_MESSAGE_TYPES: readonly MediaMessageType[] = ["image", "video", "file", "audio"];

/**
 * Which message types a kind can be built from.
 *
 * Opening a kind narrows the query to these, so «Файлы» is reachable in a chat
 * whose recent pages hold nothing but photos. Several kinds share a type — a
 * voice note and an attached track are both `audio`, a round message and a clip
 * are both `video` — so the classifier still has the last word; this only keeps
 * the request from spending its page on rows that cannot possibly belong.
 * `link` is absent because links come from the text query instead.
 */
const MEDIA_KIND_MESSAGE_TYPES: Record<MessageMediaKind, readonly MediaMessageType[]> = {
  photo: ["image"],
  video: ["video"],
  gif: ["image", "video"],
  file: ["file"],
  link: [],
  voice: ["audio"],
  videoMessage: ["video"],
  audio: ["audio"],
};

/**
 * `joined_at` arrives as of D-168. It is `not null` on `chat_members` in
 * production and was simply never selected; it is optional here because a row
 * built from anything but that query — a fixture, a test — has no reason to
 * carry it, and `formatJoinedAt` says so rather than guessing.
 */
type InviteWithProfiles = {
  id: string;
  invitee_id: string;
  inviter_id: string;
  status: GroupInviteStatus;
  created_at: string;
  expires_at: string | null;
  responded_at: string | null;
  invitee: Profile | null;
  inviter: Profile | null;
};

const DEFAULT_INVITE_POLICY: InvitePolicy = "owner_admin_only";

/** One icon per section of the shared-media sub-view. */
const MEDIA_SECTION_ICONS: Record<MessageMediaKind, KubIconName> = {
  photo: "image",
  video: "video",
  gif: "play",
  file: "file",
  link: "externalLink",
  voice: "voice",
  videoMessage: "video",
  audio: "volume",
};

export function ChatInfoPanel({ chat, onClose, onClearForMe, voice, chatRoles }: ChatInfoPanelProps) {
  const { currentUser, setSelectedChatId, chats, setChats, setMessages } = useAppStore();
  const supabase = createClient();
  // The identity, not the object. The store hands back a fresh `currentUser`
  // whenever anything on the profile changes, and the media loaders are keyed
  // on their dependencies: with the object in there, a presence update would
  // re-run them and empty the counts the card is showing.
  const currentUserId = currentUser?.id ?? null;
  const display = getChatDisplayInfo(chat, currentUser?.id ?? null);
  const isSaved = display.isSaved;
  const isGroup = !isSaved && (chat.type === "group" || chat.type === "channel");
  // D-169: this card called both of them a group. `isGroup` stays — a channel
  // really is a group as far as every rule in this component goes, because the
  // database gives it the same members, the same roles and the same permission
  // to post — but what the card SAYS now comes from the chat's own type.
  const words = chatVocabulary(chat.type);
  const storedMemberRole: "owner" | "admin" | "member" | null =
    (chat.members?.find((m) => m.user_id === currentUser?.id)?.role as
      | "owner" | "admin" | "member" | undefined) ?? null;
  const canHidePrivateChat = chat.type === "private" && !isSaved;
  const isPinned = Boolean(chat.is_pinned);
  // D-167: what the account holds, read from `chat_notification_preferences`,
  // rather than what this browser once wrote to `ng_muted`.
  const { state: muteState, setMute } = useChatMute(chat.id);

  /** Whether the notifications row has opened into its durations. */
  const [muteChoiceOpen, setMuteChoiceOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("info");
  const [view, setView] = useState<CardView>("root");
  const [mediaSection, setMediaSection] = useState<MessageMediaKind | null>(null);
  const [editing, setEditing] = useState(false);
  /** Which settings row has opened its choice in place. */
  const [settingsRow, setSettingsRow] = useState<ChatSettingsRowId | null>(null);
  const [topicsBusy, setTopicsBusy] = useState(false);
  const [name, setName] = useState(chat.name ?? "");
  const [description, setDescription] = useState(chat.description ?? "");
  const [saving, setSaving] = useState(false);
  const [deletingChat, setDeletingChat] = useState(false);
  const [leavingChat, setLeavingChat] = useState(false);
  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
  const [leaveGroupOpen, setLeaveGroupOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [assigningRole, setAssigningRole] = useState<string | null>(null);
  const [destructiveError, setDestructiveError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  /** Starting a voice chat, ending one, the question before the end, and its refusal. */

  // --- The card as a window ------------------------------------------------
  // It used to be a 320px column welded to the right edge for as long as it was
  // open. It is the same panel with the same actions; only where it sits moved.
  // Every rule about where it may sit is in `@/lib/profileWindow`, on top of the
  // geometry the support window already uses — what is left here is wiring.
  const [viewport, setViewport] = useState(currentViewport);
  // The notch and the home indicator. The card is placed in the part of the
  // screen they leave alone and drawn offset by them, so every rule that keeps
  // it on screen keeps it off the hardware too — see `safeViewport`.
  const [insets, setInsets] = useState<SafeAreaInsets>(NO_SAFE_AREA_INSETS);
  const [placement, setPlacement] = useState<WindowPlacement>(() =>
    resolveProfileWindowPlacement(readProfileWindowPlacement(), currentViewport()),
  );
  // The pointer-up that ends a drag must persist the position the last
  // pointer-move produced, not the one this render happened to close over.
  const placementRef = useRef<WindowPlacement>(placement);
  const dragRef = useRef<{ pointerId: number; origin: Point; start: Point } | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const applyPlacement = useCallback((next: WindowPlacement) => {
    placementRef.current = next;
    setPlacement(next);
  }, []);
  // Whether the pane beside the conversation can hold the card as a column
  // (D-161). Only the ANSWER is state, never the width: the chat list is
  // dragged by hand and its width is written straight onto the document
  // precisely so that a drag costs no React render (`ChatListResizer`, and
  // tests/e2e/chat-list-event-cost.spec.ts holds those counts). Keeping the
  // measurement here would put every frame of that drag back through this
  // component and the message list beside it; keeping the verdict re-renders
  // once, when the pane crosses the width at which the shape actually changes.
  //
  // `useLayoutEffect`, so the answer is in before the browser paints. In an
  // effect the card would be laid out as a window for one frame and become a
  // column in the next, which is a flinch on every open.
  const [columnFits, setColumnFits] = useState(false);
  // Which member's actions are open, and in which shape. The panel has no
  // render-count contract of its own, unlike the chat list, so this is
  // ordinary state rather than a ref.
  const [memberMenu, setMemberMenu] = useState<
    { memberId: string; mode: "menu"; placement: RowMenuPlacement } | { memberId: string; mode: "sheet" } | null
  >(null);
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
  useLayoutEffect(() => {
    const pane = windowRef.current?.closest("[data-kub-conversation-pane]");
    if (!pane) return undefined;
    const read = () => {
      const next = paneFitsProfileColumn(pane.getBoundingClientRect().width);
      setColumnFits((current) => (current === next ? current : next));
    };
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    // The pane, not this card: the pane's width is the same number whether the
    // card is floating over it or taking a column out of it, so observing it
    // cannot feed itself.
    const observer = new ResizeObserver(read);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  const frame = profileWindowFrame(placement, viewport, { x: insets.left, y: insets.top }, columnFits);
  const docked = frame.docked;
  // A bot has no profile — `public.bots` is its row and `chat_bot_members` its
  // membership — so «Профиль пользователя» over one is the same mistake as the
  // «Без имени пользователя» that used to sit under its name (D-236).
  const rootTitle = isSaved
    ? "Избранное"
    : isGroup
      ? words.infoTitle
      : chatBotPartner(chat)
        ? "Профиль бота"
        : "Профиль пользователя";

  // A resize or a rotation can strand the card off screen; crossing the dock
  // breakpoint has to put it back into the column it came from.
  useEffect(() => {
    const onResize = () => {
      const nextInsets = readSafeAreaInsets();
      const next = safeViewport(currentViewport(), nextInsets);
      setInsets(nextInsets);
      setViewport(next);
      applyPlacement(resolveProfileWindowPlacement(placementRef.current, next));
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [applyPlacement]);

  // Opening the card moves focus into it, so it can be read and dismissed from
  // the keyboard; closing it hands focus back to whatever opened it, which is
  // normally the info button in the chat header.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    windowRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const outcome = resolveProfileWindowEscape({
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        editing:
          tagName === "INPUT" || tagName === "TEXTAREA" || Boolean(target?.isContentEditable),
        // A confirmation, the invite dialog and the media viewer are all modal
        // and own Escape until they are gone. The card is not modal, which is
        // also why the shell's own Escape handler stands down while it is open.
        overlayAbove: Boolean(document.querySelector('[aria-modal="true"]')),
        // Inside the gallery, Escape means «назад», the same as the arrow.
        subview: view !== "root",
      });
      if (outcome === "ignore") return;
      event.preventDefault();
      if (outcome === "back") {
        // Not a bare `setView("root")` any more: the settings screen can hold a
        // typed name that has not been saved, and Escape must ask about it
        // exactly as the arrow does.
        if (view === "settings") void leaveSettings();
        else setView("root");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, view]);

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      !shouldStartProfileDrag({
        docked,
        column: frame.surface === "column",
        button: event.button,
        target: event.target as HTMLElement | null,
      })
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      start: placementRef.current.position,
    };
  };

  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const current = placementRef.current;
    applyPlacement({
      ...current,
      position: profileDragPosition(
        drag,
        { x: event.clientX, y: event.clientY },
        current.size,
        // The safe viewport the resize effect keeps current, so a drag stops
        // at the notch rather than at the glass.
        viewport,
      ),
    });
  };

  const endHandleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    writeProfileWindowPlacement(placementRef.current);
  };
  const [members, setMembers] = useState<MemberRow[]>([]);
  /**
   * The group's bots, which are not members and do not arrive with them (D-235),
   * each with what its membership lets it read (D-276).
   */
  const [chatBots, setChatBots] = useState<readonly ChatBotMember[]>([]);
  const [removingBotId, setRemovingBotId] = useState<string | null>(null);
  const [botError, setBotError] = useState<string | null>(null);
  /** Set when the member read was refused, so the tab can say so (D-168). */
  const [membersError, setMembersError] = useState<string | null>(null);
  /** Whose card is open, if any (D-168). */
  const [memberCardId, setMemberCardId] = useState<string | null>(null);
  const [invites, setInvites] = useState<InviteWithProfiles[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [media, setMedia] = useState<Message[]>([]);
  const [links, setLinks] = useState<Message[]>([]);
  const [linksHasMore, setLinksHasMore] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [mediaHasMore, setMediaHasMore] = useState(false);
  /**
   * The last media or link query was refused (D-171, and D-140/D-193 behind it).
   *
   * Both queries used to throw their `error` away. A refusal then produced an
   * empty page, `loadMedia` returned 0, the automatic loader marked the section
   * stalled and the control at the end of the list disappeared — so a dead
   * network, an expired session and a complete list were drawn as exactly the
   * same picture. An empty answer and an answer nobody could get are different
   * facts and the surface has to say which.
   */
  const [mediaFailed, setMediaFailed] = useState(false);
  const [linksFailed, setLinksFailed] = useState(false);
  /**
   * Which item of the open section the viewer is showing, as a position rather
   * than a copy of the row.
   *
   * The whole of D-171's first mechanic is that this is an index: the viewer
   * can then be told how many there are, where this one sits, and what the next
   * one is — none of which a detached `MediaViewerItem` could ever answer.
   */
  const [openMediaIndex, setOpenMediaIndex] = useState<number | null>(null);
  /**
   * The server's totals, or null while they are unknown.
   *
   * Null is not «this chat has nothing»: it is «nobody has counted», which is
   * the state on a deployment where `chat_media_counts` has not been applied
   * yet. Everything below falls back to counting the loaded page in that case,
   * which is what the card did before.
   */
  const [mediaCounts, setMediaCounts] = useState<MessageMediaCounts | null>(null);
  /**
   * Which kind the media query is currently restricted to, or null for the
   * mixed page the card opens with.
   *
   * A kind is only worth a request of its own once its total is known, because
   * that is the only case where the card can say the loaded rows fall short.
   */
  const [mediaScope, setMediaScope] = useState<MessageMediaKind | null>(null);
  /**
   * How many rows the server has already handed over for the current scope.
   *
   * Not `media.length`: hidden rows are dropped after they arrive, so the list
   * grows more slowly than the range does. Paging from the list's length
   * re-requests rows that were already refused and, once a whole page is
   * hidden, stops advancing at all — which with automatic loading is a loop
   * rather than a stuck button.
   */
  const mediaCursorRef = useRef(0);
  const linkCursorRef = useRef(0);
  /**
   * The last automatic request came back with nothing.
   *
   * Only reachable when a total is stale — a row counted a moment ago and
   * deleted since. It stops the sentinel asking again and takes the loading
   * indicator off, so the list ends instead of spinning.
   */
  const [autoLoadStalled, setAutoLoadStalled] = useState(false);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const mediaScrollerRef = useRef<HTMLDivElement | null>(null);
  const chatInvitePolicy = readChatInvitePolicy(chat);
  const [invitePolicy, setInvitePolicy] = useState<InvitePolicy>(chatInvitePolicy ?? DEFAULT_INVITE_POLICY);
  const [invitePolicySupported, setInvitePolicySupported] = useState(chatInvitePolicy !== null);
  const [invitePolicySaving, setInvitePolicySaving] = useState(false);
  const [invitePolicyError, setInvitePolicyError] = useState<string | null>(null);
  const localMemberRole = (members.find((member) => member.id === currentUser?.id)?.chat_role ?? null) as
    | "owner"
    | "admin"
    | "member"
    | null;
  const myRole = localMemberRole ?? storedMemberRole;
  const isOwner = myRole === "owner";
  const isOwnerOrAdmin = !isSaved && (myRole === "owner" || myRole === "admin");
  const canEditChatProfile = isGroup && isOwnerOrAdmin;
  // Who may invite is `group_invite_create`'s own gate, mirrored in
  // `lib/chatInviteAccess.ts` against the function body on production. This
  // card used to decide it in two branches — chat administrator, or a policy
  // of «members_can_invite» — and the server has four. The two it never had:
  // `system.manage`, which needs no membership at all, and `chats.invite_any`,
  // which needs membership and then ignores the policy.
  //
  // The second one is a measured divergence, not a tidy-up. Arm D of the
  // 2026-09-17 run: a legacy-`admin` who is a plain member of a group whose
  // policy is `owner_admin_only` was **admitted** by the server, while this
  // line computed false and took the row away with nothing said — which is
  // D-165's own complaint, in the direction the entry did not name.
  //
  // While the snapshot is still in flight the three answers are false, and the
  // mirror then reduces to exactly the rule above, so nobody who had the row
  // watches it appear. It appears for the arm-D case once the check lands.
  const invitePermissions = usePermissionAccess(CHAT_INVITE_PERMISSION_KEYS);
  const inviteAdmission = chatInviteAdmission({
    chatType: chat.type,
    chatRole: myRole,
    // `invitePolicySupported` false means the column was not read, which is not
    // the same as a value — the mirror is told «unread» rather than the default.
    invitePolicy: invitePolicySupported ? invitePolicy : null,
    hasInvite: !invitePermissions.checking && invitePermissions.hasPermission("chats.invite"),
    hasInviteAny: !invitePermissions.checking && invitePermissions.hasPermission("chats.invite_any"),
    hasSystemManage: !invitePermissions.checking && invitePermissions.hasPermission("system.manage"),
  });
  // «Избранное» is a chat of type `group` on this deployment, so the mirror
  // would happily offer to invite somebody into your own saved messages.
  const canSendInvites = !isSaved && inviteAdmission.canInvite;

  // Whether a voice row is offered at all: a group rather than a channel, a
  // member rather than an onlooker, and a channel that exists. All three are
  // rules and live where a unit test can reach them — D-169 is the register
  // entry for this panel calling a channel a group, and slice 2 of the voice
  // proposal is deliberately group-only, so this is exactly the distinction
  // that must not be made by eye here.
  const voiceOffer = voiceChannelRowOffer({
    chatType: chat.type,
    myRole,
    channel: voice?.channel ?? null,
  });

  /**
   * The member list, in an order (D-168).
   *
   * Two things changed here and both were defects rather than polish.
   *
   * `error` used to be dropped on the floor — `const { data } = await …` — so a
   * refused read left `members` at its previous value, which on a first open is
   * the empty array, and the panel drew an empty list. A group with nobody in
   * it and a list nobody was allowed to fetch are different facts and the
   * surface has to say which (D-140, D-193). The error is kept and the tab
   * prints it.
   *
   * `joined_at` is selected because the person's card shows it. It costs
   * nothing: it is a column of the row already being read.
   *
   * The sort is applied here rather than in the render so the list has one
   * order, whether it arrived from this query or from a realtime refresh.
   */
  const loadMembers = useCallback(async () => {
    if (!isGroup) {
      setMembers([]);
      setMembersError(null);
      return;
    }
    const { data, error } = await supabase
      .from("chat_members")
      .select("role, joined_at, profile:profiles(*)")
      .eq("chat_id", chat.id);
    if (error) {
      console.error("loadMembers error:", error);
      setMembersError(memberListFailure(mapPgError(error)));
      return;
    }
    setMembersError(null);
    setMembers(
      sortChatMembers(
        (data ?? []).map((m) => ({
          ...(m.profile as Profile),
          chat_role: m.role as "owner" | "admin" | "member",
          joined_at: (m as { joined_at?: string | null }).joined_at ?? null,
        })),
      ),
    );
  }, [chat.id, isGroup, supabase]);

  /**
   * The bots in this group (D-235).
   *
   * Read here rather than taken from the chat row the sidebar holds, because
   * this screen changes the answer: an add or a remove has to show at once, and
   * nothing about bots streams — no bot table is in the `supabase_realtime`
   * publication, so the realtime refresh beside this one would never fire for
   * one. A refusal answers an empty list, which is what a group with no bots
   * looks like, and the cause goes to the log.
   */
  const loadChatBots = useCallback(async () => {
    if (!isGroup) {
      setChatBots([]);
      return;
    }
    const byChat = await fetchChatBotMemberships([chat.id]);
    setChatBots(byChat.get(chat.id) ?? []);
  }, [chat.id, isGroup]);

  const loadInvites = useCallback(async () => {
    if (!isGroup || !isOwnerOrAdmin) {
      setInvites([]);
      setInviteError(null);
      return;
    }
    const { data, error } = await supabase
      .from("group_invites")
      .select("id,invitee_id,inviter_id,status,created_at,expires_at,responded_at,invitee:profiles!group_invites_invitee_id_fkey(*),inviter:profiles!group_invites_inviter_id_fkey(*)")
      .eq("chat_id", chat.id)
      .order("created_at", { ascending: false });
    if (error) {
      if (isGroupInviteUnavailableError(error)) {
        setInviteError(GROUP_INVITES_MIGRATION_REQUIRED);
        setInvites([]);
        return;
      }
      setInviteError(formatGroupInviteError(error, "Не удалось загрузить приглашения."));
      return;
    }
    setInviteError(null);
    setInvites(
      ((data ?? []) as Array<{
        id: string;
        invitee_id: string;
        inviter_id: string;
        status: GroupInviteStatus;
        created_at: string;
        expires_at: string | null;
        responded_at: string | null;
        invitee: Profile | null;
        inviter: Profile | null;
      }>).map((row) => ({
        ...row,
        invitee: row.invitee ?? null,
        inviter: row.inviter ?? null,
      }))
    );
  }, [chat.id, isGroup, isOwnerOrAdmin, supabase]);

  const loadInvitePolicy = useCallback(async () => {
    if (!isGroup) {
      setInvitePolicy(DEFAULT_INVITE_POLICY);
      setInvitePolicySupported(false);
      setInvitePolicyError(null);
      return;
    }
    if (chatInvitePolicy === null) {
      setInvitePolicy(DEFAULT_INVITE_POLICY);
      setInvitePolicySupported(false);
      setInvitePolicyError(null);
      return;
    }
    setInvitePolicySupported(true);
    setInvitePolicyError(null);
    setInvitePolicy(chatInvitePolicy);
  }, [chatInvitePolicy, isGroup]);

  useEffect(() => {
    void loadMembers();
    void loadChatBots();
    void loadInvites();
    void loadInvitePolicy();
  }, [loadChatBots, loadInvitePolicy, loadInvites, loadMembers]);

  useEffect(() => {
    if (!isGroup) return;
    let timer: number | null = null;
    const scheduleRefresh = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadMembers();
        void loadInvites();
        void loadInvitePolicy();
        dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
      }, 150);
    };
    // One channel per table. These three bindings used to share a channel, and
    // a channel carrying more than one table was measured on production on
    // 2026-09-05 to deliver nothing for any of its bindings while still
    // reporting SUBSCRIBED. So this panel's member list and its invites have
    // never updated live — they moved only when the panel was reopened.
    //
    // This comment used to name the cause: `public.chats` missing from the
    // `supabase_realtime` publication. Measured read-only on production,
    // `chats` **is** published — on 2026-09-18 and again on 2026-09-20, one of
    // 33 tables — so that reason is withdrawn and the measured rule is what
    // stands. See lib/realtimeTableChannels.ts.
    const channels = subscribeByTable<typeof scheduleRefresh, RealtimeChannel>(
      supabase,
      `chat-info:${chat.id}`,
      [
        { event: "UPDATE", schema: "public", table: "chats", filter: `id=eq.${chat.id}`, handler: scheduleRefresh },
        { event: "*", schema: "public", table: "chat_members", filter: `chat_id=eq.${chat.id}`, handler: scheduleRefresh },
        { event: "*", schema: "public", table: "group_invites", filter: `chat_id=eq.${chat.id}`, handler: scheduleRefresh },
      ],
    );
    return () => {
      if (timer) window.clearTimeout(timer);
      for (const { channel } of channels) void supabase.removeChannel(channel);
    };
  }, [chat.id, isGroup, loadInvitePolicy, loadInvites, loadMembers, supabase]);

  /**
   * One page of media, either mixed or restricted to a single kind.
   *
   * Returns how many rows the server handed over, which is the only honest
   * answer to «is there any point asking again». The count of rows that reached
   * the list is not: a page can be entirely hidden rows and still sit in front
   * of a hundred more.
   */
  const loadMedia = useCallback(async (
    reset = false,
    kind: MessageMediaKind | null = null,
  ): Promise<number> => {
    if (!currentUserId) {
      setMedia([]);
      setMediaHasMore(false);
      return 0;
    }
    setLoadingMedia(true);
    const start = reset ? 0 : mediaCursorRef.current;
    const { data: membership } = await supabase
      .from("chat_members")
      .select("cleared_at")
      .eq("chat_id", chat.id)
      .eq("user_id", currentUserId)
      .maybeSingle();
    // `audio` joined the list so voice notes have a section of their own; the
    // classifier in `messageMediaSections.ts` decides which section each row
    // lands in from `type` plus the shared voice/round-video predicates.
    //
    // A kind narrows the query to the message types it can be built from, which
    // is how «96 файлов» can be opened in a chat whose recent pages are nothing
    // but photos. `gif` spans two types because a GIF arrives as either.
    let query = supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chat.id)
      .in("type", kind ? MEDIA_KIND_MESSAGE_TYPES[kind] : MEDIA_MESSAGE_TYPES)
      .is("deleted_at", null)
      .not("media_url", "is", null);
    if (membership?.cleared_at) {
      query = query.gt("created_at", membership.cleared_at);
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(start, start + MEDIA_PAGE_SIZE - 1);
    // D-171. The `error` here used to be discarded. A refusal produced an empty
    // page, which the automatic loader read as «nothing more exists» and drew
    // as the end of the list — so a person whose session had expired saw a
    // complete gallery of 24 photos out of 1543 and no sign that anything had
    // gone wrong. The cause still goes to the console, where somebody who can
    // act on it reads it; the surface says only what the reader can do.
    if (error) {
      console.error("[chat-info] media page failed", error);
      setMediaFailed(true);
      setLoadingMedia(false);
      return 0;
    }
    setMediaFailed(false);
    let received = 0;
    if (data) {
      const rawPage = data as Message[];
      received = rawPage.length;
      mediaCursorRef.current = start + received;
      const hiddenIds = await fetchHiddenMessageIdSet(supabase, rawPage.map((item) => item.id));
      const page = rawPage.filter((item) => !hiddenIds.has(item.id));
      setMedia((current) => {
        const next = reset ? page : [...current, ...page];
        return Array.from(new Map(next.map((item) => [item.id, item])).values());
      });
      setMediaHasMore(received >= MEDIA_PAGE_SIZE);
    }
    setLoadingMedia(false);
    return received;
  }, [chat.id, currentUserId, supabase]);

  /**
   * One page of links, which are ordinary text messages outside the media page.
   *
   * Deliberately additive and soft-failing: if this query is rejected the
   * «Ссылки» section simply never appears and every other section still works.
   */
  const loadLinks = useCallback(async (reset = false): Promise<number> => {
    if (!currentUserId) {
      setLinks([]);
      setLinksHasMore(false);
      return 0;
    }
    setLoadingLinks(true);
    const start = reset ? 0 : linkCursorRef.current;
    const { data: membership } = await supabase
      .from("chat_members")
      .select("cleared_at")
      .eq("chat_id", chat.id)
      .eq("user_id", currentUserId)
      .maybeSingle();
    // A single deliberately loose `ilike`: the pattern carries no `,` `:` or
    // `/` for a filter parser to trip over, and `extractFirstLink` does the
    // exact match on the client, so a row containing the word "http" and no
    // address is fetched and then dropped rather than shown.
    let query = supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chat.id)
      .eq("type", "text")
      .is("deleted_at", null)
      .ilike("content", "%http%");
    if (membership?.cleared_at) {
      query = query.gt("created_at", membership.cleared_at);
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(start, start + LINK_PAGE_SIZE - 1);
    if (error || !data) {
      // Same defect as the media page above, and the same repair: the «Ссылки»
      // section used to disappear silently when its query was refused, so a
      // chat full of links looked like a chat that had never carried one.
      if (error) console.error("[chat-info] link page failed", error);
      setLinksFailed(true);
      if (reset) {
        setLinks([]);
        setLinksHasMore(false);
      }
      setLoadingLinks(false);
      return 0;
    }
    setLinksFailed(false);
    const rows = data as Message[];
    linkCursorRef.current = start + rows.length;
    const hiddenIds = await fetchHiddenMessageIdSet(supabase, rows.map((item) => item.id));
    const visible = rows.filter((item) => !hiddenIds.has(item.id) && extractFirstLink(item.content));
    setLinks((current) => {
      const next = reset ? visible : [...current, ...visible];
      return Array.from(new Map(next.map((item) => [item.id, item])).values());
    });
    setLinksHasMore(rows.length >= LINK_PAGE_SIZE);
    setLoadingLinks(false);
    return rows.length;
  }, [chat.id, currentUserId, supabase]);

  /**
   * The exact totals, counted where the rows are.
   *
   * Soft-failing on purpose. `chat_media_counts` is applied separately from the
   * bundle, so a deployment that has the client and not the function must show
   * the card it showed before rather than an error: `null` counts put every
   * section back on «what the loaded page contains».
   */
  const loadMediaCounts = useCallback(async () => {
    if (!currentUserId) {
      setMediaCounts(null);
      return;
    }
    const { data, error } = await supabase.rpc("chat_media_counts", { p_chat_id: chat.id });
    if (error || !data) {
      setMediaCounts(null);
      return;
    }
    setMediaCounts(parseMessageMediaCounts(data as ChatMediaCountRow[]));
  }, [chat.id, currentUserId, supabase]);

  /**
   * The counts are on the card root, so they are loaded with the card.
   *
   * This used to wait for «Общие медиа» to be pressed, which was affordable
   * while the division lived behind that press. It cannot wait now: the card
   * decides which rows exist from what came back, and a row it has not loaded
   * yet is indistinguishable from a kind this chat has never contained.
   *
   * Both loaders are keyed on `chat.id` and `currentUserId` alone, so this runs
   * once per chat rather than on every render of the card.
   */
  useEffect(() => {
    setMedia([]);
    setLinks([]);
    setLinksHasMore(false);
    setMediaHasMore(false);
    setMediaFailed(false);
    setLinksFailed(false);
    setMediaCounts(null);
    setMediaScope(null);
    setAutoLoadStalled(false);
    mediaCursorRef.current = 0;
    linkCursorRef.current = 0;
    setOpenMediaIndex(null);
    setMediaSection(null);
    setView("root");
    void loadMediaCounts();
    void loadMedia(true);
    void loadLinks(true);
  }, [loadMedia, loadLinks, loadMediaCounts]);

  useEffect(() => {
    const handleHiddenMessage = (event: Event) => {
      const detail = (event as CustomEvent<ChatsRefreshDetail>).detail;
      if (detail?.reason !== "message-hidden" || detail.chatId !== chat.id) return;
      if (detail.messageId) {
        setMedia((current) => current.filter((item) => item.id !== detail.messageId));
        setLinks((current) => current.filter((item) => item.id !== detail.messageId));
        // The server counted that row a moment ago, so the total has to be
        // taken again rather than adjusted by one from here: which section the
        // row belonged to is not known at this point.
        void loadMediaCounts();
        return;
      }
      // No longer conditional on the gallery being open: the counts are on the
      // root, so a hidden message has to be taken off them there too.
      mediaCursorRef.current = 0;
      linkCursorRef.current = 0;
      void loadMediaCounts();
      void loadMedia(true, mediaScope);
      void loadLinks(true);
    };
    window.addEventListener(KUB_CHATS_REFRESH_EVENT, handleHiddenMessage);
    return () => window.removeEventListener(KUB_CHATS_REFRESH_EVENT, handleHiddenMessage);
  }, [chat.id, loadLinks, loadMedia, loadMediaCounts, mediaScope]);

  const handleSave = async () => {
    setSaving(true);
    const trimmedName = name.trim();
    if (trimmedName.length > CHAT_NAME_MAX_LENGTH) {
      setSaving(false);
      return;
    }
    const { data } = await supabase
      .from("chats")
      .update({ name: trimmedName || null, description: description.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", chat.id)
      .select("*")
      .single();
    if (data) {
      setChats(chats.map((c) => c.id === chat.id ? { ...c, name: data.name, description: data.description } : c));
    }
    setSaving(false);
    setEditing(false);
    // The settings screen is left by saving as well as by the arrow: a person
    // who pressed the check has finished with it.
    setView("root");
  };

  /**
   * Turning topics on or off.
   *
   * Lifted out of the row it used to be written inside (D-164): the setting now
   * lives on the settings screen, and a handler written in the middle of a
   * button's markup can be called from nowhere else.
   */
  const handleToggleTopics = async () => {
    if (topicsBusy) return;
    const next = !chat.is_forum;
    const confirmed = await requestAppConfirm({
      title: next ? "Включить режим топиков?" : "Выключить режим топиков?",
      description: next
        ? "Все будущие сообщения можно будет отправлять в общий раздел или выбранный топик."
        : "Топики останутся в базе, но чат вернётся к обычному отображению.",
      confirmLabel: next ? "Включить" : "Выключить",
      icon: "hash",
    });
    if (!confirmed) return;
    setTopicsBusy(true);
    try {
      const { error: updErr } = await supabase
        .from("chats").update({ is_forum: next }).eq("id", chat.id);
      if (updErr) {
        console.error("toggle is_forum failed:", updErr);
        showAppAlert(prefixError("Не удалось переключить режим топиков", updErr), "Ошибка");
        return;
      }
      setChats(chats.map((c) => c.id === chat.id ? { ...c, is_forum: next } : c));
      if (next) {
        const { data: existing } = await supabase
          .from("topics").select("id").eq("chat_id", chat.id).eq("is_general", true).maybeSingle();
        if (!existing) {
          const { error: tErr } = await supabase.from("topics").insert({
            chat_id: chat.id, name: "Общий", emoji: "💬", is_general: true, position: 0,
          });
          if (tErr) console.error("create general topic failed:", tErr);
        }
      }
    } finally {
      setTopicsBusy(false);
    }
  };

  /**
   * Leaving the settings screen, which is the thing the pencil never had.
   *
   * A name or a description typed and not saved is asked about rather than
   * dropped: D-136 records the same defect one surface over, and the answer
   * there is the answer here.
   */
  const leaveSettings = async () => {
    if (
      canEditChatProfile &&
      chatProfileDirty(
        { name: chat.name ?? "", description: chat.description ?? "" },
        { name, description },
      )
    ) {
      const confirmed = await requestAppConfirm({
        title: "Отменить изменения?",
        description: "Название и описание останутся прежними.",
        confirmLabel: "Отменить",
        cancelLabel: "Продолжить",
      });
      if (!confirmed) return;
      setName(chat.name ?? "");
      setDescription(chat.description ?? "");
    }
    setSettingsRow(null);
    setView("root");
  };

  const handleAvatarChange = async (file: File) => {
    if (!currentUser) return;
    const validationError = validateAvatarImage(file);
    if (validationError) {
      setAvatarError(validationError);
      showAppAlert(validationError, "Аватар не загружен");
      return;
    }
    setAvatarError(null);
    const preparedFile = await prepareAvatarImage(file);
    const preparedValidationError = validateAvatarUploadImage(preparedFile);
    if (preparedValidationError) {
      setAvatarError(preparedValidationError);
      showAppAlert(preparedValidationError, "Аватар не загружен");
      return;
    }
    const path = avatarUploadPath("chat", chat.id, preparedFile);
    const { data, error } = await supabase.storage.from("media")
      .upload(path, preparedFile, {
        contentType: preparedFile.type,
        upsert: false,
        cacheControl: cacheControlFor(path),
      });
    if (error) {
      const message = prefixError("Не удалось загрузить аватар чата", error);
      setAvatarError(message);
      showAppAlert(message, "Ошибка");
      return;
    }
    // D-208: a recorded address is deliberately the public one. A signature
    // expires, and a column is read months later — storing one would put a dead
    // URL in the database. What makes this safe is that it is now the one
    // helper, so step four changes the recorded shape here and nowhere else.
    const publicUrl = publicMediaObjectUrl({ bucket: "media", path: data.path });
    const { error: updateErr } = await supabase.from("chats").update({ avatar_url: publicUrl }).eq("id", chat.id);
    if (updateErr) {
      const message = prefixError("Не удалось сохранить аватар чата", updateErr);
      setAvatarError(message);
      showAppAlert(message, "Ошибка");
      return;
    }
    setChats(chats.map((c) => c.id === chat.id ? { ...c, avatar_url: publicUrl } : c));
  };

  const handleLeave = async () => {
    if (!currentUser || leavingChat) return;
    setDestructiveError(null);
    setLeavingChat(true);
    const { error } = await supabase.from("chat_members")
      .delete().eq("chat_id", chat.id).eq("user_id", currentUser.id);
    if (error) {
      // Most likely the last-owner protection (P0001).  Surface the
      // server-side message so the user understands why nothing happened.
      console.error("leave chat failed:", error);
      setDestructiveError(mapPgError(error));
      setLeavingChat(false);
      return;
    }
    setLeavingChat(false);
    setLeaveGroupOpen(false);
    setChats(chats.filter((c) => c.id !== chat.id));
    setSelectedChatId(null);
    onClose();
  };

  const handleDeleteGroup = async () => {
    if (!isGroup || !isOwner || deletingChat) return;
    setDestructiveError(null);

    setDeletingChat(true);
    const { data, error } = await supabase
      .from("chats")
      .delete()
      .eq("id", chat.id)
      .select("id")
      .maybeSingle();
    setDeletingChat(false);

    if (error) {
      console.error("delete group chat failed:", error);
      setDestructiveError(prefixError(words.deleteError, error));
      return;
    }

    if (!data) {
      setDestructiveError("Недостаточно прав для удаления этого чата.");
      return;
    }

    setDeleteGroupOpen(false);
    setChats(chats.filter((c) => c.id !== chat.id));
    setSelectedChatId(null);
    onClose();
  };

  const handlePinToggle = async () => {
    const rpcName = isPinned ? "unpin_chat" : "pin_chat";
    const { error } = await supabase.rpc(rpcName, { p_chat_id: chat.id });
    if (error) {
      showAppAlert(prefixError(isPinned ? "Не удалось открепить чат" : "Не удалось закрепить чат", error), "Ошибка");
      return;
    }
    setChats(chats.map((c) =>
      c.id === chat.id
        ? { ...c, is_pinned: !isPinned, pinned_at: isPinned ? null : new Date().toISOString() }
        : c
    ));
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const handleClearForMe = async () => {
    if (!onClearForMe) return;
    const title = isSaved ? "Очистить избранное у себя?" : "Очистить историю у себя?";
    const body = "Сообщения и вложения будут скрыты только у вас. У других участников они останутся. Файлы из хранилища не удаляются.";
    const confirmed = await requestAppConfirm({
      title,
      description: body,
      confirmLabel: "Очистить",
      tone: "danger",
      icon: "delete",
    });
    if (!confirmed) return;
    const result = await onClearForMe();
    if (!result.ok) {
      showAppAlert(result.error ?? "Не удалось очистить историю у себя.", "Ошибка");
      return;
    }
    const clearedAt = new Date().toISOString();
    setMessages(chat.id, []);
    setChats(chats.map((c) =>
      c.id === chat.id
        ? { ...c, last_message: undefined, unread_count: 0, cleared_at: clearedAt }
        : c
    ));
    setMedia([]);
    setLinks([]);
    setLinksHasMore(false);
    setMediaHasMore(false);
    setOpenMediaIndex(null);
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const handleHidePrivateChat = async () => {
    if (!canHidePrivateChat) return;
    const confirmed = await requestAppConfirm({
      title: "Удалить чат у себя?",
      description: "Чат исчезнет только из вашего списка. У собеседника история останется.",
      confirmLabel: "Удалить у себя",
      tone: "danger",
      icon: "logout",
    });
    if (!confirmed) return;
    const { error } = await supabase.rpc("hide_private_chat", { p_chat_id: chat.id });
    if (error) {
      showAppAlert(prefixError("Не удалось удалить чат у себя", error), "Ошибка");
      return;
    }
    setMessages(chat.id, []);
    setMedia([]);
    setLinks([]);
    setLinksHasMore(false);
    setMediaHasMore(false);
    setOpenMediaIndex(null);
    setChats(chats.filter((c) => c.id !== chat.id));
    setSelectedChatId(null);
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
    onClose();
  };

  const handleRemoveMember = async (userId: string) => {
    const { error } = await supabase.from("chat_members")
      .delete().eq("chat_id", chat.id).eq("user_id", userId);
    if (error) {
      console.error("removeMember failed:", error);
      showAppAlert(prefixError("Не удалось удалить участника", error), "Ошибка");
      return;
    }
    setMembers((m) => m.filter((u) => u.id !== userId));
    void loadMembers();
    void loadInvites();
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const setMemberRole = async (userId: string, role: "admin" | "member" | "owner") => {
    const { error } = await supabase
      .from("chat_members").update({ role })
      .eq("chat_id", chat.id).eq("user_id", userId);
    if (error) {
      // Triggered by the role-change matrix (only owner) or the
      // last-owner protection trigger.
      console.error("setMemberRole:", error);
      showAppAlert(prefixError("Не удалось изменить роль", error), "Ошибка");
      return;
    }
    setMembers((ms) => ms.map((m) => m.id === userId ? { ...m, chat_role: role } : m));
    void loadMembers();
  };

  /**
   * Hand the chat over (D-150).
   *
   * Two updates rather than one, because that is what the database permits:
   * `enforce_chat_member_update` lets an owner set any role — read off
   * production on 2026-09-14 — and refuses to demote the **last** owner. So the
   * new owner is made first and only then does the old one step down; doing it
   * the other way round is the one order the trigger rejects.
   *
   * They are not one transaction. If the second fails the chat has two owners,
   * which is a state the trigger allows, nothing is lost, and either of them can
   * finish the job — so the failure is reported rather than rolled back, and it
   * names what actually happened.
   */
  const transferOwnership = async (userId: string, name: string) => {
    const promoted = await supabase
      .from("chat_members").update({ role: "owner" })
      .eq("chat_id", chat.id).eq("user_id", userId);
    if (promoted.error) {
      console.error("transferOwnership (promote):", promoted.error);
      showAppAlert(prefixError(words.transferError, promoted.error), "Ошибка");
      return;
    }
    if (!currentUserId) return;
    const stepped = await supabase
      .from("chat_members").update({ role: "admin" })
      .eq("chat_id", chat.id).eq("user_id", currentUserId);
    if (stepped.error) {
      console.error("transferOwnership (step down):", stepped.error);
      showAppAlert(
        `${name} теперь владелец, но снять права с себя не удалось. Попробуйте ещё раз или попросите нового владельца.`,
        "Ошибка",
      );
      void loadMembers();
      return;
    }
    void loadMembers();
  };

  const handleInvitePolicyChange = async (nextPolicy: InvitePolicy) => {
    if (!isOwnerOrAdmin || invitePolicySaving || invitePolicy === nextPolicy) return;
    if (!invitePolicySupported) {
      setInvitePolicyError(INVITE_POLICY_MIGRATION_REQUIRED);
      return;
    }
    setInvitePolicySaving(true);
    setInvitePolicyError(null);
    const { data, error } = await supabase
      .from("chats")
      .update({ invite_policy: nextPolicy })
      .eq("id", chat.id)
      .select("invite_policy")
      .maybeSingle();
    setInvitePolicySaving(false);
    if (error) {
      if (isInvitePolicyUnavailableError(error)) {
        setInvitePolicySupported(false);
        setInvitePolicyError(INVITE_POLICY_MIGRATION_REQUIRED);
        return;
      }
      setInvitePolicyError("Не удалось изменить режим приглашений.");
      return;
    }
    const savedPolicy = normalizeInvitePolicy(data?.invite_policy);
    setInvitePolicy(savedPolicy);
    setChats(chats.map((item) =>
      item.id === chat.id ? { ...item, invite_policy: savedPolicy } : item
    ));
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const handleCancelInvite = async (invite: InviteWithProfiles) => {
    if (inviteBusyId) return;
    setInviteBusyId(invite.id);
    setInviteError(null);
    const result = await cancelGroupInvite(supabase, invite.id);
    setInviteBusyId(null);
    if (!result.ok) {
      setInviteError(result.message);
      return;
    }
    await loadInvites();
  };

  const handleReinvite = async (invite: InviteWithProfiles) => {
    if (inviteBusyId) return;
    setInviteBusyId(invite.id);
    setInviteError(null);
    const result = await createGroupInvite(supabase, chat.id, invite.invitee_id);
    setInviteBusyId(null);
    if (!result.ok) {
      setInviteError(result.message);
      return;
    }
    await loadInvites();
  };

  /** One member's standing against mine, in the shape the rules module reads. */
  const subjectFor = (member: MemberRow): ChatMemberSubject => ({
    myRole: (myRole as ChatMemberSubject["myRole"]) ?? null,
    targetRole: member.chat_role,
    isSelf: member.id === currentUser?.id,
  });

  const openMember = memberMenu ? members.find((m) => m.id === memberMenu.memberId) ?? null : null;

  /**
   * The same three actions the hover icons carried, built once for whoever the
   * menu is open on. Their gates come from the rules module, so the row and
   * the menu cannot disagree about who may do what.
   */
  const memberActions: RowAction[] = (() => {
    if (!openMember) return [];
    const subject = subjectFor(openMember);
    const name = openMember.full_name ?? "Участник";
    const actions: RowAction[] = [];
    if (canPromoteToAdmin(subject)) {
      actions.push({
        id: "promote",
        label: "Сделать администратором",
        icon: "chevronUp",
        run: () => setMemberRole(openMember.id, "admin"),
      });
    }
    if (canTransferOwnership(subject)) {
      actions.push({
        id: "transfer",
        label: words.transferLabel,
        icon: "crown",
        confirm: () =>
          requestAppConfirm({
            title: words.transferTitle,
            description: `${words.transferDescription(name)} ${words.transferAftermath}`,
            confirmLabel: words.transferLabel,
            tone: "danger",
            icon: "crown",
          }),
        run: () => transferOwnership(openMember.id, name),
      });
    }
    if (canDemoteFromAdmin(subject)) {
      actions.push({
        id: "demote",
        label: "Снять администратора",
        icon: "shieldOff",
        run: () => setMemberRole(openMember.id, "member"),
      });
    }
    if (canRemoveMember(subject)) {
      actions.push({
        id: "remove",
        label: "Удалить из чата",
        icon: "userRemove",
        danger: true,
        confirm: () =>
          requestAppConfirm({
            title: "Удалить участника из чата?",
            description: `${name} потеряет доступ к этому чату.`,
            confirmLabel: "Удалить",
            tone: "danger",
            icon: "userRemove",
          }),
        run: () => handleRemoveMember(openMember.id),
      });
    }
    return actions;
  })();

  const memberMenuHeader = openMember ? (
    <RowActionHeader
      icon={openMember.chat_role === "owner" ? "crown" : openMember.chat_role === "admin" ? "shield" : "user"}
      iconTone={openMember.chat_role === "owner" ? "pink" : "accent"}
      title={openMember.full_name ?? openMember.username ?? "Без имени"}
      subtitle={chatRoleLabel(openMember.chat_role) || undefined}
    />
  ) : null;

  /** Runs one action, keeps the menu honest about being busy, then closes it. */
  const runMemberAction = async (action: RowAction) => {
    // Ask first, and only then say the row is busy. The other order put
    // «Выполняем…» under a question nobody had answered.
    if (action.confirm && !(await action.confirm())) {
      setMemberMenu(null);
      return;
    }
    setMemberBusyId(action.id);
    try {
      await action.run();
    } finally {
      setMemberBusyId(null);
      setMemberMenu(null);
    }
  };


  const otherUser = !isGroup ? (chat.other_user as Profile | null) : null;

  // The same list the header menu reads, from the one store, so the two
  // surfaces of one conversation cannot disagree about whether this person is
  // blocked — which is what a per-component fetch would give as soon as one of
  // them acted.
  const blocks = usePersonalBlocks();
  const canBlock = canBlockInChat({
    chatType: chat.type,
    isSaved,
    // The chat's own field rather than `otherUser`, which this component
    // already narrows to «not a group»: narrowing twice would leave the rule
    // module deciding nothing.
    otherUserId: (chat.other_user as Profile | null)?.id,
    currentUserId,
  });
  const isBlocked = Boolean(otherUser?.id && blocks.ids.has(otherUser.id));

  /** «Заблокировать» / «Разблокировать», asked first. See `blockPrompt`. */
  const handleBlockToggle = async () => {
    if (!otherUser?.id) return;
    const words = isBlocked ? unblockPrompt(display.title) : blockPrompt(display.title);
    const confirmed = await requestAppConfirm({
      title: words.title,
      description: words.description,
      confirmLabel: words.confirmLabel,
      cancelLabel: words.cancelLabel,
      tone: "danger",
      icon: isBlocked ? "unban" : "ban",
    });
    if (!confirmed) return;
    const result = isBlocked
      ? await blocks.unblock(otherUser.id)
      : await blocks.block({
          id: otherUser.id,
          fullName: otherUser.full_name ?? display.title,
          username: otherUser.username ?? null,
          avatarUrl: otherUser.avatar_url ?? null,
          createdAt: new Date().toISOString(),
        });
    showActionFeedback(
      result.ok
        ? {
            kind: "success",
            title: isBlocked ? "Пользователь разблокирован" : "Пользователь заблокирован",
            key: "personal-block",
          }
        : { kind: "error", title: result.error ?? "", key: "personal-block" },
    );
  };

  /**
   * D-167: the write, and what is said about it either way.
   *
   * The bare `catch {}` this replaces is why a mute that never reached the
   * account looked exactly like one that did. The store puts the previous row
   * back when the write is refused, so the row above cannot keep claiming a
   * mute nobody holds, and the sentence here says what happened.
   */
  const applyMute = async (option: ChatMuteOptionId | "off") => {
    const at = Date.now();
    setMuteChoiceOpen(false);
    const result = await setMute(option);
    showActionFeedback(
      result.ok
        ? { kind: "success", title: chatMuteChoiceTitle(option, at), key: `chat-mute:${chat.id}` }
        : { kind: "error", title: result.error ?? "", key: `chat-mute:${chat.id}` },
    );
  };

  // Фото, видео, GIF, файлы, ссылки, голосовые, видеосообщения, аудио — from
  // the server's totals where there are any, and from the loaded rows where
  // there are not. A section holding nothing is never built, so the card only
  // ever offers a row for what this chat actually contains — and now offers one
  // for every kind it contains, including the kinds no loaded page reached.
  const mediaSections = useMemo(
    () => buildMessageMediaSections([...media, ...links], {
      hasMore: mediaHasMore,
      hasMoreLinks: linksHasMore,
      counts: mediaCounts,
    }),
    [media, links, mediaHasMore, linksHasMore, mediaCounts],
  );
  const activeMediaSection = resolveActiveMediaSection(mediaSections, mediaSection);
  const activeSection = mediaSections.find((section) => section.kind === activeMediaSection) ?? null;
  // The sub-view is one kind now, so the title bar names it. It falls back to
  // the old wording only in the moment between the last row of a kind being
  // cleared and the pop that follows it.
  const settingsTitle = words.settingsTitle;
  const windowTitle =
    view === "gallery"
      ? (activeSection?.label ?? "Общие медиа")
      : view === "settings"
        ? settingsTitle
        : view === "member"
          ? "Профиль"
          : rootTitle;
  const mediaGridItems = useMemo(
    () => media.filter((m) => m.type === "image" || m.type === "video"),
    [media],
  );
  const mediaVariantUrls = useMessageMediaVariantUrls(mediaGridItems);
  const panelBot = chatBotPartner(chat);
  /** The никнейм this card shows, whoever the counterpart turns out to be. */
  const identityHandle = otherUser?.username ?? panelBot?.username ?? null;
  const memberIdSet = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  /**
   * Who everybody in this list is, in one request (D-180).
   *
   * Until today a member row could say «Владелец» about this chat and nothing at
   * all about the person — an administrator of LETSCUBE and somebody who joined
   * yesterday were the same two lines. The ids are already in hand here, which
   * is the whole reason the strip costs no query per row: `useProfileBadges`
   * batches the list into one `profile_badges` call and caches the answer at
   * module level, so a second look at the same group asks nothing at all.
   *
   * Projected here rather than inside the row, so the sort and the icon
   * resolution run once per answer instead of once per row per render.
   */
  const memberIds = useMemo(() => members.map((member) => member.id), [members]);
  const memberBadges = useProfileBadges(memberIds);
  const memberBadgeStrips = useMemo(() => {
    const strips = new Map<string, BadgeStrip>();
    for (const member of members) {
      const rows = memberBadges.rows.get(member.id);
      if (!rows?.length) continue;
      const strip = badgeStrip(projectProfileBadges(rows, member.id, { knownIcons: KUB_ICON_NAMES }));
      if (strip.shown.length) strips.set(member.id, strip);
    }
    return strips;
  }, [members, memberBadges.rows]);
  /**
   * What each row says, projected once per answer (D-168).
   *
   * `presenceNow` is the product's own 30-second tick, the one `ChatList` and
   * `ChatHeader` already read presence against. Without it «в сети» would be
   * decided at the moment the list was fetched and never revised, so a person
   * who closed the application would stay lit until something unrelated
   * re-rendered the panel.
   *
   * Presence is taken from `lib/presence.ts` rather than recomputed: the
   * threshold and the wording live there, and a second copy of a threshold ends
   * with the dot and the sentence disagreeing on one row.
   */
  const presenceNow = usePresenceNow();
  const memberRowFacts = useMemo(() => {
    const facts = new Map<string, ChatMemberRowFacts>();
    for (const member of members) {
      facts.set(
        member.id,
        chatMemberRowFacts({
          member,
          roleLabel: chatRoleLabel(member.chat_role, words.possessive),
          // The highest tag only. Telegram shows the group's word instead of
          // the tier and Discord shows one role beside a name; both keep the
          // whole set for the person's card.
          tagLabel: topChatRole(chatRoles.rolesOf(member.id))?.name ?? null,
          presence: getUserPresenceState(member, presenceNow),
        }),
      );
    }
    return facts;
  }, [chatRoles, members, presenceNow, words.possessive]);
  /**
   * Hand a tag to somebody, or take it back (D-215).
   *
   * Two statements rather than an RPC, because `chat_member_roles` takes direct
   * RLS-gated DML the way `topics` and `voice_channels` do — the migration says
   * so and says why. Neither reads the row back: `INSERT ... RETURNING` is
   * judged by the SELECT policy as well, which is what made group creation
   * answer 403 for three days, and there is nothing here worth learning from
   * the answer that the client did not already send.
   */
  const toggleGroupRole = useCallback(
    async (userId: string, role: ChatRole, wear: boolean) => {
      setAssigningRole(role.id);
      const written = wear
        ? await supabase
            .from("chat_member_roles" as never)
            .insert({ chat_id: chat.id, user_id: userId, role_id: role.id } as never)
        : await supabase
            .from("chat_member_roles" as never)
            .delete()
            .eq("chat_id", chat.id)
            .eq("user_id", userId)
            .eq("role_id", role.id);
      setAssigningRole(null);
      if (written.error) {
        showAppAlert(
          mapPgError(written.error),
          wear ? "Не удалось выдать роль" : "Не удалось снять роль",
        );
        return;
      }
      chatRoles.refresh();
    },
    [chat.id, chatRoles, supabase],
  );

  const memberCard = memberCardId ? members.find((m) => m.id === memberCardId) ?? null : null;
  /**
   * The card's one action: the private conversation with this person (D-168).
   *
   * `useCreateChat` is reused rather than re-derived — it holds the single
   * SECURITY DEFINER RPC that returns the existing private chat or creates one
   * atomically, and the plain-Russian failure the search surface already shows.
   * A second copy here would be the race that RPC exists to close.
   */
  const { openPrivateChat, loading: openingMemberChat } = useCreateChat();
  const openMemberChat = useCallback(
    async (memberId: string) => {
      const chatId = await openPrivateChat(memberId);
      if (!chatId) {
        showAppAlert(CHAT_OPEN_FAILED, "Чат недоступен");
        return;
      }
      setView("root");
      setMemberCardId(null);
      onClose();
    },
    [onClose, openPrivateChat],
  );
  const visibleInvites = useMemo(
    () => invites.filter((invite) => !(invite.status === "accepted" && memberIdSet.has(invite.invitee_id))),
    [invites, memberIdSet],
  );
  // D-172: what stood under «Приглашения» was «Статусы обновляются без
  // перезагрузки панели.» — a note about how the code works, beside a manual
  // «Обновить» button that contradicted it. In its place is the one thing on
  // this list a person can act on: how many people have not answered yet.
  const invitesWaiting = invitesWaitingLine(
    visibleInvites.filter((invite) => invite.status === "pending").length,
  );
  // And why the list is empty, when it is. `inviteError` means the list was
  // never read, which is not the same as there being nothing in it — the block
  // used to draw its unavailable banner with «никого не приглашали» beneath it.
  const invitesEmpty = invitesEmptyText({
    total: invites.length,
    visible: visibleInvites.length,
    failed: Boolean(inviteError),
    type: chat.type,
  });
  /**
   * Whether the open section is worth asking the server about again.
   *
   * Per section, not per panel. The button this replaced asked the media page
   * counter, so it appeared under «Ссылки» — which that counter cannot extend —
   * and offered to fetch a section that was already complete.
   * `section.hasMore` is `loaded < total` once the total is known, which is the
   * reliable form of the question.
   */
  const sectionLoading = activeSection?.kind === "link" ? loadingLinks : loadingMedia;
  const sectionFailed = activeSection?.kind === "link" ? linksFailed : mediaFailed;
  const sectionHasMore = activeSection?.hasMore === true && !autoLoadStalled && !sectionFailed;
  /**
   * What stands at the end of the list, as one answer (D-171, mechanic 3).
   *
   * Five states, and the old surface could only draw three of them — a button,
   * that button with a skeleton beside it, and nothing. «Nothing» was doing the
   * work of three different facts: the list is complete, the last page was
   * refused, and the server had nothing further to give against its own count.
   * The decision itself is in `lib/sharedMediaBrowsing.ts`, where a test
   * reaches every branch of it.
   */
  const tail = mediaTailState({
    hasMore: activeSection?.hasMore === true,
    loading: sectionLoading,
    failed: sectionFailed,
    stalled: autoLoadStalled,
  });
  /**
   * What stands where the rows are, when there are none.
   *
   * «Медиа пока нет» is a claim about the chat, and a surface that prints it
   * having read nothing is making a claim it cannot support (D-140, D-193).
   */
  const sectionEmpty = mediaEmptyState(sectionFailed);
  /**
   * Whether the end of the list is drawn at all.
   *
   * Not when the list is empty: the empty state already carries the failure and
   * the way to ask again, and a second copy of the same sentence under it is
   * the surface saying one thing twice — which is the defect D-172 closed in
   * the invitations block.
   */
  const tailShown = Boolean(activeSection) && (activeSection?.loadedCount ?? 0) > 0;
  /**
   * The rows of the open section, divided by month (D-171, mechanic 2).
   *
   * Grouped from the section's own items rather than from `media`, so the
   * division follows whichever kind the reader opened and the grid, the lists
   * and the viewer are all looking at exactly one sequence.
   */
  const sectionGroups = useMemo(
    () => (activeSection ? groupMediaByMonth(activeSection.items, Date.now()) : []),
    [activeSection],
  );
  /**
   * The run the viewer moves through: the open section's own rows, in the order
   * the grid draws them (D-171, mechanic 1).
   *
   * Not `mediaGridItems`, which is every loaded photo and video regardless of
   * which kind was opened. A reader who opened «Видеосообщения» and pressed
   * next would otherwise land on an ordinary photo, and «12 из 1543» would be
   * counting something other than what they are looking at.
   */
  const galleryItems = useMemo(
    () => (activeSection && isGridMediaKind(activeSection.kind) ? activeSection.items : []),
    [activeSection],
  );
  const openMediaRow = openMediaIndex === null ? null : galleryItems[openMediaIndex] ?? null;
  /**
   * The address of the picture or video the viewer is on (D-208).
   *
   * The tiles behind it draw variants and were routed with them; this one
   * reads the message row, so it was not. In `"public"` mode it is
   * `openMediaRow.media_url`, which is what stood here.
   */
  const openMediaUrl = useMessageMediaUrl(openMediaRow);
  /**
   * The row as the viewer takes it.
   *
   * Built here rather than in the tile's press, which is what makes moving to
   * the next picture produce the same thing a press on that tile would: the
   * originality, the preview and the title all come from one place, so a photo
   * reached by an arrow key cannot lose the «Оригинал» badge a photo reached by
   * a tap keeps.
   */
  const openMediaItem: MediaViewerItem | null = openMediaRow && openMediaUrl
    ? {
      type: openMediaRow.type === "video" ? "video" : "image",
      url: openMediaUrl,
      title: openMediaRow.content ?? (openMediaRow.type === "video" ? "Видео" : "Фото"),
      ...(isUncompressedMedia(openMediaRow.media_metadata)
        ? {
          original: true,
          previewUrl:
            mediaVariantUrls[openMediaRow.id]?.previewUrl ?? resolveOriginalPreviewUrl(openMediaRow)?.url,
        }
        : {}),
    }
    : null;
  /**
   * Whether `activeSection.count` is the server's count or a lower bound.
   *
   * The same question `buildMessageMediaSections` asks before deciding whether
   * to print `24+`, asked here the same way, so the viewer's «12 из 24+» and
   * the row's «24+ фотографии» can never hedge differently about one number.
   */
  const sectionTotalExact = activeSection
    ? typeof mediaCounts?.[activeSection.kind] === "number" || !activeSection.hasMore
    : false;
  /**
   * A step past the last loaded item, waiting for the page it asked for.
   *
   * Reaching the end loads more rather than stopping, and the reader should
   * arrive at the next picture rather than at a spinner — so the step is held
   * until the rows land and then taken. It is released either way: a page that
   * failed or that brought nothing reachable ends the wait, and the end of the
   * list then says which of the two happened.
   */
  const [pendingViewerStep, setPendingViewerStep] = useState(false);
  useEffect(() => {
    if (!pendingViewerStep) return;
    if (openMediaIndex === null) {
      setPendingViewerStep(false);
      return;
    }
    if (openMediaIndex + 1 < galleryItems.length) {
      setOpenMediaIndex(openMediaIndex + 1);
      setPendingViewerStep(false);
    } else if (!sectionLoading && !sectionHasMore) {
      setPendingViewerStep(false);
    }
  }, [pendingViewerStep, openMediaIndex, galleryItems.length, sectionLoading, sectionHasMore]);

  /**
   * The next page of whatever is open.
   *
   * Three guards now. `sectionLoading` keeps one request in flight;
   * `autoLoadStalled` handles the case the first guard cannot see, a request
   * that comes back with nothing while the total still says there is more — a
   * stale total, a row deleted since it was counted. Without it the sentinel
   * stays on screen, the effect fires again on every completion, and the panel
   * spins against the server for as long as it is open. `sectionFailed` is the
   * third and it is D-171's: an automatic loader that retries a refusal on
   * every scroll is a surface hammering a server nobody told the reader about.
   * A refusal is retried by the person, through the control the tail draws.
   */
  const loadMoreActiveSection = useCallback(async () => {
    if (!activeSection || activeSection.hasMore !== true) return;
    if (autoLoadStalled) return;
    // The state flags below are the ones a reader can see; this ref is the one
    // that cannot be stale. A render has to happen before `loadingMedia` is
    // visible here, and a second press does not have to wait for one.
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      if (activeSection.kind === "link") {
        if (loadingLinks) return;
        if ((await loadLinks(false)) === 0) setAutoLoadStalled(true);
        return;
      }
      if (loadingMedia) return;
      if ((await loadMedia(false, mediaScope)) === 0) setAutoLoadStalled(true);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [activeSection, autoLoadStalled, loadLinks, loadMedia, loadingLinks, loadingMedia, mediaScope]);

  /**
   * Load the next page when the reader reaches the end of the list.
   *
   * The sentinel is watched rather than the scroll offset, and the observer is
   * **rebuilt whenever the answer could have changed** — a page landed, or a
   * page that was in flight finished. `observe()` reports the current state at
   * once, so each rebuild is a fresh measurement of «is the reader at the end»,
   * which is the case a one-shot observer misses: an observer only reports a
   * *change*, and the first report is consumed while the opening page is still
   * out.
   *
   * The loader is reached through a ref rather than through this effect's
   * dependencies, and the two together are the repair. It used to sit in a
   * second effect keyed on `[sentinelVisible, loadMoreActiveSection]`, and
   * `loadMoreActiveSection` is rebuilt on every page — so each page re-fired
   * the effect while `sentinelVisible` still held the value the observer had
   * not yet had a frame to correct, and the list loaded itself to the end with
   * nobody scrolling. Measured on the fixture: sixty pictures, three pages, no
   * scroll, and the count landing on 48 or 60 depending on how the race went.
   *
   * A stale boolean is the thing that cannot be trusted here; a rebuilt
   * observer re-measures instead of remembering. It still loads a second page
   * without a scroll when the first does not fill the scroller and its margin —
   * that is the reader being at the end, not a runaway.
   */
  const loadMoreRef = useRef(loadMoreActiveSection);
  loadMoreRef.current = loadMoreActiveSection;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || view !== "gallery" || !sectionHasMore) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMoreRef.current();
      },
      { root: mediaScrollerRef.current, rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [view, sectionHasMore, activeMediaSection, activeSection?.loadedCount, sectionLoading]);

  /**
   * The reader asking again after a refusal.
   *
   * The automatic loader deliberately does not retry a failure — it fires on
   * every scroll, and a surface that hammers a server nobody told the reader
   * about is worse than one that stops. So the failure state draws a control
   * and this is what it does. A first page that never arrived is asked for
   * from the start; a later one resumes from the cursor, which never advanced
   * because the refusal returned before it could.
   */
  const retryActiveSection = useCallback(() => {
    setAutoLoadStalled(false);
    if (activeSection?.kind === "link") {
      setLinksFailed(false);
      void loadLinks(links.length === 0);
      return;
    }
    setMediaFailed(false);
    if (!activeSection) void loadMediaCounts();
    void loadMedia(media.length === 0, mediaScope);
  }, [activeSection, links.length, loadLinks, loadMedia, loadMediaCounts, media.length, mediaScope]);

  /**
   * The month the reader is in, shown while the grid moves and faded when it
   * stops (D-171, mechanic 2).
   *
   * Measured rather than derived from a sticky heading, because the marker has
   * to name the month the reader is *inside* — and a sticky heading that has
   * scrolled past the top of the scroller is exactly the moment somebody needs
   * telling. Both decisions are in `lib/sharedMediaBrowsing.ts`: which month
   * the offset falls in, and whether the marker is still shown.
   */
  const monthHeadingsRef = useRef(new Map<string, HTMLElement>());
  const monthMarkerTimerRef = useRef<number | null>(null);
  const lastMediaScrollRef = useRef<number | null>(null);
  const [monthMarker, setMonthMarker] = useState<{ label: string; shown: boolean }>({ label: "", shown: false });
  /**
   * Measured against the top of the scroller's own viewport, so no scroll
   * offset is read anywhere: a heading that has gone past the top has a
   * negative `top`, and the reading line is therefore 0. That is not a trick to
   * satisfy a check — it is the frame `getBoundingClientRect` already answers
   * in, and going through `scrollTop` would mean converting twice to arrive at
   * the same number.
   */
  const readMonthMarker = useCallback(() => {
    const scroller = mediaScrollerRef.current;
    if (!scroller) return;
    const line = scroller.getBoundingClientRect().top;
    const anchors: MediaMonthAnchor[] = [];
    for (const group of sectionGroups) {
      const node = monthHeadingsRef.current.get(group.key);
      if (!node) continue;
      anchors.push({ key: group.key, label: group.label, top: node.getBoundingClientRect().top - line });
    }
    const current = currentMediaMonth(anchors, 0);
    const now = Date.now();
    lastMediaScrollRef.current = now;
    setMonthMarker({ label: current?.label ?? "", shown: mediaMonthMarkerShown(now, now) });
    if (monthMarkerTimerRef.current) window.clearTimeout(monthMarkerTimerRef.current);
    monthMarkerTimerRef.current = window.setTimeout(() => {
      setMonthMarker((held) => ({
        ...held,
        shown: mediaMonthMarkerShown(lastMediaScrollRef.current, Date.now()),
      }));
    }, MEDIA_MONTH_MARKER_LINGER_MS);
  }, [sectionGroups]);
  /**
   * A passive native listener rather than React's `onScroll`.
   *
   * The handler measures several headings on every frame of a scroll, so it
   * must never be able to block one: React's synthetic scroll handler is
   * attached at the root and cannot be declared passive, and this one can.
   * It moves nothing but a pill — it never loads a page. Paging is the
   * observer's, above, and the two are deliberately separate mechanisms.
   */
  useEffect(() => {
    const scroller = mediaScrollerRef.current;
    if (!scroller || view !== "gallery") return;
    scroller.addEventListener("scroll", readMonthMarker, { passive: true });
    return () => scroller.removeEventListener("scroll", readMonthMarker);
  }, [view, readMonthMarker]);
  // Leaving the sub-view, or opening another kind, takes the marker with it:
  // a pill naming August over a list of links is chrome outliving its subject.
  useEffect(() => {
    if (view === "gallery") return;
    if (monthMarkerTimerRef.current) window.clearTimeout(monthMarkerTimerRef.current);
    lastMediaScrollRef.current = null;
    setMonthMarker({ label: "", shown: false });
  }, [view, activeMediaSection]);
  useEffect(() => () => {
    if (monthMarkerTimerRef.current) window.clearTimeout(monthMarkerTimerRef.current);
  }, []);

  /**
   * Pressing a counted row opens that kind, and only that kind.
   *
   * Once the totals are known the query is narrowed to the message types that
   * kind can be built from. That is what makes «96 файлов» openable in a chat
   * whose recent pages hold nothing but photos — the row exists because the
   * chat holds ninety-six files, and it would open on an empty list otherwise.
   * Without totals nothing is narrowed and the sub-view behaves as it did.
   */
  const openMediaSection = (kind: MessageMediaKind) => {
    setMediaSection(kind);
    setView("gallery");
    setAutoLoadStalled(false);
    // The viewer's position is an index into the open section, so it cannot
    // survive a change of section: index 7 of the photos is a different picture
    // from index 7 of the videos.
    setOpenMediaIndex(null);
    if (!mediaCounts || kind === "link" || mediaScope === kind) return;
    setMediaScope(kind);
    mediaCursorRef.current = 0;
    void loadMedia(true, kind);
  };

  const copyUsername = async () => {
    const handle = otherUser?.username ?? panelBot?.username ?? null;
    if (!handle) return;
    await copyWithFeedback(`@${handle}`, {
      success: "Никнейм скопирован",
      error: "Не удалось скопировать никнейм",
      key: "username",
    });
  };

  /**
   * Taking a bot out of the group.
   *
   * Soft on the server — `chat_bot_remove` sets `removed_at`, which is what
   * `bot_membership_authorize_internal` joins on — and the row goes from this
   * list at once rather than after a refetch, because there is no event to wait
   * for.
   */
  const handleRemoveBot = async (bot: BotLike) => {
    if (removingBotId) return;
    setBotError(null);
    setRemovingBotId(bot.id);
    const result = await removeChatBot(chat.id, bot.id);
    setRemovingBotId(null);
    if (!result.ok) {
      setBotError(botMembershipFailureMessage(result.error, BOT_REMOVE_FAILED));
      return;
    }
    setChatBots((current) => current.filter((held) => held.bot.id !== bot.id));
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const tabLabels: Record<Tab, string> = { info: "Сведения", members: words.membersTitle };
  // A hover is the «immediate» step of the shared scale, and it is a colour, so
  // nothing with a size moves. Taking the duration from the token rather than
  // from Tailwind's built-in 150ms is also what makes reduced motion reach it:
  // the tokens collapse to 1ms under the preference, a literal does not.
  const rowMotionClass =
    "transition-colors duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)]";
  // D-047: `kub-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]` is the opt-in for the 44px touch rule. These rows are
  // 357x36 without it, and this card is one of the two surfaces rebuilt after
  // the rule was written, so it had never been opted in. The class costs
  // nothing on a pointer device — it only carries the coarse-pointer minimum.
  // What the settings screen shows, and whether its check button is offered.
  const profileDirty = chatProfileDirty(
    { name: chat.name ?? "", description: chat.description ?? "" },
    { name, description },
  );
  const settingsRows = chatSettingsRows({
    type: chat.type,
    isForum: Boolean(chat.is_forum),
    invitePolicy: invitePolicySupported ? invitePolicy : null,
    administrators: members.filter((member) => member.chat_role === "owner" || member.chat_role === "admin").length,
    members: members.length || chat.members?.length || 0,
    media: mediaCounts ? mediaSections.reduce((total, section) => total + section.count, 0) : null,
    isOwner,
    isOwnerOrAdmin,
  });

  /** The question ending a voice chat asks, and the words it is answered with. */

  const actionRowClass = cn(
    "kub-button inline-flex min-w-0 items-center gap-3 w-full py-2 text-sm rounded-xl px-2 text-left kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
    rowMotionClass,
  );
  const dangerActionRowClass = cn(
    "kub-button inline-flex min-w-0 items-center gap-3 w-full py-2 text-sm rounded-xl px-2 text-left text-[color:var(--kub-danger-text)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
    rowMotionClass,
  );

  return (
    <div
      ref={windowRef}
      role="dialog"
      aria-label={windowTitle}
      tabIndex={-1}
      className={cn(frame.className, "outline-none")}
      style={frame.style}
      data-testid="chat-info-panel"
      data-docked={docked ? "true" : "false"}
      // Three shapes now, and `data-docked` has only ever meant the phone's
      // sheet — the signed-in stand reads it that way and so does the support
      // window. The shape itself gets its own attribute rather than a second
      // meaning loaded onto that one.
      data-surface={frame.surface}
    >
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={endHandleDrag}
        onPointerCancel={endHandleDrag}
        className={cn(
          // D-047: the tracks size to what they hold rather than to a fixed 2.5rem,
          // so a control that grows to the 44px touch minimum on a coarse
          // pointer is not overflowing a 40px column.
          "kub-glass-strong sticky top-0 z-20 grid h-[var(--kub-control-row-height)] flex-shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-[color:var(--kub-border-color)] px-3",
          // The title bar is the handle, but only while there is somewhere to
          // drag to. `touch-none` stops a drag on a tablet from scrolling the
          // page instead of moving the card. A column is laid out by its row,
          // so it offers no grab cursor and takes no drag.
          frame.draggable ? "cursor-grab touch-none select-none active:cursor-grabbing" : "",
        )}
        data-testid="chat-info-header"
      >
        {/* One slot, two meanings: inside a sub-view the leading control goes
            back to the card root rather than closing the card, which is what
            the arrow says and what Escape does. */}
        {view !== "root" ? (
          <button
            onClick={() => (view === "settings" ? void leaveSettings() : setView("root"))}
            className="kub-icon-action h-9 w-9 rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
            aria-label="Назад"
            data-testid="chat-info-back"
          >
            <KubIcon name="chevronLeft" size={18} />
          </button>
        ) : (
          <button
            onClick={onClose}
            className="kub-icon-action h-9 w-9 rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
            aria-label="Закрыть"
          >
            <KubIcon name="close" size={18} />
          </button>
        )}
        <span className="min-w-0 truncate text-center text-sm font-semibold text-[color:var(--kub-text)]">
          {windowTitle}
        </span>
        <div className="flex min-h-9 min-w-9 items-center justify-center justify-self-end">
          {canEditChatProfile && view === "root" && (
            <button
              onClick={() => setView("settings")}
              className="kub-icon-action h-9 w-9 rounded-lg text-[color:var(--kub-cyan)] kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
              aria-label="Редактировать"
            >
              <KubIcon name="edit" size={16} />
            </button>
          )}
          {/* The check appears on the settings screen and only while something
              has really been typed: a control that is always there and usually
              does nothing teaches a person to press it out of habit. */}
          {view === "settings" && canEditChatProfile && profileDirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="kub-icon-action h-9 w-9 rounded-lg text-[color:var(--kub-cyan)] kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
              aria-label="Сохранить"
            >
              <KubIcon name="check" size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Two layers, one visible at a time. The box already has a size, so the
          push moves them without resizing anything — see `.kub-subview`. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        className="kub-subview absolute inset-0 overflow-y-auto"
        data-state={view === "root" ? "current" : "behind"}
        data-testid="chat-info-root-view"
        inert={view !== "root"}
      >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-4 px-4 flex-shrink-0 border-b border-[color:var(--kub-border-color)] kub-grid-subtle" data-testid="chat-info-summary">
        <div className="relative">
          <ChatAvatar
            chat={{ id: chat.id, name: display.title, avatar_url: chat.avatar_url ?? null, type: chat.type }}
            size="xl"
            isSaved={display.isSaved}
          />
          {canEditChatProfile && (
            <label className="absolute bottom-0 right-0 w-9 h-9 rounded-full flex items-center justify-center cursor-pointer bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan">
              <KubIcon name="camera" size={14} label="Сменить аватар" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarChange(f); }}
              />
            </label>
          )}
          {avatarError && (
            <div className="text-xs text-center text-[color:var(--kub-danger-text)]">
              {avatarError}
            </div>
          )}
        </div>

            <div
              className="col-start-2 row-start-1 w-full max-w-full text-left text-base font-semibold leading-snug text-[color:var(--kub-text)] line-clamp-2 [overflow-wrap:anywhere]"
              title={display.title}
            >
              {display.title}
              {display.isBot && <BotTag className="ml-1.5 align-middle" />}
            </div>
            {isSaved ? (
              <div className="col-start-2 row-start-2 text-left text-xs text-[color:var(--kub-muted)]">
                Личное пространство для сохранённых сообщений
              </div>
            ) : isGroup ? (
              <div className="col-start-2 row-start-2 text-left text-xs text-[color:var(--kub-muted)]">
                {countedMemberLabel(members.length || chat.members?.length || 0, chat.type)}
              </div>
            ) : identityHandle ? (
              // Carried over from the chat-list mini-profile this card replaced:
              // copying the nickname was the one affordance that surface had and
              // this one did not. A bot's никнейм goes here too, and it is worth
              // more than a person's: it is how you address one in a group.
              <div className="col-start-2 row-start-2 inline-flex min-w-0 items-center gap-1 text-left text-xs text-[color:var(--kub-muted)]">
                <span className="truncate">@{identityHandle}</span>
                <button
                  type="button"
                  data-testid="chat-info-copy-username"
                  onClick={() => void copyUsername()}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-cyan)]"
                  aria-label="Скопировать никнейм"
                  title="Скопировать никнейм"
                >
                  <KubIcon name="copy" size={12} />
                </button>
              </div>
            ) : (
              <div className="col-start-2 row-start-2 text-left text-xs text-[color:var(--kub-muted)]">
                Без имени пользователя
              </div>
            )}
            {chat.description && (
              <p className="col-span-2 mt-2 max-w-full text-left text-xs text-[color:var(--kub-muted)] line-clamp-3 [overflow-wrap:anywhere]">
                {chat.description}
              </p>
            )}
      </div>

      {/* The summary scrolls away with the content; the tabs do not, so a long
          member list is still switchable without scrolling back up. */}
      {isGroup && (
        <div className="kub-glass-strong sticky top-0 z-10 flex flex-shrink-0 border-b border-[color:var(--kub-border-color)]">
          {(["info", "members"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "relative flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                tab === t ? "text-[color:var(--kub-accent-text)]" : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
              )}
            >
              {t === "members"
                ? <KubIcon name="users" size={14} className="mx-auto mb-0.5" />
                : null}
              {tabLabels[t]}
              {tab === t && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[var(--kub-cyan)] kub-glow-soft" />
              )}
            </button>
          ))}
        </div>
      )}

        {(tab === "info" || !isGroup) && (
          <div>
            {!isGroup && otherUser && (
              <div className="px-4 py-3 border-b border-[color:var(--kub-rule)]">
                <ProfileRoleSummary user={otherUser} compact />
              </div>
            )}
            {!isGroup && otherUser?.bio && (
              <div className="px-4 py-3 border-b border-[color:var(--kub-rule)]">
                <div className="text-[12px] uppercase tracking-wider mb-1 text-[color:var(--kub-accent-text)]">О себе</div>
                <div className="text-sm text-[color:var(--kub-text)]">{otherUser.bio}</div>
              </div>
            )}
            <div className="px-4 py-3 space-y-1">
              {/* D-167. One row at rest, carrying what the account actually
                  holds on its right — «Включены», «Отключены до 21:00»,
                  «Отключены навсегда» — and opening into the durations in
                  place, which is how every other choice on this card behaves.
                  No perimeter and no fill of its own: the rows are separated by
                  the material, which is rule 11. */}
              {chatMuteMenuEntries(muteState, muteChoiceOpen, Date.now()).map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => {
                    if (entry.id === "back") return setMuteChoiceOpen(false);
                    if (entry.id === "mute") return setMuteChoiceOpen(true);
                    void applyMute(entry.id === "unmute" ? "off" : entry.id);
                  }}
                  data-chat-mute-row={entry.id}
                  className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
                >
                  <KubIcon
                    name={entry.id === "back" ? "chevronLeft" : entry.id === "unmute" ? "notificationsOff" : entry.id === "mute" ? "notifications" : "clock"}
                    size={17}
                    tone={entry.id === "unmute" ? "accent" : "muted"}
                    className="shrink-0"
                  />
                  {/* Two lines, not a value on the right. The card is a 380px
                      column and «Отключены до завтра, 0:45» beside a label left
                      «Включить уведом…» cut mid-word — photographed at 1440 and
                      390 before this was changed. It is also the shape the chat
                      header's menu and the list's menu already use, so the three
                      surfaces draw one thing. */}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="min-w-0 truncate">{entry.label}</span>
                    {entry.detail ? (
                      <span className="min-w-0 truncate text-xs text-[color:var(--kub-muted)]" data-chat-mute-detail="true">
                        {entry.detail}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
              {isGroup && canSendInvites && (
                // Divided from the durations while the choice is open, and not
                // otherwise. Photographed at 1440 and 390 before this line
                // existed: «Навсегда» and «Пригласить пользователя» stood in one
                // undivided run, so the invitation read as a fifth way to mute
                // the chat. The rule is `--kub-rule`, the card's own divider,
                // not a perimeter — the choice is closed off, not boxed in.
                <div className={muteChoiceOpen ? "mt-1 border-t border-[color:var(--kub-rule)] pt-1" : undefined}>
                  <button
                    onClick={() => setInviteOpen(true)}
                    className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
                  >
                    <KubIcon name="userPlus" size={17} tone="muted" className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">Пригласить пользователя</span>
                  </button>
                </div>
              )}
              {/* Roles, for anyone who can see them — which is every member,
                  because the SELECT policy is `is_chat_member`. The owner gets
                  the controls inside; everybody else gets the group's own
                  vocabulary and nothing to press. Offered only where roles can
                  exist: a private chat is refused by the trigger, and asking
                  would be a control that answers 403. */}
              {isGroup && chatRoles.supported && (
                <button
                  onClick={() => setRolesOpen(true)}
                  data-testid="chat-info-roles"
                  className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
                >
                  <KubIcon name="shield" size={17} tone="muted" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">Роли группы</span>
                  {chatRoles.ready && chatRoles.roles.length > 0 && (
                    <span className="shrink-0 text-xs tabular-nums text-[color:var(--kub-muted)]">
                      {chatRoles.roles.length}
                    </span>
                  )}
                </button>
              )}
            </div>
            {/* Who is in the group's voice room, and a way in.
                «Начать голосовой чат» and «Завершить голосовой чат» used to sit
                here, and they were the one-room mechanic: a group had a voice
                chat or it did not. A group has **rooms** now, made and removed
                in one place — «Каналы» on the settings screen — so a second
                creator here would be two ways to make a thing that differ in
                what they can make. The row that is left answers «кто сейчас в
                голосе», and only while naming one room is a fact about the
                group: `ChatWindow` hands it `capsuleChannel`, which is null as
                soon as there is a choice to make. */}
            {voice && voiceOffer.offered && (
              <VoiceChannelRow
                channel={voiceOffer.channel}
                participants={voice.participants}
                faces={voice.faces}
                selfId={currentUserId}
                full={voiceOffer.full}
                inCall={voice.inCall}
                elsewhere={voice.elsewhere}
                busy={voice.busy}
                refusal={voice.refusal}
                rowClassName={actionRowClass}
                onJoin={voice.onJoin}
                onLeave={voice.onLeave}
              />
            )}
            {/* What this chat holds, counted, one kind per line.

                Not a strip of tabs behind «Общие медиа»: the point of the
                division is knowing there are 96 files without going looking for
                them, and a count is only worth having where it can be read
                without a press. A kind with nothing in it has no row at all —
                `buildMessageMediaSections` never builds one — so the band is
                absent entirely in a chat that has only ever carried text. */}
            {mediaSections.length > 0 && (
              <div
                className="px-4 py-3 mt-2 space-y-1 border-t border-[color:var(--kub-rule)]"
                data-testid="chat-info-media-rows"
              >
                {mediaSections.map((section) => (
                  <button
                    key={section.kind}
                    type="button"
                    onClick={() => openMediaSection(section.kind)}
                    className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
                    data-testid="chat-info-media-row"
                    data-media-kind={section.kind}
                  >
                    <KubIcon
                      name={MEDIA_SECTION_ICONS[section.kind]}
                      size={17}
                      tone="muted"
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{section.countedLabel}</span>
                    <KubIcon name="chevronRight" size={16} tone="muted" className="shrink-0" />
                  </button>
                ))}
              </div>
            )}
            {/* One row, not three: a placeholder standing in for a count the
                card does not have yet must not imply how many rows are coming.
                Absence would read as «this chat has no shared media», which is
                a claim nothing has established while the query is in flight. */}
            {mediaSections.length === 0 && loadingMedia && (
              <div
                className="px-4 py-3 mt-2 border-t border-[color:var(--kub-rule)]"
                data-testid="chat-info-media-loading"
              >
                <div className="flex items-center gap-3 px-2 py-2">
                  <KubStableSkeleton width="17px" height="17px" rounded="sm" />
                  <KubStableSkeleton width="9rem" height="0.875rem" />
                </div>
              </div>
            )}
            <div className="px-4 py-3 mt-2 border-t border-[color:var(--kub-rule)]">
              <button
                onClick={handlePinToggle}
                className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
              >
                <KubIcon name={isPinned ? "pinOff" : "pin"} size={17} tone="muted" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{isPinned ? "Открепить чат" : "Закрепить чат"}</span>
              </button>
              {/* Reporting sends something and ends nothing, so it sits with
                  the ordinary rows above the destructive band. Photographed at
                  390 with it between «Очистить историю у себя» and
                  «Заблокировать»: an unmarked row inside a run of red ones
                  reads as a gap in the run rather than as a kind of its own. */}
              {canBlock && (
                <button
                  type="button"
                  data-testid="chat-info-report-user"
                  onClick={() => {
                    if (!otherUser?.id) return;
                    requestContentReport({
                      kind: "user",
                      targetUserId: otherUser.id,
                      targetName: display.title,
                      chatId: chat.id,
                    });
                  }}
                  className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
                >
                  <KubIcon name="warning" size={17} tone="muted" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{REPORT_LABEL}</span>
                </button>
              )}
              {onClearForMe && (
                <button
                  onClick={handleClearForMe}
                  className={dangerActionRowClass}
                >
                  <KubIcon name="delete" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {isSaved ? "Очистить избранное у себя" : "Очистить историю у себя"}
                  </span>
                </button>
              )}
              {/* «Заблокировать» carries the danger colour and
                  «Разблокировать» does not, because one takes something away
                  and the other gives it back. */}
              {canBlock && (
                <button
                  type="button"
                  data-testid="chat-info-block-user"
                  onClick={() => void handleBlockToggle()}
                  className={isBlocked ? cn(actionRowClass, "text-[color:var(--kub-text)]") : dangerActionRowClass}
                >
                  <KubIcon
                    name={isBlocked ? "unban" : "ban"}
                    size={17}
                    tone={isBlocked ? "muted" : undefined}
                    className="shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">{isBlocked ? UNBLOCK_LABEL : BLOCK_LABEL}</span>
                </button>
              )}
              {canHidePrivateChat && (
                <button
                  onClick={handleHidePrivateChat}
                  className={dangerActionRowClass}
                >
                  <KubIcon name="logout" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">Удалить чат у себя</span>
                </button>
              )}
              {isGroup && !isOwner && (
                <button
                  onClick={() => {
                    setDestructiveError(null);
                    setLeaveGroupOpen(true);
                  }}
                  disabled={leavingChat}
                  className={dangerActionRowClass}
                >
                  <KubIcon name="logout" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{leavingChat ? "Выходим..." : words.leaveLabel}</span>
                </button>
              )}
              {isGroup && isOwner && (
                <button
                  onClick={() => {
                    setDestructiveError(null);
                    setDeleteGroupOpen(true);
                  }}
                  disabled={deletingChat}
                  className={dangerActionRowClass}
                >
                  {/* A bin, as the settings screen draws the same action. */}
                  <KubIcon name="delete" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {deletingChat ? "Удаление..." : words.deleteLabel}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "members" && isGroup && (
          <div className="py-2">
            {canSendInvites && (
              <div className="px-4 pb-2">
                <button
                  type="button"
                  onClick={() => setInviteOpen(true)}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 text-sm font-semibold text-[color:var(--kub-accent-text)] transition-colors kub-raise-hover"
                >
                  <KubIcon name="userPlus" size={15} />
                  Пригласить пользователя
                </button>
              </div>
            )}
            {/* The two different facts, said differently (D-140, D-193, and the
                read that used to drop its own error — see `loadMembers`). A
                refused list keeps whatever rows are already on screen and puts
                the refusal above them, because an answer that came late is
                still better than a list replaced by an apology. */}
            {membersError && (
              <div className="px-4 pb-2" data-testid="chat-info-members-error">
                <KubNotice tone="danger" title={membersError}>
                  {MEMBERS_UNAVAILABLE_DETAIL}
                </KubNotice>
              </div>
            )}
            {!membersError && members.length === 0 && (
              <div
                className="px-4 py-6 text-center text-sm text-[color:var(--kub-muted)]"
                data-testid="chat-info-members-empty"
              >
                {MEMBERS_EMPTY}
              </div>
            )}
            {members.map((member) => {
              // The promote/demote/remove matrix used to be computed here, with
              // a comment naming the SQL trigger it mirrored and no test of any
              // kind. D-163 needed the same answers a second time — for a menu
              // built for one member rather than a row drawn for each — so it
              // moved to `lib/chatMemberRules.ts` and is now covered by
              // `tests/unit/chat-member-rules.test.mts`, written from the
              // trigger itself rather than from this code. Two copies of a
              // mirror drift until the interface offers what the server
              // refuses, which is already a recorded defect here (D-142).
              return (
                <GroupMemberRow
                  key={member.id}
                  member={member}
                  subject={subjectFor(member)}
                  facts={
                    memberRowFacts.get(member.id) ?? {
                      name: memberDisplayName(member),
                      secondary: formatUsername(member.username),
                      showOnlineDot: false,
                    }
                  }
                  // This chat's standing, and now the only standing on the
                  // row. A strip of LETSCUBE-wide badges used to sit beside
                  // it, so «Владелец» stood here twice meaning two different
                  // facts; D-213 moved the whole strip to the person's card,
                  // where `PROFILE_CARD_BADGE_LIMITS` shows all of it.
                  roleLabel={chatRoleLabel(member.chat_role, words.possessive)}
                  onOpen={() => {
                    setMemberCardId(member.id);
                    setView("member");
                  }}
                  onOpenMenu={(position) =>
                    setMemberMenu({ memberId: member.id, mode: "menu", placement: rowMenuPlacement(position) })
                  }
                  onOpenSheet={() => setMemberMenu({ memberId: member.id, mode: "sheet" })}
                />
              );
            })}

            {/* A bot is not a member, and this list does not pretend otherwise:
                it has no `chat_members` row, no role and no standing, so it
                gets its own short list under the people rather than a row among
                them (D-235). Everybody in the group sees which bots are here —
                that is a fact about the room — and only the removal is the
                administrator's, which `chat_bot_remove` decides for itself.

                An empty list is drawn for an administrator and for nobody else:
                it is how they learn a bot can be added at all, and it would be
                noise on every group for everybody who cannot. */}
            {(chatBots.length > 0 || isOwnerOrAdmin) && (
              <div
                // A rule between two blocks that scroll together, not an edge:
                // --kub-rule is a third of the weight, and the edge colour here
                // read as a second sheet boundary inside the panel (rule 11).
                className="mt-4 border-t border-[color:var(--kub-rule)] pt-3"
                data-testid="chat-info-bots"
              >
                <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
                  {BOT_MEMBERS_HEADING}
                </div>
                {chatBots.length === 0 ? (
                  <div className="px-4 pb-2 text-xs text-[color:var(--kub-muted)]" data-testid="chat-info-bots-empty">
                    {BOT_MEMBERS_EMPTY}
                  </div>
                ) : (
                  <>
                    {/* What holds for every bot in every mode, and only that.
                        What each one can read is on its own row below (D-276):
                        a paragraph here can state one rule, and two bots are
                        allowed to be in two states. */}
                    <p
                      className="px-4 pb-2 text-[11px] leading-4 text-[color:var(--kub-muted)]"
                      data-testid="chat-info-bot-visibility"
                    >
                      {BOT_MEMBERS_HISTORY_NOTE}
                    </p>
                    {chatBots.map(({ bot, privacyMode }) => (
                      <div
                        key={bot.id}
                        data-testid="chat-info-bot"
                        data-bot-id={bot.id}
                        data-bot-privacy={privacyMode}
                        className="flex items-center gap-3 px-4 py-2 kub-raise-hover"
                      >
                        <BotLikeAvatar bot={bot} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-[color:var(--kub-text)]">
                              {botDisplayName(bot)}
                            </span>
                            <BotTag />
                          </div>
                          {/* The status slot, and the whole of the group's side
                              of the privacy model: nobody here approves
                              anything, so being told is the only thing a member
                              can act on — by removing the bot. Every native
                              Telegram client puts the same fact in the same
                              place, where a person's «был(а) недавно» goes,
                              rather than on a line of its own; see the header
                              of `lib/chatBots.ts` for the strings and for what
                              their web clients do instead, which is nothing. */}
                          <div
                            data-testid="chat-info-bot-access"
                            className="break-words text-xs leading-4 text-[color:var(--kub-muted)]"
                          >
                            {botMemberStatusLine(bot, privacyMode)}
                          </div>
                        </div>
                        {isOwnerOrAdmin && (
                          <button
                            type="button"
                            data-testid="chat-info-bot-remove"
                            onClick={() => void handleRemoveBot(bot)}
                            disabled={removingBotId !== null}
                            className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-xs font-semibold text-[color:var(--kub-text)] transition-colors kub-raise-hover disabled:cursor-not-allowed disabled:text-[color:var(--kub-muted)]"
                          >
                            {removingBotId === bot.id ? BOT_REMOVING_LABEL : BOT_REMOVE_LABEL}
                          </button>
                        )}
                      </div>
                    ))}
                  </>
                )}
                {botError && (
                  <div
                    className="px-4 pt-1 text-xs text-[color:var(--kub-danger-text)]"
                    data-testid="chat-info-bot-error"
                  >
                    {botError}
                  </div>
                )}
              </div>
            )}

            {/* Portalled, and above the panel. Both are measured requirements,
                not preferences: the panel carries `backdrop-filter`, which makes
                it the containing block for a fixed descendant — 379x900 inside a
                1440x900 viewport as a column — and it stands at z-60 itself. A
                phone reports neither problem, because there the panel is the
                whole screen, which is exactly why this is not conditional. */}
            {openMember && memberMenu && (memberMenu.mode === "menu" ? (
              <RowActionMenu
                header={memberMenuHeader}
                actions={memberActions}
                placement={memberMenu.placement}
                busyActionId={memberBusyId}
                layer={80}
                onClose={() => setMemberMenu(null)}
                onRun={runMemberAction}
              />
            ) : (
              <RowActionSheet
                header={memberMenuHeader}
                actions={memberActions}
                busyActionId={memberBusyId}
                layer={80}
                onClose={() => setMemberMenu(null)}
                onRun={runMemberAction}
              />
            ))}
            {isOwnerOrAdmin && (
              <div className="mt-3 border-t border-[color:var(--kub-rule)] px-4 pt-3">
                {/* D-172. The «Обновить» button went with the sentence beside
                    it: the binding on `group_invites` delivers, so the list was
                    already current every time somebody pressed it, and a
                    control that never changes anything teaches a person to
                    distrust what is on the screen. */}
                <div className="mb-2">
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--kub-accent-text)]">
                    Приглашения
                  </div>
                  {invitesWaiting && (
                    <div
                      className="text-xs text-[color:var(--kub-muted)]"
                      data-testid="chat-info-invites-waiting"
                    >
                      {invitesWaiting}
                    </div>
                  )}
                </div>

                {inviteError && (
                  <div
                    className="mb-2 rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-danger-text)]"
                    data-testid="chat-info-invites-error"
                  >
                    {inviteError}
                  </div>
                )}

                {invitesEmpty ? (
                  <div
                    className="rounded-xl border border-dashed border-[color:var(--kub-border-color)] px-3 py-3 text-xs text-[color:var(--kub-muted)]"
                    data-testid="chat-info-invites-empty"
                  >
                    {invitesEmpty}
                  </div>
                ) : visibleInvites.length === 0 ? null : (
                  <div className="space-y-1">
                    {visibleInvites.map((invite) => {
                      const invitee = invite.invitee;
                      const inviter = invite.inviter;
                      // D-172: which words this invitation gets, and which of
                      // the two actions it offers, are one decision now and are
                      // tested in `tests/unit/group-invite-copy.test.mts`. The
                      // rules are unchanged — only a waiting invitation can be
                      // withdrawn, and only somebody outside the chat can be
                      // asked again.
                      const state = inviteState({
                        status: invite.status,
                        isMember: memberIdSet.has(invite.invitee_id),
                        type: chat.type,
                      });
                      return (
                        <div key={invite.id} className="rounded-xl px-2 py-2 kub-raise-hover" data-testid="chat-info-invite-row">
                          <div className="flex min-w-0 items-center gap-3">
                            <UserAvatar user={invitee ?? { id: invite.invitee_id, full_name: null, username: null, avatar_url: null }} size="sm" />
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-medium text-[color:var(--kub-text)]">
                                  {invitee ? displayProfileName(invitee) : "Пользователь"}
                                </span>
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold",
                                    inviteToneClass(state.tone),
                                  )}
                                  data-testid="chat-info-invite-state"
                                >
                                  {state.label}
                                </span>
                              </div>
                              {/* «Пригласил: Анна» agreed with Anna and was
                                  wrong for half the people it named. «Кто
                                  пригласил» agrees with «кто», so it is right
                                  for all of them. */}
                              <div className="truncate text-xs text-[color:var(--kub-muted)]">
                                Кто пригласил: {inviter ? displayProfileName(inviter) : "администратор"} · {formatInviteTime(invite.created_at)}
                              </div>
                            </div>
                          </div>
                          {(state.canCancel || state.canInviteAgain) && (
                            <div className="mt-2 flex justify-end gap-2">
                              {state.canCancel && (
                                <button
                                  type="button"
                                  onClick={() => void handleCancelInvite(invite)}
                                  disabled={inviteBusyId === invite.id}
                                  className="inline-flex h-7 items-center justify-center rounded-lg border border-[color:var(--kub-border-color)] px-2 text-xs font-semibold text-[color:var(--kub-muted)] kub-raise-hover disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
                                >
                                  {inviteBusyId === invite.id ? "Отмена..." : "Отменить"}
                                </button>
                              )}
                              {state.canInviteAgain && (
                                <button
                                  type="button"
                                  onClick={() => void handleReinvite(invite)}
                                  disabled={inviteBusyId === invite.id}
                                  className="inline-flex h-7 items-center justify-center rounded-lg bg-[var(--kub-cyan)] px-2 text-xs font-semibold text-[color:var(--kub-bg)] hover:bg-[var(--kub-cyan-hover)] disabled:bg-[var(--kub-inset)] disabled:shadow-none disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
                                >
                                  {inviteBusyId === invite.id ? "Отправка..." : "Пригласить снова"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* The contents of one kind. The strip of section tabs that used to stand
          above this list is gone: the division and the counts are rows in the
          card's own scroll now, and repeating them here would be two places to
          read the same thing and one of them wrong. */}
      <div
        className="kub-subview absolute inset-0 flex min-h-0 flex-col"
        data-state={view === "gallery" ? "current" : "ahead"}
        data-testid="chat-info-gallery-view"
        inert={view !== "gallery"}
      >
        <div
          ref={mediaScrollerRef}
          className="min-h-0 flex-1 overflow-y-auto p-2"
          id="chat-info-media-panel"
          data-media-kind={activeSection?.kind ?? undefined}
          role={activeSection ? "region" : undefined}
          aria-label={activeSection?.countedLabel}
        >
          {/* The placeholder stands for the section that is open, not for the
              panel: with the totals known, «96 файлов» can be pressed in a chat
              whose loaded page is all photos, and the sub-view then has a
              section and nothing in it yet. */}
          {sectionLoading && (activeSection?.loadedCount ?? 0) === 0 ? (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="aspect-square animate-pulse rounded-lg bg-[var(--kub-surface-2)]"
                />
              ))}
            </div>
          ) : !activeSection || sectionGroups.length === 0 ? (
            /* Empty, or unreadable — and never the two drawn as one thing.
               «Медиа пока нет» is a claim about the chat, and this surface used
               to print it after a query it had never seen succeed (D-140,
               D-193). Which of the two it is comes from `mediaEmptyState`.

               `sectionGroups.length === 0` is the half that was missing, and it
               is a state the old markup could reach and draw as literally
               nothing: with the server's totals in hand a section exists
               because the chat holds ninety-six files, so pressing that row
               with the query refused left `activeSection` non-null and its
               `items` empty — an empty grid under a title, with no sentence
               anywhere. Found by the spec that covers this entry, not by
               reading the code. */
            <div
              className="py-8 text-center"
              data-testid="chat-info-media-empty"
              data-failed={sectionFailed ? "true" : "false"}
            >
              <div className="text-sm text-[color:var(--kub-text)]">{sectionEmpty.title}</div>
              {sectionEmpty.detail && (
                <div className="mt-1 text-xs text-[color:var(--kub-muted)]">{sectionEmpty.detail}</div>
              )}
              {sectionEmpty.retry && (
                <button
                  type="button"
                  data-testid="chat-info-media-retry"
                  onClick={retryActiveSection}
                  className="mt-3 inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-accent-text)] kub-raise-hover"
                >
                  {SHARED_MEDIA_PAGE_FAILED_ACTION}
                </button>
              )}
            </div>
          ) : (
            /* Divided by month, newest first (D-171, mechanic 2). One shape for
               all three renderings — the grid, the links and the files — so a
               person moving between kinds meets the same division rather than a
               dated grid beside an undated list. The heading is static: what
               follows the reader is the floating marker below, which is the
               thing that can name a month whose heading has already gone past
               the top of the scroller. */
            <div className="mb-3 space-y-4">
              {sectionGroups.map((group) => (
                <section key={group.key || "undated"} data-media-month={group.key || "undated"}>
                  <h3
                    ref={(node) => {
                      if (node) monthHeadingsRef.current.set(group.key, node);
                      else monthHeadingsRef.current.delete(group.key);
                    }}
                    data-testid="chat-info-media-month"
                    className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]"
                  >
                    {group.label}
                  </h3>
                  {isGridMediaKind(activeSection.kind) ? (
                    <div className="grid grid-cols-3 gap-1">
                      {group.items.map((m) => {
                        const mediaVariant = mediaVariantUrls[m.id];
                        // Its place in the section, which is what the viewer is
                        // handed. Read off the section rather than the month, so
                        // «12 из 1543» counts the kind the reader opened.
                        const position = galleryItems.indexOf(m);
                        return (
                          <button
                            type="button"
                            key={m.id}
                            data-testid="chat-info-media-tile"
                            className="relative aspect-square overflow-hidden rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
                            onClick={() => setOpenMediaIndex(position)}
                          >
                            <MediaGalleryTile message={m} mediaVariant={mediaVariant} />
                          </button>
                        );
                      })}
                    </div>
                  ) : activeSection.kind === "link" ? (
                    <div>
                      {group.items.map((m) => {
                        const href = extractFirstLink(m.content)!;
                        return (
                          <a
                            key={m.id}
                            href={href}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[color:var(--kub-text)] transition-colors kub-raise-hover"
                          >
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]">
                              <KubIcon name="externalLink" size={15} tone="accent" />
                            </div>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{href}</span>
                              {m.content && m.content.trim() !== href && (
                                <span className="block truncate text-xs text-[color:var(--kub-muted)]">{m.content}</span>
                              )}
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  ) : (
                    <div>
                      {group.items.map((m) => (
                        <MediaSectionFileLink
                          key={m.id}
                          message={m}
                          icon={MEDIA_SECTION_ICONS[activeSection.kind]}
                          label={activeSection.label}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}

          {/* The end of the list, and what is at it (D-171, mechanic 3).

              What stood here was one element doing two jobs: an
              `IntersectionObserver` target that was also a «Загрузить ещё»
              button. An arrival and a press are different events and the
              surface had one answer for both — and when a page was refused,
              `loadMedia` returned 0, the section was marked stalled and this
              whole block disappeared, so a dead network and a complete list
              were the same picture.

              Loading happens now because the reader arrived: `tail.kind` is
              «more» until the observer fires and «loading» while the page is
              out, and neither offers a press. The two states a person really
              has to act on — a refusal, and a server with nothing further to
              give against its own count — are the only ones that draw a
              control. `mediaTailState` decides which of the five it is and
              nothing here re-derives it.

              Skeletons rather than a spinner, which is where this codebase
              already answers `prefers-reduced-motion` — see `.kub-skeleton`. */}
          {tailShown && activeSection && (tail.kind === "more" || tail.kind === "loading") && (
            /* One element across the load, which is not a preference: the
               observer is attached in an effect keyed on `sectionHasMore`, so
               swapping the target out for a different node when a page starts
               leaves the observer watching a node that is no longer in the
               document — and the list then stops at two pages forever. Measured
               that way first, at 1440, with the third page never arriving. */
            <div
              ref={sentinelRef}
              data-testid="chat-info-media-sentinel"
              data-loading={tail.kind === "loading" ? "true" : "false"}
              role={tail.kind === "loading" ? "status" : undefined}
              aria-label={tail.kind === "loading" ? "Загружаем" : undefined}
              aria-hidden={tail.kind === "loading" ? undefined : true}
              className="mb-3 min-h-8"
            >
              {tail.kind === "loading" && (isGridMediaKind(activeSection.kind) ? (
                <div className="grid grid-cols-3 gap-1">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <KubStableSkeleton key={index} width="100%" height="auto" className="aspect-square" rounded="lg" />
                  ))}
                </div>
              ) : (
                <div className="px-3 py-2.5">
                  <KubStableSkeleton width="60%" height="0.875rem" />
                </div>
              ))}
            </div>
          )}
          {tailShown && tail.kind === "failed" && (
            <div
              data-testid="chat-info-media-tail-failed"
              className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-xs text-[color:var(--kub-danger-text)]">{tail.message}</span>
              <button
                type="button"
                data-testid="chat-info-media-retry"
                onClick={retryActiveSection}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-xs font-semibold text-[color:var(--kub-accent-text)] kub-raise-hover"
              >
                {tail.action}
              </button>
            </div>
          )}
          {tailShown && tail.kind === "exhausted" && (
            <div
              data-testid="chat-info-media-tail-exhausted"
              className="mb-3 px-3 py-2 text-center text-xs text-[color:var(--kub-muted)]"
            >
              {tail.message}
            </div>
          )}
        </div>

        {/* The month the reader is in, over the grid rather than in it.

            A covering surface, which is the one case rule 11 of the interface
            material names as keeping its own edge — except that the edge here
            comes from `--glass-shadow`'s inset highlight rather than from a
            border, so the perimeter count is untouched and rule 1 is kept: the
            material is `kub-glass-strong` and nothing here writes a fill, a
            blur or a shadow by hand.

            `pointer-events-none`, so it can never take a tap meant for the
            picture under it, and placed outside the scroller so the scroller's
            own padding cannot push it around. */}
        {view === "gallery" && monthMarker.label && (
          <div
            data-testid="chat-info-media-month-marker"
            data-shown={monthMarker.shown ? "true" : "false"}
            aria-hidden="true"
            className={cn(
              // The one-line pill contract of D-222, and a guard rather than a
              // repair: the register listed this line among the ones already
              // broken on screen and measurement refuses that. `mediaMonthLabel`
              // can only produce twelve months and a year, the widest of which
              // renders at about 115px, and an absolutely positioned box with
              // `left-1/2` and no width is laid out in the half of the card to
              // the right of that line — 190px of the 379px this panel is at a
              // 1440 window. So it never wrapped, and before and after are the
              // same pixels. What the three utilities buy is that the label can
              // grow: `white-space: nowrap` makes the preferred width the text's
              // own instead of that half, and the max-width keeps the centred
              // result inside the card with a gutter either side.
              "pointer-events-none absolute left-1/2 top-2 z-10 max-w-[calc(100%-1.5rem)] -translate-x-1/2 truncate rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-text)] kub-glass-strong",
              // From the token, not from a literal: the tokens collapse to 1ms
              // under `prefers-reduced-motion` and a number does not.
              "transition-opacity duration-[var(--kub-motion-fast)] ease-[var(--kub-ease-standard)]",
              monthMarker.shown ? "opacity-100" : "opacity-0",
            )}
          >
            {monthMarker.label}
          </div>
        )}
      </div>
      {/* The settings screen, the third layer of the same card (D-164). It
          arrives from the right like the gallery does, which is what says it is
          somewhere you came from rather than something that replaced the card. */}
      <div
        className="kub-subview absolute inset-0 overflow-y-auto"
        data-state={view === "settings" ? "current" : "ahead"}
        data-testid="chat-info-settings-view"
        inert={view !== "settings"}
      >
        {isGroup && (
          <ChatSettingsView
            rows={settingsRows}
            avatar={(
              <div className="relative">
                <ChatAvatar
                  chat={{ id: chat.id, name: display.title, avatar_url: chat.avatar_url ?? null, type: chat.type }}
                  size="xl"
                  isSaved={display.isSaved}
                />
                {canEditChatProfile && (
                  <label className="absolute bottom-0 right-0 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan">
                    <KubIcon name="camera" size={14} label="Сменить аватар" />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const picked = event.target.files?.[0];
                        if (picked) void handleAvatarChange(picked);
                      }}
                    />
                  </label>
                )}
              </div>
            )}
            canEditProfile={canEditChatProfile}
            name={name}
            nameMaxLength={CHAT_NAME_MAX_LENGTH}
            onNameChange={(value) => setName(limitText(value, CHAT_NAME_MAX_LENGTH))}
            description={description}
            onDescriptionChange={setDescription}
            descriptionPlaceholder={words.descriptionPlaceholder}
            openRow={settingsRow}
            onOpenRowChange={setSettingsRow}
            invitePolicy={invitePolicySupported ? invitePolicy : null}
            invitePolicySupported={invitePolicySupported}
            invitePolicySaving={invitePolicySaving}
            invitePolicyError={invitePolicyError}
            invitePolicyNotice={invitePolicySupported ? null : INVITE_POLICY_MIGRATION_REQUIRED}
            onInvitePolicyChange={(next) => void handleInvitePolicyChange(next)}
            topicsBusy={topicsBusy}
            onToggleTopics={() => void handleToggleTopics()}
            onNavigate={(id) => {
              // Every one of these is somewhere that already exists on the card
              // root, so the row takes a person there rather than opening a
              // fourth layer that would hold a copy of it.
              setSettingsRow(null);
              setView("root");
              if (id === "administrators" || id === "members") setTab("members");
              else if (id === "media") setTab("info");
            }}
            onDelete={() => setDeleteGroupOpen(true)}
          />
        )}
      </div>
      {/* The person, the fourth layer of the same card (D-168).

          Built here rather than by importing `SearchProfilePreview`, and that
          was a decision rather than an oversight. That sheet is the search's:
          its back control is labelled «Назад к результатам», which is a lie in
          a chat panel, and its `global-search-profile-back` id is pinned by the
          search's own specs. Rewording it would edit a file this task does not
          own to say something only this caller needs. What is reused is the
          thing worth reusing — the flow it established, card first and
          «Открыть чат» second, which is already how this product answers «a
          person was activated». */}
      <div
        className="kub-subview absolute inset-0 overflow-y-auto"
        data-state={view === "member" ? "current" : "ahead"}
        data-testid="chat-info-member-card"
        inert={view !== "member"}
      >
        {memberCard && (
          <MemberCard
            member={memberCard}
            isSelf={memberCard.id === currentUser?.id}
            roleLabel={chatRoleLabel(memberCard.chat_role, words.possessive)}
            presenceLabel={getUserPresenceState(memberCard, presenceNow).label}
            joinedLabel={formatJoinedAt(memberCard.joined_at)}
            showOnlineDot={getUserPresenceState(memberCard, presenceNow).isOnline}
            badges={memberBadgeStrips.get(memberCard.id) ?? null}
            groupRoles={chatRoles.rolesOf(memberCard.id)}
            // Null hides every control rather than drawing a disabled one: the
            // mirror answers with the server's own gate, and an administrator
            // is the one who may hand a tag out — inventing it is the owner's.
            groupVocabulary={
              chatRoleAssignDenial({
                chatType: chat.type ?? null,
                standing: myRole,
                wornCount: chatRoles.rolesOf(memberCard.id).length,
              }) === null
                ? chatRoles.roles.filter(
                    (role) => !chatRoles.rolesOf(memberCard.id).some((worn) => worn.id === role.id),
                  )
                : null
            }
            assigning={assigningRole}
            onToggleGroupRole={(role, wear) => void toggleGroupRole(memberCard.id, role, wear)}
            opening={openingMemberChat}
            onOpenChat={() => void openMemberChat(memberCard.id)}
          />
        )}
      </div>
      </div>
      <KubModal
        open={leaveGroupOpen}
        onClose={() => {
          if (!leavingChat) setLeaveGroupOpen(false);
        }}
        title={words.leaveTitle}
        description={words.leaveDescription}
        icon={<KubIcon name="logout" size={18} tone="danger" />}
        tone="danger"
        size="sm"
        mobileSheet={false}
        footer={(
          <>
            <button
              type="button"
              onClick={() => setLeaveGroupOpen(false)}
              disabled={leavingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] kub-raise-hover disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleLeave}
              disabled={leavingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--kub-action-danger-background)] px-3 text-sm font-semibold text-[color:var(--kub-action-danger-foreground)] hover:bg-[var(--kub-action-danger-hover)] active:brightness-95 disabled:bg-[var(--kub-inset)] disabled:shadow-none disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            >
              {leavingChat ? "Выходим..." : "Покинуть"}
            </button>
          </>
        )}
      >
        {destructiveError ? (
          <div className="rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-sm text-[color:var(--kub-danger-text)]">
            {destructiveError}
          </div>
        ) : (
          <p className="text-sm text-[color:var(--kub-muted)]">
            Повторные нажатия будут заблокированы после подтверждения.
          </p>
        )}
      </KubModal>
      <KubModal
        open={deleteGroupOpen}
        onClose={() => {
          if (!deletingChat) setDeleteGroupOpen(false);
        }}
        title={words.deleteTitle}
        description={words.deleteDescription}
        icon={<KubIcon name="userRemove" size={18} tone="danger" />}
        tone="danger"
        size="sm"
        mobileSheet={false}
        footer={(
          <>
            <button
              type="button"
              onClick={() => setDeleteGroupOpen(false)}
              disabled={deletingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] kub-raise-hover disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleDeleteGroup}
              disabled={deletingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--kub-action-danger-background)] px-3 text-sm font-semibold text-[color:var(--kub-action-danger-foreground)] hover:bg-[var(--kub-action-danger-hover)] active:brightness-95 disabled:bg-[var(--kub-inset)] disabled:shadow-none disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            >
              {deletingChat ? "Удаляем..." : "Удалить"}
            </button>
          </>
        )}
      >
        {destructiveError ? (
          <div className="rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-sm text-[color:var(--kub-danger-text)]">
            {destructiveError}
          </div>
        ) : (
          <p className="text-sm text-[color:var(--kub-muted)]">
            {words.deleteAftermath}
          </p>
        )}
      </KubModal>
      {/* A place in a sequence, not a detached copy of one row (D-171).
          The item is looked up by position, so the viewer can be told how many
          there are, which this is and what the next one is — and stepping past
          the last loaded one asks for the next page instead of stopping. */}
      <MediaViewer
        media={openMediaItem}
        onClose={() => setOpenMediaIndex(null)}
        sequence={openMediaRow && openMediaIndex !== null && activeSection ? {
          state: {
            index: openMediaIndex,
            loaded: galleryItems.length,
            total: activeSection.count,
            totalExact: sectionTotalExact,
            hasMore: activeSection.hasMore,
            loading: sectionLoading,
          },
          onSelect: setOpenMediaIndex,
          onNeedMore: () => {
            setPendingViewerStep(true);
            void loadMoreActiveSection();
          },
          stamp: mediaDayLabel(openMediaRow.created_at, Date.now()),
        } : undefined}
      />
      {rolesOpen && (
        <ChatRolesModal
          open
          onClose={() => setRolesOpen(false)}
          chatId={chat.id}
          chatType={chat.type ?? null}
          standing={myRole}
          roles={chatRoles}
        />
      )}
      {inviteOpen && (
        <GroupInviteModal
          chatId={chat.id}
          chatName={display.title}
          currentUserId={currentUser?.id ?? null}
          memberIds={Array.from(memberIdSet)}
          onBotAdded={() => void loadChatBots()}
          onClose={() => {
            setInviteOpen(false);
            void loadMembers();
            void loadChatBots();
            void loadInvites();
            void loadInvitePolicy();
          }}
        />
      )}
    </div>
  );
}

function displayProfileName(profile: Profile): string {
  return profile.full_name ?? profile.username ?? "Без имени";
}

/**
 * The chip's colour, from the tone `inviteState` decided (D-172).
 *
 * Keyed on the tone rather than on the status, which is what fixes the one
 * case the old mapping got wrong: somebody who accepted and is no longer in the
 * chat used to wear the same green as somebody who is in it, because the class
 * was chosen from the status alone and the label from the status plus the
 * membership. Now both come from one answer.
 */
function inviteToneClass(tone: InviteTone): string {
  if (tone === "waiting") return "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] text-[color:var(--kub-accent-text)]";
  if (tone === "refused") return "bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger-text)]";
  if (tone === "joined") return "bg-[color-mix(in_srgb,var(--kub-online)_14%,transparent)] text-[color:var(--kub-online-text)]";
  return "bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)]";
}

function formatInviteTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "недавно";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(0, Math.round(diffMs / 60_000));
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

/**
 * The three keys `group_invite_create` consults, and no others.
 *
 * Read off production on 2026-09-17 and quoted in `lib/chatInviteAccess.ts`
 * with the four arms that measured it. Asking for more keys than the server
 * looks at would cost a round trip and invite somebody to gate on one of them.
 */
const CHAT_INVITE_PERMISSION_KEYS = ["chats.invite", "chats.invite_any", "system.manage"] as const;

function readChatInvitePolicy(chat: ChatWithLastMessage): InvitePolicy | null {
  const value = (chat as ChatWithLastMessage & { invite_policy?: string | null }).invite_policy;
  if (value === "owner_admin_only" || value === "members_can_invite") return value;
  return null;
}

function normalizeInvitePolicy(value: string | null | undefined): InvitePolicy {
  return value === "members_can_invite" ? "members_can_invite" : DEFAULT_INVITE_POLICY;
}

/**
 * One row of «Файлы», «Аудио» or «Голосовые» in the shared-media list.
 *
 * A component rather than an `<a>` in the map, because the address is
 * resolved per message and a hook cannot be called in a loop. D-208: this
 * used to be `href={m.media_url!}` — the column — which is the one shape of
 * this defect that is a link rather than a picture, and so had no `onError`
 * to make a dead address visible.
 */
function MediaSectionFileLink({
  message,
  icon,
  label,
}: {
  message: Message;
  icon: KubIconName;
  label: string;
}) {
  const url = useMessageMediaUrl(message);
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[color:var(--kub-text)] transition-colors kub-raise-hover"
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]">
        <KubIcon name={icon} size={15} tone="accent" />
      </div>
      <span className="truncate text-sm">{message.content ?? label}</span>
    </a>
  );
}

function MediaGalleryTile({
  message,
  mediaVariant,
}: {
  message: Message;
  mediaVariant?: MessageMediaVariantUrls;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const kind = getMediaTileKind(message);
  const icon = kind === "video" ? "video" : kind === "gif" ? "image" : "image";
  const label = kind === "video" ? "Видео" : kind === "gif" ? "GIF" : "Фото";
  const previewUrl = selectMediaGalleryPreviewUrl(message, mediaVariant);

  if (previewUrl && !previewFailed) {
    return (
      <>
        <img
          src={previewUrl}
          alt={message.content ?? label}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.03]"
          onError={() => setPreviewFailed(true)}
        />
        <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/85">
          {label}
        </span>
      </>
    );
  }

  return (
    <div className={cn(
      "flex h-full w-full flex-col items-center justify-center gap-1 text-white",
      kind === "video"
        ? "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kub-cyan)_18%,#111827),#0b0f18)]"
        : "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kub-pink)_16%,#111827),color-mix(in_srgb,var(--kub-cyan)_14%,#0b0f18))]"
    )}>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/14 backdrop-blur">
        <KubIcon name={icon} size={18} className="text-white" />
      </span>
      <span className="rounded-full bg-black/25 px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-white/80">
        {label}
      </span>
    </div>
  );
}

function selectMediaGalleryPreviewUrl(
  message: Message,
  mediaVariant: MessageMediaVariantUrls | undefined,
): string | null {
  const kind = getMediaTileKind(message);
  if (kind === "gif") return null;
  if (kind === "video") return mediaVariant?.videoPosterUrl ?? null;
  // An original's own preview stands in until the worker's copies exist, so the
  // grid never downloads a full original to draw a tile.
  return mediaVariant?.thumbUrl ?? mediaVariant?.previewUrl ?? resolveOriginalPreviewUrl(message)?.url ?? null;
}

function getMediaTileKind(message: Message): "image" | "gif" | "video" {
  if (message.type === "video") return "video";
  const source = `${message.content ?? ""} ${message.media_url ?? ""}`.toLowerCase();
  if (source.includes(".gif")) return "gif";
  return "image";
}

async function fetchHiddenMessageIdSet(
  supabase: ReturnType<typeof createClient>,
  messageIds: string[],
): Promise<Set<string>> {
  const ids = Array.from(new Set(messageIds.filter(Boolean)));
  if (!ids.length) return new Set();
  const { data, error } = await supabase
    .from("message_hidden_for_users")
    .select("message_id")
    .in("message_id", ids);
  if (error) {
    console.error("Hidden media ids fetch error:", error);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.message_id));
}

/**
 * One member, and the ways their actions can be reached.
 *
 * Its own component because the press gesture is a hook, and a hook cannot be
 * called inside `members.map()`. The gain is not only legality: the row now
 * re-renders on its own rather than with the whole list.
 *
 * D-163. The three actions used to live in a container carrying
 * `opacity-0 group-hover:opacity-100`, so on a phone they were drawn at zero
 * opacity at rest and still at zero after a tap — measured at 390 on
 * 2026-09-13, both times. They are reachable three ways now: the always-drawn
 * «ещё» button, a long press, and a right click.
 *
 * A plain tap opens the person, as of D-168. That is what this comment used to
 * reserve the gesture for: the row was a `<div>` with no activation at all, so
 * there was no way from a member list to the member. It is a `<button>` now —
 * a real one, so a keyboard reaches it and Enter works — with the «ещё»
 * control as its sibling rather than its child, because a button inside a
 * button is not a thing the parser will build.
 */
function GroupMemberRow({
  member,
  subject,
  facts,
  roleLabel,
  onOpen,
  onOpenMenu,
  onOpenSheet,
}: {
  member: MemberRow;
  subject: ChatMemberSubject;
  /** The name, the second line and the dot — decided in `lib/chatMemberList.ts`. */
  facts: ChatMemberRowFacts;
  /** «Владелец группы», «Администратор канала», or empty for an ordinary member. */
  roleLabel: string;
  onOpen: () => void;
  onOpenMenu: (position: { x: number; y: number }) => void;
  onOpenSheet: () => void;
}) {
  const hasActions = hasAnyMemberAction(subject);
  const press = useRowPressActions({
    // Ungated, unlike the two below: an ordinary member looking at another
    // ordinary member has no action to take on them and must still be able to
    // open them. That asymmetry is the whole of D-168's first sentence.
    onActivate: onOpen,
    onMenu: hasActions ? onOpenMenu : undefined,
    onSheet: hasActions ? onOpenSheet : undefined,
  });
  const isMemberOwner = member.chat_role === "owner";
  const isMemberAdmin = member.chat_role === "admin";

  return (
    <div
      className="flex items-center gap-3 px-4 kub-raise-hover"
      data-testid="chat-info-member"
      data-member-id={member.id}
      data-has-actions={hasActions ? "true" : "false"}
      {...press.handlers}
    >
      {/* The gesture stays on the row and this button carries no handler of its
          own — its click bubbles into `press.onClick`, and Enter on a focused
          button is a click.

          The first version put `press.handlers` here instead, and
          `member-actions-reachable`'s long-press test went red at once:
          `page.dispatchEvent` targets the row element, and an event dispatched
          on a parent never reaches a child's React handler. A real finger would
          mostly have landed on this button and the gesture would have looked
          fine — which is exactly the kind of regression that ships. The test
          was right and the markup was wrong. */}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--kub-cyan)]"
        data-testid="chat-info-member-open"
        aria-label={`Открыть профиль: ${memberDisplayName(member)}`}
      >
      {/* The dot the entry records as missing: `showOnline` has existed on this
          avatar since it was written and nobody passed it. It is passed only
          when presence could actually be read — a person who turned the setting
          off writes `online_at = null`, and an unlit dot beside them would say
          «не в сети», which is a claim nobody made. */}
      <UserAvatar user={member} size="sm" showOnline={facts.showOnlineDot} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-1 text-[color:var(--kub-text)]">
          {/* The accessible name is the scoped one — «Владелец группы», not
              «Владелец». It used to be scoped so a screen reader could tell it
              apart from the standing chip beside it (D-180); the chip is gone
              and the scoping is now the only thing that names the glyph at all,
              which makes it more load-bearing rather than less. */}
          {isMemberOwner && <KubIcon name="crown" size={12} tone="pink" className="flex-shrink-0" label={roleLabel} />}
          {isMemberAdmin && <KubIcon name="shield" size={12} tone="accent" className="flex-shrink-0" label={roleLabel} />}
          <span className="truncate">{facts.name}</span>
          {subject.isSelf && <span className="text-xs flex-shrink-0 text-[color:var(--kub-muted)]">(вы)</span>}
        </div>
        {/* The second line. D-180 gave it to whoever held a chat role or wore a
            badge and left it off everybody else, which is precisely what D-168
            then recorded: «an ordinary member's row carries nothing at all».
            It is now drawn for every row, because every row has something true
            to put on it — a role or a nickname, and the presence sentence when
            presence can be read.

            That reverses D-180's «a member wearing nothing renders no line»,
            deliberately and with the earlier measurement in hand. What it does
            not reverse is the reason behind it: an *empty* line is still never
            drawn. `chatMemberRowFacts` returns a sentence or the panel's own
            «Без имени пользователя», never "". */}
        <div
          className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
          data-testid="chat-info-member-standing"
        >
            <span
              className={cn(
                "truncate text-xs",
                roleLabel ? "text-[color:var(--kub-accent-text)]" : "text-[color:var(--kub-muted)]",
              )}
              data-testid="chat-info-member-secondary"
            >
              {facts.secondary}
            </span>

          </div>
      </div>
      </button>

      {hasActions && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            // A finger gets the sheet, a pointer gets the menu — the same shapes
            // the chat list has always used, and the same question its gesture
            // asks (`useRowPressActions` refuses a context menu on a coarse
            // pointer). Asked once, here, rather than settled twice.
            //
            // Caught by looking: the first version of this button called
            // `onOpenMenu` whatever was pressing, so a phone got a 272px menu
            // anchored at the fingertip while a long press on the same row got
            // the sheet. Two idioms for one action, on one screen.
            const coarse =
              typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
            if (coarse) onOpenSheet();
            else onOpenMenu({ x: event.clientX, y: event.clientY });
          }}
          aria-label="Действия с участником"
          title="Действия с участником"
          className="p-1.5 rounded-lg kub-raise-hover transition-all text-[color:var(--kub-muted)]"
        >
          <KubIcon name="more" size={16} />
        </button>
      )}
    </div>
  );
}
