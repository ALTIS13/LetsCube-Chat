import { KubButton, KubIcon } from "@/components/kub";
import { usePublicReleaseCatalog } from "@/hooks/usePublicReleaseCatalog";

/** The existing Stable catalog has a latest release, not an archive. */
export function SettingsChangelog() {
  const { changelog: entry, platforms, refresh } = usePublicReleaseCatalog();
  const published = platforms.filter((platform) => platform.catalogPublished);
  const checking = published.some((platform) => platform.state === "loading");
  const failed = published.filter((platform) => platform.state === "error");
  const stale = entry && platforms.find((platform) => platform.platform === entry.platform)?.stale;

  return (
    <div data-testid="settings-changelog" aria-busy={checking} className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="text-xs leading-5 text-[color:var(--kub-muted)]">
          Последний доступный выпуск
        </p>
        <KubButton
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Обновить сведения о выпуске"
          title="Обновить сведения о выпуске"
          disabled={checking}
          onClick={refresh}
          data-testid="settings-changelog-refresh"
          className="shrink-0"
        >
          <KubIcon name={checking ? "spinner" : "rotate"} size={16} />
        </KubButton>
      </div>

      {entry ? (
        <article data-testid="settings-changelog-entry" data-platform={entry.platform} className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h4 className="break-words text-sm font-semibold text-[color:var(--kub-text)]">
              {entry.title} {entry.version}
            </h4>
            <time dateTime={entry.publishedAt} className="text-xs leading-5 text-[color:var(--kub-muted)]">
              {new Date(entry.publishedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
            </time>
          </div>
          {stale && <p role="status" className="mt-1 text-xs text-[color:var(--kub-muted)]">Сохранённые сведения · сейчас без связи с каталогом</p>}
          {entry.highlights.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {entry.highlights.map((highlight, index) => (
                <li key={index} className="flex min-w-0 gap-2 text-sm leading-6 text-[color:var(--kub-text)]">
                  <KubIcon name="check" size={14} tone="accent" className="mt-1 shrink-0" />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{highlight}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[color:var(--kub-text)]">
              {entry.notes || "Описание изменений для этого выпуска не опубликовано."}
            </p>
          )}
        </article>
      ) : (
        <p role="status" className="py-2 text-sm leading-6 text-[color:var(--kub-muted)]">
          {checking ? "Загружаем сведения о выпуске…" : failed.length ? "Не удалось загрузить сведения об обновлениях." : "Сведения о выпусках пока не опубликованы."}
        </p>
      )}

      {entry && failed.length > 0 && (
        <p role="status" className="text-xs leading-5 text-[color:var(--kub-muted)]">
          Не удалось проверить каталог: {failed.map((platform) => platform.title).join(", ")}.
        </p>
      )}
      <p className="border-t border-[color:var(--kub-rule)] pt-3 text-xs leading-5 text-[color:var(--kub-muted)]">
        В каталоге — последние версии. Архив предыдущих выпусков пока недоступен.
      </p>
    </div>
  );
}
