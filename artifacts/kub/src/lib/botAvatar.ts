import { createClient } from "@/lib/supabase/client";
import { avatarUploadPath, prepareAvatarImage, validateAvatarImage } from "@/lib/mediaUpload";
import { botManagement } from "@/lib/botManagement";

/**
 * Giving a bot a picture.
 *
 * Two steps, in this order, because the database will not record a URL that is
 * not already this bot's own file: upload into `bot-avatars/{bot id}/`, where
 * the storage policy admits only that bot's owner, then record it through the
 * management API like every other bot mutation.
 *
 * The bucket is public, so the recorded URL is a plain public object address —
 * never a signed one, which would expire and carry a credential.
 */

const PUBLIC_MEDIA_PREFIX = "/storage/v1/object/public/media/";

/** The public URL for an object path, derived from the client's own base. */
export function publicMediaUrl(objectPath: string): string {
  const supabase = createClient();
  const url = supabase.storage.from("media").getPublicUrl(objectPath).data.publicUrl;
  if (!url) throw new Error("bot_avatar_url_unavailable");
  return url;
}

export function isBotAvatarUrl(url: string, botId: string): boolean {
  return url.includes(`${PUBLIC_MEDIA_PREFIX}bot-avatars/${botId}/`);
}

export interface BotAvatarUploadResult {
  avatarUrl: string;
  objectPath: string;
}

/**
 * Validates, downscales, uploads and records a bot's picture.
 *
 * Returns the recorded URL. Throws the same validation message a person's
 * avatar would, so the two paths cannot drift into saying different things
 * about the same file.
 */
export async function uploadBotAvatar(botId: string, file: File): Promise<BotAvatarUploadResult> {
  const problem = validateAvatarImage(file);
  if (problem) throw new Error(problem);

  const prepared = await prepareAvatarImage(file);
  const objectPath = avatarUploadPath("bot", botId, prepared);

  const supabase = createClient();
  const { error } = await supabase.storage
    .from("media")
    .upload(objectPath, prepared, { upsert: true, contentType: prepared.type });
  if (error) throw new Error("Не удалось загрузить изображение.");

  const avatarUrl = publicMediaUrl(objectPath);
  // A last check on our side of the wire: the database refuses anything that is
  // not this bot's own file, and a mismatch here means the path helper and the
  // policy have drifted apart.
  if (!isBotAvatarUrl(avatarUrl, botId)) throw new Error("Не удалось загрузить изображение.");

  await botManagement.setAvatar(botId, avatarUrl);
  return { avatarUrl, objectPath };
}

/** Removes the picture. The file is left in place; the reference is what shows. */
export async function clearBotAvatar(botId: string): Promise<void> {
  await botManagement.setAvatar(botId, null);
}
