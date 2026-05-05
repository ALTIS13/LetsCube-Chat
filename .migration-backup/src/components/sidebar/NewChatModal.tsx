"use client";

import { useState, useEffect } from "react";
import { X, Search, Loader2, AlertCircle } from "lucide-react";
import { useCreateChat } from "@/hooks/useCreateChat";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import type { Profile } from "@/types/database";

interface NewChatModalProps {
  onClose: () => void;
  onRefetch?: () => void;
}

export function NewChatModal({ onClose, onRefetch }: NewChatModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const { searchUsers, openPrivateChat, loading, error } = useCreateChat();

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const found = await searchUsers(query);
      setResults(found);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query, searchUsers]);

  const handleSelect = async (user: Profile) => {
    const chatId = await openPrivateChat(user.id);
    if (chatId) {
      onRefetch?.();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "var(--tg-sidebar)", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <h2 className="font-semibold text-sm" style={{ color: "var(--tg-text)" }}>Новое сообщение</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
            style={{ color: "var(--tg-text-secondary)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="p-3">
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{ background: "var(--tg-input)" }}
          >
            <Search size={15} style={{ color: "var(--tg-text-secondary)" }} />
            <input
              autoFocus
              type="text"
              placeholder="Поиск по имени или @username…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--tg-text)" }}
            />
            {searching && (
              <Loader2 size={14} className="animate-spin" style={{ color: "var(--tg-text-secondary)" }} />
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
            <AlertCircle size={13} />
            {error}
          </div>
        )}

        {/* Results */}
        <div className="max-h-72 overflow-y-auto pb-2">
          {!query.trim() && (
            <p className="text-center text-sm py-8" style={{ color: "var(--tg-text-secondary)" }}>
              Введите имя для поиска
            </p>
          )}
          {query.trim() && !searching && results.length === 0 && (
            <p className="text-center text-sm py-8" style={{ color: "var(--tg-text-secondary)" }}>
              Пользователи не найдены
            </p>
          )}
          {results.map((user) => (
            <button
              key={user.id}
              onClick={() => handleSelect(user)}
              disabled={loading}
              className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 size={20} className="animate-spin flex-shrink-0" style={{ color: "var(--tg-accent)" }} />
              ) : (
                <UserAvatar user={user} size="sm" />
              )}
              <div className="text-left min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: "var(--tg-text)" }}>
                  {user.full_name ?? "Без имени"}
                </div>
                {user.username && (
                  <div className="text-xs truncate" style={{ color: "var(--tg-text-secondary)" }}>
                    @{user.username}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
