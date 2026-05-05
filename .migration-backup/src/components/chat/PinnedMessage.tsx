"use client";

import { Pin, X } from "lucide-react";
import type { MessageWithSender } from "@/types/database";
import { useState } from "react";

interface PinnedMessageProps {
  message: MessageWithSender;
}

export function PinnedMessage({ message }: PinnedMessageProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:brightness-110 transition-all flex-shrink-0"
      style={{
        background: "var(--tg-header)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        borderLeft: "3px solid var(--tg-accent)",
      }}
    >
      <Pin size={14} style={{ color: "var(--tg-accent)", flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold mb-0.5" style={{ color: "var(--tg-accent)" }}>
          Закреплённое сообщение
        </div>
        <div className="text-xs truncate" style={{ color: "var(--tg-text-secondary)" }}>
          {message.content}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
        className="flex-shrink-0 p-1 rounded-full hover:bg-white/10 transition-colors"
        style={{ color: "var(--tg-text-secondary)" }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
