import { mapPgError } from "@/lib/errors";
import type { AppRole, DynamicRole, Permission, RoleScope } from "@/types/database";

export const ROLES_PERMISSIONS_REQUIRED_MESSAGE = "Роли и права требуют обновления базы данных.";
export const ROLES_PERMISSIONS_STORAGE_KEY = "kub.dynamicRoles.enabled";
export const ROLES_PERMISSIONS_STORAGE_EVENT = "kub:dynamic-roles-storage";

export const ROLE_SCOPE_LABEL: Record<RoleScope, string> = {
  global: "Глобальная",
  location: "Локация",
  chat: "Чат",
};

export const LEGACY_APP_ROLE_LABEL: Record<AppRole, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  user: "Пользователь",
};

export const SYSTEM_ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  tech_admin: "Тех. администратор",
  admin: "Администратор",
  manager: "Менеджер",
  user: "Пользователь",
  location_owner: "Владелец клуба",
  location_admin: "Администратор клуба",
  location_manager: "Менеджер клуба",
  location_staff: "Работник клуба",
  location_client: "Клиент клуба",
  chat_owner: "Владелец чата",
  chat_admin: "Администратор чата",
  chat_member: "Участник",
};

export const PERMISSION_CATEGORY_LABEL: Record<string, string> = {
  system: "Система",
  users: "Пользователи",
  locations: "Локации",
  tasks: "Задачи",
  chats: "Чаты",
  media: "Медиа",
  folders: "Папки",
};

export const PERMISSION_LABEL: Record<string, string> = {
  "system.manage": "Управление системой",
  "roles.view": "Просмотр ролей",
  "roles.manage": "Управление ролями",
  "permissions.manage": "Управление правами",
  "audit.view": "Просмотр аудита",
  "users.view": "Просмотр пользователей",
  "users.manage": "Управление пользователями",
  "users.assign_roles": "Назначение ролей",
  "locations.view": "Просмотр локаций",
  "locations.manage": "Управление локациями",
  "location_members.view": "Просмотр сотрудников локаций",
  "location_members.manage": "Управление сотрудниками локаций",
  "tasks.view": "Просмотр задач",
  "tasks.create": "Создание задач",
  "tasks.assign": "Назначение задач",
  "tasks.manage": "Управление задачами",
  "tasks.view_admin_tasks": "Просмотр задач администраторов",
  "tasks.manage_admin_tasks": "Управление задачами администраторов",
  "tasks.view_all_locations": "Просмотр задач всех локаций",
  "tasks.manage_all_locations": "Управление задачами всех локаций",
  "chats.invite": "Приглашение в чаты",
  "chats.invite_any": "Приглашение вне политики чата",
  "chats.manage_invites": "Управление приглашениями",
  "chats.moderate": "Модерация чатов",
  "chats.manage_roles": "Управление ролями чата",
  "media.moderate": "Модерация медиа",
  "folders.manage_shared": "Управление общими папками",
};

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

export function getRoleLabel(role: Pick<DynamicRole, "key" | "name"> | string | null | undefined): string {
  if (!role) return "Роль";
  if (typeof role === "string") return SYSTEM_ROLE_LABEL[role] ?? role;
  return role.name?.trim() || SYSTEM_ROLE_LABEL[role.key] || role.key;
}

export function getPermissionLabel(permission: Pick<Permission, "key" | "name"> | string): string {
  if (typeof permission === "string") return PERMISSION_LABEL[permission] ?? permission;
  return permission.name?.trim() || PERMISSION_LABEL[permission.key] || permission.key;
}

export function isRolesPermissionsMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as ErrorLike;
  const code = typeof err.code === "string" ? err.code.toUpperCase() : "";
  const text = [err.message, err.details, err.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (
    code === "42P01" ||
    code === "42703" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "PGRST205"
  ) {
    return (
      text.includes("roles") ||
      text.includes("permissions") ||
      text.includes("role_permissions") ||
      text.includes("user_global_roles") ||
      text.includes("role_create") ||
      text.includes("role_update") ||
      text.includes("user_assign_global_role") ||
      text.includes("has_permission")
    );
  }

  return false;
}

export function mapRolesPermissionsError(error: unknown, fallback = "Не удалось выполнить действие. Попробуйте ещё раз."): string {
  if (isRolesPermissionsMissingError(error)) return ROLES_PERMISSIONS_REQUIRED_MESSAGE;
  const details = readErrorDetails(error);
  const text = `${details.code} ${details.message} ${details.details}`.toLowerCase();

  if (text.includes("last_owner") || text.includes("last_tech_admin")) {
    return "Нельзя снять последний доступ владельца или тех. администратора.";
  }
  if (text.includes("system_role_protected") || text.includes("system role")) {
    return "Нельзя удалить системную роль.";
  }
  if (text.includes("already") || text.includes("duplicate") || text.includes("unique")) {
    return "Пользователь уже имеет эту роль.";
  }
  if (text.includes("permission") || text.includes("42501") || text.includes("insufficient")) {
    return "Недостаточно прав.";
  }
  if (text.includes("role_not_found")) return "Роль недоступна.";
  if (text.includes("role_in_use")) return "Эта роль используется.";
  if (text.includes("invalid_scope")) return "Некорректная область роли.";
  if (text.includes("invalid_permission")) return "Одно из прав недоступно.";

  const mapped = mapPgError(error);
  if (!mapped || mapped === "Неизвестная ошибка") return fallback;
  if (mapped.includes("PGRST") || mapped.includes("function") || mapped.includes("constraint")) return fallback;
  return mapped;
}

export function getRolesPermissionsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ROLES_PERMISSIONS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setRolesPermissionsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(ROLES_PERMISSIONS_STORAGE_KEY, "1");
    else window.localStorage.removeItem(ROLES_PERMISSIONS_STORAGE_KEY);
    window.dispatchEvent(new Event(ROLES_PERMISSIONS_STORAGE_EVENT));
  } catch {
    // LocalStorage may be unavailable in hardened browser contexts.
  }
}

function readErrorDetails(error: unknown): { code: string; message: string; details: string } {
  if (!error || typeof error !== "object") return { code: "", message: "", details: "" };
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : "",
    message: typeof record.message === "string" ? record.message : "",
    details: typeof record.details === "string" ? record.details : "",
  };
}
