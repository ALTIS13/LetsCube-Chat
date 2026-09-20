"use client";

import { useCallback, useState } from "react";
import { KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";
import { formatUsername } from "@/lib/chatMemberList";
import { showAppAlert } from "@/lib/appDialogs";

/**
 * The никнейм, and the one control for taking it away with you.
 *
 * A **leaf**, shared by both profile surfaces. That is the division Discord's
 * own family uses and the assessment recorded: the popout body (module 851588)
 * and the human modal (module 808261) are different components that share the
 * *leaves* — bio, roles, connections, the note — and not a root. So this is the
 * shape to copy for anything the two surfaces both say.
 *
 * The control itself is inherited rather than invented. It belonged to
 * `SearchProfilePreview`'s «Мини-профиль», the third profile surface the
 * assessment found and D-283 deliberately left standing; folding that surface
 * into the two real ones would have quietly dropped the one capability it had
 * that neither of the others did. It is here instead, on both of them.
 */
export function ProfileUsernameLine({
  username,
  className,
}: {
  username: string | null;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    if (!username) return;
    try {
      await navigator.clipboard?.writeText(`@${username}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      showAppAlert("Не удалось скопировать никнейм.", "Копирование недоступно");
    }
  }, [username]);

  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center justify-center gap-1.5 text-sm text-[color:var(--kub-muted)]",
        className,
      )}
      data-testid="member-card-username"
    >
      <span className="min-w-0 truncate">{formatUsername(username)}</span>
      {username && (
        <button
          type="button"
          data-testid="profile-copy-username"
          onClick={() => void copy()}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition kub-raise-hover hover:text-[color:var(--kub-cyan)]"
          aria-label="Скопировать никнейм"
          title={copied ? "Никнейм скопирован" : "Скопировать никнейм"}
        >
          <KubIcon name={copied ? "check" : "copy"} size={14} />
        </button>
      )}
    </div>
  );
}
