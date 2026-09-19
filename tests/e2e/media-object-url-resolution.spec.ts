import { expect, test } from "@playwright/test";

/**
 * D-208 steps one and two, measured in a real build rather than in `node --test`.
 *
 * The unit suite can reach `mediaObjectRef`, `signedUrlLifetime`,
 * `signedMediaUrlStore` and `mediaUrlMode` because none of them imports
 * anything a browser owns. It cannot reach `lib/media/mediaUrl.ts` at all: that
 * module reads `import.meta.env` and imports supabase-js, which is exactly the
 * boundary `lib/supabase/config.ts` was split across for the same reason.
 *
 * So the two things only a browser can answer are answered here:
 *
 * 1. A build with no flag set resolves in `"public"` mode, and the address it
 *    produces is character-for-character the one `getPublicUrl` produces. That
 *    is the claim the whole of step one rests on — that nothing on screen
 *    changes — and a source scan cannot make it.
 * 2. A build with `VITE_MEDIA_SIGNED_URLS=signed` resolves in `"signed"` mode
 *    and still hands back an address rather than nothing, because the public
 *    fallback is what keeps a conversation on screen while the read policy is
 *    still the narrow one.
 *
 * The second case runs only against a server started with that flag, and says
 * so rather than skipping silently.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

const OWNER = "3adfd4e6-fff4-4bea-8092-04b62a45a177";
const CHAT = "3b51161f-ca4f-4cb1-a93e-7132abb60718";
const MESSAGE = "9959a148-758e-4424-9dc4-d794bf8aefcc";

const PATHS = [
  `${OWNER}/1757000000000-photo.jpg`,
  `avatars/${OWNER}/avatar-${MESSAGE}.webp`,
  `chat-avatars/${CHAT}/avatar-${MESSAGE}.png`,
  `variants/messages/${CHAT}/${MESSAGE}/image_preview.webp`,
  `variants/profiles/${OWNER}/avatar_128.webp`,
  `${OWNER}/holiday photo.jpg`,
];

interface Resolution {
  mode: string;
  rows: { path: string; resolved: string | null; viaGetPublicUrl: string | null }[];
}

async function resolveInPage(page: import("@playwright/test").Page, paths: string[]) {
  return await page.evaluate(async (list): Promise<Resolution> => {
    const media = await import("/src/lib/media/mediaUrl.ts");
    const client = await import("/src/lib/supabase/client.ts");
    const storage = client.createClient().storage;
    return {
      mode: media.mediaUrlMode(),
      rows: list.map((path) => ({
        path,
        resolved: media.mediaObjectUrl({ bucket: "media", path }),
        viaGetPublicUrl: storage.from("media").getPublicUrl(path).data.publicUrl ?? null,
      })),
    };
  }, paths);
}

test("with no flag the resolver returns exactly what getPublicUrl returned", async ({ page }) => {
  // The one server this case must not run against is the one below's. Naming
  // that explicitly rather than reading the mode and skipping: a case that
  // decides for itself whether it applies is a case that can stop applying
  // everywhere at once and still report success.
  test.skip(
    process.env.KUB_EXPECT_MEDIA_SIGNED_URLS === "1",
    "this server was started with VITE_MEDIA_SIGNED_URLS=signed; the public-mode case belongs on a server without it",
  );

  await page.goto("/login");
  await page.waitForLoadState("domcontentloaded");

  const result = await resolveInPage(page, PATHS);

  expect(
    result.mode,
    "a server started without VITE_MEDIA_SIGNED_URLS must resolve in public mode; " +
      "if this says 'signed' the server under test has the flag set and this case is being run in the wrong place",
  ).toBe("public");

  for (const row of result.rows) {
    expect(row.viaGetPublicUrl, row.path).toBeTruthy();
    expect(row.resolved, row.path).toBe(row.viaGetPublicUrl);
  }
});

test("a message with only a legacy media_url still resolves to its object", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("domcontentloaded");

  const answer = await page.evaluate(async (owner) => {
    const media = await import("/src/lib/media/mediaUrl.ts");
    const client = await import("/src/lib/supabase/client.ts");
    const storage = client.createClient().storage;
    const path = `${owner}/1740000000000-old.mp4`;
    const legacyUrl = storage.from("media").getPublicUrl(path).data.publicUrl;
    return {
      fromColumns: media.messageMediaUrl({
        media_bucket: "media",
        media_path: path,
        media_url: legacyUrl,
      }),
      fromUrlAlone: media.messageMediaUrl({
        media_bucket: null,
        media_path: null,
        media_url: legacyUrl,
      }),
      legacyUrl,
      textMessage: media.messageMediaUrl({ media_bucket: null, media_path: null, media_url: null }),
    };
  }, OWNER);

  // The 20 rows that predate the path columns must resolve to the same object
  // as the 294 that carry them. Without this the back-fill would be a
  // prerequisite for step one rather than a tidy-up after it.
  expect(answer.fromUrlAlone).toBe(answer.legacyUrl);
  expect(answer.fromColumns).toBe(answer.legacyUrl);
  expect(answer.textMessage).toBeNull();
});

test("the originals resolve without ever rebuilding the column", async ({ page }) => {
  // The shapes routed in step two's second half: a message's own photograph,
  // video, voice message and file, and the presses that fetch their bytes.
  // Unlike a variant, each of these has the address sitting in a column as
  // well, and in `"public"` mode that column is what must come back — not a
  // rebuilt address that merely happens to match on today's rows.
  test.skip(
    process.env.KUB_EXPECT_MEDIA_SIGNED_URLS === "1",
    "this server was started with VITE_MEDIA_SIGNED_URLS=signed; the public-mode case belongs on a server without it",
  );

  await page.goto("/login");
  await page.waitForLoadState("domcontentloaded");

  const answer = await page.evaluate(async (owner) => {
    const media = await import("/src/lib/media/mediaUrl.ts");
    const path = `${owner}/1757000000000-voice.webm`;
    // A column whose text is deliberately NOT what `getPublicUrl` would build:
    // if the resolver rebuilds, this comes back different, and that difference
    // is the whole assertion.
    const column = `https://core.letscube.ru/storage/v1/object/public/media/${path}?v=20260919`;
    const row = { media_bucket: "media", media_path: path, media_url: column };
    const dataUri = "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAAfQ//73v/+BiOh/AAA=";
    return {
      column,
      fromRow: media.messageMediaUrl(row),
      settled: media.isMessageMediaUrlSettled(row),
      ensured: await media.ensureMessageMediaUrl(row),
      // `publicPreviewFixture.ts` gives every photograph one of these, with
      // both path columns null. A resolver that dropped it would take every
      // picture out of the preview fixture.
      fixturePicture: media.messageMediaUrl({ media_bucket: null, media_path: null, media_url: dataUri }),
      dataUri,
    };
  }, OWNER);

  expect(answer.fromRow).toBe(answer.column);
  expect(answer.ensured).toBe(answer.column);
  expect(answer.settled).toBe(true);
  expect(answer.fixturePicture).toBe(answer.dataUri);
});

test("with the flag on, an address still comes back", async ({ page }) => {
  test.skip(
    process.env.KUB_EXPECT_MEDIA_SIGNED_URLS !== "1",
    "needs a dev server started with VITE_MEDIA_SIGNED_URLS=signed, and KUB_EXPECT_MEDIA_SIGNED_URLS=1 to say so",
  );

  await page.goto("/login");
  await page.waitForLoadState("domcontentloaded");

  const result = await resolveInPage(page, PATHS);
  expect(result.mode).toBe("signed");

  // The signing POST goes to a fixture Supabase that is not there, so every
  // signature fails — which is precisely the state the public fallback exists
  // for, and the state a real deployment is in until the read policy is
  // widened. Nothing may come back empty.
  for (const row of result.rows) {
    expect(row.resolved, row.path).toBe(row.viaGetPublicUrl);
  }
});
