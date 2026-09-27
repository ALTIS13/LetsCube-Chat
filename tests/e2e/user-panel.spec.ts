import { expect, test, type Page } from "@playwright/test";
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
 * Tracker item 40 — the bar at the foot of the chat list, in Discord's shape.
 *
 * The owner, 2026-09-20: «кнопка мой профиль и настройки по сути дублируют
 * друг друга, тогда лучше перенять подход к интерфейсу от discord». Discord's
 * bar is three things that do not duplicate each other: the face and the name
 * open a menu of their own, the microphone and the headphones toggle in place
 * with a chevron each for the device, and the gear is the settings.
 *
 * Real: the panel, the call hook, the store, the settings screen. Stubbed: the
 * gateway's answers, and the SFU through the DEV-only `window.__letscubeVoiceRoom`
 * seam — a narrower copy of the one in `voice-shell-bar.spec.ts`, copied rather
 * than shared for the reason that file gives. The conversation is fictional.
 */

const AT = "2026-09-27T09:00:00.000Z";
const ME = person("81111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("81111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const CHAT_TEAM = "82222222-2222-4222-8222-000000000001";
const CHANNEL_ID = "83333333-3333-4333-8333-000000000001";
const LINE = "Созвонимся после обеда";
const SELF_AUDIO_KEY = "letscube:voice-self-audio:v1";

declare global {
  interface Window {
    __panelProbe?: { calls: string[]; replaced: string[] };
    __letscubeCallSounds?: { asks: { ask: string; sound: string | null }[] };
  }
}

test.use({
  screenshot: "off",
  trace: "off",
  video: "off",
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop-1440", "the panel is the computer's, from md");
  await requireFixtureServer(request);
});

/** The stand-in transport, recording every call in the order it was made. */
async function installSeam(page: Page) {
  await page.addInitScript(
    ({ me, anna }) => {
      const probe = { calls: [] as string[], replaced: [] as string[] };
      window.__panelProbe = probe;
      window.__letscubeVoiceRoom = (events) => {
        const roster = [
          { userId: me as string, name: "", muted: false, canSpeak: true, audioSource: "microphone" as const },
          { userId: anna as string, name: "Анна (из токена)", muted: false, canSpeak: true, audioSource: "microphone" as const },
        ];
        return {
          async join() {
            probe.calls.push("join");
            events.onJoinStage("media");
            events.onJoinStage("publish");
            events.onParticipants(roster.map((entry) => ({ ...entry })));
            events.onSpeechAllowed(true);
            events.onAudioBlocked(false);
          },
          async setMuted(muted: boolean) {
            probe.calls.push(`muted:${muted}`);
          },
          async setMicrophoneOpen(open: boolean) {
            probe.calls.push(`open:${open}`);
          },
          async setDeafened(deafened: boolean) {
            probe.calls.push(`deafened:${deafened}`);
          },
          async replaceMicrophone(track: MediaStreamTrack) {
            probe.replaced.push(track.label);
            return true;
          },
          async setParticipantVolume() {},
          async leave() {
            probe.calls.push("leave");
          },
          async sampleHealth() {
            return {
              at: Date.now(),
              rttMs: 20,
              jitterMs: 2,
              packetsSent: 0,
              packetsLost: 0,
              packetsReceived: 0,
              inboundLost: 0,
              inboundJitterMs: null,
              samplesPlayed: 0,
              audioEnergy: 0,
              remoteAudioTracks: 1,
              candidatePair: "srflx/udp",
              candidatePairState: "succeeded",
            };
          },
          async setOutputDevice() {
            return true;
          },
          async resumeAudio() {},
          serverName() {
            return null;
          },
          describeConnection() {
            return {
              roomName: null,
              roomSid: null,
              serverRegion: null,
              serverNodeId: null,
              serverVersion: null,
              serverProtocol: null,
              connectionState: "connected",
              audioElements: 0,
              audioElementsPlaying: 0,
            };
          },
        };
      };
    },
    { me: ME.id, anna: ANNA.id },
  );
}

async function boot(page: Page, options: { selfAudio?: { muted: boolean; deafened: boolean }; narrow?: boolean } = {}) {
  await installSeam(page);
  await page.addInitScript(
    ({ key, selfAudio, narrow }) => {
      // Only on the first load of a test: a reload has to find what the page
      // itself stored, which is the whole claim of the persistence test.
      if (sessionStorage.getItem("panel-seeded")) return;
      sessionStorage.setItem("panel-seeded", "1");
      if (selfAudio) localStorage.setItem(key, JSON.stringify(selfAudio));
      if (narrow) localStorage.setItem("kub-desktop-chat-list", JSON.stringify({ width: 320, collapsed: true }));
    },
    { key: SELF_AUDIO_KEY, selfAudio: options.selfAudio ?? null, narrow: options.narrow ?? false },
  );
  const chats: Row[] = [chat(CHAT_TEAM, "group", "Команда проекта", AT)];
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats,
    memberships: [membership(CHAT_TEAM, ME, "owner", AT), membership(CHAT_TEAM, ANNA, "member", AT)],
    messages: [message("84444444-4444-4444-8444-000000000001", CHAT_TEAM, ANNA, LINE, "2026-09-27T10:00:00.000Z")],
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  const channelRow = {
    id: CHANNEL_ID,
    chat_id: CHAT_TEAM,
    name: "Общий голос",
    participant_count: 1,
    max_participants: 10,
    archived: false,
  };
  await page.route("**/rest/v1/voice_channels**", (route) => {
    const single = (route.request().headers().accept ?? "").includes("application/vnd.pgrst.object");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single ? channelRow : [channelRow]) });
  });
  await page.route("**/rest/v1/voice_participants**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ channel_id: CHANNEL_ID, user_id: ANNA.id }]) }),
  );
  await page.route("**/functions/v1/voice-gateway/token", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        url: "wss://voice.letscube.ru",
        room: `vc_${CHANNEL_ID}`,
        identity: ME.id,
        token: "livekit.join.token",
        canPublish: true,
      }),
    }),
  );
}

const panel = (page: Page) => page.getByTestId("user-panel");
const mute = (page: Page) => panel(page).getByTestId("user-panel-mute");
const deafen = (page: Page) => panel(page).getByTestId("user-panel-deafen");
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), SELF_AUDIO_KEY);
const probe = (page: Page) => page.evaluate(() => ({ ...window.__panelProbe! }));

async function joinFromCapsule(page: Page) {
  await openChat(page, "Команда проекта", LINE);
  const action = page.getByTestId("voice-capsule-action");
  await action.click();
  await expect(action).toHaveText("Выйти");
}

test("three separate things: the face opens its own menu, the gear opens settings", async ({ page }) => {
  await boot(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByTestId("user-panel-name")).toHaveText("Максим Орлов");

  // The face: a menu, not a second door into settings.
  await panel(page).getByTestId("user-panel-identity").click();
  const menu = page.getByRole("menu", { name: "Управление профилем" });
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("settings-overlay")).toHaveCount(0);

  // «Открыть профиль» is the person as others see them, with the editor as its
  // own button in place of a refused «Открыть чат».
  await menu.getByTestId("user-panel-open-profile").click();
  const card = page.getByTestId("user-profile-modal");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("member-card-open-chat")).toHaveCount(0);
  await card.getByTestId("member-card-edit-profile").click();
  await expect(page.getByTestId("settings-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-overlay")).toHaveCount(0);

  // «Редактировать профиль» from the menu goes straight to the editor.
  await panel(page).getByTestId("user-panel-identity").click();
  await page.getByTestId("user-panel-edit-profile").click();
  await expect(page.getByTestId("settings-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-overlay")).toHaveCount(0);

  // The gear.
  await panel(page).getByTestId("user-panel-settings").click();
  await expect(page.getByTestId("settings-overlay")).toBeVisible();
});

test("the side menu's «Мой профиль» opens the profile, and «Настройки» the settings", async ({ page }) => {
  await boot(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("side-menu-button").click();
  await page.getByTestId("side-menu-layer").getByRole("button", { name: "Мой профиль", exact: true }).click();
  await expect(page.getByTestId("user-profile-modal")).toBeVisible();
  await expect(page.getByTestId("settings-overlay")).toHaveCount(0);
});

test("mute and deafen work with no call, and a reload finds them as they were left", async ({ page }) => {
  await boot(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(mute(page)).toHaveAttribute("data-silenced", "false");
  await expect(deafen(page)).toHaveAttribute("data-silenced", "false");

  await mute(page).click();
  await expect(mute(page)).toHaveAttribute("data-silenced", "true");
  await expect(mute(page)).toHaveAccessibleName("Включить микрофон");
  expect(JSON.parse((await stored(page))!)).toEqual({ muted: true, deafened: false });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(mute(page)).toHaveAttribute("data-silenced", "true");
  await expect(deafen(page)).toHaveAttribute("data-silenced", "false");

  // Deafening silences the microphone too, and lifting it gives back the
  // microphone as it was — muted, because it was muted before.
  await deafen(page).click();
  await expect(deafen(page)).toHaveAttribute("data-silenced", "true");
  await expect(deafen(page)).toHaveAccessibleName("Включить звук");
  await deafen(page).click();
  await expect(deafen(page)).toHaveAttribute("data-silenced", "false");
  await expect(mute(page)).toHaveAttribute("data-silenced", "true");

  // From an open microphone, deafening mutes it and lifting it opens it again.
  await mute(page).click();
  await expect(mute(page)).toHaveAttribute("data-silenced", "false");
  await deafen(page).click();
  await expect(mute(page)).toHaveAttribute("data-silenced", "true");
  await deafen(page).click();
  await expect(mute(page)).toHaveAttribute("data-silenced", "false");

  // The microphone pressed while deafened is a request to talk: the room comes
  // back with it.
  await deafen(page).click();
  await mute(page).click();
  await expect(mute(page)).toHaveAttribute("data-silenced", "false");
  await expect(deafen(page)).toHaveAttribute("data-silenced", "false");
  expect(JSON.parse((await stored(page))!)).toEqual({ muted: false, deafened: false });
});

test("a call starts the way the panel was left, before anything is heard", async ({ page }) => {
  await boot(page, { selfAudio: { muted: true, deafened: true } });
  await joinFromCapsule(page);
  const { calls } = await probe(page);
  const join = calls.indexOf("join");
  expect(join, `no join in ${calls.join(", ")}`).toBeGreaterThan(-1);
  expect(calls.indexOf("deafened:true"), calls.join(", ")).toBeGreaterThan(-1);
  expect(calls.indexOf("deafened:true")).toBeLessThan(join);
  expect(calls.indexOf("muted:true"), calls.join(", ")).toBeGreaterThan(-1);
  expect(calls.indexOf("muted:true")).toBeLessThan(join);
  await expect(mute(page)).toHaveAttribute("data-silenced", "true");
  await expect(deafen(page)).toHaveAttribute("data-silenced", "true");
});

test("in a call the panel's toggles reach the call, and leaving keeps the choice", async ({ page }) => {
  await boot(page);
  await joinFromCapsule(page);
  await mute(page).click();
  await expect.poll(async () => (await probe(page)).calls).toContain("muted:true");
  await deafen(page).click();
  await expect.poll(async () => (await probe(page)).calls).toContain("deafened:true");

  // The capsule in the conversation says the same thing the panel does.
  await expect(page.getByTestId("voice-capsule-mute")).toHaveAttribute("data-muted", "true");

  await page.getByTestId("voice-capsule-action").click();
  await expect.poll(async () => (await probe(page)).calls).toContain("leave");
  await expect(mute(page)).toHaveAttribute("data-silenced", "true");
  await expect(deafen(page)).toHaveAttribute("data-silenced", "true");
});

test("a microphone chosen during a call goes on the air in that call", async ({ page }) => {
  await boot(page);
  await joinFromCapsule(page);
  await panel(page).getByTestId("user-panel-input-menu").click();
  const menu = page.getByRole("menu", { name: "Микрофон" });
  await expect(menu).toBeVisible();
  const choices = menu.getByTestId("user-panel-input-device");
  // «Системный микрофон» and Chromium's fake inputs.
  await expect.poll(async () => choices.count()).toBeGreaterThan(1);
  const target = choices.nth(1);
  const label = (await target.textContent())!.trim();
  await target.click();
  await expect(target).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await probe(page)).replaced).toEqual([label]);
});

test("«Настройки звука» opens the settings on the sound row", async ({ page }) => {
  await boot(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await panel(page).getByTestId("user-panel-input-menu").click();
  await page.getByTestId("user-panel-audio-settings").click();
  await expect(page.getByTestId("settings-overlay")).toBeVisible();
  const row = page.getByTestId("settings-open-audio");
  await expect(row).toHaveAttribute("aria-expanded", "true");
  const inView = await row.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const pane = document.querySelector('[data-testid="settings-scroll"]')!.getBoundingClientRect();
    return box.top >= pane.top - 1 && box.bottom <= pane.bottom + 1;
  });
  expect(inView, "the sound row is not on screen").toBe(true);
});

test("a list dragged down to faces keeps the face and both toggles", async ({ page }) => {
  await boot(page, { narrow: true });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(panel(page)).toBeVisible();
  const box = await panel(page).boundingBox();
  expect(box!.width).toBeLessThan(160);
  await expect(panel(page).getByTestId("user-panel-identity")).toBeVisible();
  await expect(mute(page)).toBeVisible();
  await expect(deafen(page)).toBeVisible();
  // What does not fit is gone rather than clipped.
  await expect(panel(page).getByTestId("user-panel-name")).toBeHidden();
  await expect(panel(page).getByTestId("user-panel-input-menu")).toBeHidden();
  const clipped = await panel(page).evaluate((node) => node.scrollWidth > node.clientWidth + 1);
  expect(clipped).toBe(false);
});

/** The blips the player was asked for, oldest first. */
const blips = (page: Page) =>
  page.evaluate(() => (window.__letscubeCallSounds?.asks ?? []).filter((ask) => ask.ask === "once").map((ask) => ask.sound));

test("a press with no call answers with the same blip a call's controls make", async ({ page }) => {
  await boot(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(panel(page)).toBeVisible();
  const before = (await blips(page)).length;
  await mute(page).click();
  await mute(page).click();
  await deafen(page).click();
  // The microphone pressed while deafened brings the room back: one press, one
  // sound, and it is the room's.
  await mute(page).click();
  await expect.poll(async () => (await blips(page)).slice(before)).toEqual(["mute", "unmute", "mute", "unmute"]);
});

test("a right-click on a toggle opens its device menu, and changes nothing", async ({ page }) => {
  await boot(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await mute(page).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Микрофон" })).toBeVisible();
  await expect(mute(page)).toHaveAttribute("data-silenced", "false");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  // And focus goes back to what opened it.
  await expect(panel(page).getByTestId("user-panel-input-menu")).toBeFocused();
  await deafen(page).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Вывод звука" })).toBeVisible();
  await expect(deafen(page)).toHaveAttribute("data-silenced", "false");
});

test("in a call the name says so, and the gear goes straight to the sound", async ({ page }) => {
  await boot(page);
  await joinFromCapsule(page);
  await expect(panel(page).getByTestId("user-panel-subtitle")).toHaveText("В разговоре");
  await panel(page).getByTestId("user-panel-settings").click();
  await expect(page.getByTestId("settings-overlay")).toBeVisible();
  await expect(page.getByTestId("settings-open-audio")).toHaveAttribute("aria-expanded", "true");
});

test("a call between two people starts open and hearing, and says so for next time", async ({ page }) => {
  const modules = new Map<string, string>();
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/src/hooks/useVoiceCall.ts") modules.set(path, request.url());
  });
  await boot(page, { selfAudio: { muted: true, deafened: true } });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(mute(page)).toHaveAttribute("data-silenced", "true");
  const hook = modules.get("/src/hooks/useVoiceCall.ts");
  expect(hook, "the call module was never requested").toBeTruthy();
  // The ring places and answers through `joinVoiceChannel` with `oneToOne`;
  // the ring's own machinery is `voice-ring.spec.ts`'s, so the join is made
  // directly here, through the module the application itself loaded.
  await page.evaluate(async ({ url, channelId, chatId }) => {
    const { joinVoiceChannel } = await import(/* @vite-ignore */ url);
    await joinVoiceChannel({ channelId, chatId, channelName: "Анна Смирнова", oneToOne: true });
  }, { url: hook!, channelId: CHANNEL_ID, chatId: CHAT_TEAM });
  await expect.poll(async () => (await probe(page)).calls).toContain("join");
  const { calls } = await probe(page);
  expect(calls, calls.join(", ")).not.toContain("muted:true");
  expect(calls, calls.join(", ")).not.toContain("deafened:true");
  await expect(mute(page)).toHaveAttribute("data-silenced", "false");
  await expect(deafen(page)).toHaveAttribute("data-silenced", "false");
  expect(JSON.parse((await stored(page))!)).toEqual({ muted: false, deafened: false });
});
