"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import { KUB_ICON_NAMES } from "@/components/kub/icons";
import {
  chatRolesOfMember,
  normalizeChatRoleName,
  orderChatRoles,
  type ChatMemberRoleRow,
  type ChatRole,
  type ChatRoleRow,
} from "@/lib/chatRoles";

/**
 * A group's own vocabulary, and who wears what (D-215).
 *
 * Two tables, read in one round trip for the whole member list rather than one
 * per row — the same rule `useProfileBadges` follows, and for the same reason:
 * a list of twenty people must not cost twenty-one requests to draw.
 *
 * **A deployment without the tables is not a failure.** The migration, this
 * hook and the screens are separate pieces of work, and a build pointed at a
 * database that predates 2026-09-18 must draw a member list with no tags and no
 * error rather than an error where a list should be. `useServerChannels`
 * carries the same distinction and states the reason at length: an empty list
 * and a refused read are different answers, and returning `[]` for both makes
 * a broken read look like an empty group.
 *
 * **Nothing is cached across chats.** Unlike badges, which belong to a person
 * and are the same everywhere, a tag means something in one group and nothing
 * in the next — that is the whole of D-215 — so a module-level cache keyed by
 * user id would be exactly the defect this feature exists to remove.
 */

/** What this hook knows about one chat. */
export interface ChatRolesView {
  /** False where this deployment has no `chat_roles` table. */
  supported: boolean;
  /** False until the first read has come back, so «нет ролей» is never a guess. */
  ready: boolean;
  /** True when the last read was refused, which is not the same as «none». */
  failed: boolean;
  /** Every role the group has defined, highest first. */
  roles: ChatRole[];
  /** Every assignment in this chat. */
  assignments: ChatMemberRoleRow[];
  /** The tags one person wears here, in the group's own order. */
  rolesOf: (userId: string) => ChatRole[];
  refresh: () => void;
}

const NOTHING: ChatRolesView = {
  supported: true,
  ready: false,
  failed: false,
  roles: [],
  assignments: [],
  rolesOf: () => [],
  refresh: () => undefined,
};

/**
 * Whether an error means «this deployment has no such table».
 *
 * PostgREST answers `PGRST205` for an unknown table and Postgres `42P01` for an
 * undefined relation; a stale schema cache produces the first. Matched on the
 * code rather than on the message, because the message is localised by nothing
 * we control.
 */
function isMissingTable(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  return code === "PGRST205" || code === "42P01";
}

interface Read {
  supported: boolean;
  failed: boolean;
  chatId: string;
  roles: ChatRole[];
  assignments: ChatMemberRoleRow[];
}

export function useChatRoles(chatId: string | null, enabled: boolean): ChatRolesView {
  const supabase = useMemo(() => createClient(), []);
  const [read, setRead] = useState<Read | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled || !chatId) {
      setRead(null);
      return;
    }
    let cancelled = false;

    void (async () => {
      // `as any` on both names: neither table is in the generated database
      // types, which were generated from a schema older than this migration.
      // The same cast `useServerChannels` and `lib/achievements.ts` already use.
      const [roleRead, tagRead] = await Promise.all([
        supabase
          .from("chat_roles" as any)
          .select("id,chat_id,name,colour,icon,priority,created_at")
          .eq("chat_id", chatId),
        supabase
          .from("chat_member_roles" as any)
          .select("chat_id,user_id,role_id")
          .eq("chat_id", chatId),
      ]);
      if (cancelled) return;

      const supported = !isMissingTable(roleRead.error as never);
      const failed = supported && Boolean(roleRead.error || tagRead.error);
      const roles = roleRead.error
        ? []
        : orderChatRoles(
            ((roleRead.data as unknown as ChatRoleRow[] | null) ?? []),
            KUB_ICON_NAMES,
          );
      const assignments = tagRead.error
        ? []
        : ((tagRead.data as unknown as ChatMemberRoleRow[] | null) ?? []);

      setRead({ supported, failed, chatId, roles, assignments });
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, enabled, nonce, supabase]);

  // Both tables are in the `supabase_realtime` publication — the migration puts
  // them there and says why: without it a member list never learns that a tag
  // was handed out, and somebody watching the screen has to reopen it. The
  // subscription is a refresh rather than a patch, because a role rename
  // touches every row wearing it and re-reading two small tables is cheaper
  // than reconciling that by hand.
  const supported = read?.supported ?? true;
  useEffect(() => {
    if (!enabled || !chatId || !supported) return;
    const opened = subscribeByTable<(payload: unknown) => void, RealtimeChannel>(
      supabase.realtime,
      `chat-roles:${chatId}`,
      [
        {
          event: "*",
          schema: "public",
          table: "chat_roles",
          filter: `chat_id=eq.${chatId}`,
          handler: refresh,
        },
        {
          event: "*",
          schema: "public",
          table: "chat_member_roles",
          filter: `chat_id=eq.${chatId}`,
          handler: refresh,
        },
      ],
    );
    return () => {
      for (const entry of opened) void supabase.removeChannel(entry.channel);
    };
  }, [chatId, enabled, refresh, supabase, supported]);

  const rolesOf = useCallback(
    (userId: string) => chatRolesOfMember(userId, read?.assignments ?? [], read?.roles ?? []),
    [read?.assignments, read?.roles],
  );

  return useMemo(() => {
    if (!read || read.chatId !== chatId) return { ...NOTHING, refresh };
    return {
      supported: read.supported,
      ready: true,
      failed: read.failed,
      roles: read.roles,
      assignments: read.assignments,
      rolesOf,
      refresh,
    };
  }, [chatId, read, refresh, rolesOf]);
}

/** What a write asked for, before it is sent. */
export interface ChatRoleDraft {
  name: string;
  colour: string | null;
  icon: string | null;
  priority: number;
}

/**
 * The row to insert for a new role.
 *
 * The id is chosen here rather than read back, for the reason
 * `lib/chatCreation.ts` sets out at length: `INSERT ... RETURNING` is judged by
 * the SELECT policy too, and asking for the row back is what made group
 * creation answer 403 for three days. `chat_roles`'s SELECT policy is
 * `is_chat_member(chat_id)` and the writer is the chat's owner, who is a
 * member — so a read-back would in fact succeed here. It is still not asked
 * for: the client knows the id it generated, and a habit that only sometimes
 * works is the one that breaks the next table.
 */
export function newChatRoleRow(
  chatId: string,
  draft: ChatRoleDraft,
  createdBy: string,
  id: string,
): Record<string, unknown> {
  return {
    id,
    chat_id: chatId,
    name: normalizeChatRoleName(draft.name),
    colour: draft.colour,
    icon: draft.icon,
    priority: draft.priority,
    created_by: createdBy,
  };
}
