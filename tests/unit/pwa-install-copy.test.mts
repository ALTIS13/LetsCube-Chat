import assert from "node:assert/strict";
import test from "node:test";

import { getPwaInstallCopy } from "../../artifacts/kub/src/lib/pwa/installCopy.ts";
import { detectDistributionTarget } from "../../artifacts/kub/src/lib/platform/distribution.ts";

test("iPhone Chrome is still an iOS PWA installation target", () => {
  const platform = detectDistributionTarget({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
    platform: "iPhone",
    maxTouchPoints: 5,
  });

  assert.equal(platform, "ios_pwa");
});

test("iOS installation guidance does not require Safari and explains the web-app choice", () => {
  const copy = getPwaInstallCopy({ platform: "ios_pwa", installed: false, isTablet: false });

  assert.equal(copy.modeLabel, "Браузер");
  assert.match(copy.description, /браузер/);
  assert.doesNotMatch(copy.description, /только Safari|через Safari/);
  assert.match(copy.instructionSteps.join(" "), /Поделиться/);
  assert.match(copy.instructionSteps.join(" "), /На экран Домой/);
  assert.match(copy.instructionSteps.join(" "), /Открыть как веб-приложение/);
  assert.match(copy.instructionSteps.join(" "), /Safari/);
});

test("installed iPad stays correctly labelled", () => {
  const copy = getPwaInstallCopy({ platform: "ios_pwa", installed: true, isTablet: true });

  assert.match(copy.title, /iPad/);
  assert.equal(copy.modeLabel, "Установлено");
});
