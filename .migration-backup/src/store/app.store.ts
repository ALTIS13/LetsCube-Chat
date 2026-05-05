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

export const useAppStore = create<AppState>((set) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),

  selectedChatId: null,
  setSelectedChatId: (id) => set({ selectedChatId: id, selectedTopicId: null }),

  selectedTopicId: null,
  setSelectedTopicId: (id) => set({ selectedTopicId: id }),

  chats: [],
  setChats: (chats) => set({ chats }),
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
