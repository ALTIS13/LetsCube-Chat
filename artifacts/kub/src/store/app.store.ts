import { create } from 'zustand'
import { createClient } from '@/lib/supabase/client'
import { sortChatsForSidebar } from '@/lib/chatSort'
import { sameChatList } from '@/lib/chatListChange'
import type { Profile, ChatWithLastMessage, MessageWithSender } from '@/types/database'
import { sameActorClientMessage } from '@/lib/messageActor'
import { isHeartbeatOnlyProfileChange } from '@/lib/profileChange'

interface AppState {
  // Current user
  currentUser: Profile | null
  setCurrentUser: (user: Profile | null) => void

  // Selected chat
  selectedChatId: string | null
  setSelectedChatId: (id: string | null) => void

  // Selected topic within the active forum chat — null for non-forum chats.
  selectedTopicId: string | null
  setSelectedTopicId: (id: string | null) => void

  // Chats list
  chats: ChatWithLastMessage[]
  setChats: (chats: ChatWithLastMessage[]) => void
  updateChat: (chat: ChatWithLastMessage) => void
  updateChatLastMessage: (chatId: string, message: MessageWithSender) => void

  // Messages
  messages: Record<string, MessageWithSender[]>
  setMessages: (chatId: string, messages: MessageWithSender[]) => void
  /**
   * Insert OR replace by id. Used both for new messages from realtime AND for replacing
   * an optimistic message in place when the realtime echo arrives with richer data.
   */
  addMessage: (chatId: string, message: MessageWithSender) => void
  updateMessage: (chatId: string, message: MessageWithSender) => void
  /**
   * Optimistic helper: swap a message with a known oldId for one whose id may differ
   * (e.g. temporary `tmp:…` id → real DB uuid after INSERT returns).
   */
  replaceMessage: (chatId: string, oldId: string, message: MessageWithSender) => void
  removeMessage: (chatId: string, id: string) => void

  // Active folder
  activeFolderId: string | null
  setActiveFolderId: (id: string | null) => void

  // UI state
  showSidebar: boolean
  setShowSidebar: (show: boolean) => void
  searchQuery: string
  setSearchQuery: (q: string) => void

  /**
   * Active section in the mobile BottomNav. Drives which secondary surface
   * (search input focus, folder management, profile/settings) is open on top
   * of the chats list. Admin lives at its own route, not here.
   *
   * 'search' is a one-shot trigger: SidebarHeader focuses its search input
   * when this becomes 'search' and immediately resets the section back to
   * 'chats' so the tap acts like an action rather than a sticky tab.
   */
  mobileSection: 'chats' | 'search' | 'folders' | 'profile'
  setMobileSection: (section: 'chats' | 'search' | 'folders' | 'profile') => void

  // Reply/forward/edit state — composer-level UI flags
  replyToMessage: MessageWithSender | null
  setReplyToMessage: (msg: MessageWithSender | null) => void
  editingMessage: MessageWithSender | null
  setEditingMessage: (msg: MessageWithSender | null) => void
  /** When set, ForwardModal opens to pick a destination chat for this message. */
  forwardingMessage: MessageWithSender | null
  setForwardingMessage: (msg: MessageWithSender | null) => void

  // Mute
  mutedChatIds: string[]
  toggleMutedChat: (chatId: string) => void

  // Mark chat read (zero out unread_count in store)
  markChatRead: (chatId: string) => void

  // Cross-surface chat panel requests, used by sidebar context actions.
  chatPanelRequest: { chatId: string; panel: 'info' | 'search'; key: number } | null
  requestChatPanel: (chatId: string, panel: 'info' | 'search') => void
  clearChatPanelRequest: (key: number) => void
}


function compareMessages(a: MessageWithSender, b: MessageWithSender): number {
  const byCreatedAt = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (byCreatedAt !== 0) return byCreatedAt;
  return a.id.localeCompare(b.id);
}

function sortMessages(messages: MessageWithSender[]): MessageWithSender[] {
  return [...messages].sort(compareMessages);
}

function isSameLogicalMessage(
  current: ChatWithLastMessage["last_message"],
  next: MessageWithSender,
): boolean {
  if (!current) return false;
  if (current.id === next.id) return true;
  return Boolean(
    current.client_message_id &&
    next.client_message_id &&
    sameActorClientMessage(current, next),
  );
}

function shouldReplaceLastMessage(
  current: ChatWithLastMessage["last_message"],
  next: MessageWithSender,
): boolean {
  if (!current) return true;
  if (isSameLogicalMessage(current, next)) return true;
  const currentMs = new Date(current.created_at).getTime();
  const nextMs = new Date(next.created_at).getTime();
  if (!Number.isFinite(currentMs) || !Number.isFinite(nextMs)) return true;
  return nextMs >= currentMs;
}

function latestTimestamp(a: string | null | undefined, b: string | null | undefined): string {
  if (!a) return b ?? new Date().toISOString();
  if (!b) return a;
  const aMs = new Date(a).getTime();
  const bMs = new Date(b).getTime();
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return bMs > aMs ? b : a;
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: null,
  /**
   * Shallow-compare significant fields and DROP no-op writes.
   *
   * Why: `useHeartbeat` PATCH-ит `profiles.online_at` каждые 60 с.
   * `useUser` слушает realtime UPDATE на этой же строке и без этого
   * фильтра подменял бы ссылку `currentUser` на каждое heartbeat-эхо.
   * Любой коллбэк/эффект с `[currentUser]` в зависимостях после этого
   * пересоздавался → useChats/useFolders/useTasks начинали N+1 рефетч
   * и переподписку realtime-каналов. Это и есть storm-петля Task #48.
   *
   * Игнорируем изменения, где не изменилось ничего, кроме
   * `online_at`/`updated_at`. Возвращаем тот же `state`
   * (Object.is === true), zustand тогда не уведомляет подписчиков и
   * лишних рендеров не происходит.
   *
   * Сравниваем всё, кроме этих двух полей, а не список «значимых».
   * Список был именно таким и молча устарел: он не знал про
   * `profile_frame`/`profile_background`, поэтому выбор рамки проходил все
   * сравнения, стор возвращал тот же объект — и кнопка выглядела мёртвой,
   * хотя запись в базу проходила. Любой новый столбец профиля теперь
   * значим по умолчанию; пульс пишет только `online_at`, так что фильтр,
   * ради которого всё это писалось, остаётся закрытым.
   */
  setCurrentUser: (user) => set((state) => {
    if (!user || !state.currentUser) return { currentUser: user };
    const unchanged = isHeartbeatOnlyProfileChange(
      state.currentUser as unknown as Record<string, unknown>,
      user as unknown as Record<string, unknown>,
    );
    return unchanged ? state : { currentUser: user };
  }),

  selectedChatId: null,
  setSelectedChatId: (id) => set({ selectedChatId: id, selectedTopicId: null }),

  selectedTopicId: null,
  setSelectedTopicId: (id) => set({ selectedTopicId: id }),

  chats: [],
  setChats: (chats) => set((state) => (
    sameChatList(state.chats, chats) ? state : { chats }
  )),
  updateChat: (chat) =>
    set((state) => ({
      chats: state.chats.map((c) => (c.id === chat.id ? { ...c, ...chat } : c)),
    })),
  updateChatLastMessage: (chatId, message) =>
    set((state) => {
      let changed = false;
      const nextChats = state.chats.map((chat) => {
        if (chat.id !== chatId) return chat;
        if (!shouldReplaceLastMessage(chat.last_message, message)) return chat;
        changed = true;
        return {
          ...chat,
          last_message: message as ChatWithLastMessage["last_message"],
          updated_at: latestTimestamp(chat.updated_at, message.created_at),
        };
      });
      if (!changed) return state;
      return { chats: sortChatsForSidebar(nextChats, state.currentUser?.id ?? null) };
    }),

  messages: {},
  setMessages: (chatId, msgs) =>
    set((state) => ({ messages: { ...state.messages, [chatId]: sortMessages(msgs) } })),
  addMessage: (chatId, message) =>
    set((state) => {
      const existing = state.messages[chatId] || []
      const idx = existing.findIndex((m) => m.id === message.id || sameActorClientMessage(m, message))
      // Upsert: if a message with this id is already in the store (e.g. optimistic copy
      // already replaced with real data, then realtime echo arrives), replace it in place
      // rather than appending a duplicate.
      const next = idx === -1 ? [...existing, message] : existing.map((m, i) => (i === idx ? message : m))
      const sorted = sortMessages(next)
      if (
        sorted.length === existing.length &&
        sorted.every((m, i) => m === existing[i])
      ) {
        return state
      }
      return { messages: { ...state.messages, [chatId]: sorted } }
    }),
  updateMessage: (chatId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).map((m) =>
          m.id === message.id ? message : m
        ),
      },
    })),
  replaceMessage: (chatId, oldId, message) =>
    set((state) => {
      const existing = state.messages[chatId] || []
      const withoutOld = existing.filter((m) => m.id !== oldId && !sameActorClientMessage(m, message))
      const idx = withoutOld.findIndex((m) => m.id === message.id || sameActorClientMessage(m, message))
      const next = idx === -1
        ? [...withoutOld, message]
        : withoutOld.map((m, i) => (i === idx ? message : m))
      return { messages: { ...state.messages, [chatId]: sortMessages(next) } }
    }),
  removeMessage: (chatId, id) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).filter((m) => m.id !== id),
      },
    })),

  activeFolderId: null,
  setActiveFolderId: (id) => set({ activeFolderId: id }),

  showSidebar: true,
  setShowSidebar: (show) => set({ showSidebar: show }),
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),

  mobileSection: 'chats',
  setMobileSection: (section) => set({ mobileSection: section }),

  replyToMessage: null,
  setReplyToMessage: (msg) => set({ replyToMessage: msg }),
  editingMessage: null,
  setEditingMessage: (msg) => set({ editingMessage: msg }),
  forwardingMessage: null,
  setForwardingMessage: (msg) => set({ forwardingMessage: msg }),

  mutedChatIds: typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('ng_muted') ?? '[]')
    : [],
  toggleMutedChat: (chatId) =>
    set((state) => {
      const wasMuted = state.mutedChatIds.includes(chatId);
      const next = wasMuted
        ? state.mutedChatIds.filter((id) => id !== chatId)
        : [...state.mutedChatIds, chatId];
      if (typeof window !== 'undefined') localStorage.setItem('ng_muted', JSON.stringify(next));
      void persistChatPushPreference(state.currentUser?.id ?? null, chatId, !wasMuted);
      return { mutedChatIds: next };
    }),

  markChatRead: (chatId) =>
    set((state) => ({
      chats: state.chats.map((c) => c.id === chatId ? { ...c, unread_count: 0 } : c),
    })),

  chatPanelRequest: null,
  requestChatPanel: (chatId, panel) =>
    set((state) => ({
      chatPanelRequest: {
        chatId,
        panel,
        key: (state.chatPanelRequest?.key ?? 0) + 1,
      },
    })),
  clearChatPanelRequest: (key) =>
    set((state) => (
      state.chatPanelRequest?.key === key ? { chatPanelRequest: null } : state
    )),
}))

async function persistChatPushPreference(userId: string | null, chatId: string, muted: boolean) {
  if (!userId) return;
  try {
    const supabase = createClient();
    await supabase
      .from("chat_notification_preferences")
      .upsert(
        {
          chat_id: chatId,
          user_id: userId,
          push_enabled: !muted,
          muted_until: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "chat_id,user_id" },
      );
  } catch {
    // Local mute remains effective for the current device. DB-backed push mute
    // starts working as soon as the push preference migration is applied.
  }
}
