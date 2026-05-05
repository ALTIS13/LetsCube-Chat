"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import type { Topic } from "@/types/database";
import { useAppStore } from "@/store/app.store";

const QUICK_EMOJI = ["💬", "📌", "🔥", "⚙️", "🐛", "📢", "🎉", "❓", "💡", "📦"];

interface TopicCreateModalProps {
  onClose: () => void;
  onCreate: (name: string, emoji: string | null) => Promise<Topic | null>;
}

/**
 * Tiny dialog for creating a new topic.  On success, switches the active
 * topic to the freshly-created one so the user is dropped right into it.
 */
export function TopicCreateModal({ onClose, onCreate }: TopicCreateModalProps) {
  const { setSelectedTopicId } = useAppStore();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const created = await onCreate(name, emoji);
    setBusy(false);
    if (created) {
      setSelectedTopicId(created.id);
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
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <h2 className="font-semibold text-sm" style={{ color: "var(--tg-text)" }}>
            Новый топик
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
            style={{ color: "var(--tg-text-secondary)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--tg-text-secondary)" }}>
              Название
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Общее, Релизы, Оффтоп…"
              maxLength={50}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="w-full bg-transparent text-sm outline-none rounded-xl px-3 py-2"
              style={{ background: "var(--tg-input)", color: "var(--tg-text)" }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--tg-text-secondary)" }}>
              Иконка (необязательно)
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
                #
              </button>
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all"
                  style={{
                    background: emoji === e ? "var(--tg-accent)" : "var(--tg-input)",
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!name.trim() || busy}
            className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 transition-all"
            style={{ background: "var(--tg-accent)", color: "#fff" }}
          >
            {busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}
