import type { AuditAction, AuditLogWithActor, Json, Profile } from "@/types/database";

export interface RegistrationPoint {
  date: string;
  label: string;
  value: number;
}

export const ADMIN_AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  role_change: "Смена роли",
  ban_issued: "Выдан бан",
  ban_lifted: "Снят бан",
  mute_issued: "Выдан мьют",
  mute_lifted: "Снят мьют",
  chat_member_added: "Добавлен участник",
  chat_member_role_changed: "Изменена роль участника",
  chat_member_removed: "Удалён участник",
  folder_deleted: "Удалена папка",
  task_status_change: "Смена статуса задачи",
  message_deleted_by_staff: "Удалено сообщение",
  registration_invite_created: "Инвайт создан",
  registration_invite_revoked: "Инвайт отозван",
  registration_invite_consumed: "Инвайт использован",
  registration_invite_mode_updated: "Режим регистрации",
};

const ROLE_RU: Record<string, string> = {
  admin: "администратора",
  manager: "менеджера",
  user: "пользователя",
};

const CHAT_ROLE_RU: Record<string, string> = {
  owner: "владельца",
  admin: "администратора",
  member: "участника",
};

const TASK_STATUS_RU: Record<string, string> = {
  new: "новая",
  assigned: "назначена",
  accepted: "принята",
  in_progress: "в работе",
  waiting_confirmation: "ждёт подтверждения",
  confirmed: "подтверждена",
  rejected: "отклонена",
  cancelled: "отменена",
};

export function buildRegistrationSeries(
  rows: ReadonlyArray<{ created_at: string }>,
  now = new Date(),
  days = 7,
): RegistrationPoint[] {
  const safeDays = Math.max(1, Math.min(31, Math.trunc(days) || 7));
  const end = startOfLocalDay(now);
  const counts = new Map<string, number>();

  for (const row of rows) {
    const createdAt = new Date(row.created_at);
    if (Number.isNaN(createdAt.getTime())) continue;
    const key = localDateKey(createdAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from({ length: safeDays }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (safeDays - index - 1));
    const key = localDateKey(date);
    return {
      date: key,
      label: new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date),
      value: counts.get(key) ?? 0,
    };
  });
}

export function formatAdminDateTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "Дата не указана";
  return value.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAdminActorName(profile?: Profile | null): string {
  if (!profile) return "Система";
  return profile.full_name ?? (profile.username ? `@${profile.username}` : "Администратор");
}

export function formatAdminProfileName(profile?: Profile | null): string {
  if (!profile) return "пользователю";
  return profile.full_name ?? (profile.username ? `@${profile.username}` : "пользователю");
}

export function formatAdminAuditEvent(row: AuditLogWithActor): string {
  const payload = asRecord(row.diff);
  const get = (key: string) => payload?.[key] ?? null;
  const actor = formatAdminActorName(row.actor);
  const target = formatAdminProfileName(row.targetProfile);

  switch (row.action as AuditAction) {
    case "role_change": {
      const from = ROLE_RU[String(get("from") ?? "")] ?? "предыдущей";
      const to = ROLE_RU[String(get("to") ?? "")] ?? "новой";
      return `${actor} изменил роль с ${from} на ${to}`;
    }
    case "ban_issued": {
      const reason = jsonString(row.diff, "reason");
      return reason ? `${actor} выдал бан ${target} · «${reason}»` : `${actor} выдал бан ${target}`;
    }
    case "ban_lifted":
      return `${actor} снял бан с ${target}`;
    case "mute_issued": {
      const reason = jsonString(row.diff, "reason");
      const chat = row.targetChat?.name ?? null;
      const scope = chat ? ` в чате «${chat}»` : "";
      return reason
        ? `${actor} выдал мьют ${target}${scope} · «${reason}»`
        : `${actor} выдал мьют ${target}${scope}`;
    }
    case "mute_lifted":
      return `${actor} снял мьют с ${target}`;
    case "chat_member_added":
      return `${actor} добавил участника`;
    case "chat_member_role_changed": {
      const from = CHAT_ROLE_RU[String(get("from") ?? "")] ?? "предыдущей";
      const to = CHAT_ROLE_RU[String(get("to") ?? "")] ?? "новой";
      return `${actor} изменил роль участника с ${from} на ${to}`;
    }
    case "chat_member_removed":
      return `${actor} удалил участника`;
    case "folder_deleted": {
      const name = jsonString(row.diff, "name") ?? "без названия";
      const scope = String(get("scope") ?? "");
      const scopeRu = scope === "shared" ? "общую" : scope === "system" ? "системную" : "";
      return `${actor} удалил ${scopeRu ? `${scopeRu} ` : ""}папку «${name}»`;
    }
    case "task_status_change": {
      const from = TASK_STATUS_RU[String(get("from") ?? "")] ?? "предыдущий статус";
      const to = TASK_STATUS_RU[String(get("to") ?? "")] ?? "новый статус";
      const title = jsonString(row.diff, "title");
      return title
        ? `${actor} перевёл задачу «${title}»: ${from} → ${to}`
        : `${actor} сменил статус задачи: ${from} → ${to}`;
    }
    case "message_deleted_by_staff":
      return `${actor} удалил чужое сообщение`;
    case "registration_invite_created":
      return `${actor} создал регистрационный инвайт`;
    case "registration_invite_revoked":
      return `${actor} отозвал регистрационный инвайт`;
    case "registration_invite_consumed":
      return "Регистрационный инвайт был использован";
    case "registration_invite_mode_updated": {
      const enabled = get("invite_only_enabled");
      if (enabled === true) return row.actor ? `${actor} ограничил регистрацию приглашениями` : "Регистрация ограничена приглашениями";
      if (enabled === false) return row.actor ? `${actor} открыл регистрацию` : "Открыта свободная регистрация";
      return row.actor ? `${actor} изменил режим регистрации` : "Изменён режим регистрации";
    }
    default:
      return "Системное событие";
  }
}

function startOfLocalDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function asRecord(value: Json | null | undefined): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function jsonString(payload: Json | null | undefined, key: string): string | null {
  const value = asRecord(payload)?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
