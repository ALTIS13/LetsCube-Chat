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
  buildMessageVariantPath,
  getExpectedMessageVariantKinds,
} from "./mediaVariantRules";

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_CANDIDATE_LIMIT = 120;
const DEFAULT_PROCESS_LIMIT = 12;
const DEFAULT_FFMPEG_TIMEOUT_MS = 30_000;
const MEDIA_BUCKET = "media";
const execFileAsync = promisify(execFile);

interface MessageCandidate {
  id: string;
  chat_id: string;
  user_id: string | null;
  type: string | null;
  media_bucket: string | null;
  media_path: string | null;
  media_url: string | null;
}

interface ProfileCandidate {
  id: string;
  avatar_url: string | null;
}

interface ExistingVariant {
  message_id: string | null;
  profile_id: string | null;
  variant_kind: string;
}

interface StoragePointer {
  bucket: string;
  path: string;
}

interface GeneratedVariant {
  kind: string;
  path: string;
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

async function tick(supabase: SupabaseClient): Promise<void> {
  const [messages, profiles] = await Promise.all([
    loadMessageCandidates(supabase),
    loadProfileCandidates(supabase),
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
    const ok = await ensureProfileVariants(supabase, profile);
    if (ok) processedProfiles += 1;
  }

  if (processedMessages > 0 || processedProfiles > 0) {
    logger.info({ processedMessages, processedProfiles }, "mediaVariantsWorker generated variants");
  }
}

async function loadMessageCandidates(supabase: SupabaseClient): Promise<MessageCandidate[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, chat_id, user_id, type, media_bucket, media_path, media_url")
    .in("type", ["image", "video"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(candidateLimit());

  if (error) {
    logger.warn({ err: sanitizedDbError(error) }, "mediaVariantsWorker message select failed");
    return [];
  }

  const candidates = ((data ?? []) as MessageCandidate[]).filter((row) =>
    Boolean(resolveStoragePath(row.media_bucket, row.media_path, row.media_url)),
  );
  if (candidates.length === 0) return [];

  const existing = await loadExistingVariants(
    supabase,
    "message_id",
    candidates.map((row) => row.id),
  );
  return candidates.filter((row) => {
    const kinds = existing.get(row.id) ?? new Set<string>();
    return getExpectedMessageVariantKinds(row).some((kind) => !kinds.has(kind));
  });
}

async function loadProfileCandidates(supabase: SupabaseClient): Promise<ProfileCandidate[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, avatar_url")
    .not("avatar_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(candidateLimit());

  if (error) {
    logger.warn({ err: sanitizedDbError(error) }, "mediaVariantsWorker profile select failed");
    return [];
  }

  const candidates = ((data ?? []) as ProfileCandidate[]).filter((row) =>
    Boolean(resolveStoragePath(MEDIA_BUCKET, null, row.avatar_url)),
  );
  if (candidates.length === 0) return [];

  const existing = await loadExistingVariants(
    supabase,
    "profile_id",
    candidates.map((row) => row.id),
  );
  return candidates.filter((row) => {
    const kinds = existing.get(row.id) ?? new Set<string>();
    return AVATAR_VARIANTS.some((variant) => !kinds.has(variant.kind));
  });
}

async function loadExistingVariants(
  supabase: SupabaseClient,
  column: "message_id" | "profile_id",
  ids: string[],
): Promise<Map<string, Set<string>>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("media_variants")
    .select(`${column}, variant_kind`)
    .in(column, ids)
    .eq("status", "ready");

  if (error) {
    logger.warn({ err: sanitizedDbError(error) }, "mediaVariantsWorker variants lookup failed");
    return new Map();
  }

  const byOwner = new Map<string, Set<string>>();
  for (const row of (data ?? []) as ExistingVariant[]) {
    const id = column === "message_id" ? row.message_id : row.profile_id;
    if (!id) continue;
    const set = byOwner.get(id) ?? new Set<string>();
    set.add(row.variant_kind);
    byOwner.set(id, set);
  }
  return byOwner;
}

async function ensureMessageVariants(supabase: SupabaseClient, message: MessageCandidate): Promise<boolean> {
  const source = resolveStoragePath(message.media_bucket, message.media_path, message.media_url);
  if (!source) return false;

  const sourceBuffer = await downloadStorageObject(supabase, source);
  if (!sourceBuffer) return false;

  if (message.type === "video") {
    return ensureVideoMessageVariants(supabase, message, source, sourceBuffer);
  }
  if (message.type !== "image") return false;

  let generated = false;
  for (const variant of MESSAGE_IMAGE_VARIANTS) {
    const variantPath = buildMessageVariantPath(message.chat_id, message.id, variant.kind);
    try {
      const output = await sharp(sourceBuffer)
        .rotate()
        .resize({ width: variant.max, height: variant.max, fit: "inside", withoutEnlargement: true })
        .webp({ quality: variant.quality })
        .toBuffer({ resolveWithObject: true });
      await uploadVariant(supabase, variantPath, output.data);
      await replaceMessageVariant(supabase, message, source, {
        kind: variant.kind,
        path: variantPath,
        width: output.info.width,
        height: output.info.height,
        sizeBytes: output.info.size,
      });
      generated = true;
    } catch (err) {
      await markMessageVariantFailed(supabase, message, source, variant.kind, variantPath, err);
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
  let generated = false;
  for (const variant of MESSAGE_VIDEO_VARIANTS) {
    const variantPath = buildMessageVariantPath(message.chat_id, message.id, variant.kind);
    try {
      const output = await generateVideoPosterVariant(sourceBuffer, source.path, variant);
      await uploadVariant(supabase, variantPath, output.data);
      await replaceMessageVariant(supabase, message, source, {
        kind: variant.kind,
        path: variantPath,
        width: output.info.width,
        height: output.info.height,
        sizeBytes: output.info.size,
      });
      generated = true;
    } catch (err) {
      await markMessageVariantFailed(supabase, message, source, variant.kind, variantPath, err);
    }
  }
  return generated;
}

async function generateVideoPosterVariant(
  sourceBuffer: Buffer,
  sourcePath: string,
  variant: (typeof MESSAGE_VIDEO_VARIANTS)[number],
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
    await runFfmpeg([...baseArgs, "-ss", "00:00:01", "-i", inputPath, ...outputArgs]);
  } catch {
    await runFfmpeg([...baseArgs, "-i", inputPath, ...outputArgs]);
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync(ffmpegPath(), args, {
    timeout: ffmpegTimeoutMs(),
    windowsHide: true,
    maxBuffer: 64 * 1024,
  });
}

async function ensureProfileVariants(supabase: SupabaseClient, profile: ProfileCandidate): Promise<boolean> {
  const source = resolveStoragePath(MEDIA_BUCKET, null, profile.avatar_url);
  if (!source) return false;

  const sourceBuffer = await downloadStorageObject(supabase, source);
  if (!sourceBuffer) return false;

  let generated = false;
  for (const variant of AVATAR_VARIANTS) {
    const variantPath = `variants/profiles/${profile.id}/${variant.kind}.webp`;
    try {
      const output = await sharp(sourceBuffer)
        .rotate()
        .resize(variant.size, variant.size, { fit: "cover", position: "centre" })
        .webp({ quality: variant.quality })
        .toBuffer({ resolveWithObject: true });
      await uploadVariant(supabase, variantPath, output.data);
      await replaceProfileVariant(supabase, profile.id, source, {
        kind: variant.kind,
        path: variantPath,
        width: output.info.width,
        height: output.info.height,
        sizeBytes: output.info.size,
      });
      generated = true;
    } catch (err) {
      await markProfileVariantFailed(supabase, profile.id, source, variant.kind, variantPath, err);
    }
  }
  return generated;
}

async function downloadStorageObject(
  supabase: SupabaseClient,
  source: StoragePointer,
): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(source.bucket).download(source.path);
  if (error || !data) {
    logger.warn({ err: sanitizedDbError(error) }, "mediaVariantsWorker storage download failed");
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

async function uploadVariant(supabase: SupabaseClient, path: string, body: Buffer): Promise<void> {
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, {
    contentType: "image/webp",
    upsert: true,
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

  const { error } = await supabase.from("media_variants").insert({
    message_id: message.id,
    chat_id: message.chat_id,
    owner_id: message.user_id,
    source_bucket: source.bucket,
    source_path: source.path,
    variant_kind: variant.kind,
    variant_bucket: MEDIA_BUCKET,
    variant_path: variant.path,
    mime_type: "image/webp",
    width: variant.width,
    height: variant.height,
    size_bytes: variant.sizeBytes,
    status: "ready",
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function replaceProfileVariant(
  supabase: SupabaseClient,
  profileId: string,
  source: StoragePointer,
  variant: GeneratedVariant,
): Promise<void> {
  await supabase.from("media_variants").delete().eq("profile_id", profileId).eq("variant_kind", variant.kind);

  const { error } = await supabase.from("media_variants").insert({
    profile_id: profileId,
    source_bucket: source.bucket,
    source_path: source.path,
    variant_kind: variant.kind,
    variant_bucket: MEDIA_BUCKET,
    variant_path: variant.path,
    mime_type: "image/webp",
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
  err: unknown,
): Promise<void> {
  await supabase.from("media_variants").delete().eq("message_id", message.id).eq("variant_kind", kind);
  await supabase.from("media_variants").insert({
    message_id: message.id,
    chat_id: message.chat_id,
    owner_id: message.user_id,
    source_bucket: source.bucket,
    source_path: source.path,
    variant_kind: kind,
    variant_bucket: MEDIA_BUCKET,
    variant_path: path,
    mime_type: "image/webp",
    status: "failed",
    error_code: errorCode(err),
    updated_at: new Date().toISOString(),
  });
}

async function markProfileVariantFailed(
  supabase: SupabaseClient,
  profileId: string,
  source: StoragePointer,
  kind: string,
  path: string,
  err: unknown,
): Promise<void> {
  await supabase.from("media_variants").delete().eq("profile_id", profileId).eq("variant_kind", kind);
  await supabase.from("media_variants").insert({
    profile_id: profileId,
    source_bucket: source.bucket,
    source_path: source.path,
    variant_kind: kind,
    variant_bucket: MEDIA_BUCKET,
    variant_path: path,
    mime_type: "image/webp",
    status: "failed",
    error_code: errorCode(err),
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

function sanitizedDbError(err: unknown): { name?: string; code?: string; message?: string } | null {
  if (!err || typeof err !== "object") return null;
  const record = err as { name?: string; code?: string; message?: string };
  return {
    name: record.name,
    code: record.code,
    message: record.message?.slice(0, 180),
  };
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code?: unknown }).code ?? "");
    if (code) return code.slice(0, 80);
  }
  if (err instanceof Error && err.name) return err.name.slice(0, 80);
  return "variant_generation_failed";
}

function candidateLimit(): number {
  return positiveInteger(process.env["MEDIA_VARIANTS_CANDIDATE_LIMIT"], DEFAULT_CANDIDATE_LIMIT);
}

function processLimit(): number {
  return positiveInteger(process.env["MEDIA_VARIANTS_PROCESS_LIMIT"], DEFAULT_PROCESS_LIMIT);
}

function ffmpegPath(): string {
  return process.env["MEDIA_VARIANTS_FFMPEG_PATH"] || "ffmpeg";
}

function ffmpegTimeoutMs(): number {
  return positiveInteger(process.env["MEDIA_VARIANTS_FFMPEG_TIMEOUT_MS"], DEFAULT_FFMPEG_TIMEOUT_MS);
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
