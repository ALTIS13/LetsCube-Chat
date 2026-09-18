/**
 * Who may silence or disconnect whom, decided here rather than by pressing the
 * button and reading the answer (D-221).
 *
 * The gateway is the authority and enforces all of this again on the server —
 * nothing here is a security boundary, and a client that lied about a rule
 * would get a 403 with a sentence. What this module is for is the interface's
 * side of the same rule: **a control must not be offered for something the
 * rules forbid.** A menu that offers «Заглушить» on the owner of a group, and
 * answers «Владельца нельзя заглушить» when pressed, has told the reader a rule
 * it knew before they touched anything — which is the defect D-165 records.
 *
 * ## The matrix is a mirror, and a test holds it against the original
 *
 * `voiceModerationAuthBlock` is a restatement of `moderationRefusal` in
 * `supabase/functions/voice-gateway/moderation.mjs`, refusal for refusal and in
 * the same order. It is a restatement rather than an import because that module
 * is Deno-side gateway code; `tests/unit/voice-moderation.test.mts` imports
 * **both** and compares them across every combination of the two roles, the two
 * routes and a target who is the caller — so a divergence is a red test rather
 * than a support ticket.
 *
 * The order is preserved for a reason that belongs to the server and is kept
 * here anyway: the caller's own standing is settled before anything at all is
 * said about the target, so the route's answers cannot be used to discover who
 * owns a chat. The client already knows every member's role — it draws the
 * member list — so the secrecy buys it nothing; keeping the order identical is
 * what makes the two comparable.
 *
 * ## Why a separate «already silenced» decision
 *
 * The server has no opinion about whether somebody is already silenced: both
 * directions are idempotent and both succeed. The interface does have one,
 * because offering a control that changes nothing is the thing this whole entry
 * is about. That decision is `voiceModerationActions`, reads `canSpeak`, and is
 * deliberately not part of the mirrored matrix above.
 */

/** What a moderator can do to somebody already in a room. */
export type VoiceModerationAction = "silence" | "unsilence" | "disconnect";

/**
 * Why an action is not offered.
 *
 * The first five are the gateway's refusals under the interface's own names.
 * The last two are the interface's alone — see the note above.
 */
export type VoiceModerationBlock =
  | "not_a_member"
  | "not_a_moderator"
  | "self"
  | "target_is_owner"
  | "target_not_a_member"
  | "target_protected"
  | "already_silenced"
  | "not_silenced";

/** Who may moderate: the same comparison `is_chat_admin` makes. */
const MODERATOR_ROLES = new Set(["owner", "admin"]);

/**
 * Who may be acted upon.
 *
 * **This set is not what protects the owner.** `owner` is refused by name
 * below, before this is consulted, so the answer carries its own reason — the
 * gateway's copy of this set proved the same thing by mutation: adding `owner`
 * here changes nothing. What it does is fail closed on a role this build has
 * not been taught, which the enum makes impossible today and a future value
 * ranking above owner would not.
 */
const MODERATABLE_ROLES = new Set(["admin", "member"]);

function normalizeRole(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** The reader, as the rail and the panel already know them. */
export interface VoiceModerationViewer {
  /** The reader's own id. `null` before the session is known. */
  readonly selfId: string | null;
  /** The reader's `chat_members.role` in this chat. */
  readonly role: string | null;
}

/** One occupant of a voice room, as much of them as the interface has. */
export interface VoiceModerationTarget {
  readonly userId: string;
  /**
   * The target's `chat_members.role`, or `null` for somebody with no membership
   * row — which happens, and is exactly when disconnecting them is the point.
   */
  readonly role: string | null;
  /**
   * `VoiceParticipant.canSpeak`: whether the SFU currently lets them publish,
   * or `null` when nobody here knows. Never read `null` as «silenced».
   */
  readonly canSpeak: boolean | null;
}

/**
 * The authorisation half, mirroring the gateway refusal for refusal.
 *
 * `null` means allowed. `route` is the gateway's own path segment, because that
 * is what the comparison in the test can pass to both sides.
 */
export function voiceModerationAuthBlock(
  viewer: VoiceModerationViewer,
  target: VoiceModerationTarget,
  route: "force-mute" | "remove",
): VoiceModerationBlock | null {
  const caller = normalizeRole(viewer.role);
  if (!caller) return "not_a_member";
  if (!MODERATOR_ROLES.has(caller)) return "not_a_moderator";

  // A reader whose own id is unknown cannot be compared against the target, and
  // «I am not sure whether this is you» must fail closed: the one action that
  // must never be offered to somebody about themselves is this one, because
  // lifting a silence on yourself would be a second door to a permission the
  // gateway recomputes on purpose.
  if (!viewer.selfId) return "self";
  if (viewer.selfId === target.userId) return "self";

  const subject = normalizeRole(target.role);
  if (!subject) {
    // No membership row: they may be put out of the room — they have no
    // standing to protect, and getting somebody out of a room they no longer
    // belong in is the whole point — but they may not be silenced, because the
    // permission a lift restores is computed from a role that is not there.
    return route === "remove" ? null : "target_not_a_member";
  }
  if (subject === "owner") return "target_is_owner";
  if (!MODERATABLE_ROLES.has(subject)) return "target_protected";
  return null;
}

/** The route each action travels, so the name is decided once. */
export function voiceModerationRoute(action: VoiceModerationAction): "force-mute" | "remove" {
  return action === "disconnect" ? "remove" : "force-mute";
}

/**
 * Why this one action is not offered, or `null` if it is.
 *
 * Authorisation first, then the state of the person — in that order, so that a
 * plain member is told «not for you» about the owner rather than «already
 * silenced», which would leak a fact about somebody they may not act on.
 */
export function voiceModerationBlock(
  viewer: VoiceModerationViewer,
  target: VoiceModerationTarget,
  action: VoiceModerationAction,
): VoiceModerationBlock | null {
  const auth = voiceModerationAuthBlock(viewer, target, voiceModerationRoute(action));
  if (auth) return auth;
  if (action === "disconnect") return null;

  // `null` is unknown, and unknown offers both directions on purpose.
  //
  // Outside the room this client is connected to, nothing reports a
  // permission — the table holds who is present and nothing else. Hiding the
  // lift there would mean a moderator who silences somebody and then leaves the
  // room can never undo it, which is worse than a menu with one item that turns
  // out to be a no-op. Both directions are idempotent on the server and both
  // answer with what they actually did, so neither can mislead.
  if (target.canSpeak === null) return null;
  if (action === "silence") return target.canSpeak ? null : "already_silenced";
  return target.canSpeak ? "not_silenced" : null;
}

/**
 * The actions to draw for this occupant, in the order they are drawn.
 *
 * Empty for somebody nothing may be done to, which is how the rail decides
 * whether the row is a menu trigger at all. A row that opens an empty menu is
 * the same defect as a control that does nothing.
 */
export function voiceModerationActions(
  viewer: VoiceModerationViewer,
  target: VoiceModerationTarget,
): VoiceModerationAction[] {
  const order: VoiceModerationAction[] = ["silence", "unsilence", "disconnect"];
  return order.filter((action) => voiceModerationBlock(viewer, target, action) === null);
}

/** Whether this reader may moderate anybody at all here. Gates the whole affordance. */
export function isVoiceModerator(role: string | null): boolean {
  return MODERATOR_ROLES.has(normalizeRole(role));
}

/**
 * What the gateway's answer means, already read. `refusalText` is
 * `voiceGatewayRefusalText(code)` — rendered by the caller so this module keeps
 * importing nothing and stays loadable by `node --test`.
 */
export type VoiceModerationResult =
  | { readonly ok: true; readonly canSpeak: boolean | null }
  | { readonly ok: false; readonly refusalText: string };

/**
 * The line shown after a moderation action, and the one branch in it that
 * matters.
 *
 * **A lift is not a grant.** `muted: false` makes the gateway recompute what a
 * fresh token would give that person — their role against the channel's
 * `speak_role`, and any staff mute from `public.mutes` — so somebody below the
 * channel's speaking role stays unable to publish and the answer says so in
 * `canPublish`. «Снова может говорить» over that answer would be a sentence
 * about something that did not happen, which is why the third branch exists and
 * reads as a warning rather than a success.
 *
 * `canSpeak === null` is unknown, not no: `remove` reports no permission at all,
 * and an older gateway might omit the field. Unknown takes the plain success —
 * the alternative is warning every moderator about a restriction that probably
 * is not there.
 */
export function voiceModerationFeedback(
  action: VoiceModerationAction,
  name: string,
  result: VoiceModerationResult,
): { kind: "success" | "warning" | "error"; title: string; detail?: string } {
  if (!result.ok) return { kind: "error", title: result.refusalText };
  if (action === "disconnect") {
    return {
      kind: "success",
      title: `${name} отключён от голосового канала`,
      // Said because a moderator will expect otherwise: this is not a ban, and
      // nothing stops them pressing the channel again a second later.
      detail: "Вернуться в канал это не запрещает.",
    };
  }
  if (action === "silence") {
    return { kind: "success", title: `${name} больше не может говорить в этом канале` };
  }
  if (result.canSpeak === false) {
    return {
      kind: "warning",
      title: "Заглушение снято, но говорить всё равно нельзя",
      detail: `${name} не хватает прав в этом канале — проверьте, кому разрешено говорить.`,
    };
  }
  return { kind: "success", title: `${name} снова может говорить` };
}
