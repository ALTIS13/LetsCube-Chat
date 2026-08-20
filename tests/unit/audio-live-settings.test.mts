import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLiveAudioGain,
  normalizeAudioSettings,
} from "../../artifacts/kub/src/hooks/useAudioSettings.ts";

test("live audio gain updates the active Web Audio parameter without rebuilding the stream", () => {
  const parameter = { value: 1 };

  applyLiveAudioGain(parameter, 1.45);

  assert.equal(parameter.value, 1.45);
});

test("legacy high media quality remains compatible with the new original label", async () => {
  const {
    applyVideoQualityToAttachments,
    normalizeMediaQuality,
  } = await import("../../artifacts/kub/src/lib/mediaQuality.ts");

  assert.equal(normalizeMediaQuality("high"), "original");
  assert.equal(normalizeMediaQuality("original"), "original");
  assert.equal(normalizeAudioSettings({ micInputGain: 1.4 }).micInputGain, 1.4);

  assert.deepEqual(
    applyVideoQualityToAttachments([
      { id: "image", kind: "image", mediaQuality: undefined },
      { id: "video", kind: "video", mediaQuality: "balanced" },
      { id: "round", kind: "video_message", mediaQuality: "compact" },
    ], "original"),
    [
      { id: "image", kind: "image", mediaQuality: undefined },
      { id: "video", kind: "video", mediaQuality: "original" },
      { id: "round", kind: "video_message", mediaQuality: "original" },
    ],
  );
});
