"use client";

import { useState } from "react";
import type { Topic } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { cn } from "@/lib/utils";
import { TOPIC_NAME_MAX_LENGTH, limitText } from "@/lib/entityLimits";

const QUICK_EMOJI = ["💬", "📌", "🔥", "⚙️", "🐛", "📢", "🎉", "❓", "💡", "📦"];

interface TopicCreateModalProps {
  onClose: () => void;
  onCreate: (name: string, emoji: string | null) => Promise<Topic | null>;
}

export function TopicCreateModal({ onClose, onCreate }: TopicCreateModalProps) {
  const { setSelectedTopicId } = useAppStore();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || busy) return;
    if (name.trim().length > TOPIC_NAME_MAX_LENGTH) return;
    setBusy(true);
    const created = await onCreate(name, emoji);
    setBusy(false);
    if (created) {
      setSelectedTopicId(created.id);
      onClose();
    }
  };

  return (
    <KubModal
      open={true}
      onClose={onClose}
      title="Новый топик"
      icon={<KubIcon name="hash" size={15} />}
      size="sm"
      contentClassName="px-5 py-4 space-y-3"
      footer={
        <KubButton fullWidth onClick={handleSubmit} disabled={!name.trim()} loading={busy}>
          Создать
        </KubButton>
      }
    >
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-[color:var(--kub-muted)]">
          Название
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(limitText(e.target.value, TOPIC_NAME_MAX_LENGTH))}
          placeholder="Общее, Релизы, Оффтоп…"
          maxLength={TOPIC_NAME_MAX_LENGTH}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          className="w-full text-sm outline-none rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)] focus:border-[color:var(--kub-cyan)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-[color:var(--kub-muted)]">
          Иконка (необязательно)
        </label>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setEmoji(null)}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-all border",
              emoji === null
                ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] border-[var(--kub-cyan)]"
                : "bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)] border-[color:var(--kub-border-color)]"
            )}
          >
            #
          </button>
          {QUICK_EMOJI.map((e) => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all border",
                emoji === e
                  ? "bg-[var(--kub-cyan)] border-[var(--kub-cyan)] kub-glow-soft"
                  : "bg-[var(--kub-surface-2)] border-[color:var(--kub-border-color)]"
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    </KubModal>
  );
}
