#!/usr/bin/env node

/**
 * Hand the old thin previews back to the media variants worker (D-116).
 *
 * The worker never regenerates a variant that already exists, so the new
 * sizing rule reached new uploads only. This marks the `image_preview` rows
 * that were written under the old rule as `stale`, which is the one thing that
 * puts a message back into the worker's candidate set. The worker then
 * downloads the original it already has, resizes it with its own rule and
 * replaces the row.
 *
 * It deliberately does not resize anything itself. One writer of variant bytes
 * means the backfilled pictures cannot come out different from the ones the
 * worker produces normally, which is the whole point of the exercise.
 *
 * Safe to stop at any point and safe to run again: the only write is a status
 * flip, a row already flipped is no longer `ready` so it is not selected twice,
 * and a row the worker has finished is at the new size so it no longer matches.
 *
 * Dry run unless `--apply` is passed. Prints counts and byte totals only: no
 * ids, paths, chat or message identifiers.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { selectPreviewBackfillRows } from "../artifacts/api-server/src/workers/mediaPreviewBackfill.ts";

/**
 * How many rows one run may flip.
 *
 * The worker's own `MEDIA_VARIANTS_PROCESS_LIMIT` defaults to 12 messages per
 * tick, so a batch of that size is drained within a single tick. While a row is
 * `stale` the reader has no preview for that message and the bubble falls back
 * to the full original, so keeping the batch at one tick's worth keeps that
 * window to about a minute rather than spreading it over the whole set.
 */
const DEFAULT_BATCH = 12;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const all = args.includes("--all");
const batch = readIntFlag("--batch", DEFAULT_BATCH);

if (args.some((arg) => !["--apply", "--all"].includes(arg) && !arg.startsWith("--batch"))) {
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

  // Only the geometry is read. No path, no message id, nothing that identifies
  // a person or a conversation leaves the database.
  //
  // A deleted message is skipped, and that filter was learned the hard way: on
  // 2026-09-12 a first run marked one such row stale, and the worker will never
  // take it — it scans live messages only — so the row sat stale for good.
  // Nothing rendered it, but nothing would ever have cleared it either. The
  // embedded filter reads the deletion flag and nothing else, so the promise
  // above still holds.
  const { data, error } = await client
    .from("media_variants")
    .select("id, variant_kind, status, width, height, size_bytes, messages!inner(deleted_at)")
    .eq("variant_kind", "image_preview")
    .eq("status", "ready")
    .is("messages.deleted_at", null);

  if (error) {
    console.error("media_preview_backfill_select_failed");
    process.exitCode = 1;
    return;
  }

  const ready = data ?? [];
  const selected = selectPreviewBackfillRows(ready);
  const selectedBytes = selected.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0);

  console.log(`ready_image_previews ${ready.length}`);
  console.log(`needing_regeneration ${selected.length}`);
  console.log(`current_preview_bytes ${selectedBytes}`);

  if (selected.length === 0) {
    console.log("nothing_to_do");
    return;
  }

  const target = all ? selected : selected.slice(0, batch);
  console.log(`this_run ${target.length}`);
  console.log(`remaining_after ${selected.length - target.length}`);

  if (!apply) {
    console.log("dry_run: pass --apply to mark these rows stale");
    return;
  }

  let flipped = 0;
  for (const row of target) {
    // One row at a time, and only from `ready`. If another process has already
    // changed this row — the worker finishing it, someone re-uploading — the
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
    flipped += (updated ?? []).length;
  }

  console.log(`marked_stale ${flipped}`);
  console.log("the worker regenerates these on its next ticks; re-run to see what is left");
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
