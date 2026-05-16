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

export const ROLE_SCOPE_DESCRIPTION: Record<RoleScope, string> = {
  global: "Глобальная роль действует во всем приложении: пользователи, задачи, клубы, чаты и админ-разделы.",
  location: "Роль в локации действует только внутри выбранного клуба и не дает доступ ко всем клубам.",
  chat: "Роль в чате действует только внутри конкретного группового чата.",
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
  users: "Пользователи",
  roles: "Роли и права",
  locations: "Локации",
  tasks: "Задачи",
  chats: "Чаты и приглашения",
  security: "Аудит / безопасность",
  system: "Система",
  media: "Система",
  folders: "Система",
};

export const PERMISSION_CATEGORY_DESCRIPTION: Record<string, string> = {
  users: "Просмотр пользователей, карточки профилей и управление аккаунтами.",
  roles: "Создание ролей, назначение ролей пользователям и настройка набора прав.",
  locations: "Клубы, сотрудники локаций и основной администратор работника.",
  tasks: "Создание, назначение и маршрутизация задач по клубам.",
  chats: "Приглашения, модерация и роли в групповых чатах.",
  security: "Журнал действий и контроль чувствительных операций.",
  system: "Технические настройки, общие папки и служебные действия.",
};

export const PERMISSION_CATEGORY_ORDER = ["users", "roles", "locations", "tasks", "chats", "security", "system"];

const PERMISSION_CATEGORY_BY_KEY: Record<string, string> = {
  "roles.view": "roles",
  "roles.manage": "roles",
  "permissions.manage": "roles",
  "users.assign_roles": "roles",
  "audit.view": "security",
  "system.manage": "system",
  "folders.manage_shared": "system",
  "media.moderate": "system",
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
  "tasks.delete": "Удаление задач",
  "tasks.restore": "Восстановление задач",
  "tasks.bulk_delete": "Массовое удаление задач",
  "chats.invite": "Приглашение в чаты",
  "chats.invite_any": "Приглашение в любые чаты",
  "chats.manage_invites": "Управление приглашениями",
  "chats.moderate": "Модерация чатов",
  "chats.manage_roles": "Управление ролями чата",
  "media.moderate": "Модерация медиа",
  "folders.manage_shared": "Управление общими папками",
};

export const PERMISSION_DESCRIPTION: Record<string, string> = {
  "system.manage": "Технические настройки и аварийное обслуживание.",
  "roles.view": "Открывать раздел ролей и видеть назначенные права.",
  "roles.manage": "Создавать и редактировать роли.",
  "permissions.manage": "Менять набор прав у ролей.",
  "audit.view": "Смотреть журнал действий и расследовать изменения.",
  "users.view": "Видеть список пользователей и карточки профилей.",
  "users.manage": "Управлять пользователями, блокировками и ограничениями.",
  "users.assign_roles": "Назначать глобальные и клубные роли пользователям.",
  "locations.view": "Видеть доступные клубы и назначения.",
  "locations.manage": "Создавать и редактировать клубы.",
  "location_members.view": "Видеть сотрудников и администраторов клубов.",
  "location_members.manage": "Назначать сотрудников, роли и основного администратора.",
  "tasks.view": "Видеть задачи в доступной области.",
  "tasks.create": "Создавать задачи в доступной области.",
  "tasks.assign": "Назначать задачи пользователям или пулам.",
  "tasks.manage": "Редактировать и администрировать задачи.",
  "tasks.view_admin_tasks": "Видеть задачи, созданные для администраторов.",
  "tasks.manage_admin_tasks": "Создавать и менять задачи для администраторов.",
  "tasks.view_all_locations": "Видеть задачи всех клубов.",
  "tasks.manage_all_locations": "Управлять задачами всех клубов.",
  "tasks.delete": "Скрывать ненужные задачи из обычных списков с сохранением истории.",
  "tasks.restore": "Возвращать ошибочно удалённые задачи в рабочие списки.",
  "tasks.bulk_delete": "Удалять несколько задач за одно действие.",
  "chats.invite": "Приглашать пользователей там, где политика чата это разрешает.",
  "chats.invite_any": "Приглашать пользователей в любые групповые чаты независимо от политики.",
  "chats.manage_invites": "Отменять приглашения и управлять историей приглашений.",
  "chats.moderate": "Модерировать групповые чаты.",
  "chats.manage_roles": "Повышать и понижать роли участников чата.",
  "media.moderate": "Модерировать пользовательские вложения.",
  "folders.manage_shared": "Управлять общими папками.",
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

export function getPermissionDescription(permission: Pick<Permission, "key" | "description"> | string): string {
  if (typeof permission === "string") return PERMISSION_DESCRIPTION[permission] ?? "";
  return permission.description?.trim() || PERMISSION_DESCRIPTION[permission.key] || "";
}

export function getPermissionCategory(permission: Pick<Permission, "key" | "category"> | string): string {
  const key = typeof permission === "string" ? permission : permission.key;
  const category = typeof permission === "string" ? null : permission.category;
  return PERMISSION_CATEGORY_BY_KEY[key] ?? normalizePermissionCategory(category);
}

export function getPermissionCategoryLabel(category: string): string {
  return PERMISSION_CATEGORY_LABEL[category] ?? category;
}

export function getRoleScopeDescription(scope: RoleScope): string {
  return ROLE_SCOPE_DESCRIPTION[scope];
}

export function isCriticalRoleKey(key: string | null | undefined): boolean {
  return key === "owner" || key === "tech_admin";
}

function normalizePermissionCategory(category: string | null | undefined): string {
  if (category === "users" || category === "locations" || category === "tasks" || category === "chats") return category;
  if (category === "system") return "system";
  return "system";
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

export function isRolesPermissionsPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as ErrorLike;
  const code = typeof err.code === "string" ? err.code.toUpperCase() : "";
  const text = [err.message, err.details, err.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return code === "42501" || code === "PGRST301" || text.includes("permission denied") || text.includes("insufficient");
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
  if (isRolesPermissionsPermissionError(error) || text.includes("permission") || text.includes("42501") || text.includes("insufficient")) {
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
  if (typeof window === "undefined") return true;
  try {
    const value = window.localStorage.getItem(ROLES_PERMISSIONS_STORAGE_KEY);
    return value !== "0";
  } catch {
    return true;
  }
}

export function hasRolesPermissionsPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ROLES_PERMISSIONS_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function setRolesPermissionsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(ROLES_PERMISSIONS_STORAGE_KEY, "1");
    else window.localStorage.setItem(ROLES_PERMISSIONS_STORAGE_KEY, "0");
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
