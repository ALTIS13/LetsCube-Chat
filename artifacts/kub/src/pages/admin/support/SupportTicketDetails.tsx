import { useMemo, useState } from "react";
import { KubBadge, KubButton, KubIcon } from "@/components/kub";
import type {
  SupportCustomerCandidate,
  SupportOperator,
  SupportPermission,
  SupportTicketDetails as SupportTicketDetailsModel,
} from "@/lib/support/operatorApi";
import { SupportConversation } from "./SupportConversation";

export type SupportWorkflowAction =
  | "claim"
  | "transfer"
  | "return"
  | "escalate"
  | "waiting_user"
  | "waiting_support"
  | "resolve"
  | "close"
  | "reopen";

interface SupportTicketDetailsProps {
  details: SupportTicketDetailsModel;
  currentUserId: string;
  permissions: ReadonlySet<string>;
  operators: SupportOperator[];
  busyAction: string | null;
  customerCandidates: SupportCustomerCandidate[];
  onBack: () => void;
  onReply: (body: string) => Promise<boolean>;
  onAction: (
    action: SupportWorkflowAction,
    input?: { comment?: string; operatorId?: string; urgent?: boolean },
  ) => Promise<boolean>;
  onLookupCustomer: (query: string) => Promise<void>;
}

export function SupportTicketDetails({
  details,
  currentUserId,
  permissions,
  operators,
  busyAction,
  customerCandidates,
  onBack,
  onReply,
  onAction,
  onLookupCustomer,
}: SupportTicketDetailsProps) {
  const [action, setAction] = useState<"transfer" | "return" | "escalate" | "resolve" | "close" | null>(null);
  const [comment, setComment] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [lookupQuery, setLookupQuery] = useState("");
  const ticket = details.ticket;
  const canManage = permissions.has("support.manage");
  const assignedToCurrent = ticket.assignedOperatorId === currentUserId;
  const canControl = assignedToCurrent || canManage;
  const canReply = permissions.has("support.reply");
  const canTransfer = permissions.has("support.transfer") && canControl;
  const canEscalate = permissions.has("support.escalate") && canControl;
  const canClaim =
    permissions.has("support.claim") &&
    !ticket.assignedOperatorId &&
    ["new", "waiting_support", "escalated"].includes(ticket.status);
  const canReopen =
    (canReply || canManage) &&
    (ticket.status === "resolved" || ticket.status === "closed");
  const replyAvailable =
    canControl && !["closed", "spam"].includes(ticket.status);
  const activeOperators = useMemo(
    () => operators.filter((operator) => operator.id !== currentUserId),
    [currentUserId, operators],
  );

  const executeAction = async () => {
    if (!action) return;
    if (action === "transfer" && !operatorId) return;
    if (comment.trim().length < 3) return;
    const succeeded = await onAction(action, {
      comment,
      operatorId,
      urgent,
    });
    if (succeeded) {
      setAction(null);
      setComment("");
      setOperatorId("");
      setUrgent(false);
    }
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--kub-bg)]">
      <header className="flex flex-shrink-0 items-start gap-3 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-3 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Назад к очереди"
          className="mt-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-cyan)] hover:bg-[var(--kub-surface-2)] md:hidden"
        >
          <KubIcon name="back" size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 truncate text-base font-bold text-[color:var(--kub-text)]">
              {ticket.subject}
            </h2>
            {ticket.urgent ? <KubBadge tone="danger">Срочно</KubBadge> : null}
            <KubBadge tone={ticket.status === "escalated" ? "danger" : "cyan"}>
              {statusLabel(ticket.status)}
            </KubBadge>
          </div>
          <p className="mt-1 text-xs text-[color:var(--kub-muted)]">
            {ticket.publicReference} · обновлено {formatDateTime(ticket.lastActivityAt)}
          </p>
        </div>
        {canClaim ? (
          <KubButton
            type="button"
            size="sm"
            loading={busyAction === "claim"}
            onClick={() => void onAction("claim")}
          >
            Принять
          </KubButton>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SupportConversation
          conversationKey={ticket.id}
          messages={details.messages}
          canReply={canReply}
          replyAvailable={replyAvailable}
          busy={busyAction === "reply"}
          onReply={onReply}
        />

        <aside className="min-h-0 overflow-y-auto border-t border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-3 lg:border-l lg:border-t-0">
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-[color:var(--kub-muted)]">
              Контакт
            </h3>
            {details.contact ? (
              <div className="mt-2 space-y-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-3 text-sm">
                <p className="font-semibold text-[color:var(--kub-text)]">{details.contact.contactName}</p>
                <p className="break-all text-[color:var(--kub-text)]">{details.contact.email}</p>
                <p className="text-[color:var(--kub-text)]">{details.contact.phone}</p>
                <p className="text-[11px] text-[color:var(--kub-muted)]">
                  Эл. почта и телефон предоставлены клиентом и не подтверждены.
                </p>
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-dashed border-[color:var(--kub-border-color)] p-3">
                <p className="text-sm font-semibold text-[color:var(--kub-text)]">
                  Контакт скрыт до принятия
                </p>
                <p className="mt-1 text-xs text-[color:var(--kub-muted)]">
                  Имя, эл. почта и телефон станут доступны назначенному оператору.
                </p>
              </div>
            )}
          </section>

          <section className="mt-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[color:var(--kub-muted)]">
              Действия
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {canReply && canControl && !["resolved", "closed", "spam"].includes(ticket.status) ? (
                <>
                  <KubButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void onAction("waiting_user")}
                  >
                    Ждём клиента
                  </KubButton>
                  <KubButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void onAction("waiting_support")}
                  >
                    Ждём поддержку
                  </KubButton>
                  <KubButton type="button" size="sm" onClick={() => setAction("resolve")}>
                    Решить
                  </KubButton>
                  <KubButton type="button" size="sm" variant="danger" onClick={() => setAction("close")}>
                    Закрыть
                  </KubButton>
                </>
              ) : null}
              {canTransfer ? (
                <>
                  <KubButton type="button" size="sm" variant="secondary" onClick={() => setAction("transfer")}>
                    Передать
                  </KubButton>
                  <KubButton type="button" size="sm" variant="secondary" onClick={() => setAction("return")}>
                    Вернуть в пул
                  </KubButton>
                </>
              ) : null}
              {canEscalate ? (
                <KubButton
                  type="button"
                  size="sm"
                  variant="accent"
                  className="col-span-2"
                  onClick={() => setAction("escalate")}
                >
                  Передать старшему
                </KubButton>
              ) : null}
              {canReopen ? (
                <KubButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="col-span-2"
                  loading={busyAction === "reopen"}
                  onClick={() => void onAction("reopen")}
                >
                  Открыть заново
                </KubButton>
              ) : null}
            </div>

            {action ? (
              <div className="mt-3 rounded-lg border border-[color:var(--kub-cyan)]/30 bg-[var(--kub-surface-2)] p-3">
                <p className="text-sm font-semibold text-[color:var(--kub-text)]">
                  {actionTitle(action)}
                </p>
                {action === "transfer" ? (
                  <label className="mt-2 block">
                    <span className="text-xs text-[color:var(--kub-muted)]">Оператор</span>
                    <select
                      value={operatorId}
                      onChange={(event) => setOperatorId(event.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-2 text-sm text-[color:var(--kub-text)]"
                    >
                      <option value="">Выберите коллегу</option>
                      {activeOperators.map((operator) => (
                        <option key={operator.id} value={operator.id}>
                          {operator.fullName}
                          {operator.username ? ` (@${operator.username})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="mt-2 block">
                  <span className="text-xs text-[color:var(--kub-muted)]">
                    {action === "resolve" || action === "close" ? "Итог" : "Причина"}
                  </span>
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    rows={3}
                    maxLength={4_000}
                    className="mt-1 w-full resize-y rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-2 py-2 text-sm text-[color:var(--kub-text)]"
                  />
                </label>
                {action === "return" ? (
                  <label className="mt-2 flex items-center gap-2 text-xs text-[color:var(--kub-text)]">
                    <input
                      type="checkbox"
                      checked={urgent}
                      onChange={(event) => setUrgent(event.target.checked)}
                    />
                    Срочно нужен оператор
                  </label>
                ) : null}
                <div className="mt-3 flex justify-end gap-2">
                  <KubButton type="button" size="sm" variant="ghost" onClick={() => setAction(null)}>
                    Отмена
                  </KubButton>
                  <KubButton
                    type="button"
                    size="sm"
                    loading={busyAction === action}
                    disabled={comment.trim().length < 3 || (action === "transfer" && !operatorId)}
                    onClick={() => void executeAction()}
                  >
                    Подтвердить
                  </KubButton>
                </div>
              </div>
            ) : null}
          </section>

          {permissions.has("support.lookup_customer") ? (
            <section className="mt-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[color:var(--kub-muted)]">
                Найти клиента
              </h3>
              <p className="mt-1 text-[11px] text-[color:var(--kub-warn)]">
                Поиск клиента фиксируется в журнале.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={lookupQuery}
                  onChange={(event) => setLookupQuery(event.target.value)}
                  placeholder="Телефон, эл. почта или @ник"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-2 text-xs text-[color:var(--kub-text)]"
                />
                <KubButton
                  type="button"
                  size="icon"
                  variant="secondary"
                  aria-label="Найти клиента"
                  disabled={lookupQuery.trim().length < 3}
                  onClick={() => void onLookupCustomer(lookupQuery)}
                >
                  <KubIcon name="search" size={15} />
                </KubButton>
              </div>
              {customerCandidates.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {customerCandidates.map((candidate) => (
                    <div
                      key={candidate.userId}
                      className="rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-2 text-xs"
                    >
                      <p className="font-semibold text-[color:var(--kub-text)]">
                        {candidate.fullName ?? "Пользователь"}
                      </p>
                      <p className="mt-1 text-[color:var(--kub-muted)]">
                        {candidate.username ? `@${candidate.username} · ` : ""}
                        {candidate.emailMasked} · {candidate.phoneMasked}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="mt-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[color:var(--kub-muted)]">
              История действий
            </h3>
            <ol className="mt-2 space-y-2">
              {details.events.map((event) => (
                <li
                  key={event.id}
                  className="border-l-2 border-[color:var(--kub-border-color)] pl-3 text-xs"
                >
                  <p className="font-semibold text-[color:var(--kub-text)]">
                    {eventLabel(event.eventType)}
                  </p>
                  <p className="mt-0.5 text-[color:var(--kub-muted)]">
                    {formatDateTime(event.createdAt)}
                  </p>
                  {eventSummary(event.payload) ? (
                    <p className="mt-1 break-words text-[color:var(--kub-muted)]">
                      {eventSummary(event.payload)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </section>
  );
}

function statusLabel(status: SupportTicketDetailsModel["ticket"]["status"]): string {
  const labels: Record<SupportTicketDetailsModel["ticket"]["status"], string> = {
    new: "Новое",
    in_progress: "В работе",
    waiting_user: "Ожидает клиента",
    waiting_support: "Ожидает поддержки",
    escalated: "Передано старшему",
    resolved: "Решено",
    closed: "Закрыто",
    spam: "Спам",
  };
  return labels[status];
}

type SupportActionEditor = "transfer" | "return" | "escalate" | "resolve" | "close";

function actionTitle(action: SupportActionEditor): string {
  const titles = {
    transfer: "Передать коллеге",
    return: "Вернуть в общий пул",
    escalate: "Передать старшему",
    resolve: "Завершить обращение",
    close: "Закрыть обращение",
  };
  return titles[action];
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    ticket_created: "Обращение создано",
    claimed: "Обращение принято",
    transferred: "Передано коллеге",
    returned_to_pool: "Возвращено в общий пул",
    escalated: "Передано старшему",
    requester_message: "Ответ клиента",
    operator_message: "Ответ оператора",
    waiting_user: "Ожидается ответ клиента",
    waiting_support: "Ожидается ответ поддержки",
    resolved: "Обращение решено",
    closed: "Обращение закрыто",
    reopened: "Обращение открыто заново",
    customer_lookup: "Выполнен поиск клиента",
  };
  return labels[eventType] ?? "Служебное изменение";
}

function eventSummary(payload: Record<string, unknown>): string | null {
  for (const key of ["reason", "comment", "summary"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 500);
  }
  return null;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
