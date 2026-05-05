"use client";

import { useState } from "react";
import { Plus, Hash } from "lucide-react";
import type { Topic } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { TopicCreateModal } from "./TopicCreateModal";

interface TopicStripProps {
  topics: Topic[];
  /** Whether the current user can create new topics (owner / admin). */
  canManage: boolean;
  onCreate: (name: string, emoji: string | null) => Promise<Topic | null>;
}

/**
 * Horizontally-scrollable strip of topic tabs, rendered under ChatHeader for
 * forum chats.  Tapping a tab switches `selectedTopicId`; the message list
 * re-fetches and the input sends to the new topic.
 *
 * The leftmost tab is always the general topic (sorted by useTopics).
 */
export function TopicStrip({ topics, canManage, onCreate }: TopicStripProps) {
  const { selectedTopicId, setSelectedTopicId } = useAppStore();
  const [creating, setCreating] = useState(false);

  if (!topics.length) {
    // Forum mode is on but no topics exist yet — show only "create" prompt
    // for managers, nothing for plain members.
    return canManage ? (
      <div
        className="flex items-center justify-center px-3 py-2 flex-shrink-0"
        style={{ background: "var(--tg-header)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors hover:bg-white/10"
          style={{ color: "var(--tg-accent)" }}
        >
          <Plus size={13} />
          Создать первый топик
        </button>
        {creating && <TopicCreateModal onClose={() => setCreating(false)} onCreate={onCreate} />}
      </div>
    ) : null;
  }

  return (
    <div
      className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto no-scrollbar flex-shrink-0"
      style={{ background: "var(--tg-header)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
    >
      {topics.map((t) => {
        const active = t.id === selectedTopicId;
        return (
          <button
            key={t.id}
            onClick={() => setSelectedTopicId(t.id)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors"
            style={{
              background: active ? "var(--tg-accent)" : "rgba(255,255,255,0.04)",
              color: active ? "#fff" : "var(--tg-text-secondary)",
            }}
          >
            {t.emoji ? <span className="text-sm">{t.emoji}</span> : <Hash size={11} />}
            <span>{t.name}</span>
          </button>
        );
      })}
      {canManage && (
        <button
          onClick={() => setCreating(true)}
          title="Создать топик"
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
          style={{ color: "var(--tg-accent)" }}
        >
          <Plus size={14} />
        </button>
      )}
      {creating && <TopicCreateModal onClose={() => setCreating(false)} onCreate={onCreate} />}
    </div>
  );
}
