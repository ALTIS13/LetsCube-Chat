"use client";

import { useState } from "react";
import type { Topic } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { KubIcon } from "@/components/kub";
import { TopicCreateModal } from "./TopicCreateModal";
import { cn } from "@/lib/utils";

interface TopicStripProps {
  topics: Topic[];
  canManage: boolean;
  onCreate: (name: string, emoji: string | null) => Promise<Topic | null>;
}

export function TopicStrip({ topics, canManage, onCreate }: TopicStripProps) {
  const { selectedTopicId, setSelectedTopicId } = useAppStore();
  const [creating, setCreating] = useState(false);

  if (!topics.length) {
    return canManage ? (
      <div className="flex items-center justify-center px-3 py-2 flex-shrink-0 bg-[var(--kub-surface)] border-b border-[color:var(--kub-border-color)]">
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors hover:bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]"
        >
          <KubIcon name="create" size={13} />
          Создать первый топик
        </button>
        {creating && <TopicCreateModal onClose={() => setCreating(false)} onCreate={onCreate} />}
      </div>
    ) : null;
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto no-scrollbar flex-shrink-0 bg-[var(--kub-surface)] border-b border-[color:var(--kub-border-color)]">
      {topics.map((t) => {
        const active = t.id === selectedTopicId;
        return (
          <button
            key={t.id}
            onClick={() => setSelectedTopicId(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border",
              active
                ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] border-[var(--kub-cyan)] kub-glow-soft"
                : "bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)] border-[color:var(--kub-border-color)] hover:text-[color:var(--kub-text)]"
            )}
          >
            {t.emoji ? <span className="text-sm">{t.emoji}</span> : <KubIcon name="hash" size={11} />}
            <span>{t.name}</span>
          </button>
        );
      })}
      {canManage && (
        <button
          onClick={() => setCreating(true)}
          title="Создать топик"
          aria-label="Создать топик"
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--kub-surface-2)] text-[color:var(--kub-cyan)]"
        >
          <KubIcon name="create" size={14} />
        </button>
      )}
      {creating && <TopicCreateModal onClose={() => setCreating(false)} onCreate={onCreate} />}
    </div>
  );
}
