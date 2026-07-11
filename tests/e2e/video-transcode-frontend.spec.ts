import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  MEDIA_QUALITY_METADATA_KEY,
  getMediaQualityFromMetadata,
  getVideoPlaybackFallbackUrl,
  selectVideoPlaybackUrl,
} from "../../artifacts/kub/src/lib/mediaQuality";

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
