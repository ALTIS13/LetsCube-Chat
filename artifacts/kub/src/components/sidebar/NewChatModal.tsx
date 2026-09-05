"use client";

import { useState, useEffect } from "react";
import { useCreateChat } from "@/hooks/useCreateChat";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon, KubModal } from "@/components/kub";
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
    <KubModal
      open={true}
      onClose={onClose}
      title="Новое сообщение"
      icon={<KubIcon name="edit" size={15} />}
      size="sm"
      contentClassName="px-4 py-3 space-y-3"
    >
      <div className="flex items-center gap-2 rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all">
        <KubIcon name="search" size={14} className="text-[color:var(--kub-muted)]" />
        <input
          autoFocus
          type="text"
          placeholder="Поиск по имени или @никнейму…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm outline-none text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
        />
        {searching && <KubIcon name="spinner" size={14} className="text-[color:var(--kub-cyan)]" />}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger-text)] border border-[color:var(--kub-danger)]/30">
          <KubIcon name="alert" size={13} />
          {error}
        </div>
      )}

      <div className="max-h-72 overflow-y-auto -mx-4 px-1">
        {!query.trim() && (
          <p className="text-center text-sm py-8 text-[color:var(--kub-muted)]">
            Введите имя для поиска
          </p>
        )}
        {query.trim() && !searching && results.length === 0 && (
          <p className="text-center text-sm py-8 text-[color:var(--kub-muted)]">
            Пользователи не найдены
          </p>
        )}
        {results.map((user) => (
          <button
            key={user.id}
            onClick={() => handleSelect(user)}
            disabled={loading}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors hover:bg-[var(--kub-surface-2)] disabled:opacity-50"
          >
            {loading ? (
              <KubIcon name="spinner" size={20} className="flex-shrink-0 text-[color:var(--kub-cyan)]" />
            ) : (
              <UserAvatar user={user} size="sm" />
            )}
            <div className="text-left min-w-0">
              <div className="text-sm font-medium truncate text-[color:var(--kub-text)]">
                {user.full_name ?? "Без имени"}
              </div>
              {user.username && (
                <div className="text-xs truncate text-[color:var(--kub-muted)]">
                  @{user.username}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </KubModal>
  );
}
