import { mapPgError } from "@/lib/errors";
import type { LocationRole, TaskTargetRole } from "@/types/database";

export const LOCATION_ROUTING_REQUIRED_MESSAGE = "Локации требуют обновления базы данных.";
export const LOCATION_ROUTING_STORAGE_KEY = "kub.taskRouting.enabled";
export const LOCATION_ROUTING_STORAGE_EVENT = "kub:task-routing-storage";

export const LOCATION_ROLE_LABEL: Record<LocationRole, string> = {
  owner: "Владелец локации",
  admin: "Администратор локации",
  manager: "Менеджер локации",
  staff: "Работник",
};

export const TASK_TARGET_ROLE_LABEL: Record<TaskTargetRole, string> = {
  staff: "Работники локации",
  admin: "Администратор локации",
  manager: "Менеджер локации",
  owner: "Владелец",
};

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

export function isLocationRoutingMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as ErrorLike;
  const code = typeof err.code === "string" ? err.code : "";
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
      text.includes("locations") ||
      text.includes("location_members") ||
      text.includes("location_id") ||
      text.includes("task_create_v3") ||
      text.includes("task_update_v3") ||
      text.includes("location_create")
    );
  }

  return false;
}

export function mapLocationRoutingError(error: unknown): string {
  if (isLocationRoutingMissingError(error)) return LOCATION_ROUTING_REQUIRED_MESSAGE;
  const mapped = mapPgError(error);
  if (mapped.includes("permission") || mapped.includes("прав")) return "Недостаточно прав.";
  return mapped;
}

export function getLocationRoutingEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LOCATION_ROUTING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLocationRoutingEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(LOCATION_ROUTING_STORAGE_KEY, "1");
    else window.localStorage.removeItem(LOCATION_ROUTING_STORAGE_KEY);
    window.dispatchEvent(new Event(LOCATION_ROUTING_STORAGE_EVENT));
  } catch {
    // LocalStorage may be unavailable in hardened browser contexts.
  }
}
