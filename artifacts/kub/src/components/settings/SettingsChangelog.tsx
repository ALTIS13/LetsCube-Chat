import { KubButton, KubIcon } from "@/components/kub";
import { usePublicReleaseCatalog } from "@/hooks/usePublicReleaseCatalog";
import { ReleaseHistoryList } from "@/components/public/ReleaseChangelog";

/** Receipt-backed history remains readable independently of catalog reachability. */
export function SettingsChangelog() {
  const { history, platforms, refresh } = usePublicReleaseCatalog();
  const published = platforms.filter((platform) => platform.catalogPublished);
  const checking = published.some((platform) => platform.state === "loading");
  const failed = published.filter((platform) => platform.state === "error");

  return (
    <div data-testid="settings-changelog" aria-busy={checking} className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="text-xs leading-5 text-[color:var(--kub-muted)]">
          История выпусков
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

      {checking && <p role="status" className="text-xs text-[color:var(--kub-muted)]">Загружаем сведения о выпуске…</p>}
      {history.length > 0 ? <ReleaseHistoryList history={history} entryTestId="settings-changelog-entry" /> : (
        <p role="status" className="py-2 text-sm leading-6 text-[color:var(--kub-muted)]">
          {checking ? "Загружаем сведения о выпуске…" : failed.length ? "Не удалось загрузить сведения об обновлениях." : "Сведения о выпусках пока не опубликованы."}
        </p>
      )}

      {history.length > 0 && failed.length > 0 && (
        <p role="status" className="text-xs leading-5 text-[color:var(--kub-muted)]">
          Не удалось загрузить сведения об обновлениях. Каталог: {failed.map((platform) => platform.title).join(", ")}. История опубликованных выпусков сохранена.
        </p>
      )}
    </div>
  );
}
