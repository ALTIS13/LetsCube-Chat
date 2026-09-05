import type { ReactNode } from "react";

import { KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";
import type { PublicPlatformState } from "@/lib/publicReleaseModel";

/**
 * The single action for one platform on the public downloads surface.
 *
 * The control keeps the same box in every state so a section never reflows
 * while the catalog is being checked, and it only ever becomes a real link when
 * the model produced a validated artifact URL. A platform that is not released
 * says so in words and offers nothing to press.
 *
 * The stale disclosure belongs here rather than in the surrounding section: the
 * hero renders this control on its own, and a cached manifest can sit behind
 * any state it produced, not only an available one.
 */

type Props = {
  platform: PublicPlatformState;
  onRetry?: () => void;
};

const ACTION_BOX =
  "inline-flex min-h-11 min-w-[13rem] items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold";

const OUTLINE = "border border-[color:var(--kub-border-color)]";

export function ReleaseDownloadAction({ platform, onRetry }: Props) {
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {renderControl(platform, onRetry)}
      {platform.stale && (
        <span className="text-xs text-[color:var(--kub-muted)]">Показаны сохранённые данные каталога</span>
      )}
    </span>
  );
}

function renderControl(platform: PublicPlatformState, onRetry?: () => void): ReactNode {
  if (platform.state === "loading") {
    return (
      <span
        className={cn(ACTION_BOX, OUTLINE, "text-[color:var(--kub-muted)]")}
        aria-live="polite"
      >
        <KubIcon name="spinner" size={16} tone="muted" spin />
        Проверяем версию
      </span>
    );
  }

  if (platform.state === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        // The only pressable control among the outlined states, and it lands on
        // a card whose own surface differs per platform, so the hover is the
        // veil rather than a fixed elevation colour that would go flush on one
        // of them.
        className={cn(ACTION_BOX, OUTLINE, "kub-raise-hover text-[color:var(--kub-text)]")}
      >
        <KubIcon name="rotate" size={16} tone="muted" />
        Повторить проверку
      </button>
    );
  }

  if (platform.state === "unavailable" || !platform.href) {
    return (
      <span className={cn(ACTION_BOX, OUTLINE, "text-[color:var(--kub-muted)]")}>
        <KubIcon name="clock" size={16} tone="muted" />
        В разработке
      </span>
    );
  }

  return (
    <a
      href={platform.href}
      // A direct catalog artifact, so no interception and no authentication.
      className={cn(
        ACTION_BOX,
        "bg-[var(--kub-action-primary-background)] text-[color:var(--kub-action-primary-foreground)] hover:bg-[var(--kub-action-primary-hover)]",
      )}
    >
      <KubIcon name="cloud" size={16} tone="currentColor" />
      Скачать для {platform.title}
      {platform.version && <span className="font-normal opacity-80">{platform.version}</span>}
    </a>
  );
}
