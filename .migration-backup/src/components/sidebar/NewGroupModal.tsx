"use client";

import { useState, useEffect } from "react";
import { X, Search, Loader2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import type { Profile } from "@/types/database";

export function NewGroupModal({ onClose, onRefetch }: { onClose: () => void; onRefetch?: () => void }) {
  const { currentUser, setSelectedChatId } = useAppStore();
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [groupName, setGroupName] = useState("");
  const [step, setStep] = useState<"pick" | "name">("pick");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("*")
        .neq("id", currentUser?.id ?? "")
        .or(`full_name.ilike.%${query}%,username.ilike.%${query}%`).limit(20);
      setResults((data as Profile[]) ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [query, currentUser, supabase]);

  const toggle = (user: Profile) =>
    setSelected((s) => s.find((u) => u.id === user.id) ? s.filter((u) => u.id !== user.id) : [...s, user]);

  const handleCreate = async () => {
    if (!currentUser || !groupName.trim() || selected.length === 0) return;
    setLoading(true);
    const { data: chat } = await supabase.from("chats")
      .insert({ type: "group", name: groupName.trim(), created_by: currentUser.id })
      .select("id").single();
    if (!chat) { setLoading(false); return; }
    await supabase.from("chat_members").insert([
      { chat_id: chat.id, user_id: currentUser.id, role: "owner" as const },
      ...selected.map((u) => ({ chat_id: chat.id, user_id: u.id, role: "member" as const })),
    ]);
    setSelectedChatId(chat.id);
    onRefetch?.();
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "var(--tg-sidebar)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <h2 className="font-semibold text-sm" style={{ color: "var(--tg-text)" }}>
            {step === "pick" ? "Добавить участников" : "Название группы"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10"
            style={{ color: "var(--tg-text-secondary)" }}><X size={16} /></button>
        </div>

        {step === "pick" ? (
          <>
            <div className="p-3">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--tg-input)" }}>
                <Search size={15} style={{ color: "var(--tg-text-secondary)" }} />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Поиск пользователей…" className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: "var(--tg-text)" }} />
              </div>
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {selected.map((u) => (
                    <span key={u.id} onClick={() => toggle(u)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-full cursor-pointer"
                      style={{ background: "var(--tg-accent)", color: "#fff" }}>
                      {u.full_name ?? u.username} <X size={10} />
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="max-h-60 overflow-y-auto pb-2">
              {results.map((user) => (
                <button key={user.id} onClick={() => toggle(user)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors">
                  <UserAvatar user={user} size="sm" />
                  <span className="flex-1 text-sm text-left" style={{ color: "var(--tg-text)" }}>
                    {user.full_name ?? user.username ?? "Без имени"}
                  </span>
                  {selected.find((u) => u.id === user.id) && (
                    <Check size={15} style={{ color: "var(--tg-accent)" }} />
                  )}
                </button>
              ))}
            </div>
            <div className="p-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <button disabled={selected.length === 0} onClick={() => setStep("name")}
                className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: "var(--tg-accent)", color: "#fff" }}>
                Далее (выбрано: {selected.length})
              </button>
            </div>
          </>
        ) : (
          <div className="p-4 space-y-3">
            <input autoFocus value={groupName} onChange={(e) => setGroupName(e.target.value)}
              placeholder="Название группы" className="w-full bg-transparent text-sm outline-none rounded-xl px-3 py-2"
              style={{ background: "var(--tg-input)", color: "var(--tg-text)" }} />
            <button onClick={handleCreate} disabled={!groupName.trim() || loading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
              style={{ background: "var(--tg-accent)", color: "#fff" }}>
              {loading ? <Loader2 size={16} className="animate-spin mx-auto" /> : "Создать группу"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
