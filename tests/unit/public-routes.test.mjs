import assert from "node:assert/strict";
import test from "node:test";

import {
  isAuthRoute,
  isPublicRoute,
} from "../../artifacts/kub/src/lib/publicRoutes.ts";

test("privacy and support routes are public without widening protected routes", () => {
  assert.equal(isPublicRoute("/privacy"), true);
  assert.equal(isPublicRoute("/privacy/"), true);
  assert.equal(isPublicRoute("/support"), true);
  assert.equal(isPublicRoute("/support?ticket=public-reference"), true);

  assert.equal(isPublicRoute("/"), false);
  assert.equal(isPublicRoute("/tasks"), false);
  assert.equal(isPublicRoute("/admin"), false);
  assert.equal(isPublicRoute("/support-admin"), false);
  assert.equal(isPublicRoute("/privacy-settings"), false);
});

test("auth route matching preserves callback and recovery paths", () => {
  assert.equal(isAuthRoute("/login"), true);
  assert.equal(isAuthRoute("/login?reset=1"), true);
  assert.equal(isAuthRoute("/register"), true);
  assert.equal(isAuthRoute("/auth/callback?code=redacted"), true);

  assert.equal(isAuthRoute("/"), false);
  assert.equal(isAuthRoute("/privacy"), false);
  assert.equal(isAuthRoute("/support"), false);
  assert.equal(isAuthRoute("/login-history"), false);
});
