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
 */

type Props = {
  platform: PublicPlatformState;
  onRetry?: () => void;
  className?: string;
};

const ACTION_BOX =
  "inline-flex min-h-11 min-w-[13rem] items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold";

export function ReleaseDownloadAction({ platform, onRetry, className }: Props) {
  const label = downloadLabel(platform.title);

  if (platform.state === "loading") {
    return (
      <span
        className={cn(ACTION_BOX, "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)]", className)}
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
        className={cn(ACTION_BOX, "border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)]", className)}
      >
        <KubIcon name="rotate" size={16} tone="muted" />
        Повторить проверку
      </button>
    );
  }

  if (platform.state === "unavailable" || !platform.href) {
    return (
      <span
        className={cn(ACTION_BOX, "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)]", className)}
      >
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
        className,
      )}
    >
      <KubIcon name="cloud" size={16} tone="currentColor" />
      {label}
      {platform.version && <span className="font-normal opacity-80">{platform.version}</span>}
    </a>
  );
}

function downloadLabel(title: string): string {
  return `Скачать для ${title}`;
}
