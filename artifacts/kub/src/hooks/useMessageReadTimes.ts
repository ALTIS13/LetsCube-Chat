"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  READ_TIMES_RPC,
  createReadTimesLoader,
  type MessageReadTime,
  type ReadTimesLoader,
  type ReadTimesState,
} from "@/lib/messageReadTimes";
import { isMissingRpcError, rpcAvailability } from "@/lib/rpcAvailability";
import { createClient } from "@/lib/supabase/client";

const UNAVAILABLE: ReadTimesState = { status: "unavailable" };
const IDLE: ReadTimesState = { status: "idle" };

let applicationLoader: ReadTimesLoader | null = null;

/** The loader for this application's backend, made once. */
export function readTimesLoader(): ReadTimesLoader {
  if (!applicationLoader) {
    const supabase = createClient();
    applicationLoader = createReadTimesLoader({
      rpc: (fn, args) =>
        supabase.rpc(fn as typeof READ_TIMES_RPC, args as { p_message_id: string }) as unknown as PromiseLike<{
          data: unknown;
          error: unknown;
        }>,
      availability: rpcAvailability,
      isMissingRpc: isMissingRpcError,
    });
  }
  return applicationLoader;
}

/**
 * When each person read one message, asked for while `messageId` is set and
 * asked again whenever `signature` changes — a reader's pointer moved, on this
 * device or on another. Without a loader the answer is `unavailable`, which
 * shows the pointer as before.
 *
 * A change of message or signature reads as `loading` in the same render, never
 * as a stale answer, so the pointer's time is not painted for a frame before
 * the exact one replaces it.
 */
export function useMessageReadTimes(
  loader: ReadTimesLoader | undefined,
  messageId: string | null,
  signature: string,
): ReadTimesState {
  const key = loader && messageId ? `${messageId}|${signature}` : null;
  const [answer, setAnswer] = useState<{ key: string; state: ReadTimesState } | null>(null);
  const lastTimesRef = useRef<{ messageId: string; times: MessageReadTime[] } | null>(null);
  const available = loader ? loader.available?.() ?? true : false;

  useEffect(() => {
    if (!key || !loader || !messageId || !available) return undefined;
    let cancelled = false;
    // Deferred by a task, so a view that renders twice while opening asks once.
    const timer = window.setTimeout(() => {
      void loader(messageId).then((times) => {
        if (cancelled) return;
        if (times) lastTimesRef.current = { messageId, times };
        setAnswer({ key, state: times ? { status: "ready", times } : UNAVAILABLE });
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [available, key, loader, messageId]);

  const previous = lastTimesRef.current?.messageId === messageId ? lastTimesRef.current.times : null;
  const loading = useMemo<ReadTimesState>(() => ({ status: "loading", previous }), [previous]);

  if (!loader || !available) return UNAVAILABLE;
  if (!messageId) return IDLE;
  if (answer?.key === key) return answer.state;
  return loading;
}
