import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, GroupInvite, Json } from "@/types/database";
import { mapPgError } from "@/lib/errors";

export const GROUP_INVITES_MIGRATION_REQUIRED = "Приглашения требуют обновления базы данных.";

export type GroupInviteStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

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
  if (error) return groupInviteError(error);
  return { ok: true, data: data as GroupInvite };
}

export async function acceptGroupInvite(
  supabase: Client,
  inviteId: string,
): Promise<RpcResult<string>> {
  const { data, error } = await supabase.rpc("group_invite_accept", { p_invite_id: inviteId });
  if (error) return groupInviteError(error);
  return { ok: true, data: data as string };
}

export async function declineGroupInvite(
  supabase: Client,
  inviteId: string,
): Promise<RpcResult<GroupInvite>> {
  const { data, error } = await supabase.rpc("group_invite_decline", { p_invite_id: inviteId });
  if (error) return groupInviteError(error);
  return { ok: true, data: data as GroupInvite };
}

export async function cancelGroupInvite(
  supabase: Client,
  inviteId: string,
): Promise<RpcResult<GroupInvite>> {
  const { data, error } = await supabase.rpc("group_invite_cancel", { p_invite_id: inviteId });
  if (error) return groupInviteError(error);
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

function groupInviteError(error: unknown): RpcResult<never> {
  const migrationRequired = isGroupInviteUnavailableError(error);
  return {
    ok: false,
    migrationRequired,
    message: migrationRequired ? GROUP_INVITES_MIGRATION_REQUIRED : mapPgError(error),
  };
}

function readString(value: Json | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isGroupInviteStatus(value: string): value is GroupInviteStatus {
  return ["pending", "accepted", "declined", "cancelled", "expired"].includes(value);
}
