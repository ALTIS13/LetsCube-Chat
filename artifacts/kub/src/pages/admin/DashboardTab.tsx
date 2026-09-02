"use client";

import { KubBadge, KubButton, KubIcon } from "@/components/kub";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { DashboardMetricStrip } from "./dashboard/DashboardMetricStrip";
import { RecentActivity } from "./dashboard/RecentActivity";
import { RegistrationTrend } from "./dashboard/RegistrationTrend";

export function DashboardTab() {
  const dashboard = useAdminDashboard();
  const attentionCount = dashboard.metrics.activeBans + dashboard.metrics.activeMutes;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[color:var(--kub-text)]">Состояние системы</h2>
            <KubBadge tone="online" pill className="text-[10px]">
              Данные обновляются
            </KubBadge>
          </div>
          <p className="mt-1 text-xs text-[color:var(--kub-muted)]">
            Пользователи, активность и последние административные события
          </p>
        </div>
        <div className="flex items-center gap-3">
          {attentionCount > 0 && (
            <span className="text-xs text-[color:var(--kub-warn)]">
              Требуют внимания: {attentionCount.toLocaleString("ru-RU")}
            </span>
          )}
          <KubButton
            size="sm"
            variant="ghost"
            disabled={dashboard.loading}
            onClick={() => void dashboard.refresh()}
          >
            <KubIcon name={dashboard.loading ? "spinner" : "activity"} size={14} className={dashboard.loading ? "animate-spin" : ""} />
            Обновить
          </KubButton>
        </div>
      </div>

      <DashboardMetricStrip metrics={dashboard.metrics} loading={dashboard.loading} error={dashboard.errors.metrics} />
      <RegistrationTrend series={dashboard.registrationSeries} metrics={dashboard.metrics} error={dashboard.errors.registrations} />
      <RecentActivity
        users={dashboard.recentUsers}
        events={dashboard.recentEvents}
        usersError={dashboard.errors.users}
        eventsError={dashboard.errors.events}
      />

      {dashboard.updatedAt && (
        <div className="flex items-center justify-end gap-1.5 text-[10px] uppercase text-[color:var(--kub-muted)]">
          <KubIcon name="clock" size={11} />
          Обновлено {dashboard.updatedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>
      )}
    </div>
  );
}
