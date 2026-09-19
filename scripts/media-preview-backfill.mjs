#!/usr/bin/env node

/**
 * Hand the old thin previews back to the media variants worker (D-116).
 *
 * The worker never regenerates a variant that already exists, so the new sizing
 * rule reached new uploads only. This finds the `image_preview` rows that were
 * written under the old rule, marks them `stale`, and in the same run hands
 * each of their messages back to the worker. The worker then downloads the
 * original it already has, resizes it with its own rule and replaces the row.
 *
 * ## Two writes per picture, and both are needed
 *
 *   1. `media_variants.status` goes `ready` -> `stale`. That is what makes the
 *      worker treat the variant as owed rather than done.
 *   2. `messages.media_url` is written back to its own value. That fires
 *      `trg_enqueue_media_variant_job_on_update`, which puts a row in
 *      `private.media_variant_jobs` -- the queue the worker actually drains.
 *      Nothing about the message changes; the write *is* the notification.
 *
 * The second write is new (D-207). Marking alone was the whole mechanism until
 * `6a26bc8` moved the worker onto that queue, which it drains every five
 * seconds, and demoted its old scan to a half-hourly safety net over the newest
 * 1200 media messages. A marked row is therefore no longer regenerated because
 * it was marked; the safety net would reach it eventually, but only while its
 * message is still young enough to be swept, and a back-fill is about old
 * pictures by definition. Until something regenerates it, a marked picture is
 * served as its full-size original, because the client skips any variant that
 * is not `ready` -- so a run that marks and does not enqueue makes the product
 * worse than not running at all. Which column to write, and which messages the
 * trigger will accept, live in `mediaPreviewBackfill.ts` with their own tests.
 *
 * It deliberately does not resize anything itself. One writer of variant bytes
 * means the backfilled pictures cannot come out different from the ones the
 * worker produces normally, which is the whole point of the exercise.
 *
 * ## Safe to stop at any point and safe to run again
 *
 * The mark comes before the enqueue, because the reverse order races the
 * five-second drain: a job claimed before its row was marked finds nothing
 * outstanding and is discarded, stranding the row. In this order the only
 * window is the one request between the two writes, and a run that dies inside
 * it leaves a stale row with no job -- which the *next* run picks up, because
 * it looks for exactly that shape before it marks anything new. Otherwise: a
 * row already marked is no longer `ready` so it is not selected twice, a row
 * the worker has finished is at the new size so it no longer matches, and the
 * enqueue is `on conflict do nothing` at the database end.
 *
 * A row whose message the enqueue trigger would ignore -- deleted, or carrying
 * neither a path nor a URL -- is counted and left alone. There is no honest
 * thing to do with a picture that can be marked but not handed back.
 *
 * ## What it reads, and what it prints
 *
 * Writing `media_url` back means reading it, so a run holds message ids and
 * stored media URLs in memory. None of them is printed, logged or written
 * anywhere. The output is counts and byte totals, as before: no ids, paths,
 * chat or message identifiers.
 *
 * ## What a run costs the people using the product
 *
 * `public.messages` is in the `supabase_realtime` publication, and the client
 * answers a message UPDATE by re-fetching that row with its joins. So each
 * touch costs every reader with that chat open two PostgREST round trips and a
 * list re-render, for a row that did not change -- the same cost an ordinary
 * edit has. The default batch bounds it to a dozen. It is a reason to run this
 * while the product is quiet, and a reason not to reach for `--all`.
 *
 * Dry run unless `--apply` is passed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  planPreviewBackfill,
  selectPreviewBackfillRows,
} from "../artifacts/api-server/src/workers/mediaPreviewBackfill.ts";

/**
 * How many rows one run may put through.
 *
 * The worker's own `MEDIA_VARIANTS_PROCESS_LIMIT` defaults to 12 messages per
 * drain and it drains every five seconds, so a batch of that size is taken in a
 * single pass. While a row is `stale` the reader has no preview for that
 * message and the bubble falls back to the full original, so keeping the batch
 * at one pass's worth keeps that window to seconds rather than spreading it
 * over the whole set.
 */
const DEFAULT_BATCH = 12;

/** The columns the enqueue trigger reads, and the id that identifies the row. */
const MESSAGE_EMBED = "messages!inner(id, type, deleted_at, media_path, media_url)";
const VARIANT_SELECT = `id, message_id, variant_kind, status, width, height, size_bytes, ${MESSAGE_EMBED}`;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const all = args.includes("--all");
const batch = readIntFlag("--batch", DEFAULT_BATCH);

if (unknownArgs(args).length > 0) {
  console.error("usage: node scripts/media-preview-backfill.mjs [--apply] [--batch N] [--all]");
  process.exitCode = 1;
} else {
  await run();
}

async function run() {
  const env = loadEnvFiles([
    process.env.KUB_QA_ENV_FILE,
    path.join(process.cwd(), ".local", "secrets", "letscube-infra.env"),
    path.join(os.homedir(), ".kub-messenger-qa.env"),
  ]);
  const supabaseUrl = readEnv(env, "SUPABASE_URL") || readEnv(env, "VITE_SUPABASE_URL");
  const serviceRoleKey =
    readEnv(env, "SUPABASE_SERVICE_ROLE_KEY") || readEnv(env, "SELFHOST_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("media_preview_backfill_credentials_missing");
    process.exitCode = 1;
    return;
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // The geometry decides what to redo; the embedded message columns are the
  // ones the enqueue trigger itself reads, and `media_url` is additionally the
  // value written back. Nothing here is printed.
  //
  // A deleted message is skipped, and that filter was learned the hard way: on
  // 2026-09-12 a first run marked one such row stale, and the worker will never
  // take it -- it scans live messages only -- so the row sat stale for good.
  const ready = await selectVariants(client, "ready");
  if (!ready) return;

  // What an interrupted earlier run, or the version of this script that could
  // only mark, left behind: stale with nothing queued. The mark is already
  // done; only the hand-back is missing.
  const orphaned = await selectVariants(client, "stale");
  if (!orphaned) return;

  const selected = selectPreviewBackfillRows(ready);
  const selectedBytes = selected.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0);
  const plan = planPreviewBackfill(selected);
  const recovery = planPreviewBackfill(orphaned);

  console.log(`ready_image_previews ${ready.length}`);
  console.log(`needing_regeneration ${selected.length}`);
  console.log(`current_preview_bytes ${selectedBytes}`);
  console.log(`orphaned_stale_previews ${recovery.regenerate.length}`);
  console.log(`not_enqueueable ${plan.unenqueueable.length + recovery.unenqueueable.length}`);

  if (plan.regenerate.length === 0 && recovery.regenerate.length === 0) {
    console.log("nothing_to_do");
    return;
  }

  // One budget for the run, and the rows that are already degraded spend it
  // first: recovering one is strictly better than marking a new one.
  const budget = all ? Number.POSITIVE_INFINITY : batch;
  const recoveryTarget = recovery.regenerate.slice(0, budget);
  const target = plan.regenerate.slice(0, Math.max(0, budget - recoveryTarget.length));

  console.log(`this_run ${target.length}`);
  console.log(`recovering ${recoveryTarget.length}`);
  console.log(`remaining_after ${plan.regenerate.length - target.length}`);

  if (!apply) {
    console.log("dry_run: pass --apply to mark these rows stale and hand them back");
    return;
  }

  let flipped = 0;
  let enqueued = 0;
  let movedOn = 0;

  for (const { touch } of recoveryTarget) {
    const touched = await enqueueMessage(client, touch);
    if (touched < 0) break;
    enqueued += touched;
    movedOn += touched === 0 ? 1 : 0;
  }

  if (process.exitCode !== 1) {
    for (const { row, touch } of target) {
      // One row at a time, and only from `ready`. If another process has already
      // changed this row -- the worker finishing it, someone re-uploading -- the
      // filter matches nothing and the row is left as it is rather than being
      // dragged backwards.
      const { data: updated, error: updateError } = await client
        .from("media_variants")
        .update({ status: "stale", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "ready")
        .select("id");
      if (updateError) {
        console.error("media_preview_backfill_update_failed");
        process.exitCode = 1;
        break;
      }
      // Nothing was marked, so there is nothing to hand back for this row.
      if ((updated ?? []).length === 0) continue;
      flipped += 1;

      const touched = await enqueueMessage(client, touch);
      if (touched < 0) break;
      enqueued += touched;
      movedOn += touched === 0 ? 1 : 0;
    }
  }

  console.log(`marked_stale ${flipped}`);
  console.log(`enqueued ${enqueued}`);
  // A message whose media changed between the select and the write was not
  // touched by this run, and did not need to be: that change fired the same
  // trigger on its own way through.
  console.log(`already_moved_on ${movedOn}`);
  console.log("the worker takes these on its next drain; re-run to see what is left");
}

/** The `image_preview` rows in one status, with the columns the trigger reads. */
async function selectVariants(client, status) {
  const { data, error } = await client
    .from("media_variants")
    .select(VARIANT_SELECT)
    .eq("variant_kind", "image_preview")
    .eq("status", status)
    .is("messages.deleted_at", null);

  if (error) {
    console.error("media_preview_backfill_select_failed");
    process.exitCode = 1;
    return null;
  }
  return data ?? [];
}

/**
 * Write the message's own `media_url` back onto it, which fires
 * `trg_enqueue_media_variant_job_on_update` and enqueues the message.
 *
 * Conditional on the value still being the one that was read, so a message
 * whose media changed in the meantime is left exactly as it is: the filter
 * matches nothing, this run writes nothing for it, and that change has already
 * enqueued the message through the same trigger.
 *
 * Returns how many rows were written -- 1 or 0 -- or -1 if the request failed.
 */
async function enqueueMessage(client, touch) {
  const update = client
    .from("messages")
    .update({ [touch.column]: touch.value })
    .eq("id", touch.message_id);
  const guarded =
    touch.value === null ? update.is(touch.column, null) : update.eq(touch.column, touch.value);

  const { data, error } = await guarded.select("id");
  if (error) {
    console.error("media_preview_backfill_enqueue_failed");
    process.exitCode = 1;
    return -1;
  }
  return (data ?? []).length > 0 ? 1 : 0;
}

/**
 * Arguments this script does not recognise.
 *
 * `--batch N` writes its value as a separate argument, which the flag consumes;
 * the check this replaced treated that value as an unknown argument and refused
 * the very form its own usage line advertises, so only `--batch=N` ever worked.
 */
function unknownArgs(argv) {
  return argv.filter((arg, index) => {
    if (arg === "--apply" || arg === "--all") return false;
    if (arg === "--batch" || arg.startsWith("--batch=")) return false;
    if (index > 0 && argv[index - 1] === "--batch") return false;
    return true;
  });
}

function readIntFlag(name, fallback) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  const value = inline ? inline.slice(name.length + 1) : args[args.indexOf(name) + 1];
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function loadEnvFiles(files) {
  const env = {};
  for (const file of files) {
    if (!file) continue;
    let contents;
    try {
      contents = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in env)) env[key] = value;
    }
  }
  return env;
}

function readEnv(env, name) {
  return process.env[name] || env[name] || "";
}
