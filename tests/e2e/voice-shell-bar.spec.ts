import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * The running call, on the screens that are not the messenger.
 *
 * Asked for by the owner on 2026-09-19, the evening two people first heard each
 * other in a channel: a small panel on every screen, to mute and to see the
 * connection without going back into the conversation. No register number —
 * D-260 onwards were taken the same day by another track, and claiming one
 * without filing it would leave a reference pointing at somebody else's defect.
 *
 * `tests/unit/voice-shell-bar.test.mts` holds the rule — which locations draw a
 * bar of their own and which need the shell's. What is measured here is
 * everything a pure function cannot see:
 *
 *  - that the bar actually appears on «Мои боты», where before this change a
 *    call ran with nothing on screen about it;
 *  - that it appears **from the conversation the call is in**, which is the
 *    case that nearly shipped broken: `selectedChatId` is remembered rather
 *    than visible, so the rule's «the capsule is already there» test was still
 *    true on a page that has no capsule;
 *  - that its controls reach the same transport the capsule's do, from there;
 *  - that the page shortens to make room rather than being covered by it, and
 *    gets every pixel back when the call ends;
 *  - that «Состояние связи» is readable without going back into the chat,
 *    which is the half of the owner's request the bar never had.
 *
 * Real: the components that ship, the hook that ships, the store that ships.
 * Stubbed: the gateway's answers, and the SFU through the DEV-only
 * `window.__letscubeVoiceRoom` seam. The stand-in below is a narrower copy of
 * the one in `voice-call.spec.ts` — copied rather than shared, because that
 * file is not this change's to refactor, which is the same call
 * `installRenderCounter` records making for the same reason.
 */

const AT = "2026-09-13T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";
const CHANNEL_ID = "33333333-3333-4333-8333-000000000001";
const LINE = "Макет главной готов, посмотрите";
const GRANT = {
  ok: true,
  url: "wss://voice.letscube.ru",
  room: `vc_${CHANNEL_ID}`,
  identity: ME.id,
  token: "livekit.join.token",
  canPublish: true,
};

declare global {
  interface Window {
    __shellProbe?: { muted: boolean[]; left: number };
  }
}

/** Chromium only: WebKit in this checkout ships no WebRTC, as D-062 records. */
function needsWebRtc(browserName: string) {
  test.skip(browserName === "webkit", "WebKit here has no WebRTC");
}

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

/**
 * A stand-in transport, and the one interesting thing in it is `sampleHealth`.
 *
 * `health: "starved"` answers a connection whose outgoing half is flawless and
 * whose incoming half has stopped: `packetsSent` climbing, `packetsReceived`
 * frozen with a remote track still published. That is the exact shape that read
 * as «Связь стабильна» until 2026-09-19, and it is what the third screenshot
 * below has to show the bar reporting.
 */
async function installSeam(page: Page, health: "good" | "starved") {
  await page.addInitScript(
    ({ me, anna, mode }) => {
      const held = { muted: [] as boolean[], left: 0 };
      window.__shellProbe = held;
      let sent = 0;
      let received = 0;
      window.__letscubeVoiceRoom = (events) => {
        const roster = [
          { userId: me as string, name: "", muted: false, canSpeak: true, audioSource: "microphone" as const },
          { userId: anna as string, name: "Анна (из токена)", muted: false, canSpeak: true, audioSource: "microphone" as const },
        ];
        return {
          async join() {
            events.onJoinStage("media");
            events.onJoinStage("publish");
            events.onParticipants(roster.map((entry) => ({ ...entry })));
            events.onSpeechAllowed(true);
            events.onAudioBlocked(false);
          },
          async setMuted(muted: boolean) {
            held.muted.push(muted);
          },
          async setMicrophoneOpen() {},
          async setDeafened() {},
          async setParticipantVolume() {},
          async leave() {
            held.left += 1;
          },
          async sampleHealth() {
            sent += 50;
            // Frozen for «starved», climbing for a healthy call.
            if (mode === "good") received += 50;
            return {
              at: Date.now(),
              rttMs: mode === "good" ? 19 : 22,
              jitterMs: 2,
              packetsSent: sent,
              packetsLost: 0,
              packetsReceived: received,
              inboundLost: 0,
              inboundJitterMs: mode === "good" ? 3 : null,
              samplesPlayed: 48000 * (sent / 50),
              audioEnergy: mode === "good" ? sent / 50 : 0,
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
            return "helsinki-3";
          },
          describeConnection() {
            return {
              roomName: `vc_${"33333333-3333-4333-8333-000000000001"}`,
              roomSid: "RM_fixture",
              serverRegion: "helsinki",
              serverNodeId: "3",
              serverVersion: "1.9.0",
              serverProtocol: 15,
              connectionState: "connected",
              audioElements: 1,
              audioElementsPlaying: mode === "good" ? 1 : 0,
            };
          },
        };
      };
    },
    { me: ME.id, anna: ANNA.id, mode: health },
  );
}

async function open(
  page: Page,
  seed: { theme?: "dark" | "light"; health?: "good" | "starved" } = {},
) {
  await installSeam(page, seed.health ?? "good");
  const chats: Row[] = [chat(CHAT_TEAM, "group", "Команда проекта", AT)];
  const memberships: Row[] = [
    membership(CHAT_TEAM, ME, "owner", AT),
    membership(CHAT_TEAM, ANNA, "member", AT),
  ];
  const messages: Row[] = [
    message("55555555-5555-4555-8555-000000000001", CHAT_TEAM, ME, LINE, "2026-09-13T10:00:00.000Z"),
  ];
  await openFixture(page, {
    me: ME,
    chats,
    memberships,
    messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });

  /**
   * **After `openFixture`, and that is the whole of it.**
   *
   * The fixture registers an init script of its own that writes
   * `kub-theme: "dark"`, and init scripts run in the order they were added. A
   * theme set before it is overwritten a moment later — which is not a failure
   * anything reports: the run stays green and every «light» photograph comes
   * back dark. Caught here by hashing the files rather than by reading them:
   * six pairs, each pair byte-identical.
   */
  if (seed.theme) {
    await page.addInitScript(
      (value) => localStorage.setItem("kub-theme", value as string),
      seed.theme,
    );
  }

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
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(single ? channelRow : [channelRow]),
    });
  });
  await page.route("**/rest/v1/voice_participants**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ channel_id: CHANNEL_ID, user_id: ANNA.id }]),
    }),
  );
  await page.route("**/functions/v1/voice-gateway/token", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GRANT) }),
  );

  await openChat(page, "Команда проекта", LINE);
}

const bar = (page: Page) => page.locator('[data-testid="voice-call-bar"]:visible');
const action = (page: Page) => page.getByTestId("voice-capsule-action");

/** Join the room the way a person does, from the conversation's own capsule. */
async function join(page: Page) {
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
}

/**
 * Walk to «Мои боты» through the application's own menu.
 *
 * Not `history.pushState`: the claim is that somebody in a call can reach
 * another page and still have the call, and a navigation the product does not
 * offer proves nothing about that. On a phone the chat list is a pane rather
 * than a column, so the conversation has to be closed first — which is itself
 * the journey being described.
 */
async function goToBots(page: Page) {
  // Two different controls carry this label and exactly one of them is ever on
  // screen: the folder rail's `side-menu-button`, which opens `SideMenuLayer`
  // from `md` up, and `SidebarHeader`'s dropdown, which is `md:hidden`. Asking
  // for the visible one is what makes this helper work at both widths.
  const menu = page.locator('[aria-label="Меню"]:visible');
  if ((await menu.count()) === 0) {
    await page.getByTestId("chat-control-row").getByLabel("Назад").click();
    await expect(menu).toHaveCount(1);
  }
  await menu.click();
  await page.getByText("Мои боты", { exact: true }).click();
  await expect(page.getByTestId("bots-page")).toBeVisible();
}

test("a call stays on screen after walking out of the messenger", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page);
  await join(page);
  // The premise: in the call's own conversation the capsule speaks for it and
  // the bar stands down. Asserted so the appearance below is a change of state
  // rather than a bar that was there all along.
  await expect(bar(page)).toHaveCount(0);

  await goToBots(page);

  // The whole point. Before this change `MainLayout` was unmounted here and
  // with it both of the bar's mounts, so a running microphone had nothing on
  // screen about it.
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).getByTestId("voice-call-bar-room")).toHaveText("Общий голос");
  await expect(bar(page).getByTestId("voice-call-bar-state")).toHaveText("Вы в разговоре");

  // And it is the shell's mount rather than a stray one from the messenger.
  await expect(bar(page)).toHaveAttribute("data-placement", "top");
  await expect(page.getByTestId("voice-call-shell")).toBeVisible();

  // The state fits its own box here too. `toHaveText` reads `textContent`,
  // which is the same string whether or not the box can show it — the check
  // that caught «Вы в разг…» in the column.
  const clipped = await bar(page).evaluate((node) => {
    const found = node.querySelector('[data-testid="voice-call-bar-state"]');
    return found ? { scroll: found.scrollWidth, client: found.clientWidth } : null;
  });
  expect(clipped, "the state has no box of its own").not.toBeNull();
  expect(clipped!.scroll).toBeLessThanOrEqual(clipped!.client + 1);

  // The controls reach the same transport the capsule's do.
  await bar(page).getByTestId("voice-call-bar-mute").click();
  await expect
    .poll(async () => page.evaluate(() => window.__shellProbe?.muted ?? []))
    .toEqual([true]);
  await expect(bar(page).getByTestId("voice-call-bar-state")).toHaveText("Микрофон выключен");

  await bar(page).getByTestId("voice-call-bar-leave").click();
  await expect.poll(async () => page.evaluate(() => window.__shellProbe?.left ?? 0)).toBe(1);
  await expect(bar(page)).toHaveCount(0);
});

test("the page gives up room for the bar and gets all of it back", async ({
  page,
  browserName,
}, info: TestInfo) => {
  needsWebRtc(browserName);
  await open(page);
  await join(page);
  await goToBots(page);

  const measure = () =>
    page.evaluate(() => {
      const page_ = document.querySelector('[data-testid="bots-page"]')!.getBoundingClientRect();
      const found = document.querySelector('[data-testid="voice-call-bar"]');
      const band = found ? found.getBoundingClientRect() : null;
      return {
        pageTop: Math.round(page_.top),
        pageBottom: Math.round(page_.bottom),
        barBottom: band ? Math.round(band.bottom) : null,
        barHeight: band ? Math.round(band.height) : 0,
        viewport: window.innerHeight,
      };
    });

  const during = await measure();
  // A band with height, not a zero-height element that happens to exist.
  expect(during.barHeight).toBeGreaterThan(24);
  // The page starts where the bar ends: it is pushed down, never covered.
  expect(during.pageTop).toBe(during.barBottom);
  // And it ends at the bottom of the screen rather than past it — which is the
  // failure a band above an `h-app` page produces: the document becomes one bar
  // taller than the window and the page's last row goes off the end.
  expect(during.pageBottom).toBe(during.viewport);

  await bar(page).getByTestId("voice-call-bar-leave").click();
  await expect(bar(page)).toHaveCount(0);

  const after = await measure();
  // Every pixel back, and no band of the application's own ground left in the
  // shape of the bar — the 2026-09-12 defect, measured rather than looked at.
  expect(after.pageTop).toBe(0);
  expect(after.pageBottom).toBe(after.viewport);

  // The same page with no call, as the baseline every «is this mine?» question
  // about these photographs gets answered against. «Мои боты» arrives at 390
  // with its own title already truncated to «М..»; this shot is what says that
  // is the page's and not the band's.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `output/voice-shell-bar/${info.project.name}-no-call.png` });
});

test("«Состояние связи» is readable without going back into the chat", async ({
  page,
  browserName,
}) => {
  needsWebRtc(browserName);
  // The connection whose outgoing half is perfect and whose incoming half has
  // stopped — the shape the owner sat in on 2026-09-19 hearing nothing.
  await open(page, { health: "starved" });
  await join(page);
  await goToBots(page);

  const panel = page.getByTestId("voice-call-bar-health-panel");
  await expect(panel).toHaveCount(0);

  const control = bar(page).getByTestId("voice-call-bar-health");
  await expect(control).toHaveAttribute("aria-expanded", "false");
  await control.click();
  await expect(panel).toBeVisible();
  await expect(control).toHaveAttribute("aria-expanded", "true");

  // The readings are the panel that ships, not a second copy of it.
  await expect(panel.getByTestId("voice-connection-panel")).toBeVisible();
  // And it reports the fault rather than the flawless outbound numbers beside
  // it. This is the assertion that makes the panel worth reaching from here.
  await expect
    .poll(
      async () =>
        panel.getByTestId("voice-connection-panel").getAttribute("data-voice-verdict"),
      { timeout: 15_000 },
    )
    .toBe("not_receiving");

  // It opens away from the edge the bar is docked to. A band across the top
  // opens downward; the chat list's foot opens upward, and there is no room
  // below it at all.
  const room = await page.evaluate(() => {
    const bandNode = document.querySelector('[data-testid="voice-call-bar"]')!;
    const panelNode = document.querySelector('[data-testid="voice-call-bar-health-panel"]')!;
    const band = bandNode.getBoundingClientRect();
    const open = panelNode.getBoundingClientRect();
    return {
      barBottom: band.bottom,
      barWidth: band.width,
      panelTop: open.top,
      panelBottom: open.bottom,
      panelWidth: open.width,
      // Whether the readings fit the box they are in, which is a different
      // question from whether the box fits the window — and the one that was
      // actually wrong: a 384-point cap cut the fault's own sentence in half
      // at 390 while every assertion here stayed green.
      scrollHeight: panelNode.scrollHeight,
      clientHeight: panelNode.clientHeight,
      viewport: window.innerHeight,
    };
  });
  expect(room.panelTop).toBeGreaterThanOrEqual(room.barBottom - 1);
  // On screen, whole. A panel whose foot is past the window is a panel whose
  // advice nobody reads.
  expect(room.panelBottom).toBeLessThanOrEqual(room.viewport + 1);
  expect(room.scrollHeight, "the readings are clipped inside their own panel").toBeLessThanOrEqual(
    room.clientHeight + 1,
  );
  // A column of its own on a wide screen rather than the whole band: a table
  // stretched across 1440 points puts each label and its value a window apart.
  if (room.barWidth > 640) {
    expect(room.panelWidth).toBeLessThanOrEqual(room.barWidth / 2);
  }

  // The same control closes it, as the capsule's does.
  await control.click();
  await expect(panel).toHaveCount(0);
});

test("the shell draws no second band in the messenger", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page);
  await join(page);
  // In the call's own conversation the capsule speaks for it and nothing else
  // does — the rule renders `null`, so there is no element at all.
  await expect(page.locator('[data-testid="voice-call-bar"]')).toHaveCount(0);

  // Leaving the conversation brings the messenger's own bar back. Exactly one,
  // and it is **not** the shell's: the band the shell reserves is empty on `/`,
  // because `MainLayout` and `Sidebar` already carry the bar between them.
  // Without the rule in `lib/voiceShellBar.ts` there would be a second band
  // above the panes here, drawn at the same moment as the column's.
  // Escape closes the conversation at every width — `MainLayout` runs that
  // handler on `window` in the capture phase — where «Назад» is `md:hidden`
  // and would only work on a phone.
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(1);
  await expect(
    page.locator('[data-testid="voice-call-shell-band"] [data-testid="voice-call-bar"]'),
  ).toHaveCount(0);
});

for (const theme of ["dark", "light"] as const) {
  test(`public routes keep the running microphone reachable, ${theme}`, async ({ page, browserName }, info) => {
    needsWebRtc(browserName);
    await open(page, { theme });
    await join(page);
    await goToBots(page);
    for (const path of ["/bots/docs", "/privacy", "/support", "/download"]) {
      // Same SPA navigation used by a notification targeting /support.
      // The documentation link itself opens a separate tab, not this journey.
      await page.evaluate((url) => window.history.pushState(null, "", url), path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      const publicPage = page.getByTestId("public-scroll-root");
      await expect(publicPage).toBeVisible();
      await expect(bar(page)).toHaveCount(1);
      await expect(bar(page).getByTestId("voice-call-bar-state")).toHaveText("Вы в разговоре");
      await bar(page).getByTestId("voice-call-bar-mute").click();
      await expect(bar(page).getByTestId("voice-call-bar-state")).toHaveText("Микрофон выключен");
      await expect.poll(() => page.evaluate(() => window.__shellProbe?.muted.at(-1))).toBe(true);
      await expect.poll(() => page.evaluate(() => {
        const raw = localStorage.getItem("letscube:voice:resume");
        return raw ? JSON.parse(raw).micMuted : null;
      })).toBe(true);

      const layout = await publicPage.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const band = document.querySelector('[data-testid="voice-call-bar"]')!.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, barBottom: band.bottom, viewport: innerHeight };
      });
      expect(layout.top).toBeCloseTo(layout.barBottom, 0);
      expect(layout.bottom).toBeCloseTo(layout.viewport, 0);
      // Scrolling a long document must not take the microphone control away.
      await publicPage.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await expect(bar(page).getByTestId("voice-call-bar-mute")).toBeInViewport();
      await expect(publicPage.locator("footer")).toBeInViewport();
      await publicPage.evaluate((node) => { node.scrollTop = 0; });
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      await page.screenshot({ path: `output/voice-shell-bar/${info.project.name}-${theme}-${path.replaceAll("/", "-")}.png` });
      await bar(page).getByTestId("voice-call-bar-mute").click();
    }

    await expect.poll(() => page.evaluate(() => window.__shellProbe?.left)).toBe(0);
    await bar(page).getByTestId("voice-call-bar-leave").click();
    await expect.poll(() => page.evaluate(() => window.__shellProbe?.left)).toBe(1);
    await expect(bar(page)).toHaveCount(0);
    const after = await page.getByTestId("public-scroll-root").boundingBox();
    expect(after!.y).toBe(0);
    expect(after!.height).toBe(page.viewportSize()!.height);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("letscube:voice:resume"))).toBeNull();
  });
}

test("the public call bar returns to the conversation without restarting it", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page);
  await join(page);
  await page.evaluate(() => window.history.pushState(null, "", "/privacy"));
  await expect(bar(page)).toHaveCount(1);
  await bar(page).getByTestId("voice-call-bar-open").click();
  await expect(page).toHaveURL(new RegExp(`/chat/${CHAT_TEAM}$`));
  await expect(action(page)).toHaveText("Выйти");
  await expect(bar(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__shellProbe?.left)).toBe(0);
  await action(page).click();
  await expect(page.getByTestId("voice-resume-offer")).toHaveCount(0);
});

for (const destination of [`/chat/${CHAT_TEAM}`, "/tasks"]) {
  test(`a loading ${destination} keeps call controls and fits the remaining viewport`, async ({ page, browserName }) => {
    needsWebRtc(browserName);
    const modules = new Map<string, string>();
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (["/src/lib/supabase/client.ts", "/src/store/app.store.ts"].includes(path)) {
        modules.set(path, request.url());
      }
    });
    await open(page);
    await join(page);
    await page.evaluate(() => history.pushState(null, "", "/privacy"));
    await expect(bar(page)).toBeVisible();
    let release!: () => void;
    let profileReads = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/rest/v1/profiles**", async (route) => {
      const request = route.request();
      const query = new URL(request.url()).searchParams;
      if (request.method() !== "GET" || query.get("id") !== `eq.${ME.id}` || query.get("select") !== "*") {
        await route.fallback();
        return;
      }
      profileReads += 1;
      await gate;
      await route.fallback();
    });
    try {
      await page.evaluate((path) => history.pushState(null, "", path), destination);
      const loading = page.locator(".kub-grid-bg").filter({ hasText: "Загрузка" });
      // Navigation now retains the root observer: it must not reload a profile.
      if (destination.startsWith("/chat/")) await expect(action(page)).toHaveText("Выйти");
      else await expect(bar(page)).toBeVisible();
      await expect(loading).toHaveCount(0);
      expect(profileReads).toBe(0);

      // Exercise a real auth/profile loading transition separately, with the
      // same account and a blocked fixture response, not a second useUser mount.
      const client = modules.get("/src/lib/supabase/client.ts");
      const store = modules.get("/src/store/app.store.ts");
      expect(client && store).toBeTruthy();
      await page.evaluate(async ({ client, store, userId }) => {
        const { createClient } = await import(/* @vite-ignore */ client!);
        const { useAppStore } = await import(/* @vite-ignore */ store!);
        useAppStore.getState().setCurrentUser(null);
        const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
        const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`;
        const result = await createClient().auth.setSession({ access_token: token, refresh_token: "fixture-refresh" });
        if (result.error) throw new Error("Fixture profile refresh failed");
      }, { client, store, userId: ME.id });
      await expect.poll(() => profileReads).toBe(1);
      await expect(loading).toBeVisible();
      await expect(bar(page)).toHaveCount(1);
      await bar(page).getByTestId("voice-call-bar-mute").click();
      await expect(bar(page).getByTestId("voice-call-bar-state")).toHaveText("Микрофон выключен");
      const bounds = await loading.boundingBox();
      const band = await bar(page).boundingBox();
      expect(bounds!.y).toBeCloseTo(band!.y + band!.height, 0);
      expect(bounds!.y + bounds!.height).toBeCloseTo(page.viewportSize()!.height, 0);
    } finally {
      release();
    }
    await expect(page.getByText("Загрузка", { exact: true })).toHaveCount(0);
    if (destination.startsWith("/chat/")) {
      await expect(action(page)).toHaveText("Выйти");
      await expect(bar(page)).toHaveCount(0);
    } else {
      await expect(bar(page)).toHaveCount(1);
    }
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`Windows caption never covers call controls on public pages, ${theme}`, async ({ page, browserName }, info) => {
    needsWebRtc(browserName);
    await page.addInitScript(() => {
      const quiet = async () => undefined;
      window.letscubeDesktop = {
        platform: "windows", version: "0.2.14", build: 18,
        isMaximized: async () => false, minimize: quiet, toggleMaximize: quiet,
        closeToTray: quiet, startDragging: quiet,
        isMainForeground: async () => true, notify: async () => false,
      } as unknown as NonNullable<Window["letscubeDesktop"]>;
    });
    await open(page, { theme });
    await expect(page.locator("html")).toHaveAttribute("data-desktop-shell", "windows");
    await join(page);
    await goToBots(page);
    const chrome = page.getByTestId("desktop-window-chrome");
    const control = bar(page).getByTestId("voice-call-bar-mute");
    const caption = await chrome.boundingBox();
    const mic = await control.boundingBox();
    expect(mic!.y).toBeGreaterThanOrEqual(caption!.y + caption!.height);
    await control.click();
    for (const path of ["/privacy", "/support", "/download", "/bots/docs"]) {
      await page.evaluate((url) => history.pushState(null, "", url), path);
      await expect(chrome).toHaveCount(1);
      await expect(chrome).toBeVisible();
      await expect(control).toBeVisible();
      // Locator.click checks that another element does not intercept the target.
      await control.click();
      const layout = await page.getByTestId("public-scroll-root").boundingBox();
      expect(layout!.y + layout!.height).toBeCloseTo(page.viewportSize()!.height, 0);
    }
    await page.screenshot({ path: `output/voice-shell-bar/${info.project.name}-windows-${theme}.png` });
    await bar(page).getByTestId("voice-call-bar-leave").click();
    await expect(bar(page)).toHaveCount(0);
    await expect(chrome).toHaveCount(1);
    const headerLink = page.getByRole("navigation", { name: "Публичные страницы" }).getByRole("link", { name: "Войти" });
    expect((await headerLink.boundingBox())!.y).toBeGreaterThanOrEqual(caption!.height);
    expect((await page.getByTestId("public-scroll-root").boundingBox())!.y).toBe(0);
  });
}

test("a public page never restores a microphone from a saved call", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page);
  await page.addInitScript(({ channelId, chatId }) => {
    localStorage.removeItem("kub-auth");
    localStorage.setItem("letscube:voice:resume", JSON.stringify({
      channelId, chatId, channelName: "Общий голос", micMuted: false,
      at: Date.now(), cause: "interrupted",
    }));
  }, { channelId: CHANNEL_ID, chatId: CHAT_TEAM });
  let joins = 0;
  await page.route("**/functions/v1/voice-gateway/token", (route) => {
    joins += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GRANT) });
  });
  for (const path of ["/privacy", "/support", "/download", "/bots/docs"]) {
    await page.goto(path);
    await expect(page.getByTestId("public-scroll-root")).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    await expect(page.getByTestId("voice-resume-offer")).toHaveCount(0);
  }
  expect(joins).toBe(0);
});

/**
 * The photographs. Three states, because they are the three a person is in:
 * the call running, the microphone off, and the connection reporting a fault.
 */
for (const theme of ["dark", "light"] as const) {
  for (const state of ["rest", "muted", "unhealthy"] as const) {
    test(`the shell bar on «Мои боты», ${state}, ${theme}`, async ({ page, browserName }, info: TestInfo) => {
      needsWebRtc(browserName);
      await open(page, { theme, health: state === "unhealthy" ? "starved" : "good" });
      // The theme this photograph claims to be of, read off the document.
      // Without this the pair comes back byte-identical and the run stays
      // green — see the note beside where the theme is set.
      await expect
        .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
        .toBe(theme);
      await join(page);
      await goToBots(page);
      await expect(bar(page)).toBeVisible();

      if (state === "muted") {
        await bar(page).getByTestId("voice-call-bar-mute").click();
        await expect(bar(page).getByTestId("voice-call-bar-state")).toHaveText("Микрофон выключен");
      }
      if (state === "unhealthy") {
        await bar(page).getByTestId("voice-call-bar-health").click();
        await expect
          .poll(
            async () =>
              page
                .getByTestId("voice-connection-panel")
                .getAttribute("data-voice-verdict"),
            { timeout: 15_000 },
          )
          .toBe("not_receiving");
      }

      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `output/voice-shell-bar/${info.project.name}-${theme}-${state}.png`,
      });
    });
  }
}

// Auth boundaries use fake microphone tracks and a transport probe, never captures.
const authBoundaryTest = test.extend({
  screenshot: "off",
  trace: "off",
  video: "off",
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--mute-audio"],
  },
});

authBoundaryTest.describe("voice auth boundary", () => {
  type Delay = "none" | "microphone" | "token" | "transport" | "leave";

  async function prepare(page: Page, delay: Delay = "none") {
    const modules = new Map<string, string>();
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (["/src/hooks/useVoiceCall.ts", "/src/hooks/useVoiceRing.ts", "/src/lib/supabase/client.ts", "/src/store/app.store.ts"].includes(path)) {
        modules.set(path, request.url());
      }
    });
    await open(page);
    const urls = {
      call: modules.get("/src/hooks/useVoiceCall.ts")!,
      ring: modules.get("/src/hooks/useVoiceRing.ts")!,
      client: modules.get("/src/lib/supabase/client.ts")!,
      store: modules.get("/src/store/app.store.ts")!,
    };
    expect(Object.values(urls).every(Boolean)).toBe(true);
    const rpcReasons: unknown[] = [];
    await page.route("**/rest/v1/rpc/voice_call_stop", (route) => {
      rpcReasons.push(route.request().postDataJSON()?.p_reason);
      return route.fulfill({ status: 200, contentType: "application/json", body: '"idle"' });
    });
    await page.route("**/rest/v1/rpc/voice_call_ring", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify([{ channel_id: CHANNEL_ID, ring_started_at: new Date().toISOString() }]),
    }));

    await page.evaluate(({ delayed, urls }) => {
      const probe = {
        tracks: [] as MediaStreamTrack[], joins: 0, left: 0, connected: false,
        waiting: false, release: () => {}, done: false, completed: 0, foreignResumeWrites: 0,
      };
      (window as unknown as Record<string, unknown>).__authVoiceProbe = probe;
      const wait = () => new Promise<void>((resolve) => {
        probe.waiting = true;
        probe.release = resolve;
      });
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await capture(constraints);
        probe.tracks.push(...stream.getTracks());
        if (delayed === "microphone") await wait();
        return stream;
      };
      const factory = window.__letscubeVoiceRoom!;
      window.__letscubeVoiceRoom = (events) => {
        const transport = factory(events);
        return {
          ...transport,
          async join(...args: Parameters<typeof transport.join>) {
            probe.joins += 1;
            probe.connected = true;
            if (delayed === "transport") await wait();
            await transport.join(...args);
            probe.connected = true;
          },
          async leave() {
            probe.left += 1;
            probe.connected = false;
            if (delayed === "leave" && !probe.waiting) await wait();
            await transport.leave();
          },
        };
      };
      if (delayed === "token") {
        const fetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const response = await fetch(input, init);
          const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
          if (path.endsWith("/voice-gateway/token") && !probe.waiting) {
            const body = await response.text();
            response.json = async () => { await wait(); return JSON.parse(body); };
          }
          return response;
        };
      }
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "letscube:voice:resume" && JSON.parse(value).userId !== "11111111-1111-4111-8111-000000000001") {
          probe.foreignResumeWrites += 1;
        }
        setItem.call(this, key, value);
      };
      (window as unknown as Record<string, unknown>).__authVoiceUrls = urls;
    }, { delayed: delay, urls });
    return { urls, rpcReasons };
  }

  async function probe(page: Page) {
    return page.evaluate(async () => {
      const { call } = (window as unknown as { __authVoiceUrls: { call: string } }).__authVoiceUrls;
      const { voiceCallSnapshot } = await import(/* @vite-ignore */ call);
      const state = (window as unknown as { __authVoiceProbe: {
        tracks: MediaStreamTrack[]; joins: number; left: number; connected: boolean; waiting: boolean; done: boolean;
        completed: number; foreignResumeWrites: number;
      } }).__authVoiceProbe;
      return {
        phase: voiceCallSnapshot().phase, acquiredTracks: state.tracks.length,
        liveTracks: state.tracks.filter((track) => track.readyState === "live").length,
        joins: state.joins, left: state.left, connected: state.connected, waiting: state.waiting, done: state.done,
        completed: state.completed, foreignResumeWrites: state.foreignResumeWrites,
        resumeUserId: JSON.parse(localStorage.getItem("letscube:voice:resume") ?? "null")?.userId ?? null,
      };
    });
  }

  async function authEvent(page: Page, kind: "logout" | "switch" | "same-user" | "initial-unknown") {
    if (kind === "switch" || kind === "same-user") {
      const user = kind === "switch" ? ANNA : ME;
      await page.route("**/auth/v1/user", (route) => route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ...user, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} }),
      }));
      await page.route("**/rest/v1/profiles**", (route) => {
        if (new URL(route.request().url()).searchParams.get("id") !== `eq.${user.id}`) return route.fallback();
        const single = route.request().headers().accept?.includes("application/vnd.pgrst.object");
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single ? user : [user]) });
      });
    }
    await page.evaluate(async ({ event, other, self }) => {
      const { client } = (window as unknown as { __authVoiceUrls: { client: string } }).__authVoiceUrls;
      const { createClient } = await import(/* @vite-ignore */ client);
      const auth = createClient().auth;
      if (event === "logout") {
        const result = await auth.signOut();
        if (result.error) throw new Error("Fixture signout failed");
      } else if (event === "initial-unknown") {
        // SDK event seam: no local cached session is not an explicit signout.
        await auth._notifyAllSubscribers("INITIAL_SESSION", null);
      } else {
        const id = event === "switch" ? other : self;
        const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
        const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`;
        const result = await auth.setSession({ access_token: token, refresh_token: "fixture-refresh" });
        if (result.error) throw new Error("Fixture identity change failed");
      }
    }, { event: kind, other: ANNA.id, self: ME.id });
  }

  async function start(page: Page, kind: "group" | "private") {
    await page.evaluate(async ({ kind, channelId, chatId }) => {
      const urls = (window as unknown as { __authVoiceUrls: { call: string; ring: string } }).__authVoiceUrls;
      const { joinVoiceChannel } = await import(/* @vite-ignore */ urls.call);
      const { startVoiceRing } = await import(/* @vite-ignore */ urls.ring);
      const pending = kind === "private"
        ? startVoiceRing({ chatId, who: "Fixture caller" })
        : joinVoiceChannel({ channelId, chatId, channelName: "Общий голос" });
      void pending.finally(() => {
        const probe = (window as unknown as { __authVoiceProbe: { done: boolean; completed: number } }).__authVoiceProbe;
        probe.done = true;
        probe.completed += 1;
      });
    }, { kind, channelId: CHANNEL_ID, chatId: CHAT_TEAM });
  }

  for (const event of ["logout", "switch"] as const) {
    authBoundaryTest(`a group call releases transport and microphone on ${event} from privacy`, async ({ page }) => {
      const { rpcReasons } = await prepare(page);
      await join(page);
      await expect.poll(async () => (await probe(page)).liveTracks).toBe(1);
      await expect.poll(async () => (await probe(page)).resumeUserId).toBe(ME.id);
      await page.evaluate(() => history.pushState(null, "", "/privacy"));
      await expect(page.getByTestId("public-scroll-root")).toBeVisible();
      await authEvent(page, event);
      await expect.poll(async () => (await probe(page)).phase, { timeout: 2000 }).toBe("idle");
      expect(await probe(page)).toMatchObject({ liveTracks: 0, connected: false, left: 1, resumeUserId: null, foreignResumeWrites: 0 });
      expect(await page.evaluate(() => localStorage.getItem("letscube:voice:resume"))).toBeNull();
      expect(rpcReasons).toEqual([]);
    });
  }

  for (const kind of ["group", "private"] as const) {
    for (const delay of ["microphone", "token", "transport"] as const) {
      authBoundaryTest(`a pending ${kind} ${delay} cannot revive after auth invalidation`, async ({ page }) => {
        const { rpcReasons } = await prepare(page, delay);
        await start(page, kind);
        await expect.poll(async () => (await probe(page)).waiting).toBe(true);
        await page.evaluate(() => history.pushState(null, "", "/privacy"));
        await expect(page.getByTestId("public-scroll-root")).toBeVisible();
        await authEvent(page, kind === "private" ? "switch" : "logout");
        await expect.poll(async () => (await probe(page)).phase, { timeout: 2000 }).toBe("idle");
        if (delay === "transport") expect((await probe(page)).connected).toBe(false);
        if (delay !== "microphone") expect((await probe(page)).liveTracks).toBe(0);
        await page.evaluate(() => {
          (window as unknown as { __authVoiceProbe: { release(): void } }).__authVoiceProbe.release();
        });
        await expect.poll(async () => (await probe(page)).done).toBe(true);
        expect(await probe(page)).toMatchObject({ phase: "idle", liveTracks: 0, connected: false, resumeUserId: null });
        expect(await page.evaluate(() => localStorage.getItem("letscube:voice:resume"))).toBeNull();
        expect(rpcReasons).toEqual([]);
      });
    }
  }

  authBoundaryTest("same-user refresh and route navigation keep the group microphone", async ({ page }) => {
    await prepare(page);
    await join(page);
    await page.evaluate(() => history.pushState(null, "", "/privacy"));
    await expect(page.getByTestId("public-scroll-root")).toBeVisible();
    await authEvent(page, "same-user");
    await page.evaluate(() => history.pushState(null, "", "/support"));
    await expect(page.getByTestId("public-scroll-root")).toBeVisible();
    expect(await probe(page)).toMatchObject({ phase: "connected", liveTracks: 1, connected: true, left: 0 });
  });

  authBoundaryTest("unresolved auth is not an explicit logout", async ({ page }) => {
    const { urls } = await prepare(page);
    await join(page);
    await page.evaluate(async (url) => {
      const { observeVoiceCallAuth } = await import(/* @vite-ignore */ url);
      observeVoiceCallAuth({ userId: null, loading: true });
    }, urls.call);
    expect(await probe(page)).toMatchObject({ phase: "connected", liveTracks: 1, connected: true, left: 0, resumeUserId: ME.id });
  });

  authBoundaryTest("terminal auth shutdown clears resume before returning", async ({ page }) => {
    const { urls } = await prepare(page);
    await join(page);
    await expect.poll(async () => (await probe(page)).resumeUserId).toBe(ME.id);
    const afterBoundary = await page.evaluate(async ({ url, userId }) => {
      const { observeVoiceCallAuth, voiceCallSnapshot } = await import(/* @vite-ignore */ url);
      observeVoiceCallAuth({ userId, loading: true });
      // Same stack: no React effect or transport completion may be required.
      return { phase: voiceCallSnapshot().phase, retained: localStorage.getItem("letscube:voice:resume") !== null };
    }, { url: urls.call, userId: ANNA.id });
    expect(afterBoundary).toEqual({ phase: "idle", retained: false });
  });

  authBoundaryTest("an old token continuation cannot stop the new identity's microphone", async ({ page }) => {
    const { rpcReasons } = await prepare(page, "token");
    await start(page, "group");
    await expect.poll(async () => (await probe(page)).waiting).toBe(true);
    await page.evaluate(() => history.pushState(null, "", "/privacy"));
    await authEvent(page, "switch");
    await expect.poll(async () => (await probe(page)).phase).toBe("idle");
    await start(page, "group");
    await expect.poll(async () => (await probe(page)).phase).toBe("connected");
    expect((await probe(page)).liveTracks).toBe(1);
    await page.evaluate(() => {
      (window as unknown as { __authVoiceProbe: { release(): void } }).__authVoiceProbe.release();
    });
    await expect.poll(async () => (await probe(page)).completed).toBe(2);
    expect(await probe(page)).toMatchObject({ phase: "connected", liveTracks: 1, connected: true, left: 0 });
    expect(rpcReasons).toEqual([]);
  });

  authBoundaryTest("a replacement join cannot acquire a microphone after identity changed during leave", async ({ page }) => {
    const { rpcReasons } = await prepare(page, "leave");
    await start(page, "group");
    await expect.poll(async () => (await probe(page)).phase).toBe("connected");
    await start(page, "group");
    await expect.poll(async () => (await probe(page)).waiting).toBe(true);
    await page.evaluate(() => history.pushState(null, "", "/privacy"));
    await authEvent(page, "switch");
    await page.evaluate(() => {
      (window as unknown as { __authVoiceProbe: { release(): void } }).__authVoiceProbe.release();
    });
    await expect.poll(async () => (await probe(page)).completed).toBe(2);
    expect(await probe(page)).toMatchObject({ phase: "idle", acquiredTracks: 1, liveTracks: 0, joins: 1, connected: false, resumeUserId: null });
    expect(rpcReasons).toEqual([]);
  });

  for (const rpc of ["voice_call_ring", "voice_call_answer"] as const) {
    authBoundaryTest(`a delayed ${rpc} cannot start a call under another identity`, async ({ page }) => {
      const { urls, rpcReasons } = await prepare(page);
      let waiting = false;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      await page.route(`**/rest/v1/rpc/${rpc}`, async (route) => {
        waiting = true;
        await gate;
        await route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify(rpc === "voice_call_ring"
            ? [{ channel_id: CHANNEL_ID, ring_started_at: new Date().toISOString() }]
            : new Date().toISOString()),
        });
      });
      if (rpc === "voice_call_ring") {
        await start(page, "private");
      } else {
        await page.evaluate(async ({ ring, channelId, chatId, caller }) => {
          const { answerVoiceRing } = await import(/* @vite-ignore */ ring);
          void answerVoiceRing({ channelId, chatId, name: "Звонок", caller, startedAt: Date.now(), answeredAt: null, participantCount: 1 }, "Fixture caller")
            .finally(() => { (window as unknown as { __authVoiceProbe: { done: boolean } }).__authVoiceProbe.done = true; });
        }, { ring: urls.ring, channelId: CHANNEL_ID, chatId: CHAT_TEAM, caller: ANNA.id });
      }
      await expect.poll(() => waiting).toBe(true);
      await authEvent(page, "switch");
      await expect.poll(() => page.evaluate(async (url) => {
        const { useAppStore } = await import(/* @vite-ignore */ url);
        return useAppStore.getState().currentUser?.id;
      }, urls.store)).toBe(ANNA.id);
      await expect(page.getByTestId("desktop-app-shell")).toBeVisible();
      release();
      await expect.poll(async () => (await probe(page)).done).toBe(true);
      expect(await probe(page)).toMatchObject({ phase: "idle", joins: 0, acquiredTracks: 0, liveTracks: 0, connected: false });
      expect(rpcReasons).toEqual([]);
    });
  }

  authBoundaryTest("an old cancel response cannot erase the new identity's ring or transport", async ({ page }) => {
    const { urls } = await prepare(page);
    await start(page, "private");
    await expect.poll(async () => (await probe(page)).phase).toBe("connected");
    let waiting = false;
    let release!: () => void;
    const reasons: unknown[] = [];
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/rest/v1/rpc/voice_call_stop", async (route) => {
      reasons.push(route.request().postDataJSON()?.p_reason);
      waiting = true;
      await gate;
      await route.fulfill({ status: 200, contentType: "application/json", body: '"idle"' });
    });
    await page.evaluate(async (url) => {
      const { cancelVoiceRing, voiceRingsSnapshot } = await import(/* @vite-ignore */ url);
      const ring = voiceRingsSnapshot()[0];
      if (!ring) throw new Error("Fixture caller ring missing");
      void cancelVoiceRing(ring).finally(() => { (window as unknown as Record<string, unknown>).__oldCancelDone = true; });
    }, urls.ring);
    await expect.poll(() => waiting).toBe(true);
    await authEvent(page, "switch");
    await expect.poll(() => page.evaluate(async (url) => {
      const { useAppStore } = await import(/* @vite-ignore */ url);
      return useAppStore.getState().currentUser?.id;
    }, urls.store)).toBe(ANNA.id);
    await expect.poll(async () => (await probe(page)).phase).toBe("idle");
    await start(page, "private");
    await expect.poll(async () => (await probe(page)).phase).toBe("connected");
    release();
    await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__oldCancelDone)).toBe(true);
    expect(await probe(page)).toMatchObject({ phase: "connected", liveTracks: 1, connected: true });
    expect(await page.evaluate(async (url) => {
      const { voiceRingsSnapshot } = await import(/* @vite-ignore */ url);
      return voiceRingsSnapshot().map((row: { caller: string }) => row.caller);
    }, urls.ring)).toEqual([ANNA.id]);
    expect(reasons).toEqual(["cancelled"]);
  });
});
