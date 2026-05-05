import type {
  TaskAssignmentScope,
  TaskEventKind,
  TaskPriority,
  TaskStatus,
  TaskVisibility,
} from "@/types/database";

type Tone = "cyan" | "pink" | "muted" | "online" | "danger" | "warn";

interface StatusMeta {
  label: string;
  tone: Tone;
}
interface PriorityMeta {
  label: string;
  tone: Tone;
}
interface VisibilityMeta {
  label: string;
  tone: Tone;
}
interface AssignmentScopeMeta {
  label: string;
  tone: Tone;
}

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  new:                  { label: "Новая",            tone: "muted"  },
  assigned:             { label: "Назначена",        tone: "cyan"   },
  accepted:             { label: "Принята",          tone: "cyan"   },
  in_progress:          { label: "В работе",         tone: "pink"   },
  waiting_confirmation: { label: "На подтверждении", tone: "warn"   },
  confirmed:            { label: "Подтверждена",     tone: "online" },
  rejected:             { label: "Отклонена",        tone: "danger" },
  cancelled:            { label: "Отменена",         tone: "muted"  },
};

export const TASK_PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  low:    { label: "Низкий",   tone: "muted"  },
  normal: { label: "Обычный",  tone: "cyan"   },
  high:   { label: "Высокий",  tone: "warn"   },
  urgent: { label: "Срочный",  tone: "danger" },
};

export const TASK_VISIBILITY_META: Record<TaskVisibility, VisibilityMeta> = {
  staff:   { label: "Для сотрудников", tone: "cyan"  },
  private: { label: "Приватная",       tone: "pink"  },
  chat:    { label: "Чат",             tone: "muted" },
};

export const TASK_ASSIGNMENT_SCOPE_META: Record<TaskAssignmentScope, AssignmentScopeMeta> = {
  user:         { label: "Назначена пользователю", tone: "muted" },
  manager_pool: { label: "Пул менеджеров",         tone: "warn"  },
  staff_pool:   { label: "Пул сотрудников",        tone: "cyan"  },
};

export const TASK_EVENT_LABEL: Record<TaskEventKind, string> = {
  create:                "создал(а) задачу",
  assign:                "назначил(а) исполнителя",
  accept:                "принял(а) задачу",
  start:                 "взял(а) в работу",
  send_for_confirmation: "отправил(а) на подтверждение",
  confirm:               "подтвердил(а) выполнение",
  reject:                "отклонил(а) выполнение",
  cancel:                "отменил(а) задачу",
  comment:               "оставил(а) комментарий",
  update:                "изменил(а) задачу",
  return_to_work:        "вернул(а) задачу в работу",
};

export const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

/** Human-friendly Russian relative date used inside cards/event log. */
export function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.round((d.getTime() - now) / 1000); // seconds, signed
  const abs = Math.abs(diff);
  const fmt = (n: number, unit: string) => `${n} ${unit}`;
  if (abs < 60) return diff < 0 ? "только что" : "через несколько секунд";
  const m = Math.round(abs / 60);
  if (abs < 3600) return diff < 0 ? `${fmt(m, "мин назад")}` : `через ${fmt(m, "мин")}`;
  const h = Math.round(abs / 3600);
  if (abs < 86400) return diff < 0 ? `${fmt(h, "ч назад")}` : `через ${fmt(h, "ч")}`;
  const days = Math.round(abs / 86400);
  if (abs < 7 * 86400) return diff < 0 ? `${fmt(days, "дн назад")}` : `через ${fmt(days, "дн")}`;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}
