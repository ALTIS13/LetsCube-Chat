import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, GroupInvite, Json } from "@/types/database";

export const GROUP_INVITES_MIGRATION_REQUIRED = "Приглашения требуют обновления базы данных.";
export const INVITE_POLICY_MIGRATION_REQUIRED = "Настройка режима приглашений станет доступна после обновления базы данных.";

export type GroupInviteStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";
export type InvitePolicy = "owner_admin_only" | "members_can_invite";

export interface GroupInvitePayload {
  invite_id?: string;
  chat_id?: string;
  chat_name?: string;
  inviter_id?: string;
  inviter_name?: string;
  inviter_avatar_url?: string;
  status?: GroupInviteStatus;
  expires_at?: string | null;
}

type Client = SupabaseClient<Database>;
type RpcResult<T> = { ok: true; data: T } | { ok: false; message: string; migrationRequired: boolean };

export function parseGroupInvitePayload(payload: Json): GroupInvitePayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const record = payload as Record<string, Json | undefined>;
  const status = typeof record.status === "string" && isGroupInviteStatus(record.status)
    ? record.status
    : undefined;
  return {
    invite_id: readString(record.invite_id),
    chat_id: readString(record.chat_id),
    chat_name: readString(record.chat_name),
    inviter_id: readString(record.inviter_id),
    inviter_name: readString(record.inviter_name),
    inviter_avatar_url: readString(record.inviter_avatar_url),
    status,
    expires_at: readString(record.expires_at) ?? null,
  };
}

export async function createGroupInvite(
  supabase: Client,
  chatId: string,
  inviteeId: string,
): Promise<RpcResult<GroupInvite>> {
  const { data, error } = await supabase.rpc("group_invite_create", {
    p_chat_id: chatId,
    p_invitee_id: inviteeId,
  });
  if (error) return groupInviteError(error, "Не удалось отправить приглашение.");
  const invite = data as GroupInvite;
  if (invite.status !== "pending") {
    return {
      ok: false,
      migrationRequired: false,
      message: "Не удалось отправить приглашение. Попробуйте ещё раз.",
    };
  }
  return { ok: true, data: invite };
}

export async function acceptGroupInvite(
  supabase: Client,
  inviteId: string,
): Promise<RpcResult<string>> {
  const { data, error } = await supabase.rpc("group_invite_accept", { p_invite_id: inviteId });
  if (error) return groupInviteError(error, "Не удалось принять приглашение.");
  return { ok: true, data: data as string };
}

export async function declineGroupInvite(
  supabase: Client,
  inviteId: string,
): Promise<RpcResult<GroupInvite>> {
  const { data, error } = await supabase.rpc("group_invite_decline", { p_invite_id: inviteId });
  if (error) return groupInviteError(error, "Не удалось отклонить приглашение.");
  return { ok: true, data: data as GroupInvite };
}

export async function cancelGroupInvite(
  supabase: Client,
  inviteId: string,
): Promise<RpcResult<GroupInvite>> {
  const { data, error } = await supabase.rpc("group_invite_cancel", { p_invite_id: inviteId });
  if (error) return groupInviteError(error, "Не удалось отменить приглашение.");
  return { ok: true, data: data as GroupInvite };
}

export function isGroupInviteUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code.toUpperCase() : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return (
    code === "42883" ||
    code === "42P01" ||
    code === "PGRST202" ||
    code === "PGRST204" ||
    message.includes("group_invite_") && message.includes("not found") ||
    message.includes("could not find the function") ||
    message.includes("relation \"public.group_invites\" does not exist")
  );
}

export function isInvitePolicyUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code.toUpperCase() : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return code === "PGRST204" || message.includes("invite_policy");
}

export function formatGroupInviteError(error: unknown, fallback = "Не удалось выполнить действие. Попробуйте ещё раз."): string {
  if (isGroupInviteUnavailableError(error)) return GROUP_INVITES_MIGRATION_REQUIRED;
  const details = readErrorDetails(error);
  const text = `${details.code} ${details.message} ${details.details}`.toLowerCase();

  if (details.code === "42501" || text.includes("permission denied") || text.includes("admin_required")) {
    return "Недостаточно прав для приглашения.";
  }
  if (text.includes("already_member")) return "Пользователь уже состоит в группе.";
  if (text.includes("pending_exists") || text.includes("unique") || text.includes("duplicate") || text.includes("one_pending")) {
    return "Приглашение уже отправлено.";
  }
  if (text.includes("not_pending")) return "Приглашение уже недоступно.";
  if (text.includes("expired")) return "Срок приглашения истёк.";
  if (text.includes("cancelled")) return "Приглашение отменено.";
  if (text.includes("self_forbidden")) return "Нельзя пригласить самого себя.";
  if (text.includes("chat_type_invalid") || text.includes("not_group_chat")) return "Приглашения доступны только для групп.";
  if (text.includes("invitee_not_found")) return "Пользователь не найден.";
  if (text.includes("not_found") || text.includes("unavailable")) return "Приглашение уже недоступно.";
  if (details.code === "28000" || text.includes("not_authenticated")) return "Войдите в аккаунт, чтобы продолжить.";

  return fallback;
}

function groupInviteError(error: unknown, fallback: string): RpcResult<never> {
  const migrationRequired = isGroupInviteUnavailableError(error);
  return {
    ok: false,
    migrationRequired,
    message: formatGroupInviteError(error, fallback),
  };
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

function readString(value: Json | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isGroupInviteStatus(value: string): value is GroupInviteStatus {
  return ["pending", "accepted", "declined", "cancelled", "expired"].includes(value);
}
