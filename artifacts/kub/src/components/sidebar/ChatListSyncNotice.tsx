import { useEffect, useState } from "react";

import { KubIcon } from "@/components/kub";
import { FOCUS_RING } from "@/lib/controlSurface";

type ChatListSyncNoticeProps = {
  stale: boolean;
  ownerKey: string;
  onRetry: () => void;
};

export function ChatListSyncNotice({ ownerKey, ...props }: ChatListSyncNoticeProps) {
  // Changing account/session ownership retires both the timer and visible state
  // in the same commit, before the next owner's effect starts its own delay.
  return <OwnedSyncNotice key={ownerKey} {...props} />;
}

function OwnedSyncNotice({ stale, onRetry }: Omit<ChatListSyncNoticeProps, "ownerKey">) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!stale) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => {
      setVisible(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [stale]);

  if (!stale || !visible) return null;

  return (
    <div
      role="status"
      aria-label="Обновление списка чатов"
      aria-live="polite"
      aria-atomic="true"
      className="flex min-w-0 items-center gap-2 px-3 py-1 text-xs leading-5 text-[color:var(--kub-muted)]"
    >
      <span className="min-w-0 flex-1 break-words">Не удалось обновить чаты</span>
      <button
        type="button"
        title="Повторить обновление чатов"
        aria-label="Повторить обновление чатов"
        onClick={onRetry}
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:text-[color:var(--kub-text)] ${FOCUS_RING}`}
      >
        <KubIcon name="rotate" size={16} />
      </button>
    </div>
  );
}
