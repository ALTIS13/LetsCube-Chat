import { useEffect, useRef, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { usePwaUpdate } from "@/hooks/usePwaUpdate";
import { useVoiceCall, voiceCallSnapshot } from "@/hooks/useVoiceCall";
import { cn } from "@/lib/utils";

/** A persistent Settings entry; the root banner uses the same action/state. */
export function PwaUpdateStatusControl({ surface = "settings", className, onBeforeApply }: {
  surface?: "settings" | "banner";
  className?: string;
  /** Close Settings through its existing unsaved-changes guard, never raw onClose. */
  onBeforeApply?: () => boolean | void | Promise<boolean | void>;
}) {
  const update = usePwaUpdate();
  const call = useVoiceCall();
  const [confirmation, setConfirmation] = useState<typeof call | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const intent = useRef(0);
  const callActive = ["connected", "joining", "reconnecting"].includes(call.phase);
  useEffect(() => { setConfirmation(null); }, [call, update?.phase]);
  if (!update) return null;
  const busy = preparing || update.phase === "checking" || update.phase === "updating";
  const needsConfirmation = callActive && confirmation === call;
  const applying = update.phase === "updating";
  const failed = update.phase === "failed";
  const title = needsConfirmation ? "Звонок прервётся" : applying ? "Обновляем приложение" :
    update.phase === "updated" ? "Приложение обновлено" : failed ? "Обновление не завершено" :
    update.phase === "checking" ? "Проверяем обновления" : update.available ? "Готова новая версия" :
    update.phase === "current" ? "Установлена актуальная версия" : "Обновления приложения";
  const detail = prepareFailed ? "Не удалось подготовить перезапуск. Попробуйте снова" : needsConfirmation ? "Обновление отключит вас от разговора" : applying ? "Приложение перезапустится" :
    update.failure === "blocked" ? "Завершите текущие действия и повторите обновление" :
    update.failure === "call" ? "Подтвердите перезапуск во время звонка" :
    update.failure === "unchanged" ? "Новая версия ещё не загрузилась. Попробуйте снова" :
    failed ? "Не удалось обновить. Проверьте соединение и повторите" :
    update.phase === "updated" ? "Перезапуск успешно завершён" : update.available ? "Готова к перезапуску" : "Веб-версия LETSCUBE";
  const label = needsConfirmation ? "Всё равно" : applying ? "Обновляем" : update.phase === "checking" ? "Проверяем" :
    failed ? "Повторить" : update.available ? "Обновить" : "Проверить";
  const press = async () => {
    if (busy) return;
    setPrepareFailed(false);
    if (!update.available || update.failure === "check") { void update.check(); return; }
    const liveCall = voiceCallSnapshot();
    const active = ["connected", "joining", "reconnecting"].includes(liveCall.phase);
    if (active && confirmation !== liveCall) { setConfirmation(liveCall); return; }
    const confirmedCall = active ? liveCall : null;
    const mine = ++intent.current;
    if (onBeforeApply) {
      setPreparing(true);
      try {
        if (await onBeforeApply() === false) return;
        // Closing a modal releases its reload hold at the React commit.
        await new Promise(resolve => window.setTimeout(resolve, 0));
        if (mine === intent.current) update.apply({ confirmedCall });
      } catch { if (mine === intent.current) setPrepareFailed(true); }
      finally { if (mine === intent.current) setPreparing(false); }
    } else update.apply({ confirmedCall });
  };
  return (
    <div role="status" aria-live="polite" data-testid={surface === "banner" ? "app-update-notice" : "pwa-update-status"}
      data-phase={update.phase} data-action={callActive && !needsConfirmation ? "confirm" : "restart"}
      className={cn("flex min-w-0 items-center gap-3", surface === "banner"
        ? "kub-glass-strong kub-menu-in fixed left-1/2 top-[calc(var(--kub-safe-top)+6.75rem)] z-[80] w-[calc(100vw-1.5rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-[color:var(--kub-border-color)] py-2 pl-3 pr-2"
        : "py-3", className)}>
      <span className="shrink-0 text-[color:var(--kub-cyan)]" aria-hidden="true">
        <KubIcon name={busy ? "spinner" : update.phase === "updated" ? "check" : "rotate"} size={18}/>
      </span>
      <span className="min-w-0 flex-1 break-words">
        <span className="block text-sm font-semibold text-[color:var(--kub-text)]">{title}</span>
        <span className="block text-xs leading-snug text-[color:var(--kub-muted)]">{detail}</span>
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {needsConfirmation && <KubButton size="icon" variant="ghost" className="min-h-11 min-w-11" aria-label="Отменить перезапуск" title="Отменить перезапуск" onClick={() => {
          ++intent.current; setConfirmation(null); setPreparing(false);
        }}>
          <KubIcon name="close" size={16}/>
        </KubButton>}
        <KubButton size="sm" variant={needsConfirmation ? "danger" : update.available ? "primary" : "secondary"}
          className="min-h-11" disabled={busy} onClick={press} data-testid={surface === "banner" ? "app-update-restart" : "pwa-update-action"}
          leftIcon={<KubIcon name={busy ? "spinner" : "rotate"} size={14}/>}>{label}</KubButton>
      </div>
    </div>
  );
}
