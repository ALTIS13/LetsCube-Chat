"use client";

import { useState, useCallback } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import type { MessageWithSender } from "@/types/database";

interface ChatSearchBarProps {
  messages: MessageWithSender[];
  onClose: () => void;
  onJumpTo: (messageId: string) => void;
}

export function ChatSearchBar({ messages, onClose, onJumpTo }: ChatSearchBarProps) {
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);

  const results = query.trim()
    ? messages.filter((m) =>
        m.content?.toLowerCase().includes(query.toLowerCase())
      )
    : [];

  const total = results.length;

  const jumpTo = useCallback(
    (i: number) => {
      if (!results[i]) return;
      setIdx(i);
      onJumpTo(results[i].id);
    },
    [results, onJumpTo]
  );

  const handleChange = (v: string) => {
    setQuery(v);
    setIdx(0);
    if (v.trim()) {
      const found = messages.filter((m) =>
        m.content?.toLowerCase().includes(v.toLowerCase())
      );
      if (found.length) onJumpTo(found[0].id);
    }
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
      style={{ background: "var(--tg-header)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
    >
      <input
        autoFocus
        type="text"
        placeholder="Поиск в чате…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        className="flex-1 bg-transparent text-sm outline-none"
        style={{ color: "var(--tg-text)" }}
      />

      {query.trim() && (
        <span className="text-xs flex-shrink-0" style={{ color: "var(--tg-text-secondary)" }}>
          {total > 0 ? `${idx + 1}/${total}` : "ничего не найдено"}
        </span>
      )}

      <div className="flex items-center gap-0">
        <button
          onClick={() => jumpTo(Math.max(0, idx - 1))}
          disabled={total === 0 || idx === 0}
          className="p-1.5 rounded-full hover:bg-white/10 disabled:opacity-30 transition-colors"
          style={{ color: "var(--tg-text-secondary)" }}
        >
          <ChevronUp size={16} />
        </button>
        <button
          onClick={() => jumpTo(Math.min(total - 1, idx + 1))}
          disabled={total === 0 || idx === total - 1}
          className="p-1.5 rounded-full hover:bg-white/10 disabled:opacity-30 transition-colors"
          style={{ color: "var(--tg-text-secondary)" }}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <button
        onClick={onClose}
        className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
        style={{ color: "var(--tg-text-secondary)" }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
