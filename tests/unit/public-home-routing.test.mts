import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decideRootExperience } from "../../artifacts/kub/src/lib/publicHomeRouting.ts";

const appSource = readFileSync(
  new URL("../../artifacts/kub/src/App.tsx", import.meta.url),
  "utf8",
);

test("loading takes precedence over session and shell state", () => {
  assert.equal(
    decideRootExperience({ loading: true, authenticated: true, nativeShell: true }),
    "loading",
  );
});

test("authenticated users enter the messenger", () => {
  assert.equal(
    decideRootExperience({ loading: false, authenticated: true, nativeShell: false }),
    "messenger",
  );
  assert.equal(
    decideRootExperience({ loading: false, authenticated: true, nativeShell: true }),
    "messenger",
  );
});

test("unauthenticated browser sessions see the public home", () => {
  assert.equal(
    decideRootExperience({ loading: false, authenticated: false, nativeShell: false }),
    "public_home",
  );
});

test("Capacitor Android and future Capacitor iOS shells skip the public home", () => {
  for (const platform of ["android", "ios"]) {
    assert.equal(
      decideRootExperience({ loading: false, authenticated: false, nativeShell: true }),
      "login",
      `${platform} shell must open authentication`,
    );
  }
});

test("Tauri Windows and future Tauri macOS shells skip the public home", () => {
  for (const platform of ["windows", "macos"]) {
    assert.equal(
      decideRootExperience({ loading: false, authenticated: false, nativeShell: true }),
      "login",
      `${platform} shell must open authentication`,
    );
  }
});

test("iPhone and iPad browser sessions remain browser guests", () => {
  for (const browser of ["iphone", "ipad"]) {
    assert.equal(
      decideRootExperience({ loading: false, authenticated: false, nativeShell: false }),
      "public_home",
      `${browser} browser must not inherit native-shell routing`,
    );
  }
});

test("App applies root routing after auth callback and before protected-route redirects", () => {
  const callbackGate = appSource.indexOf('if (location.startsWith("/auth/callback"))');
  const rootGate = appSource.indexOf('if (location === "/")');
  const protectedGate = appSource.indexOf("if (!user && !authRoute)");

  assert.notEqual(callbackGate, -1);
  assert.notEqual(rootGate, -1);
  assert.notEqual(protectedGate, -1);
  assert.ok(callbackGate < rootGate, "auth callback must retain first precedence");
  assert.ok(rootGate < protectedGate, "only the root route may show the public home");
  assert.match(appSource, /isNativeApp\(\)\s*\|\|\s*isDesktopShell\(\)/);
  assert.doesNotMatch(appSource, /getCurrentDistributionTarget/);
});
