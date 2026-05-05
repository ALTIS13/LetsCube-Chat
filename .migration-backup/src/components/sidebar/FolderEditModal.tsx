"use client";

import { useState, useEffect } from "react";
import { X, Loader2, Trash2, Check } from "lucide-react";
import type { Folder, ChatWithLastMessage } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar } from "@/components/ui/ChatAvatar";

const QUICK_EMOJI = ["👤", "💼", "📢", "📌", "🔥", "🏠", "🎓", "💬", "❤️", "📦"];

interface FolderEditModalProps {
  /** When provided — edit mode for that folder.  When null — create mode. */
  folder: Folder | null;
  onClose: () => void;
  // Data + mutations are passed in from Sidebar, which owns the single
  // useFolders subscription.  Calling useFolders inside this modal would
  // create a second channel with the same name and crash supabase-realtime
  // ("cannot add postgres_changes callbacks ... after subscribe()").
  folderChats: Record<string, Set<string>>;
  createFolder: (name: string, emoji: string | null) => Promise<Folder | null>;
  updateFolder: (id: string, patch: { name?: string; emoji?: string | null }) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  setChatsForFolder: (folderId: string, chatIds: string[]) => Promise<void>;
}

/**
 * Single dialog for both creating and editing a sidebar folder.
 * Lets the user pick name, emoji, and which chats belong to it.
 */
export function FolderEditModal({
  folder,
  onClose,
  folderChats,
  createFolder,
  updateFolder,
  deleteFolder,
  setChatsForFolder,
}: FolderEditModalProps) {
  const { chats } = useAppStore();

  const [name, setName] = useState(folder?.name ?? "");
  const [emoji, setEmoji] = useState<string | null>(folder?.emoji ?? null);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(() => {
    if (folder) return new Set(folderChats[folder.id] ?? []);
    return new Set();
  });
  const [busy, setBusy] = useState(false);

  // Sync selectedChatIds when membership data arrives after the modal mounts.
  useEffect(() => {
    if (folder) setSelectedChatIds(new Set(folderChats[folder.id] ?? []));
  }, [folder, folderChats]);

  const toggleChat = (chatId: string) => {
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    let folderId = folder?.id;
    if (folder) {
      await updateFolder(folder.id, { name, emoji });
    } else {
      const created = await createFolder(name, emoji);
      folderId = created?.id;
    }
    if (folderId) {
      await setChatsForFolder(folderId, [...selectedChatIds]);
    }
    setBusy(false);
    onClose();
  };

  const handleDelete = async () => {
    if (!folder) return;
    if (!confirm(`Удалить папку "${folder.name}"?`)) return;
    setBusy(true);
    await deleteFolder(folder.id);
    setBusy(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]"
        style={{ background: "var(--tg-sidebar)", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <h2 className="font-semibold text-sm" style={{ color: "var(--tg-text)" }}>
            {folder ? "Редактировать папку" : "Новая папка"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
            style={{ color: "var(--tg-text-secondary)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--tg-text-secondary)" }}>
              Название
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Работа, Семья, Учёба…"
              maxLength={30}
              className="w-full bg-transparent text-sm outline-none rounded-xl px-3 py-2"
              style={{ background: "var(--tg-input)", color: "var(--tg-text)" }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--tg-text-secondary)" }}>
              Иконка
            </label>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setEmoji(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-all"
                style={{
                  background: emoji === null ? "var(--tg-accent)" : "var(--tg-input)",
                  color: emoji === null ? "#fff" : "var(--tg-text-secondary)",
                }}
              >
                —
              </button>
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all"
                  style={{ background: emoji === e ? "var(--tg-accent)" : "var(--tg-input)" }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--tg-text-secondary)" }}>
              Чаты в папке ({selectedChatIds.size})
            </label>
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--tg-input)" }}>
              {chats.length === 0 ? (
                <p className="px-4 py-3 text-xs" style={{ color: "var(--tg-text-secondary)" }}>
                  У тебя пока нет чатов
                </p>
              ) : (
                chats.map((c: ChatWithLastMessage) => {
                  const checked = selectedChatIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleChat(c.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-white/5"
                    >
                      <div
                        className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                        style={{
                          background: checked ? "var(--tg-accent)" : "transparent",
                          border: `1px solid ${checked ? "var(--tg-accent)" : "rgba(255,255,255,0.2)"}`,
                        }}
                      >
                        {checked && <Check size={10} color="#fff" />}
                      </div>
                      <ChatAvatar chat={c} size="sm" />
                      <span
                        className="text-sm text-left truncate flex-1"
                        style={{ color: "var(--tg-text)" }}
                      >
                        {c.name ?? "Без названия"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div
          className="p-3 flex items-center gap-2 flex-shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          {folder && (
            <button
              onClick={handleDelete}
              disabled={busy}
              className="px-3 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 hover:bg-white/5"
              style={{ color: "#ef4444" }}
              title="Удалить папку"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!name.trim() || busy}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 transition-all"
            style={{ background: "var(--tg-accent)", color: "#fff" }}
          >
            {busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : (folder ? "Сохранить" : "Создать")}
          </button>
        </div>
      </div>
    </div>
  );
}
