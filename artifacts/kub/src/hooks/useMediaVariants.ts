import { useEffect, useMemo, useState } from "react";
import type { MediaVariant, MessageWithSender } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

export interface MessageMediaVariantUrls {
  previewUrl?: string;
  previewWidth?: number | null;
  previewHeight?: number | null;
  thumbUrl?: string;
  thumbWidth?: number | null;
  thumbHeight?: number | null;
}

const MESSAGE_IMAGE_VARIANT_KINDS = ["image_preview", "image_thumb"] as const;

export function useMessageMediaVariantUrls(messages: MessageWithSender[]): Record<string, MessageMediaVariantUrls> {
  const messageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const message of messages) {
      if (
        message.type === "image" &&
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
        .in("variant_kind", [...MESSAGE_IMAGE_VARIANT_KINDS])
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
        const publicUrl = supabase.storage
          .from(row.variant_bucket)
          .getPublicUrl(row.variant_path).data.publicUrl;
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
