"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { TinyUserAvatar } from "./MessageReactions";
import { VoiceSpeakingAvatar } from "./VoiceSpeakingAvatar";
import { CAPSULE_GLASS } from "@/lib/chatChrome";
import { FOCUS_RING, FOCUS_RING_INSET, PRESS_SINK } from "@/lib/controlSurface";
import {
  CHANNEL_RAIL_RETRY,
  CHANNEL_RAIL_UNREADABLE,
  CHANNEL_RAIL_WIDTH,
  channelsShownWhileCollapsed,
  seatLabel,
} from "@/lib/channelRail";
import { canManageChannels, voiceJoinVerdict, type ChannelGroup, type ServerChannel } from "@/lib/serverChannels";
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
  /** The room this client's call is in, which need not be one of these. */
  callChannelId: string | null;
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
  callChannelId,
  joining,
  onSelectText,
  onJoinVoice,
  onManageChannels,
  failed,
  onRetry,
}: ChannelRailProps) {
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const canManage = canManageChannels(role);

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
                  joining={joining}
                  onJoin={onJoinVoice}
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
    </div>
  );
}

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
  joining,
  onJoin,
}: {
  channel: ServerChannel;
  occupants: readonly VoiceParticipant[];
  faces?: ReadonlyMap<string, string | null>;
  selfId: string | null;
  role: string | null;
  inCall: boolean;
  joining: boolean;
  onJoin: (channel: ServerChannel) => void;
}) {
  // `full` and `listen-only` are different answers and must not be one: the
  // first says come back later, the second says you are welcome now but will
  // not be heard. `voiceJoinVerdict` keeps them apart and this row draws both.
  const verdict = voiceJoinVerdict({ channel, role, alreadyInside: inCall });
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
        data-verdict={verdict}
        title={
          full
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
        {seats && (
          <span
            className="shrink-0 text-[11px] tabular-nums text-[color:var(--kub-muted)]"
            data-testid="channel-rail-seats"
          >
            {seats}
          </span>
        )}
      </button>

      {/* Who is inside, under the room's own name. Public to the group by
          design: this is what the rail is for. */}
      {occupants.length > 0 && (
        <div className="mt-0.5 space-y-0.5 pl-4" data-testid="channel-rail-occupants">
          {occupants.map((person) => (
            <div
              key={person.userId}
              className="flex items-center gap-2 rounded-md px-2 py-[3px]"
              data-testid="channel-rail-occupant"
            >
              <VoiceSpeakingAvatar userId={person.userId} channelId={channel.id}>
                <TinyUserAvatar
                  user={{
                    id: person.userId,
                    full_name: person.name,
                    username: null,
                    avatar_url: faces?.get(person.userId) ?? null,
                  }}
                />
              </VoiceSpeakingAvatar>
              <span
                className="min-w-0 flex-1 truncate text-xs text-[color:var(--kub-text)]"
                data-testid="channel-rail-occupant-name"
              >
                {person.userId === selfId ? `${person.name} (вы)` : person.name}
              </span>
              {person.muted && (
                <KubIcon name="microphoneSlash" size={12} tone="muted" label="Микрофон выключен" />
              )}
            </div>
          ))}
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
