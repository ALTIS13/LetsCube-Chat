"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { showActionFeedback } from "@/lib/actionFeedback";
import { isNativeAndroid } from "@/lib/platform/capabilities";
import {
  isCurrentNativeVoiceSession, nativeVoiceContext, noteNativeCallsAllowed,
  type NativeVoiceContext,
} from "@/lib/platform/nativeVoiceCalls";
import {
  CALLS_GATE_WAIT_MS,
  classifySessionDeviceError,
  incomingRingVerdict,
  orderSessionDevices,
  readCallsAllowed,
  readSessionDeviceRows,
  sessionDeviceRefusalText,
  type IncomingRingVerdict,
  type SessionDeviceRow,
} from "@/lib/sessionDevices";

/**
 * The device list, and the one question the ring asks before it rings.
 *
 * Slice F of `docs/proposals/2026-09-18-one-to-one-calls.md`, client half.
 * Every rule is `lib/sessionDevices.ts`'s, where `node --test` can load it;
 * what is in this file is the wiring — the three `SECURITY DEFINER` functions,
 * module state that outlives a component, and the decision about when to ask.
 *
 * ## What is cached, and why it is cached that way
 *
 * `voice_calls_allowed_here()` is the gate, and the answer is kept in module
 * state with the moment it was taken. **It is asked when an incoming ring
 * appears and at no other time** — not on a render, not on a timer, not on
 * focus. In practice that is one request per incoming call and none at all
 * while nothing is ringing, and it is the only schedule that satisfies both
 * halves of what this has to do.
 *
 * The alternatives were measured against the one case that matters, which is a
 * device nobody is looking at:
 *
 *  - **A long cache** cannot be corrected on such a device. Its page is hidden,
 *    so no focus or visibility event arrives — and a hidden tab is exactly what
 *    somebody silences from their phone. It would go on ringing for as long as
 *    the cache lived.
 *  - **A subscription** cannot be had at all. `user_session_settings` has RLS on
 *    and no policy, deliberately, so Realtime would deliver nothing about it to
 *    any client. That is the migration's design and not an oversight.
 *  - **Asking on every render** puts a round trip behind a re-render.
 *
 * So the ring is the trigger, and the answer's staleness is the only clock.
 * `CALLS_GATE_FRESH_MS` is what makes a second call in the same breath, and a
 * re-render storm during a ring, cost nothing.
 *
 * Two things also write the answer without a request of their own, because they
 * already know it: reading the device list (its current row carries
 * `calls_enabled`) and flipping the switch on this very device. A person who
 * silences the telephone in their hand sees it obeyed with no round trip at
 * all.
 *
 * ## An answer that does not come back
 *
 * The surface draws nothing while the gate is being asked, so a request that
 * hangs would swallow a call. It cannot: the ask carries its own deadline, and
 * when the deadline passes it writes **true** — the same direction
 * `voice_calls_allowed_here` itself takes when it cannot identify the session.
 * A call that rings when it should not is a nuisance; one that silently does
 * not is a missed call nobody can explain.
 */

type PostgrestFailure = { code?: unknown; message?: unknown } | null;
interface LooseClient {
  rpc<T>(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: T | null; error: PostgrestFailure }>;
}

function looseClient(): LooseClient {
  return createClient() as unknown as LooseClient;
}

/* ── The gate, as module state ────────────────────────────────────────────── */

interface GateSnapshot {
  readonly allowed: boolean;
  /** When the answer was taken, or null when none ever was. */
  readonly checkedAt: number | null;
}

/**
 * Starts as «allowed, never asked».
 *
 * `checkedAt: null` is not the same as «allowed»: the rule treats it as a
 * reason to wait, so the first ring on a fresh page asks before it rings rather
 * than ringing on this default. The default only decides what happens if
 * everything else fails.
 */
let held: GateSnapshot = { allowed: true, checkedAt: null };
const listeners = new Set<() => void>();
let inFlight: Promise<boolean> | null = null;
let gateRevision = 0;

export function resetNativeSessionCallsGate(): void {
  ++gateRevision;
  inFlight = null;
  held = { allowed: true, checkedAt: null };
  for (const listener of listeners) listener();
}

function publish(allowed: boolean, checkedAt: number): void {
  if (held.allowed === allowed && held.checkedAt === checkedAt) return;
  held = { allowed, checkedAt };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const gateSnapshot = () => held;

/**
 * Ask the server whether this authorisation accepts calls.
 *
 * One request at a time: a second caller joins the one in the air rather than
 * starting another, which is what keeps a burst of re-renders during a ring
 * from becoming a burst of requests.
 *
 * Every failure path answers **true** and records the moment, so the surface is
 * never left waiting. A refused, unreachable or not-yet-deployed function is
 * not a person saying «do not ring this telephone».
 */
export function refreshCallsAllowedHere(): Promise<boolean> {
  if (inFlight) return inFlight;
  const revision = gateRevision;
  const owner = nativeVoiceContext();
  const current = () => revision === gateRevision && (!isNativeAndroid() || isCurrentNativeVoiceSession(owner));
  let settled = false;
  const deadline =
    typeof setTimeout === "function"
      ? setTimeout(() => {
          if (settled || !current()) return;
          // The answer is still in the air. Ring, and let the real answer
          // correct it when it lands — which it will, into the same store.
          publish(true, Date.now());
        }, CALLS_GATE_WAIT_MS)
      : null;

  const settle = (value: boolean): boolean => {
    settled = true;
    if (deadline !== null) clearTimeout(deadline);
    if (current()) {
      publish(value, Date.now());
      noteNativeCallsAllowed(value, owner);
    }
    if (revision === gateRevision) inFlight = null;
    return value;
  };

  inFlight = (async () => {
    try {
      const { data, error } = await looseClient().rpc<unknown>("voice_calls_allowed_here", {});
      return settle(error ? true : readCallsAllowed(data));
    } catch {
      return settle(true);
    }
  })();
  return inFlight;
}

/**
 * The answer, learned without asking for it.
 *
 * Called by the two places that already hold it — the device list, whose
 * current row carries `calls_enabled`, and a switch flipped on this very
 * device. Neither is a guess: both are the same column the gate reads.
 */
export function noteCallsAllowedHere(allowed: boolean, owner: NativeVoiceContext | null = nativeVoiceContext()): void {
  if (isNativeAndroid() && !isCurrentNativeVoiceSession(owner)) return;
  ++gateRevision;
  inFlight = null;
  publish(allowed, Date.now());
  noteNativeCallsAllowed(allowed, owner);
}

/** Read once, outside React, for a probe or a decision that is not a render. */
export function callsAllowedHereSnapshot(): GateSnapshot {
  return held;
}

/**
 * May this ring be drawn and sounded here?
 *
 * The rule is `incomingRingVerdict`'s. What this hook adds is the two things it
 * cannot have: the request, and **stickiness**.
 *
 * Stickiness is not a nicety. The verdict is a function of how old the answer
 * is, so without it a ring that outlived the freshness window would turn back
 * into `wait` on the next re-render — the card and its sound disappearing in
 * the middle of a call somebody is deciding whether to take. A ring is decided
 * once, when it arrives, and keeps that decision until it is over. `ringKey`
 * carries the start as well as the room, so the *next* call in the same
 * conversation is a new question.
 */
export function useIncomingRingGate(input: {
  /** `channelId@startedAt`, or null when nothing is ringing. */
  readonly ringKey: string | null;
  readonly direction: "incoming" | "outgoing" | null;
}): IncomingRingVerdict {
  const { ringKey, direction } = input;
  const gate = useSyncExternalStore(subscribe, gateSnapshot, gateSnapshot);
  const [decision, setDecision] = useState<{ key: string; verdict: IncomingRingVerdict } | null>(
    null,
  );

  const settled = ringKey !== null && decision?.key === ringKey ? decision.verdict : null;
  const verdict: IncomingRingVerdict =
    ringKey === null
      ? "show"
      : (settled ??
        incomingRingVerdict({
          direction,
          allowed: gate.allowed,
          checkedAt: gate.checkedAt,
          now: Date.now(),
        }));

  useEffect(() => {
    if (ringKey === null) {
      setDecision(null);
      return;
    }
    if (settled !== null) return;
    if (verdict === "wait") {
      void refreshCallsAllowedHere();
      return;
    }
    setDecision({ key: ringKey, verdict });
  }, [ringKey, settled, verdict]);

  return verdict;
}

/* ── The list ─────────────────────────────────────────────────────────────── */

export interface SessionDevicesState {
  /** This device first, then the most recently seen. */
  readonly devices: readonly SessionDeviceRow[];
  readonly loading: boolean;
  /** The list could not be read at all; the sentence is in `error`. */
  readonly failed: boolean;
  readonly error: string | null;
  /** Session ids whose switch is in flight. */
  readonly pending: ReadonlySet<string>;
  readonly refresh: () => Promise<void>;
  readonly setCalls: (sessionId: string, enabled: boolean) => Promise<void>;
}

/**
 * The person's own authorisations, and the switch on each.
 *
 * No shared store and no polling, for the reason `useDesktopAutostart` has
 * neither: this list has exactly one mount, inside a disclosure somebody has to
 * open. It is read when that happens and written when a switch is pressed.
 *
 * The write is optimistic and reverts on a refusal. Optimism is right here
 * because the function's own answer is the boolean it was given — there is no
 * server-side transformation to wait for — and because the alternative is a
 * switch that does not move under a thumb for a whole round trip.
 */
export function useSessionDevices(input: { readonly enabled: boolean }): SessionDevicesState {
  const { enabled } = input;
  const [devices, setDevices] = useState<readonly SessionDeviceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const refresh = useCallback(async () => {
    const owner = nativeVoiceContext();
    setLoading(true);
    const { data, error: failure } = await looseClient().rpc<unknown>("session_devices_list", {});
    if (isNativeAndroid() && !isCurrentNativeVoiceSession(owner)) return;
    setLoading(false);
    if (failure) {
      setFailed(true);
      setError(sessionDeviceRefusalText(classifySessionDeviceError(failure)));
      return;
    }
    const rows = orderSessionDevices(readSessionDeviceRows(data));
    setFailed(false);
    setError(null);
    setDevices(rows);
    // The current row carries the same column the gate reads, so this read is
    // also a free answer to «may this device ring». One less request, and one
    // that cannot disagree with the list the person is looking at.
    const current = rows.find((row) => row.isCurrent);
    if (current) noteCallsAllowedHere(current.callsEnabled, owner);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const setCalls = useCallback(
    async (sessionId: string, nextEnabled: boolean) => {
      const owner = nativeVoiceContext();
      if (isNativeAndroid() && !isCurrentNativeVoiceSession(owner)) return;
      const before = devices;
      setPending((current) => new Set(current).add(sessionId));
      setDevices((current) =>
        current.map((row) => (row.sessionId === sessionId ? { ...row, callsEnabled: nextEnabled } : row)),
      );
      const wasCurrent = before.some((row) => row.sessionId === sessionId && row.isCurrent);
      if (wasCurrent) noteCallsAllowedHere(nextEnabled, owner);

      const { error: failure } = await looseClient().rpc<unknown>("session_device_set_calls", {
        p_session_id: sessionId,
        p_enabled: nextEnabled,
      });
      if (isNativeAndroid() && !isCurrentNativeVoiceSession(owner)) return;
      setPending((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
      if (!failure) return;

      // Put it back where it was and say why. The sentence reaches the person
      // the way every other refused action in this product does; the switch
      // itself must not be left showing a state the server refused.
      setDevices(before);
      if (wasCurrent) {
        const original = before.find((row) => row.sessionId === sessionId);
        noteCallsAllowedHere(original?.callsEnabled ?? true, owner);
      }
      showActionFeedback({
        kind: "error",
        title: sessionDeviceRefusalText(classifySessionDeviceError(failure)),
        key: "session-devices",
      });
    },
    [devices],
  );

  return { devices, loading, failed, error, pending, refresh, setCalls };
}
