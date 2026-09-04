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
  global: "Глобальная роль действует во всем приложении: пользователи, задачи, локации, чаты и админ-разделы.",
  location: "Роль в локации действует только внутри выбранной локации и не даёт доступ ко всем локациям.",
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
  location_owner: "Владелец локации",
  location_admin: "Администратор локации",
  location_manager: "Менеджер локации",
  location_staff: "Сотрудник локации",
  location_client: "Участник локации",
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
  support: "Поддержка",
  security: "Аудит / безопасность",
  system: "Система",
  media: "Система",
  folders: "Система",
};

export const PERMISSION_CATEGORY_DESCRIPTION: Record<string, string> = {
  users: "Просмотр пользователей, карточки профилей и управление аккаунтами.",
  roles: "Создание ролей, назначение ролей пользователям и настройка набора прав.",
  locations: "Локации, их сотрудники и основной администратор работника.",
  tasks: "Создание, назначение и маршрутизация задач по локациям.",
  chats: "Приглашения, модерация и роли в групповых чатах.",
  support: "Приём обращений, ответы, передача, эскалация и настройки службы поддержки.",
  security: "Журнал действий и контроль чувствительных операций.",
  system: "Технические настройки, общие папки и служебные действия.",
};

export const PERMISSION_CATEGORY_ORDER = ["users", "roles", "locations", "tasks", "chats", "support", "security", "system"];

const PERMISSION_CATEGORY_BY_KEY: Record<string, string> = {
  "roles.view": "roles",
  "roles.manage": "roles",
  "permissions.manage": "roles",
  "users.assign_roles": "roles",
  "audit.view": "security",
  "system.manage": "system",
  "folders.manage_shared": "system",
  "media.moderate": "system",
  "support.view": "support",
  "support.claim": "support",
  "support.reply": "support",
  "support.transfer": "support",
  "support.escalate": "support",
  "support.lookup_customer": "support",
  "support.manage": "support",
  "support.settings": "support",
};

/**
 * Что человек с этим правом сможет делать — глаголом, а не названием раздела.
 *
 * Раньше здесь стояли отглагольные существительные, зеркалившие ключ:
 * `roles.view` -> «Просмотр ролей», `system.manage` -> «Управление системой».
 * Это читается как список таблиц, а не как ответ на вопрос «что изменится,
 * если я поставлю галочку». Владелец так и сказал: правила должны быть
 * расписаны корректно, а не технически.
 *
 * Двух прав здесь не было вовсе — `bots.suspend` и `tasks.claim` выводились
 * в панели голым ключом.
 */
export const PERMISSION_LABEL: Record<string, string> = {
  "system.manage": "Менять технические настройки",
  "roles.view": "Видеть роли и их права",
  "roles.manage": "Создавать и менять роли",
  "permissions.manage": "Менять набор прав у роли",
  "audit.view": "Читать журнал действий",
  "users.view": "Видеть пользователей",
  "users.manage": "Блокировать и ограничивать пользователей",
  "users.assign_roles": "Выдавать роли людям",
  "locations.view": "Видеть локации",
  "locations.manage": "Создавать и менять локации",
  "location_members.view": "Видеть состав локаций",
  "location_members.manage": "Менять состав локаций",
  "tasks.view": "Видеть задачи своей области",
  "tasks.view_all_locations": "Видеть задачи всех локаций",
  "tasks.view_admin_tasks": "Видеть задачи администраторов",
  "tasks.create": "Создавать задачи",
  "tasks.claim": "Брать задачу себе",
  "tasks.assign": "Назначать задачи другим",
  "tasks.manage": "Менять и закрывать задачи",
  "tasks.manage_all_locations": "Менять задачи всех локаций",
  "tasks.manage_admin_tasks": "Менять задачи администраторов",
  "tasks.delete": "Удалять задачи",
  "tasks.bulk_delete": "Удалять задачи пачкой",
  "tasks.restore": "Возвращать удалённые задачи",
  "chats.invite": "Звать людей в чаты",
  "chats.invite_any": "Звать в любой чат, минуя его правила",
  "chats.manage_invites": "Отзывать и перевыпускать приглашения",
  "chats.manage_roles": "Менять роли участников чата",
  "chats.moderate": "Модерировать чаты",
  "media.moderate": "Снимать чужие вложения",
  "folders.manage_shared": "Вести общие папки",
  "bots.suspend": "Останавливать ботов",
  "support.view": "Видеть обращения в поддержку",
  "support.claim": "Брать обращение в работу",
  "support.reply": "Отвечать в обращениях",
  "support.transfer": "Передавать обращение другому",
  "support.escalate": "Поднимать обращение выше",
  "support.lookup_customer": "Смотреть карточку обратившегося",
  "support.manage": "Управлять очередью поддержки",
  "support.settings": "Менять настройки поддержки",
};

/**
 * Где право заканчивается или чего оно стоит.
 *
 * Описание не повторяет подпись: оно добавляет границу, из-за которой
 * администратор и решает, ставить галочку или нет — что право обходит, что
 * оставляет нетронутым, и где ошибка обойдётся дороже обычного.
 */
export const PERMISSION_DESCRIPTION: Record<string, string> = {
  "system.manage": "Самое широкое право: технические настройки и аварийное обслуживание, влияющие на весь мессенджер.",
  "roles.view": "Только чтение. Открывает раздел ролей и показывает, что каждая роль даёт.",
  "roles.manage": "Создание, переименование, порядок и цвет. Набор прав меняется отдельным правом.",
  "permissions.manage": "Решает, что роль позволяет делать. Фактически раздаёт доступ всем, у кого эта роль.",
  "audit.view": "История действий администраторов: кто что изменил и когда. Ничего не меняет.",
  "users.view": "Список и карточки. Без блокировок и без смены ролей.",
  "users.manage": "Блокировки, ограничения и снятие их. Роли этим правом не выдаются.",
  "users.assign_roles": "Выдаёт и снимает роли — в том числе те, что сильнее собственной. Давать с осторожностью.",
  "locations.view": "Список локаций и кто к какой относится.",
  "locations.manage": "Создание и изменение локаций целиком.",
  "location_members.view": "Кто работает в локации и с какой ролью.",
  "location_members.manage": "Добавление и удаление сотрудников, их роли и основной администратор локации.",
  "tasks.view": "Задачи тех локаций, к которым человек относится. Не все подряд.",
  "tasks.view_all_locations": "Снимает границу локации: видны задачи всех, а не только своих.",
  "tasks.view_admin_tasks": "Открывает задачи, помеченные как административные и обычно скрытые.",
  "tasks.create": "Ставить новые задачи в своей области.",
  "tasks.claim": "Взять свободную задачу на себя, не дожидаясь назначения.",
  "tasks.assign": "Назначать задачи другим людям.",
  "tasks.manage": "Менять содержание, сроки и статус, включая закрытие.",
  "tasks.manage_all_locations": "Снимает границу локации при изменении задач.",
  "tasks.manage_admin_tasks": "Менять административные задачи, а не только видеть их.",
  "tasks.delete": "Удаление по одной. Задача уходит в корзину и может быть возвращена.",
  "tasks.bulk_delete": "Удаление сразу многих. Ошибка обходится дороже — отдельное право не случайно.",
  "tasks.restore": "Возвращать удалённые задачи из корзины.",
  "chats.invite": "Приглашать туда, где правила чата это и так разрешают.",
  "chats.invite_any": "Приглашать в любой чат независимо от его правил. Обходит настройку владельца чата.",
  "chats.manage_invites": "Отменять приглашения, выпускать заново и смотреть их историю.",
  "chats.manage_roles": "Повышать и понижать участников внутри чата.",
  "chats.moderate": "Вмешиваться в чужие переписки: удалять сообщения и ограничивать участников.",
  "media.moderate": "Удалять вложения, загруженные другими людьми.",
  "folders.manage_shared": "Создавать и менять папки чатов, общие для всех.",
  "bots.suspend": "Приостанавливать и возвращать ботов. Доступа к их токенам это не даёт.",
  "support.view": "Читать обращения в поддержку, не отвечая на них.",
  "support.claim": "Взять обращение на себя, чтобы им занимался один человек.",
  "support.reply": "Писать ответы, которые увидит обратившийся.",
  "support.transfer": "Отдать обращение другому сотруднику.",
  "support.escalate": "Поднять обращение на уровень выше, когда своих полномочий не хватает.",
  "support.lookup_customer": "Смотреть данные обратившегося. Персональные данные — открывать по необходимости.",
  "support.manage": "Управлять очередью целиком: приоритеты, закрытие, чужие обращения.",
  "support.settings": "Менять то, как поддержка работает у всех: маршрутизацию и правила.",
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
  if (
    category === "users" ||
    category === "locations" ||
    category === "tasks" ||
    category === "chats" ||
    category === "support"
  ) return category;
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
