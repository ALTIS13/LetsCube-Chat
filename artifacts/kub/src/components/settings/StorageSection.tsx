import { useEffect, useState } from "react";
import { KubButton, KubIcon, KubInput, KubNotice } from "@/components/kub";
import { InfoHint } from "@/components/settings/InfoHint";
import { useDesktopStorage } from "@/hooks/useDesktopStorage";
import { isDesktopApp } from "@/lib/platform/desktop";
import { isDesktopStorageAvailable } from "@/lib/platform/desktopStorage";
import {
  describeDesktopStorageError,
  formatStorageBytes,
  isAbsoluteWindowsPath,
} from "@/lib/platform/desktopStorage";
import { cn } from "@/lib/utils";

/**
 * Where the desktop shell keeps its data, and the two things about it a person
 * can change: the folder, and how much cache it may hold.
 *
 * Renders nothing outside the desktop shell — the browser and Android builds
 * have no profile folder to talk about.
 */
export function StorageSection() {
  const storage = useDesktopStorage();
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [cacheCleared, setCacheCleared] = useState(false);

  useEffect(() => {
    if (!cacheCleared) return;
    const timeout = window.setTimeout(() => setCacheCleared(false), 2_500);
    return () => window.clearTimeout(timeout);
  }, [cacheCleared]);

  // An older shell has the bridge but not these methods. Rendering the section
  // then means every Windows user sees "не удалось" between the web deploy and
  // the day they install a new build — so it renders nothing at all, exactly as
  // it does in a browser.
  if (!isDesktopApp() || !storage || !isDesktopStorageAvailable()) return null;

  const { state, errorMessage, commandPending, cacheLimitOptions } = storage;

  const openEditor = () => {
    setLocationDraft("");
    setDraftError(null);
    storage.dismissError();
    setEditingLocation(true);
  };

  const closeEditor = () => {
    setEditingLocation(false);
    setLocationDraft("");
    setDraftError(null);
  };

  const submitLocation = async () => {
    const trimmed = locationDraft.trim();
    // Caught here rather than after a round trip: the shell would reject the
    // same input with `not_absolute`, so the message is identical either way.
    if (!isAbsoluteWindowsPath(trimmed)) {
      setDraftError(describeDesktopStorageError("not_absolute"));
      return;
    }
    setDraftError(null);
    if (await storage.setLocation(trimmed)) closeEditor();
  };

  const restoreDefaultLocation = () => {
    closeEditor();
    void storage.setLocation(null);
  };

  const selectCacheLimit = (bytes: number) => {
    if (state?.cacheLimitBytes === bytes) return;
    void storage.setCacheLimit(bytes);
  };

  const handleCacheLimitKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    bytes: number,
  ) => {
    const index = cacheLimitOptions.indexOf(bytes);
    if (index < 0) return;
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % cacheLimitOptions.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + cacheLimitOptions.length) % cacheLimitOptions.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = cacheLimitOptions.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const next = cacheLimitOptions[nextIndex];
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-cache-limit="${next}"]`)
      ?.focus();
    selectCacheLimit(next);
  };

  const cacheShare = state && state.cacheLimitBytes > 0
    ? Math.min(100, Math.round((state.cacheBytes / state.cacheLimitBytes) * 100))
    : 0;

  return (
    <div
      className="kub-glass overflow-hidden rounded-xl border border-[color:var(--kub-border-color)]"
      data-testid="desktop-storage-card"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3">
        <KubIcon name="folder" size={16} className="mt-0.5 text-[color:var(--kub-cyan)]" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-[color:var(--kub-text)]">
            Хранилище приложения
            <InfoHint
              term="Хранилище приложения"
              text="Папка на диске, где LETSCUBE держит переписку, скачанные файлы и вход в аккаунт. Её можно перенести — например, туда, где больше свободного места. Новая папка начнёт использоваться после перезапуска."
            />
          </div>
          {state ? (
            <>
              <div
                className="mt-0.5 break-all text-xs text-[color:var(--kub-muted)]"
                data-testid="desktop-storage-location"
              >
                {state.location}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[color:var(--kub-muted)]">
                <span
                  className="rounded-full border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-2 py-1"
                  data-testid="desktop-storage-total"
                >
                  Занято: {formatStorageBytes(state.totalBytes)}
                </span>
                {state.isDefaultLocation && (
                  <span className="rounded-full border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-2 py-1">
                    Папка по умолчанию
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-xs text-[color:var(--kub-muted)]">
              {errorMessage ? "Данные о хранилище недоступны" : "Читаем хранилище"}
            </div>
          )}
        </div>
        {state && !editingLocation && (
          <div className="col-start-2 flex flex-wrap gap-2 sm:col-start-3 sm:justify-end">
            {(!state.isDefaultLocation || state.pendingLocation) && (
              <KubButton
                size="sm"
                variant="ghost"
                loading={commandPending}
                onClick={restoreDefaultLocation}
                data-testid="desktop-storage-restore-default"
              >
                {state.isDefaultLocation && state.pendingLocation
                  ? "Отменить перенос"
                  : "Вернуть по умолчанию"}
              </KubButton>
            )}
            <KubButton
              size="sm"
              variant="secondary"
              leftIcon={<KubIcon name="folderOpen" size={13} />}
              onClick={openEditor}
              data-testid="desktop-storage-location-edit"
            >
              Изменить папку
            </KubButton>
          </div>
        )}
      </div>

      {state?.pendingLocation && (
        <KubNotice
          tone="warn"
          title="Папка изменится при следующем запуске"
          className="mx-4 mb-3 rounded-lg"
          data-testid="desktop-storage-pending"
        >
          <span className="block break-all">{state.pendingLocation}</span>
          <span className="mt-1 block">
            Перенос нельзя выполнить на ходу: пока приложение открыто, данные и вход в аккаунт
            заняты. Перезапустите LETSCUBE, чтобы он состоялся.
          </span>
        </KubNotice>
      )}

      {errorMessage && (
        <KubNotice
          tone="danger"
          className="mx-4 mb-3 rounded-lg"
          role="alert"
          data-testid="desktop-storage-error"
        >
          {errorMessage}
        </KubNotice>
      )}

      {state && editingLocation && (
        <div className="border-t border-[color:var(--kub-border-color)] px-4 py-3">
          <div data-testid="desktop-storage-location-editor">
            <KubInput
              label="Новая папка"
              value={locationDraft}
              onChange={(event) => {
                setLocationDraft(event.target.value);
                if (draftError) setDraftError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitLocation();
                if (event.key === "Escape") closeEditor();
              }}
              placeholder="D:\LETSCUBE"
              spellCheck={false}
              autoComplete="off"
              error={draftError}
              hint="Вставьте полный путь к папке — внутри неё LETSCUBE создаст свою. Выбрать папку мышью здесь нельзя."
              leftIcon={<KubIcon name="folderOpen" size={15} />}
              data-testid="desktop-storage-location-input"
            />
            <div className="mt-2 flex justify-end gap-2">
              <KubButton size="sm" variant="ghost" onClick={closeEditor}>
                Отмена
              </KubButton>
              <KubButton
                size="sm"
                loading={commandPending}
                disabled={locationDraft.trim().length === 0}
                onClick={() => void submitLocation()}
                data-testid="desktop-storage-location-save"
              >
                Сохранить
              </KubButton>
            </div>
          </div>
        </div>
      )}

      {state && (
        <div className="border-t border-[color:var(--kub-border-color)] px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5 text-sm text-[color:var(--kub-text)]">
              Лимит кэша
              <InfoHint
                term="Кэш"
                text="Кэш — это картинки, видео и файлы, скачанные заранее, чтобы открывались сразу. Всё это можно скачать заново, поэтому очистка не трогает переписку и не выкидывает из аккаунта."
              />
            </div>
            <div className="text-[11px] text-[color:var(--kub-muted)]" data-testid="desktop-storage-cache-usage">
              {formatStorageBytes(state.cacheBytes)} из {formatStorageBytes(state.cacheLimitBytes)}
            </div>
          </div>

          <div
            className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--kub-surface-3)]"
            role="presentation"
          >
            <div
              className="h-full rounded-full bg-[var(--kub-cyan)] transition-[width] duration-[var(--kub-motion-standard)] ease-[var(--kub-ease-standard)]"
              style={{ width: `${cacheShare}%` }}
            />
          </div>

          <div
            role="radiogroup"
            aria-label="Лимит кэша"
            className="mt-3 flex flex-wrap gap-1 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-bg)] p-0.5"
            data-testid="desktop-storage-cache-limit-control"
          >
            {cacheLimitOptions.map((bytes) => {
              const selected = state.cacheLimitBytes === bytes;
              return (
                <button
                  key={bytes}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  data-cache-limit={bytes}
                  disabled={commandPending}
                  onClick={() => selectCacheLimit(bytes)}
                  onKeyDown={(event) => handleCacheLimitKeyDown(event, bytes)}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    selected
                      ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                      : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
                  )}
                >
                  {formatStorageBytes(bytes)}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <div className="flex shrink-0 items-center gap-2">
              {cacheCleared && (
                <span className="text-[11px] text-[color:var(--kub-online-text)]" role="status">
                  Кэш очищен
                </span>
              )}
              <KubButton
                size="sm"
                variant="secondary"
                loading={commandPending}
                leftIcon={<KubIcon name="delete" size={13} />}
                onClick={() => {
                  void storage.clearCache().then((next) => {
                    if (next) setCacheCleared(true);
                  });
                }}
                data-testid="desktop-storage-clear-cache"
              >
                Очистить кэш
              </KubButton>
            </div>
          </div>
        </div>
      )}

      {!state && errorMessage && (
        <div className="border-t border-[color:var(--kub-border-color)] px-4 py-3 text-right">
          <KubButton
            size="sm"
            variant="secondary"
            loading={commandPending}
            leftIcon={<KubIcon name="rotate" size={13} />}
            onClick={() => void storage.refresh("retry")}
            data-testid="desktop-storage-retry"
          >
            Повторить
          </KubButton>
        </div>
      )}
    </div>
  );
}
