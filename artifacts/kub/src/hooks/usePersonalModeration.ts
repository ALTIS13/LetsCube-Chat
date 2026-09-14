"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { createClient } from "@/lib/supabase/client";
import { mapPgError } from "@/lib/errors";
import { useAppStore } from "@/store/app.store";
import {
  createPersonalBlocksStore,
  type BlockedPerson,
  type PersonalBlocksGateway,
} from "@/lib/personalBlocksStore";
import {
  normalizeReportNote,
  reportRefusalText,
  classifyPersonalWriteError,
  type ReportKind,
  type ReportReasonId,
} from "@/lib/personalModeration";

export type { BlockedPerson };

/**
 * Blocking somebody, and reporting somebody.
 *
 * Both write tables added on 2026-09-14, so both use `as any` on the table
 * name: `user_blocks` and `content_reports` are not in the generated database
 * types, which come from a schema older than that migration. It is the cast
 * `useVoiceChannel`, `lib/achievements.ts` and `lib/support/userTickets.ts`
 * already use for the same reason.
 *
 * The decisions are not here. The words, the questions and the classifier are
 * in `lib/personalModeration.ts`, and the shared list is
 * `lib/personalBlocksStore.ts`; both import nothing that needs a browser, so
 * `node --test` reaches every branch of them. What is left in this file is the
 * two reads, the three writes, and the wiring that keeps one list behind three
 * surfaces.
 */

interface BlockRow {
  blocked_id: string;
  created_at: string;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

/**
 * Two reads, not one embedded select.
 *
 * `profiles!user_blocks_blocked_id_fkey(...)` would do it in one round trip and
 * would tie this client to the *name* Postgres happened to give the foreign
 * key. Two reads cost one extra request on a list that is nearly always empty
 * and depend on nothing but the column.
 */
const gateway: PersonalBlocksGateway = {
  async read(userId) {
    const supabase = createClient();
    const blocks = await supabase
      .from("user_blocks" as any)
      .select("blocked_id,created_at")
      .eq("blocker_id", userId);
    if (blocks.error) throw new Error(mapPgError(blocks.error));
    const rows = (blocks.data as unknown as BlockRow[] | null) ?? [];
    if (rows.length === 0) return [];

    const profiles = await supabase
      .from("profiles")
      .select("id,full_name,username,avatar_url")
      .in("id", rows.map((row) => row.blocked_id));
    if (profiles.error) throw new Error(mapPgError(profiles.error));
    const byId = new Map<string, ProfileRow>(
      ((profiles.data as unknown as ProfileRow[] | null) ?? []).map((row) => [row.id, row]),
    );

    // A profile that did not come back still gets a row. The block is real and
    // the person must be able to lift it; a list that silently drops the ones
    // it could not name is the trap this list exists to avoid.
    return rows.map((row) => {
      const profile = byId.get(row.blocked_id);
      return {
        id: row.blocked_id,
        fullName: profile?.full_name?.trim() || "Пользователь",
        username: profile?.username ?? null,
        avatarUrl: profile?.avatar_url ?? null,
        createdAt: row.created_at,
      };
    });
  },

  async block(userId, blockedId) {
    const supabase = createClient();
    // No `.select()`: `user_blocks` is readable by its own `blocker_id`, so a
    // returning insert would work here — but there is nothing to read back that
    // the caller did not just write, and the row it would return is the row it
    // sent.
    const { error } = await supabase
      .from("user_blocks" as any)
      .insert({ blocker_id: userId, blocked_id: blockedId } as any);
    // Blocking somebody already blocked is the state the caller wanted.
    if (error && classifyPersonalWriteError(error) !== "duplicate") {
      console.error("[blocks] insert failed.", error.code ?? "", error.message ?? "");
      throw new Error(mapPgError(error));
    }
  },

  async unblock(userId, blockedId) {
    const supabase = createClient();
    const { error } = await supabase
      .from("user_blocks" as any)
      .delete()
      .eq("blocker_id", userId)
      .eq("blocked_id", blockedId);
    if (error) {
      console.error("[blocks] delete failed.", error.code ?? "", error.message ?? "");
      throw new Error(mapPgError(error));
    }
  },
};

const store = createPersonalBlocksStore(gateway);

/** For the specs that need the list to be asked for again from scratch. */
export const personalBlocksStore = store;

/**
 * The people this person has blocked, and the two ways to change that list.
 *
 * Every surface that offers blocking reads this, so they cannot disagree about
 * whether somebody is blocked.
 */
export function usePersonalBlocks() {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    void store.sync(userId);
  }, [userId]);

  const block = useCallback((person: BlockedPerson) => store.block(userId, person), [userId]);
  const unblock = useCallback((blockedId: string) => store.unblock(userId, blockedId), [userId]);
  const refresh = useCallback(() => store.refresh(userId), [userId]);

  return { ...snapshot, block, unblock, refresh, clearError: store.clearError };
}

export interface ContentReportDraft {
  kind: ReportKind;
  targetUserId: string;
  /** Required for a report about a message; `content_reports_message_present` enforces it. */
  messageId?: string | null;
  chatId?: string | null;
  reason: ReportReasonId;
  note?: string | null;
}

/**
 * Files one report.
 *
 * **There is deliberately no `.select()` on this insert, and adding one breaks
 * it in production.** Reading the row back needs the SELECT policy, which is
 * staff-only by design — a queue its reporters can read is a queue that says
 * who else complained about whom — so `insert … returning` is refused, with
 * «new row violates row-level security policy». That error reads like a failing
 * WITH CHECK and is not one; an hour went into chasing it on 2026-09-14 and the
 * rehearsal (step 8a) pins it on the database side. `tests/e2e` measures the
 * wire here: the request must carry no `Prefer: return=representation`.
 *
 * `status`, `handled_by` and `handled_at` are left to their defaults. The
 * insert policy requires `status = 'new'` with both handled columns null, and
 * sending them explicitly would be a second place for that to be wrong.
 */
export async function submitContentReport(
  reporterId: string | null,
  draft: ContentReportDraft,
): Promise<{ ok: boolean; error: string | null }> {
  if (!reporterId) {
    return { ok: false, error: reportRefusalText(draft.kind, "refused") };
  }
  const supabase = createClient();
  const { error } = await supabase.from("content_reports" as any).insert({
    reporter_id: reporterId,
    kind: draft.kind,
    target_user_id: draft.targetUserId,
    message_id: draft.kind === "message" ? draft.messageId ?? null : null,
    chat_id: draft.chatId ?? null,
    reason: draft.reason,
    note: normalizeReportNote(draft.note),
  } as any);

  if (!error) return { ok: true, error: null };
  // The cause goes to the log, where somebody who can act on it reads it; the
  // screen gets one sentence about the situation.
  console.error("[reports] insert failed.", error.code ?? "", error.message ?? "");
  return {
    ok: false,
    error: reportRefusalText(draft.kind, classifyPersonalWriteError(error), mapPgError(error)),
  };
}
