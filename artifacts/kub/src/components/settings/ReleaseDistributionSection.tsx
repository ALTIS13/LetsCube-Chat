import { useEffect, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { InfoHint } from "@/components/settings/InfoHint";
import { usePwaInstall } from "@/hooks/usePwa";
import { useReleaseCatalog, type ReleaseCatalogUiState } from "@/hooks/useReleaseCatalog";
import { useDesktopUpdate } from "@/hooks/useDesktopUpdate";
import { getBuildMetadata } from "@/lib/monitoring";
import { getCurrentDistributionTarget } from "@/lib/platform/capabilities";
import { getVisibleReleaseVersion } from "@/lib/releaseVersionLabel";

const STATE_COPY: Record<ReleaseCatalogUiState, string> = {
  checking: "Проверяем доступность приложения",
  preparing: "Версия для загрузки готовится",
  available: "Версия доступна для загрузки",
  current: "Установлена актуальная версия",
  update_available: "Доступно обновление",
  offline_cached: "Показаны последние сохранённые данные",
  unavailable: "Не удалось проверить доступность",
};

export function ReleaseDistributionSection() {
  const target = getCurrentDistributionTarget();
  const {
    installCopy,
    instructionsOpen,
    showInstallButton,
    promptInstall,
  } = usePwaInstall();
  const release = useReleaseCatalog(target);
  const desktopUpdate = useDesktopUpdate();
  const buildMetadata = getBuildMetadata();
  const [handoff, setHandoff] = useState(false);
  const [confirmTestChannel, setConfirmTestChannel] = useState(false);

  useEffect(() => {
    if (!handoff) return;
    const timeout = window.setTimeout(() => setHandoff(false), 2_500);
    return () => window.clearTimeout(timeout);
  }, [handoff]);

  const manifest = release.snapshot?.manifest ?? null;
  const artifact = manifest?.available ? manifest.artifact : null;
  const nativePackage = release.platform !== null;
  const windowsNative = target === "windows_native";
  const installedVersionLabel = getVisibleReleaseVersion(
    desktopUpdate?.snapshot?.installedVersion ?? buildMetadata.version,
  );
  const buildVersionLabel = getVisibleReleaseVersion(buildMetadata.version);
  const shortCommit = buildMetadata.commit !== "unknown" ? buildMetadata.commit.slice(0, 7) : null;

  const selectDesktopChannel = (channel: "stable" | "test") => {
    if (channel === "stable") setConfirmTestChannel(false);
    if (desktopUpdate?.snapshot?.channel === channel) return;
    if (channel === "test") {
      setConfirmTestChannel(true);
      return;
    }
    setConfirmTestChannel(false);
    void desktopUpdate?.setChannel(channel);
  };

  const handleDesktopChannelKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    channel: "stable" | "test",
  ) => {
    const channels = ["stable", "test"] as const;
    let nextChannel: (typeof channels)[number] | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextChannel = channels[(channels.indexOf(channel) + 1) % channels.length];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextChannel = channels[(channels.indexOf(channel) - 1 + channels.length) % channels.length];
    } else if (event.key === "Home") {
      nextChannel = channels[0];
    } else if (event.key === "End") {
      nextChannel = channels[channels.length - 1];
    }

    if (!nextChannel) return;
    event.preventDefault();
    const nextButton = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
      `[data-update-channel="${nextChannel}"]`,
    );
    nextButton?.focus();
    selectDesktopChannel(nextChannel);
  };

  return (
    <div
      // D-222: the card is the container, because the thing that decides this
      // layout is how wide the card is — and inside the chat-list column that is
      // whatever the owner last dragged, not what the window is.
      className="release-distribution-card @container kub-glass rounded-xl overflow-hidden border border-[color:var(--kub-border-color)]"
      data-testid="release-distribution-card"
    >
      {/* 27rem, measured. The three-column form costs the content column the
          button and its gap — 109px of the card, whatever the card is — so it is
          worth paying only while what is left still holds the widest info chip
          on one line. «Версия установки: Windows EXE» needs 248px and the
          content column is `card - 171`, so the form becomes honest at a 420px
          card; 432px is the first whole rem past it. At the 360pt column the
          card is 296px and `sm:` was true anyway, which left the content column
          at 125px and both chips wrapped inside a `rounded-full` — the ellipses
          the owner photographed. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3 @min-[27rem]:grid-cols-[auto_minmax(0,1fr)_auto]">
        <KubIcon
          name={target === "windows_download" ? "cloud" : "phone"}
          size={16}
          className="mt-0.5 text-[color:var(--kub-cyan)]"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-[color:var(--kub-text)]" data-testid="pwa-install-title">
            {installCopy.title}
          </div>
          <div className="text-xs text-[color:var(--kub-muted)]" data-testid="pwa-install-description">
            {installCopy.description}
          </div>
          {/* A pill is only a pill while it is one line high, so above 20rem it
              is one and below it is not. 310px measured: the widest chip,
              «Версия установки: Windows EXE», needs 248px, and in the two-column
              form the chips get `card - 62`. 20rem is the first whole rem past
              it, and the three-column form above 27rem gives `card - 171`, which
              is 261px at its own threshold — so one number covers both forms.

              **The obvious cheaper fix does not work here, and the measurement
              is worth keeping.** A radius is clamped — when two radii on one
              side exceed that side, all of them scale down — so `rounded-3xl`
              looked like a shape that would be a stadium on one line and a
              rectangle on two, with no threshold at all. In the paint it is
              byte-identical on one line (42px, because the `InfoHint` inside
              carries the 32px touch target) and byte-identical on **two** as
              well: two lines are 46px, and 24px still clamps to 23. The clamp
              cannot tell 42 from 46, and 42-versus-46 is the whole of this
              defect at the width the owner photographed. Only a radius below
              21px separates them, and 21px is what one line already paints —
              so there is no single radius that is a stadium at 42 and a
              rectangle at 46. The shape has to be told which case it is in.

              `rounded-lg` below is the product's own `--radius`, 10px, not a
              number invented here. */}
          <div className="mt-2 flex flex-wrap gap-1.5 text-[12px] text-[color:var(--kub-muted)]">
            <span
              className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-2 py-1 @min-[20rem]:rounded-full"
              data-testid="pwa-install-variant"
            >
              Версия установки: {installCopy.variantLabel}
              <InfoHint
                term="Версия установки"
                text="Каким способом LETSCUBE установлен на это устройство. От этого зависит, откуда приходят обновления и как их ставить."
              />
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-2 py-1 @min-[20rem]:rounded-full"
              data-testid="pwa-install-mode"
            >
              Режим: {installCopy.modeLabel}
              <InfoHint
                term="Режим"
                text="Как LETSCUBE открыт прямо сейчас: отдельным окном или вкладкой в браузере. На то, что доступно внутри, это не влияет."
              />
            </span>
          </div>
          {windowsNative && desktopUpdate && (
            <div
              className="release-status-enter mt-3 rounded-lg px-3 py-2 kub-raise"
              data-testid="desktop-update-settings"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-xs text-[color:var(--kub-text)]">
                  {desktopUpdate.presentation?.title ?? "Подготавливаем проверку обновлений"}
                  {installedVersionLabel && (
                    <span className="mt-0.5 block text-[12px] text-[color:var(--kub-muted)]">
                      {installedVersionLabel}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <InfoHint
                    term="Канал обновлений"
                    side="left"
                    text="Stable — проверенные сборки, их ставит большинство. Test — то же приложение, но раньше: новое приходит первым, и что-то может работать не так. Переключиться обратно можно в любой момент."
                  />
                  <div
                    className="desktop-update-channel-control"
                    role="radiogroup"
                    aria-label="Канал обновлений"
                    data-testid="desktop-update-channel-control"
                  >
                  {(["stable", "test"] as const).map((channel) => (
                    <button
                      key={channel}
                      type="button"
                      role="radio"
                      aria-checked={desktopUpdate.snapshot?.channel === channel}
                      tabIndex={desktopUpdate.snapshot?.channel === channel ? 0 : -1}
                      data-update-channel={channel}
                      className="desktop-update-channel-control__option"
                      data-active={desktopUpdate.snapshot?.channel === channel ? "true" : "false"}
                      disabled={desktopUpdate.commandPending}
                      onFocus={() => {
                        if (channel === "stable") setConfirmTestChannel(false);
                      }}
                      onClick={() => selectDesktopChannel(channel)}
                      onKeyDown={(event) => handleDesktopChannelKeyDown(event, channel)}
                    >
                      {channel === "stable" ? "Stable" : "Test"}
                    </button>
                  ))}
                  </div>
                </div>
              </div>
              {desktopUpdate.presentation?.description && (
                <p className="mt-2 text-[12px] leading-relaxed text-[color:var(--kub-muted)]">
                  {desktopUpdate.presentation.description}
                </p>
              )}
              {confirmTestChannel && (
                <div
                  className="mt-2 rounded-lg border border-[color:var(--kub-warn)]/40 bg-[color-mix(in_srgb,var(--kub-warn)_9%,var(--kub-surface))] p-2"
                  data-testid="desktop-test-channel-confirmation"
                >
                  <p className="text-[12px] leading-relaxed text-[color:var(--kub-text)]">
                    Тестовые сборки могут быть нестабильными. Перейти на канал Test?
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    <KubButton size="sm" variant="ghost" onClick={() => setConfirmTestChannel(false)}>
                      Отмена
                    </KubButton>
                    <KubButton
                      size="sm"
                      variant="secondary"
                      loading={desktopUpdate.commandPending}
                      onClick={() => {
                        setConfirmTestChannel(false);
                        void desktopUpdate.setChannel("test");
                      }}
                    >
                      Перейти
                    </KubButton>
                  </div>
                </div>
              )}
              <div className="mt-2 flex justify-end">
                {desktopUpdate.presentation?.action === "install" ? (
                  <KubButton
                    size="sm"
                    loading={desktopUpdate.commandPending}
                    leftIcon={<KubIcon name="cloud" size={13} />}
                    onClick={() => void desktopUpdate.install()}
                    data-testid="desktop-update-install-button"
                  >
                    Установить
                  </KubButton>
                ) : (
                  <KubButton
                    size="sm"
                    variant="ghost"
                    loading={desktopUpdate.commandPending}
                    leftIcon={<KubIcon name="rotate" size={13} />}
                    onClick={() => void desktopUpdate.check()}
                    data-testid="desktop-update-check-button"
                  >
                    Проверить
                  </KubButton>
                )}
              </div>
            </div>
          )}
          {nativePackage && !windowsNative && (
            <div
              className="release-status-enter mt-3 rounded-lg px-3 py-2 kub-raise"
              data-testid="release-catalog-state"
              data-state={release.state}
            >
              <div className="flex min-w-0 items-center gap-2 text-xs text-[color:var(--kub-text)]">
                <span className={release.state === "checking" ? "release-status-pulse" : ""} aria-hidden="true" />
                <span className="min-w-0">{STATE_COPY[release.state]}</span>
              </div>
              {manifest?.available && (
                <div className="mt-1 text-[12px] text-[color:var(--kub-muted)]">
                  Версия {manifest.version} · {formatFileSize(manifest.artifact?.size ?? 0)} · {formatReleaseDate(manifest.publishedAt)}
                </div>
              )}
              {handoff && (
                <div className="mt-2 text-[12px] text-[color:var(--kub-accent-text)]" role="status">
                  Загрузка передана системе
                </div>
              )}
            </div>
          )}
        </div>
        {showInstallButton && (
          <KubButton
            size="sm"
            onClick={() => void promptInstall()}
            className="col-span-2 w-full @min-[27rem]:col-span-1 @min-[27rem]:w-auto"
            data-testid="pwa-install-button"
          >
            {installCopy.buttonLabel}
          </KubButton>
        )}
        {artifact && release.state !== "current" && !windowsNative && (
          <a
            href={artifact.url}
            download
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setHandoff(true)}
            className="col-span-2 inline-flex h-8 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--kub-cyan)] px-3 text-xs font-semibold text-[color:var(--kub-bg)] transition-[transform,filter] hover:brightness-110 active:scale-[0.98] @min-[27rem]:col-span-1 @min-[27rem]:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
            data-testid="release-download-button"
          >
            <KubIcon name="externalLink" size={13} />
            Скачать
          </a>
        )}
        {release.state === "unavailable" && !windowsNative && (
          <KubButton
            size="sm"
            variant="secondary"
            onClick={() => void release.refresh()}
            className="col-span-2 w-full @min-[27rem]:col-span-1 @min-[27rem]:w-auto"
          >
            Повторить
          </KubButton>
        )}
      </div>
      {instructionsOpen && target === "ios_pwa" && (
        <div
          className="mx-4 mb-3 rounded-xl border border-[color:var(--kub-cyan)]/25 bg-[color-mix(in_srgb,var(--kub-cyan)_8%,var(--kub-surface))] px-3 py-3"
          data-testid="pwa-install-guidance"
        >
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[color:var(--kub-text)]">
            <KubIcon name="externalLink" size={13} className="text-[color:var(--kub-cyan)]" />
            {installCopy.instructionTitle}
          </div>
          <ol className="space-y-1 pl-4 text-xs leading-relaxed text-[color:var(--kub-muted)]">
            {installCopy.instructionSteps.map((step) => (
              <li key={step} className="list-decimal">{step}</li>
            ))}
          </ol>
        </div>
      )}
      {(buildVersionLabel || shortCommit) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[color:var(--kub-rule)] px-4 py-2 text-xs text-[color:var(--kub-muted)]">
          {buildVersionLabel}
          {buildVersionLabel && shortCommit ? " · " : ""}
          {shortCommit ? `Ревизия ${shortCommit}` : ""}
          {shortCommit && (
            <InfoHint
              term="Ревизия"
              text="Номер конкретной сборки приложения. Сам по себе ни на что не влияет — его стоит назвать, если вы описываете проблему в поддержку."
            />
          )}
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "размер уточняется";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} МБ`;
}

function formatReleaseDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "дата не указана";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
