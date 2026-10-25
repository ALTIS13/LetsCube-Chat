import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { KubButton } from "@/components/kub/KubButton";
import { KubIcon } from "@/components/kub/KubIcon";
import { formatStorageBytes } from "@/lib/platform/desktopStorage";

export interface MediaCacheSectionProps {
  stats: { bytes: number; count: number; limitBytes: number } | null;
  pending: boolean;
  error: string | null;
  onClear: () => void;
  onLimitChange: (bytes: number) => void;
}

const MEBIBYTE = 1024 * 1024;
const LIMITS = [64 * MEBIBYTE, 128 * MEBIBYTE, 256 * MEBIBYTE];

/** The owner supplies account-scoped statistics and media-only commands. */
export function MediaCacheSection({ stats, pending, error, onClear, onLimitChange }: MediaCacheSectionProps) {
  const headingId = useId();
  const safetyId = useId();
  const limitsId = useId();
  const [clearRequested, setClearRequested] = useState(false);
  const empty = stats !== null && stats.bytes === 0 && stats.count === 0;
  const disabled = pending || stats === null;
  const cleared = clearRequested && empty && !pending && !error;
  const selectedIndex = stats ? LIMITS.indexOf(stats.limitBytes) : -1;
  const usage = stats ? `${formatStorageBytes(stats.bytes)} из ${formatStorageBytes(stats.limitBytes)}` : null;
  const filledBytes = stats ? Math.min(stats.bytes, stats.limitBytes) : 0;
  const share = stats && stats.limitBytes > 0 ? filledBytes / stats.limitBytes * 100 : 0;

  // An error or newly populated cache retires the result of the last clear.
  useEffect(() => {
    if (error || (!pending && !empty)) setClearRequested(false);
  }, [error, pending, empty]);

  const chooseLimit = (bytes: number) => {
    if (disabled || stats?.limitBytes === bytes) return;
    setClearRequested(false);
    onLimitChange(bytes);
  };

  const navigateLimits = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    let next: number;
    switch (event.key) {
      case "ArrowRight": case "ArrowDown": next = (index + 1) % LIMITS.length; break;
      case "ArrowLeft": case "ArrowUp": next = (index + LIMITS.length - 1) % LIMITS.length; break;
      case "Home": next = 0; break;
      case "End": next = LIMITS.length - 1; break;
      default: return;
    }
    event.preventDefault();
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
    chooseLimit(LIMITS[next]);
  };

  const status = !stats
    ? error ? "Данные о медиакэше недоступны" : "Считаем медиакэш..."
    : pending
      ? clearRequested ? "Очищаем медиакэш..." : "Сохраняем лимит..."
      : cleared ? "Медиакэш очищен" : empty ? "Медиакэш пуст" : "";

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3 text-sm text-[color:var(--kub-text)]" data-testid="media-cache-section">
      <h3 id={headingId} className="flex min-w-0 items-center gap-2 text-sm font-semibold">
        <KubIcon name="image" size={16} className="shrink-0 text-[color:var(--kub-cyan)]" />
        Медиакэш
      </h3>

      <div className="space-y-2" aria-busy={pending || (!stats && !error)}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 tabular-nums">
          <span data-testid="media-cache-usage">{usage ?? "Объём пока неизвестен"}</span>
          <span className="text-[color:var(--kub-muted)]" data-testid="media-cache-count">
            {stats ? `Файлов: ${stats.count.toLocaleString("ru-RU")}` : ""}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Занято медиакэшем"
          aria-valuemin={stats ? 0 : undefined}
          aria-valuemax={stats?.limitBytes}
          aria-valuenow={stats ? filledBytes : undefined}
          aria-valuetext={usage ?? undefined}
          className="h-2 w-full overflow-hidden rounded-full bg-[var(--kub-inset)] outline outline-1 -outline-offset-1 outline-[color:var(--kub-border-color)]"
        >
          <div className="h-full rounded-full bg-[var(--kub-cyan)]" style={{ width: `${share}%` }} />
        </div>
      </div>

      <div>
        <div id={limitsId} className="mb-2 text-[color:var(--kub-muted)]">Лимит на устройстве</div>
        <div role="radiogroup" aria-labelledby={limitsId} className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--kub-inset)] p-1">
          {LIMITS.map((bytes, index) => {
            const selected = stats?.limitBytes === bytes;
            return (
              <KubButton
                key={bytes}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={index === (selectedIndex < 0 ? 0 : selectedIndex) ? 0 : -1}
                variant={selected ? "primary" : "ghost"}
                disabled={stats === null}
                aria-disabled={disabled}
                onClick={() => chooseLimit(bytes)}
                onKeyDown={event => navigateLimits(event, index)}
                className="h-auto min-h-11 min-w-0 whitespace-normal rounded-md px-1 py-2 text-sm tabular-nums aria-disabled:cursor-not-allowed aria-disabled:bg-[var(--kub-inset)] aria-disabled:text-[color:var(--kub-muted)]"
              >
                {formatStorageBytes(bytes)}
              </KubButton>
            );
          })}
        </div>
      </div>

      <p id={safetyId} className="text-sm leading-relaxed text-[color:var(--kub-muted)]">
        Только копии фото, видео и файлов на этом устройстве. Переписка и вход в аккаунт сохранятся.
      </p>
      <KubButton
        type="button"
        variant="secondary"
        disabled={disabled || empty}
        loading={pending && clearRequested}
        aria-describedby={safetyId}
        leftIcon={<KubIcon name="delete" size={16} className="shrink-0" />}
        onClick={() => {
          if (disabled || empty) return;
          setClearRequested(true);
          onClear();
        }}
        className="h-auto min-h-11 max-w-full whitespace-normal px-3 py-2 text-sm"
      >
        Очистить медиакэш
      </KubButton>
      <div role="status" aria-live="polite" aria-atomic="true" className="min-h-5 text-sm text-[color:var(--kub-muted)]">
        {status}
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm leading-relaxed">
          <KubIcon name="info" size={16} className="mt-1 shrink-0 text-[color:var(--kub-danger)]" />
          {stats ? "Не удалось обновить медиакэш. Повторите действие." : "Не удалось прочитать медиакэш. Откройте настройки ещё раз."}
        </p>
      )}
    </section>
  );
}
