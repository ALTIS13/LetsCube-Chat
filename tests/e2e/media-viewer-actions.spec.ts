import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  AUDIO_GAIN_LABEL,
  AUDIO_GROUP_LEVEL,
  AUDIO_INPUT_LABEL,
} from "../../artifacts/kub/src/lib/audioSettingsSurface";
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

/**
 * The media viewer's controls, and the one volume behind a conversation.
 *
 * Three defects, all of them things a browser can be made to answer:
 *
 * - **D-147.** «Открыть оригинал» called `window.open(url, "_blank")` in every
 *   shell. In a browser that is a tab; in the Windows app Tauri denies the new
 *   window and hands the address to the default browser, and in the Android app
 *   Capacitor starts another application over this one. What is asserted here
 *   is the browser's own branch — the file is fetched and saved with no tab
 *   opened at all — and, where the page can be made to look like the Android
 *   shell, that the control changes its name to say where it goes. The Windows
 *   and iPhone shells cannot be reached from here; they are covered by
 *   `tests/unit/media-file-action.test.mts` and are unverified as shells.
 * - **D-148.** The fullscreen control wore the same external-link glyph as the
 *   control beside it and had no accessible name, which on a phone — where both
 *   words are hidden — left two identical unnamed icons in a row.
 * - **D-149.** Two stored volumes were applied to the same `<audio>` element,
 *   so what a person heard depended on which had written last. The element's
 *   own `volume` is read back here, which is the only way to tell the two
 *   apart from outside.
 *
 * Everything runs on the message-actions fixture — a mocked backend with
 * fictional people and media this spec makes itself — so no production screen
 * and no stored file is ever touched.
 */

const AT = "2026-09-13T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";

const PHOTO_CAPTION = "Схема первого этажа";
const VIDEO_CAPTION = "Проход по этажу";
const VOICE_CAPTION = "Голосовое сообщение";

/** Served by this spec, on the fixture's own host, so nothing leaves the machine. */
const PHOTO_URL = "/__fixture-media/plan-1.svg";
const CLIP_URL = "/__fixture-media/walk.webm";
const VOICE_URL = "/__fixture-media/voice.webm";

const PLAYBACK_KEY = "kub.mediaPlayback.v1";
const SOUND_KEY = "kub:audio-settings:v1";

/** A 4:3 test card, big enough to fill the viewer and tell one photo from another. */
const TEST_CARD =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">' +
  '<rect width="1200" height="900" fill="hsl(205 45% 24%)"/>' +
  '<g stroke="hsl(205 70% 62%)" stroke-width="3">' +
  Array.from({ length: 11 }, (_, i) => `<line x1="${i * 120}" y1="0" x2="${i * 120}" y2="900"/>`).join("") +
  Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${i * 112.5}" x2="1200" y2="${i * 112.5}"/>`).join("") +
  "</g>" +
  '<circle cx="600" cy="450" r="90" fill="none" stroke="white" stroke-width="10"/>' +
  '<text x="600" y="170" font-family="Arial, sans-serif" font-size="96" font-weight="700" fill="white" text-anchor="middle">ПЛАН</text>' +
  "</svg>";

let clip: Buffer | null = null;

/**
 * A real video, recorded here rather than checked in.
 *
 * The viewer draws its error panel over a source it cannot decode, and the
 * header — the thing this spec photographs — would then sit above a failure
 * rather than above a video.
 */
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("about:blank");
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const stream = canvas.captureStream(24);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.start();
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const t = performance.now() - started;
        ctx.fillStyle = `hsl(${(200 + t / 20) % 360} 45% 30%)`;
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 64px sans-serif";
        ctx.fillText(String(Math.round(t / 100) / 10), 40, 200);
        if (t >= 1500) {
          clearInterval(timer);
          resolve();
        }
      }, 40);
    });
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  });
  clip = Buffer.from(base64, "base64");
  await page.close();
  // A clip the recorder never filled would make every video assertion vacuous.
  expect(clip.byteLength).toBeGreaterThan(2_000);
});

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [
      membership(CHAT_TEAM, ME, "owner", AT),
      membership(CHAT_TEAM, ANNA, "member", AT),
    ],
    messages: [
      message("55555555-5555-4555-8555-000000000001", CHAT_TEAM, ANNA, PHOTO_CAPTION, iso(0), {
        type: "image",
        media_url: PHOTO_URL,
        media_metadata: { width: 1200, height: 900 },
      }),
      message("55555555-5555-4555-8555-000000000002", CHAT_TEAM, ANNA, VIDEO_CAPTION, iso(5), {
        type: "video",
        media_url: CLIP_URL,
        media_metadata: { width: 640, height: 360, duration_ms: 1500 },
      }),
      message("55555555-5555-4555-8555-000000000003", CHAT_TEAM, ANNA, VOICE_CAPTION, iso(9), {
        type: "audio",
        media_url: VOICE_URL,
        media_metadata: { duration_ms: 1500 },
      }),
    ],
  };
}

const iso = (minute: number) => new Date(Date.UTC(2026, 8, 13, 10, minute)).toISOString();

function shotPath(info: TestInfo, name: string): string {
  return `output/media-viewer/${name}-${info.project.name}.png`;
}

/**
 * The theme, stamped the way the product's own runtime stamps it: the fixture
 * writes «dark» in an init script of its own, which runs after anything this
 * file could add to storage.
 */
async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
}

/** Records what the page tried to do with a file, so a save can be told from a tab. */
async function watchFileHandling(page: Page) {
  await page.addInitScript(() => {
    const opened: string[] = [];
    const saved: { name: string; scheme: string }[] = [];
    (window as unknown as Record<string, unknown>).__opened = opened;
    (window as unknown as Record<string, unknown>).__saved = saved;
    window.open = ((url?: string | URL) => {
      opened.push(String(url ?? ""));
      return null;
    }) as typeof window.open;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      if (this.download) saved.push({ name: this.download, scheme: this.href.split(":")[0] ?? "" });
      // Not called through: a real click would hand the file to the browser's
      // own download, which is not this machine's business during a test.
    };
    (window as unknown as Record<string, unknown>).__restoreClick = () => {
      HTMLAnchorElement.prototype.click = click;
    };
  });
}

const fileHandling = (page: Page) =>
  page.evaluate(() => ({
    opened: (window as unknown as { __opened: string[] }).__opened,
    saved: (window as unknown as { __saved: { name: string; scheme: string }[] }).__saved,
  }));

interface OpenOptions {
  theme?: "light" | "dark";
  /** Seeded before the application starts, as a person's earlier choices would be. */
  storage?: Record<string, string>;
  /** Makes Capacitor report the Android app: the shell that cannot keep a download. */
  androidShell?: boolean;
  /**
   * Whether to walk into the conversation. A phone's chat list and its chat are
   * the same column, so a test that wants the side menu has to stay in the list:
   * from inside a chat there is no menu button on screen to press.
   */
  enterChat?: boolean;
}

async function openConversation(page: Page, options: OpenOptions = {}) {
  await watchFileHandling(page);
  if (options.androidShell) {
    // Capacitor decides the platform from this one property; see `getPlatformId`
    // in `@capacitor/core`. The stub answers the bridge so nothing throws.
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).androidBridge = { postMessage: () => undefined };
    });
  }
  if (options.storage) {
    await page.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    }, options.storage);
  }

  const seed = rows();
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await page.route(`**${PHOTO_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: TEST_CARD }),
  );
  await page.route(`**${CLIP_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "video/webm", body: clip as Buffer }),
  );
  await page.route(`**${VOICE_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "video/webm", body: clip as Buffer }),
  );

  if (options.enterChat === false) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item").filter({ hasText: "Команда проекта" })).toBeVisible();
  } else {
    await openChat(page, "Команда проекта", PHOTO_CAPTION);
  }
  await stampTheme(page, options.theme ?? "light");
}

async function openViewer(page: Page, caption: string, control: string) {
  const bubble = page.locator('[data-message-bubble="true"]', { hasText: caption });
  await bubble.getByRole("button", { name: control }).click();
  const dialog = page.getByRole("dialog", { name: caption });
  await expect(dialog).toBeVisible();
  return dialog;
}

const openPhoto = (page: Page) => openViewer(page, PHOTO_CAPTION, "Открыть фото");
const openVideo = (page: Page) => openViewer(page, VIDEO_CAPTION, "Открыть видео в просмотрщике");

test("the viewer keeps the file in the app instead of opening its address (D-147)", async ({ page }, info) => {
  await requireFixtureServer(page.request);
  await openConversation(page);
  await openPhoto(page);

  const control = page.getByTestId("media-viewer-file-action");
  await expect(control).toHaveAttribute("data-action-kind", "save");
  await expect(control).toHaveAccessibleName("Сохранить");
  // The word from the `sm` width up, and on a phone the glyph alone — which
  // now means what it draws: a download, not a departure.
  const wide = (page.viewportSize()?.width ?? 0) >= 640;
  await expect(control.getByText("Сохранить")).toBeVisible({ visible: wide });

  await control.click();
  await expect
    .poll(async () => (await fileHandling(page)).saved.length, { message: "nothing was saved" })
    .toBeGreaterThan(0);
  const { opened, saved } = await fileHandling(page);
  expect(opened, "a tab was opened, which is what D-147 is about").toEqual([]);
  // The stored file keeps its own name, and it is handed over as bytes this
  // page already holds rather than as an address somebody else must fetch.
  expect(saved[0]).toEqual({ name: "plan-1.svg", scheme: "blob" });

  await page.screenshot({ path: shotPath(info, "photo-light") });
});

test("in the shell that cannot keep a download, the control says where it goes (D-147)", async ({ page }, info) => {
  await requireFixtureServer(page.request);
  await openConversation(page, { androidShell: true });
  await openPhoto(page);

  const control = page.getByTestId("media-viewer-file-action");
  await expect(control).toHaveAttribute("data-action-kind", "open");
  await expect(control).toHaveAccessibleName("Открыть в браузере");
  // In words at every width, this one: the shell it applies to is a phone, so a
  // warning hidden below the `sm` width would be a warning nobody ever reads.
  await expect(control.getByText("В браузере")).toBeVisible();

  await control.click();
  const { opened, saved } = await fileHandling(page);
  expect(saved, "the Android WebView keeps no download, so nothing may claim to save").toEqual([]);
  expect(opened.length).toBe(1);
  // And it says out loud that the file left, rather than looking like a press
  // that did nothing.
  await expect(page.getByText("Файл открыт в браузере")).toBeVisible();

  await page.screenshot({ path: shotPath(info, "photo-android-shell") });
});

test("the fullscreen control has a name and a glyph of its own (D-148)", async ({ page }, info) => {
  await requireFixtureServer(page.request);
  await openConversation(page);
  await openVideo(page);

  const fullscreen = page.getByTestId("media-viewer-fullscreen");
  // The name it never had: below the `sm` width its word is hidden, and the
  // button was then an unnamed icon.
  await expect(fullscreen).toHaveAccessibleName("На весь экран");
  const wide = (page.viewportSize()?.width ?? 0) >= 640;
  await expect(fullscreen.getByText("На весь экран")).toBeVisible({ visible: wide });

  const drawings = await headerGlyphs(page);
  expect(drawings.fullscreen.length).toBeGreaterThan(0);
  expect(drawings.fullscreen).not.toEqual(drawings.file);

  await page.screenshot({ path: shotPath(info, "video-light") });
});

test("the video header never draws the same icon twice (D-148)", async ({ page }) => {
  await requireFixtureServer(page.request);
  // In the Android shell the control beside it is the external-link one, which
  // is the exact pair the register recorded: «a phone shows two identical icons
  // side by side». Compared as drawings rather than by name, because the glyph
  // is what a person sees — and asserting merely that the two differ would pass
  // in a browser, where the neighbour is a download glyph, while the fullscreen
  // control went on lying.
  await openConversation(page, { androidShell: true });
  await openVideo(page);

  const drawings = await headerGlyphs(page);
  expect(drawings.file.length).toBeGreaterThan(0);
  expect(drawings.fullscreen).not.toEqual(drawings.file);
});

/** What the two controls in the header actually draw. */
function headerGlyphs(page: Page): Promise<{ fullscreen: string; file: string }> {
  return page.evaluate(() => {
    const svg = (testId: string) =>
      document.querySelector(`[data-testid="${testId}"] svg`)?.innerHTML ?? "";
    return { fullscreen: svg("media-viewer-fullscreen"), file: svg("media-viewer-file-action") };
  });
}

test("the busiest header the viewer can draw still fits a phone (D-147, D-148)", async ({ page }, info) => {
  await requireFixtureServer(page.request);
  // The worst case on purpose: the Android shell, whose control carries the
  // longest word, plus a video, which is the only kind with a fourth control.
  await openConversation(page, { androidShell: true });
  await openVideo(page);

  const header = await page.evaluate(() => {
    const control = document.querySelector('[data-testid="media-viewer-file-action"]');
    const row = control?.parentElement;
    const title = row?.querySelector("div.truncate, div.flex-1");
    if (!row) return null;
    return {
      overflow: row.scrollWidth - row.clientWidth,
      titleWidth: Math.round(title?.getBoundingClientRect().width ?? 0),
    };
  });
  expect(header).not.toBeNull();
  // A row that scrolls has controls a finger cannot reach.
  expect(header!.overflow).toBeLessThanOrEqual(1);
  // And the title is still a title rather than one letter and an ellipsis.
  expect(header!.titleWidth).toBeGreaterThan(80);

  await page.screenshot({ path: shotPath(info, "video-android-shell") });
});

test("the viewer holds in the dark theme", async ({ page }, info) => {
  await requireFixtureServer(page.request);
  await openConversation(page, { theme: "dark" });
  await openPhoto(page);
  await expect(page.getByTestId("media-viewer-file-action")).toBeVisible();
  await page.screenshot({ path: shotPath(info, "photo-dark") });

  await page.getByLabel("Закрыть").click();
  await openVideo(page);
  await expect(page.getByTestId("media-viewer-fullscreen")).toBeVisible();
  await page.screenshot({ path: shotPath(info, "video-dark") });
});

test("a voice message plays at the player's volume, not at a second stored one (D-149)", async ({ page }) => {
  await requireFixtureServer(page.request);
  // Both keys, disagreeing, which is the state the defect was invisible in: the
  // sound settings said 90% and the player said 30%, and which of them a person
  // heard depended on how playback had been started.
  await openConversation(page, {
    storage: {
      [PLAYBACK_KEY]: JSON.stringify({ playbackRate: 1, volume: 0.3 }),
      [SOUND_KEY]: JSON.stringify({ micInputGain: 1, voicePlaybackVolume: 0.9 }),
    },
  });

  const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  const volume = await voiceVolume(page);
  // Under a finger nothing draws a volume control, so nothing stored may turn
  // the sound down there (D-118) — the rule the one owner now carries.
  expect(volume).toBeCloseTo(coarse ? 1 : 0.3, 5);
  expect(volume, "the sound settings are writing to the element again").not.toBeCloseTo(0.9, 5);
});

test("a volume set in the old sound settings is inherited, not thrown away (D-149)", async ({ page }) => {
  await requireFixtureServer(page.request);
  await openConversation(page, {
    storage: { [SOUND_KEY]: JSON.stringify({ micInputGain: 1, voicePlaybackVolume: 0.4 }) },
  });

  const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  expect(await voiceVolume(page)).toBeCloseTo(coarse ? 1 : 0.4, 5);
});

/** What the voice bubble's own element is actually set to. */
async function voiceVolume(page: Page): Promise<number> {
  const bubble = page.locator('[data-voice-message="true"]');
  await expect(bubble.first()).toBeVisible();
  return await page.evaluate(() => {
    const audio = document.querySelector<HTMLAudioElement>('[data-voice-message="true"] audio');
    if (!audio) throw new Error("the voice bubble has no element");
    return audio.volume;
  });
}

test("the sound settings no longer offer a second playback volume (D-149)", async ({ page }, info) => {
  await requireFixtureServer(page.request);
  await openConversation(page, { enterChat: false });

  const phone = (page.viewportSize()?.width ?? 0) < 768;
  if (phone) {
    await page.getByRole("button", { name: "Меню" }).first().click();
    await page.getByRole("button", { name: "Настройки" }).first().click();
  } else {
    await page.getByTestId("side-menu-button").click();
    await expect(page.getByTestId("side-menu-layer")).toBeVisible();
    await page.getByTestId("side-menu-layer").getByRole("button", { name: "Настройки", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Профиль", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Звук/ }).first().click();

  // The contract is two absences, and an absence passes on a blank page as
  // happily as on the right one. So the screen is proved open first — the
  // section's own root, and the group the removed control used to sit beside.
  //
  // That anchor used to be the literal «Громкость», the heading of the box
  // D-149 emptied. `e9c2790f` then replaced the box with the captioned groups
  // this reads now, and the case went red while its two real assertions went
  // on passing — the exact shape D-210 is about. The words come from the
  // module the surface prints them from, so the anchor follows a rename
  // instead of going stale behind one; the two absences stay written out,
  // because they are the strings that must never come back.
  const panel = page.getByTestId("audio-settings");
  await expect(panel).toBeVisible();
  const levelGroup = panel.locator(`[data-audio-group="${AUDIO_GROUP_LEVEL}"]`);
  await expect(levelGroup).toBeVisible();
  await expect(panel.getByText(AUDIO_GAIN_LABEL, { exact: true })).toBeVisible();

  await expect(page.getByText("Голосовые сообщения", { exact: true })).toHaveCount(0);
  await expect(page.getByText("применяется только в LETSCUBE")).toHaveCount(0);

  // The section has to be on screen for the evidence to show anything: the
  // disclosure opens below the fold of a settings column.
  await levelGroup.scrollIntoViewIfNeeded();
  await expect(panel.getByText(AUDIO_INPUT_LABEL, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: shotPath(info, "sound-settings-light") });
  await stampTheme(page, "dark");
  await page.screenshot({ path: shotPath(info, "sound-settings-dark") });
});
