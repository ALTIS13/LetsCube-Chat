"use client";

import { useState } from "react";
import type { Topic } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { cn } from "@/lib/utils";
import { CHANNEL_NAME_MAX, channelNameRemaining, normalizeChannelName } from "@/lib/serverChannels";

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

  /**
   * The same cut every other channel name gets.
   *
   * `normalizeChannelName` collapses runs of whitespace, trims, and cuts **by
   * code point** — `char_length` in Postgres counts characters where
   * `String.length` counts UTF-16 code units, and an emoji costs two of those.
   * The line it replaced was `limitText`, which slices code units, plus a
   * length check the field's own `maxLength` had already made unreachable.
   *
   * A name of nothing but spaces now stops here rather than at the hook.
   */
  const handleSubmit = async () => {
    const cleaned = normalizeChannelName(name);
    if (!cleaned || busy) return;
    setBusy(true);
    const created = await onCreate(cleaned, emoji);
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
        <label className="block text-[12px] font-semibold uppercase tracking-wider mb-1.5 text-[color:var(--kub-muted)]">
          Название
        </label>
        <input
          autoFocus
          value={name}
          data-testid="topic-create-name"
          onChange={(e) => setName(e.target.value)}
          placeholder="Общее, Релизы, Оффтоп…"
          maxLength={CHANNEL_NAME_MAX}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          className="w-full text-sm rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
        />
        {/* Only near the limit: a counter that is always there is a counter
            nobody reads, and the number is the one the constraint counts. */}
        {channelNameRemaining(name) <= 16 && (
          <div className="mt-1 text-right text-[11px] tabular-nums text-[color:var(--kub-muted)]">
            {channelNameRemaining(name)}
          </div>
        )}
      </div>

      <div>
        <label className="block text-[12px] font-semibold uppercase tracking-wider mb-1.5 text-[color:var(--kub-muted)]">
          Иконка (необязательно)
        </label>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setEmoji(null)}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-all border pointer-coarse:h-11 pointer-coarse:w-11",
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
                "w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all border pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:text-xl",
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
