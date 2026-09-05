import { KubIcon, KubPanel, type KubIconName } from "@/components/kub";
import type { AdminDashboardMetrics } from "@/hooks/useAdminDashboard";

type Tone = "cyan" | "pink" | "online" | "danger" | "warn";

const TONE_COLOR: Record<Tone, string> = {
  cyan: "var(--kub-cyan)",
  pink: "var(--kub-pink)",
  online: "var(--kub-online)",
  danger: "var(--kub-danger)",
  warn: "var(--kub-warn)",
};

export function DashboardMetricStrip({
  metrics,
  loading,
  error,
}: {
  metrics: AdminDashboardMetrics;
  loading: boolean;
  error: string | null;
}) {
  const items: Array<{ icon: KubIconName; label: string; value: number; tone: Tone }> = [
    { icon: "users", label: "Пользователи", value: metrics.totalUsers, tone: "cyan" },
    { icon: "activity", label: "Сейчас онлайн", value: metrics.online, tone: "online" },
    { icon: "userPlus", label: "Новые сегодня", value: metrics.newToday, tone: "pink" },
    { icon: "userPlus", label: "Новые за 7 дней", value: metrics.newThisWeek, tone: "pink" },
    { icon: "chatRect", label: "Диалоги", value: metrics.totalChats, tone: "cyan" },
    { icon: "chatRect", label: "Сообщения сегодня", value: metrics.messagesToday, tone: "online" },
    { icon: "shieldOff", label: "Активные блокировки", value: metrics.activeBans, tone: "danger" },
    { icon: "muted", label: "Активные ограничения", value: metrics.activeMutes, tone: "warn" },
  ];

  return (
    <KubPanel padded={false} data-testid="admin-dashboard-metrics" className="overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
        {items.map(({ icon, label, value, tone }) => {
          const color = TONE_COLOR[tone];
          return (
            <div
              key={label}
              className="min-w-0 border-b border-r border-[color:var(--kub-border-color)] p-3 [&:nth-child(2n)]:border-r-0 [&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-child(2n)]:border-r sm:[&:nth-child(4n)]:border-r-0 sm:[&:nth-last-child(-n+2)]:border-b sm:[&:nth-last-child(-n+4)]:border-b-0 xl:border-b-0 xl:[&:nth-child(4n)]:border-r xl:last:border-r-0"
            >
              {/* The card used to carry an ordinal — 01 to 08 — in its corner.
                  It encoded nothing and sat in tabular numerals beside the one
                  figure on the card that means something. */}
              <div className="mb-2 flex items-center gap-2">
                <span style={{ color }}>
                  <KubIcon name={icon} size={15} tone="currentColor" />
                </span>
              </div>
              <div className="text-xl font-bold tabular-nums text-[color:var(--kub-text)]">
                {loading ? "…" : value.toLocaleString("ru-RU")}
              </div>
              <div className="mt-0.5 text-[12px] leading-tight text-[color:var(--kub-muted)]">
                {label}
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <div className="border-t border-[color:var(--kub-border-color)] px-3 py-2 text-xs text-[color:var(--kub-warn)]">
          {error}
        </div>
      )}
    </KubPanel>
  );
}
