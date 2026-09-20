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
 * ## What would close the other half, and why it is not here
 *
 * Telegram denormalises. Its `fwd_from` carries the origin **on the copy**, and
 * the proof that it is stored rather than joined is its own privacy setting: a
 * sender who forbids linking still has their *name* travel with the forward,
 * which no join could produce. Ours would need the same — a column on
 * `public.messages` filled by `forward_message` from the server's own row of
 * the source — and that is a production migration, which CLAUDE.md §10 does not
 * let this task take on its own. It is written up for the owner in the tracker
 * under item 46 (h), with its cost.
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
}): string | null {
  if (!input.forwardedFromId) return null;
  const explicit = input.explicit?.name?.trim();
  if (explicit) return explicit;
  const source = input.source;
  if (!source) return null;
  if (source.deleted_at) return null;
  const name = messageActorDisplayName(source).trim();
  return name || null;
}

/** Whether the line is drawn at all: any forward gets one, named or not. */
export function showsForwardedLine(forwardedFromId: string | null | undefined): boolean {
  return Boolean(forwardedFromId);
}
