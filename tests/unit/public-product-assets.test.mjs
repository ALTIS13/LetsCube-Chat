import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  PUBLIC_PREVIEW_CAPTURE_PATH,
  PUBLIC_PREVIEW_READY_ATTRIBUTE,
  PUBLIC_PREVIEW_WINDOW_KEY,
} from "../../artifacts/kub/src/lib/publicPreviewFixture.ts";

const root = new URL("../../", import.meta.url);
const rootPath = fileURLToPath(root);

const PRODUCT_DIRECTORY = "artifacts/kub/public/product";
const FIXTURE_PATH = "tests/fixtures/public-home-demo.json";
const BUILD_DIRECTORY = "artifacts/kub/dist/public";

// Every asset the public home may reference. The list is exact: an unexpected
// file in the directory is a finding, because it would ship publicly without
// having passed these bounds or the privacy sign-off.
const PRODUCT_ASSETS = [
  "windows-messenger-dark.webp",
  "windows-messenger-light.webp",
  "android-messenger-dark.webp",
  "android-messenger-light.webp",
];

const MIN_WIDTH = 720;
const MAX_WIDTH = 1800;
const MIN_HEIGHT = 450;
const MAX_HEIGHT = 1200;
const MAX_BYTES = 350 * 1024;

// The capture surface is DEV-only. None of this may appear in a production
// bundle. The markers are imported from the source of truth rather than copied,
// so renaming any of them cannot leave the scan silently proving nothing.
//
// The route string alone is not enough: a `lazy()` call evaluated at module
// scope keeps its dynamic import alive even when the branch that uses it is
// removed, so the emitted chunk and the runtime identifiers must be checked
// too. That is exactly how the first implementation shipped the capture page.
const CAPTURE_CONTENT_MARKERS = [
  PUBLIC_PREVIEW_CAPTURE_PATH,
  PUBLIC_PREVIEW_WINDOW_KEY,
  PUBLIC_PREVIEW_READY_ATTRIBUTE,
  "VITE_PUBLIC_PREVIEW_FIXTURE",
];

// The lazy chunk is emitted under a name derived from the module, so an emitted
// file carrying it is itself the defect regardless of the file's content.
const CAPTURE_CHUNK_NAME = "PublicPreviewCapturePage";

// Personal-data shapes that must never reach a public asset name or the fixture.
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_PATTERN = /\+?\d[\d\s().-]{8,}\d/;
// A bearer/JWT-shaped or key-shaped literal.
const TOKEN_PATTERN = /\b(eyJ[\w-]{10,}|sk-[\w-]{10,}|sb_[\w-]{10,}|service_role)\b/i;

// The complete set of human-readable strings the fixture is allowed to carry.
// Anything else — including a real name pulled from a production chat — fails.
const ALLOWED_FIXTURE_STRINGS = new Set([
  "Алекс",
  "alex_demo",
  "Команда проекта",
  "Мария",
  "Макет готов к просмотру",
  "Отправила документ",
  "Обновила макет главной",
  "Отлично, где посмотреть?",
  "Скинула в общий диск",
  "Открою после планёрки",
  "Добавила правки",
  "Спасибо, посмотрю",
  "Встречаемся в 15:00",
  "Принято, добавил",
  "14:32",
  "14:35",
  "14:37",
  "14:41",
  "14:47",
  "14:51",
  "14:54",
  "14:58",
  "15:02",
]);

// The subset used to prove the fixture is absent from a production bundle. Only
// distinctive phrases belong here: a common word such as a bare given name or a
// UI label could legitimately occur in the application's own strings, which
// would make the bundle scan fail for the wrong reason.
const FIXTURE_PRODUCTION_MARKERS = [
  "alex_demo",
  "Команда проекта",
  "Макет готов к просмотру",
  "Отправила документ",
  "Обновила макет главной",
  "Отлично, где посмотреть?",
  "Скинула в общий диск",
  "Открою после планёрки",
  "Добавила правки",
  "Спасибо, посмотрю",
  "Встречаемся в 15:00",
  "Принято, добавил",
];

function repoPath(relative) {
  return path.join(rootPath, relative);
}

// Collects rendered values only. Object keys are structure, not content, and
// are validated by the fixture's own parser. An earlier version collected keys
// too and then skipped anything matching a lowercase-ASCII shape, which silently
// exempted real display values such as a genuine account handle.
function collectValues(value, found = []) {
  if (typeof value === "string") {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectValues(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectValues(item, found);
  }
  return found;
}

// Sources whose output the bundle scan is asserting about. A build produced
// before these were last edited would pass the scan trivially.
const BUNDLE_RELEVANT_SOURCES = [
  "artifacts/kub/src/App.tsx",
  "artifacts/kub/src/lib/publicPreviewFixture.ts",
  "artifacts/kub/src/pages/public/PublicPreviewCapturePage.tsx",
  FIXTURE_PATH,
];

function newestModification(files) {
  return Math.max(...files.map((file) => statSync(file).mtimeMs));
}

function buildOutputFiles() {
  const directory = repoPath(BUILD_DIRECTORY);
  assert.ok(
    existsSync(directory),
    `${BUILD_DIRECTORY} is missing. Run the production build before this test:\n` +
      '  cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"',
  );

  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) walk(next);
      else files.push(next);
    }
  };
  walk(directory);
  return files;
}

test("the product asset directory holds exactly the declared public assets", async () => {
  const directory = repoPath(PRODUCT_DIRECTORY);
  assert.ok(existsSync(directory), `${PRODUCT_DIRECTORY} does not exist`);

  const present = readdirSync(directory).sort();
  assert.deepEqual(
    present,
    [...PRODUCT_ASSETS].sort(),
    "the product directory must contain exactly the declared assets and nothing else",
  );
});

test("asset filenames carry no personal data", () => {
  for (const name of PRODUCT_ASSETS) {
    assert.match(name, /^[a-z0-9-]+\.webp$/, `${name} must be a lowercase hyphenated .webp name`);
    assert.doesNotMatch(name, EMAIL_PATTERN, `${name} looks like it contains an address`);
    assert.doesNotMatch(name, PHONE_PATTERN, `${name} looks like it contains a phone number`);
  }
});

for (const name of PRODUCT_ASSETS) {
  test(`${name} is a bounded WebP image`, async () => {
    const file = repoPath(path.join(PRODUCT_DIRECTORY, name));
    assert.ok(existsSync(file), `${name} has not been generated yet`);

    const { size } = await stat(file);
    assert.ok(size > 0, `${name} is empty`);
    assert.ok(
      size < MAX_BYTES,
      `${name} is ${size} bytes, at or above the ${MAX_BYTES} byte public budget`,
    );

    const metadata = await sharp(file).metadata();
    assert.equal(metadata.format, "webp", `${name} must be WebP, got ${metadata.format}`);
    assert.ok(
      metadata.width >= MIN_WIDTH && metadata.width <= MAX_WIDTH,
      `${name} width ${metadata.width} is outside ${MIN_WIDTH}-${MAX_WIDTH}`,
    );
    assert.ok(
      metadata.height >= MIN_HEIGHT && metadata.height <= MAX_HEIGHT,
      `${name} height ${metadata.height} is outside ${MIN_HEIGHT}-${MAX_HEIGHT}`,
    );
  });
}

test("every published asset is a distinct image", () => {
  const digests = new Map();
  for (const name of PRODUCT_ASSETS) {
    const digest = createHash("sha256")
      .update(readFileSync(repoPath(path.join(PRODUCT_DIRECTORY, name))))
      .digest("hex");
    const existing = digests.get(digest);
    assert.equal(
      existing,
      undefined,
      `${name} is byte-identical to ${existing}; each published asset must be a distinct render`,
    );
    digests.set(digest, name);
  }
});

test("the demo fixture carries only checked-in fictional content", async () => {
  const raw = await readFile(repoPath(FIXTURE_PATH), "utf8");
  const fixture = JSON.parse(raw);

  assert.doesNotMatch(raw, EMAIL_PATTERN, "the fixture contains an address-shaped value");
  assert.doesNotMatch(raw, PHONE_PATTERN, "the fixture contains a phone-shaped value");
  assert.doesNotMatch(raw, TOKEN_PATTERN, "the fixture contains a credential-shaped value");

  const values = collectValues(fixture);
  assert.ok(values.length > 0, "the fixture carries no rendered strings at all");
  for (const value of values) {
    assert.ok(
      ALLOWED_FIXTURE_STRINGS.has(value),
      `"${value}" is not in the approved fictional fixture vocabulary`,
    );
  }
});

test("every production marker really occurs in the fixture", async () => {
  const raw = await readFile(repoPath(FIXTURE_PATH), "utf8");
  for (const marker of FIXTURE_PRODUCTION_MARKERS) {
    assert.ok(
      raw.includes(marker),
      `"${marker}" is scanned for in the bundle but is not in the fixture, so the scan proves nothing`,
    );
    assert.ok(
      ALLOWED_FIXTURE_STRINGS.has(marker),
      `"${marker}" is scanned for but is not approved fixture vocabulary`,
    );
  }
});

test("the production build is newer than the sources it is asserted about", () => {
  const outputs = buildOutputFiles();
  const newestSource = newestModification(BUNDLE_RELEVANT_SOURCES.map((file) => repoPath(file)));
  const newestOutput = newestModification(outputs);

  assert.ok(
    newestOutput >= newestSource,
    `${BUILD_DIRECTORY} is older than its sources, so the bundle assertions below would pass trivially. ` +
      "Rebuild before running this test.",
  );
});

test("the production bundle emits no capture chunk", () => {
  const offenders = buildOutputFiles()
    .filter((file) => path.basename(file).includes(CAPTURE_CHUNK_NAME))
    .map((file) => path.relative(rootPath, file));

  assert.deepEqual(offenders, [], "the DEV capture page must not be emitted as a production chunk");
});

test("the production bundle omits the capture route and its fixture", () => {
  const offenders = [];
  for (const file of buildOutputFiles()) {
    if (!/\.(js|css|html|json|map)$/i.test(file)) continue;
    const contents = readFileSync(file);
    const text = contents.toString("utf8");
    for (const marker of CAPTURE_CONTENT_MARKERS) {
      if (text.includes(marker)) offenders.push(`${file}: capture marker "${marker}"`);
    }
    for (const marker of FIXTURE_PRODUCTION_MARKERS) {
      if (text.includes(marker)) offenders.push(`${file}: fixture string "${marker}"`);
    }
  }

  assert.deepEqual(offenders, [], "the production bundle must not ship the DEV capture surface");
});
