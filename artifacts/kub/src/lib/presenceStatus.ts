/**
 * A status beside presence — tracker item 37, first phase.
 *
 * The owner's menu, from his screenshots: «В сети», «Неактивен», «Не
 * беспокоить», «Невидимый», with a duration — 15 минут, 1 час, 8 часов,
 * 24 часа, 3 дня, навсегда. Discord's idle, read in its bundle
 * (`docs/operations/reference-clients.md` §25): ten minutes without input or
 * speech.
 *
 * How the two interact, which the owner asked to have worked out before either
 * was built: a status the person chose wins while it lasts; «В сети» is the
 * absence of one, and only then does the automatic idle apply. «Не беспокоить»
 * is never turned into «Неактивен» by a quiet mouse — it is a promise to be
 * left alone, not a report of activity. «Невидимый» publishes nothing at all.
 *
 * What others see is published by the database from these same rules and from
 * every device's activity (`presence_beat`, migration
 * `20260930230000_presence_status.sql`); this file decides what a device shows
 * its own person and whether it may beat at all.
 *
 * Pure, so `node --test` decides every case (`tests/unit/presence-status.test.mts`).
 */

export type ManualStatus = "online" | "idle" | "dnd" | "invisible";
/** How somebody appears. */
export type PresenceKind = "online" | "idle" | "dnd" | "offline";

/** Discord's threshold: `Date.now() - lastActivity > 6e5`. */
export const AUTO_IDLE_AFTER_MS = 10 * 60_000;

export interface StatusOption {
  readonly id: ManualStatus;
  readonly label: string;
  /** One line under it, or null. */
  readonly hint: string | null;
  /** Whether choosing it asks for how long. */
  readonly timed: boolean;
}

export const STATUS_OPTIONS: readonly StatusOption[] = [
  { id: "online", label: "В сети", hint: null, timed: false },
  { id: "idle", label: "Неактивен", hint: null, timed: true },
  { id: "dnd", label: "Не беспокоить", hint: "Уведомления без звука", timed: true },
  { id: "invisible", label: "Невидимый", hint: "Другие видят вас не в сети", timed: true },
];

export interface StatusDuration {
  readonly id: string;
  readonly label: string;
  /** Null: until changed. */
  readonly ms: number | null;
}

export const STATUS_DURATIONS: readonly StatusDuration[] = [
  { id: "15m", label: "15 минут", ms: 15 * 60_000 },
  { id: "1h", label: "1 час", ms: 60 * 60_000 },
  { id: "8h", label: "8 часов", ms: 8 * 60 * 60_000 },
  { id: "24h", label: "24 часа", ms: 24 * 60 * 60_000 },
  { id: "3d", label: "3 дня", ms: 3 * 24 * 60 * 60_000 },
  { id: "forever", label: "Навсегда", ms: null },
];

export function isManualStatus(value: unknown): value is ManualStatus {
  return value === "online" || value === "idle" || value === "dnd" || value === "invisible";
}

/** The status chosen, if it still holds; «В сети» once it has run out. */
export function manualStatusInForce(status: ManualStatus | null | undefined, until: number | null, now: number): ManualStatus {
  if (!isManualStatus(status) || status === "online") return "online";
  if (until !== null && Number.isFinite(until) && now >= until) return "online";
  return status;
}

/**
 * How this person appears to themselves on this device: the status chosen,
 * while it lasts; otherwise idle after ten quiet minutes here. Presence turned
 * off shows as «Невидимый», which is what it is to everybody else.
 *
 * Only this device's activity is known here. Others see the database's answer,
 * which takes the latest activity of every device, so a quiet laptop does not
 * make somebody idle while they use their phone.
 */
export function ownStatus(input: {
  readonly presenceVisible: boolean;
  readonly manual: ManualStatus | null | undefined;
  readonly until: number | null;
  readonly lastActivityAt: number;
  readonly now: number;
}): ManualStatus {
  if (!input.presenceVisible) return "invisible";
  const chosen = manualStatusInForce(input.manual, input.until, input.now);
  if (chosen !== "online") return chosen;
  return input.now - input.lastActivityAt >= AUTO_IDLE_AFTER_MS ? "idle" : "online";
}

/**
 * Whether this client may beat for `userId` now.
 *
 * The privacy answer has to be this account's, and settled. A heartbeat
 * started from the signed-out default, in the one render before the account's
 * own answer had been asked for, published presence for people who had turned
 * it off — once, every time the application opened (reproduced on 2026-09-30,
 * `tests/e2e/presence-status.spec.ts`). The database refuses such a beat too;
 * this is the half that keeps the request from being sent.
 */
export function presencePublished(input: {
  readonly userId: string | null;
  /** Whose privacy answer the store holds. */
  readonly answerFor: string | null;
  readonly loading: boolean;
  readonly presenceVisible: boolean;
  readonly manual: ManualStatus | null | undefined;
  readonly until: number | null;
  readonly now: number;
}): boolean {
  if (!input.userId || input.loading || input.answerFor !== input.userId) return false;
  if (!input.presenceVisible) return false;
  return manualStatusInForce(input.manual, input.until, input.now) !== "invisible";
}

/** A stored end, as a moment: null for none, and for one that cannot be read. */
export function statusUntilMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

/** When a chosen status runs out, for a duration: null for «навсегда». */
export function statusUntil(duration: StatusDuration, now: number): number | null {
  return duration.ms === null ? null : now + duration.ms;
}

/** «до 18:20», or «до 3 окт.» past today; null when it does not run out. */
export function statusUntilLabel(until: number | null, now: number): string | null {
  if (until === null || !Number.isFinite(until) || until <= now) return null;
  const end = new Date(until);
  const today = new Date(now);
  const sameDay =
    end.getFullYear() === today.getFullYear() && end.getMonth() === today.getMonth() && end.getDate() === today.getDate();
  if (sameDay) {
    return `до ${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  }
  const months = ["янв.", "февр.", "марта", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."];
  return `до ${end.getDate()} ${months[end.getMonth()]}`;
}

/** The word under a name for somebody present, by what they publish. */
export function presentLabel(published: unknown): string {
  if (published === "dnd") return "не беспокоить";
  if (published === "idle") return "неактивен";
  return "в сети";
}

/** How somebody present appears, by what they publish. */
export function presentKind(published: unknown): Exclude<PresenceKind, "offline"> {
  if (published === "dnd") return "dnd";
  if (published === "idle") return "idle";
  return "online";
}

/**
 * The dot's picture: a shape for each state, so the four are told apart
 * without their colours — online a disc, idle a crescent, «не беспокоить» a
 * disc with a bar, invisible a ring. Discord masks each state with its own
 * shape as well: its web bundle picks `Masks.STATUS_IDLE`, `STATUS_DND`,
 * `STATUS_ONLINE`, and `STATUS_OFFLINE` for invisible too
 * (`web.d793fc00a2d44795.js`, read 2026-09-30); the shapes themselves were not
 * read, and these are ours.
 *
 * Drawn as backgrounds for a dot an avatar rings with the ground it sits on:
 * the hole is painted in `ring`, the ring's own colour, so it reads as cut out.
 * `StatusDot` draws the same four in SVG for a dot on glass, whose ground is
 * not one colour.
 */
export function presenceDotBackground(kind: ManualStatus | PresenceKind, ring: string): string {
  switch (kind) {
    case "idle":
      return `radial-gradient(circle at 22% 22%, ${ring} 0 36%, transparent 38%), var(--kub-warn)`;
    case "dnd":
      return `linear-gradient(${ring}, ${ring}) 50% 50% / 62% 24% no-repeat, var(--kub-danger)`;
    case "invisible":
    case "offline":
      return `radial-gradient(circle closest-side, ${ring} 0 46%, transparent 50%), var(--kub-muted)`;
    default:
      return "var(--kub-online)";
  }
}

/** Whether notifications should make no sound for this reader right now. */
export function statusSilencesSound(self: ManualStatus): boolean {
  return self === "dnd";
}
