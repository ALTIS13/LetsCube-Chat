import { KubIcon, KubPanel } from "@/components/kub";
import type { AdminDashboardMetrics } from "@/hooks/useAdminDashboard";
import type { RegistrationPoint } from "@/pages/admin/dashboardModel";

export function RegistrationTrend({ series, metrics, error }: {
  series: RegistrationPoint[];
  metrics: AdminDashboardMetrics;
  error: string | null;
}) {
  const onlinePercent = metrics.totalUsers > 0
    ? Math.min(100, Math.round((metrics.online / metrics.totalUsers) * 100))
    : 0;
  const maximum = Math.max(1, ...series.map((point) => point.value));

  return (
    <KubPanel padded={false} data-testid="admin-registration-trend" className="overflow-hidden">
      <div className="flex flex-col border-b border-[color:var(--kub-border-color)] sm:flex-row sm:items-center sm:justify-between">
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--kub-text)]">
            <KubIcon name="activity" size={16} tone="accent" />
            Регистрации за 7 дней
          </div>
          <p className="mt-1 text-xs text-[color:var(--kub-muted)]">Фактические новые профили по дням</p>
        </div>
        <div className="min-w-[210px] border-t border-[color:var(--kub-border-color)] px-4 py-3 sm:border-l sm:border-t-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[color:var(--kub-muted)]">Пользователи онлайн</span>
            <strong className="tabular-nums text-[color:var(--kub-text)]">{onlinePercent}%</strong>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--kub-surface-3)]">
            <div className="h-full rounded-full bg-[var(--kub-online)] transition-[width] duration-500" style={{ width: `${onlinePercent}%` }} />
          </div>
        </div>
      </div>
      <div className="h-56 px-4 pb-3 pt-4" aria-label="График регистраций за семь дней">
        <ol
          className="grid h-full grid-cols-7 gap-2 border-b border-[color:var(--kub-border-color)] px-1"
          data-testid="admin-registration-bars"
          style={{
            backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent calc(33.333% - 1px), color-mix(in srgb, var(--kub-border-color) 55%, transparent) 33.333%)",
          }}
        >
          {series.map((point) => {
            const height = point.value === 0 ? 3 : Math.max(10, Math.round((point.value / maximum) * 100));
            return (
              <li
                key={point.date}
                className="group relative flex min-w-0 flex-col items-center justify-end gap-2"
                aria-label={`${point.label}: ${point.value.toLocaleString("ru-RU")} новых пользователей`}
                title={`${point.label}: ${point.value.toLocaleString("ru-RU")}`}
              >
                <span className="pointer-events-none absolute bottom-9 z-10 hidden rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-2 py-1 text-[11px] font-semibold text-[color:var(--kub-text)] shadow-lg group-hover:block group-focus-within:block">
                  {point.value.toLocaleString("ru-RU")}
                </span>
                <span className="flex h-[calc(100%-1.75rem)] w-full max-w-9 items-end overflow-hidden rounded-t-md bg-[color-mix(in_srgb,var(--kub-cyan)_7%,transparent)]">
                  <span
                    className="block w-full rounded-t-md bg-[linear-gradient(180deg,var(--kub-pink),var(--kub-cyan))] opacity-90 transition-[height,opacity] duration-500 group-hover:opacity-100"
                    style={{ height: `${height}%` }}
                  />
                </span>
                <span className="h-4 truncate text-[10px] text-[color:var(--kub-muted)]">{point.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
      {error && <p className="px-4 pb-3 text-xs text-[color:var(--kub-warn)]">{error}</p>}
    </KubPanel>
  );
}
