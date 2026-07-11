import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  MEDIA_QUALITY_METADATA_KEY,
  getMediaQualityFromMetadata,
  getVideoPlaybackFallbackUrl,
  selectVideoPlaybackUrl,
} from "../../artifacts/kub/src/lib/mediaQuality";
import {
  completeMessageVariantRefresh,
  getMessageVariantCacheKey,
  queueMessageVariantRefresh,
  selectMessageVariantCacheEvictions,
  type MessageVariantRefreshState,
} from "../../artifacts/kub/src/lib/messageVariantRefresh";
import { replacePlaybackItemUrl } from "../../artifacts/kub/src/lib/mediaQuality";

test("resolves imported video playback from persisted media quality", () => {
  const originalUrl = "https://media.example/original.mp4";
  const variantUrl = "https://media.example/video-720p.mp4";

  expect(MEDIA_QUALITY_METADATA_KEY).toBe("media_quality");
  expect(getMediaQualityFromMetadata(null)).toBe("balanced");
  expect(getMediaQualityFromMetadata({ [MEDIA_QUALITY_METADATA_KEY]: "compact" })).toBe("compact");
  expect(getMediaQualityFromMetadata({ [MEDIA_QUALITY_METADATA_KEY]: "high" })).toBe("high");
  expect(selectVideoPlaybackUrl({ originalUrl, video720pUrl: variantUrl, mediaMetadata: null })).toBe(variantUrl);
  expect(selectVideoPlaybackUrl({ originalUrl, video720pUrl: variantUrl, mediaMetadata: { [MEDIA_QUALITY_METADATA_KEY]: "compact" } })).toBe(variantUrl);
  expect(selectVideoPlaybackUrl({ originalUrl, video720pUrl: variantUrl, mediaMetadata: { [MEDIA_QUALITY_METADATA_KEY]: "high" } })).toBe(originalUrl);
  expect(selectVideoPlaybackUrl({ originalUrl, video720pUrl: null, mediaMetadata: null })).toBe(originalUrl);
  expect(getVideoPlaybackFallbackUrl(variantUrl, originalUrl)).toBe(originalUrl);
  expect(getVideoPlaybackFallbackUrl(originalUrl, originalUrl)).toBeNull();
});

test("wires one batched 720p variant query through persisted quality metadata", () => {
  const mediaVariantsSource = readFileSync(resolve("artifacts/kub/src/hooks/useMediaVariants.ts"), "utf8");
  const chatWindowSource = readFileSync(resolve("artifacts/kub/src/components/chat/ChatWindow.tsx"), "utf8");
  const bubbleSource = readFileSync(resolve("artifacts/kub/src/components/chat/MessageBubble.tsx"), "utf8");
  const inputSource = readFileSync(resolve("artifacts/kub/src/components/chat/MessageInput.tsx"), "utf8");

  expect(mediaVariantsSource).toContain('"video_720p"');
  expect(mediaVariantsSource).toContain("video720pUrl");
  expect(mediaVariantsSource).toContain("setInterval");
  expect(mediaVariantsSource).toContain("visibilitychange");
  expect(chatWindowSource).toContain("MEDIA_QUALITY_METADATA_KEY");
  expect(chatWindowSource).not.toContain('console.warn("[attachments] upload failed:", error)');
  expect(mediaVariantsSource).not.toContain("error.message");
  expect(bubbleSource).toContain("selectVideoPlaybackUrl");
  expect(inputSource).toContain("серверную 720p-копию");
});

test("uses one stable cache key for a chat regardless of realtime message IDs", () => {
  expect(getMessageVariantCacheKey([
    { id: "m-1", chat_id: "chat-1", type: "video", media_url: "https://media.example/one.mp4", deleted_at: null },
  ])).toBe("chat-1");
  expect(getMessageVariantCacheKey([
    { id: "m-1", chat_id: "chat-1", type: "video", media_url: "https://media.example/one.mp4", deleted_at: null },
    { id: "m-2", chat_id: "chat-1", type: "image", media_url: "https://media.example/two.jpg", deleted_at: null },
  ])).toBe("chat-1");
});

test("coalesces a changed batch while a variant refresh is loading", () => {
  const loading: MessageVariantRefreshState = {
    messageIds: ["m-1"],
    loading: true,
    reloadPending: false,
  };
  const queued = queueMessageVariantRefresh(loading, ["m-1", "m-2"]);

  expect(queued.startNow).toBe(false);
  expect(queued.state.messageIds).toEqual(["m-1", "m-2"]);
  expect(queued.state.reloadPending).toBe(true);
  expect(completeMessageVariantRefresh(queued.state)).toEqual({
    state: { messageIds: ["m-1", "m-2"], loading: false, reloadPending: false },
    startNow: true,
  });
});

test("evicts only unused chat cache entries when the bounded cache is full", () => {
  expect(selectMessageVariantCacheEvictions([
    { chatId: "chat-active", listenerCount: 1 },
    { chatId: "chat-oldest", listenerCount: 0 },
    { chatId: "chat-newer", listenerCount: 0 },
  ], 3)).toEqual(["chat-oldest"]);
  expect(selectMessageVariantCacheEvictions([
    { chatId: "chat-active", listenerCount: 1 },
    { chatId: "chat-oldest", listenerCount: 0 },
  ], 3)).toEqual([]);
});

test("replaces the provider item URL without retaining a failed variant", () => {
  const current = {
    id: "m-1",
    chatId: "chat-1",
    kind: "video" as const,
    url: "https://media.example/failed-720p.mp4",
    title: "Видео",
  };

  expect(replacePlaybackItemUrl(current, "m-1", "https://media.example/original.mp4")).toEqual({
    ...current,
    url: "https://media.example/original.mp4",
  });
  expect(replacePlaybackItemUrl(current, "m-2", "https://media.example/original.mp4")).toBe(current);
});
