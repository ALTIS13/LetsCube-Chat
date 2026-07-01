"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { ChatListItem } from "./ChatListItem";
import { useAppStore } from "@/store/app.store";
import { KubEmptyState, KubIcon, KubModal, type KubIconName } from "@/components/kub";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { bumpMount, bumpUnmount } from "@/lib/dev/instrumentation";
import { createClient } from "@/lib/supabase/client";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { getChatDisplayInfo, isSavedChat } from "@/lib/chatDisplay";
import { comparePinnedOrder, sortChatsForSidebar } from "@/lib/chatSort";
import { mapPgError, prefixError } from "@/lib/errors";
import { requestAppConfirm, showAppAlert } from "@/lib/appDialogs";
import { cn } from "@/lib/utils";
import { ProfileRoleSummary } from "@/components/profile/ProfileRoleSummary";
import { isUserOnline } from "@/lib/presence";
import { usePresenceNow } from "@/hooks/usePresenceNow";
import { useAvatarVariantUrls, type AvatarVariantUrls } from "@/hooks/useMediaVariants";
import type { ChatWithLastMessage } from "@/types/database";

interface ChatListProps {
  chats: ChatWithLastMessage[];
  selectedChatId: string | null;
  onChatSelect: (id: string) => void;
}

type ChatMenuState =
  | { chatId: string; mode: "menu"; left: number; y: number; openUp: boolean }
  | { chatId: string; mode: "sheet" };

interface ChatAction {
  id: string;
  label: string;
  icon: KubIconName;
  danger?: boolean;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

const DESKTOP_MENU_WIDTH = 272;
const DESKTOP_MENU_HEIGHT_ESTIMATE = 388;

export function ChatList({ chats, selectedChatId, onChatSelect }: ChatListProps) {
  const supabase = createClient();
  const currentUser = useAppStore((s) => s.currentUser);
  const mutedChatIds = useAppStore((s) => s.mutedChatIds);
  const setChats = useAppStore((s) => s.setChats);
  const setMessages = useAppStore((s) => s.setMessages);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const toggleMutedChat = useAppStore((s) => s.toggleMutedChat);
  const requestChatPanel = useAppStore((s) => s.requestChatPanel);
  const [openMenu, setOpenMenu] = useState<ChatMenuState | null>(null);
  const [previewChatId, setPreviewChatId] = useState<string | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [draggedPinnedChatId, setDraggedPinnedChatId] = useState<string | null>(null);
  const [dragOverPinnedChatId, setDragOverPinnedChatId] = useState<string | null>(null);
  const presenceNow = usePresenceNow();

  // Dev-only mount/unmount счетчик для проверки стабильности (Task #48).
  useEffect(() => {
    bumpMount("ChatList");
    return () => bumpUnmount("ChatList");
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenMenu(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    if (!chats.some((chat) => chat.id === openMenu.chatId)) setOpenMenu(null);
  }, [chats, openMenu]);

  useEffect(() => {
    if (!previewChatId) return;
    if (!chats.some((chat) => chat.id === previewChatId)) setPreviewChatId(null);
  }, [chats, previewChatId]);

  const chatsWithMute = useMemo(
    () => chats.map((chat) => ({ ...chat, is_muted: mutedChatIds.includes(chat.id) })),
    [chats, mutedChatIds],
  );
  const avatarProfileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const chat of chatsWithMute) {
      if (chat.type !== "private") continue;
      if (!chat.other_user?.id || !chat.other_user.avatar_url) continue;
      ids.add(chat.other_user.id);
    }
    return Array.from(ids).sort();
  }, [chatsWithMute]);
  const avatarVariants = useAvatarVariantUrls(avatarProfileIds);

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const openDesktopMenu = useCallback((chatId: string, position: { x: number; y: number }) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.min(
      Math.max(12, position.x),
      Math.max(12, viewportWidth - DESKTOP_MENU_WIDTH - 12),
    );
    setOpenMenu({
      chatId,
      mode: "menu",
      left,
      y: position.y,
      openUp: position.y > viewportHeight - DESKTOP_MENU_HEIGHT_ESTIMATE,
    });
  }, []);

  const openMobileSheet = useCallback((chatId: string) => {
    setOpenMenu({ chatId, mode: "sheet" });
  }, []);

  const updateChatList = useCallback((updater: (current: ChatWithLastMessage[]) => ChatWithLastMessage[]) => {
    const next = sortChatsForSidebar(updater(useAppStore.getState().chats), currentUser?.id ?? null);
    setChats(next);
  }, [currentUser?.id, setChats]);

  const orderedPinnedChatIds = useMemo(
    () => getOrderedPinnedChats(chatsWithMute, currentUser?.id ?? null).map((chat) => chat.id),
    [chatsWithMute, currentUser?.id],
  );

  const persistPinnedOrder = useCallback(async (reorderedIds: string[], sourceChatId: string) => {
    const previousChats = useAppStore.getState().chats;
    updateChatList((current) => current.map((item) => {
      const nextOrder = reorderedIds.indexOf(item.id);
      return nextOrder >= 0 ? { ...item, pinned_order: nextOrder + 1 } : item;
    }));

    const { error } = await supabase.rpc("set_pinned_chat_order", { p_chat_ids: reorderedIds });
    if (error) {
      setChats(previousChats);
      showAppAlert(prefixError("Не удалось изменить порядок закреплённых чатов", error), "Ошибка");
      dispatchChatsRefresh({ reason: "membership-change", chatId: sourceChatId });
    }
  }, [setChats, supabase, updateChatList]);

  const movePinnedChat = useCallback(async (chatId: string, direction: "up" | "down") => {
    const pinnedIndex = orderedPinnedChatIds.indexOf(chatId);
    if (pinnedIndex < 0) return;
    const targetIndex = direction === "up" ? pinnedIndex - 1 : pinnedIndex + 1;
    if (targetIndex < 0 || targetIndex >= orderedPinnedChatIds.length) return;
    const reordered = [...orderedPinnedChatIds];
    [reordered[pinnedIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[pinnedIndex]];
    await persistPinnedOrder(reordered, chatId);
  }, [orderedPinnedChatIds, persistPinnedOrder]);

  const handlePinnedDragStart = useCallback((chatId: string) => {
    if (!orderedPinnedChatIds.includes(chatId)) return;
    setOpenMenu(null);
    setDraggedPinnedChatId(chatId);
    setDragOverPinnedChatId(null);
  }, [orderedPinnedChatIds]);

  const handlePinnedDragOver = useCallback((event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handlePinnedDragEnter = useCallback((chatId: string) => {
    if (!draggedPinnedChatId || draggedPinnedChatId === chatId) return;
    setDragOverPinnedChatId(chatId);
  }, [draggedPinnedChatId]);

  const handlePinnedDrop = useCallback((targetChatId: string) => {
    const sourceChatId = draggedPinnedChatId;
    setDraggedPinnedChatId(null);
    setDragOverPinnedChatId(null);
    if (!sourceChatId || sourceChatId === targetChatId) return;

    const sourceIndex = orderedPinnedChatIds.indexOf(sourceChatId);
    const targetIndex = orderedPinnedChatIds.indexOf(targetChatId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const reordered = orderedPinnedChatIds.filter((id) => id !== sourceChatId);
    const targetIndexAfterRemoval = reordered.indexOf(targetChatId);
    const insertIndex = sourceIndex < targetIndex ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
    reordered.splice(insertIndex, 0, sourceChatId);
    void persistPinnedOrder(reordered, sourceChatId);
  }, [draggedPinnedChatId, orderedPinnedChatIds, persistPinnedOrder]);

  const handlePinnedDragEnd = useCallback(() => {
    setDraggedPinnedChatId(null);
    setDragOverPinnedChatId(null);
  }, []);

  const clearChatLocally = useCallback((chatId: string) => {
    const clearedAt = new Date().toISOString();
    setMessages(chatId, []);
    updateChatList((current) => current.map((chat) =>
      chat.id === chatId
        ? { ...chat, last_message: undefined, unread_count: 0, cleared_at: clearedAt }
        : chat
    ));
  }, [setMessages, updateChatList]);

  const removeChatLocally = useCallback((chatId: string) => {
    setMessages(chatId, []);
    updateChatList((current) => current.filter((chat) => chat.id !== chatId));
    if (useAppStore.getState().selectedChatId === chatId) setSelectedChatId(null);
  }, [setMessages, setSelectedChatId, updateChatList]);

  const buildActions = useCallback((chat: ChatWithLastMessage): ChatAction[] => {
    const display = getChatDisplayInfo(chat, currentUser?.id ?? null);
    const isSaved = display.isSaved;
    const isPrivate = chat.type === "private" && !isSaved;
    const isGroupLike = !isSaved && (chat.type === "group" || chat.type === "channel");
    const myRole =
      (chat.members?.find((member) => member.user_id === currentUser?.id)?.role as
        | "owner"
        | "admin"
        | "member"
        | undefined) ?? null;
    const isPinned = Boolean(chat.is_pinned);
    const isMuted = mutedChatIds.includes(chat.id);
    const groupLabel = chat.type === "channel" ? "канал" : "группу";
    const pinnedIndex = orderedPinnedChatIds.indexOf(chat.id);

    const selectChat = () => onChatSelect(chat.id);
    const selectAndOpenPanel = (panel: "info" | "search") => {
      onChatSelect(chat.id);
      requestChatPanel(chat.id, panel);
    };
    const actions: ChatAction[] = [
      {
        id: "open",
        icon: "chatRect",
        label: "Открыть",
        run: selectChat,
      },
    ];

    if (isPrivate) {
      actions.push({
        id: "profile",
        icon: "profile",
        label: "Открыть профиль",
        run: () => setPreviewChatId(chat.id),
      });
    }

    if (isGroupLike) {
      actions.push({
        id: "group-info",
        icon: "info",
        label: chat.type === "channel" ? "Информация о канале" : "Информация о группе",
        run: () => setPreviewChatId(chat.id),
      });
    }

    if (!isSaved) {
      actions.push({
        id: "search",
        icon: "search",
        label: "Поиск в чате",
        run: () => selectAndOpenPanel("search"),
      });
      actions.push({
        id: "pin",
        icon: isPinned ? "pinOff" : "pin",
        label: isPinned ? "Открепить чат" : "Закрепить чат",
        run: async () => {
          const { error } = await supabase.rpc(isPinned ? "unpin_chat" : "pin_chat", { p_chat_id: chat.id });
          if (error) {
            showAppAlert(prefixError(isPinned ? "Не удалось открепить чат" : "Не удалось закрепить чат", error), "Ошибка");
            return;
          }
          updateChatList((current) => {
            const pinnedOrders = current
              .filter((item) => item.id !== chat.id && item.is_pinned && !isSavedChat(item, currentUser?.id ?? null))
              .map((item) => item.pinned_order)
              .filter((order): order is number => typeof order === "number");
            const nextOrder = pinnedOrders.length ? Math.min(...pinnedOrders) - 1 : 1;
            return current.map((item) =>
              item.id === chat.id
                ? {
                  ...item,
                  is_pinned: !isPinned,
                  pinned_at: isPinned ? null : new Date().toISOString(),
                  pinned_order: isPinned ? null : nextOrder,
                }
                : item
            );
          });
          dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
        },
      });

      if (isPinned && pinnedIndex > 0) {
        actions.push({
          id: "move-pinned-up",
          icon: "chevronUp",
          label: "Переместить выше",
          run: () => movePinnedChat(chat.id, "up"),
        });
      }

      if (isPinned && pinnedIndex >= 0 && pinnedIndex < orderedPinnedChatIds.length - 1) {
        actions.push({
          id: "move-pinned-down",
          icon: "chevronDown",
          label: "Переместить ниже",
          run: () => movePinnedChat(chat.id, "down"),
        });
      }
    }

    actions.push({
      id: "mute",
      icon: isMuted ? "notificationsOff" : "notifications",
      label: isMuted ? "Включить уведомления" : "Отключить уведомления",
      run: () => toggleMutedChat(chat.id),
    });

    actions.push({
      id: "clear",
      icon: "delete",
      label: isSaved ? "Очистить избранное у себя" : "Очистить историю у себя",
      danger: true,
      run: async () => {
        const confirmed = await requestAppConfirm({
          title: isSaved ? "Очистить избранное у себя?" : "Очистить историю у себя?",
          description: "Сообщения будут скрыты только у вас. У других участников они останутся.",
          confirmLabel: "Очистить",
          tone: "danger",
          icon: "delete",
        });
        if (!confirmed) return;
        const { error } = await supabase.rpc("clear_chat_for_me", { p_chat_id: chat.id });
        if (error) {
          showAppAlert(prefixError("Не удалось очистить историю у себя", error), "Ошибка");
          return;
        }
        clearChatLocally(chat.id);
        dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
      },
    });

    if (isPrivate) {
      actions.push({
        id: "hide-private",
        icon: "logout",
        label: "Удалить чат у себя",
        danger: true,
        run: async () => {
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
          removeChatLocally(chat.id);
          dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
        },
      });
    }

    if (isGroupLike && myRole !== "owner") {
      actions.push({
        id: "leave-group",
        icon: "logout",
        label: `Покинуть ${groupLabel}`,
        danger: true,
        disabled: !currentUser?.id,
        run: async () => {
          if (!currentUser?.id) return;
          const confirmed = await requestAppConfirm({
            title: chat.type === "channel" ? "Покинуть канал?" : "Покинуть группу?",
            description: `${chat.type === "channel" ? "Канал" : "Группа"} исчезнет из вашего списка. История у других участников останется.`,
            confirmLabel: "Покинуть",
            tone: "danger",
            icon: "logout",
          });
          if (!confirmed) return;
          const { error } = await supabase
            .from("chat_members")
            .delete()
            .eq("chat_id", chat.id)
            .eq("user_id", currentUser.id);
          if (error) {
            showAppAlert(mapPgError(error), "Ошибка");
            return;
          }
          removeChatLocally(chat.id);
          dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
        },
      });
    }

    if (isGroupLike && myRole === "owner") {
      actions.push({
        id: "delete-group",
        icon: "userRemove",
        label: chat.type === "channel" ? "Удалить канал" : "Удалить групповой чат",
        danger: true,
        run: async () => {
          const confirmed = await requestAppConfirm({
            title: chat.type === "channel" ? "Удалить канал?" : "Удалить групповой чат?",
            description: "Это действие нельзя отменить.",
            confirmLabel: "Удалить",
            tone: "danger",
            icon: "userRemove",
          });
          if (!confirmed) return;
          const { data, error } = await supabase
            .from("chats")
            .delete()
            .eq("id", chat.id)
            .select("id")
            .maybeSingle();
          if (error) {
            showAppAlert(prefixError("Не удалось удалить групповой чат", error), "Ошибка");
            return;
          }
          if (!data) {
            showAppAlert("Недостаточно прав для удаления этого чата.", "Ошибка");
            return;
          }
          removeChatLocally(chat.id);
          dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
        },
      });
    }

    return actions;
  }, [
    clearChatLocally,
    currentUser?.id,
    movePinnedChat,
    mutedChatIds,
    onChatSelect,
    orderedPinnedChatIds,
    removeChatLocally,
    requestChatPanel,
    supabase,
    toggleMutedChat,
    updateChatList,
  ]);

  const openChat = openMenu ? chatsWithMute.find((chat) => chat.id === openMenu.chatId) ?? null : null;
  const openActions = openChat ? buildActions(openChat) : [];
  const previewChat = previewChatId ? chatsWithMute.find((chat) => chat.id === previewChatId) ?? null : null;
  const previewActions = previewChat ? buildActions(previewChat) : [];

  const runAction = async (action: ChatAction) => {
    if (action.disabled || busyActionId) return;
    setBusyActionId(action.id);
    setOpenMenu(null);
    try {
      await action.run();
    } finally {
      setBusyActionId(null);
    }
  };

  const runPreviewAction = async (action: ChatAction) => {
    await runAction(action);
    if (action.id === "hide-private" || action.id === "leave-group" || action.id === "delete-group") {
      setPreviewChatId(null);
    }
  };

  const openPreviewChat = useCallback((chatId: string) => {
    setPreviewChatId(null);
    onChatSelect(chatId);
  }, [onChatSelect]);

  if (chats.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <KubEmptyState
          icon={<KubIcon name="chats" size={24} />}
          title="Чаты не найдены"
          description="Начните новую переписку или измените запрос поиска."
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {chatsWithMute.map((chat) => {
          const isReorderable = orderedPinnedChatIds.length > 1 && orderedPinnedChatIds.includes(chat.id);
          return (
          <ChatListItem
            key={chat.id}
            chat={chat}
            isSelected={selectedChatId === chat.id}
            onClick={() => onChatSelect(chat.id)}
            onContextMenuOpen={(position) => openDesktopMenu(chat.id, position)}
            onLongPressOpen={() => openMobileSheet(chat.id)}
            isReorderable={isReorderable}
            isDragging={draggedPinnedChatId === chat.id}
            isDragOver={dragOverPinnedChatId === chat.id}
            avatarVariant={chat.other_user?.id ? avatarVariants[chat.other_user.id] : undefined}
            onPinnedDragStart={() => handlePinnedDragStart(chat.id)}
            onPinnedDragEnter={() => handlePinnedDragEnter(chat.id)}
            onPinnedDragOver={handlePinnedDragOver}
            onPinnedDrop={() => handlePinnedDrop(chat.id)}
            onPinnedDragEnd={handlePinnedDragEnd}
            presenceNow={presenceNow}
          />
          );
        })}
      </div>

      {openMenu?.mode === "menu" && openChat && (
        <ChatDesktopContextMenu
          chat={openChat}
          actions={openActions}
          left={openMenu.left}
          y={openMenu.y}
          openUp={openMenu.openUp}
          busyActionId={busyActionId}
          onClose={closeMenu}
          onRun={runAction}
        />
      )}

      {openMenu?.mode === "sheet" && openChat && (
        <ChatMobileActionSheet
          chat={openChat}
          actions={openActions}
          busyActionId={busyActionId}
          onClose={closeMenu}
          onRun={runAction}
        />
      )}

      {previewChat && (
        <ChatProfilePreviewModal
          chat={previewChat}
          actions={previewActions}
          busyActionId={busyActionId}
          onClose={() => setPreviewChatId(null)}
          onOpenChat={() => openPreviewChat(previewChat.id)}
          onRun={runPreviewAction}
          presenceNow={presenceNow}
          avatarVariant={previewChat.other_user?.id ? avatarVariants[previewChat.other_user.id] : undefined}
        />
      )}
    </>
  );
}

function ChatProfilePreviewModal({
  chat,
  actions,
  busyActionId,
  onClose,
  onOpenChat,
  onRun,
  presenceNow,
  avatarVariant,
}: {
  chat: ChatWithLastMessage;
  actions: ChatAction[];
  busyActionId: string | null;
  onClose: () => void;
  onOpenChat: () => void;
  onRun: (action: ChatAction) => void | Promise<void>;
  presenceNow: number;
  avatarVariant?: AvatarVariantUrls;
}) {
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const mutedChatIds = useAppStore((s) => s.mutedChatIds);
  const display = getChatDisplayInfo(chat, currentUserId);
  const otherUser = chat.other_user ?? chat.members?.find((member) => member.user_id !== currentUserId)?.profile ?? null;
  const isPrivate = chat.type === "private" && !display.isSaved;
  const isGroupLike = !display.isSaved && (chat.type === "group" || chat.type === "channel");
  const isOnline = isPrivate && isUserOnline(otherUser, presenceNow);
  const memberCount = chat.members?.length ?? 0;
  const myRole = chat.members?.find((member) => member.user_id === currentUserId)?.role ?? null;
  const isMuted = mutedChatIds.includes(chat.id);
  const [copiedUsername, setCopiedUsername] = useState(false);
  const previewActions = actions.filter((action) =>
    ["pin", "mute", "clear", "hide-private", "leave-group", "delete-group"].includes(action.id),
  );
  const copyUsername = async () => {
    if (!otherUser?.username) return;
    try {
      await navigator.clipboard.writeText(`@${otherUser.username}`);
      setCopiedUsername(true);
      window.setTimeout(() => setCopiedUsername(false), 1600);
    } catch {
      showAppAlert("Не удалось скопировать никнейм.", "Копирование недоступно");
    }
  };

  return (
    <KubModal
      open
      onClose={onClose}
      title={isPrivate ? "Профиль" : display.isSaved ? "Избранное" : "Информация"}
      icon={<KubIcon name={isPrivate ? "profile" : display.isSaved ? "bookmark" : "group"} size={18} />}
      size="md"
      contentClassName="px-0 py-0"
    >
      <div data-chat-profile-preview className="flex flex-col">
        <div className="flex flex-col items-center gap-3 border-b border-[color:var(--kub-border-color)] px-5 py-6 text-center">
          <ChatAvatar chat={chat} size="lg" isSaved={display.isSaved} avatarVariant={avatarVariant} />
          <div className="min-w-0">
            <div className="max-w-full truncate text-lg font-semibold text-[color:var(--kub-text)]">
              {display.title}
            </div>
            {isPrivate && otherUser?.username ? (
              <div className="mt-1 inline-flex max-w-full items-center justify-center gap-1.5 text-sm text-[color:var(--kub-muted)]">
                <span className="truncate">@{otherUser.username}</span>
                <button
                  type="button"
                  data-testid="mini-profile-copy-username"
                  onClick={() => void copyUsername()}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition hover:bg-[var(--kub-surface-3)] hover:text-[color:var(--kub-cyan)]"
                  aria-label="Скопировать никнейм"
                  title={copiedUsername ? "Никнейм скопирован" : "Скопировать никнейм"}
                >
                  <KubIcon name={copiedUsername ? "check" : "copy"} size={14} />
                </button>
              </div>
            ) : (
              <div className="mt-1 text-sm text-[color:var(--kub-muted)]">
                {isPrivate
                  ? display.typeLabel
                  : display.isSaved
                    ? "Личное пространство для сохранённых сообщений"
                    : `${display.typeLabel}${memberCount > 0 ? ` · ${memberCount} участников` : ""}`}
              </div>
            )}
            {isPrivate && isOnline && (
              <div className="mt-0.5 text-xs text-[color:var(--kub-cyan)]">онлайн</div>
            )}
          </div>
        </div>

        <div className="grid gap-2 px-4 py-4">
          <button
            type="button"
            onClick={onOpenChat}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--kub-cyan)] px-4 text-sm font-semibold text-[color:var(--kub-bg)] transition-colors hover:brightness-110"
          >
            <KubIcon name="chatRect" size={16} />
            Открыть чат
          </button>
          <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/45 px-3 py-2 text-xs text-[color:var(--kub-muted)]">
            {isPrivate && (
              <div className="flex items-center justify-between gap-3 py-1">
                <span>Уведомления</span>
                <span className="font-semibold text-[color:var(--kub-text)]">
                  {isMuted ? "отключены" : "включены"}
                </span>
              </div>
            )}
            {isPrivate && otherUser && (
              <div className="flex items-center justify-between gap-3 py-1">
                <span>Роль</span>
                <span className="flex min-w-0 justify-end">
                  <ProfileRoleSummary user={otherUser} compact />
                </span>
              </div>
            )}
            {isGroupLike && (
              <>
                <div className="flex items-center justify-between gap-3 py-1">
                  <span>Ваша роль</span>
                  <span className="font-semibold text-[color:var(--kub-text)]">
                    {getChatMemberRoleLabel(myRole)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1">
                  <span>Тип</span>
                  <span className="font-semibold text-[color:var(--kub-text)]">
                    {chat.type === "channel" ? "канал" : "группа"}
                  </span>
                </div>
              </>
            )}
            {display.isSaved && (
              <div className="py-1">Сохранённые сообщения открываются только по явному переходу.</div>
            )}
          </div>

          {isPrivate && otherUser?.bio && (
            <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/45 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">О себе</div>
              <div className="mt-1 whitespace-pre-wrap break-words text-sm text-[color:var(--kub-text)]">{otherUser.bio}</div>
            </div>
          )}

          {isGroupLike && chat.description && (
            <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]/45 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">Описание</div>
              <div className="mt-1 whitespace-pre-wrap break-words text-sm text-[color:var(--kub-text)]">{chat.description}</div>
            </div>
          )}

          {previewActions.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-[color:var(--kub-border-color)]">
              {previewActions.map((action) => (
                <ChatActionButton
                  key={action.id}
                  action={action}
                  busy={busyActionId === action.id}
                  onRun={onRun}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </KubModal>
  );
}

function ChatDesktopContextMenu({
  chat,
  actions,
  left,
  y,
  openUp,
  busyActionId,
  onClose,
  onRun,
}: {
  chat: ChatWithLastMessage;
  actions: ChatAction[];
  left: number;
  y: number;
  openUp: boolean;
  busyActionId: string | null;
  onClose: () => void;
  onRun: (action: ChatAction) => void | Promise<void>;
}) {
  const style = openUp
    ? { left, bottom: Math.max(12, window.innerHeight - y) }
    : { left, top: Math.min(y, window.innerHeight - 12) };

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        role="menu"
        data-chat-context-menu="desktop"
        className="fixed z-50 w-[272px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] py-1 shadow-2xl kub-glow-soft"
        style={style}
      >
        <ChatActionHeader chat={chat} />
        <div className="max-h-[min(70vh,420px)] overflow-y-auto py-1">
          {actions.map((action) => (
            <ChatActionButton
              key={action.id}
              action={action}
              busy={busyActionId === action.id}
              onRun={onRun}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function ChatMobileActionSheet({
  chat,
  actions,
  busyActionId,
  onClose,
  onRun,
}: {
  chat: ChatWithLastMessage;
  actions: ChatAction[];
  busyActionId: string | null;
  onClose: () => void;
  onRun: (action: ChatAction) => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[color:var(--kub-bg)]/65 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        data-chat-context-menu="mobile"
        className="max-h-[82vh] w-full overflow-hidden rounded-t-2xl border-t border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] pb-safe shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1.5 w-11 rounded-full bg-[var(--kub-surface-3)]" />
        <ChatActionHeader chat={chat} />
        <div className="max-h-[calc(82vh-82px)] overflow-y-auto px-2 pb-3">
          {actions.map((action) => (
            <ChatActionButton
              key={action.id}
              action={action}
              busy={busyActionId === action.id}
              mobile
              onRun={onRun}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChatActionHeader({ chat }: { chat: ChatWithLastMessage }) {
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const display = getChatDisplayInfo(chat, currentUserId);
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-[color:var(--kub-border-color)] px-3 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--kub-surface-3)]">
        <KubIcon
          name={display.isSaved ? "bookmark" : chat.type === "private" ? "user" : "group"}
          size={17}
          tone={display.isSaved ? "accent" : "muted"}
        />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-[color:var(--kub-text)]">{display.title}</div>
        <div className="truncate text-xs text-[color:var(--kub-muted)]">{display.typeLabel}</div>
      </div>
    </div>
  );
}

function ChatActionButton({
  action,
  busy,
  mobile = false,
  onRun,
}: {
  action: ChatAction;
  busy: boolean;
  mobile?: boolean;
  onRun: (action: ChatAction) => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={action.disabled || busy}
      onClick={() => void onRun(action)}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-lg text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        mobile ? "px-3 py-3" : "px-3 py-2.5",
        action.danger
          ? "text-[color:var(--kub-danger)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)]"
          : "text-[color:var(--kub-text)] hover:bg-[var(--kub-surface-3)]",
      )}
    >
      <KubIcon
        name={busy ? "spinner" : action.icon}
        size={17}
        tone={action.danger ? "danger" : "muted"}
        className={cn("shrink-0", busy && "animate-spin")}
      />
      <span className="min-w-0 flex-1 truncate">{busy ? "Выполняем..." : action.label}</span>
    </button>
  );
}

function getOrderedPinnedChats(chats: ChatWithLastMessage[], currentUserId: string | null): ChatWithLastMessage[] {
  return chats
    .filter((chat) => chat.is_pinned && !isSavedChat(chat, currentUserId))
    .sort((a, b) => {
      const byPinnedOrder = comparePinnedOrder(a, b);
      if (byPinnedOrder !== 0) return byPinnedOrder;
      const aPinnedAt = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
      const bPinnedAt = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;
      if (aPinnedAt !== bPinnedAt) return bPinnedAt - aPinnedAt;
      return a.id.localeCompare(b.id);
    });
}

function getChatMemberRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case "owner":
      return "Владелец";
    case "admin":
      return "Администратор";
    default:
      return "Участник";
  }
}
