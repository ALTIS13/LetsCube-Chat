"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { Database } from "@/types/database";

export type TaskReviewReason = Database["public"]["Functions"]["task_review_access"]["Returns"]["reason"];

interface ReviewAccess {
  canReview: boolean;
  canReviewOwn: boolean;
  isParticipant: boolean;
  reason: TaskReviewReason;
  checking: boolean;
  error: string | null;
}

const refused: ReviewAccess = {
  canReview: false, canReviewOwn: false, isParticipant: false,
  reason: "unavailable", checking: false, error: null,
};

function parseAccess(data: unknown): ReviewAccess {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("invalid_review_access");
  const value = data as Record<string, unknown>;
  if (typeof value.can_review !== "boolean" || typeof value.can_review_own !== "boolean" ||
      typeof value.is_participant !== "boolean" ||
      !["ready", "self_review", "unavailable", "status"].includes(value.reason as string) ||
      (value.can_review && (value.reason !== "ready" ||
        (value.is_participant && !value.can_review_own)))) throw new Error("invalid_review_access");
  return {
    canReview: value.can_review, canReviewOwn: value.can_review_own,
    isParticipant: value.is_participant, reason: value.reason as TaskReviewReason,
    checking: false, error: null,
  };
}

/** Both review actions use the server's shared predicate, never a client role mirror. */
export function useTaskReviewAccess(taskId: string | null, options: {
  enabled?: boolean;
  updatedAt?: string | null;
  /** Change when the caller's effective global/location role or permission inputs change. */
  rolesKey?: string;
} = {}): ReviewAccess & { refetch: () => Promise<void> } {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const accountEpoch = useAppStore((s) => s.accountEpoch);
  const enabled = (options.enabled ?? true) && Boolean(taskId && userId);
  const updatedAt = options.updatedAt ?? null;
  const rolesKey = options.rolesKey ?? "";
  const owner = useMemo(() => ({ active: false, request: 0, controller: null as AbortController | null }),
    [taskId, userId, accountEpoch, enabled, updatedAt, rolesKey]);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [state, setState] = useState({ owner, access: { ...refused, checking: enabled } });
  const supabase = useMemo(() => createClient(), []);

  const refetch = useCallback(async () => {
    const isOwner = () => owner.active && ownerRef.current === owner &&
      useAppStore.getState().currentUser?.id === userId &&
      useAppStore.getState().accountEpoch === accountEpoch;
    if (!enabled || !taskId || !isOwner()) return;
    const request = ++owner.request;
    owner.controller?.abort();
    const controller = new AbortController();
    owner.controller = controller;
    const isCurrent = () => isOwner() && owner.request === request && !controller.signal.aborted;
    setState({ owner, access: { ...refused, checking: true } });
    try {
      const { data, error } = await supabase.rpc("task_review_access", { p_task_id: taskId })
        .abortSignal(controller.signal);
      if (!isCurrent()) return;
      if (error) throw error;
      setState({ owner, access: parseAccess(data) });
    } catch {
      if (isCurrent()) setState({ owner, access: {
        ...refused, error: "Не удалось проверить доступ к задаче. Повторите попытку.",
      } });
    }
  }, [owner, enabled, taskId, userId, accountEpoch, supabase]);

  useEffect(() => {
    owner.active = true;
    if (enabled) void refetch();
    return () => {
      owner.active = false;
      owner.request += 1;
      owner.controller?.abort();
    };
  }, [owner, enabled, refetch]);

  const access = enabled && state.owner === owner ? state.access : { ...refused, checking: enabled };
  return { ...access, refetch };
}
