import { expect, test, type Page, type TestInfo } from "@playwright/test";
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
 * Voice channels, slice 2, in a browser — the client half only.
 *
 * What is real here and what is not, stated up front so no assertion below is
 * read as proving more than it does.
 *
 * **Real:** the components that ship, the hook that ships, a genuine microphone
 * from Chromium's fake capture device, the browser's own permission failure,
 * and the gateway spoken to over HTTP exactly as it is spoken to in production.
 *
 * **Stubbed:** the gateway's answers (route mocks — the Edge Function exists but
 * nothing is deployed to answer at `127.0.0.1:54321`), and the SFU itself,
 * through the DEV-only `window.__letscubeVoiceRoom` seam in `hooks/voiceRoom.ts`.
 * There is no LiveKit server this spec may connect to and no token it may mint,
 * so what a room does when it is really joined is not proved here. What *is*
 * proved is everything between the press and the transport, which is the whole
 * of the client half.
 *
 * Everything runs on the message-actions fixture — fictional people, a mocked
 * backend, no production screen.
 */

test.use({
  launchOptions: {
    // A real audio track, without a microphone and without a prompt. The same
    // two switches `video-message.spec.ts` and `camera-capture.spec.ts` use.
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const AT = "2026-09-13T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const PETR = person("11111111-1111-4111-8111-000000000003", "Пётр Ильин");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";
const CHAT_OTHER = "22222222-2222-4222-8222-000000000002";
const CHANNEL_ID = "33333333-3333-4333-8333-000000000001";
const OTHER_CHANNEL_ID = "33333333-3333-4333-8333-000000000002";
const LINE = "Макет главной готов, посмотрите";
const OTHER_LINE = "Смета на витрину готова, посмотри";
const GRANT = { ok: true, url: "wss://voice.letscube.ru", room: `vc_${CHANNEL_ID}`, identity: ME.id, token: "livekit.join.token", canPublish: true };

interface Seed {
  /** Whether this account is in the group at all. A non-member gets no row. */
  member?: boolean;
  /** This account's role in the group. Only an administrator may start or end a voice chat. */
  role?: "owner" | "admin" | "member";
  /** The channel row, or none at all. */
  channel?: { participantCount: number; maxParticipants?: number } | null;
  /** Who the table says is in the channel. */
  present?: string[];
  /** What the gateway answers. */
  token?: { status: number; body: unknown };
}

function rows(seed: Seed): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  const team = [membership(CHAT_TEAM, ANNA, "owner", AT), membership(CHAT_TEAM, PETR, "member", AT)];
  if (seed.member !== false) team.unshift(membership(CHAT_TEAM, ME, seed.role ?? "member", AT));
  return {
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT), chat(CHAT_OTHER, "group", "Смета и склад", AT)],
    memberships: [...team, membership(CHAT_OTHER, ME, "owner", AT), membership(CHAT_OTHER, ANNA, "member", AT)],
    messages: [
      message("55555555-5555-4555-8555-000000000001", CHAT_TEAM, ME, LINE, "2026-09-13T10:00:00.000Z"),
      message("55555555-5555-4555-8555-000000000002", CHAT_OTHER, ANNA, OTHER_LINE, "2026-09-13T10:05:00.000Z"),
    ],
  };
}

/** What the SFU seam recorded, read back from the page. */
interface VoiceProbe {
  joins: { url: string; token: string; hasTrack: boolean }[];
  muted: boolean[];
  left: number;
  /** `enabled` and `readyState` of the track actually handed to the transport. */
  track: { enabled: boolean; readyState: string; kind: string } | null;
}

declare global {
  interface Window {
    __voiceProbe?: {
      joins: { url: string; token: string; hasTrack: boolean }[];
      muted: boolean[];
      left: number;
      track: MediaStreamTrack | null;
    };
  }
}

async function probe(page: Page): Promise<VoiceProbe> {
  return page.evaluate(() => {
    const held = window.__voiceProbe;
    const track = held?.track ?? null;
    return {
      joins: held?.joins ?? [],
      muted: held?.muted ?? [],
      left: held?.left ?? 0,
      track: track ? { enabled: track.enabled, readyState: track.readyState, kind: track.kind } : null,
    };
  });
}

/**
 * The SFU seam, installed before anything loads.
 *
 * Its `setMuted` does the one thing `livekit-client`'s own `LocalAudioTrack.mute()`
 * does to the capture — `mediaStreamTrack.enabled = false` — so that every
 * assertion about muting below reads the **real** track this browser captured
 * rather than the array of calls this stub kept. That the SDK's `mute()` does
 * that is checked separately, against the SDK itself, in the last test.
 */
async function installVoiceSeam(page: Page) {
  await page.addInitScript(
    ({ me, anna }) => {
      const held: NonNullable<Window["__voiceProbe"]> = { joins: [], muted: [], left: 0, track: null };
      window.__voiceProbe = held;
      const roster = (muted: boolean) => [
        { userId: me, name: "", muted },
        { userId: anna, name: "Анна (из токена)", muted: false },
      ];
      window.__letscubeVoiceRoom = (events) => ({
        async join(url: string, token: string, microphone: MediaStreamTrack | null) {
          held.joins.push({ url, token, hasTrack: Boolean(microphone) });
          held.track = microphone;
          events.onParticipants(roster(false));
        },
        async setMuted(muted: boolean) {
          held.muted.push(muted);
          if (held.track) held.track.enabled = !muted;
          events.onParticipants(roster(muted));
        },
        async leave() {
          held.left += 1;
        },
      });
    },
    { me: ME.id, anna: ANNA.id },
  );
}

/** The theme, stamped the way `applyResolvedTheme` stamps it (see group-settings.spec.ts). */
async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
}

async function open(page: Page, seed: Seed = {}) {
  await installVoiceSeam(page);
  const data = rows(seed);
  await openFixture(page, {
    me: ME,
    chats: data.chats,
    memberships: data.memberships,
    messages: data.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });

  // Registered after `openFixture`, which is what makes them win: Playwright
  // checks route handlers in the reverse order they were added. The shared
  // fixture answers every unknown table with an empty array, so without these
  // the voice tables would simply look empty rather than mocked.
  const channel = seed.channel === undefined ? { participantCount: 0 } : seed.channel;
  /**
   * The team's channel is **mutable**, because the panel can now make one and
   * delete one. A fixed answer would have let an insert report success while
   * every later read still said the group had no channel, which is the one
   * thing these tests are here to catch.
   */
  let team: { id: string; name: string; count: number; max: number } | null = channel
    ? { id: CHANNEL_ID, name: "Общий голос", count: channel.participantCount, max: channel.maxParticipants ?? 10 }
    : null;
  const writes: { method: string; body: Record<string, unknown> | null; search: string }[] = [];
  const asRow = (entry: NonNullable<typeof team>) => ({
    id: entry.id,
    name: entry.name,
    participant_count: entry.count,
    max_participants: entry.max,
  });

  // Each chat gets its **own** channel, keyed off the `chat_id` filter the hook
  // sends. One row for both would have made the second conversation's capsule
  // believe the call was in its channel, which is the opposite of what the
  // «другой голосовой канал» branch is there to say.
  await page.route(/\/rest\/v1\/voice_channels/, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    // `.select(…).maybeSingle()` asks for an object rather than an array, and a
    // client handed the wrong shape reads it as «no row» — which is exactly the
    // branch the panel turns into «Недостаточно прав».
    const single = (request.headers().accept ?? "").includes("application/vnd.pgrst.object");
    const answer = (found: unknown[], status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(single ? found[0] ?? null : found),
      });

    if (method === "POST") {
      let body: Record<string, unknown> | null = null;
      try {
        body = request.postDataJSON() as Record<string, unknown>;
      } catch {
        body = null;
      }
      writes.push({ method, body, search: url.search });
      const made = {
        id: body?.chat_id === CHAT_TEAM ? CHANNEL_ID : OTHER_CHANNEL_ID,
        name: String(body?.name ?? "Общий голос"),
        count: 0,
        max: Number(body?.max_participants ?? 10),
      };
      if (body?.chat_id === CHAT_TEAM) team = made;
      return answer([asRow(made)], 201);
    }

    if (method === "DELETE") {
      writes.push({ method, body: null, search: url.search });
      const removed = team;
      team = null;
      return answer(removed ? [asRow(removed)] : []);
    }

    const filter = url.searchParams.get("chat_id") ?? "";
    if (filter.endsWith(CHAT_TEAM)) return answer(team ? [asRow(team)] : []);
    return answer(
      channel
        ? [{
            id: OTHER_CHANNEL_ID,
            name: "Склад",
            participant_count: 0,
            max_participants: channel.maxParticipants ?? 10,
          }]
        : [],
    );
  });
  await page.route(/\/rest\/v1\/voice_participants/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify((seed.present ?? []).map((user_id) => ({ user_id }))),
    }),
  );

  const tokenCalls: unknown[] = [];
  await page.route("**/functions/v1/voice-gateway/token", (route) => {
    try {
      tokenCalls.push(route.request().postDataJSON());
    } catch {
      tokenCalls.push(null);
    }
    const answer = seed.token ?? { status: 200, body: GRANT };
    return route.fulfill({
      status: answer.status,
      contentType: "application/json",
      body: JSON.stringify(answer.body),
    });
  });

  await openChat(page, "Команда проекта", LINE);
  return { tokenCalls, writes };
}

/**
 * Another conversation, without leaving the application.
 *
 * `openChat` calls `page.goto("/")`, which is a reload — and a reload ends a
 * call, as it ends everything else. The claim being tested is narrower and more
 * useful: that unmounting `ChatWindow` and its whole subtree does not touch the
 * connection. So this clicks the chat list the way a person does, and goes back
 * to it first on a phone, where the list is a pane rather than a column.
 */
async function switchChat(page: Page, chatName: string, text: string) {
  const row = page.getByTestId("chat-list-item").filter({ hasText: chatName });
  if (!(await row.isVisible().catch(() => false))) {
    await page.getByTestId("chat-control-row").getByLabel("Назад").click();
    await expect(row).toBeVisible();
  }
  await row.click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: text })).toBeVisible();
}

const capsule = (page: Page) => page.getByTestId("voice-capsule");
const detail = (page: Page) => page.getByTestId("voice-capsule-detail");
const action = (page: Page) => page.getByTestId("voice-capsule-action");

async function openInfo(page: Page) {
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
}

test("a member of the group is offered the channel, its people and the way in", async ({ page }) => {
  await open(page, { channel: { participantCount: 2 }, present: [ANNA.id, PETR.id] });
  await openInfo(page);

  const row = page.getByTestId("chat-info-voice");
  await expect(row).toBeVisible();
  await expect(page.getByTestId("chat-info-voice-name")).toHaveText("Общий голос");
  await expect(page.getByTestId("chat-info-voice-occupancy")).toHaveText("2 из 10");
  // The people are named from the chat's own member list, not from the table,
  // which carries user ids and nothing else.
  await expect(page.getByTestId("chat-info-voice-participant-name")).toHaveText([
    "Анна Смирнова",
    "Пётр Ильин",
  ]);
  await expect(page.getByTestId("chat-info-voice-join")).toBeVisible();

  // And the same channel under the chat header, before anyone joins.
  await expect(capsule(page)).toBeVisible();
  await expect(page.getByTestId("voice-capsule-title")).toHaveText("Общий голос");
  await expect(detail(page)).toHaveText("2 из 10");
  await expect(action(page)).toHaveText("Присоединиться");
});

test("an onlooker who is not in the group is offered nothing", async ({ page }) => {
  // The channel row exists and the mock returns it — RLS would not, but the
  // interface must not depend on the database refusing. This is the rule in
  // `voiceChannelRowOffer` reaching the DOM.
  await open(page, { member: false, channel: { participantCount: 1 }, present: [ANNA.id] });
  await openInfo(page);
  await expect(page.getByTestId("chat-info-voice")).toHaveCount(0);
});

test("a group with no voice channel shows no row and no capsule", async ({ page }) => {
  await open(page, { channel: null });
  await expect(capsule(page)).toHaveCount(0);
  await openInfo(page);
  await expect(page.getByTestId("chat-info-voice")).toHaveCount(0);
});

/* -------------------------------------------------------------------------- */
/* Starting a voice chat and ending it. None of these joins a call, so none of  */
/* them needs WebRTC and every one runs on every project.                       */
/* -------------------------------------------------------------------------- */

/** The confirmation, as `KubModal` portals it to the body. */
const endDialog = (page: Page) => page.locator('[role="dialog"][aria-modal="true"]');

test("an administrator of a group without a voice chat is offered to start one", async ({ page }) => {
  await open(page, { role: "owner", channel: null });
  await openInfo(page);

  // The section exists for a group that has no channel at all now — before this
  // there was nothing here, and a voice channel could only be turned on with
  // SQL against production.
  await expect(page.getByTestId("chat-info-voice")).toBeVisible();
  await expect(page.getByTestId("chat-info-voice-start")).toHaveText("Начать голосовой чат");
  // And nothing that belongs to a channel that does not exist.
  await expect(page.getByTestId("chat-info-voice-name")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-voice-join")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-voice-end")).toHaveCount(0);
});

test("a plain member of that same group is offered nothing at all", async ({ page }) => {
  await open(page, { role: "member", channel: null });
  await openInfo(page);
  // `is_chat_admin(chat_id)` is the WITH CHECK of the only policy that lets a
  // client write this table, so a start control here would be a control the
  // database refuses.
  await expect(page.getByTestId("chat-info-voice")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-voice-start")).toHaveCount(0);
});

test("a member sees the voice chat an administrator started, and no way to end it", async ({ page }) => {
  await open(page, { role: "member", channel: { participantCount: 1 }, present: [ANNA.id] });
  await openInfo(page);
  await expect(page.getByTestId("chat-info-voice-join")).toBeVisible();
  await expect(page.getByTestId("chat-info-voice-end")).toHaveCount(0);
});

test("starting sends exactly one insert carrying the chat id, and the channel appears", async ({ page }) => {
  const { writes } = await open(page, { role: "admin", channel: null });
  await openInfo(page);

  await page.getByTestId("chat-info-voice-start").click();

  // The row that was not there is there: the name, the occupancy and the way
  // in, all from a re-read rather than from optimistic local state.
  await expect(page.getByTestId("chat-info-voice-name")).toHaveText("Общий голос");
  await expect(page.getByTestId("chat-info-voice-occupancy")).toHaveText("Никого нет");
  await expect(page.getByTestId("chat-info-voice-join")).toBeVisible();

  expect(writes.filter((entry) => entry.method === "POST")).toHaveLength(1);
  const insert = writes.find((entry) => entry.method === "POST")!;
  expect(insert.body).toMatchObject({
    chat_id: CHAT_TEAM,
    name: "Общий голос",
    max_participants: 10,
    created_by: ME.id,
  });
  // `participant_count` and `active_since` belong to the SFU's webhooks, and
  // the grant on this table does not even include them — a client that wrote
  // either would be refused column by column.
  expect(Object.keys(insert.body ?? {})).not.toContain("participant_count");
  expect(Object.keys(insert.body ?? {})).not.toContain("active_since");
  // Nothing was deleted on the way.
  expect(writes.filter((entry) => entry.method === "DELETE")).toHaveLength(0);

  // And now the same reader is offered the other half of the mechanic.
  await expect(page.getByTestId("chat-info-voice-end")).toHaveText("Завершить голосовой чат");
});

test("ending asks first, and answering «Отмена» deletes nothing", async ({ page }) => {
  const { writes } = await open(page, { role: "owner", channel: { participantCount: 2 }, present: [ANNA.id, PETR.id] });
  await openInfo(page);

  await page.getByTestId("chat-info-voice-end").click();

  const dialog = endDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Завершить голосовой чат?");
  // The question has to say that it reaches other people: two of them are in
  // this call and both are about to be disconnected.
  await expect(dialog).toContainText("будут отключены");

  await dialog.getByRole("button", { name: "Отмена" }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.filter((entry) => entry.method === "DELETE")).toHaveLength(0);
  // The channel is exactly where it was.
  await expect(page.getByTestId("chat-info-voice-name")).toHaveText("Общий голос");
});

test("ending after the confirmation deletes exactly this channel, and the section goes back to offering a new one", async ({ page }) => {
  const { writes } = await open(page, { role: "owner", channel: { participantCount: 2 }, present: [ANNA.id, PETR.id] });
  await openInfo(page);

  await page.getByTestId("chat-info-voice-end").click();
  await expect(endDialog(page)).toBeVisible();
  await page.getByTestId("chat-info-voice-end-confirm").click();

  await expect(endDialog(page)).toHaveCount(0);
  const deletes = writes.filter((entry) => entry.method === "DELETE");
  expect(deletes).toHaveLength(1);
  // By id, not by chat: two channels in one chat would otherwise both go.
  expect(deletes[0].search).toContain(`id=eq.${CHANNEL_ID}`);

  // The channel is gone for this reader, and the administrator is offered a new
  // one — which is what «Начать новый можно в любой момент» promised.
  await expect(page.getByTestId("chat-info-voice-name")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-voice-start")).toBeVisible();
  await expect(capsule(page)).toHaveCount(0);
});

test("the start row, the end control and the question, photographed in both themes", async ({ page }, info: TestInfo) => {
  await open(page, { role: "owner", channel: null });
  await openInfo(page);
  const shot = (name: string) => `output/voice-start/${name}-${info.project.name}.png`;
  const section = page.getByTestId("chat-info-voice");

  for (const theme of ["dark", "light"] as const) {
    await stampTheme(page, theme);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByTestId("chat-info-voice-start")).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(`start-${theme}`) });
  }

  await page.getByTestId("chat-info-voice-start").click();
  await expect(page.getByTestId("chat-info-voice-end")).toBeVisible();

  for (const theme of ["dark", "light"] as const) {
    await stampTheme(page, theme);
    await page.evaluate(() => document.fonts.ready);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(`channel-${theme}`) });
  }

  await page.getByTestId("chat-info-voice-end").click();
  await expect(endDialog(page)).toBeVisible();

  for (const theme of ["dark", "light"] as const) {
    await stampTheme(page, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: shot(`confirm-${theme}`) });
  }
});

/**
 * A browser that cannot do WebRTC at all, and what the product does there.
 *
 * Playwright's WebKit build is one: measured on 2026-09-13 it reports
 * `navigator.mediaDevices` **undefined** and `window.RTCPeerConnection`
 * **undefined**, while the same page in Chromium has both, and both browsers
 * agree the origin is a secure context. Real Safari has them; this build simply
 * ships without capture and without a peer connection, so a call cannot be
 * joined there by any code.
 *
 * That makes the eight tests below untestable on that project rather than
 * failing, and `needsWebRtc` skips them. This test is what stops that skip from
 * quietly outliving its cause: it runs everywhere, states the capability it
 * measured, and turns red on WebKit the day the build gains WebRTC -- at which
 * point the skip is wrong and has to go.
 */
test("a browser with no WebRTC is told so in words rather than left silent", async ({
  page,
  browserName,
}) => {
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
  const capabilities = await page.evaluate(() => ({
    microphone: typeof navigator.mediaDevices?.getUserMedia === "function",
    peerConnection: typeof window.RTCPeerConnection === "function",
    secureContext: window.isSecureContext,
  }));
  expect(capabilities.secureContext, "an insecure origin would explain it away").toBe(true);

  if (capabilities.microphone && capabilities.peerConnection) {
    expect(
      browserName,
      "WebKit gained WebRTC: `needsWebRtc` skips eight tests that can now run",
    ).not.toBe("webkit");
    return;
  }

  // No capture: the press must end in a sentence and a way to try again, never
  // in a thrown error or a capsule stuck on «Подключаемся…».
  await action(page).click();
  await expect(page.getByTestId("voice-capsule-detail")).toHaveText(
    "Этот браузер не умеет записывать звук.",
  );
  await expect(action(page)).toBeEnabled();
});

/**
 * Skip a test that has to join a call on a browser with no WebRTC. See the test
 * above, which is what keeps this honest.
 */
function needsWebRtc(browserName: string): void {
  test.skip(
    browserName === "webkit",
    "Playwright's WebKit has neither navigator.mediaDevices nor RTCPeerConnection",
  );
}

test("joining asks the gateway for exactly this channel, and the capsule follows", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  const { tokenCalls } = await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });

  // Nothing has been asked for before the press: the microphone prompt belongs
  // to the join, never to the mount.
  expect(await probe(page)).toMatchObject({ joins: [], left: 0 });
  expect(tokenCalls).toEqual([]);

  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");

  expect(tokenCalls).toEqual([{ channelId: CHANNEL_ID }]);

  const after = await probe(page);
  expect(after.joins).toEqual([{ url: GRANT.url, token: GRANT.token, hasTrack: true }]);
  // A real, live audio track from the fake capture device — the microphone is
  // genuinely open.
  expect(after.track).toMatchObject({ kind: "audio", readyState: "live", enabled: true });

  // The capsule now shows the call: you first, then the others.
  await expect(detail(page)).toHaveText("Вы, Анна Смирнова");
  await expect(page.getByTestId("voice-capsule-mute")).toBeVisible();
});

test("mute stops what is published, and unmute puts it back", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");

  const mute = page.getByTestId("voice-capsule-mute");
  await expect(mute).toHaveAttribute("data-muted", "false");
  await mute.click();
  await expect(mute).toHaveAttribute("data-muted", "true");
  await expect(mute).toHaveAttribute("aria-label", "Включить микрофон");

  // The assertion that matters is on the track itself, not on the control: a
  // muted control over a microphone that is still publishing is the failure
  // this ordering exists to avoid.
  expect((await probe(page)).track).toMatchObject({ enabled: false, readyState: "live" });

  await mute.click();
  await expect(mute).toHaveAttribute("data-muted", "false");
  expect((await probe(page)).track).toMatchObject({ enabled: true, readyState: "live" });
  expect((await probe(page)).muted).toEqual([true, false]);
});

test("«Выйти» ends the call and closes the microphone", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");

  await action(page).click();
  await expect(action(page)).toHaveText("Присоединиться");

  const after = await probe(page);
  expect(after.left).toBe(1);
  // Ended, not merely disabled. This is the microphone light going out, and it
  // is the difference between leaving a call and muting yourself in it.
  expect(after.track).toMatchObject({ readyState: "ended" });
});

test("the call survives a change of conversation", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");

  // Open another chat. `ChatWindow` and everything under it unmounts, which is
  // why the call lives in module state rather than in a component's.
  await switchChat(page, "Смета и склад", OTHER_LINE);
  expect(await probe(page)).toMatchObject({ left: 0 });
  expect((await probe(page)).track).toMatchObject({ readyState: "live" });

  // That chat has a channel of its own in the mock, and its capsule says where
  // the call actually is rather than offering to start a second one — a second
  // join from the same identity disconnects the first (section 3.6).
  await expect(page.getByTestId("voice-capsule-title")).toHaveText("Склад");
  await expect(detail(page)).toHaveText("Вы в другом голосовом чате");
  await expect(action(page)).toHaveCount(0);

  // Back again, and the call is still the same call.
  await switchChat(page, "Команда проекта", LINE);
  await expect(action(page)).toHaveText("Выйти");
  await expect(detail(page)).toHaveText("Вы, Анна Смирнова");
  expect(await probe(page)).toMatchObject({ left: 0, joins: [{ url: GRANT.url, token: GRANT.token, hasTrack: true }] });
});

test("a refused microphone is a state with words, and the way in comes back", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
  // The browser's own refusal, as a person who presses «Не разрешать» produces
  // it. `--use-fake-ui-for-media-stream` answers yes to everything, so the
  // denial has to be injected rather than clicked.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  });

  await action(page).click();
  await expect(detail(page)).toContainText("Нет доступа к микрофону.");
  // And it says what to do about it, in this shell's words.
  await expect(detail(page)).toContainText("Разрешите доступ к микрофону");
  await expect(action(page)).toHaveText("Повторить");
  await expect(capsule(page)).toHaveAttribute("data-voice-phase", "danger");

  // No token was ever asked for: declining costs the gateway nothing.
  expect(await probe(page)).toMatchObject({ joins: [] });
});

test("a gateway refusal is shown as a sentence, in the panel and in the capsule", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page, {
    channel: { participantCount: 1 },
    present: [ANNA.id],
    token: { status: 403, body: { ok: false, error: "not_a_member" } },
  });

  await action(page).click();
  await expect(detail(page)).toHaveText("Нет доступа к этому голосовому чату.");
  await expect(action(page)).toHaveText("Повторить");

  // The same sentence in the information panel, where the row's own control is.
  await openInfo(page);
  await expect(page.getByTestId("chat-info-voice-refusal")).toHaveText("Нет доступа к этому голосовому чату.");

  // The microphone was opened and then released: a failed join must not leave
  // the capture running.
  expect((await probe(page)).track).toBe(null);
  await expect(page.getByTestId("voice-capsule-mute")).toHaveCount(0);
});

test("a full channel offers no way in, and says why", async ({ page }) => {
  await open(page, { channel: { participantCount: 10 }, present: [ANNA.id, PETR.id] });
  await expect(detail(page)).toHaveText("Мест больше нет");
  await expect(action(page)).toHaveCount(0);
  await openInfo(page);
  await expect(page.getByTestId("chat-info-voice-full")).toHaveText("Заполнен");
  await expect(page.getByTestId("chat-info-voice-join")).toHaveCount(0);
});

test("the SDK's own mute is what the seam stands in for", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  // The one thing the stubbed transport cannot prove: that `LocalAudioTrack.mute()`
  // really disables the underlying track. It is checked against the SDK itself,
  // which needs no server to construct a local track — so the claim made by the
  // mute test above rests on a measurement rather than on an assumption.
  await open(page, { channel: null });
  const result = await page.evaluate(async () => {
    const { LocalAudioTrack } = await import("/node_modules/.vite/deps/livekit-client.js?import" as string)
      .catch(() => import("livekit-client" as string));
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const [raw] = stream.getAudioTracks();
    const local = new LocalAudioTrack(raw, undefined, true);
    const before = raw.enabled;
    await local.mute();
    const muted = raw.enabled;
    await local.unmute();
    const unmuted = raw.enabled;
    raw.stop();
    return { before, muted, unmuted };
  });
  expect(result).toEqual({ before: true, muted: false, unmuted: true });
});

test("the capsule and the row, photographed in both themes", async ({ page, browserName }, info: TestInfo) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
  const shot = (name: string) => `output/voice-call/${name}-${info.project.name}.png`;

  for (const theme of ["dark", "light"] as const) {
    await stampTheme(page, theme);
    await page.evaluate(() => document.fonts.ready);
    await expect(capsule(page)).toBeVisible();
    await page.screenshot({ path: shot(`idle-${theme}`) });

    await action(page).click();
    await expect(action(page)).toHaveText("Выйти");
    await page.screenshot({ path: shot(`connected-${theme}`) });

    await page.getByTestId("voice-capsule-mute").click();
    await expect(page.getByTestId("voice-capsule-mute")).toHaveAttribute("data-muted", "true");
    await page.screenshot({ path: shot(`muted-${theme}`) });

    await openInfo(page);
    await expect(page.getByTestId("chat-info-voice")).toBeVisible();
    await page.screenshot({ path: shot(`panel-${theme}`) });
    // Leave from the panel's own control, which is the other half of the row.
    await page.getByTestId("chat-info-voice-leave").click();
    await expect(page.getByTestId("chat-info-voice-join")).toBeVisible();
    // The panel's own «Закрыть», not Escape: at 390 the card is a full-screen
    // surface whose key handling is not what this file is about.
    await page.getByTestId("chat-info-panel").getByLabel("Закрыть").click();
    await expect(page.getByTestId("chat-info-panel")).toHaveCount(0);
  }
});

/**
 * The one claim the confirmation makes about other people, proved rather than
 * asserted in copy.
 *
 * «Все, кто сейчас в нём, будут отключены» is only true if a client whose
 * channel disappears actually leaves. Deleting the row does not close the room
 * — the SFU keeps it for another minute and no client call closes it sooner —
 * so without `voiceCallLostItsChannel` this reader would stay connected and
 * audible while the capsule, and with it the only «Выйти» in slice 2,
 * disappeared from under them.
 */
test("ending a voice chat disconnects the person who is in it", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page, { role: "owner", channel: { participantCount: 1 }, present: [ANNA.id] });

  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
  expect((await probe(page)).track).toMatchObject({ readyState: "live" });

  await openInfo(page);
  await page.getByTestId("chat-info-voice-end").click();
  await page.getByTestId("chat-info-voice-end-confirm").click();

  await expect(page.getByTestId("chat-info-voice-start")).toBeVisible();
  await expect(capsule(page)).toHaveCount(0);

  const after = await probe(page);
  expect(after.left).toBe(1);
  // Ended, not merely muted: the microphone light goes out too.
  expect(after.track).toMatchObject({ readyState: "ended" });
});

test("the capsule is inset like the pinned message it stands beside", async ({ page }) => {
  await open(page, { channel: { participantCount: 2 }, present: [ANNA.id, PETR.id] });
  const measured = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector) as HTMLElement | null;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: Math.round(rect.left), right: Math.round(rect.right) };
    };
    return {
      width: window.innerWidth,
      capsule: box('[data-testid="voice-capsule"]'),
      pane: box('[data-testid="chat-header-shell"]'),
    };
  });
  const { capsule, pane } = measured;
  expect(capsule && pane).toBeTruthy();
  // `mx-2 md:mx-4`, which is `PinnedMessage`'s and `TopicStrip`'s own inset —
  // the two surfaces this one is stacked with. Measured on 2026-09-13: at 1440
  // that puts it at 455..1424, exactly the header row's content box, because
  // the row is `md:px-4`. Below `md` the row is `px-3` and this is `mx-2`, so
  // the capsule sits 4px wider on each side than the header's own capsules —
  // an inconsistency this file inherits rather than introduces, and one that
  // belongs to the pinned message and the topic strip too.
  const inset = measured.width >= 768 ? 16 : 8;
  expect(capsule!.left - pane!.left).toBe(inset);
  expect(pane!.right - capsule!.right).toBe(inset);
});
