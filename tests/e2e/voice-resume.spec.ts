import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * Coming back to the voice channel you were taken out of (queue item 35, 2B).
 *
 * What is real and what is not, stated so no assertion is read as proving more
 * than it does. **Real:** the component that ships, `useVoiceCall`, a genuine
 * microphone from Chromium's fake capture device, and the gateway spoken to
 * over HTTP exactly as in production. **Stubbed:** the gateway's answers, and
 * the SFU through the DEV-only `window.__letscubeVoiceRoom` seam — the same
 * seam `voice-call.spec.ts` uses, with a smaller stand-in because what is under
 * test here is what happens around a call rather than inside one.
 *
 * The four contracts:
 *
 * **What the product took away, the product puts back.** A record stamped
 * `interrupted` returns by itself, with no press and nothing to dismiss.
 *
 * **What it did not take away is offered, never taken.** A record left by a
 * manual reload or a crash draws one button. Pressing it returns; ignoring it
 * costs nothing. This is the case the owner never asked for, and acting on it
 * would switch on a microphone nobody asked to have switched on (D-281).
 *
 * **The microphone travels, and it is in force before the first packet.**
 * Somebody who dropped muted comes back muted — and `setMuted` is called
 * *before* `join`, so they are not audible for the length of one event loop in
 * a room they did not choose to rejoin.
 *
 * **A drop is retried while the window is open.** `onClosed` is where a call
 * ends under its own transport, and before this nothing tried again.
 *
 * The window is five minutes and it is **ours**: LiveKit retains no participant
 * at all (`docs/operations/voice.md`), so no server number was available to
 * take. It equals the reconciler's reaper by design, not coincidence.
 */

test.use({
  launchOptions: {
    // A real audio track, without a microphone and without a prompt.
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const AT = "2026-09-13T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_ID = "22222222-2222-4222-8222-000000000001";
const CHANNEL_ID = "33333333-3333-4333-8333-000000000001";
const CHANNEL_NAME = "Общий";
const RESUME_KEY = "letscube:voice:resume";
const OUT = process.env.KUB_VOICE_RESUME_OUT ?? "output/voice-resume";
const WINDOW_MS = 5 * 60 * 1000;
const GRANT = {
  ok: true,
  url: "wss://voice.letscube.ru",
  room: `vc_${CHANNEL_ID}`,
  identity: ME.id,
  token: "livekit.join.token",
  canPublish: true,
};

type ResumeSeed = {
  userId: string;
  channelId: string;
  chatId: string;
  channelName: string;
  micMuted: boolean;
  at: number;
  cause: "interrupted" | "unplanned";
};

declare global {
  interface Window {
    __resumeProbe?: {
      /** One entry per `join` the transport was asked for. */
      joins: { token: string; muteBefore: boolean[] }[];
      /** Every `setMuted`, in order, across the whole page. */
      muted: boolean[];
      /** Make the next N transport joins fail after they were attempted. */
      failJoinsRemaining?: number;
      /** Ends the current call the way a dead transport does. */
      close?: () => void;
    };
  }
}

/**
 * The transport, reduced to what this spec needs.
 *
 * `close` is the point of it: `onClosed` is the one callback nothing in the
 * product used to answer, and it is how a call ends when the network goes
 * rather than when somebody presses «Выйти».
 */
const installVoiceRoom = () => {
  const probe: NonNullable<Window["__resumeProbe"]> = { joins: [], muted: [] };
  window.__resumeProbe = probe;
  window.__letscubeVoiceRoom = (events) => {
    probe.close = () => events.onClosed(null);
    return {
      async join(_url: string, token: string, microphone: MediaStreamTrack | null) {
        // The mutes seen *so far* are recorded with the join, which is how the
        // ordering is asserted: a self-mute applied after publishing would show
        // up as an empty array here and a `true` in `muted` afterwards.
        probe.joins.push({ token, muteBefore: [...probe.muted] });
        if ((probe.failJoinsRemaining ?? 0) > 0) {
          probe.failJoinsRemaining = (probe.failJoinsRemaining ?? 0) - 1;
          throw new Error("fixture transport refused this join");
        }
        if (microphone) events.onJoinStage("publish");
        events.onParticipants([
          { userId: "11111111-1111-4111-8111-000000000001", name: "", muted: false, canSpeak: true, audioSource: "microphone" },
        ]);
      },
      async setMuted(muted: boolean) {
        probe.muted.push(muted);
      },
      async setMicrophoneOpen() {},
      async setDeafened() {},
      async setParticipantVolume() {},
      async leave() {},
      async sampleHealth() {
        return null;
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
          roomName: `vc_${CHANNEL_ID}`,
          roomSid: "RM_fixture",
          serverRegion: null,
          serverNodeId: null,
          serverVersion: null,
          serverProtocol: null,
          connectionState: "connected",
          audioElements: 1,
          audioElementsPlaying: 1,
        };
      },
    } as unknown as ReturnType<NonNullable<Window["__letscubeVoiceRoom"]>>;
  };
};

async function openApp(page: Page, seed: ResumeSeed | null, path = "/") {
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(CHAT_ID, "group", "Команда", AT)],
    memberships: [membership(CHAT_ID, ME, "owner", AT), membership(CHAT_ID, ANNA, "member", AT)],
    messages: [message("m-1", CHAT_ID, ANNA, "Макет готов", AT)],
  });

  await page.route(/\/rest\/v1\/voice_channels/, (route) => {
    const request = route.request();
    const single = (request.headers().accept ?? "").includes("application/vnd.pgrst.object");
    const rows = [
      {
        id: CHANNEL_ID,
        chat_id: CHAT_ID,
        name: CHANNEL_NAME,
        participant_count: 0,
        max_participants: 10,
        archived: false,
      },
    ];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(single ? rows[0] : rows),
    });
  });
  await page.route(/\/rest\/v1\/voice_participants/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/functions/v1/voice-gateway/token", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GRANT) }),
  );

  await page.addInitScript(installVoiceRoom);
  if (seed) {
    await page.addInitScript(
      ([key, record]) => {
        try {
          window.localStorage.setItem(key as string, JSON.stringify(record));
        } catch {
          // A browser that cannot remember never returns, which the module
          // documents as the safe failure. Not this spec's case.
        }
      },
      [RESUME_KEY, seed] as const,
    );
  }
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

function seedFor(overrides: Partial<ResumeSeed> = {}): ResumeSeed {
  return {
    userId: ME.id,
    channelId: CHANNEL_ID,
    chatId: CHAT_ID,
    channelName: CHANNEL_NAME,
    micMuted: false,
    at: Date.now() - 30_000,
    cause: "interrupted",
    ...overrides,
  };
}

const joins = (page: Page) => page.evaluate(() => window.__resumeProbe?.joins ?? []);
const stored = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key), RESUME_KEY);

async function switchToAnna(page: Page, pressHeldOffer: boolean) {
  await page.route("**/auth/v1/user", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ...ANNA,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
    }),
  }));
  await page.evaluate(async ({ anna, pressHeld }) => {
    const held = document.querySelector<HTMLElement>('[data-testid="voice-resume-return"]');
    if (!held) throw new Error("The old account's offer was not mounted");
    // Model a switch whose profile is already present. `useUser` therefore
    // keeps loading=false, so the notice must be keyed by identity rather than
    // disappearing accidentally behind the loading screen.
    const { useAppStore } = await import("/src/store/app.store.ts");
    useAppStore.getState().setCurrentUser(anna);
    const { createClient } = await import("/src/lib/supabase/client.ts");
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: anna.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`;
    const result = await createClient().auth.setSession({
      access_token: token,
      refresh_token: "fixture-refresh",
    });
    if (result.error) throw new Error("Fixture identity change failed");
    if (pressHeld) {
      // Exercise the old closure even if React has already detached its element.
      held.click();
    }
  }, { anna: ANNA, pressHeld: pressHeldOffer });
}

test.describe("coming back to a voice channel", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("a call the product took away comes back by itself", async ({ page }) => {
    await openApp(page, seedFor({ cause: "interrupted" }));

    await expect.poll(async () => (await joins(page)).length, { timeout: 20_000 }).toBe(1);
    // Nothing was asked and nothing has to be dismissed.
    await expect(page.getByTestId("voice-resume-offer")).toHaveCount(0);
    // And it is visible: the bar that says a microphone is live is on screen.
    await expect(page.getByTestId("voice-call-bar")).toBeVisible();
  });

  for (const route of ["/login", "/register"] as const) {
    test(`a guest at ${route} never joins a saved call`, async ({ page }) => {
      await openApp(page, null);
      await page.evaluate(
        ([key, record]) => {
          localStorage.setItem(key as string, JSON.stringify(record));
          localStorage.removeItem("kub-auth");
        },
        [RESUME_KEY, seedFor({ cause: "interrupted" })] as const,
      );

      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await page.waitForTimeout(2_500);
      expect(await joins(page), "a guest resume attempt reached microphone capture").toEqual([]);
      await expect(page.getByTestId("voice-resume-offer")).toHaveCount(0);
    });
  }

  test("a record saved by another account cannot resume for the current account", async ({ page }) => {
    await openApp(page, seedFor({ userId: ANNA.id, cause: "interrupted" }));

    await page.waitForTimeout(2_500);
    expect(await joins(page), "another account's call was joined").toEqual([]);
    await expect(page.getByTestId("voice-resume-offer")).toHaveCount(0);
  });

  test("an account switch without a loading remount discards the old offer", async ({ page }) => {
    await openApp(page, seedFor({ cause: "unplanned" }));
    await expect(page.getByTestId("voice-resume-offer")).toBeVisible();

    await switchToAnna(page, false);

    await expect(page.getByTestId("voice-resume-offer")).toHaveCount(0);
    await page.waitForTimeout(2_500);
    expect(await joins(page), "the previous account's offer captured a microphone").toEqual([]);
  });

  test("an old offer callback cannot join after the authenticated account changes", async ({ page }) => {
    await openApp(page, seedFor({ cause: "unplanned" }));
    await expect(page.getByTestId("voice-resume-offer")).toBeVisible();

    await switchToAnna(page, true);

    await page.waitForTimeout(2_500);
    expect(await joins(page), "the previous account's held callback captured a microphone").toEqual([]);
  });

  test("opening a public page cannot boot-resume a stored call", async ({ page }) => {
    await openApp(page, seedFor({ cause: "interrupted" }), "/privacy");

    await expect(page).toHaveURL(/\/privacy$/);
    await page.waitForTimeout(2_500);
    expect(await joins(page), "a public-page boot captured the microphone").toEqual([]);
    await expect(page.getByTestId("voice-resume-offer")).toHaveCount(0);
  });

  test("somebody who dropped muted comes back muted, before the first packet", async ({ page }) => {
    await openApp(page, seedFor({ cause: "interrupted", micMuted: true }));

    await expect.poll(async () => (await joins(page)).length, { timeout: 20_000 }).toBe(1);
    const [first] = await joins(page);
    // The ordering is the assertion. A self-mute applied after `join` would
    // leave this array empty and put the `true` in `muted` afterwards — which
    // is being audible in a room nobody chose to rejoin, for one event loop.
    expect(first.muteBefore, "the mute was not in force before the track was published").toContain(true);
  });

  test("a call the product did not take away is offered, and returns on a press", async ({ page }) => {
    await openApp(page, seedFor({ cause: "unplanned" }));

    const offer = page.getByTestId("voice-resume-offer");
    await expect(offer).toBeVisible();
    await expect(offer).toContainText(CHANNEL_NAME);
    // The case the owner never asked for: nothing has happened yet.
    expect(await joins(page)).toEqual([]);

    await page.getByTestId("voice-resume-return").click();
    await expect.poll(async () => (await joins(page)).length, { timeout: 20_000 }).toBe(1);
    await expect(offer).toHaveCount(0);
  });

  for (const viewport of [
    { width: 390, height: 844, name: "390" },
    { width: 1440, height: 900, name: "1440" },
  ] as const) {
    for (const theme of ["dark", "light"] as const) {
      test(`the offer is photographed at ${viewport.name} in the ${theme} theme`, async ({ page }) => {
        // The owner judges a visual change by looking at it, and this is the
        // only thing 2B draws. The returning itself has no pixels of its own —
        // it is the call bar, which the product already photographs.
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openApp(page, seedFor({ cause: "unplanned" }));
        await expect(page.getByTestId("voice-resume-offer")).toBeVisible();
        await page.evaluate((value) => {
          const root = document.documentElement;
          root.classList.toggle("dark", value === "dark");
          root.classList.toggle("light", value === "light");
          root.setAttribute("data-theme", value as string);
          root.style.colorScheme = value as string;
        }, theme);
        await page.evaluate(() => document.fonts.ready);
        mkdirSync(OUT, { recursive: true });
        await page.screenshot({ path: `${OUT}/offer-${viewport.name}-${theme}.png`, animations: "disabled" });
      });
    }
  }

  for (const width of [390, 1440] as const) {
    test(`the offer covers nothing you could press, at ${width}`, async ({ page }) => {
      // D-264's lesson, applied to the one thing 2B draws. This offer is not a
      // toast: it has no dismiss and it stands for up to five minutes, so a
      // control underneath it is a control taken away for five minutes. Every
      // control of the chat list, the folder rail and the bottom bar is
      // hit-tested at its own centre — a box merely *drawn* over a button is
      // the same defect as one laid out over it.
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await openApp(page, seedFor({ cause: "unplanned" }));
      await expect(page.getByTestId("voice-resume-offer")).toBeVisible();
      // Without this the list has not rendered and the hit-test examines a page
      // with nothing on it — which passes, and proves nothing. Measured: the
      // first version of this test did exactly that while the offer was in fact
      // sitting on top of the first chat row.
      await expect(page.getByTestId("chat-list-item").first()).toBeVisible();

      const covered = await page.evaluate(() => {
        const notice = document.querySelector('[data-testid="voice-resume-offer"]');
        const blocked: string[] = [];
        const controls = document.querySelectorAll<HTMLElement>(
          '[data-testid="chat-list-item"], nav button, nav a[href], [data-testid="folder-tabs"] button, header button, button, a[href]',
        );
        for (const control of Array.from(controls)) {
          if (notice?.contains(control)) continue;
          const box = control.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          if (!hit || control === hit || control.contains(hit)) continue;
          if (!notice?.contains(hit)) continue;
          const name =
            control.getAttribute("aria-label") ?? control.textContent?.trim().slice(0, 28) ?? "control";
          blocked.push(name);
        }
        return blocked;
      });

      const examined = await page.evaluate(
        () =>
          document.querySelectorAll(
            '[data-testid="chat-list-item"], nav button, nav a[href], [data-testid="folder-tabs"] button, header button, button, a[href]',
          ).length,
      );
      // An empty answer from a selector that matched nothing is not a pass.
      expect(examined, "the hit-test found no controls to test").toBeGreaterThan(3);
      expect(covered, `the offer covers ${covered.length} control(s): ${covered.join(" | ")}`).toEqual([]);
    });
  }

  test("past the window nobody is returned and nothing is offered", async ({ page }) => {
    await openApp(page, seedFor({ cause: "interrupted", at: Date.now() - WINDOW_MS - 1000 }));

    await expect(page.getByTestId("voice-call-bar")).toHaveCount(0);
    await expect(page.getByTestId("voice-resume-offer")).toHaveCount(0);
    // Long enough for the boot effect and a retry timer to have run.
    await page.waitForTimeout(2500);
    expect(await joins(page), "a call was rejoined after its window had closed").toEqual([]);
  });

  test("a live call rewrites the record as its own, so the next reload only offers", async ({ page }) => {
    // The property that keeps «the product took it away» from becoming
    // permanent: the heartbeat stamps `unplanned` while the call is up, so an
    // interrupted record is spent by the return it caused.
    await openApp(page, seedFor({ cause: "interrupted" }));
    await expect.poll(async () => (await joins(page)).length, { timeout: 20_000 }).toBe(1);

    await expect
      .poll(async () => {
        const raw = await stored(page);
        return raw ? (JSON.parse(raw) as ResumeSeed).cause : null;
      }, { timeout: 20_000 })
      .toBe("unplanned");
  });

  test("a call that drops under its own transport is joined again", async ({ page }) => {
    await openApp(page, seedFor({ cause: "interrupted" }));
    await expect.poll(async () => (await joins(page)).length, { timeout: 20_000 }).toBe(1);
    // Wait for the record to belong to the live call rather than to the seed,
    // so what is retried below is the call this page is actually in.
    await expect
      .poll(async () => {
        const raw = await stored(page);
        return raw ? (JSON.parse(raw) as ResumeSeed).cause : null;
      }, { timeout: 20_000 })
      .toBe("unplanned");

    // The network goes. This is `onClosed`, the one callback nothing in the
    // product used to answer: it publishes `failed` and, before 2B, that was
    // the end of the call for good.
    await page.evaluate(() => window.__resumeProbe?.close?.());

    await expect
      .poll(async () => (await joins(page)).length, { timeout: 30_000, message: "the drop was never retried" })
      .toBe(2);
    await expect(page.getByTestId("voice-call-bar")).toBeVisible();
  });

  test("a failed first retry keeps the original window and a later retry succeeds", async ({ page }) => {
    await openApp(page, seedFor({ cause: "interrupted" }));
    await expect.poll(async () => (await joins(page)).length, { timeout: 20_000 }).toBe(1);
    await expect
      .poll(async () => {
        const raw = await stored(page);
        return raw ? (JSON.parse(raw) as ResumeSeed).cause : null;
      }, { timeout: 20_000 })
      .toBe("unplanned");
    const originalAt = await stored(page).then((raw) => (raw ? (JSON.parse(raw) as ResumeSeed).at : null));

    await page.evaluate(() => {
      if (window.__resumeProbe) window.__resumeProbe.failJoinsRemaining = 1;
      window.__resumeProbe?.close?.();
    });

    await expect.poll(async () => (await joins(page)).length, { timeout: 15_000 }).toBe(2);
    const afterFailedRetry = await stored(page);
    expect(afterFailedRetry).not.toBeNull();
    expect((JSON.parse(afterFailedRetry as string) as ResumeSeed).at).toBe(originalAt);

    await expect
      .poll(async () => (await joins(page)).length, { timeout: 30_000, message: "the later retry never ran" })
      .toBe(3);
    const after = await stored(page);
    expect(after).not.toBeNull();
    expect((JSON.parse(after as string) as ResumeSeed).at).toBeGreaterThanOrEqual(originalAt as number);
    await expect(page.getByTestId("voice-call-bar")).toBeVisible();
  });

  test("a live call that drops on a public route is joined again", async ({ page }) => {
    await openApp(page, seedFor({ cause: "interrupted" }));
    await expect.poll(async () => (await joins(page)).length, { timeout: 20_000 }).toBe(1);
    await expect
      .poll(async () => {
        const raw = await stored(page);
        return raw ? (JSON.parse(raw) as ResumeSeed).cause : null;
      }, { timeout: 20_000 })
      .toBe("unplanned");

    await page.evaluate(() => {
      history.pushState({}, "", "/privacy");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/privacy$/);
    await page.evaluate(() => window.__resumeProbe?.close?.());

    await expect
      .poll(async () => (await joins(page)).length, { timeout: 30_000, message: "the public-route drop was never retried" })
      .toBe(2);
  });

  test("returning from a public route does not turn its stored call into a new boot", async ({ page }) => {
    await openApp(page, seedFor({ cause: "interrupted" }), "/privacy");
    await expect(page).toHaveURL(/\/privacy$/);
    await page.waitForTimeout(1_000);
    await page.evaluate(() => {
      history.pushState({}, "", "/tasks");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/tasks$/);
    await page.waitForTimeout(1_500);

    expect(await joins(page), "route return was treated as another application boot").toEqual([]);
    await expect(page.getByTestId("voice-resume-offer")).toHaveCount(0);
  });
});
