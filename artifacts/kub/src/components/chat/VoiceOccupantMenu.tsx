"use client";

import { useCallback, useState, type CSSProperties } from "react";
import { KubIcon } from "@/components/kub";
import {
  RowActionHeader,
  RowActionMenu,
  RowActionSheet,
  rowMenuPlacement,
  type RowAction,
  type RowMenuPlacement,
} from "@/components/kub/RowActions";
import { TinyUserAvatar } from "./MessageReactions";
import { useVoiceCall } from "@/hooks/useVoiceCall";
import { useVoiceModeration } from "@/hooks/useVoiceModeration";
import {
  setVoiceParticipantLocalMute,
  useSetVoiceParticipantVolume,
  useVoiceParticipantLocalMute,
  useVoiceParticipantVolume,
} from "@/hooks/useVoiceVolume";
import { requestAppConfirm } from "@/lib/appDialogs";
import { voiceModerationActions, type VoiceModerationAction } from "@/lib/voiceModeration";
import {
  occupantMenuOffersSomething,
  voiceLocalMuteLabel,
  voiceVolumeLabel,
  voiceVolumeNotice,
  voiceVolumeOffer,
  VOICE_VOLUME_STEP,
  type VoiceAudioSource,
  type VoiceVolumeOffer,
} from "@/lib/voiceVolume";
import { useAppStore } from "@/store/app.store";

/**
 * What pressing a person in a voice room offers, wherever their face is drawn
 * (D-266, D-267).
 *
 * The owner, 2026-09-20: «мало функционала при нажатии на пользователя». The
 * menu existed, was well built, and was reachable from exactly one of the three
 * places a participant is drawn — the server-channel rail, which a group call
 * never opens. The capsule's faces and the information panel's voice room drew
 * the same people and did nothing. So the menu moved out of the rail into this
 * module, and the rail, the capsule and the panel all open the same one: one
 * implementation, three doors — the arrangement D-283 settled for the contact
 * card.
 *
 * It carries the four entries D-266 chose from Discord's voice member menu, in
 * its order: **Громкость**, **Заглушить для себя** (D-267 — Discord's local
 * mute, kept apart from the volume as its media settings keep `localMutes`
 * apart from `localVolumes`), **Профиль**, and the moderation pair for the two
 * roles that hold it. Deliberately fewer than Discord's twelve; D-266 says why
 * each of the rest is refused.
 */

/** One person in a voice room, as much of them as the menu reads. */
export interface VoiceOccupant {
  readonly userId: string;
  readonly name: string;
  readonly canSpeak: boolean | null;
  readonly audioSource: VoiceAudioSource | null;
  readonly face: string | null;
}

/** Who is reading, and what they may do in this group. */
export interface VoiceOccupantScope {
  readonly selfId: string | null;
  /** This reader's role in the group: `owner`, `admin`, `member`, or null. */
  readonly role: string | null;
  /**
   * Any member's role in this group. Needed by the moderation half alone: an
   * owner is not offered «Заглушить» on another owner, because the gateway
   * would refuse it.
   */
  readonly roleOf?: (userId: string) => string | null;
}

/** What one person's row offers, decided once for the row and the menu both. */
export interface VoiceOccupantOffer {
  readonly moderatable: boolean;
  readonly volume: VoiceVolumeOffer;
  /** Whether pressing the row opens anything at all. */
  readonly offers: boolean;
}

export function voiceOccupantOffer(scope: VoiceOccupantScope, person: VoiceOccupant): VoiceOccupantOffer {
  const moderationActions = voiceModerationActions(
    { selfId: scope.selfId, role: scope.role },
    { userId: person.userId, role: scope.roleOf?.(person.userId) ?? null, canSpeak: person.canSpeak },
  ).length;
  const volume = voiceVolumeOffer({ selfId: scope.selfId, target: person });
  return {
    moderatable: moderationActions > 0,
    volume,
    // «Профиль» is for everybody a known reader can see, so a row is a door
    // whenever the reader is known — the person is always somebody to open.
    offers: occupantMenuOffersSomething(volume, moderationActions, Boolean(scope.selfId)),
  };
}

/**
 * Above the drawer form of the rail, which stands at `z-[60]`.
 *
 * 80 rather than a fresh number: `ChatInfoPanel` already passes 80 to these
 * same components for exactly this reason, and that was a measurement — the
 * default 50 renders underneath a surface at 60, so a menu opened from the
 * drawer would be painted behind the list it was opened from. One number for
 * one problem.
 */
export const VOICE_OCCUPANT_MENU_LAYER = 80;

/** Which person a menu is open on, and how it was opened. */
interface OpenOccupantMenu {
  readonly channelId: string;
  readonly person: VoiceOccupant;
  /** Their role in the group, for the moderation half. */
  readonly role: string | null;
  /**
   * Whether this listener may set how loud this person is, decided when the
   * menu opened.
   *
   * Read once rather than per render, like `placement` beside it: it is settled
   * by how the room carries that person's voice at the moment of the press, and
   * a menu whose contents changed under the pointer because a track event
   * arrived is worse than one that is a moment stale.
   */
  readonly volume: VoiceVolumeOffer;
  readonly mode: "menu" | "sheet";
  readonly placement: RowMenuPlacement;
}

/**
 * The menu, and the function that opens it on one person.
 *
 * The pointer decides the shape, not the viewport: a coarse pointer gets the
 * sheet from the foot of the screen, everything else gets a menu where the
 * pointer is. That is the same reading `ChatInfoPanel` makes for the same pair
 * of components, and it is a reading about the input device rather than about
 * the window's width — a tablet held sideways is wide and still a finger.
 */
export function useVoiceOccupantMenu(scope: VoiceOccupantScope) {
  const { selfId, role, roleOf } = scope;
  // Kept here rather than in the menu, which unmounts when it closes: the
  // moderation in flight and its answer outlive the menu it was pressed in.
  const moderation = useVoiceModeration();
  const [menu, setMenu] = useState<OpenOccupantMenu | null>(null);

  const open = useCallback(
    (channelId: string, person: VoiceOccupant, position: { x: number; y: number }) => {
      // A row that opens an empty menu is the same defect as a control that
      // does nothing, so the row is not pressable at all in that case — this is
      // the second gate rather than the only one.
      if (!voiceOccupantOffer({ selfId, role, roleOf }, person).offers) return;
      const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
      setMenu({
        channelId,
        person,
        role: roleOf?.(person.userId) ?? null,
        volume: voiceVolumeOffer({ selfId, target: person }),
        mode: coarse ? "sheet" : "menu",
        placement: rowMenuPlacement(position),
      });
    },
    [role, roleOf, selfId],
  );

  const close = useCallback(() => setMenu(null), []);

  const element = menu ? (
    <VoiceOccupantMenuView
      key={`${menu.channelId}:${menu.person.userId}`}
      menu={menu}
      selfId={selfId}
      role={role}
      moderation={moderation}
      onClose={close}
    />
  ) : null;

  return { open, close, element };
}

function VoiceOccupantMenuView({
  menu,
  selfId,
  role,
  moderation,
  onClose,
}: {
  menu: OpenOccupantMenu;
  selfId: string | null;
  role: string | null;
  moderation: ReturnType<typeof useVoiceModeration>;
  onClose: () => void;
}) {
  const { person } = menu;
  const openUserProfile = useAppStore((s) => s.openUserProfile);
  const localMuted = useVoiceParticipantLocalMute(person.userId);

  const actions: RowAction[] = [];
  // D-267. A toggle over its own record rather than the slider dragged to
  // zero: hearing somebody again brings back the loudness chosen for them.
  // Offered where the volume is, because it acts through the same element.
  if (menu.volume === "adjustable") {
    actions.push({
      id: "local-mute",
      label: voiceLocalMuteLabel(localMuted),
      icon: localMuted ? "volume" : "muted",
      run: () => setVoiceParticipantLocalMute(person.userId, !localMuted),
    });
  }
  // Discord's «View Profile»: the entry that makes the menu about a person
  // rather than about a row. The full card over the shell, as the chat list's
  // «Открыть профиль» opens it.
  if (selfId) {
    actions.push({
      id: "profile",
      label: "Профиль",
      icon: "profile",
      run: () => openUserProfile(person.userId),
    });
  }
  for (const action of voiceModerationActions(
    { selfId, role },
    { userId: person.userId, role: menu.role, canSpeak: person.canSpeak },
  )) {
    actions.push({
      id: action,
      ...MODERATION_WORDS[action],
      // Only the disconnect asks. A silence is undone by the item above it
      // and costs nothing to try; putting somebody out of a room interrupts
      // them mid-sentence and cannot be undone from here — they have to come
      // back themselves.
      confirm:
        action === "disconnect"
          ? () =>
              requestAppConfirm({
                title: "Отключить от голосового канала?",
                description: `${person.name} выйдет из разговора. Вернуться в канал это не запрещает.`,
                confirmLabel: "Отключить",
                tone: "danger",
                icon: "userRemove",
              })
          : undefined,
      // The controller's answer is deliberately dropped here: it already said
      // what happened, in a line of its own, and there is nothing this menu
      // does differently on a refusal — it closes either way.
      run: async () => {
        await moderation.moderate({
          channelId: menu.channelId,
          target: { userId: person.userId, name: person.name },
          action,
        });
      },
    });
  }

  const header = (
    <RowActionHeader
      // The person, not the room: one human being with one mark.
      avatar={
        <TinyUserAvatar
          user={{ id: person.userId, full_name: person.name, username: null, avatar_url: person.face }}
        />
      }
      title={person.name}
      // A moderator's silence before this listener's own, which is the order
      // Discord resolves the two in: the room's fact first.
      subtitle={person.canSpeak === false ? "Заглушён модератором" : localMuted ? "Заглушён для вас" : undefined}
    />
  );

  /**
   * The volume band, above the actions and separated from them.
   *
   * It is deliberately not one of the actions: those are a label and a `run`,
   * and this has a value that is dragged. `RowActions` takes it as its own
   * slot, so the two kinds of thing in this menu stay visibly two kinds of
   * thing. Which matters here beyond tidiness: the band is about this
   * listener's own ears and the moderation items are about the room, and a
   * reader must not take one for the other.
   */
  const controls =
    menu.volume !== "not_offered" ? (
      <OccupantVolume userId={person.userId} name={person.name} offer={menu.volume} />
    ) : null;

  const busyActionId =
    moderation.busy && moderation.busy.userId === person.userId ? moderation.busy.action : null;

  /** Ask, then mark busy, then run. The other order puts «Выполняем…» under an unanswered question. */
  const run = async (action: RowAction) => {
    if (action.confirm && !(await action.confirm())) {
      onClose();
      return;
    }
    try {
      await action.run();
    } finally {
      onClose();
    }
  };

  return menu.mode === "menu" ? (
    <RowActionMenu
      header={header}
      actions={actions}
      controls={controls}
      placement={menu.placement}
      busyActionId={busyActionId}
      layer={VOICE_OCCUPANT_MENU_LAYER}
      onClose={onClose}
      onRun={run}
    />
  ) : (
    <RowActionSheet
      header={header}
      actions={actions}
      controls={controls}
      busyActionId={busyActionId}
      layer={VOICE_OCCUPANT_MENU_LAYER}
      onClose={onClose}
      onRun={run}
    />
  );
}

/**
 * How loud one other person is, for this listener alone.
 *
 * Discord's per-user volume. Three things about it are decisions rather than
 * drawing, and all three are in `lib/voiceVolume.ts` where a test reads them:
 * the 0..1 range (above 1 the element's own volume setter throws, because the
 * room carries no `AudioContext`), the sentence under the control, and whether
 * the control is offered at all.
 *
 * **A slider that cannot work is not drawn.** For somebody whose voice the room
 * carries under no microphone source — every build before 2026-09-18, the
 * Android 0.1.7 APK included — `setVolume` finds no publication and changes
 * nothing, silently. A sunk slider would still be a slider, and a reader would
 * still drag it; so the sentence takes its place, which is the one thing that
 * teaches them something true. Rule 5 is why it is not the slider at 40%
 * opacity, and rule 5 is also why nothing here fades.
 *
 * `useVoiceCall` for one field, `deafened`, and it is read here rather than
 * passed down because this component exists only while a menu is open — so the
 * subscription costs the surfaces nothing while they are merely being looked at.
 */
function OccupantVolume({
  userId,
  name,
  offer,
}: {
  userId: string;
  name: string;
  offer: VoiceVolumeOffer;
}) {
  const { deafened } = useVoiceCall();
  const volume = useVoiceParticipantVolume(userId);
  const setVolume = useSetVoiceParticipantVolume(userId);
  const notice = voiceVolumeNotice(offer, deafened);
  const adjustable = offer === "adjustable";

  return (
    // `role="group"` rather than nothing, and it is not decoration: the
    // desktop surface is a `role="menu"`, whose permitted children are
    // menuitems, separators and groups — a bare slider inside one is invalid
    // ARIA and a screen reader may skip it. A group is a legal container and
    // reads its contents.
    <div
      role="group"
      aria-label="Громкость участника"
      className="px-2 py-1.5"
      data-testid="occupant-volume"
      data-offer={offer}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm text-[color:var(--kub-text)]">
          <KubIcon
            name={adjustable && volume === 0 ? "muted" : "volume"}
            size={16}
            tone="muted"
            className="shrink-0"
          />
          <span className="min-w-0 truncate">Громкость</span>
        </span>
        {adjustable && (
          <span
            className="shrink-0 tabular-nums text-xs text-[color:var(--kub-muted)]"
            data-testid="occupant-volume-value"
          >
            {voiceVolumeLabel(volume)}
          </span>
        )}
      </div>
      {adjustable && (
        <input
          type="range"
          min={0}
          max={1}
          step={VOICE_VOLUME_STEP}
          value={volume}
          // The person, not «участник»: this menu is opened from a row that
          // says a name, and a screen reader that reads the control alone has
          // to carry the same fact the eye gets from the header above it.
          aria-label={`Громкость: ${name}`}
          // Announced as «40%» or «Выключен» rather than as «0.4», which is
          // what a range's own value reads as and means nothing out loud.
          aria-valuetext={voiceVolumeLabel(volume)}
          onChange={(event) => setVolume(Number(event.target.value))}
          data-testid="occupant-volume-slider"
          // `kub-field` for the touch floor (D-047 measured a 314x16 slider),
          // and `kub-range` for the track: `accent-color` alone left the empty
          // half a pure neutral grey on a blue panel ground.
          className="kub-field kub-range mt-1 w-full"
          style={{ "--kub-range-filled": `${Math.round(volume * 100)}%` } as CSSProperties}
        />
      )}
      {notice && (
        <p
          className="mt-1 text-[11px] leading-snug text-[color:var(--kub-muted)]"
          data-testid="occupant-volume-notice"
        >
          {notice}
        </p>
      )}
    </div>
  );
}

/** The words for each moderation action, and which of them asks first. */
const MODERATION_WORDS: Record<
  VoiceModerationAction,
  { label: string; icon: "microphoneSlash" | "microphone" | "userRemove"; danger?: boolean }
> = {
  silence: { label: "Заглушить в канале", icon: "microphoneSlash" },
  unsilence: { label: "Разрешить говорить", icon: "microphone" },
  disconnect: { label: "Отключить от канала", icon: "userRemove", danger: true },
};

/**
 * The mark a row draws for somebody this listener has silenced for themselves.
 *
 * Its own silhouette — a speaker with a slash — beside the microphone with a
 * slash (they muted themselves) and the circle with a slash (a moderator
 * silenced them), because a row is a few pixels of text and colour is never
 * the only signal. Muted rather than danger: it is this listener's own choice,
 * not a fact about the room.
 */
export function LocalMuteMark({ userId, size = 12 }: { userId: string; size?: number }) {
  const localMuted = useVoiceParticipantLocalMute(userId);
  if (!localMuted) return null;
  return (
    <span data-testid="voice-local-mute-mark" className="inline-flex shrink-0">
      <KubIcon name="muted" size={size} tone="muted" label="Заглушён для вас" />
    </span>
  );
}
