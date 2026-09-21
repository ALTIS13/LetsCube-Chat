import { chromium, expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";
import {
  TITLE_CHARACTERS_REQUIRED,
  measureViewerHeader,
  titleShortfall,
} from "./helpers/viewerHeader";

/**
 * D-097: the viewer's file control, and what it actually hands over.
 *
 * The control was «Открыть оригинал» until D-147 renamed it, and it has always
 * acted on `message.media_url`. For a photo sent the ordinary way that address
 * is the copy the client re-encoded before uploading — `stageFiles` never
 * uploads the picked file — so there is no original on the server to open. The
 * viewer said so only in the other direction: an uncompressed send got an
 * «Оригинал» badge and everything else got silence, which reads as «ordinary»
 * rather than as «a copy».
 *
 * Measured here rather than argued: `window.fetch` is recorded, so what the
 * press reaches for is a fact the page reports. Then the header's word, the
 * control's name, and — for the header that D-147 measured down to 37 pixels of
 * title — what a video at 390 has left once the badge is in the row.
 *
 * Everything runs on the mocked message-actions fixture with fictional people
 * and media this spec serves itself.
 */

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";

const COPY_CAPTION = "Схема первого этажа";
const ORIGINAL_CAPTION = "Фасад, как снято";
const SILENT_CAPTION = "Старое фото без метаданных";
const CLIP_CAPTION = "Проход по этажу, сжатое видео";

const COPY_URL = "/__fixture-media/plan.webp.svg";
const ORIGINAL_URL = "/__fixture-media/facade.jpg.svg";
const SILENT_URL = "/__fixture-media/legacy.svg";
const CLIP_URL = "/__fixture-media/walk.webm";

/** A 4:3 card, legible enough to tell one picture from another in a frame. */
const card = (label: string, hue: number) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">' +
  `<rect width="1200" height="900" fill="hsl(${hue} 45% 26%)"/>` +
  `<g stroke="hsl(${hue} 70% 62%)" stroke-width="3">` +
  Array.from({ length: 11 }, (_, i) => `<line x1="${i * 120}" y1="0" x2="${i * 120}" y2="900"/>`).join("") +
  Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${i * 112.5}" x2="1200" y2="${i * 112.5}"/>`).join("") +
  "</g>" +
  `<text x="600" y="490" font-family="Arial, sans-serif" font-size="110" font-weight="700" fill="white" text-anchor="middle">${label}</text>` +
  "</svg>";

const iso = (minute: number) => new Date(Date.UTC(2026, 8, 14, 10, minute)).toISOString();

/** The metadata `buildAttachmentMediaMetadata` writes for an ordinary photo send. */
const COMPRESSED_METADATA = {
  kind: "image",
  mime_type: "image/webp",
  size_bytes: 384_102,
  original_size_bytes: 4_210_688,
  original_mime_type: "image/jpeg",
  optimized: true,
  width: 1200,
  height: 900,
  uncompressed: false,
};

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [
      membership(CHAT_TEAM, ME, "owner", AT),
      membership(CHAT_TEAM, ANNA, "member", AT),
    ],
    messages: [
      message("66666666-6666-4666-8666-000000000001", CHAT_TEAM, ANNA, COPY_CAPTION, iso(1), {
        type: "image",
        media_url: COPY_URL,
        media_metadata: COMPRESSED_METADATA,
      }),
      message("66666666-6666-4666-8666-000000000002", CHAT_TEAM, ANNA, ORIGINAL_CAPTION, iso(2), {
        type: "image",
        media_url: ORIGINAL_URL,
        media_metadata: {
          kind: "image",
          mime_type: "image/jpeg",
          size_bytes: 4_210_688,
          original_size_bytes: 4_210_688,
          original_mime_type: "image/jpeg",
          optimized: false,
          width: 1200,
          height: 900,
          uncompressed: true,
        },
      }),
      message("66666666-6666-4666-8666-000000000003", CHAT_TEAM, ANNA, SILENT_CAPTION, iso(3), {
        type: "image",
        media_url: SILENT_URL,
        media_metadata: { width: 1200, height: 900 },
      }),
      message("66666666-6666-4666-8666-000000000004", CHAT_TEAM, ANNA, CLIP_CAPTION, iso(4), {
        type: "video",
        media_url: CLIP_URL,
        media_metadata: {
          kind: "video",
          mime_type: "video/webm",
          size_bytes: 512_000,
          original_size_bytes: 8_400_000,
          original_mime_type: "video/quicktime",
          optimized: true,
          width: 640,
          height: 360,
          duration_ms: 1_500,
          uncompressed: false,
        },
      }),
    ],
  };
}

/** Records what the page reached for and what it wrote, so a claim can be checked against a fact. */
async function watchFileHandling(page: Page) {
  await page.addInitScript(() => {
    const fetched: string[] = [];
    const opened: string[] = [];
    const saved: { name: string; scheme: string }[] = [];
    const window_ = window as unknown as Record<string, unknown>;
    window_.__fetched = fetched;
    window_.__opened = opened;
    window_.__saved = saved;
    const realFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      fetched.push(url);
      return realFetch(input as RequestInfo, init);
    }) as typeof window.fetch;
    window.open = ((url?: string | URL) => {
      opened.push(String(url ?? ""));
      return null;
    }) as typeof window.open;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      if (this.download) saved.push({ name: this.download, scheme: this.href.split(":")[0] ?? "" });
      // Not called through: a real click hands the file to the browser's own
      // download, which is not this machine's business during a test.
    };
  });
}

const fileHandling = (page: Page) =>
  page.evaluate(() => ({
    fetched: (window as unknown as { __fetched: string[] }).__fetched,
    opened: (window as unknown as { __opened: string[] }).__opened,
    saved: (window as unknown as { __saved: { name: string; scheme: string }[] }).__saved,
  }));

let clip: Buffer | null = null;

/**
 * Whether this engine gets the clip's bytes.
 *
 * Playwright's WebKit decodes neither the VP8 WebM nor an H.264 MP4 that
 * Chromium's MediaRecorder can produce, and an errored source makes the bubble
 * draw «Не удалось загрузить видео» with no way into the viewer. Held instead
 * of refused, the element stays at `readyState` 0 with no error, and the header
 * this spec measures is the one a decoded clip would give — it is drawn from
 * the message row, not from the video.
 */
function holdsTheClip(browserName: string): boolean {
  return browserName === "webkit";
}

async function openConversation(page: Page, theme: "light" | "dark", browserName: string) {
  await watchFileHandling(page);
  const seed = rows();
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  const picture = (label: string, hue: number) => (route: { fulfill: (options: Record<string, unknown>) => Promise<void> }) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: card(label, hue) });
  await page.route(`**${COPY_URL}`, picture("КОПИЯ", 205));
  await page.route(`**${ORIGINAL_URL}`, picture("ОРИГИНАЛ", 145));
  await page.route(`**${SILENT_URL}`, picture("БЕЗ ДАННЫХ", 275));
  const hold = holdsTheClip(browserName);
  await page.route(`**${CLIP_URL}`, async (route) => {
    if (hold) await new Promise((resolve) => setTimeout(resolve, 30_000));
    await route
      .fulfill({ status: 200, contentType: "video/webm", body: clip ?? Buffer.alloc(0) })
      .catch(() => undefined);
  });

  await openChat(page, "Команда проекта", COPY_CAPTION);
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
  await page.evaluate(() => document.fonts.ready);
}

/**
 * A real clip, recorded in Chromium rather than checked in.
 *
 * Only the video *bubble* needs it: a source it cannot decode makes the bubble
 * draw «Не удалось загрузить видео» with no way into the viewer, and the header
 * this spec measures would never open. The viewer's own header renders the same
 * whether the picture loads or not.
 */
test.beforeAll(async () => {
  const recorder = await chromium.launch();
  const page = await recorder.newPage();
  await page.goto("about:blank");
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const stream = canvas.captureStream(24);
    const chunks: Blob[] = [];
    const media = new MediaRecorder(stream, { mimeType: "video/webm" });
    media.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => {
      media.onstop = resolve;
    });
    media.start();
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        ctx.fillStyle = "hsl(205 45% 26%)";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 56px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("ВИДЕО", 320, 200);
        if (performance.now() - started >= 1_200) {
          clearInterval(timer);
          resolve();
        }
      }, 40);
    });
    media.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  });
  clip = Buffer.from(base64, "base64");
  await page.close();
  await recorder.close();
  expect(clip.byteLength).toBeGreaterThan(2_000);
});

async function openViewer(page: Page, caption: string, control: string) {
  const bubble = page.locator('[data-message-bubble="true"]', { hasText: caption });
  await bubble.scrollIntoViewIfNeeded();
  await bubble.getByRole("button", { name: control }).click();
  const dialog = page.getByRole("dialog", { name: caption });
  await expect(dialog).toBeVisible();
  return dialog;
}

function shotPath(info: TestInfo, name: string): string {
  return `output/media-original-claim/${name}-${info.project.name}.png`;
}

/**
 * The badge's word, and that exactly one spelling of it is drawn.
 *
 * Two spans, one per width, so what a reader sees has to be read off the page
 * rather than off `textContent` — which holds both and would be satisfied by a
 * badge nobody can see.
 */
async function badgeWord(page: Page): Promise<{ drawn: string[]; compact: boolean }> {
  const drawn = await page.evaluate(() => {
    const badge = document.querySelector('[data-testid="media-viewer-originality"]');
    if (!badge) return [];
    return Array.from(badge.querySelectorAll("span"))
      .filter((span) => span.getBoundingClientRect().width > 0)
      .map((span) => span.textContent ?? "");
  });
  return { drawn, compact: (page.viewportSize()?.width ?? 0) < 640 };
}

test("a compressed photo says it is a copy, and the control names what it saves", async ({ page, browserName }, info) => {
  await requireFixtureServer(page.request);
  await openConversation(page, "dark", browserName);
  await openViewer(page, COPY_CAPTION, "Открыть фото");

  const badge = page.getByTestId("media-viewer-originality");
  await expect(badge).toHaveAttribute("data-originality", "compressed");
  await expect(badge).toHaveAttribute("title", /Оригинал остался у отправителя/);
  // A word at every width, including the one where a person is most likely to
  // be pressing «Сохранить» without reading anything else — the narrow one is
  // «Копия», which is the opposite of «Оригинал» and fits a 360 header.
  await expect(badge).toBeVisible();
  const word = await badgeWord(page);
  expect(word.drawn, "one spelling, and exactly one").toEqual([word.compact ? "Копия" : "Сжатая копия"]);

  const control = page.getByTestId("media-viewer-file-action");
  await expect(control).toHaveAccessibleName("Сохранить сжатую копию");

  await page.screenshot({ path: shotPath(info, "copy-dark") });

  // And what it actually reaches for: the stored copy, because that is the only
  // file there is. This is the measurement D-097 rested on.
  await control.click();
  await expect
    .poll(async () => (await fileHandling(page)).saved.length, { message: "nothing was saved" })
    .toBeGreaterThan(0);
  const { fetched, opened, saved } = await fileHandling(page);
  expect(opened, "a tab was opened, which D-147 closed").toEqual([]);
  expect(saved[0]?.scheme).toBe("blob");
  const reached = fetched.filter((url) => url.includes("__fixture-media"));
  expect(reached, "the press fetched something other than the stored file").toEqual([COPY_URL]);
});

test("an original still says so, and a message that says nothing is left alone", async ({ page, browserName }, info) => {
  await requireFixtureServer(page.request);
  await openConversation(page, "light", browserName);

  await openViewer(page, ORIGINAL_CAPTION, "Открыть фото");
  const badge = page.getByTestId("media-viewer-originality");
  await expect(badge).toHaveAttribute("data-originality", "original");
  // One spelling at both widths: «Оригинал» already fits the narrowest header.
  expect((await badgeWord(page)).drawn).toEqual(["Оригинал"]);
  await expect(page.getByTestId("media-viewer-file-action")).toHaveAccessibleName("Сохранить оригинал");
  await page.screenshot({ path: shotPath(info, "original-light") });
  await page.getByRole("button", { name: "Закрыть" }).click();

  // A row with no compression metadata at all: the product must not guess, in
  // either direction. This is the state every legacy message is in.
  await openViewer(page, SILENT_CAPTION, "Открыть фото");
  await expect(page.getByTestId("media-viewer-originality")).toHaveCount(0);
  await expect(page.getByTestId("media-viewer-file-action")).toHaveAccessibleName("Сохранить");
  await page.screenshot({ path: shotPath(info, "silent-light") });
});

test("the badge costs the title what it can afford, in the worst header there is", async ({ page, browserName }, info) => {
  await requireFixtureServer(page.request);
  // «The worst header there is» was not, until 2026-09-21. This ran in the
  // browser shell, where the file control is a glyph below `sm` — 40px. In the
  // Android shell the same control keeps its word at every width (D-147) and is
  // 125px, and that is the header the product actually ships to a phone. The
  // 85px between them is why this guard read 97px of title at 360 and passed
  // while the shipped one had 12px. Capacitor decides the platform from this
  // one property; see `getPlatformId` in `@capacitor/core`.
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).androidBridge = { postMessage: () => undefined };
  });
  await openConversation(page, "dark", browserName);
  // A video: the one kind whose header carries a fourth control, which is where
  // D-147 measured the title down to 37 pixels.
  await openViewer(page, CLIP_CAPTION, "Открыть видео в просмотрщике");

  // Drawn, not merely present: `textContent` holds both spellings.
  await expect(page.getByTestId("media-viewer-originality")).toBeVisible();
  const word = await badgeWord(page);
  expect(word.drawn).toEqual([word.compact ? "Копия" : "Сжатая копия"]);
  await expect(page.getByTestId("media-viewer-fullscreen")).toBeVisible();

  const measured = await page.evaluate(() => {
    // By its own test id, not by position in the tree. This used to read
    // `badge.parentElement.firstElementChild`, which meant «whatever sits left
    // of the badge» — so the assertion would have followed the badge to any
    // other row and gone on measuring something, silently.
    const badge = document.querySelector('[data-testid="media-viewer-originality"]') as HTMLElement | null;
    if (!badge) return null;
    return {
      badge: Math.round(badge.getBoundingClientRect().width),
      badgeRight: Math.round(badge.getBoundingClientRect().right),
      viewport: window.innerWidth,
    };
  });
  const fit = await measureViewerHeader(page);
  await page.screenshot({ path: shotPath(info, "video-copy-dark") });

  expect(measured).not.toBeNull();
  expect(fit, "the viewer draws no title element").not.toBeNull();
  // Enough of the picture's own name to read, not just an ellipsis. The number
  // that used to stand here (60px) was this spec's own, different from the one
  // `media-viewer-actions.spec.ts` kept for the same contract (80px), and both
  // were measured once at one width in the wrong shell. There is one definition
  // now, in characters, and it lives in `helpers/viewerHeader.ts`.
  expect(fit!.legible, `${titleShortfall(fit!, measured!.viewport)}, badge ${measured!.badge}px`)
    .toBeGreaterThanOrEqual(Math.min(TITLE_CHARACTERS_REQUIRED, fit!.length));
  // And the badge itself is whole: a word cut off is worse than none.
  expect(measured!.badgeRight).toBeLessThanOrEqual(measured!.viewport);
});
