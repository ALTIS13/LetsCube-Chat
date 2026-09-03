/**
 * What a notification should look like, as opposed to what it says.
 *
 * Every notification in the centre used to be drawn in the same cyan, so a
 * message from a colleague, a ban and an urgent task from an administrator all
 * read as one undifferentiated stream. The information to tell them apart was
 * already in the payload — `priority`, `created_for_admin`, `message_type` —
 * and simply never reached the pixels.
 *
 * This module is the mapping and nothing else: it takes a stored notification
 * and returns tone, urgency and any attachment hint. It reads a payload written
 * by the server and must therefore treat every field as untrusted — a missing
 * or unexpected value falls back to the neutral presentation rather than
 * throwing or inventing an emphasis the notification has not earned.
 */

export type NotificationTone = "message" | "task" | "support" | "invite" | "system";

export interface NotificationChip {
  /** Stable key for React and for tests. */
  key: string;
  label: string;
  /** `alert` chips carry the danger colour; `quiet` ones stay muted. */
  emphasis: "alert" | "quiet";
}

export interface AttachmentHint {
  kind: "image" | "video" | "audio" | "file" | "location";
  icon: string;
  label: string;
}

export interface NotificationAccent {
  tone: NotificationTone;
  /** A CSS colour expression that resolves in both themes. */
  color: string;
  /** Raised presentation: a rail, a stronger tint, an alert chip. */
  urgent: boolean;
  chips: NotificationChip[];
  attachment: AttachmentHint | null;
}

/**
 * One hue per tone, all of them theme-aware tokens.
 *
 * `--kub-blue` is deliberately unused: it resolves to the same brand value in
 * both themes and sits a few degrees from `--kub-cyan`, so a message and a task
 * drawn in the two would not read as different — which is the entire defect.
 */
const TONE_COLOR: Record<NotificationTone, string> = {
  message: "var(--kub-cyan)",
  task: "var(--kub-warn)",
  support: "var(--kub-pink)",
  invite: "var(--kub-online)",
  system: "var(--kub-danger)",
};

const ATTACHMENTS: Record<string, AttachmentHint> = {
  image: { kind: "image", icon: "image", label: "Фото" },
  video: { kind: "video", icon: "video", label: "Видео" },
  audio: { kind: "audio", icon: "microphone", label: "Голосовое" },
  file: { kind: "file", icon: "file", label: "Файл" },
  location: { kind: "location", icon: "mapPin", label: "Местоположение" },
};

/** Priorities that raise a task above the ordinary stream. */
const URGENT_PRIORITIES = new Set(["urgent"]);

export function notificationTone(kind: string): NotificationTone {
  if (kind.startsWith("support_")) return "support";
  if (kind === "group_invite" || kind === "chat_added") return "invite";
  if (kind === "ban_issued" || kind === "mute_issued") return "system";
  if (kind.includes("task")) return "task";
  if (kind.includes("message")) return "message";
  return "system";
}

function readString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readBoolean(payload: unknown, key: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const value = (payload as Record<string, unknown>)[key];
  // The payload is JSON written by a trigger; a string "true" is as plausible
  // as a boolean and both mean the same thing to a reader.
  return value === true || value === "true";
}

export function attachmentHint(payload: unknown): AttachmentHint | null {
  const type = readString(payload, "message_type");
  if (!type || type === "text") return null;
  // `ATTACHMENTS[type]` alone reaches the prototype: a message typed
  // "constructor" or "toString" would return a function, which is then
  // rendered as an attachment. The payload is data, so the lookup is an
  // own-property one.
  return Object.hasOwn(ATTACHMENTS, type) ? ATTACHMENTS[type] : null;
}

/**
 * The presentation for one notification.
 *
 * Urgency is only ever claimed for a task, and only from the priority the
 * server recorded. An administrator's task says so in its own chip, because
 * "urgent" and "from an administrator" are different facts and a reader acts on
 * them differently.
 */
export function notificationAccent(item: { kind: string; payload: unknown }): NotificationAccent {
  const tone = notificationTone(item.kind);
  const priority = readString(item.payload, "priority");
  const urgent = tone === "task" && priority !== null && URGENT_PRIORITIES.has(priority);
  const fromAdmin = tone === "task" && readBoolean(item.payload, "created_for_admin");

  const chips: NotificationChip[] = [];
  if (urgent) chips.push({ key: "urgent", label: "Срочно", emphasis: "alert" });
  if (fromAdmin) chips.push({ key: "admin", label: "От администратора", emphasis: "quiet" });
  if (tone === "task" && !urgent && priority === "high") {
    chips.push({ key: "high", label: "Важно", emphasis: "quiet" });
  }

  return {
    tone,
    // Urgency overrides the hue: a task that must be acted on now is not a
    // louder task, it is a different thing on the screen.
    color: urgent ? TONE_COLOR.system : TONE_COLOR[tone],
    urgent,
    chips,
    attachment: tone === "message" ? attachmentHint(item.payload) : null,
  };
}

/** Background tint for an item, mixed with the surface so text stays legible. */
export function accentSurface(accent: NotificationAccent, unread: boolean): string {
  const strength = accent.urgent ? (unread ? 16 : 10) : unread ? 8 : 0;
  if (strength === 0) return "var(--kub-surface-2)";
  return `color-mix(in srgb, ${accent.color} ${strength}%, var(--kub-surface-2))`;
}

/** Border for an item. Urgency is visible whether or not it has been read. */
export function accentBorder(accent: NotificationAccent, unread: boolean): string {
  if (accent.urgent) {
    return `color-mix(in srgb, ${accent.color} ${unread ? 65 : 40}%, var(--kub-border-color))`;
  }
  if (!unread) return "var(--kub-border-color)";
  return `color-mix(in srgb, ${accent.color} 45%, var(--kub-border-color))`;
}
