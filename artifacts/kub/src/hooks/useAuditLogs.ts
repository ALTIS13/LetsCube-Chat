"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapPgError } from "@/lib/errors";
import type {
  AuditAction,
  AuditLog,
  AuditLogWithActor,
  Chat,
  Profile,
} from "@/types/database";

export interface AuditFilters {
  actorId?: string | null;
  actions?: AuditAction[] | null;
  fromIso?: string | null;
  toIso?: string | null;
}

export interface UseAuditLogsResult {
  rows: AuditLogWithActor[];
  total: number;
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  setPage: (p: number) => void;
  refresh: () => void;
}

export function useAuditLogs(
  filters: AuditFilters,
  pageSize = 20,
): UseAuditLogsResult {
  const supabase = createClient();
  const [rows, setRows] = useState<AuditLogWithActor[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [tick, setTick] = useState(0);

  // Stabilise the array filter for the dependency list.
  const actionsKey = useMemo(
    () => (filters.actions && filters.actions.length > 0
      ? [...filters.actions].sort().join(",")
      : ""),
    [filters.actions],
  );

  // Effect-scoped fetcher with a `cancelled` flag so out-of-order
  // responses from rapid filter / page changes never overwrite fresher
  // state. (Race-condition fix from code review.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const from = page * pageSize;
      const to = from + pageSize - 1;
      let q = supabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (filters.actorId) q = q.eq("actor_id", filters.actorId);
      if (filters.actions && filters.actions.length > 0) {
        q = q.in("action", filters.actions);
      }
      if (filters.fromIso) q = q.gte("created_at", filters.fromIso);
      if (filters.toIso) q = q.lte("created_at", filters.toIso);

      const { data, count, error: err } = await q;
      if (cancelled) return;
      if (err) {
        setError(mapPgError(err));
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }
      const list = (data ?? []) as AuditLog[];

      const actorIds = list.map((r) => r.actor_id).filter((x): x is string => !!x);
      const targetProfileIds = list
        .map((row) => getAuditTargetProfileId(row))
        .filter((x): x is string => !!x);
      const chatIds = list
        .map((row) => getAuditTargetChatId(row))
        .filter((x): x is string => !!x);
      const profileIds = Array.from(new Set([...actorIds, ...targetProfileIds]));
      let profileMap: Record<string, Profile> = {};
      let chatMap: Record<string, Chat> = {};
      if (profileIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("*")
          .in("id", profileIds);
        if (cancelled) return;
        for (const p of (profs ?? []) as Profile[]) profileMap[p.id] = p;
      }
      if (chatIds.length > 0) {
        const { data: chats } = await supabase
          .from("chats")
          .select("*")
          .in("id", Array.from(new Set(chatIds)));
        if (cancelled) return;
        for (const chat of (chats ?? []) as Chat[]) chatMap[chat.id] = chat;
      }
      if (cancelled) return;
      setTotal(count ?? 0);
      setRows(list.map((r) => {
        const targetProfileId = getAuditTargetProfileId(r);
        const targetChatId = getAuditTargetChatId(r);
        return {
          ...r,
          actor: r.actor_id ? profileMap[r.actor_id] ?? null : null,
          targetProfile: targetProfileId ? profileMap[targetProfileId] ?? null : null,
          targetChat: targetChatId ? chatMap[targetChatId] ?? null : null,
        };
      }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // ↑ actionsKey covers `filters.actions`; explicit comment so
    // linters don't try to "fix" the dep list and break filter
    // reactivity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, page, pageSize, filters.actorId, actionsKey, filters.fromIso, filters.toIso, tick]);

  // Reset to page 0 whenever filters change.
  useEffect(() => {
    setPage(0);
  }, [filters.actorId, actionsKey, filters.fromIso, filters.toIso]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return {
    rows,
    total,
    loading,
    error,
    page,
    pageSize,
    setPage,
    refresh,
  };
}

function getAuditTargetProfileId(row: AuditLog): string | null {
  if (row.target_kind === "profile" && row.target_id) return row.target_id;
  return jsonString(row.diff, "target_user_id") ?? jsonString(row.diff, "user_id");
}

function getAuditTargetChatId(row: AuditLog): string | null {
  if (row.target_kind === "chat" && row.target_id) return row.target_id;
  return jsonString(row.diff, "chat_id");
}

function jsonString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
