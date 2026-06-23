import { useEffect, useMemo, useState } from "react";
import type { MediaVariant, MessageWithSender } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

type MessageMediaVariantSource = Pick<MessageWithSender, "id" | "type" | "media_url" | "deleted_at">;

export interface MessageMediaVariantUrls {
  previewUrl?: string;
  previewWidth?: number | null;
  previewHeight?: number | null;
  thumbUrl?: string;
  thumbWidth?: number | null;
  thumbHeight?: number | null;
  videoPosterUrl?: string;
  videoPosterWidth?: number | null;
  videoPosterHeight?: number | null;
}

export interface AvatarVariantUrls {
  avatar128Url?: string;
  avatar128Width?: number | null;
  avatar128Height?: number | null;
  avatar256Url?: string;
  avatar256Width?: number | null;
  avatar256Height?: number | null;
}

const MESSAGE_VARIANT_KINDS = ["image_preview", "image_thumb", "video_poster"] as const;
const AVATAR_VARIANT_KINDS = ["avatar_128", "avatar_256"] as const;

function getVariantPublicUrl(
  storage: ReturnType<typeof createClient>["storage"],
  row: Pick<MediaVariant, "variant_bucket" | "variant_path">,
): string | null {
  return storage.from(row.variant_bucket).getPublicUrl(row.variant_path).data.publicUrl ?? null;
}

export function useMessageMediaVariantUrls(messages: MessageMediaVariantSource[]): Record<string, MessageMediaVariantUrls> {
  const messageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const message of messages) {
      if (
        (message.type === "image" || message.type === "video") &&
        message.media_url &&
        !message.deleted_at &&
        !message.id.startsWith("tmp:")
      ) {
        ids.add(message.id);
      }
    }
    return Array.from(ids).sort();
  }, [messages]);

  const messageIdKey = messageIds.join("|");
  const [variantsByMessageId, setVariantsByMessageId] = useState<Record<string, MessageMediaVariantUrls>>({});

  useEffect(() => {
    let cancelled = false;
    if (messageIds.length === 0) {
      setVariantsByMessageId({});
      return () => {
        cancelled = true;
      };
    }

    const supabase = createClient();

    const loadVariants = async () => {
      const { data, error } = await supabase
        .from("media_variants")
        .select("id,message_id,variant_kind,variant_bucket,variant_path,width,height,status")
        .eq("status", "ready")
        .in("variant_kind", [...MESSAGE_VARIANT_KINDS])
        .in("message_id", messageIds);

      if (cancelled) return;
      if (error) {
        console.warn("Media variants fetch failed:", error.message);
        setVariantsByMessageId({});
        return;
      }

      const next: Record<string, MessageMediaVariantUrls> = {};
      for (const row of (data ?? []) as unknown as MediaVariant[]) {
        if (!row.message_id) continue;
        const publicUrl = getVariantPublicUrl(supabase.storage, row);
        if (!publicUrl) continue;

        const current = next[row.message_id] ?? {};
        if (row.variant_kind === "image_preview") {
          current.previewUrl = publicUrl;
          current.previewWidth = row.width;
          current.previewHeight = row.height;
        } else if (row.variant_kind === "image_thumb") {
          current.thumbUrl = publicUrl;
          current.thumbWidth = row.width;
          current.thumbHeight = row.height;
        } else if (row.variant_kind === "video_poster") {
          current.videoPosterUrl = publicUrl;
          current.videoPosterWidth = row.width;
          current.videoPosterHeight = row.height;
        }
        next[row.message_id] = current;
      }

      setVariantsByMessageId(next);
    };

    void loadVariants();
    return () => {
      cancelled = true;
    };
  }, [messageIdKey]);

  return variantsByMessageId;
}

export function useAvatarVariantUrls(profileIds: readonly string[]): Record<string, AvatarVariantUrls> {
  const profileIdKey = useMemo(() => {
    const ids = new Set<string>();
    for (const id of profileIds) {
      if (id) ids.add(id);
    }
    return Array.from(ids).sort().join("|");
  }, [profileIds]);
  const normalizedProfileIds = useMemo(
    () => profileIdKey ? profileIdKey.split("|") : [],
    [profileIdKey],
  );
  const [variantsByProfileId, setVariantsByProfileId] = useState<Record<string, AvatarVariantUrls>>({});

  useEffect(() => {
    let cancelled = false;
    if (normalizedProfileIds.length === 0) {
      setVariantsByProfileId({});
      return () => {
        cancelled = true;
      };
    }

    const supabase = createClient();

    const loadVariants = async () => {
      const { data, error } = await supabase
        .from("media_variants")
        .select("id,profile_id,variant_kind,variant_bucket,variant_path,width,height,status")
        .eq("status", "ready")
        .in("variant_kind", [...AVATAR_VARIANT_KINDS])
        .in("profile_id", normalizedProfileIds);

      if (cancelled) return;
      if (error) {
        console.warn("Avatar variants fetch failed:", error.message);
        setVariantsByProfileId({});
        return;
      }

      const next: Record<string, AvatarVariantUrls> = {};
      for (const row of (data ?? []) as unknown as MediaVariant[]) {
        if (!row.profile_id) continue;
        const publicUrl = getVariantPublicUrl(supabase.storage, row);
        if (!publicUrl) continue;

        const current = next[row.profile_id] ?? {};
        if (row.variant_kind === "avatar_128") {
          current.avatar128Url = publicUrl;
          current.avatar128Width = row.width;
          current.avatar128Height = row.height;
        } else if (row.variant_kind === "avatar_256") {
          current.avatar256Url = publicUrl;
          current.avatar256Width = row.width;
          current.avatar256Height = row.height;
        }
        next[row.profile_id] = current;
      }

      setVariantsByProfileId(next);
    };

    void loadVariants();
    return () => {
      cancelled = true;
    };
  }, [profileIdKey]);

  return variantsByProfileId;
}
