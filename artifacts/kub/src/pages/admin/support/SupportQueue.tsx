import { KubBadge, KubIcon } from "@/components/kub";
import type {
  SupportQueueFilter,
  SupportTicket,
} from "@/lib/support/operatorApi";
import { cn } from "@/lib/utils";

const FILTERS: ReadonlyArray<{
  id: SupportQueueFilter;
  label: string;
}> = [
  { id: "pool", label: "Общий пул" },
  { id: "mine", label: "Мои" },
  { id: "urgent", label: "Срочные" },
  { id: "waiting", label: "Ожидают" },
  { id: "resolved", label: "Решённые" },
  { id: "spam", label: "Спам" },
];

const STATUS_LABEL: Record<SupportTicket["status"], string> = {
  new: "Новое",
  in_progress: "В работе",
  waiting_user: "Ждём клиента",
  waiting_support: "Ждёт поддержки",
  escalated: "Передано старшему",
  resolved: "Решено",
  closed: "Закрыто",
  spam: "Спам",
};

const CATEGORY_LABEL: Record<string, string> = {
  account: "Аккаунт",
  access: "Доступ",
  technical: "Технический вопрос",
  messages: "Сообщения",
  messaging: "Сообщения",
  media: "Медиа",
  tasks: "Задачи",
  club: "Клуб",
  privacy: "Персональные данные",
  abuse: "Нарушение",
  other: "Другое",
};

interface SupportQueueProps {
  filter: SupportQueueFilter;
  tickets: SupportTicket[];
  selectedTicketId: string | null;
  loading: boolean;
  error: string | null;
  onFilterChange: (filter: SupportQueueFilter) => void;
  onSelect: (ticketId: string) => void;
  onReload: () => void;
}

export function SupportQueue({
  filter,
  tickets,
  selectedTicketId,
  loading,
  error,
  onFilterChange,
  onSelect,
  onReload,
}: SupportQueueProps) {
  return (
    <section
      aria-label="Очередь поддержки"
      className="flex min-h-0 min-w-0 flex-col border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] md:border-b-0 md:border-r"
    >
      <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-[color:var(--kub-border-color)] p-2 no-scrollbar">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onFilterChange(item.id)}
            aria-pressed={filter === item.id}
            className={cn(
              "h-9 shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors",
              filter === item.id
                ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                : "text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)] hover:text-[color:var(--kub-text)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        data-testid="support-queue-scroll"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [content-visibility:auto]"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[color:var(--kub-muted)]">
            <KubIcon name="spinner" size={18} tone="accent" label="Загрузка очереди" />
            Загружаем обращения
          </div>
        ) : error ? (
          <div className="m-2 rounded-lg border border-[color:var(--kub-danger)]/30 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] p-3">
            <p className="text-sm text-[color:var(--kub-danger)]">{error}</p>
            <button
              type="button"
              onClick={onReload}
              className="mt-2 text-xs font-semibold text-[color:var(--kub-cyan)]"
            >
              Повторить
            </button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center px-5 text-center">
            <KubIcon name="chatBubble" size={28} tone="muted" />
            <p className="mt-3 text-sm font-semibold text-[color:var(--kub-text)]">
              В этой очереди пока пусто
            </p>
            <p className="mt-1 text-xs text-[color:var(--kub-muted)]">
              Новые обращения появятся здесь автоматически.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => onSelect(ticket.id)}
                className={cn(
                  "w-full min-w-0 rounded-lg border p-3 text-left transition-colors",
                  selectedTicketId === ticket.id
                    ? "border-[color:var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-cyan)_10%,var(--kub-surface-2))]"
                    : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] hover:border-[color:var(--kub-cyan)]/50",
                )}
              >
                <span className="flex min-w-0 items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[color:var(--kub-text)]">
                        {ticket.subject}
                      </span>
                      {ticket.urgent ? <KubBadge tone="danger">Срочно</KubBadge> : null}
                    </span>
                    <span className="mt-1 block truncate text-xs text-[color:var(--kub-muted)]">
                      {ticket.publicReference} · {CATEGORY_LABEL[ticket.category] ?? "Другое"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-[color:var(--kub-muted)]">
                    {formatRelative(ticket.lastActivityAt)}
                  </span>
                </span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <KubBadge
                    tone={
                      ticket.status === "escalated"
                        ? "danger"
                        : ticket.status === "waiting_support"
                          ? "warn"
                          : ticket.status === "resolved" || ticket.status === "closed"
                            ? "online"
                            : "cyan"
                    }
                  >
                    {STATUS_LABEL[ticket.status]}
                  </KubBadge>
                  <span className="truncate text-[11px] text-[color:var(--kub-muted)]">
                    {ticket.assignedOperatorId ? "Назначено оператору" : "Общий пул"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function formatRelative(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) return "сейчас";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч`;
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}
