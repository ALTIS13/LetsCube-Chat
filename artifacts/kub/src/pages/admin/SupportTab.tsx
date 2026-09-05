"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { KubButton, KubGlassLayer, KubIcon, KubSwitch } from "@/components/kub";
import { usePermissionAccess } from "@/hooks/useRole";
import {
  SUPPORT_PERMISSIONS,
  SupportOperatorApiError,
  claimSupportTicket,
  closeSupportTicket,
  escalateSupportTicket,
  getSupportOperatorPreferences,
  getSupportSettings,
  listSupportOperators,
  listSupportTickets,
  loadSupportTicket,
  lookupSupportCustomer,
  markSupportTicketWaiting,
  reopenSupportTicket,
  replyToSupportTicket,
  resolveSupportTicket,
  returnSupportTicketToPool,
  subscribeToSupportChanges,
  transferSupportTicket,
  updateSupportSettings,
  updateSupportOperatorPreferences,
  type SupportCustomerCandidate,
  type SupportOperator,
  type SupportOperatorPreferences,
  type SupportQueueFilter,
  type SupportSettings,
  type SupportTicket,
  type SupportTicketDetails as SupportTicketDetailsModel,
} from "@/lib/support/operatorApi";
import { useAppStore } from "@/store/app.store";
import { SupportQueue } from "./support/SupportQueue";
import {
  SupportTicketDetails,
  type SupportWorkflowAction,
} from "./support/SupportTicketDetails";

const DEFAULT_SETTINGS: SupportSettings = {
  intakeEnabled: true,
  guestIntakeEnabled: true,
  closedMessage: "Приём обращений временно закрыт. Попробуйте позже.",
  ticketLimit15m: 3,
  ticketLimitDay: 10,
  messageLimit5m: 20,
  messageLimitDay: 200,
};

const DEFAULT_PREFERENCES: SupportOperatorPreferences = {
  notifyNewPool: true,
  notifyUrgentOnly: false,
  notifyAssignedMessages: true,
  notifyTransfers: true,
  notifyEscalations: true,
  pushEnabled: true,
};

export function SupportTab() {
  const [, setLocation] = useLocation();
  const currentUser = useAppStore((state) => state.currentUser);
  const access = usePermissionAccess(SUPPORT_PERMISSIONS);
  const [filter, setFilter] = useState<SupportQueueFilter>("pool");
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(() =>
    readTicketFromLocation(),
  );
  const [details, setDetails] = useState<SupportTicketDetailsModel | null>(null);
  const [operators, setOperators] = useState<SupportOperator[]>([]);
  const [customerCandidates, setCustomerCandidates] = useState<SupportCustomerCandidate[]>([]);
  const [settings, setSettings] = useState<SupportSettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<SupportSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] =
    useState<SupportOperatorPreferences>(DEFAULT_PREFERENCES);
  const [preferencesDraft, setPreferencesDraft] =
    useState<SupportOperatorPreferences>(DEFAULT_PREFERENCES);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [queueLoading, setQueueLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const userId = currentUser?.id ?? "";
  const canView = access.hasPermission("support.view");
  const canManage = access.hasPermission("support.manage");
  const canSettings = access.hasPermission("support.settings");
  const permissionKeys = access.permissionKeys;

  const loadQueue = useCallback(async (options: { background?: boolean } = {}) => {
    if (!userId || !canView) return;
    if (!options.background || !loadedRef.current) setQueueLoading(true);
    setQueueError(null);
    try {
      const rows = await listSupportTickets(filter, userId);
      setTickets(rows);
      loadedRef.current = true;
    } catch (error) {
      setQueueError(readActionError(error));
    } finally {
      setQueueLoading(false);
    }
  }, [canView, filter, userId]);

  const loadDetails = useCallback(async (
    ticketId: string,
    options: { background?: boolean } = {},
  ) => {
    if (!userId || !canView) return;
    if (!options.background) setDetailsLoading(true);
    try {
      let next = await loadSupportTicket(ticketId, { revealContact: canManage });
      if (!canManage && next.ticket.assignedOperatorId === userId) {
        next = await loadSupportTicket(ticketId, { revealContact: true });
      }
      setDetails(next);
      setActionError(null);
    } catch (error) {
      setActionError(readActionError(error));
      if (!options.background) setDetails(null);
    } finally {
      setDetailsLoading(false);
    }
  }, [canManage, canView, userId]);

  useEffect(() => {
    if (!canView || !userId) return;
    void loadQueue();
  }, [canView, loadQueue, userId]);

  useEffect(() => {
    if (!canView || !selectedTicketId) {
      setDetails(null);
      return;
    }
    void loadDetails(selectedTicketId);
  }, [canView, loadDetails, selectedTicketId]);

  useEffect(() => {
    if (!canView) return;
    void listSupportOperators()
      .then(setOperators)
      .catch(() => setOperators([]));
  }, [canView]);

  useEffect(() => {
    if (!canSettings) return;
    void getSupportSettings()
      .then((value) => {
        const next = value ?? DEFAULT_SETTINGS;
        setSettings(next);
        setSettingsDraft(next);
      })
      .catch(() => {
        setSettings(DEFAULT_SETTINGS);
        setSettingsDraft(DEFAULT_SETTINGS);
      });
  }, [canSettings]);

  useEffect(() => {
    if (!canView || !userId) return;
    void getSupportOperatorPreferences(userId)
      .then((value) => {
        setPreferences(value);
        setPreferencesDraft(value);
      })
      .catch(() => {
        setPreferences(DEFAULT_PREFERENCES);
        setPreferencesDraft(DEFAULT_PREFERENCES);
      });
  }, [canView, userId]);

  useEffect(() => {
    if (!canView) return;
    return subscribeToSupportChanges(() => {
      void loadQueue({ background: true });
      if (selectedTicketId) void loadDetails(selectedTicketId, { background: true });
    });
  }, [canView, loadDetails, loadQueue, selectedTicketId]);

  const selectTicket = useCallback((ticketId: string) => {
    setSelectedTicketId(ticketId);
    setCustomerCandidates([]);
    setNotice(null);
    setActionError(null);
    setLocation(`/admin/support?ticket=${encodeURIComponent(ticketId)}`);
  }, [setLocation]);

  const closeDetails = useCallback(() => {
    setSelectedTicketId(null);
    setDetails(null);
    setCustomerCandidates([]);
    setLocation("/admin/support");
  }, [setLocation]);

  const refreshAfterAction = useCallback(async (ticketId: string) => {
    await Promise.all([
      loadQueue({ background: true }),
      loadDetails(ticketId, { background: true }),
    ]);
  }, [loadDetails, loadQueue]);

  const runWorkflowAction = useCallback(async (
    action: SupportWorkflowAction,
    input: { comment?: string; operatorId?: string; urgent?: boolean } = {},
  ): Promise<boolean> => {
    const ticketId = selectedTicketId;
    if (!ticketId) return false;
    setBusyAction(action);
    setActionError(null);
    setNotice(null);
    try {
      if (action === "claim") {
        await claimSupportTicket(ticketId);
        setNotice("Обращение закреплено за вами.");
      } else if (action === "transfer") {
        await transferSupportTicket(ticketId, input.operatorId ?? "", input.comment ?? "");
        setNotice("Обращение передано коллеге.");
      } else if (action === "return") {
        await returnSupportTicketToPool(ticketId, input.comment ?? "", Boolean(input.urgent));
        setNotice("Обращение возвращено в общий пул.");
      } else if (action === "escalate") {
        await escalateSupportTicket(ticketId, input.comment ?? "");
        setNotice("Обращение передано старшему оператору.");
      } else if (action === "waiting_user" || action === "waiting_support") {
        await markSupportTicketWaiting(ticketId, action);
        setNotice(action === "waiting_user" ? "Ожидаем ответ клиента." : "Обращение ждёт ответа поддержки.");
      } else if (action === "resolve") {
        await resolveSupportTicket(ticketId, input.comment ?? "");
        setNotice("Обращение отмечено как решённое.");
      } else if (action === "close") {
        await closeSupportTicket(ticketId, input.comment ?? "");
        setNotice("Обращение закрыто.");
      } else {
        const reopenedId = await reopenSupportTicket(ticketId);
        setNotice("Обращение снова открыто.");
        if (reopenedId && reopenedId !== ticketId) {
          selectTicket(reopenedId);
          return true;
        }
      }
      await refreshAfterAction(ticketId);
      return true;
    } catch (error) {
      setActionError(readActionError(error));
      if (action === "claim") await loadQueue({ background: true });
      return false;
    } finally {
      setBusyAction(null);
    }
  }, [loadQueue, refreshAfterAction, selectTicket, selectedTicketId]);

  const sendReply = useCallback(async (body: string): Promise<boolean> => {
    const ticketId = selectedTicketId;
    if (!ticketId) return false;
    setBusyAction("reply");
    setActionError(null);
    try {
      await replyToSupportTicket(ticketId, body);
      await refreshAfterAction(ticketId);
      return true;
    } catch (error) {
      setActionError(readActionError(error));
      return false;
    } finally {
      setBusyAction(null);
    }
  }, [refreshAfterAction, selectedTicketId]);

  const lookupCustomer = useCallback(async (query: string) => {
    if (!selectedTicketId) return;
    setBusyAction("lookup");
    setActionError(null);
    try {
      const rows = await lookupSupportCustomer(selectedTicketId, query);
      setCustomerCandidates(rows);
      if (rows.length === 0) setNotice("Совпадений не найдено.");
    } catch (error) {
      setActionError(readActionError(error));
    } finally {
      setBusyAction(null);
    }
  }, [selectedTicketId]);

  const saveSettings = useCallback(async () => {
    setBusyAction("settings");
    setActionError(null);
    try {
      const next = await updateSupportSettings(settingsDraft);
      setSettings(next);
      setSettingsDraft(next);
      setSettingsOpen(false);
      setNotice("Настройки поддержки сохранены.");
    } catch (error) {
      setActionError(readActionError(error));
    } finally {
      setBusyAction(null);
    }
  }, [settingsDraft]);

  const savePreferences = useCallback(async () => {
    if (!userId) return;
    setBusyAction("preferences");
    setActionError(null);
    try {
      const next = await updateSupportOperatorPreferences(userId, preferencesDraft);
      setPreferences(next);
      setPreferencesDraft(next);
      setPreferencesOpen(false);
      setNotice("Настройки уведомлений сохранены.");
    } catch (error) {
      setActionError(readActionError(error));
    } finally {
      setBusyAction(null);
    }
  }, [preferencesDraft, userId]);

  const visibleDetails = useMemo(
    () => (details?.ticket.id === selectedTicketId ? details : null),
    [details, selectedTicketId],
  );

  if (access.checking) {
    return (
      <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-[color:var(--kub-muted)]">
        <KubIcon name="spinner" size={20} tone="accent" label="Проверка доступа" />
        Проверяем доступ к поддержке
      </div>
    );
  }
  if (!canView) return <Redirect to="/admin" />;

  return (
    // The workspace is one card, and the material goes on a sheet BEHIND it
    // rather than on the card itself: both dialogs below are `position: fixed`
    // descendants of this box, and a backdrop-filter here would make it their
    // containing block — they would be laid out inside the card, scrim and
    // all, and `overflow-hidden` would then clip them too.
    <div
      data-testid="support-operator-workspace"
      className="relative flex h-[calc(100dvh-7.75rem)] min-h-[34rem] min-w-0 flex-col overflow-hidden rounded-xl border border-[color:var(--kub-border-color)] sm:h-[calc(100dvh-8.5rem)]"
    >
      <KubGlassLayer />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* The panes below divide themselves with borders and carry no fill of
            their own, so the card reads as a single sheet with rules across it
            instead of as four stacked slabs. */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-[color:var(--kub-border-color)] px-3 py-2.5 sm:px-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold text-[color:var(--kub-text)]">
              Поддержка
            </h1>
            <p className="truncate text-xs text-[color:var(--kub-muted)]">
              Приём, переписка и передача обращений
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <KubButton
              type="button"
              size="sm"
              variant="secondary"
              leftIcon={<KubIcon name="notifications" size={14} />}
              onClick={() => {
                setPreferencesDraft(preferences);
                setPreferencesOpen(true);
              }}
            >
              <span className="hidden sm:inline">Мои уведомления</span>
              <span className="sm:hidden">Уведомления</span>
            </KubButton>
            {canSettings ? (
              <KubButton
                type="button"
                size="sm"
                variant="secondary"
                leftIcon={<KubIcon name="settings" size={14} />}
                onClick={() => {
                  setSettingsDraft(settings);
                  setSettingsOpen(true);
                }}
              >
                Настройки
              </KubButton>
            ) : null}
          </div>
        </div>

        {notice || actionError ? (
          <div
            role={actionError ? "alert" : "status"}
            className={
              actionError
                ? "flex-shrink-0 border-b border-[color:var(--kub-danger)]/30 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-4 py-2 text-sm text-[color:var(--kub-text)]"
                : "flex-shrink-0 border-b border-[color:var(--kub-online)]/30 bg-[color-mix(in_srgb,var(--kub-online)_10%,transparent)] px-4 py-2 text-sm text-[color:var(--kub-text)]"
            }
          >
            {actionError ?? notice}
          </div>
        ) : null}

        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 md:grid-cols-[22rem_minmax(0,1fr)]">
          <div className={selectedTicketId ? "hidden min-h-0 md:block" : "min-h-0"}>
            <SupportQueue
              filter={filter}
              tickets={tickets}
              selectedTicketId={selectedTicketId}
              loading={queueLoading}
              error={queueError}
              onFilterChange={(next) => {
                setFilter(next);
                setSelectedTicketId(null);
                setDetails(null);
                setLocation("/admin/support");
              }}
              onSelect={selectTicket}
              onReload={() => void loadQueue()}
            />
          </div>

          <div className={selectedTicketId ? "flex min-h-0 min-w-0" : "hidden min-h-0 min-w-0 md:flex"}>
            {detailsLoading && !visibleDetails ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[color:var(--kub-muted)]">
                <KubIcon name="spinner" size={20} tone="accent" label="Загрузка обращения" />
                Загружаем обращение
              </div>
            ) : visibleDetails ? (
              <SupportTicketDetails
                details={visibleDetails}
                currentUserId={userId}
                permissions={permissionKeys}
                operators={operators}
                busyAction={busyAction}
                customerCandidates={customerCandidates}
                onBack={closeDetails}
                onReply={sendReply}
                onAction={runWorkflowAction}
                onLookupCustomer={lookupCustomer}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <KubIcon name="chatBubble" size={34} tone="muted" />
                <p className="mt-4 text-sm font-semibold text-[color:var(--kub-text)]">
                  Выберите обращение
                </p>
                <p className="mt-1 max-w-sm text-xs text-[color:var(--kub-muted)]">
                  Переписка, контакты и неизменяемая история действий откроются здесь.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {settingsOpen ? (
        <SupportSettingsDialog
          value={settingsDraft}
          busy={busyAction === "settings"}
          onChange={setSettingsDraft}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      ) : null}
      {preferencesOpen ? (
        <SupportPreferencesDialog
          value={preferencesDraft}
          busy={busyAction === "preferences"}
          onChange={setPreferencesDraft}
          onClose={() => setPreferencesOpen(false)}
          onSave={savePreferences}
        />
      ) : null}
    </div>
  );
}

interface SupportPreferencesDialogProps {
  value: SupportOperatorPreferences;
  busy: boolean;
  onChange: (value: SupportOperatorPreferences) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}

function SupportPreferencesDialog({
  value,
  busy,
  onChange,
  onClose,
  onSave,
}: SupportPreferencesDialogProps) {
  const rows: Array<{
    key: keyof SupportOperatorPreferences;
    title: string;
    description: string;
  }> = [
    {
      key: "notifyNewPool",
      title: "Новые обращения",
      description: "Сообщать о тикетах, поступивших в общий пул.",
    },
    {
      key: "notifyUrgentOnly",
      title: "Только срочные из пула",
      description: "Не уведомлять об обычных новых обращениях.",
    },
    {
      key: "notifyAssignedMessages",
      title: "Ответы клиентов",
      description: "Сообщать о новых ответах в закреплённых тикетах.",
    },
    {
      key: "notifyTransfers",
      title: "Передачи",
      description: "Сообщать, когда обращение передали вам.",
    },
    {
      key: "notifyEscalations",
      title: "Эскалации",
      description: "Сообщать о запросах помощи старшего оператора.",
    },
    {
      key: "pushEnabled",
      title: "Системные уведомления",
      description: "Разрешить доставку support-событий на устройства.",
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-preferences-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm"
    >
      <div className="kub-glass-strong max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-[color:var(--kub-border-color)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="support-preferences-title" className="text-base font-bold text-[color:var(--kub-text)]">
              Мои уведомления
            </h2>
            <p className="mt-1 text-xs text-[color:var(--kub-muted)]">
              Настройки применяются только к вашей операторской учётной записи.
            </p>
          </div>
          <KubButton type="button" size="icon" variant="ghost" aria-label="Закрыть уведомления" onClick={onClose}>
            <KubIcon name="close" size={16} />
          </KubButton>
        </div>
        <div className="mt-4 space-y-2">
          {rows.map((row) => (
            <label
              key={row.key}
              className="kub-raise flex min-w-0 items-center justify-between gap-4 rounded-lg p-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[color:var(--kub-text)]">{row.title}</span>
                <span className="mt-0.5 block text-xs text-[color:var(--kub-muted)]">{row.description}</span>
              </span>
              <KubSwitch
                checked={value[row.key]}
                onCheckedChange={(checked) => onChange({ ...value, [row.key]: checked })}
                aria-label={row.title}
              />
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-[color:var(--kub-muted)]">
          Email-уведомления станут доступны после отдельного подключения Mailcow.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <KubButton type="button" variant="ghost" onClick={onClose}>
            Отмена
          </KubButton>
          <KubButton type="button" loading={busy} onClick={() => void onSave()}>
            Сохранить
          </KubButton>
        </div>
      </div>
    </div>
  );
}

interface SupportSettingsDialogProps {
  value: SupportSettings;
  busy: boolean;
  onChange: (value: SupportSettings) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}

function SupportSettingsDialog({
  value,
  busy,
  onChange,
  onClose,
  onSave,
}: SupportSettingsDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm"
    >
      <div className="kub-glass-strong max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-[color:var(--kub-border-color)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="support-settings-title" className="text-base font-bold text-[color:var(--kub-text)]">
              Настройки поддержки
            </h2>
            <p className="mt-1 text-xs text-[color:var(--kub-muted)]">
              Изменения действуют для публичной формы.
            </p>
          </div>
          <KubButton type="button" size="icon" variant="ghost" aria-label="Закрыть настройки" onClick={onClose}>
            <KubIcon name="close" size={16} />
          </KubButton>
        </div>

        <div className="mt-4 space-y-3">
          <label className="kub-raise flex min-w-0 items-center justify-between gap-4 rounded-lg p-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[color:var(--kub-text)]">Приём обращений</span>
              <span className="mt-0.5 block text-xs text-[color:var(--kub-muted)]">Общий режим работы поддержки</span>
            </span>
            <KubSwitch
              checked={value.intakeEnabled}
              onCheckedChange={(checked) => onChange({ ...value, intakeEnabled: checked })}
              aria-label="Включить приём обращений"
            />
          </label>
          <label className="kub-raise flex min-w-0 items-center justify-between gap-4 rounded-lg p-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[color:var(--kub-text)]">Гостевая форма</span>
              <span className="mt-0.5 block text-xs text-[color:var(--kub-muted)]">Обращения без входа в аккаунт</span>
            </span>
            <KubSwitch
              checked={value.guestIntakeEnabled}
              onCheckedChange={(checked) => onChange({ ...value, guestIntakeEnabled: checked })}
              aria-label="Включить гостевую форму"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[color:var(--kub-muted)]">Сообщение при закрытом приёме</span>
            <textarea
              value={value.closedMessage}
              onChange={(event) => onChange({ ...value, closedMessage: event.target.value })}
              maxLength={500}
              rows={3}
              className="mt-1 w-full rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 py-2 text-sm text-[color:var(--kub-text)]"
            />
          </label>
          <div>
            <p className="text-xs font-bold text-[color:var(--kub-text)]">
              Новые обращения
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label>
                <span className="text-xs font-semibold text-[color:var(--kub-muted)]">За 15 минут</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={value.ticketLimit15m}
                  onChange={(event) => onChange({ ...value, ticketLimit15m: Number(event.target.value) })}
                  className="mt-1 h-10 w-full rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 text-sm text-[color:var(--kub-text)]"
                />
              </label>
              <label>
                <span className="text-xs font-semibold text-[color:var(--kub-muted)]">За сутки</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={value.ticketLimitDay}
                  onChange={(event) => onChange({ ...value, ticketLimitDay: Number(event.target.value) })}
                  className="mt-1 h-10 w-full rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 text-sm text-[color:var(--kub-text)]"
                />
              </label>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-[color:var(--kub-text)]">
              Сообщения в обращении
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label>
                <span className="text-xs font-semibold text-[color:var(--kub-muted)]">За 5 минут</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={value.messageLimit5m}
                  onChange={(event) => onChange({ ...value, messageLimit5m: Number(event.target.value) })}
                  className="mt-1 h-10 w-full rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 text-sm text-[color:var(--kub-text)]"
                />
              </label>
              <label>
                <span className="text-xs font-semibold text-[color:var(--kub-muted)]">За сутки</span>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={value.messageLimitDay}
                  onChange={(event) => onChange({ ...value, messageLimitDay: Number(event.target.value) })}
                  className="mt-1 h-10 w-full rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-3 text-sm text-[color:var(--kub-text)]"
                />
              </label>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <KubButton type="button" variant="ghost" onClick={onClose}>
            Отмена
          </KubButton>
          <KubButton
            type="button"
            loading={busy}
            disabled={
              value.closedMessage.trim().length < 3 ||
              value.ticketLimit15m < 1 ||
              value.ticketLimitDay < value.ticketLimit15m ||
              value.messageLimit5m < 1 ||
              value.messageLimitDay < value.messageLimit5m
            }
            onClick={() => void onSave()}
          >
            Сохранить
          </KubButton>
        </div>
      </div>
    </div>
  );
}

function readTicketFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("ticket");
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function readActionError(error: unknown): string {
  if (error instanceof SupportOperatorApiError) return error.message;
  return "Не удалось выполнить действие. Попробуйте ещё раз.";
}
