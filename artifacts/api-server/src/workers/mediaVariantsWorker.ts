import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp, { type OutputInfo } from "sharp";
import { logger } from "../lib/logger";
import {
  AVATAR_VARIANTS,
  MESSAGE_IMAGE_VARIANTS,
  MESSAGE_VIDEO_VARIANTS,
  VIDEO_POSTER_VARIANT,
  buildCandidatePageRanges,
  buildChatAvatarVariantPath,
  buildMessageVariantPath,
  buildProfileAvatarVariantPath,
  classifyVariantError,
  getAttemptableMessageVariantKinds,
  getExpectedMessageVariantKinds,
  getMessageVariantTarget,
  sanitizeVariantErrorCode,
  type AvatarVariantKind,
  type MessageVariantKind,
} from "./mediaVariantRules";
import {
  buildMessageVariantFailedRow,
  buildMessageVariantReadyRow,
  buildVideo720pFfmpegArgs,
  isMissingStorageObjectError,
  parseVideoDimensions,
  safeStorageFailureDetails,
  shouldAttemptVariantKind,
  type RecordedVariantAttempt,
} from "./mediaVariantsWorkerHelpers";

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_CANDIDATE_LIMIT = 120;
const DEFAULT_CANDIDATE_SCAN_LIMIT = 1_200;
const DEFAULT_PROCESS_LIMIT = 12;
const DEFAULT_POSTER_FFMPEG_TIMEOUT_MS = 30_000;
const DEFAULT_VIDEO_TRANSCODE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_VIDEO_TRANSCODE_THREADS = 2;
const MEDIA_BUCKET = "media";
const WEBP_MIME_TYPE = "image/webp";
const execFileAsync = promisify(execFile);

interface MessageCandidate {
  id: string;
  chat_id: string;
  user_id: string | null;
  type: string | null;
  media_bucket: string | null;
  media_path: string | null;
  media_url: string | null;
  missingVariantKinds?: MessageVariantKind[];
}

/**
 * Something with a picture of its own that wants a small version of it.
 *
 * A person and a group are the same job: the same crop, at the same two sizes,
 * at the same quality. All that differs is which column of `media_variants`
 * carries the id and which prefix the files go under, so both are described
 * here rather than written out twice.
 */
interface AvatarCandidate {
  scope: "profile" | "chat";
  id: string;
  avatar_url: string | null;
}

/** Which column of `media_variants` names the owner of an avatar variant. */
type AvatarOwnerColumn = "profile_id" | "chat_id";

interface ExistingVariant {
  message_id: string | null;
  profile_id: string | null;
  chat_id: string | null;
  variant_kind: string;
  status: string;
  error_code: string | null;
  source_bucket: string | null;
  source_path: string | null;
}

/** What storage said when a download did not produce bytes. */
type StorageDownload =
  | { ok: true; body: Buffer }
  | { ok: false; missing: boolean };

interface StoragePointer {
  bucket: string;
  path: string;
}

interface GeneratedVariant {
  kind: string;
  path: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

let started = false;

export function startMediaVariantsWorker(): void {
  if (started) return;
  if (process.env["MEDIA_VARIANTS_WORKER_ENABLED"] === "0") {
    logger.info("mediaVariantsWorker disabled by MEDIA_VARIANTS_WORKER_ENABLED=0");
    return;
  }

  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const serviceKey =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SELFHOST_SERVICE_ROLE_KEY"];
  if (!url || !serviceKey) {
    logger.warn(
      "mediaVariantsWorker disabled: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing",
    );
    return;
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  started = true;
  logger.info("mediaVariantsWorker started");
  void loop(supabase);
}

async function loop(supabase: SupabaseClient): Promise<void> {
  const tickMs = positiveInteger(process.env["MEDIA_VARIANTS_WORKER_TICK_MS"], DEFAULT_TICK_MS);
  while (true) {
    try {
      await tick(supabase);
    } catch (err) {
      logger.error({ err }, "mediaVariantsWorker tick failed");
    }
    await sleep(tickMs);
  }
}

/**
 * One pass, exported so a test can drive the real loop body.
 *
 * The contract that matters for D-034 is about the *second* pass — that a
 * source proven absent is not fetched again — and no assertion on a helper in
 * isolation can hold that, because the helper is only right if the candidate
 * loader consults it.
 */
export async function runMediaVariantsTick(supabase: SupabaseClient): Promise<void> {
  await tick(supabase);
}

async function tick(supabase: SupabaseClient): Promise<void> {
  const [messages, profiles, chats] = await Promise.all([
    loadMessageCandidates(supabase),
    loadProfileCandidates(supabase),
    loadChatCandidates(supabase),
  ]);

  let processedMessages = 0;
  for (const message of messages) {
    if (processedMessages >= processLimit()) break;
    const ok = await ensureMessageVariants(supabase, message);
    if (ok) processedMessages += 1;
  }

  let processedProfiles = 0;
  for (const profile of profiles) {
    if (processedProfiles >= processLimit()) break;
    const ok = await ensureAvatarVariants(supabase, profile);
    if (ok) processedProfiles += 1;
  }

  let processedChats = 0;
  for (const chat of chats) {
    if (processedChats >= processLimit()) break;
    const ok = await ensureAvatarVariants(supabase, chat);
    if (ok) processedChats += 1;
  }

  if (processedMessages > 0 || processedProfiles > 0 || processedChats > 0) {
    logger.info(
      { processedMessages, processedProfiles, processedChats },
      "mediaVariantsWorker generated variants",
    );
  }
}

async function loadMessageCandidates(supabase: SupabaseClient): Promise<MessageCandidate[]> {
  const candidates: MessageCandidate[] = [];
  for (const range of buildCandidatePageRanges(candidateLimit(), candidateScanLimit())) {
    const { data, error } = await supabase
      .from("messages")
      .select("id, chat_id, user_id, type, media_bucket, media_path, media_url")
      .in("type", ["image", "video"])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(range.from, range.to);

    if (error) {
      logger.warn(
        { err: safeStorageFailureDetails(error) },
        "mediaVariantsWorker message select failed",
      );
      return candidates;
    }

    const rows = (data ?? []) as MessageCandidate[];
    const pageCandidates = rows.filter((row) =>
      Boolean(resolveStoragePath(row.media_bucket, row.media_path, row.media_url)),
    );
    if (pageCandidates.length > 0) {
      const existing = await loadExistingVariants(
        supabase,
        "message_id",
        pageCandidates.map((row) => row.id),
      );
      for (const row of pageCandidates) {
        const source = resolveStoragePath(row.media_bucket, row.media_path, row.media_url);
        if (!source) continue;
        const missingVariantKinds = getAttemptableMessageVariantKinds(
          row,
          existing.get(row.id),
          source,
        );
        if (missingVariantKinds.length > 0) candidates.push({ ...row, missingVariantKinds });
      }
    }

    if (rows.length < range.to - range.from + 1) break;
  }
  return candidates;
}

async function loadProfileCandidates(supabase: SupabaseClient): Promise<AvatarCandidate[]> {
  return loadAvatarCandidates(supabase, "profile", "profiles");
}

/**
 * Groups and channels whose own picture has no small version yet.
 *
 * A private chat is skipped on purpose: the client shows the other person's
 * profile picture there, which already has variants of its own, so a variant of
 * the chat row's picture would be produced and never asked for.
 */
async function loadChatCandidates(supabase: SupabaseClient): Promise<AvatarCandidate[]> {
  return loadAvatarCandidates(supabase, "chat", "chats", ["group", "channel"]);
}

async function loadAvatarCandidates(
  supabase: SupabaseClient,
  scope: AvatarCandidate["scope"],
  table: "profiles" | "chats",
  types?: string[],
): Promise<AvatarCandidate[]> {
  let query = supabase
    .from(table)
    .select("id, avatar_url")
    .not("avatar_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(candidateLimit());
  if (types) query = query.in("type", types);
  const { data, error } = await query;

  if (error) {
    logger.warn(
      { err: safeStorageFailureDetails(error), table },
      "mediaVariantsWorker avatar select failed",
    );
    return [];
  }

  const candidates = ((data ?? []) as { id: string; avatar_url: string | null }[])
    .filter((row) => Boolean(resolveStoragePath(MEDIA_BUCKET, null, row.avatar_url)))
    .map((row) => ({ scope, id: row.id, avatar_url: row.avatar_url }) satisfies AvatarCandidate);
  if (candidates.length === 0) return [];

  const existing = await loadExistingVariants(
    supabase,
    avatarOwnerColumn(scope),
    candidates.map((row) => row.id),
  );
  return candidates.filter((row) => {
    const source = resolveStoragePath(MEDIA_BUCKET, null, row.avatar_url);
    if (!source) return false;
    const attempts = existing.get(row.id);
    return AVATAR_VARIANTS.some((variant) =>
      shouldAttemptVariantKind(attempts?.get(variant.kind), source),
    );
  });
}

/**
 * What is already recorded for these owners, ready and failed alike.
 *
 * Deliberately not filtered to `status = 'ready'` any more. A failure is the
 * only memory this worker has — it keeps no queue and no cursor — so hiding
 * failed rows from the candidate loader is precisely what made D-034 permanent.
 */
async function loadExistingVariants(
  supabase: SupabaseClient,
  column: "message_id" | AvatarOwnerColumn,
  ids: string[],
): Promise<Map<string, Map<string, RecordedVariantAttempt>>> {
  if (ids.length === 0) return new Map();
  let query = supabase
    .from("media_variants")
    .select(`${column}, variant_kind, status, error_code, source_bucket, source_path`)
    .in(column, ids);
  // A message variant carries the id of the chat it lives in, so asking by
  // `chat_id` alone would also return every picture ever sent in these chats.
  // A chat's own avatar is the row with no message behind it.
  if (column === "chat_id") query = query.is("message_id", null);

  const { data, error } = await query;

  if (error) {
    logger.warn({ err: safeStorageFailureDetails(error) }, "mediaVariantsWorker variants lookup failed");
    return new Map();
  }

  const byOwner = new Map<string, Map<string, RecordedVariantAttempt>>();
  for (const row of (data ?? []) as ExistingVariant[]) {
    const id = row[column];
    if (!id) continue;
    const kinds = byOwner.get(id) ?? new Map<string, RecordedVariantAttempt>();
    // A ready row always wins over a failed one for the same kind: the two can
    // only coexist through a race, and having produced the file is the truth.
    if (kinds.get(row.variant_kind)?.status === "ready") continue;
    kinds.set(row.variant_kind, {
      status: row.status,
      errorCode: row.error_code,
      sourceBucket: row.source_bucket,
      sourcePath: row.source_path,
    });
    byOwner.set(id, kinds);
  }
  return byOwner;
}

function avatarOwnerColumn(scope: AvatarCandidate["scope"]): AvatarOwnerColumn {
  return scope === "chat" ? "chat_id" : "profile_id";
}

function avatarVariantPath(
  owner: AvatarCandidate,
  kind: AvatarVariantKind,
  sourcePath: string,
): string {
  return owner.scope === "chat"
    ? buildChatAvatarVariantPath(owner.id, kind, sourcePath)
    : buildProfileAvatarVariantPath(owner.id, kind);
}

async function ensureMessageVariants(supabase: SupabaseClient, message: MessageCandidate): Promise<boolean> {
  const source = resolveStoragePath(message.media_bucket, message.media_path, message.media_url);
  if (!source) return false;

  const download = await downloadStorageObject(supabase, source);
  if (!download.ok) {
    if (download.missing) await recordMissingMessageSource(supabase, message, source);
    return false;
  }
  const sourceBuffer = download.body;

  if (message.type === "video") {
    return ensureVideoMessageVariants(supabase, message, source, sourceBuffer);
  }
  if (message.type !== "image") return false;

  const missingKinds = new Set(
    message.missingVariantKinds ?? getExpectedMessageVariantKinds(message),
  );
  let generated = false;
  for (const variant of MESSAGE_IMAGE_VARIANTS) {
    if (!missingKinds.has(variant.kind)) continue;
    const variantPath = buildMessageVariantPath(message.chat_id, message.id, variant.kind);
    try {
      const output = await sharp(sourceBuffer)
        .rotate()
        .resize({ width: variant.max, height: variant.max, fit: "inside", withoutEnlargement: true })
        .webp({ quality: variant.quality })
        .toBuffer({ resolveWithObject: true });
      await uploadVariant(supabase, variantPath, output.data, WEBP_MIME_TYPE);
      await replaceMessageVariant(supabase, message, source, {
        kind: variant.kind,
        path: variantPath,
        mimeType: WEBP_MIME_TYPE,
        width: output.info.width,
        height: output.info.height,
        sizeBytes: output.info.size,
      });
      generated = true;
    } catch (err) {
      await markMessageVariantFailed(
        supabase,
        message,
        source,
        variant.kind,
        variantPath,
        WEBP_MIME_TYPE,
        classifyVariantError(err),
      );
    }
  }
  return generated;
}

async function ensureVideoMessageVariants(
  supabase: SupabaseClient,
  message: MessageCandidate,
  source: StoragePointer,
  sourceBuffer: Buffer,
): Promise<boolean> {
  const missingKinds = new Set(
    message.missingVariantKinds ?? getExpectedMessageVariantKinds(message),
  );
  let generated = false;
  for (const variant of MESSAGE_VIDEO_VARIANTS) {
    if (!missingKinds.has(variant.kind)) continue;
    const isPoster = variant.kind === "video_poster";
    const mimeType = isPoster ? WEBP_MIME_TYPE : variant.mimeType;
    const variantPath = buildMessageVariantPath(
      message.chat_id,
      message.id,
      variant.kind,
      isPoster ? "webp" : variant.extension,
    );
    try {
      if (isPoster) {
        const output = await generateVideoPosterVariant(sourceBuffer, source.path, VIDEO_POSTER_VARIANT);
        await uploadVariant(supabase, variantPath, output.data, mimeType);
        await replaceMessageVariant(supabase, message, source, {
          kind: variant.kind,
          path: variantPath,
          mimeType,
          width: output.info.width,
          height: output.info.height,
          sizeBytes: output.info.size,
        });
      } else {
        const output = await generateVideo720pVariant(sourceBuffer, source.path);
        await uploadVariant(supabase, variantPath, output.data, mimeType);
        await replaceMessageVariant(supabase, message, source, {
          kind: variant.kind,
          path: variantPath,
          mimeType,
          width: output.width,
          height: output.height,
          sizeBytes: output.data.length,
        });
      }
      generated = true;
    } catch (err) {
      await markMessageVariantFailed(
        supabase,
        message,
        source,
        variant.kind,
        variantPath,
        mimeType,
        classifyVariantError(err),
      );
    }
  }
  return generated;
}

async function generateVideoPosterVariant(
  sourceBuffer: Buffer,
  sourcePath: string,
  variant: typeof VIDEO_POSTER_VARIANT,
): Promise<{ data: Buffer; info: OutputInfo }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "letscube-video-poster-"));
  const inputPath = path.join(tempDir, `source${videoTempExtension(sourcePath)}`);
  const framePath = path.join(tempDir, "poster.jpg");
  try {
    await writeFile(inputPath, sourceBuffer);
    await extractVideoFrame(inputPath, framePath);
    const frame = await readFile(framePath);
    return sharp(frame)
      .rotate()
      .resize({ width: variant.max, height: variant.max, fit: "inside", withoutEnlargement: true })
      .webp({ quality: variant.quality })
      .toBuffer({ resolveWithObject: true });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function extractVideoFrame(inputPath: string, framePath: string): Promise<void> {
  const baseArgs = ["-hide_banner", "-loglevel", "error", "-y"] as const;
  const outputArgs = ["-frames:v", "1", "-an", framePath] as const;
  try {
    await runFfmpeg(
      [...baseArgs, "-ss", "00:00:01", "-i", inputPath, ...outputArgs],
      posterFfmpegTimeoutMs(),
    );
  } catch {
    await runFfmpeg([...baseArgs, "-i", inputPath, ...outputArgs], posterFfmpegTimeoutMs());
  }
}

async function generateVideo720pVariant(
  sourceBuffer: Buffer,
  sourcePath: string,
): Promise<{ data: Buffer; width: number; height: number }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "letscube-video-transcode-"));
  const inputPath = path.join(tempDir, `source${videoTempExtension(sourcePath)}`);
  const outputPath = path.join(tempDir, "video_720p.mp4");
  try {
    await writeFile(inputPath, sourceBuffer);
    await runFfmpeg(
      buildVideo720pFfmpegArgs(inputPath, outputPath, videoTranscodeThreads()),
      videoTranscodeTimeoutMs(),
    );
    const [data, dimensions] = await Promise.all([readFile(outputPath), probeVideoDimensions(outputPath)]);
    return { data, ...dimensions };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runFfmpeg(args: string[], timeout: number): Promise<void> {
  await execFileAsync(ffmpegPath(), args, {
    timeout,
    windowsHide: true,
    maxBuffer: 64 * 1024,
  });
}

async function probeVideoDimensions(outputPath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", outputPath],
    { timeout: videoTranscodeTimeoutMs(), windowsHide: true, maxBuffer: 64 * 1024 },
  );
  const dimensions = parseVideoDimensions(stdout);
  if (dimensions) return dimensions;
  throw Object.assign(new Error("video probe failed"), { code: "video_probe_failed" });
}

async function ensureAvatarVariants(
  supabase: SupabaseClient,
  owner: AvatarCandidate,
): Promise<boolean> {
  const source = resolveStoragePath(MEDIA_BUCKET, null, owner.avatar_url);
  if (!source) return false;

  const download = await downloadStorageObject(supabase, source);
  if (!download.ok) {
    if (download.missing) await recordMissingAvatarSource(supabase, owner, source);
    return false;
  }
  const sourceBuffer = download.body;

  let generated = false;
  for (const variant of AVATAR_VARIANTS) {
    const variantPath = avatarVariantPath(owner, variant.kind, source.path);
    try {
      const output = await sharp(sourceBuffer)
        .rotate()
        .resize(variant.size, variant.size, { fit: "cover", position: "centre" })
        .webp({ quality: variant.quality })
        .toBuffer({ resolveWithObject: true });
      await uploadVariant(supabase, variantPath, output.data, WEBP_MIME_TYPE);
      await replaceAvatarVariant(supabase, owner, source, {
        kind: variant.kind,
        path: variantPath,
        mimeType: WEBP_MIME_TYPE,
        width: output.info.width,
        height: output.info.height,
        sizeBytes: output.info.size,
      });
      generated = true;
    } catch (err) {
      await markAvatarVariantFailed(
        supabase,
        owner,
        source,
        variant.kind,
        variantPath,
        classifyVariantError(err),
      );
    }
  }
  return generated;
}

/**
 * The source bytes, or why there are none.
 *
 * A missing object is not warned about here. It is not news every minute — it
 * is one fact about one row — so the caller records it against the row and the
 * candidate loader stops offering it. Anything else keeps the old warning,
 * because anything else may well be gone by the next tick.
 */
async function downloadStorageObject(
  supabase: SupabaseClient,
  source: StoragePointer,
): Promise<StorageDownload> {
  const { data, error } = await supabase.storage.from(source.bucket).download(source.path);
  if (error || !data) {
    if (isMissingStorageObjectError(error)) return { ok: false, missing: true };
    logger.warn({ err: safeStorageFailureDetails(error) }, "mediaVariantsWorker storage download failed");
    return { ok: false, missing: false };
  }
  return { ok: true, body: Buffer.from(await data.arrayBuffer()) };
}

/**
 * Write down that this message's media is gone, once, and say so once.
 *
 * Without this the row is simply skipped, stays in tomorrow's scan, and warns
 * again — 826 times in the seven hours before anyone noticed. The rows it
 * writes are what `shouldAttemptVariantKind` reads to leave it alone.
 */
async function recordMissingMessageSource(
  supabase: SupabaseClient,
  message: MessageCandidate,
  source: StoragePointer,
): Promise<void> {
  const kinds = message.missingVariantKinds ?? getExpectedMessageVariantKinds(message);
  if (kinds.length === 0) return;
  logger.warn(
    { messageId: message.id, sourceBucket: source.bucket, kinds: kinds.length },
    "mediaVariantsWorker source object missing; recorded and not retried",
  );
  for (const kind of kinds) {
    const target = getMessageVariantTarget(message.chat_id, message.id, kind);
    await markMessageVariantFailed(
      supabase,
      message,
      source,
      kind,
      target.path,
      target.mimeType,
      "source_missing",
    );
  }
}

/** The same, for a person's or a group's picture. */
async function recordMissingAvatarSource(
  supabase: SupabaseClient,
  owner: AvatarCandidate,
  source: StoragePointer,
): Promise<void> {
  logger.warn(
    { scope: owner.scope, ownerId: owner.id, sourceBucket: source.bucket },
    "mediaVariantsWorker source object missing; recorded and not retried",
  );
  for (const variant of AVATAR_VARIANTS) {
    await markAvatarVariantFailed(
      supabase,
      owner,
      source,
      variant.kind,
      avatarVariantPath(owner, variant.kind, source.path),
      "source_missing",
    );
  }
}

/**
 * How long a variant may be kept, in the two forms an upload needs.
 *
 * `seconds` is the TTL that goes in `cacheControl`; `directive` is the header
 * the service should end up serving. See
 * `artifacts/kub/src/lib/mediaCacheControl.ts`, which holds the same two
 * lifetimes for the browser and is kept in step with this by a test.
 *
 * A profile variant is overwritten in place when someone changes their picture,
 * so it must stay revalidatable and never claims to be immutable. Every other
 * variant's path names one write and can be kept for a year.
 */
function variantCacheControl(path: string): { seconds: string; directive: string } {
  const reused = path.startsWith("variants/profiles/");
  const seconds = reused ? "2592000" : "31536000";
  return {
    seconds,
    directive: reused ? `max-age=${seconds}` : `max-age=${seconds}, immutable`,
  };
}

async function uploadVariant(
  supabase: SupabaseClient,
  path: string,
  body: Buffer,
  mimeType: string,
): Promise<void> {
  const cacheControl = variantCacheControl(path);
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, {
    contentType: mimeType,
    upsert: true,
    // Without this the service serves its own one-hour default, and every
    // avatar and preview costs a conditional request on every visit. A message
    // variant's path names one message and never changes; a profile variant's
    // path is reused when the picture is, so it gets a shorter window and the
    // client versions the URL.
    //
    // `cacheControl` takes SECONDS, not a directive: whichever branch handles
    // the body writes `max-age=` itself, so passing the whole string produces
    // `max-age=max-age=31536000, immutable` — a malformed max-age, which is
    // worse than no header.
    //
    // This body is a Buffer, so `storage-js` takes its binary branch and sends
    // a real `cache-control` request header, which the service honours as
    // written. `headers` is applied last and wins, so it is what carries
    // `immutable`. The browser call sites cannot do this: a Blob goes up as a
    // multipart form field, and there the service builds the header from the
    // TTL and ignores the request header entirely — so they send seconds only
    // and go without `immutable` on purpose. See
    // `artifacts/kub/src/lib/mediaCacheControl.ts`.
    cacheControl: cacheControl.seconds,
    headers: { "cache-control": cacheControl.directive },
  });
  if (error) throw error;
}

async function replaceMessageVariant(
  supabase: SupabaseClient,
  message: MessageCandidate,
  source: StoragePointer,
  variant: GeneratedVariant,
): Promise<void> {
  await supabase.from("media_variants").delete().eq("message_id", message.id).eq("variant_kind", variant.kind);

  const { error } = await supabase
    .from("media_variants")
    .insert(buildMessageVariantReadyRow(message, source, variant, new Date().toISOString()));
  if (error) throw error;
}

/**
 * Clear the owner's existing row of one kind, so a fresh one can replace it.
 *
 * The `chat_id` case has to say `message_id is null` as well: without it the
 * delete would reach the chat's message variants of the same kind. There are
 * none today — no message variant is an `avatar_*` — but the scoping is what
 * keeps that an accident of the current kinds rather than a dependency.
 */
function deleteAvatarVariantRow(supabase: SupabaseClient, owner: AvatarCandidate, kind: string) {
  const column = avatarOwnerColumn(owner.scope);
  const scoped = supabase.from("media_variants").delete().eq(column, owner.id).eq("variant_kind", kind);
  return owner.scope === "chat" ? scoped.is("message_id", null) : scoped;
}

async function replaceAvatarVariant(
  supabase: SupabaseClient,
  owner: AvatarCandidate,
  source: StoragePointer,
  variant: GeneratedVariant,
): Promise<void> {
  await deleteAvatarVariantRow(supabase, owner, variant.kind);

  const { error } = await supabase.from("media_variants").insert({
    [avatarOwnerColumn(owner.scope)]: owner.id,
    source_bucket: source.bucket,
    source_path: source.path,
    variant_kind: variant.kind,
    variant_bucket: MEDIA_BUCKET,
    variant_path: variant.path,
    mime_type: variant.mimeType,
    width: variant.width,
    height: variant.height,
    size_bytes: variant.sizeBytes,
    status: "ready",
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function markMessageVariantFailed(
  supabase: SupabaseClient,
  message: MessageCandidate,
  source: StoragePointer,
  kind: string,
  path: string,
  mimeType: string,
  errorCode: string,
): Promise<void> {
  await supabase.from("media_variants").delete().eq("message_id", message.id).eq("variant_kind", kind);
  await supabase
    .from("media_variants")
    .insert(
      buildMessageVariantFailedRow(
        message,
        source,
        kind,
        path,
        mimeType,
        sanitizeVariantErrorCode(errorCode),
        new Date().toISOString(),
      ),
    );
}

async function markAvatarVariantFailed(
  supabase: SupabaseClient,
  owner: AvatarCandidate,
  source: StoragePointer,
  kind: string,
  path: string,
  errorCode: string,
): Promise<void> {
  await deleteAvatarVariantRow(supabase, owner, kind);
  await supabase.from("media_variants").insert({
    [avatarOwnerColumn(owner.scope)]: owner.id,
    source_bucket: source.bucket,
    source_path: source.path,
    variant_kind: kind,
    variant_bucket: MEDIA_BUCKET,
    variant_path: path,
    mime_type: WEBP_MIME_TYPE,
    status: "failed",
    // One gate on what may reach the column, wherever the code came from.
    error_code: sanitizeVariantErrorCode(errorCode),
    updated_at: new Date().toISOString(),
  });
}

function resolveStoragePath(
  bucket: string | null | undefined,
  path: string | null | undefined,
  publicUrl: string | null | undefined,
): StoragePointer | null {
  if (bucket && path) return { bucket, path };
  if (!publicUrl) return null;
  const marker = "/storage/v1/object/public/";
  const index = publicUrl.indexOf(marker);
  if (index < 0) return null;
  const tail = publicUrl.slice(index + marker.length);
  const slash = tail.indexOf("/");
  if (slash <= 0) return null;
  const parsedBucket = decodeURIComponent(tail.slice(0, slash));
  const parsedPath = decodeURIComponent(tail.slice(slash + 1).split("?")[0] ?? "");
  if (!parsedBucket || !parsedPath) return null;
  return { bucket: parsedBucket, path: parsedPath };
}

function candidateLimit(): number {
  return positiveInteger(process.env["MEDIA_VARIANTS_CANDIDATE_LIMIT"], DEFAULT_CANDIDATE_LIMIT);
}

function candidateScanLimit(): number {
  return positiveInteger(
    process.env["MEDIA_VARIANTS_CANDIDATE_SCAN_LIMIT"],
    DEFAULT_CANDIDATE_SCAN_LIMIT,
  );
}

function processLimit(): number {
  return positiveInteger(process.env["MEDIA_VARIANTS_PROCESS_LIMIT"], DEFAULT_PROCESS_LIMIT);
}

function ffmpegPath(): string {
  return process.env["MEDIA_VARIANTS_FFMPEG_PATH"] || "ffmpeg";
}

function posterFfmpegTimeoutMs(): number {
  return DEFAULT_POSTER_FFMPEG_TIMEOUT_MS;
}

function videoTranscodeThreads(): number {
  return positiveInteger(
    process.env["MEDIA_VARIANTS_VIDEO_TRANSCODE_THREADS"],
    DEFAULT_VIDEO_TRANSCODE_THREADS,
  );
}

function videoTranscodeTimeoutMs(): number {
  return positiveInteger(
    process.env["MEDIA_VARIANTS_VIDEO_TRANSCODE_TIMEOUT_MS"],
    DEFAULT_VIDEO_TRANSCODE_TIMEOUT_MS,
  );
}

function videoTempExtension(sourcePath: string): string {
  const extension = path.extname(sourcePath).toLowerCase();
  return /^\.[a-z0-9]{2,5}$/.test(extension) ? extension : ".mp4";
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
