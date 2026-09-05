"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KubBadge, KubButton, KubIcon, KubPanel, type KubIconName } from "@/components/kub";
import { getAuthCaptchaConfig, isAuthCaptchaEnabled, shouldUseAuthCaptchaGateway } from "@/lib/authCaptcha";
import { mapPgError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import type { AdminOpsSecurityReport, AdminOpsSecurityReportEvent } from "@/types/database";

type LoadState = "idle" | "loading" | "ready" | "missing" | "error";

const RPC_MISSING_CODES = new Set(["PGRST202", "PGRST204", "42883"]);

export function OpsReportTab() {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<LoadState>("idle");
  const [report, setReport] = useState<AdminOpsSecurityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadInFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    setState("loading");
    setError(null);

    const { data, error: rpcError } = await supabase.rpc("admin_ops_security_report");
    loadInFlightRef.current = false;

    if (rpcError) {
      setReport(null);
      if (isRpcMissing(rpcError)) {
        setState("missing");
        return;
      }
      setState("error");
      setError(mapPgError(rpcError));
      return;
    }

    setReport(parseReport(data));
    setState("ready");
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const captchaConfig = getAuthCaptchaConfig();
  const generatedAt = report?.generated_at ? new Date(report.generated_at) : null;
  const cards = buildCards(report);
  const controlCards = buildControlCards(report);

  return (
    <div className="space-y-4" data-testid="admin-ops-report">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--kub-accent-text)]">
            <KubIcon name="activity" size={14} />
            Операционный отчёт
          </div>
          <h2 className="mt-2 text-xl font-bold text-[color:var(--kub-text)]">
            Операционная безопасность
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[color:var(--kub-muted)]">
            Агрегированный отчёт по регистрации, приглашениям и защите входа без паролей,
            токенов проверки, токенов восстановления, IP-адресов и адресов эл. почты.
          </p>
        </div>
        <KubButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void load()}
          loading={state === "loading"}
          leftIcon={<KubIcon name="rotate" size={13} />}
          data-testid="admin-ops-refresh"
        >
          Обновить
        </KubButton>
      </div>

      <KubPanel className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">
              Защита публичных форм в текущей сборке
            </h3>
            <p className="mt-1 text-xs leading-5 text-[color:var(--kub-muted)]">
              Эти статусы отражают конфигурацию интерфейса и не заменяют проверку командой
              `pnpm.cmd auth:anti-abuse:smoke`.
            </p>
          </div>
          <KubBadge tone={isAuthCaptchaEnabled() ? "online" : "warn"} pill dot data-testid="admin-ops-captcha-status">
            {isAuthCaptchaEnabled() ? "Капча включена" : "Капча не настроена"}
          </KubBadge>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <ControlCard
            icon="shield"
            title="Капча"
            value={captchaConfig?.provider === "yandex-smartcaptcha" ? "Yandex SmartCaptcha" : captchaConfig?.provider ?? "нет"}
            ok={isAuthCaptchaEnabled()}
            detail="Проверка нужна на регистрации и восстановлении доступа."
          />
          <ControlCard
            icon="lock"
            title="Шлюз авторизации"
            value={shouldUseAuthCaptchaGateway() ? "через защищённый шлюз" : "операции заблокированы"}
            ok={shouldUseAuthCaptchaGateway()}
            detail="Регистрация, повторная отправка и восстановление всегда проходят через защищённую серверную функцию."
          />
          <ControlCard
            icon="audit"
            title="Операторская проверка"
            value="доступен"
            ok
            detail="Команда проверяет обход прямой авторизации и ограничение частоты без создания пользователей."
          />
        </div>
      </KubPanel>

      {state === "missing" && (
        <KubPanel
          // Only the edge is tinted, and that is a measurement rather than a
          // preference. `.kub-panel` sets `background` and the `border`
          // shorthand, and while it sat outside every cascade layer both
          // utilities here were dead — the callout rendered as a plain panel.
          // With the class layered they take effect, and the fill costs
          // contrast: photographed in the light theme, --kub-muted on the
          // 8% wash measures 4.52:1 for the warning and 4.39:1 for the error
          // below, against 5.59:1 on the untinted panel. 4.39 is under the
          // 4.5:1 floor. The border colour carries the same signal for
          // nothing: it measures 5.59:1, exactly the plain panel.
          className="border-[color:var(--kub-warn)]/35"
          data-testid="admin-ops-migration-warning"
        >
          <div className="flex items-start gap-3">
            <KubIcon name="warning" size={20} tone="warn" className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[color:var(--kub-text)]">
                Нужно применить SQL-предложение для живых метрик
              </div>
              <p className="mt-1 text-sm leading-6 text-[color:var(--kub-muted)]">
                Вкладка готова, но серверная функция `admin_ops_security_report` ещё не применена в базе. Примените вручную
                `.migration-backup/supabase/migrations/20260622_admin_ops_security_report.sql`.
              </p>
            </div>
          </div>
        </KubPanel>
      )}

      {state === "error" && (
        <KubPanel className="border-[color:var(--kub-danger)]/35">
          <div className="flex items-start gap-3">
            <KubIcon name="alert" size={20} tone="danger" className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[color:var(--kub-text)]">
                Отчёт временно недоступен
              </div>
              <p className="mt-1 text-sm leading-6 text-[color:var(--kub-muted)]">
                {error ?? "Не удалось загрузить операционный отчёт."}
              </p>
            </div>
          </div>
        </KubPanel>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="admin-ops-summary-cards">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} loading={state === "loading"} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <KubPanel className="space-y-3" data-testid="admin-ops-controls">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">
              Контрольные точки
            </h3>
            {generatedAt && (
              <span className="text-[12px] uppercase tracking-wide text-[color:var(--kub-muted)]">
                {generatedAt.toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {controlCards.map((item) => (
              <div
                key={item.title}
                className="kub-raise flex items-start gap-3 rounded-2xl px-3 py-3"
              >
                <KubIcon
                  name={item.ok ? "checkCircle" : "warning"}
                  size={18}
                  tone={item.ok ? "online" : item.tone === "cyan" ? "accent" : item.tone}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[color:var(--kub-text)]">
                    {item.title}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-[color:var(--kub-muted)]">
                    {item.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </KubPanel>

        <KubPanel padded={false} className="overflow-hidden" data-testid="admin-ops-events">
          <div className="kub-raise border-b border-[color:var(--kub-rule)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[color:var(--kub-text)]">
              Последние события авторизации и приглашений
            </h3>
            <p className="mt-1 text-xs text-[color:var(--kub-muted)]">
              Без ID инициатора, ID цели, адресов эл. почты и IP. Полный журнал аудита остаётся во вкладке «Журнал».
            </p>
          </div>
          <EventList events={report?.audit?.recent_events ?? []} loading={state === "loading"} />
        </KubPanel>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
  loading,
}: {
  icon: KubIconName;
  label: string;
  value: string | number;
  tone: "cyan" | "pink" | "online" | "warn" | "danger" | "muted";
  loading: boolean;
}) {
  return (
    <KubPanel padded={false} className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="kub-raise rounded-xl p-2">
          <KubIcon name={icon} size={16} tone={tone === "muted" ? "muted" : tone === "cyan" ? "accent" : tone} />
        </div>
        {loading && <KubIcon name="spinner" size={14} tone="muted" />}
      </div>
      <div className="mt-3 text-2xl font-bold tabular-nums text-[color:var(--kub-text)]">
        {typeof value === "number" ? value.toLocaleString("ru-RU") : value}
      </div>
      <div className="mt-1 text-[12px] tracking-wide leading-tight text-[color:var(--kub-muted)]">
        {label}
      </div>
    </KubPanel>
  );
}

function ControlCard({
  icon,
  title,
  value,
  ok,
  detail,
}: {
  icon: KubIconName;
  title: string;
  value: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="kub-raise rounded-2xl px-3 py-3">
      <div className="flex items-center gap-2">
        <KubIcon name={icon} size={15} tone={ok ? "online" : "warn"} />
        <div className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
          {title}
        </div>
      </div>
      <div className="mt-2 text-sm font-semibold text-[color:var(--kub-text)]">
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-[color:var(--kub-muted)]">
        {detail}
      </div>
    </div>
  );
}

function EventList({ events, loading }: { events: AdminOpsSecurityReportEvent[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <KubIcon name="spinner" size={20} tone="accent" label="Загрузка" />
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-[color:var(--kub-muted)]">
        Событий по регистрации и инвайтам пока нет.
      </div>
    );
  }
  return (
    <div className="divide-y divide-[color:var(--kub-rule)]">
      {events.map((event) => (
        <div key={`${event.created_at}-${event.action}-${event.target_kind}`} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <KubBadge tone={event.action.includes("revoked") ? "warn" : "cyan"}>
              {eventLabel(event.action)}
            </KubBadge>
            <span className="text-[12px] text-[color:var(--kub-muted)]">
              {formatDate(event.created_at)}
            </span>
          </div>
          <div className="mt-1 text-xs leading-5 text-[color:var(--kub-muted)]">
            Объект: {targetKindLabel(event.target_kind)}
          </div>
        </div>
      ))}
    </div>
  );
}

function buildCards(report: AdminOpsSecurityReport | null) {
  return [
    {
      icon: "users" as const,
      label: "Пользователей",
      value: report?.auth?.total_users ?? "—",
      tone: "cyan" as const,
    },
    {
      icon: "userPlus" as const,
      label: "Новых 24ч",
      value: report?.profiles?.created_24h ?? report?.auth?.created_24h ?? "—",
      tone: "pink" as const,
    },
    {
      icon: "mail" as const,
      label: "Не подтверждены",
      value: report?.auth?.unconfirmed_users ?? "—",
      tone: "warn" as const,
    },
    {
      icon: "lock" as const,
      label: "Режим приглашений",
      value: report?.invites?.invite_only_enabled == null
        ? "—"
        : report.invites.invite_only_enabled
          ? "вкл"
          : "выкл",
      tone: report?.invites?.invite_only_enabled ? ("online" as const) : ("muted" as const),
    },
    {
      icon: "userPlus" as const,
      label: "Активных инвайтов",
      value: report?.invites?.active ?? "—",
      tone: "online" as const,
    },
    {
      icon: "audit" as const,
      label: "Событий приглашений за 7д",
      value: report?.audit?.invite_events_7d ?? "—",
      tone: "cyan" as const,
    },
  ];
}

function buildControlCards(report: AdminOpsSecurityReport | null) {
  const controls = report?.controls;
  const inviteModeKnown = report?.invites?.invite_only_enabled !== null && report?.invites?.invite_only_enabled !== undefined;
  return [
    {
      title: "Обход прямой авторизации проверяется отдельной командой",
      detail: "Запускайте `pnpm.cmd auth:anti-abuse:smoke`; ожидаемый результат: прямые регистрация и восстановление доступа заблокированы на прокси.",
      ok: true,
      tone: "cyan" as const,
    },
    {
      title: "Модель инвайт-кодов видна отчёту",
      detail: controls?.invite_table_available
        ? "Таблицы инвайтов доступны серверной функции только агрегированно."
        : "Живые метрики инвайтов появятся после применения SQL-предложения или если таблицы доступны в текущей базе.",
      ok: Boolean(controls?.invite_table_available),
      tone: "warn" as const,
    },
    {
      title: "Режим регистрации по приглашениям управляется из админки",
      detail: inviteModeKnown
        ? report?.invites?.invite_only_enabled
          ? "Открытая регистрация ограничена кодом или ссылкой-приглашением."
          : "Открытая регистрация включена; ссылка-приглашение продолжает заранее задавать роль и локацию в фоне."
        : "Статус режима приглашений недоступен без серверной функции или таблицы настроек.",
      ok: inviteModeKnown,
      tone: "warn" as const,
    },
    {
      title: "Журнал аудита подключён",
      detail: controls?.audit_log_available
        ? "Отчёт берёт только агрегаты и безопасные названия событий; подробности остаются в обычном журнале."
        : "Журнал аудита недоступен для агрегированного отчёта.",
      ok: Boolean(controls?.audit_log_available),
      tone: "warn" as const,
    },
  ];
}

function parseReport(value: unknown): AdminOpsSecurityReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AdminOpsSecurityReport;
}

function isRpcMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as Record<string, unknown>).code;
  const message = (error as Record<string, unknown>).message;
  const text = [code, message].filter((item): item is string => typeof item === "string").join(" ");
  return RPC_MISSING_CODES.has(String(code).toUpperCase()) || text.toLowerCase().includes("admin_ops_security_report");
}

function eventLabel(action: string): string {
  const labels: Record<string, string> = {
    registration_invite_created: "Инвайт создан",
    registration_invite_revoked: "Инвайт отозван",
    registration_invite_consumed: "Инвайт использован",
    registration_invite_mode_updated: "Режим регистрации",
  };
  return labels[action] ?? action.replace(/_/g, " ");
}

function targetKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    profile: "профиль",
    registration_invite: "инвайт",
    registration_invite_settings: "настройки регистрации",
  };
  return labels[kind] ?? kind.replace(/_/g, " ");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
