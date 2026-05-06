"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import type { Profile } from "@/types/database";
import { prefixError } from "@/lib/errors";
import { CHAT_NAME_MAX_LENGTH, limitText } from "@/lib/entityLimits";

export function NewGroupModal({ onClose, onRefetch }: { onClose: () => void; onRefetch?: () => void }) {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [groupName, setGroupName] = useState("");
  const [step, setStep] = useState<"pick" | "name">("pick");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("*")
        .neq("id", userId ?? "")
        .or(`full_name.ilike.%${query}%,username.ilike.%${query}%`).limit(20);
      setResults((data as Profile[]) ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [query, userId, supabase]);

  const toggle = (user: Profile) =>
    setSelected((s) => s.find((u) => u.id === user.id) ? s.filter((u) => u.id !== user.id) : [...s, user]);

  const handleCreate = async () => {
    if (!userId || !groupName.trim() || selected.length === 0) return;
    if (groupName.trim().length > CHAT_NAME_MAX_LENGTH) {
      setError(`Название группы не должно быть длиннее ${CHAT_NAME_MAX_LENGTH} символов.`);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: chat, error: chatErr } = await supabase.from("chats")
      .insert({ type: "group", name: groupName.trim(), created_by: userId })
      .select("id").single();
    if (chatErr || !chat) {
      setError(chatErr ? prefixError("Не удалось создать группу", chatErr) : "Не удалось создать группу");
      setLoading(false);
      return;
    }
    // Owner row is inserted automatically by the `trg_add_chat_creator_as_owner`
    // trigger (SECURITY DEFINER), so we only insert the picked members here.
    if (selected.length > 0) {
      const { error: memErr } = await supabase.from("chat_members").insert(
        selected.map((u) => ({ chat_id: chat.id, user_id: u.id, role: "member" as const })),
      );
      if (memErr) {
        setError(prefixError("Не удалось добавить участников", memErr));
        setLoading(false);
        return;
      }
    }
    setSelectedChatId(chat.id);
    onRefetch?.();
    setLoading(false);
    onClose();
  };

  return (
    <KubModal
      open={true}
      onClose={onClose}
      title={step === "pick" ? "Добавить участников" : "Название группы"}
      icon={<KubIcon name="group" size={15} />}
      size="sm"
      contentClassName="px-4 py-3 space-y-3"
      footer={
        step === "pick" ? (
          <KubButton
            fullWidth
            disabled={selected.length === 0}
            onClick={() => setStep("name")}
          >
            Далее (выбрано: {selected.length})
          </KubButton>
        ) : (
          <KubButton
            fullWidth
            onClick={handleCreate}
            disabled={!groupName.trim()}
            loading={loading}
          >
            Создать группу
          </KubButton>
        )
      }
    >
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger)] border border-[color:var(--kub-danger)]/30">
          <KubIcon name="alert" size={13} />
          {error}
        </div>
      )}
      {step === "pick" ? (
        <>
          <div className="flex items-center gap-2 rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all">
            <KubIcon name="search" size={14} className="text-[color:var(--kub-muted)]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск пользователей…"
              className="flex-1 bg-transparent text-sm outline-none text-[color:var(--kub-text)]"
            />
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selected.map((u) => (
                <button
                  key={u.id}
                  onClick={() => toggle(u)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-soft"
                >
                  {u.full_name ?? u.username} <KubIcon name="close" size={10} />
                </button>
              ))}
            </div>
          )}

          <div className="max-h-60 overflow-y-auto -mx-4 px-1">
            {results.map((user) => (
              <button
                key={user.id}
                onClick={() => toggle(user)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--kub-surface-2)] transition-colors"
              >
                <UserAvatar user={user} size="sm" />
                <span className="flex-1 text-sm text-left text-[color:var(--kub-text)]">
                  {user.full_name ?? user.username ?? "Без имени"}
                </span>
                {selected.find((u) => u.id === user.id) && (
                  <KubIcon name="check" size={15} className="text-[color:var(--kub-cyan)]" />
                )}
              </button>
            ))}
          </div>
        </>
      ) : (
        <input
          autoFocus
          value={groupName}
          onChange={(e) => setGroupName(limitText(e.target.value, CHAT_NAME_MAX_LENGTH))}
          placeholder="Название группы"
          maxLength={CHAT_NAME_MAX_LENGTH}
          className="w-full text-sm outline-none rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)] focus:border-[color:var(--kub-cyan)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all"
        />
      )}
    </KubModal>
  );
}
