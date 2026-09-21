"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { joinVoiceChannel, useVoiceCall } from "@/hooks/useVoiceCall";
import { useAuthRuntime } from "@/lib/authRuntime";
import {
  VOICE_RESUME_HEARTBEAT_MS,
  VOICE_RESUME_WINDOW_MS,
  decideVoiceResume,
  type VoiceResumeRecord,
} from "@/lib/voiceResume";
import { clearVoiceResume, readVoiceResume, writeVoiceResume } from "@/lib/voiceResumeStorage";

/**
 * Putting somebody back in the voice channel they were taken out of.
 *
 * `lib/voiceResume.ts` carries the argument — the owner named two cases, both
 * of them interruptions the product caused, and the split here is the shape of
 * his sentence rather than a compromise with it. What is in this file is the
 * wiring, and four things the rule cannot know.
 *
 * **Boot and hang-up are distinct.** `VoiceResumeRecordSync` forgets a record
 * only on a transition to idle, not an idle mount. The authenticated notice
 * reads once; returning from a public page with a live call is not a new boot.
 *
 * **A drop keeps the record; a hang-up forgets it.** That needs no branch. A
 * refusal at join time — a declined microphone, a full room — never reached
 * `connected`, so no record was ever written and there is nothing to return to.
 * Only a call that was up can leave one behind.
 *
 * **The in-page drop is the owner's headline case** — «по возврату связи».
 * `onClosed` publishes `failed`, and from there nothing in the product tried
 * again. Here it retries while the window is open and the browser says it is
 * online, spaced out rather than in a spin, and gives up when the window
 * closes. It is «join again», not «reconnect»: `empty_timeout` may already have
 * closed the room, and `auto_create` is off, so the return goes through the
 * gateway's idempotent `CreateRoom` exactly as a first join does.
 *
 * **A return is silent but never invisible.** `VoiceCallShell` wraps every
 * authenticated route, so the call bar is on screen wherever this can act —
 * which is what makes a microphone coming back on something a person can see
 * rather than something that happens to them (D-281).
 */

/**
 * When to try again after a drop, in ms from the moment the call closed.
 *
 * Spaced rather than immediate-and-repeated: the first attempt covers a
 * transport that died on its own, and the later ones cover a network that is
 * still coming back. All of them are clamped by the window, so the last attempt
 * that can run is the last one inside five minutes.
 */
const RETRY_AT_MS = [1_000, 5_000, 15_000, 45_000, 120_000, 240_000] as const;

export function VoiceResumeNotice({
  userId,
  claimBootResume,
}: {
  userId: string;
  claimBootResume: () => boolean;
}) {
  const authRuntime = useAuthRuntime();
  const call = useVoiceCall();
  const [offer, setOffer] = useState<VoiceResumeRecord | null>(null);
  const acted = useRef(false);

  // Read once, during the first render, before any effect below can forget it.
  const [boot] = useState(() => decideVoiceResume({
    record: call.phase === "idle" || call.phase === "failed" ? readVoiceResume() : null,
    now: Date.now(),
    userId,
  }));

  const returnToCall = useCallback((record: VoiceResumeRecord) => {
    // The offer may have been rendered for the previous account immediately
    // before an auth event. Refuse before clear/capture, independently of the
    // transport generation guard that protects work already in flight.
    if (
      authRuntime.loading ||
      authRuntime.userId !== userId ||
      record.userId !== authRuntime.userId
    ) {
      return;
    }
    // Cleared before the attempt, not after: a join that fails must not leave a
    // record that tries again on the next boot, and the same reasoning as the
    // quiet restart's cooldown in `appUpdateNotice.ts`. If the join succeeds the
    // live call writes a fresh record within a heartbeat.
    clearVoiceResume();
    void joinVoiceChannel({
      channelId: record.channelId,
      chatId: record.chatId,
      channelName: record.channelName,
      micMuted: record.micMuted,
    });
  }, [authRuntime.loading, authRuntime.userId, userId]);

  // The boot decision, acted on once.
  useEffect(() => {
    if (acted.current) return;
    acted.current = true;
    // This one-shot decision is deliberately made in the guarded effect, not
    // the state initializer: React StrictMode may invoke lazy initializers
    // twice and must not spend the configured root's claim on a discarded run.
    if (!claimBootResume()) return;
    if (boot.kind === "return") returnToCall(boot.record);
    else if (boot.kind === "offer") setOffer(boot.record);
  }, [boot, claimBootResume, returnToCall]);

  const live = call.phase === "connected" || call.phase === "reconnecting";

  // An offer is spent by pressing it, and it is gone once the window closes
  // under it — a button that returns nobody is worse than no button.
  useEffect(() => {
    if (!offer) return undefined;
    const remaining = offer.at + VOICE_RESUME_WINDOW_MS - Date.now();
    if (remaining <= 0) {
      setOffer(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setOffer(null), remaining);
    return () => window.clearTimeout(timer);
  }, [offer]);

  if (!offer || live || call.phase === "joining") return null;
  return (
    <div
      // The update notice's material, and deliberately **not** its position.
      //
      // That one floats at `safe-top + 6.75rem`, which clears a conversation's
      // header. This one appears on the chat list, where the same offset lands
      // on the folder tabs and the first row: measured at 390, the offer stood
      // at y 108-164 and the first chat row at 124-192, so the row's own centre
      // was inside the notice — a row taken away for as long as the offer
      // stands, which here is up to five minutes rather than a moment (D-264's
      // lesson, and the reason the hit-test in the spec is not optional).
      //
      // So on a phone it sits above the bottom bar instead, placed from that
      // bar's own variables rather than a number that would go stale the day
      // the bar changes height. From `md` up the bar is `md:hidden` and the
      // top band is clear, which is where it goes.
      className="kub-glass-strong kub-menu-in fixed left-1/2 bottom-[calc(var(--kub-bottom-nav)+var(--kub-bottom-nav-gap)+0.75rem)] z-[80] flex w-[calc(100vw-1.5rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-2xl border border-[color:var(--kub-border-color)] py-2 pl-3 pr-2 md:bottom-auto md:top-[calc(var(--kub-safe-top)+6.75rem)]"
      role="status"
      aria-live="polite"
      data-testid="voice-resume-offer"
    >
      <span className="shrink-0 text-[color:var(--kub-cyan)]" aria-hidden="true">
        <KubIcon name="phoneIncoming" size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[color:var(--kub-text)]">
          Вернуться в разговор
        </span>
        {/* Not `truncate`: a notice whose own sentence does not fit is the
            defect it exists to avoid. The channel's name is the one part worth
            clipping, and it is clipped above. */}
        <span className="block text-xs leading-snug text-[color:var(--kub-muted)]">
          {offer.channelName ? `Вы были в «${offer.channelName}»` : "Вы были в голосовом канале"}
        </span>
      </span>
      <KubButton
        size="sm"
        variant="primary"
        onClick={() => {
          const record = offer;
          setOffer(null);
          returnToCall(record);
        }}
        data-testid="voice-resume-return"
      >
        Вернуться
      </KubButton>
    </div>
  );
}

type RuntimeCall = {
  userId: string;
  channelId: string;
  chatId: string;
};

/**
 * Retry only a call this mounted runtime observed alive.
 *
 * It deliberately has no boot path: a stored record on a public page is not
 * authority to capture a microphone. Keeping this controller above the route
 * split lets the same live call recover after `/privacy` replaces AppRoutes.
 */
export function VoiceResumeRuntimeController() {
  const { userId, loading } = useAuthRuntime();
  const { phase, channelId, chatId } = useVoiceCall();
  const activeCall = useRef<RuntimeCall | null>(null);
  const retryStartedAt = useRef<number | null>(null);
  const retryIndex = useRef(0);
  const live = phase === "connected" || phase === "reconnecting";

  useEffect(() => {
    if (loading || !userId) {
      activeCall.current = null;
      retryStartedAt.current = null;
      retryIndex.current = 0;
      return;
    }
    if (live && channelId && chatId) {
      activeCall.current = { userId, channelId, chatId };
      retryStartedAt.current = null;
      retryIndex.current = 0;
      return;
    }
    if (phase === "idle") {
      activeCall.current = null;
      retryStartedAt.current = null;
      retryIndex.current = 0;
    }
  }, [loading, userId, live, phase, channelId, chatId]);

  useEffect(() => {
    if (phase !== "failed" || loading || !userId) return undefined;
    const observed = activeCall.current;
    if (!observed || observed.userId !== userId) return undefined;

    const saved = readVoiceResume();
    const decision = decideVoiceResume({ record: saved, now: Date.now(), userId });
    if (decision.kind === "none") return undefined;
    if (decision.record.channelId !== observed.channelId || decision.record.chatId !== observed.chatId) {
      return undefined;
    }

    retryStartedAt.current ??= Date.now();
    let cancelled = false;
    let timer: number | undefined;

    const scheduleNext = () => {
      const index = retryIndex.current;
      if (index >= RETRY_AT_MS.length || retryStartedAt.current === null) return;
      const target = retryStartedAt.current + RETRY_AT_MS[index];
      timer = window.setTimeout(() => {
        if (cancelled) return;
        retryIndex.current = index + 1;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          scheduleNext();
          return;
        }

        const current = readVoiceResume();
        const currentDecision = decideVoiceResume({ record: current, now: Date.now(), userId });
        if (currentDecision.kind === "none") return;
        if (
          currentDecision.record.channelId !== observed.channelId ||
          currentDecision.record.chatId !== observed.chatId
        ) {
          return;
        }
        void joinVoiceChannel({
          channelId: currentDecision.record.channelId,
          chatId: currentDecision.record.chatId,
          channelName: currentDecision.record.channelName,
          micMuted: currentDecision.record.micMuted,
        }).finally(() => {
          // A very fast refusal can publish `joining` and `failed` in one
          // React batch. Then `phase` appears unchanged and the effect does not
          // rerun, so continue the same schedule here. A rendered transition,
          // successful join or identity change cleans the effect first.
          if (!cancelled) scheduleNext();
        });
      }, Math.max(0, target - Date.now()));
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [phase, loading, userId]);

  return null;
}

/** Persist the current call on every route without ever starting a microphone. */
export function VoiceResumeRecordSync() {
  const { userId, loading } = useAuthRuntime();
  const { phase, channelId, chatId, channelName, micMuted } = useVoiceCall();
  const previousPhase = useRef(phase);
  const live = phase === "connected" || phase === "reconnecting";

  useEffect(() => {
    if (loading || !userId || !live || !channelId || !chatId) return;
    const write = () => writeVoiceResume({
      userId, channelId, chatId, channelName: channelName ?? "", micMuted,
      at: Date.now(), cause: "unplanned",
    });
    write();
    const timer = window.setInterval(write, VOICE_RESUME_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [loading, userId, live, channelId, chatId, channelName, micMuted]);

  useEffect(() => {
    // A real hang-up clears the record; idle at first render must not consume
    // a saved call before the authenticated resume gate can inspect it.
    if (phase === "idle" && previousPhase.current !== "idle") clearVoiceResume();
    previousPhase.current = phase;
  }, [phase]);

  return null;
}
