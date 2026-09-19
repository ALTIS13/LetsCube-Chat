/**
 * Which stored `image_preview` rows were written under the old sizing rule.
 *
 * D-116 changed how a preview is sized: the long side still stops at 1280, but
 * the short side now keeps at least 720 when the source has it. The worker does
 * not regenerate a variant that already exists, so without a backfill only new
 * uploads get the better preview and a tall picture sent last week keeps its
 * thin one. This module decides which rows that is.
 *
 * Deliberately self-contained: no imports at all. `mediaVariantRules.ts` reaches
 * its neighbour through an extensionless relative path, which Node's resolver
 * cannot follow, so a test that imported this through it would need the bundle
 * built first. With nothing to resolve, `node --test` reads this source
 * directly and the selection can be proven without a build step.
 *
 * The sizing rule itself is *not* copied here. `previewNeedsRegeneration` takes
 * it as a function, so the operator tool can hand it the worker's own
 * `imagePreviewSize` and a test can hand it the client's
 * `originalPreviewDimensions` — which an existing test already pins to be the
 * same arithmetic. A second copy of that formula is exactly the drift the
 * original defect was made of.
 */

/** The long side every `image_preview` was capped at before D-116, and still is. */
export const LEGACY_PREVIEW_LONG_SIDE_CAP = 1280;

/**
 * The width a tall preview keeps when the source has it.
 *
 * Mirrors `IMAGE_PREVIEW_MIN_SHORT_SIDE` in `mediaVariantRules.ts`. It is read
 * here only to recognise a row that sits below it; the resizing is still the
 * worker's.
 *
 * It was 720 while the bubble's cap was 480. Both moved together on 2026-09-12,
 * when the owner asked for the cap higher: the box on the phone the tester
 * holds is 310x550 CSS, which is 930x1650 device pixels.
 */
export const PREVIEW_BACKFILL_MIN_SHORT_SIDE = 930;

export interface PreviewSize {
  width: number;
  height: number;
}

/** A preview sizing rule: the box a source of this size should be drawn into. */
export type PreviewSizer = (width: number, height: number, max: number) => PreviewSize;

/** What a stored variant row has to say for itself before anything is decided. */
export interface StoredPreviewRow {
  variant_kind?: string | null;
  status?: string | null;
  width?: number | null;
  height?: number | null;
}

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The size the old rule produced, for a source of this size.
 *
 * Only the long side was capped, and nothing was ever enlarged. Kept here
 * because the selection's soundness is a claim *about* these rows: a test can
 * generate the exact geometry production holds rather than guessing at it.
 */
export function legacyPreviewSize(
  width: number,
  height: number,
  max: number = LEGACY_PREVIEW_LONG_SIDE_CAP,
): PreviewSize {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Whether a stored preview is worth reading the original for, from the row alone.
 *
 * Three facts about the old rule make this decidable without touching storage:
 *
 * - A preview whose long side is under the cap was never scaled at all, so it
 *   is the source's own size, and the new rule leaves a source alone too.
 * - A preview lying down is already right: the floor applies only to a picture
 *   taller than it is wide, because that is the one whose *width* — the axis
 *   that fills the bubble — is its short side. A landscape picture fills the
 *   bubble with its long side, which the cap leaves at 1280, well past the
 *   floor, so the new rule returns exactly the box it already has.
 * - A tall preview at the cap whose width already clears the floor is inside
 *   the rule too.
 * - A preview above the cap cannot have come from the old rule; it was written
 *   by the new one and is already right.
 *
 * So the candidates are the upright rows sitting exactly at the cap with a
 * width under the floor. This never misses a row that needs regenerating — the
 * sweep in `tests/unit/media-preview-backfill.test.mjs` holds that — and it
 * admits one harmless false positive, a source whose long side is itself
 * exactly 1280, which regenerates to the size it already has.
 */
export function isPreviewBackfillCandidate(
  width: number | null | undefined,
  height: number | null | undefined,
): boolean {
  // A row with no recorded size says nothing about its geometry. Reading it as
  // a candidate would put every unknown row through a regeneration on a guess.
  if (!isPositive(width) || !isPositive(height)) return false;
  const longSide = Math.max(width, height);
  if (longSide !== LEGACY_PREVIEW_LONG_SIDE_CAP) return false;
  // Square counts as lying down: nothing is floored at 1:1 either.
  if (height <= width) return false;
  return width < PREVIEW_BACKFILL_MIN_SHORT_SIDE;
}

/**
 * The ground truth, once the original's real size is known.
 *
 * The backfill tool does not use this — it would have to download every
 * original to ask — but it is what `isPreviewBackfillCandidate` is checked
 * against, and it is what the worker effectively re-derives when it rewrites
 * the row.
 */
export function previewNeedsRegeneration(
  recorded: PreviewSize,
  source: PreviewSize,
  sizePreview: PreviewSizer,
  max: number = LEGACY_PREVIEW_LONG_SIDE_CAP,
): boolean {
  const wanted = sizePreview(source.width, source.height, max);
  return wanted.width !== recorded.width || wanted.height !== recorded.height;
}

/**
 * The rows to hand back to the worker, out of everything the table holds.
 *
 * `status` is load-bearing and not a formality. A `failed` row may carry
 * `source_missing` or `source_unreadable`, which is the worker's only memory of
 * a dead end; reviving one as work to do would reintroduce D-034, where the
 * worker re-fetched objects that were never coming back. Only a row that
 * currently serves a reader is eligible to be replaced.
 */
export function selectPreviewBackfillRows<T extends StoredPreviewRow>(rows: readonly T[]): T[] {
  return rows.filter(
    (row) =>
      row.variant_kind === "image_preview" &&
      row.status === "ready" &&
      isPreviewBackfillCandidate(row.width, row.height),
  );
}

/*
 * ── Handing a marked row back to the worker (D-207) ─────────────────────────
 *
 * Marking a row `stale` used to be the whole mechanism: the worker rescanned
 * every minute, and a row that was not `ready` was work. `6a26bc8` moved it
 * onto `private.media_variant_jobs`, which it drains every five seconds, and
 * demoted the scan to a half-hourly safety net over the newest
 * `MEDIA_VARIANTS_CANDIDATE_SCAN_LIMIT` (1200) media messages, at most
 * `MEDIA_VARIANTS_PROCESS_LIMIT` (12) of them per pass. So a marked row is no
 * longer regenerated *because* it was marked. It is regenerated because
 * something put a job in the queue — or, eventually and only while the message
 * is still young enough to be swept, because the safety net reached it. A
 * back-fill is by definition about old pictures, which are the first to fall
 * out of that window, so it must enqueue rather than hope.
 *
 * The operator tool cannot insert the job itself: the queue lives in `private`,
 * which PostgREST does not expose, and is owned by `supabase_admin`. What it
 * can do is what the product does — write one of the columns the enqueue
 * trigger watches.
 */

/**
 * The columns `trg_enqueue_media_variant_job_on_update` is declared on.
 *
 * `after update of media_bucket, media_path, media_url`. Postgres fires a
 * column-list trigger whenever one of the named columns appears in the SET
 * clause, **whether or not the value changes**, and
 * `private.enqueue_media_variant_job_for_message` carries no unchanged-value
 * guard of its own: it checks the type, the deletion flag and that a path or a
 * URL is present, then inserts `on conflict do nothing`. So writing a column
 * back to its own value enqueues the message through the product's own path.
 */
export const MEDIA_VARIANT_JOB_TRIGGER_COLUMNS = [
  "media_bucket",
  "media_path",
  "media_url",
] as const;

/**
 * The one of them to write, and why it is that one rather than either other.
 *
 * `media_url` is the only column of the three that no other trigger on
 * `public.messages` watches. The other two are also watched by
 * `trg_guard_message_media_path`, a BEFORE trigger that raises
 * `message_media_path_not_owned` when the path does not belong to the sender,
 * and by `trg_enqueue_bot_message_updates_after_update`, which today returns
 * early on an unchanged row and so sends nothing. Both are harmless as they
 * stand — the guard lets a null `auth.uid()` through on purpose, the bot
 * trigger compares old and new — and both are somebody else's code, free to
 * change for reasons that have nothing to do with a back-fill. Writing the
 * column that fires one trigger rather than three is not tidiness: it is the
 * difference between a tool whose blast radius is stated and one whose blast
 * radius is a promise made by two functions it does not own.
 *
 * Measured on production on 2026-09-19, inside a transaction that was rolled
 * back, as `service_role`: writing `media_url` back to its own value took
 * `private.media_variant_jobs` from 0 rows to 1 while `media_url` itself was
 * unchanged; writing `pinned` back to its own value in the same shape left the
 * queue at 0, which is what makes the first measurement mean anything.
 */
export const PREVIEW_BACKFILL_TOUCH_COLUMN = "media_url";

/** The message columns the enqueue trigger reads, as PostgREST returns them. */
export interface BackfillMessageRow {
  id?: string | null;
  type?: string | null;
  deleted_at?: string | null;
  media_bucket?: string | null;
  media_path?: string | null;
  media_url?: string | null;
}

/** One write that asks the database to enqueue one message. */
export interface PreviewBackfillTouch {
  /** The message to write back to. */
  message_id: string;
  /** Which column is written. Always `PREVIEW_BACKFILL_TOUCH_COLUMN`. */
  column: typeof PREVIEW_BACKFILL_TOUCH_COLUMN;
  /** What to write: the column's own current value, so the row does not change. */
  value: string | null;
}

/**
 * Whether the trigger would enqueue this message if the column were written.
 *
 * A transcription of `private.enqueue_media_variant_job_for_message`'s body and
 * nothing else. It matters that this is exact rather than merely conservative:
 * a row the trigger would ignore must not be marked `stale`, because marking
 * without enqueuing is the whole of D-207 — the picture falls back to its
 * full-size original and nothing ever puts it back.
 */
export function canEnqueueMessageVariantJob(
  message: BackfillMessageRow | null | undefined,
): boolean {
  if (!message) return false;
  if (message.type !== "image" && message.type !== "video") return false;
  // `deleted_at is null` in the trigger. An absent key is a column that was not
  // selected, which is not the same claim as a null, so it is not accepted.
  if (message.deleted_at !== null) return false;
  return (
    (message.media_path ?? null) !== null || (message.media_url ?? null) !== null
  );
}

/**
 * A variant row as the back-fill selects it, with its message embedded.
 *
 * PostgREST returns a to-one embed as an object, but returns an array for the
 * same relation when it reads it as to-many — which is a shape the caller
 * cannot see going wrong, because both are truthy. Both are accepted here and
 * both are tested.
 */
export interface StoredPreviewRowWithMessage extends StoredPreviewRow {
  message_id?: string | null;
  messages?: BackfillMessageRow | readonly BackfillMessageRow[] | null;
}

function embeddedMessage(row: StoredPreviewRowWithMessage): BackfillMessageRow | null {
  const embed = row.messages;
  if (!embed) return null;
  if (Array.isArray(embed)) return embed.length === 1 ? (embed[0] ?? null) : null;
  return embed as BackfillMessageRow;
}

/** What the back-fill will do with the rows it has selected. */
export interface PreviewBackfillPlan<T> {
  /** Rows to mark `stale`, each with the write that hands it back to the worker. */
  regenerate: { row: T; touch: PreviewBackfillTouch }[];
  /**
   * Rows that qualify on geometry but whose message the trigger would ignore.
   *
   * Left alone rather than marked. There is no honest thing to do with a row
   * that cannot be enqueued: marking it would degrade the picture for good.
   */
  unenqueueable: T[];
}

/**
 * Pair each selected row with the one write that puts it back in front of the
 * worker, and separate out the rows for which there is no such write.
 *
 * Deliberately does no selecting of its own: the caller has already decided
 * which rows it is talking about, either `selectPreviewBackfillRows` for the
 * rows to mark or the already-`stale` rows an interrupted earlier run left
 * behind.
 */
export function planPreviewBackfill<T extends StoredPreviewRowWithMessage>(
  rows: readonly T[],
): PreviewBackfillPlan<T> {
  const plan: PreviewBackfillPlan<T> = { regenerate: [], unenqueueable: [] };
  for (const row of rows) {
    const message = embeddedMessage(row);
    const messageId = message?.id ?? row.message_id ?? null;
    if (!messageId || !canEnqueueMessageVariantJob(message)) {
      plan.unenqueueable.push(row);
      continue;
    }
    plan.regenerate.push({
      row,
      touch: {
        message_id: messageId,
        column: PREVIEW_BACKFILL_TOUCH_COLUMN,
        value: message?.[PREVIEW_BACKFILL_TOUCH_COLUMN] ?? null,
      },
    });
  }
  return plan;
}
