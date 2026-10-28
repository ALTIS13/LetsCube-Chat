import { useEffect, useRef, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { useAndroidUpdate } from "@/hooks/useAndroidUpdate";
import { useVoiceCall, voiceCallSnapshot } from "@/hooks/useVoiceCall";
import { voiceRingsSnapshot } from "@/hooks/useVoiceRing";
import { reloadWouldLose } from "@/lib/reloadGuard";
import type { AndroidUpdatePhase } from "@/lib/platform/androidUpdates";

const COPY: Record<AndroidUpdatePhase, string> = {
  idle: "Обновления Android", checking: "Проверяем обновление", available: "Доступно обновление Android",
  current: "Установлена актуальная версия", downloading: "Скачиваем обновление", paused: "Загрузка приостановлена",
  verifying: "Проверяем загруженный APK", ready: "Обновление скачано и готово к установке",
  installing: "Подтвердите установку в Android", failed: "Не удалось подготовить обновление",
  unavailable: "Обновление внутри приложения недоступно в этой версии Android-приложения",
};

function UpdateProgress({ percent, compact = false }: { percent: number; compact?: boolean }) {
  return <div className={`${compact ? "mt-1 h-1" : "h-2"} w-full overflow-hidden rounded-full bg-[color:var(--kub-border-color)]`}
    role="progressbar" aria-label="Загрузка обновления" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full w-full origin-left bg-[var(--kub-cyan)] transition-transform duration-150 motion-reduce:transition-none"
      style={{ transform: `scaleX(${percent / 100})` }} />
  </div>;
}

export function AndroidUpdateStatus({ compact = false, onBeforeInstall }: {
  compact?: boolean;
  onBeforeInstall?: () => boolean | void | Promise<boolean | void>;
}) {
  const update = useAndroidUpdate();
  const call = useVoiceCall();
  const [confirmation, setConfirmation] = useState<typeof call | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [installFailure, setInstallFailure] = useState<"blocked" | "call" | "prepare" | null>(null);
  const intent = useRef(0);
  const inFlight = useRef(false);
  const { snapshot: state, commandPending } = update;
  useEffect(() => { setConfirmation(null); }, [call, state.phase]);
  const confirmed = confirmation !== null && confirmation === call;
  const abandonInstall = () => {
    ++intent.current; inFlight.current = false;
    setConfirmation(null); setPreparing(false); setInstallFailure(null);
  };
  const install = async () => {
    if (inFlight.current || commandPending || update.getSnapshot().snapshot.phase !== "ready") return;
    const live = voiceCallSnapshot();
    const active = ["connected", "joining", "reconnecting"].includes(live.phase);
    if (active && confirmation !== live) { setConfirmation(live); setInstallFailure(null); return; }
    const authorized = active ? live : null;
    const mine = ++intent.current;
    inFlight.current = true; setPreparing(true); setInstallFailure(null);
    try {
      if (onBeforeInstall) {
        if (await onBeforeInstall() === false) return;
        // The normal Settings close releases its modal hold at the React commit.
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }
      if (mine !== intent.current || update.getSnapshot().snapshot.phase !== "ready") return;
      if (reloadWouldLose().length || voiceRingsSnapshot().length) {
        setInstallFailure("blocked"); return;
      }
      const latest = voiceCallSnapshot();
      if (["connected", "joining", "reconnecting"].includes(latest.phase) && latest !== authorized) {
        setConfirmation(null); setInstallFailure("call"); return;
      }
      setConfirmation(null);
      await update.install();
    } catch { if (mine === intent.current) setInstallFailure("prepare"); }
    finally { if (mine === intent.current) { inFlight.current = false; setPreparing(false); } }
  };
  if (compact && ["idle", "current", "unavailable"].includes(state.phase)) return null;
  const busy = ["checking", "downloading", "verifying", "installing"].includes(state.phase);
  const percent = state.total > 0 ? Math.min(100, Math.floor(state.bytes / state.total * 100)) : 0;
  const installError = installFailure === "blocked" ? (compact ? "Есть незавершённые действия" : "Завершите текущие действия и повторите установку")
    : installFailure === "call" ? "Звонок изменился. Подтвердите снова" : installFailure === "prepare" ? "Повторите установку" : null;
  const error = installError ?? (state.error === "INSTALL_CANCELLED" ? (compact ? "Файл сохранён" : "Установка отменена. Загруженный файл сохранён.")
    : state.error === "STALE_RELEASE" ? (state.phase === "available" ? (compact ? "Скачайте новую версию" : "Доступна более новая версия. Скачайте её для установки.") : "Вышла другая версия. Отмените загрузку и проверьте обновления снова.")
    : state.error ? (compact ? "Не удалось. Повторите" : "Проверка или загрузка не завершена. Повторите действие; приложение и ваши данные сохранены.") : null);
  const title = confirmed ? "Звонок прервётся" : compact && state.phase === "ready" ? "Готово к установке"
    : compact && state.phase === "failed" ? "Не удалось обновить" : COPY[state.phase];
  return (
    <div className={`${compact ? "kub-glass-strong fixed left-1/2 top-[calc(var(--kub-safe-top)+6.75rem)] z-[80] w-[calc(100vw-1.5rem)] max-w-sm -translate-x-1/2" : "mt-3 kub-raise"} min-w-0 rounded-lg px-3 py-2`}
      data-testid="android-update-state" data-phase={state.phase}>
      <div className={compact ? "flex min-w-0 items-center gap-2" : ""}>
      <div className="min-w-0 flex-1">
      <div className="text-xs font-semibold text-[color:var(--kub-text)]" role="status" aria-live="polite">{title}</div>
      {state.version && <div className="mt-1 text-xs text-[color:var(--kub-muted)]">Версия {state.version}{compact && state.phase === "downloading" ? ` · ${percent}%` : ""}</div>}
      {state.phase === "downloading" && !compact && (
        <div className="mt-2">
          <UpdateProgress percent={percent} />
          <div className="mt-1 text-xs tabular-nums text-[color:var(--kub-muted)]">{percent}% · {(state.bytes / 1048576).toFixed(1)} / {(state.total / 1048576).toFixed(1)} МБ</div>
        </div>
      )}
      {state.phase === "ready" && !state.canInstall && !compact && <p className="mt-2 text-xs text-[color:var(--kub-muted)]">
        Разрешите LETSCUBE установку приложений в настройках Android, затем нажмите «Установить».
      </p>}
      {state.phase === "paused" && !compact && <p className="mt-2 text-xs text-[color:var(--kub-muted)]">Скачанная часть сохранена. Можно продолжить загрузку.</p>}
      {confirmed && <p className="mt-1 text-xs text-[color:var(--kub-muted)]">{compact ? "Звонок будет прерван" : "Установка отключит вас от разговора"}</p>}
      {error && <p className="mt-2 text-xs text-[color:var(--kub-warn)]" role="alert">{error}</p>}
      </div>
      <div className={compact ? "flex shrink-0 items-center gap-1" : "mt-2 flex flex-wrap justify-end gap-2"}>
        {["available", "paused", "failed"].includes(state.phase) && <KubButton size="sm" loading={commandPending}
          className="min-h-11" leftIcon={<KubIcon name="cloud" size={14} />} data-testid="android-update-download" onClick={() => void update.download()}>
          {state.phase === "paused" ? "Продолжить" : state.phase === "failed" ? "Повторить" : "Скачать"}
        </KubButton>}
        {state.phase === "ready" && (state.canInstall
          ? <KubButton size="sm" className="min-h-11" variant={confirmed ? "danger" : "primary"} loading={commandPending || preparing}
              data-testid="android-update-install" onClick={() => void install()}>{confirmed ? "Всё равно" : "Установить"}</KubButton>
          : <KubButton size="sm" className="min-h-11" loading={commandPending} data-testid="android-update-permission"
              onClick={() => void update.permission()}>{compact ? "Разрешить" : "Разрешить установку"}</KubButton>)}
        {["idle", "current"].includes(state.phase) && <KubButton size="sm" variant="ghost" loading={commandPending}
          leftIcon={<KubIcon name="rotate" size={14} />} onClick={() => void update.check()}>Проверить</KubButton>}
        {state.phase !== "installing" && (busy || ["ready", "paused", "failed", "available"].includes(state.phase)) &&
          <KubButton size={compact || confirmed || preparing ? "icon" : "sm"} className="min-h-11 min-w-11" variant="ghost"
            aria-label={confirmed || preparing ? "Отменить установку" : compact ? "Отменить обновление" : undefined}
            title={confirmed || preparing ? "Отменить установку" : "Отменить обновление"}
            data-testid="android-update-cancel" onClick={() => {
              const onlyIntent = confirmed || preparing; abandonInstall(); if (!onlyIntent) void update.cancel();
            }}>{compact || confirmed || preparing ? <KubIcon name="close" size={16} /> : "Отмена"}</KubButton>}
      </div>
      </div>
      {compact && state.phase === "downloading" && <UpdateProgress percent={percent} compact />}
    </div>
  );
}
