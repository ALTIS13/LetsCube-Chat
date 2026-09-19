"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import {
  RowActionHeader,
  RowActionMenu,
  RowActionSheet,
  rowMenuPlacement,
  type RowAction,
  type RowMenuPlacement,
} from "@/components/kub/RowActions";
import { TinyUserAvatar } from "./MessageReactions";
import { VoiceSpeakingAvatar } from "./VoiceSpeakingAvatar";
import { useVoiceCall } from "@/hooks/useVoiceCall";
import { useVoiceModeration } from "@/hooks/useVoiceModeration";
import {
  useSetVoiceParticipantVolume,
  useVoiceParticipantVolume,
} from "@/hooks/useVoiceVolume";
import { requestAppConfirm } from "@/lib/appDialogs";
import { CAPSULE_GLASS } from "@/lib/chatChrome";
import { FOCUS_RING, FOCUS_RING_INSET, PRESS_SINK } from "@/lib/controlSurface";
import {
  voiceModerationActions,
  type VoiceModerationAction,
} from "@/lib/voiceModeration";
import {
  occupantMenuOffersSomething,
  voiceVolumeLabel,
  voiceVolumeNotice,
  voiceVolumeOffer,
  VOICE_VOLUME_STEP,
  type VoiceAudioSource,
  type VoiceVolumeOffer,
} from "@/lib/voiceVolume";
import {
  CHANNEL_RAIL_RETRY,
  CHANNEL_RAIL_UNREADABLE,
  CHANNEL_RAIL_WIDTH,
  channelsShownWhileCollapsed,
  seatLabel,
} from "@/lib/channelRail";
import { canManageChannels, voiceJoinVerdict, type ChannelGroup, type ServerChannel } from "@/lib/serverChannels";
import { VOICE_ELSEWHERE_MOVE, VOICE_ELSEWHERE_PROMISE } from "@/lib/voiceElsewhere";
import type { VoiceParticipant } from "@/lib/voiceChannel";
import { cn } from "@/lib/utils";

/**
 * A group's channels, listed the way a server lists them.
 *
 * The product drew them as a forum: a horizontal strip of capsules under the
 * header, which is the shape for one conversation with threads beside it. A
 * server is the other shape — one place holds many rooms, they stand in a
 * vertical list under headings, and the list itself is where you go from one to
 * another. The owner asked for the second, and asked for it as mechanics rather
 * than as wording, so what is different here is what the rows **do**:
 *
 *   - a voice channel is a **place**. It is in the list when it is empty, it has
 *     a name, and one click puts you in it. There is no ring and nobody accepts.
 *     Several stand side by side and a person picks between them;
 *   - **who is inside is public to the group**, listed under the room's own name
 *     and live. That is the single most recognisable thing about a server's
 *     channel list: the rail answers «where is everybody» without anyone being
 *     asked. `joinVoiceChannel` leaves the room it finds you in before it joins
 *     the next, so moving between rooms is one click on the other room;
 *   - **headings group the rooms and collapse.** What stays visible in a folded
 *     heading is `channelsShownWhileCollapsed`: the channel you are reading and
 *     the rooms with people in them. Folding hides what is quiet, never what is
 *     happening.
 *
 * Two shapes, one list. `ChannelRail` is the column, for a pane wide enough to
 * give one up (`paneFitsChannelRail`, measured against the pane rather than the
 * viewport — at exactly 768 a breakpoint would put a 224px column into a 336px
 * pane). `ChannelRailSheet` is the same list over the conversation on a phone,
 * opened from `ChannelRailTrigger` in the chrome stack, where the topic strip
 * used to be.
 *
 * **The material.** The column is a plain box with a `KubGlassLayer` behind it
 * (rule 3: a `backdrop-filter` on a 224px column would become the containing
 * block for every `fixed` dialog opened from inside it). The rows themselves
 * carry no fill, no blur and no shadow — rule 6, a list that scrolls is the one
 * place a blur per row costs real frames — and the chosen row is told by the
 * same cyan wash and accent bar a chosen chat row already uses.
 *
 * **What this component does not do.** It creates, renames, reorders and
 * deletes nothing: those surfaces are being built beside it, and the only thing
 * the rail knows about them is `onManageChannels`, a callback behind a button
 * that appears for an administrator and nowhere else. The permission is
 * `canManageChannels`, which mirrors `public.is_chat_admin` exactly rather than
 * the wider client notion of staff — a control the database will refuse is
 * worse than no control.
 */

export interface ChannelRailProps {
  /** The rail in drawing order, from `buildChannelTree`. Rendered as given. */
  groups: readonly ChannelGroup[];
  /** The text channel being read, as `currentTextChannelId` resolves it. */
  currentTextChannelId: string | null;
  /** Who is in a room, already named. Called per room, per render. */
  occupantsOf: (channelId: string) => readonly VoiceParticipant[];
  /** Avatars by user id, from the chat's own member list. Absent is a monogram. */
  faces?: ReadonlyMap<string, string | null>;
  selfId: string | null;
  /** This reader's role in the group: `owner`, `admin`, `member`, or null. */
  role: string | null;
  /**
   * Any member's role in this group, from the chat's own member list.
   *
   * Needed by the moderation menu and by nothing else. Without it the rail
   * would have to offer «Заглушить» on the owner and let the gateway refuse —
   * telling the reader a rule it already knew, which is the defect D-165
   * records. `null` for somebody with no membership row, which is a real state
   * and exactly when disconnecting them is the point.
   */
  roleOf?: (userId: string) => string | null;
  /** The room this client's call is in, which need not be one of these. */
  callChannelId: string | null;
  /**
   * The room this person is in on **another** of their devices, which likewise
   * need not be one of these.
   *
   * A row for it must not offer the ordinary way in. Pressing it is the same
   * `joinVoiceChannel` either way, so the danger is not that the database
   * would hold one person twice — its primary key forbids that — it is that
   * somebody would press «join» without being told it takes the conversation
   * off their computer. `lib/voiceElsewhere.ts`.
   */
  elsewhereChannelId: string | null;
  /** True while a join is in flight, so a second press cannot start a second one. */
  joining: boolean;
  onSelectText: (channel: ServerChannel) => void;
  onJoinVoice: (channel: ServerChannel) => void;
  /** Opens the management surface. Absent means no administrator control is drawn. */
  onManageChannels?: () => void;
  /**
   * True when the last read of the rooms errored.
   *
   * The rail stays and says so rather than emptying: an empty list and a list
   * nobody could read are different facts, and a person watching their
   * channels disappear with no sentence anywhere is the worst of the two.
   */
  failed?: boolean;
  /** Asks for the read again. Absent draws no retry. */
  onRetry?: () => void;
}

/** The list itself, shared by the column and the sheet. */
function ChannelRailList({
  groups,
  currentTextChannelId,
  occupantsOf,
  faces,
  selfId,
  role,
  roleOf,
  callChannelId,
  elsewhereChannelId,
  joining,
  onSelectText,
  onJoinVoice,
  onManageChannels,
  failed,
  onRetry,
}: ChannelRailProps) {
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const canManage = canManageChannels(role);
  const moderation = useVoiceModeration();
  const [occupantMenu, setOccupantMenu] = useState<OccupantMenu | null>(null);

  /**
   * Opens the menu on one occupant, or does nothing when there is nothing to
   * offer.
   *
   * The pointer decides the shape, not the viewport: a coarse pointer gets the
   * sheet from the foot of the screen, everything else gets a menu where the
   * pointer is. That is the same reading `ChatInfoPanel` makes for the same
   * pair of components, and it is a reading about the input device rather than
   * about the window's width — a tablet held sideways is wide and still a
   * finger.
   */
  const openOccupantMenu = useCallback(
    (
      channelId: string,
      person: {
        userId: string;
        name: string;
        canSpeak: boolean | null;
        audioSource: VoiceAudioSource | null;
        face: string | null;
      },
      position: { x: number; y: number },
    ) => {
      const targetRole = roleOf?.(person.userId) ?? null;
      const offered = voiceModerationActions(
        { selfId, role },
        { userId: person.userId, role: targetRole, canSpeak: person.canSpeak },
      );
      // Volume is for everybody and moderation is for two roles, so the menu
      // has two gates rather than one widened gate. Folding them together is
      // how a plain member would end up being offered «Заглушить», or a
      // moderator's own row would start offering a volume for their own voice.
      const volume = voiceVolumeOffer({ selfId, target: person });
      // A row that opens an empty menu is the same defect as a control that
      // does nothing, so the row is not pressable at all in that case — this is
      // the second gate rather than the only one.
      if (!occupantMenuOffersSomething(volume, offered.length)) return;
      const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
      setOccupantMenu({
        channelId,
        userId: person.userId,
        name: person.name,
        role: targetRole,
        canSpeak: person.canSpeak,
        volume,
        face: person.face,
        mode: coarse ? "sheet" : "menu",
        placement: rowMenuPlacement(position),
      });
    },
    [role, roleOf, selfId],
  );

  /**
   * The actions for whoever the menu is open on, built from the same rules the
   * row used to decide it was pressable — so the row and the menu cannot
   * disagree about who may do what.
   */
  const menuActions: RowAction[] = occupantMenu
    ? voiceModerationActions(
        { selfId, role },
        { userId: occupantMenu.userId, role: occupantMenu.role, canSpeak: occupantMenu.canSpeak },
      ).map((action) => ({
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
                  description: `${occupantMenu.name} выйдет из разговора. Вернуться в канал это не запрещает.`,
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
            channelId: occupantMenu.channelId,
            target: { userId: occupantMenu.userId, name: occupantMenu.name },
            action,
          });
        },
      }))
    : [];

  const menuHeader = occupantMenu ? (
    <RowActionHeader
      // The person, not the room. The first capture put the channel speaker
      // glyph here while the rail row directly above it showed that person as
      // an avatar — one human being with two marks, one of them belonging to
      // something else entirely.
      avatar={
        <TinyUserAvatar
          user={{
            id: occupantMenu.userId,
            full_name: occupantMenu.name,
            username: null,
            avatar_url: occupantMenu.face,
          }}
        />
      }
      title={occupantMenu.name}
      subtitle={occupantMenu.canSpeak === false ? "Заглушён модератором" : undefined}
    />
  ) : null;

  /**
   * The volume band, above the actions and separated from them.
   *
   * It is deliberately not one of `menuActions`: those are a label and a `run`,
   * and this has a value that is dragged. `RowActions` takes it as its own slot
   * — see the note on `controls` there — so the two kinds of thing in this menu
   * stay visibly two kinds of thing. Which matters here beyond tidiness: the
   * band is about this listener's own ears and the items under it are about the
   * room, and a reader must not take one for the other.
   */
  const menuControls =
    occupantMenu && occupantMenu.volume !== "not_offered" ? (
      <OccupantVolume
        key={occupantMenu.userId}
        userId={occupantMenu.userId}
        name={occupantMenu.name}
        offer={occupantMenu.volume}
      />
    ) : null;

  const busyActionId =
    moderation.busy && occupantMenu && moderation.busy.userId === occupantMenu.userId
      ? moderation.busy.action
      : null;

  /** Ask, then mark busy, then run. The other order puts «Выполняем…» under an unanswered question. */
  const runOccupantAction = useCallback(
    async (action: RowAction) => {
      if (action.confirm && !(await action.confirm())) {
        setOccupantMenu(null);
        return;
      }
      try {
        await action.run();
      } finally {
        setOccupantMenu(null);
      }
    },
    [],
  );

  const toggle = useCallback((categoryId: string) => {
    setCollapsed((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
  }, []);

  // Which rooms have somebody in them, for the collapse rule. The row's own
  // counter is what a refusal is made on, but «is anybody there» is a question
  // the listed people answer better: a counter one reconciliation period stale
  // would fold a room that has people in it out of sight.
  const occupiedVoiceIds = useMemo(
    () =>
      groups
        .flatMap((group) => group.channels)
        .filter((channel) => channel.kind === "voice" && occupantsOf(channel.id).length > 0)
        .map((channel) => channel.id),
    [groups, occupantsOf],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-2 pb-4 pt-2" data-testid="channel-rail-list">
      {/* Above the list, not instead of it: a read that failed says nothing
          about the channels already on screen, and taking them away would
          lose what is still true. */}
      {failed && (
        <div
          role="status"
          data-testid="channel-rail-unreadable"
          className="mb-2 flex items-center gap-2 rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-2.5 py-2 text-xs text-[color:var(--kub-danger-text)]"
        >
          <KubIcon name="warning" size={14} tone="currentColor" className="shrink-0" />
          <span className="min-w-0 flex-1">{CHANNEL_RAIL_UNREADABLE}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              data-testid="channel-rail-retry"
              className={cn("shrink-0 rounded-md px-1.5 py-0.5 font-semibold", FOCUS_RING)}
            >
              {CHANNEL_RAIL_RETRY}
            </button>
          )}
        </div>
      )}
      {groups.map((group) => {
        const categoryId = group.category?.id ?? null;
        const folded = categoryId !== null && collapsed.includes(categoryId);
        const channels = folded
          ? channelsShownWhileCollapsed(group.channels, {
              textChannelId: currentTextChannelId,
              occupiedVoiceIds,
            })
          : group.channels;

        return (
          <div key={categoryId ?? "loose"} data-testid="channel-rail-group" data-category-id={categoryId ?? ""}>
            {group.category && (
              <div className="flex items-center gap-1 pt-4">
                <button
                  type="button"
                  onClick={() => toggle(group.category!.id)}
                  aria-expanded={!folded}
                  data-testid="channel-rail-heading"
                  data-collapsed={folded ? "true" : "false"}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                    "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
                    FOCUS_RING_INSET,
                    PRESS_SINK,
                  )}
                >
                  <KubIcon name={folded ? "chevronRight" : "chevronDown"} size={12} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">{group.category.name}</span>
                </button>
                {canManage && onManageChannels && (
                  <button
                    type="button"
                    onClick={onManageChannels}
                    aria-label="Управление каналами"
                    title="Управление каналами"
                    data-testid="channel-rail-manage"
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]",
                      FOCUS_RING_INSET,
                      PRESS_SINK,
                    )}
                  >
                    <KubIcon name="create" size={13} />
                  </button>
                )}
              </div>
            )}

            {channels.map((channel) =>
              channel.kind === "text" ? (
                <TextChannelRow
                  key={channel.id}
                  channel={channel}
                  active={channel.id === currentTextChannelId}
                  onSelect={onSelectText}
                />
              ) : (
                <VoiceChannelRailRow
                  key={channel.id}
                  channel={channel}
                  occupants={occupantsOf(channel.id)}
                  faces={faces}
                  selfId={selfId}
                  role={role}
                  inCall={callChannelId === channel.id}
                  elsewhere={elsewhereChannelId === channel.id}
                  joining={joining}
                  onJoin={onJoinVoice}
                  moderatableBy={{ selfId, role }}
                  roleOf={roleOf}
                  onOccupantMenu={openOccupantMenu}
                />
              ),
            )}
          </div>
        );
      })}

      {/* The one control an administrator gets here, for a group with no
          headings at all: without it the manage button would exist only beside
          a category, which is the state somebody needs it to leave. */}
      {canManage && onManageChannels && !groups.some((group) => group.category) && (
        <button
          type="button"
          onClick={onManageChannels}
          data-testid="channel-rail-manage"
          className={cn(
            "mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors kub-raise-hover",
            "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
            FOCUS_RING_INSET,
            PRESS_SINK,
          )}
        >
          <KubIcon name="create" size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Управление каналами</span>
        </button>
      )}

      {occupantMenu && occupantMenu.mode === "menu" && (
        <RowActionMenu
          header={menuHeader}
          actions={menuActions}
          controls={menuControls}
          placement={occupantMenu.placement}
          busyActionId={busyActionId}
          layer={MODERATION_MENU_LAYER}
          onClose={() => setOccupantMenu(null)}
          onRun={runOccupantAction}
        />
      )}
      {occupantMenu && occupantMenu.mode === "sheet" && (
        <RowActionSheet
          header={menuHeader}
          actions={menuActions}
          controls={menuControls}
          busyActionId={busyActionId}
          layer={MODERATION_MENU_LAYER}
          onClose={() => setOccupantMenu(null)}
          onRun={runOccupantAction}
        />
      )}
    </div>
  );
}

/**
 * Above the drawer form of this rail, which stands at `z-[60]`.
 *
 * 80 rather than a fresh number: `ChatInfoPanel` already passes 80 to these
 * same components for exactly this reason, and that was a measurement — the
 * default 50 renders underneath a surface at 60, so a menu opened from the
 * drawer would be painted behind the list it was opened from. One number for
 * one problem.
 */
const MODERATION_MENU_LAYER = 80;

/** Which occupant a menu is open on, and how it was opened. */
interface OccupantMenu {
  readonly channelId: string;
  readonly userId: string;
  readonly name: string;
  readonly role: string | null;
  readonly canSpeak: boolean | null;
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
  /** Their avatar, so the menu names the person the row named. */
  readonly face: string | null;
  readonly mode: "menu" | "sheet";
  readonly placement: RowMenuPlacement;
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
 * subscription costs the rail nothing while it is merely being looked at.
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
          // and `kub-range` for the track.
          //
          // It was `accent-[var(--kub-cyan)]` alone, matching the sound
          // settings' slider — and the pixels refused it. `accent-color`
          // paints the filled half and the thumb and leaves the rest to the
          // browser: measured in the dark theme, the empty track came back
          // `rgb(59, 59, 59)`, a pure neutral grey with no hue, on a panel
          // ground of `rgb(17, 42, 71)`. `AudioMessage` and
          // `AttachVideoQuality` already paint both halves; `kub-range` is
          // that, in tokens, once.
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

/** The words for each action, and which of them asks first. */
const MODERATION_WORDS: Record<
  VoiceModerationAction,
  { label: string; icon: "microphoneSlash" | "microphone" | "userRemove"; danger?: boolean }
> = {
  silence: { label: "Заглушить в канале", icon: "microphoneSlash" },
  unsilence: { label: "Разрешить говорить", icon: "microphone" },
  disconnect: { label: "Отключить от канала", icon: "userRemove", danger: true },
};

/**
 * The chosen row's language, which is the chat list's: a cyan wash that steps
 * on hover, and an accent bar down its left edge. A resting veil would be the
 * hover veil, and a hover that measures the same as rest is rule 5's 1.002.
 */
const CHOSEN_ROW =
  "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] hover:bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)] text-[color:var(--kub-accent-text)]";
const RESTING_ROW = "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)] kub-raise-hover";

function TextChannelRow({
  channel,
  active,
  onSelect,
}: {
  channel: ServerChannel;
  active: boolean;
  onSelect: (channel: ServerChannel) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(channel)}
      aria-current={active ? "page" : undefined}
      data-testid="channel-rail-text"
      data-channel-id={channel.id}
      data-active={active ? "true" : "false"}
      className={cn(
        "relative mt-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
        active ? CHOSEN_ROW : RESTING_ROW,
        FOCUS_RING_INSET,
        PRESS_SINK,
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--kub-cyan)]"
        />
      )}
      {channel.emoji ? (
        <span className="w-[15px] shrink-0 text-center text-[13px] leading-none">{channel.emoji}</span>
      ) : (
        <KubIcon name="hash" size={15} className="shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{channel.name}</span>
    </button>
  );
}

function VoiceChannelRailRow({
  channel,
  occupants,
  faces,
  selfId,
  role,
  inCall,
  elsewhere,
  joining,
  onJoin,
  moderatableBy,
  roleOf,
  onOccupantMenu,
}: {
  channel: ServerChannel;
  occupants: readonly VoiceParticipant[];
  faces?: ReadonlyMap<string, string | null>;
  selfId: string | null;
  role: string | null;
  inCall: boolean;
  /** This person is in this room on another of their devices. */
  elsewhere: boolean;
  joining: boolean;
  onJoin: (channel: ServerChannel) => void;
  /** The reader, for the moderation rules. Same pair the list holds. */
  moderatableBy: { selfId: string | null; role: string | null };
  roleOf?: (userId: string) => string | null;
  onOccupantMenu: (
    channelId: string,
    person: {
      userId: string;
      name: string;
      canSpeak: boolean | null;
      audioSource: VoiceAudioSource | null;
      face: string | null;
    },
    position: { x: number; y: number },
  ) => void;
}) {
  // `full` and `listen-only` are different answers and must not be one: the
  // first says come back later, the second says you are welcome now but will
  // not be heard. `voiceJoinVerdict` keeps them apart and this row draws both.
  // `alreadyInside` for the other device too: a room this person is already in
  // has no seat to refuse them, and «В канале уже максимум участников» over a
  // room they are sitting in is the interface arguing with the table.
  const verdict = voiceJoinVerdict({ channel, role, alreadyInside: inCall || elsewhere });
  const seats = seatLabel(channel);
  const full = verdict === "full";

  return (
    <div data-testid="channel-rail-voice-group" data-channel-id={channel.id}>
      <button
        type="button"
        onClick={() => onJoin(channel)}
        disabled={full || joining || verdict === "not-a-member"}
        aria-current={inCall ? "true" : undefined}
        data-testid="channel-rail-voice"
        data-channel-id={channel.id}
        data-active={inCall ? "true" : "false"}
        data-elsewhere={elsewhere ? "true" : "false"}
        data-verdict={verdict}
        title={
          elsewhere
            ? `${VOICE_ELSEWHERE_MOVE} · ${VOICE_ELSEWHERE_PROMISE}`
            : full
              ? "В канале уже максимум участников"
              : verdict === "listen-only"
                ? "Вы сможете только слушать"
                : undefined
        }
        className={cn(
          "relative mt-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
          inCall ? CHOSEN_ROW : RESTING_ROW,
          // Present but not offered, as a step of material rather than as
          // opacity: on a translucent panel opacity shows the wallpaper through
          // the words (rule 5).
          "disabled:cursor-not-allowed disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)]",
          FOCUS_RING_INSET,
          PRESS_SINK,
        )}
      >
        {inCall && (
          <span
            aria-hidden="true"
            className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--kub-cyan)]"
          />
        )}
        <KubIcon name="volume" size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{channel.name}</span>
        {verdict === "listen-only" && (
          <KubIcon name="microphoneSlash" size={13} tone="muted" label="Только слушать" />
        )}
        {/* The seat count gives way to the word, rather than standing beside
            it. A room this person is already in on another device is not a room
            with seats left to consider — the question is no longer «is there
            room», it is «bring it here», and the rail has one slot at this
            width to say which. The full sentence is the row's `title`, and the
            band at the foot of the column carries it in plain sight. */}
        {elsewhere ? (
          <span
            className="shrink-0 text-[11px] font-semibold text-[color:var(--kub-accent-text)]"
            data-testid="channel-rail-elsewhere"
          >
            {VOICE_ELSEWHERE_MOVE}
          </span>
        ) : (
          seats && (
            <span
              className="shrink-0 text-[11px] tabular-nums text-[color:var(--kub-muted)]"
              data-testid="channel-rail-seats"
            >
              {seats}
            </span>
          )
        )}
      </button>

      {/* Who is inside, under the room's own name. Public to the group by
          design: this is what the rail is for. */}
      {occupants.length > 0 && (
        <div className="mt-0.5 space-y-0.5 pl-4" data-testid="channel-rail-occupants">
          {occupants.map((person) => {
            const moderationActions = voiceModerationActions(moderatableBy, {
              userId: person.userId,
              role: roleOf?.(person.userId) ?? null,
              canSpeak: person.canSpeak,
            }).length;
            // No «is this my room» argument, and the note on `voiceVolumeOffer`
            // says why: `occupantsOf` only gives this row an `audioSource` for
            // the room whose audio is actually arriving, so the reading is the
            // more accurate form of the same question.
            const volume = voiceVolumeOffer({ selfId, target: person });
            return (
              <OccupantRow
                key={person.userId}
                channelId={channel.id}
                person={person}
                face={faces?.get(person.userId) ?? null}
                isSelf={person.userId === selfId}
                moderatable={moderationActions > 0}
                volume={volume}
                // One decision, made once, so the row and the menu cannot
                // disagree about whether pressing it does anything.
                offers={occupantMenuOffersSomething(volume, moderationActions)}
                onOpenMenu={onOccupantMenu}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The column, beside the conversation.
 *
 * A plain box with the material on a layer behind it, as `Sidebar`'s column is
 * and for the same reason: anything opened from inside a frosted box lays out
 * against that box. The right edge is `--kub-border-color`, the sheet edge —
 * this is chrome pinned against a scroll area, which is the case rule 11 keeps
 * a perimeter for.
 *
 * **No `md:` here, deliberately.** Whether this shape is drawn at all is
 * `paneFitsChannelRail` against the measured pane, decided by the caller. A
 * `hidden md:flex` beside that would be a second gate answering a different
 * question, and the two disagree between 584 and 767 CSS pixels: below `md`
 * the conversation is the whole window, so the pane fits a column there while
 * the breakpoint hides it — and the caller, believing the column is drawn,
 * offers no trigger either. One rule, measured.
 */
/**
 * One person in a room, and the moderator's way in (D-221).
 *
 * ## Two gestures, because there is no one gesture
 *
 * Right-click is what somebody who has used Discord will try, and it is the
 * gesture that does not compete with anything. But a phone has no right-click
 * and this rail is a drawer there, so a plain press opens the menu too. That is
 * safe here and would not be on most rows: an occupant row has no other action
 * — it is a name, not a destination — so a press cannot mean two things.
 *
 * Long-press was considered and rejected. `ChatListItem` has one, and it costs a
 * timer, a movement threshold and a cancel on scroll; it earns that in a list
 * whose rows are the primary navigation. Here the press is free.
 *
 * ## The row is only pressable when there is something to press it for
 *
 * `offers` is `occupantMenuOffersSomething(...)`, computed by the caller from
 * the same two rules the menu builds from. A row that opens an empty menu is
 * the same defect as a control that does nothing, so a row with nothing behind
 * it is the `div` it has always been — no hover, no cursor, no focus stop.
 *
 * There are **two** reasons a press is worth making, and they are not one gate.
 * Moderation is for an owner or an administrator; the volume is for everybody,
 * about their own ears, and only for the room this client is actually connected
 * to. So a plain member's row is inert in every room but the one they are
 * sitting in, and pressable in that one — which is also why the existing test
 * that finds a `div` for a plain member still finds one: it never joins.
 *
 * ## Self-mute and a silence are different marks
 *
 * `microphoneSlash` for somebody who turned their own microphone off; `ban` for
 * somebody a moderator silenced. Two silhouettes — a microphone with a slash
 * against a circle with a slash — rather than one glyph in two colours, because
 * a rail row is 12 pixels of text and colour is never the only signal. The
 * tone is `--kub-danger`, the mark tone, not `--kub-danger-text`.
 */
function OccupantRow({
  channelId,
  person,
  face,
  isSelf,
  moderatable,
  volume,
  offers,
  onOpenMenu,
}: {
  channelId: string;
  person: VoiceParticipant;
  face: string | null;
  isSelf: boolean;
  moderatable: boolean;
  volume: VoiceVolumeOffer;
  /** Whether pressing this row opens anything at all. */
  offers: boolean;
  onOpenMenu: (
    channelId: string,
    person: {
      userId: string;
      name: string;
      canSpeak: boolean | null;
      audioSource: VoiceAudioSource | null;
      face: string | null;
    },
    position: { x: number; y: number },
  ) => void;
}) {
  const silenced = person.canSpeak === false;
  const open = (event: { clientX: number; clientY: number; preventDefault: () => void }) => {
    event.preventDefault();
    onOpenMenu(
      channelId,
      {
        userId: person.userId,
        name: person.name,
        canSpeak: person.canSpeak,
        audioSource: person.audioSource,
        face,
      },
      { x: event.clientX, y: event.clientY },
    );
  };

  const body = (
    <>
      <VoiceSpeakingAvatar userId={person.userId} channelId={channelId}>
        <TinyUserAvatar
          user={{
            id: person.userId,
            full_name: person.name,
            username: null,
            avatar_url: face,
          }}
        />
      </VoiceSpeakingAvatar>
      <span
        className="min-w-0 flex-1 truncate text-left text-xs text-[color:var(--kub-text)]"
        data-testid="channel-rail-occupant-name"
      >
        {isSelf ? `${person.name} (вы)` : person.name}
      </span>
      {silenced ? (
        <KubIcon name="ban" size={12} tone="danger" label="Заглушён модератором" />
      ) : (
        person.muted && (
          <KubIcon name="microphoneSlash" size={12} tone="muted" label="Микрофон выключен" />
        )
      )}
    </>
  );

  const shared = {
    "data-testid": "channel-rail-occupant",
    "data-user-id": person.userId,
    "data-silenced": silenced ? "true" : "false",
    // Still «may this row's person be moderated», unchanged: the row became
    // pressable for a second reason and this attribute did not widen with it,
    // because a test that reads it is asking about moderation.
    "data-moderatable": moderatable ? "true" : "false",
    "data-volume": volume,
  } as const;

  if (!offers) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-[3px]" {...shared}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      onContextMenu={open}
      // Two words for two reasons a press is worth making, and the one that is
      // true for every reader comes first: a moderator sees the same row plus
      // three more items in it.
      title={moderatable ? "Громкость и управление участником" : "Громкость участника"}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-[3px] transition-colors kub-raise-hover",
        FOCUS_RING_INSET,
        PRESS_SINK,
      )}
      {...shared}
    >
      {body}
    </button>
  );
}

export function ChannelRail(props: ChannelRailProps) {
  return (
    <nav
      aria-label="Каналы"
      data-testid="channel-rail"
      data-shape="column"
      className="relative flex h-full shrink-0 flex-col border-r border-[color:var(--kub-border-color)] pt-window-top"
      style={{ width: `${CHANNEL_RAIL_WIDTH}px` }}
    >
      <KubGlassLayer />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChannelRailList {...props} />
      </div>
    </nav>
  );
}

/**
 * The same list over the conversation, for a pane with no room for a column.
 *
 * A covering surface, so it takes the strong material and keeps its perimeter
 * (rule 11): it stands on a backdrop nobody chose. Nothing inside it is
 * `fixed`, so it can wear the material on its own box.
 *
 * No entrance animation, deliberately. Rule 14 is a WebKit defect about
 * surfaces that animate in from inside a container that hides itself, and a
 * drawer that simply appears cannot have it.
 */
export function ChannelRailSheet({ onClose, ...props }: ChannelRailProps & { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // `z-[60]`, the contact card's layer, and it is a measurement rather than a
    // preference. The composer's hints are Radix popovers portalled to the body
    // at `z-50`; a sheet at 50 loses to them on tree order, and the first
    // capture of this drawer had «Коротко нажмите на микрофон…» painted across
    // it. The hint takes no pointer (it is `pointer-events-none`), so only the
    // paint was wrong — which is exactly the kind of thing a green test does
    // not see.
    <div className="fixed inset-0 z-[60] flex" data-testid="channel-rail-sheet">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-[color-mix(in_srgb,var(--kub-bg)_62%,transparent)]"
        data-testid="channel-rail-scrim"
      />
      <nav
        role="dialog"
        aria-label="Каналы"
        data-shape="sheet"
        // `pl-[var(--kub-safe-left)]` rather than `px-safe`: this sheet is
        // against the left edge only, and held sideways an iPhone's notch is
        // on one of the long edges. The token, never `env()` — rule 13 keeps
        // the four insets declared in one place so WebKit, which reports every
        // inset as 0px, can still be given values to check against.
        className="kub-glass-strong relative flex h-full w-[min(19rem,86vw)] flex-col border-r border-[color:var(--kub-border-color)] pb-safe pl-[var(--kub-safe-left)] pt-window-top"
      >
        <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[color:var(--kub-text)]">
            Каналы
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            data-testid="channel-rail-close"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover",
              FOCUS_RING,
              PRESS_SINK,
            )}
          >
            <KubIcon name="close" size={16} />
          </button>
        </div>
        <ChannelRailList {...props} />
      </nav>
    </div>
  );
}

/**
 * What opens the sheet, in the chrome stack where the topic strip used to be.
 *
 * A capsule, because everything else floating over this conversation is one:
 * the header, the pinned message, the voice capsule and the composer. The glass
 * is `KubGlassLayer` on a leaf for rule 3's reason, exactly as `TopicStrip` and
 * `VoiceCallCapsule` wear it.
 */
export function ChannelRailTrigger({
  channelName,
  emoji,
  occupiedRooms,
  open,
  onOpen,
}: {
  /** The text channel being read. */
  channelName: string;
  emoji?: string | null;
  /** How many rooms have somebody in them, so the capsule can say so unopened. */
  occupiedRooms: number;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="relative mx-2 mt-1 flex-shrink-0 rounded-full md:mx-4">
      <KubGlassLayer className={CAPSULE_GLASS} />
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="channel-rail-trigger"
        className={cn(
          "relative flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-left",
          FOCUS_RING,
        )}
      >
        {emoji ? (
          <span className="shrink-0 text-[13px] leading-none">{emoji}</span>
        ) : (
          <KubIcon name="hash" size={13} tone="muted" className="shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[color:var(--kub-text)]">
          {channelName}
        </span>
        {occupiedRooms > 0 && (
          <span
            className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[color:var(--kub-accent-text)]"
            data-testid="channel-rail-trigger-live"
          >
            <KubIcon name="volume" size={12} tone="accent" />
            {occupiedRooms}
          </span>
        )}
        <KubIcon name="chevronDown" size={13} tone="muted" className="shrink-0" />
      </button>
    </div>
  );
}
