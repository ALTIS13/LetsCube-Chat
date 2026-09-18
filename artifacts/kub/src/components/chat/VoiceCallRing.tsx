"use client";

import { useEffect, useState } from "react";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { useAppStore } from "@/store/app.store";
import { showActionFeedback } from "@/lib/actionFeedback";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { FOCUS_RING, PRESS_FILLED } from "@/lib/controlSurface";
import { voiceRingState, voiceRingView } from "@/lib/voiceRing";
import {
  answerVoiceRing,
  cancelVoiceRing,
  declineVoiceRing,
  useVoiceRingPick,
  type VoiceRingOutcome,
} from "@/hooks/useVoiceRing";
import { useAudioSettings } from "@/hooks/useAudioSettings";
import { useIncomingRingGate } from "@/hooks/useSessionDevices";
import { useCallSoundPriming, useVoiceRingSound } from "@/hooks/useCallSound";
import { cn } from "@/lib/utils";

/**
 * Somebody is calling, or somebody is being called.
 *
 * The rule — which ring, which way round, and what it says — is
 * `lib/voiceRing.ts`, pure and tested without a browser. What it sounds like is
 * `lib/callSounds.ts`, pure for the same reason. What is here is the drawing.
 *
 * **One surface for both directions, not two.** An incoming call and an
 * outgoing one are the same fact seen from its two ends: one row, one name, one
 * line above it, and either two buttons or one. Two components would be two
 * places for the words to drift apart, which is the rule `lib/voiceCallBar.ts`
 * was written under — the bar and the capsule are two windows onto one call and
 * neither invents a word of its own.
 *
 * **One shape, in the flow, on every shell** — and it took two captures to get
 * there, one at each width, each of which killed a different version.
 *
 * At 390 it was first a card fixed to the top of the window. It landed squarely
 * over the chat header, which on a phone carries the only way back to the chat
 * list (D-047): a call that hides the back button for forty-five seconds traps
 * somebody in a conversation.
 *
 * So the phone's became a band in the flow and the computer's stayed a fixed
 * card — `DesktopUpdatePill`'s arithmetic, the one other thing here that hangs
 * off the window's top edge. Photographed at 1440, that card sat across the
 * conversation's date separator and its «НОВЫЕ СООБЩЕНИЯ» mark, both of them
 * clipped behind it. Which is the same defect as the phone's, one element down:
 * **a fixed thing over a scroller covers whatever is under it, and there is no
 * arithmetic that makes that false** — the rule this project already wrote down
 * as «reserve room inside the scroller, not by shrinking the container».
 *
 * A reservation would be the other answer and it is the more expensive one: a
 * token, a scroller that reads it, and a second thing to keep in step with the
 * call bar's. In the flow there is nothing to keep in step — the shell moves
 * down by the band's height and nothing anywhere is covered, at any width. So
 * it is a band at every width, not a card from `md`.
 *
 * **Above the media viewer and above a dialog.** `z-[96]` sits over
 * `KubModal`'s 95 and the viewer's 90 and under `BannedScreen`'s 100. A call
 * that arrived while somebody was looking at a photograph has to be answerable
 * without finding the close button first; a banned account has nothing to
 * answer.
 *
 * **It draws nothing once the call is answered.** From that moment the pair are
 * in a room and `VoiceCallBar` carries it, with the same mute, deafen and leave
 * every other call has. That hand-over is `pickVoiceRing`'s: it answers only
 * for a ring that is still `ringing`.
 *
 * ## What changed on 2026-09-18, and why
 *
 * The owner made the first real call and missed it: «непонятно», and «более
 * явный вид самих звонков». The band existed and read as a list row — an
 * avatar, a bold name, a grey second line and two small tinted circles, which
 * is the shape of every conversation in the list above it. Four things were
 * wrong with that and each is answered separately below.
 *
 *  1. **The band did not say what it was before it said who.** The state is now
 *     the line above the name rather than under it: the eye answers «звонок»
 *     before it answers «Анна», which is the order the question arrives in. The
 *     two sentences are `voiceRingView`'s and unchanged — only their order,
 *     their weight and their colour are new.
 *  2. **It was the same colour as the chrome.** An incoming call now tints the
 *     whole band with the accent and carries a 2px accent edge along the
 *     bottom. Outgoing deliberately does not: a person who is calling somebody
 *     knows they are, and the two states have to stay apart at a glance.
 *  3. **Nothing moved.** The avatar wears an expanding ring while a call is
 *     coming in — `kub-call-pulse`, which reduced motion turns into a static
 *     ring rather than into nothing, so the emphasis survives the preference.
 *  4. **Accept and decline were two circles of the same size.** They are filled
 *     buttons with words now, and four separate things tell them apart: the
 *     colour, the glyph, the label and the order — decline to the left, where a
 *     thumb does not rest. On a phone they take a row of their own at full
 *     width, which is what an incoming call looks like on every telephone ever
 *     made; from `md` they sit at the right end of the one row.
 */
export function VoiceCallRing() {
  const selfId = useAppStore((state) => state.currentUser?.id ?? null);
  const offered = useVoiceRingPick(selfId);
  /**
   * Slice F: a device its owner has turned off shows **nothing** for an
   * incoming call, which is Telegram's behaviour and the owner's answer to open
   * question 7 of the proposal.
   *
   * Applied to the pick rather than inside the drawing, and that is what makes
   * it silence the sound as well: with no pick there is no ring to render and
   * `useVoiceRingSound` is handed `idle`, which is silence in every direction. A
   * second switch inside the JSX would have had to be remembered twice.
   *
   * **Only an incoming ring** — `incomingRingVerdict` refuses to touch an outgoing
   * one. A call this person started is theirs to cancel whatever they have said
   * about calls arriving here, and the cancel control is the only thing that
   * clears the row from the caller's side.
   *
   * `wait` draws nothing either, and it lasts one round trip at most: the gate
   * carries its own deadline and answers `true` if the server does not.
   */
  const gate = useIncomingRingGate({
    ringKey: offered ? `${offered.ring.channelId}@${offered.ring.startedAt}` : null,
    direction: offered?.direction ?? null,
  });
  const pick = gate === "show" ? offered : null;
  const chatId = pick?.ring.chatId ?? null;
  // Scalar selectors, so a change anywhere else in the chat list does not
  // re-render this card, and read from the list the reader already has rather
  // than fetched: a ring is not worth a request, and `VoiceCallBar` names the
  // group the same way for the same reason.
  const who = useAppStore((state) => {
    const chat = chatId ? state.chats.find((entry) => entry.id === chatId) : undefined;
    return chat ? getChatDisplayInfo(chat, state.currentUser?.id ?? null).title : null;
  });
  const face = useAppStore(
    (state) =>
      (chatId ? state.chats.find((entry) => entry.id === chatId)?.other_user?.avatar_url : null) ?? null,
  );
  const otherId = useAppStore(
    (state) => (chatId ? state.chats.find((entry) => entry.id === chatId)?.other_user?.id : null) ?? null,
  );
  const [busy, setBusy] = useState(false);
  const { settings } = useAudioSettings();

  const channelId = pick?.ring.channelId ?? null;
  const startedAt = pick?.ring.startedAt ?? null;
  // A press belongs to one ring. Without this, a cancel that was still in
  // flight when the next call arrived would leave its buttons refusing.
  useEffect(() => {
    setBusy(false);
  }, [channelId, startedAt]);

  const view = voiceRingView({ pick, who, busy });

  /**
   * The sound, driven by the ring's own state.
   *
   * The state is re-derived here rather than taken as «`pick` is not null»,
   * and the second evaluation is not redundant: `pickVoiceRing` answers for a
   * ring that is `ringing`, and `voiceRingSound` answers for a state. If the
   * picker ever widened — to carry an answered call, say — the sound would
   * still stop, because the rule it obeys is the state's and not the picker's.
   *
   * Every way a ring ends arrives here as a state that is not `ringing`, or as
   * no pick at all: answered here, answered on another of this person's
   * devices, declined at either end, cancelled, run out after forty-five
   * seconds, or the row gone because somebody hung up. The unmount is the
   * effect's own cleanup. None of them is a handler.
   */
  useVoiceRingSound({
    state: pick
      ? voiceRingState({
          startedAt: pick.ring.startedAt,
          answeredAt: pick.ring.answeredAt,
          now: Date.now(),
        })
      : "idle",
    direction: pick?.direction ?? null,
    enabled: settings.callSoundEnabled,
  });
  // This component is mounted for the whole signed-in session, whether or not
  // anything is ringing, which makes it the one place a listener that has to
  // outlive every call can live.
  useCallSoundPriming();

  const run = async (action: () => Promise<VoiceRingOutcome>) => {
    if (busy) return;
    setBusy(true);
    const outcome = await action();
    setBusy(false);
    if (!outcome.ok) {
      // The sentence is `voiceRingRefusalText`'s. It reaches the person the way
      // every other refused action in this product does rather than through a
      // state of its own, because the card it would have to appear in is
      // usually gone by then: `not_ringing` means somebody's other device
      // answered, and the row has already cleared.
      showActionFeedback({ kind: "error", title: outcome.refusal, key: "voice-ring" });
    }
  };

  if (!view.visible || !pick) return null;

  const incoming = view.direction === "incoming";
  /**
   * Whether the actions take a row of their own on a phone.
   *
   * Only an incoming call does. Photographed at 390 with both directions
   * wrapping: an outgoing call came out as a full-width red bar saying
   * «Отменить», which read as more urgent than the incoming call beside it —
   * and it is the quieter of the two states, not the louder. A call somebody
   * started needs one control at the end of the line it is already on.
   */
  const splitRow = view.answer && view.decline;

  return (
    <div
      className={cn(
        // A band at the top of the shell, in the flow, at every width. The top
        // padding carries the hardware's inset and the Windows caption out of
        // the way because nothing is above this element on any shell.
        "relative z-[96] w-full shrink-0 border-b",
        // The bottom edge is the band's own, so it may carry the state: rule 11
        // of the material contract is about a border belonging to the thing you
        // are aiming at, and what is being aimed at here is the band.
        incoming
          ? "border-b-2 border-[color:var(--kub-cyan)]"
          : "border-[color:var(--kub-rule)]",
        "pt-[calc(var(--kub-safe-top)+var(--kub-window-caption))]",
      )}
      // `region`, deliberately not `dialog`. `MainLayout`'s Escape handler
      // treats any `role="dialog"` on the page as something that owns the key
      // (D-194), and a ring is not something Escape closes — it is answered or
      // declined. `assertive` because an incoming call is the one notice in
      // this product that cannot wait for a pause in the reading — and on a
      // page whose sound a browser has refused, this announcement and the paint
      // are the whole of the notice.
      role="region"
      aria-live={incoming ? "assertive" : "polite"}
      aria-label={incoming ? "Входящий звонок" : "Исходящий звонок"}
      data-testid="voice-ring"
      data-direction={view.direction}
      data-busy={view.busy ? "true" : "false"}
    >
      {/* `strong`, which is what that prop is for: «a surface that covers
          content it is not part of». Measured at 390 with the panel material
          instead — the card lands over the chat list's search field and the
          placeholder inside it read straight through the glass, so the caller's
          name sat on top of somebody else's words. */}
      <KubGlassLayer strong />
      {/* The accent wash, and only for a call coming in. `color-mix` over the
          material rather than a fill of its own: the same form the buttons in
          this file have always used, so the material underneath still does the
          blurring and rule 1 is not broken by a second surface. */}
      {incoming && (
        <span
          aria-hidden="true"
          data-testid="voice-ring-wash"
          className="pointer-events-none absolute inset-0 bg-[color-mix(in_srgb,var(--kub-cyan)_12%,transparent)]"
        />
      )}
      <div className="relative flex flex-wrap items-center gap-3 p-3 md:px-4 md:py-3.5">
        <span className="relative shrink-0">
          {/* An expanding ring, on the avatar rather than on the band: a band
              that pulsed would move the whole shell under it every 1.6 seconds.
              Half the ring's own 3.2-second cadence, which is a matter of feel
              rather than of synchrony — nothing here knows when a burst starts,
              and claiming it did would be a lie in a comment. */}
          {incoming && (
            <span aria-hidden="true" data-testid="voice-ring-pulse" className="kub-call-pulse" />
          )}
          <ChatAvatar
            chat={{ id: chatId ?? "", name: view.who, avatar_url: face, type: "private" }}
            size="lg"
            profileId={otherId}
          />
        </span>
        <span className="min-w-0 flex-1 basis-32">
          {/* The state, above the name. What this band is has to be readable
              before who it is about — the defect it is answering is that a
              bold name over a grey line is the shape of a chat-list row, and
              the owner read it as one. */}
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs font-semibold",
              incoming ? "text-[color:var(--kub-accent-text)]" : "text-[color:var(--kub-muted)]",
            )}
            data-testid="voice-ring-detail"
          >
            <KubIcon
              name={incoming ? "phoneIncoming" : "phoneOutgoing"}
              size={14}
              tone={incoming ? "accent" : "muted"}
            />
            {view.detail}
          </span>
          <span
            className="block truncate text-base font-semibold leading-tight text-[color:var(--kub-text)] md:text-lg"
            data-testid="voice-ring-who"
          >
            {view.who}
          </span>
        </span>

        {/* `w-full` under `md` puts the two buttons on a line of their own,
            which the wrap on the parent gives for nothing — no second layout,
            no breakpoint arithmetic, and the band simply grows by a row. From
            `md` they sit at the right end of the one row, and a single control
            never leaves that line at all. */}
        <span
          className={cn(
            "flex items-center gap-2",
            splitRow ? "w-full md:w-auto" : "ml-auto w-auto",
          )}
        >
          {/* Decline before answer, left to right, which is where every
              telephone in the world puts them: the destructive one is the one a
              thumb reaches by accident, so it goes furthest from the thumb's
              resting edge and the accepting one sits under it. */}
          {view.decline && (
            <RingAction
              tone="danger"
              icon="phoneOff"
              label={view.declineLabel}
              busy={view.busy}
              grow={splitRow}
              testId="voice-ring-decline"
              onPress={() => void run(() => declineVoiceRing(pick.ring))}
            />
          )}
          {view.answer && (
            <RingAction
              tone="accept"
              icon="phone"
              label={view.answerLabel}
              busy={view.busy}
              grow={splitRow}
              testId="voice-ring-answer"
              onPress={() => void run(() => answerVoiceRing(pick.ring, view.who))}
            />
          )}
          {view.cancel && (
            /* One control, and it carries its word. «Отменить» beside a
               telephone is the difference between hanging up and hanging up on
               somebody. */
            <RingAction
              tone="danger"
              icon="phoneOff"
              label={view.cancelLabel}
              busy={view.busy}
              grow={false}
              testId="voice-ring-cancel"
              onPress={() => void run(() => cancelVoiceRing(pick.ring))}
            />
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * One of the band's controls: filled, labelled, and the same object twice.
 *
 * Filled rather than tinted, which is the change that matters. Two 44px circles
 * holding two glyphs, one tinted red at 18% and one cyan at 22%, are told apart
 * by a glyph 18px across and a colour at a fifth of its strength — and they are
 * the two controls in this product where being told apart matters most. Filled
 * with the action tokens, carrying their words, they cannot be confused: the
 * colour, the glyph, the label and the order all say the same thing.
 *
 * Not `KubButton`, because the two halves have to be equal at the phone's width
 * — `flex-1` on each and `w-auto` from `md` — and a variant that owned its own
 * width would have to be told not to. Everything else it would have brought is
 * taken from the same places it takes it from: `controlSurface`'s focus ring
 * and press, and `kub-button`'s coarse-pointer target rule (D-015).
 */
function RingAction({
  tone,
  icon,
  label,
  busy,
  grow,
  testId,
  onPress,
}: {
  tone: "accept" | "danger";
  icon: "phone" | "phoneOff";
  label: string;
  busy: boolean;
  /** Equal halves of the phone's action row. False for a control that is alone. */
  grow: boolean;
  testId: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={busy}
      className={cn(
        "kub-button kub-interactive flex h-11 items-center justify-center gap-2 rounded-xl px-4",
        "text-sm font-semibold",
        grow ? "flex-1 md:flex-none" : "flex-none",
        tone === "accept"
          ? "bg-[var(--kub-action-primary-background)] text-[color:var(--kub-action-primary-foreground)] hover:bg-[var(--kub-action-primary-hover)]"
          : "bg-[var(--kub-action-danger-background)] text-[color:var(--kub-action-danger-foreground)] hover:bg-[var(--kub-action-danger-hover)]",
        busy && "cursor-not-allowed opacity-70",
        // `PRESS_FILLED` rather than `PRESS_SINK`: a filled control presses by
        // darkening its own fill, where a tinted one presses by sinking into
        // what it is laid on. Both are `controlSurface`'s; taking the wrong one
        // here would be a control that presses like a different kind of thing.
        PRESS_FILLED,
        FOCUS_RING,
      )}
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      <KubIcon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}
