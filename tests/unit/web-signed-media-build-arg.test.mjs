import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dockerfile = readFileSync(new URL("../../docs/deploy/Dockerfile", import.meta.url), "utf8");

test("the live web Dockerfile passes the media URL mode into the Vite build", () => {
  const buildStage = dockerfile.split("FROM base AS build\n")[1]?.split("FROM base AS api-runtime\n")[0];
  assert.ok(buildStage, "the web build stage must be identifiable");

  const argument = buildStage.indexOf("ARG VITE_MEDIA_SIGNED_URLS=public");
  const environment = buildStage.indexOf("VITE_MEDIA_SIGNED_URLS=${VITE_MEDIA_SIGNED_URLS}");
  const exportForBuild = buildStage.indexOf('export VITE_MEDIA_SIGNED_URLS="${VITE_MEDIA_SIGNED_URLS:-public}"');
  const viteBuild = buildStage.indexOf("pnpm --filter @workspace/kub run build");
  assert.ok(argument >= 0, "Coolify must be able to supply the build arg");
  assert.ok(environment > argument, "the build stage must receive that arg as an environment value");
  assert.ok(exportForBuild > environment, "the Vite command must receive the value explicitly");
  assert.ok(viteBuild > exportForBuild, "the export must precede the production build");
});
