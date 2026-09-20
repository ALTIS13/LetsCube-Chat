"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KubButton, KubIcon } from "@/components/kub";
import { joinVoiceChannel, useVoiceCall } from "@/hooks/useVoiceCall";
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
 * **The record is read before anything can clear it.** `decideVoiceResume` runs
 * in a `useState` initialiser, during the first render, because the effect that
 * forgets a deliberately-left call would otherwise wipe the record at boot —
 * `idle` is both «they hung up» and «nothing has happened yet», and the two are
 * only distinguishable by when they are read.
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

export function VoiceResumeNotice() {
  const call = useVoiceCall();
  const [offer, setOffer] = useState<VoiceResumeRecord | null>(null);
  const acted = useRef(false);

  // Read once, during the first render, before any effect below can forget it.
  const [boot] = useState(() =>
    decideVoiceResume({ record: readVoiceResume(), now: Date.now() }),
  );

  const returnToCall = useCallback((record: VoiceResumeRecord) => {
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
  }, []);

  // The boot decision, acted on once.
  useEffect(() => {
    if (acted.current) return;
    acted.current = true;
    if (boot.kind === "return") returnToCall(boot.record);
    else if (boot.kind === "offer") setOffer(boot.record);
  }, [boot, returnToCall]);

  // While the call is up, the record is what it would take to rebuild it.
  const live = call.phase === "connected" || call.phase === "reconnecting";
  const { channelId, chatId, channelName, micMuted } = call;
  useEffect(() => {
    if (!live || !channelId || !chatId) return undefined;
    const write = () => {
      writeVoiceResume({
        channelId,
        chatId,
        channelName: channelName ?? "",
        micMuted,
        at: Date.now(),
        // What the product has not taken away is, as far as this record knows,
        // still the person's own. `AppUpdateBanner` upgrades it the moment the
        // product decides to reload the page.
        cause: "unplanned",
      });
    };
    write();
    const timer = window.setInterval(write, VOICE_RESUME_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [live, channelId, chatId, channelName, micMuted]);

  // Hanging up forgets. `idle` after the first render is a decision somebody
  // made; `idle` at boot was already read above.
  useEffect(() => {
    if (call.phase === "idle" && acted.current) clearVoiceResume();
  }, [call.phase]);

  // A call that closed under its own transport, retried while the window holds.
  const dropped = call.phase === "failed";
  useEffect(() => {
    if (!dropped) return undefined;
    const record = readVoiceResume();
    if (!record) return undefined;
    if (decideVoiceResume({ record, now: Date.now() }).kind === "none") return undefined;
    const timers = RETRY_AT_MS.map((delay) =>
      window.setTimeout(() => {
        // Re-read every time: the person may have hung up, joined somewhere
        // else, or let the window close since this timer was set.
        const current = readVoiceResume();
        if (!current) return;
        if (decideVoiceResume({ record: current, now: Date.now() }).kind === "none") return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) return;
        returnToCall(current);
      }, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dropped, returnToCall]);

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
