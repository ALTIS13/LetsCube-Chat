import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
            <strong className="tabular-nums text-[color:var(--kub-online)]">{onlinePercent}%</strong>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--kub-surface-3)]">
            <div className="h-full rounded-full bg-[var(--kub-online)] transition-[width] duration-500" style={{ width: `${onlinePercent}%` }} />
          </div>
        </div>
      </div>
      <div className="h-56 px-2 pb-2 pt-4" aria-label="График регистраций за семь дней">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 4, right: 12, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id="registrationArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--kub-cyan)" stopOpacity={0.34} />
                <stop offset="100%" stopColor="var(--kub-cyan)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--kub-border-color)" strokeDasharray="3 4" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--kub-muted)", fontSize: 10 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={34} tick={{ fill: "var(--kub-muted)", fontSize: 10 }} />
            <Tooltip
              cursor={{ stroke: "var(--kub-cyan)", strokeOpacity: 0.3 }}
              contentStyle={{ borderRadius: 6, border: "1px solid var(--kub-border-color)", background: "var(--kub-surface-2)", color: "var(--kub-text)", fontSize: 12 }}
              formatter={(value) => [Number(value).toLocaleString("ru-RU"), "Новые пользователи"]}
              labelFormatter={(label) => `Дата: ${label}`}
            />
            <Area type="monotone" dataKey="value" stroke="var(--kub-cyan)" strokeWidth={2} fill="url(#registrationArea)" activeDot={{ r: 4, fill: "var(--kub-pink)", strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {error && <p className="px-4 pb-3 text-xs text-[color:var(--kub-warn)]">{error}</p>}
    </KubPanel>
  );
}
