type NotificationLike = {
  kind: string;
  payload: unknown;
};

export type SupportNotificationTarget =
  | { kind: "operator"; route: string }
  | { kind: "requester"; route: "/support" };

export type SupportNotificationDisplay = {
  title: string;
  body: string;
  typeLabel: "Поддержка";
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUPPORT_EVENT_COPY: Record<string, Omit<SupportNotificationDisplay, "typeLabel">> = {
  ticket_created: {
    title: "Новое обращение",
    body: "В очереди поддержки появилось новое обращение.",
  },
  returned_to_pool: {
    title: "Обращение возвращено",
    body: "Обращение возвращено в общую очередь.",
  },
  escalated: {
    title: "Обращение эскалировано",
    body: "Обращение передано старшему оператору.",
  },
  claimed: {
    title: "Обращение принято",
    body: "Обращение закреплено за оператором.",
  },
  transferred: {
    title: "Обращение передано",
    body: "Обращение передано другому оператору.",
  },
  requester_message: {
    title: "Новый ответ пользователя",
    body: "В закреплённом обращении появилось новое сообщение.",
  },
  operator_message: {
    title: "Ответ поддержки",
    body: "Оператор поддержки отправил новый ответ.",
  },
  resolved: {
    title: "Обращение решено",
    body: "Обращение отмечено как решённое.",
  },
  closed: {
    title: "Обращение закрыто",
    body: "Работа по обращению завершена.",
  },
};

const REQUESTER_EVENTS = new Set(["operator_message", "resolved", "closed"]);

export function isSupportNotification(
  notification: Pick<NotificationLike, "kind">,
): boolean {
  return notification.kind.startsWith("support_");
}

export function supportNotificationTarget(
  payload: unknown,
  canViewSupport: boolean,
): SupportNotificationTarget | null {
  const ticketId = payloadString(payload, "ticket_id");
  if (!ticketId || !UUID_PATTERN.test(ticketId)) return null;
  return canViewSupport
    ? {
        kind: "operator",
        route: `/admin/support?ticket=${encodeURIComponent(ticketId)}`,
      }
    : { kind: "requester", route: "/support" };
}

export function supportNotificationTargetsRequester(
  notification: NotificationLike,
): boolean {
  return REQUESTER_EVENTS.has(supportEvent(notification));
}

export function formatSupportNotification(
  notification: NotificationLike,
): SupportNotificationDisplay {
  const event = supportEvent(notification);
  const copy = SUPPORT_EVENT_COPY[event] ?? {
    title: "Обновление обращения",
    body: "Статус обращения в поддержку изменился.",
  };
  return { ...copy, typeLabel: "Поддержка" };
}

function supportEvent(notification: NotificationLike): string {
  return (
    payloadString(notification.payload, "support_event") ??
    notification.kind.slice("support_".length)
  );
}

function payloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
