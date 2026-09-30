"use client";

import { useEffect, useSyncExternalStore } from "react";
import { refreshPrivacyPreferences, usePrivacyPreferences } from "@/hooks/usePrivacyPreferences";
import { voiceSelfIdSnapshot, voiceSpeakersSnapshot } from "@/hooks/useVoiceCall";
import { ownStatus, statusUntilMs, type ManualStatus } from "@/lib/presenceStatus";

/**
 * This person's own presence on this device — tracker item 37. The rules are
 * `lib/presenceStatus.ts`'s; this is what feeds them.
 *
 * **What counts as activity.** Discord's browser client counts clicks, the wheel
 * and keys in its window, and speech; its desktop client the whole machine's
 * input (`reference-clients.md` §25). This counts the pointer moving as well —
 * the owner's «только при движении мышью учитывает онлайн» — throttled, touch,
 * keys, the wheel, the window coming back into view, the person's own speech in
 * a call, and **a video playing**: somebody watching a stream is not idle, which
 * is the false positive the owner named and the one Discord answers by exempting
 * a running stream outright.
 *
 * **What it drives.** The status this device shows its own person, and the
 * moment of the last activity, which the heartbeat reports with every beat.
 * What others see is decided by the database from every device's report
 * (`presence_beat`), so nothing here writes a status. A change others should
 * see at once — back from idle, a chosen status running out — asks the
 * heartbeat for a beat now rather than at its next minute. A new choice does
 * not: `presence_set_status` publishes it itself, and a beat sent beside it
 * could read the row before the choice is committed and publish the old status
 * over the new one.
 */

let lastActivityAt = Date.now();
const DEFAULT_INPUTS = { presenceVisible: true, manual: "online" as ManualStatus, until: null as number | null };
let inputs = DEFAULT_INPUTS;
let current: ManualStatus = "online";
const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();

/**
 * `announce`: whether others should be told now. True for what only this
 * device can see happen — activity after quiet, time running out — and false
 * for a new choice, which its own call has already published.
 */
function recompute(announce: boolean): void {
  const next = ownStatus({ ...inputs, lastActivityAt, now: Date.now() });
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
  if (announce) for (const listener of changeListeners) listener();
}

/** Something the person did. Coming back from idle is published at once. */
export function noteActivity(): void {
  lastActivityAt = Date.now();
  if (current === "idle") recompute(true);
}

/** When this person last did something here, for the heartbeat to report. */
export function lastActivityIso(): string {
  return new Date(lastActivityAt).toISOString();
}

/** Called when this device's status changes, for a beat that says so now. */
export function onOwnStatusChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** A video that is playing counts: the stream exemption. */
function mediaIsPlaying(): boolean {
  if (typeof document === "undefined") return false;
  for (const element of Array.from(document.querySelectorAll("video"))) {
    if (!element.paused && !element.ended && element.readyState > 2) return true;
  }
  return false;
}

function speakingNow(): boolean {
  const self = voiceSelfIdSnapshot();
  return Boolean(self && voiceSpeakersSnapshot().includes(self));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => current;

/** How this person appears to themselves here: their own panel's dot. */
export function useOwnPresence(): ManualStatus {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Read once, outside React: for a sound deciding whether to play. */
export function ownPresenceSnapshot(): ManualStatus {
  return current;
}

/**
 * The runtime: activity listeners, a tick every 30 seconds for what a listener
 * cannot hear (speech, a playing video, a status running out), and the inputs
 * from the privacy store — only once they are this account's. Mounted once,
 * beside the heartbeat.
 */
export function useOwnPresenceRuntime(userId: string | null): void {
  const privacy = usePrivacyPreferences();
  const settled = !privacy.loading && privacy.userId === userId && userId !== null;

  useEffect(() => {
    inputs = settled
      ? {
          presenceVisible: privacy.preferences.presenceVisible,
          manual: privacy.preferences.manualStatus,
          until: statusUntilMs(privacy.preferences.manualStatusUntil),
        }
      : DEFAULT_INPUTS;
    recompute(false);
  }, [
    settled,
    privacy.preferences.manualStatus,
    privacy.preferences.manualStatusUntil,
    privacy.preferences.presenceVisible,
  ]);

  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    lastActivityAt = Date.now();
    let lastMove = 0;
    const onMove = () => {
      const now = Date.now();
      if (now - lastMove < 5_000) return;
      lastMove = now;
      noteActivity();
    };
    const onInput = () => noteActivity();
    // Back into view, or into focus: somebody is here, and a status chosen on
    // another device meanwhile is asked for again.
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      noteActivity();
      void refreshPrivacyPreferences(userId);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onInput, { passive: true });
    window.addEventListener("keydown", onInput);
    window.addEventListener("wheel", onInput, { passive: true });
    window.addEventListener("touchstart", onInput, { passive: true });
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    const tick = window.setInterval(() => {
      if (speakingNow() || mediaIsPlaying()) noteActivity();
      recompute(true);
    }, 30_000);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onInput);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("wheel", onInput);
      window.removeEventListener("touchstart", onInput);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      window.clearInterval(tick);
    };
  }, [userId]);
}
