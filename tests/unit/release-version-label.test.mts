import assert from "node:assert/strict";
import test from "node:test";

import { getVisibleReleaseVersion } from "../../artifacts/kub/src/lib/releaseVersionLabel.ts";

test("release version label hides placeholder and invalid values", () => {
  assert.equal(getVisibleReleaseVersion("0.0.0"), null);
  assert.equal(getVisibleReleaseVersion("unknown"), null);
  assert.equal(getVisibleReleaseVersion(""), null);
  assert.equal(getVisibleReleaseVersion(null), null);
});

test("release version label accepts a real semantic version", () => {
  assert.equal(getVisibleReleaseVersion("0.2.7"), "Версия 0.2.7");
  assert.equal(getVisibleReleaseVersion("1.12.3-beta.2"), "Версия 1.12.3-beta.2");
});
