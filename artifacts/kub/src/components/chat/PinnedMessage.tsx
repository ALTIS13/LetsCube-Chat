"use client";

import { KubIcon } from "@/components/kub";
import type { MessageWithSender } from "@/types/database";
import { useState } from "react";

interface PinnedMessageProps {
  message: MessageWithSender;
}

export function PinnedMessage({ message }: PinnedMessageProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors flex-shrink-0 bg-[var(--kub-surface)] border-b border-[color:var(--kub-border-color)] hover:bg-[var(--kub-surface-2)] relative">
      <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--kub-cyan)]" />
      <KubIcon name="pin" size={14} className="flex-shrink-0 text-[color:var(--kub-cyan)]" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-0.5 text-[color:var(--kub-cyan)]">
          Закреплённое сообщение
        </div>
        <div className="text-xs truncate text-[color:var(--kub-muted)]">
          {message.content}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
        className="flex-shrink-0 p-1 rounded-lg hover:bg-[var(--kub-surface-3)] transition-colors text-[color:var(--kub-muted)]"
        aria-label="Скрыть"
      >
        <KubIcon name="close" size={14} />
      </button>
    </div>
  );
}
