import { create } from 'zustand'
import type { Profile, ChatWithLastMessage, MessageWithSender } from '@/types/database'

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
}

function sameChatList(a: ChatWithLastMessage[], b: ChatWithLastMessage[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((chat, index) => {
    const next = b[index];
    return (
      chat.id === next.id &&
      chat.name === next.name &&
      chat.description === next.description &&
      chat.avatar_url === next.avatar_url &&
      chat.is_forum === next.is_forum &&
      chat.updated_at === next.updated_at &&
      chat.unread_count === next.unread_count &&
      chat.last_message?.id === next.last_message?.id &&
      chat.last_message?.created_at === next.last_message?.created_at &&
      chat.last_message?.edited_at === next.last_message?.edited_at &&
      chat.last_message?.deleted_at === next.last_message?.deleted_at
    );
  });
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
   * Игнорируем изменения, где из значимых полей не изменилось ничего —
   * меняется только `online_at`/`updated_at`. Возвращаем тот же `state`
   * (Object.is === true), zustand тогда не уведомляет подписчиков и
   * лишних рендеров не происходит.
   */
  setCurrentUser: (user) => set((state) => {
    if (!user || !state.currentUser) return { currentUser: user };
    const a = state.currentUser;
    const b = user;
    if (
      a.id === b.id &&
      a.full_name === b.full_name &&
      a.username === b.username &&
      a.avatar_url === b.avatar_url &&
      a.bio === b.bio &&
      a.role === b.role
    ) {
      return state;
    }
    return { currentUser: b };
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

  messages: {},
  setMessages: (chatId, msgs) =>
    set((state) => ({ messages: { ...state.messages, [chatId]: msgs } })),
  addMessage: (chatId, message) =>
    set((state) => {
      const existing = state.messages[chatId] || []
      const idx = existing.findIndex((m) => m.id === message.id)
      // Upsert: if a message with this id is already in the store (e.g. optimistic copy
      // already replaced with real data, then realtime echo arrives), replace it in place
      // rather than appending a duplicate.
      const next = idx === -1 ? [...existing, message] : existing.map((m, i) => (i === idx ? message : m))
      return { messages: { ...state.messages, [chatId]: next } }
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
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).map((m) =>
          m.id === oldId ? message : m
        ),
      },
    })),
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
      const next = state.mutedChatIds.includes(chatId)
        ? state.mutedChatIds.filter((id) => id !== chatId)
        : [...state.mutedChatIds, chatId];
      if (typeof window !== 'undefined') localStorage.setItem('ng_muted', JSON.stringify(next));
      return { mutedChatIds: next };
    }),

  markChatRead: (chatId) =>
    set((state) => ({
      chats: state.chats.map((c) => c.id === chatId ? { ...c, unread_count: 0 } : c),
    })),
}))
