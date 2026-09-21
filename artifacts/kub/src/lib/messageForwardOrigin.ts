/**
 * Who wrote the original of a forwarded message, and when we can honestly say.
 *
 * D-291, from the tester of 2026-09-20: «плюс не вижу от кого переслал
 * сообщения тебе». The bubble has drawn «Переслано от имя» since the forward
 * was built, from a field called `forward_origin` — which the whole repository
 * mentions three times: its own type, that one consumer, and a QA fixture.
 * Nothing ever filled it, so every real forward read a bare «Переслано».
 *
 * ## Where the name can come from, and the wall in the middle
 *
 * `forwarded_from_id` has always been written, so the copy knows which row it
 * came from. Reading that row is the problem: the SELECT policy on
 * `public.messages` is `is_chat_member(chat_id)`, so a reader can only see the
 * source if they are in the chat it was sent to.
 *
 * That splits the people looking at one forwarded message in two:
 *
 *   - **the person who forwarded it** — a member of the source chat by
 *     definition, since `forward_message` refuses otherwise. They see the name.
 *     This is the tester's own case, word for word: he forwarded and could not
 *     see from whom;
 *   - **anyone else in the target chat**, who usually is not. They go on seeing
 *     «Переслано», exactly as before.
 *
 * So this closes the complaint that was made and leaves a real half open, and
 * the half is named rather than hidden: a surface that quietly says different
 * things to two people is worse than one that says so out loud.
 *
 * ## What closes the other half — and it is the owner's correction, not ours
 *
 * The paragraph that stood here proposed denormalising as an improvement we
 * might one day afford. The owner settled it on 2026-09-20 and corrected the
 * premise underneath it: «У телеграма скрытие имени при пересылке завязано на
 * настройках приватности, т.е. изначально все видят изначального отправителя
 * пересылаемого сообщения.»
 *
 * So the RLS-dependent half above is not «a real half left open». It is wrong.
 * Under it the same forward shows a name to one reader and withholds it from
 * another, and **nobody chose that** — it is an artefact of who holds access,
 * not a decision by the person whose name it is. A privacy property that varies
 * by the viewer's access without the subject's involvement is not a privacy
 * property. The control belongs to the person being disclosed: disclosed by
 * default, opted out once in «Конфиденциальность», read at the moment of
 * forwarding and never again.
 *
 * ## What the copy carries, and how this file reads it
 *
 * Migration 20260921120000 puts the answer on the copy:
 *
 *   - `forward_origin_name` — the origin's display name, captured at forward
 *     time. Readable by everyone who can read the message at all, so it no
 *     longer flickers by reader;
 *   - `forward_origin_hidden` — true where the original sender had opted out at
 *     that moment. Permanent in both directions: a later change of their
 *     setting reaches into nothing already sent.
 *
 * Both are written only by `trg_messages_forward_origin`, never by a client.
 *
 * **Three states, not two**, and the third is why `hidden` is a column of its
 * own rather than «name is null». A forward made before that migration carries
 * neither: `name` null and `hidden` false. That is «not recorded», and it falls
 * back to the join, which is exactly today's behaviour — the migration
 * deliberately backfills nothing, because reading every sender's setting **as
 * it stands now** and stamping it on messages sent before they had one is the
 * retroactive direction the decision refuses.
 *
 * Nothing here imports anything but the actor helper, which imports nothing
 * either, so `node --test` reads this file directly.
 */

import { messageActorDisplayName, type ActorSource } from "./messageActor.ts";

/** What the reader is told above a forwarded message when the source is unknown. */
export const FORWARDED_WITHOUT_ORIGIN = "Переслано";
/** And when it is known. The name is drawn beside this, not inside it. */
export const FORWARDED_FROM_PREFIX = "Переслано от";

/**
 * The source row as the projection brings it back, or nothing.
 *
 * `null` from PostgREST means «this row exists and you may not read it», and
 * `undefined` means «nobody asked for it». Both are the same answer to this
 * surface — no name — and neither is an error.
 */
export type ForwardSourceRow = Partial<ActorSource> & { deleted_at?: string | null };

/**
 * The name to draw, or `null` when there is none to draw honestly.
 *
 * Three things answer `null`, and each is a different fact the surface must not
 * dress up as the fourth:
 *
 *   - the message is not a forward at all;
 *   - it is, and the source could not be read — the reader is not in that chat;
 *   - it is, and the source has since been deleted. A name lifted off a deleted
 *     row would outlive the message it belonged to, which is the opposite of
 *     what deleting is for.
 *
 * `explicit` wins where it is given: it is the client's own knowledge —
 * the preview fixture's, and anything that ever learns the origin another way —
 * and a locally known name is better than a join that has not landed yet.
 */
export function forwardOriginName(input: {
  forwardedFromId?: string | null;
  explicit?: { name: string } | null;
  source?: ForwardSourceRow | null;
  /** `messages.forward_origin_name`, captured at forward time. */
  originName?: string | null;
  /** `messages.forward_origin_hidden`: the original sender had opted out. */
  originHidden?: boolean | null;
}): string | null {
  if (!input.forwardedFromId) return null;

  // The copy's own record comes first, before anything read per reader. It is
  // the same answer for everybody, which is the whole point of writing it down.
  if (input.originHidden) return null;
  const recorded = input.originName?.trim();
  if (recorded) return recorded;

  const explicit = input.explicit?.name?.trim();
  if (explicit) return explicit;
  // Nothing recorded: a forward from before 20260921120000. The join, and with
  // it the old per-reader answer, which is what those rows have always had.
  const source = input.source;
  if (!source) return null;
  if (source.deleted_at) return null;
  const name = messageActorDisplayName(source).trim();
  return name || null;
}

/**
 * Whether the origin is withheld because the person chose to withhold it.
 *
 * Distinct from «there is no name here» — the surface may want to say so, and a
 * reader who is told «Переслано» because somebody opted out is being told
 * something true, while one told the same because they lack access is not.
 */
export function forwardOriginIsHidden(input: {
  forwardedFromId?: string | null;
  originHidden?: boolean | null;
}): boolean {
  return Boolean(input.forwardedFromId) && Boolean(input.originHidden);
}

/** Whether the line is drawn at all: any forward gets one, named or not. */
export function showsForwardedLine(forwardedFromId: string | null | undefined): boolean {
  return Boolean(forwardedFromId);
}
