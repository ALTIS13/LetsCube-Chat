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

/** The key `useAudioSettings` stores the audio settings under. */
const AUDIO_SETTINGS_KEY = "kub:audio-settings:v1";
/** A device id no browser has; only ever handed to the stand-in transport. */
const HEADSET = "fixture-headset-device-id";
const SPEAKERS = "fixture-speakers-device-id";
const RENDERS_KEY = "__letscubeRenderCounts";

/**
 * Counts React commits in which a component's body ran, by name.
 *
 * `tests/e2e/message-render-stability.spec.ts`'s instrument, copied rather than
 * shared: that file is not this change's to refactor, and a test instrument
 * that two specs reach through one import is a thing to extract deliberately
 * rather than in passing. The mechanism is unchanged — installed as
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__` before React loads, so React reports every
 * commit; a component counts as rendered when the committed fiber carries props
 * or hook state it did not carry at the previous commit, which is what
 * separates a render from a bailout. Only the list of names differs.
 */
function installRenderCounter(countsKey: string) {
  const names = [
    "ChatWindow",
    "VoiceCallCapsule",
    "VoiceChannelRow",
    "VoiceSpeakingAvatar",
    "ChatInfoPanel",
    "MessageList",
    "MessageBubble",
  ];
  const counts: Record<string, number> = Object.fromEntries(names.map((name) => [name, 0]));
  type Seen = { props: unknown; state: unknown; commit: number };
  const seen = new WeakMap<object, Seen>();
  let commit = 0;

  type FiberLike = {
    tag: number;
    type: unknown;
    child: FiberLike | null;
    sibling: FiberLike | null;
    alternate: FiberLike | null;
    memoizedProps: unknown;
    memoizedState: unknown;
  };

  const nameOf = (fiber: FiberLike): string | null => {
    if (fiber.tag !== 0 && fiber.tag !== 11 && fiber.tag !== 15) return null;
    const type = fiber.tag === 11 ? (fiber.type as { render?: unknown } | null)?.render : fiber.type;
    if (typeof type !== "function") return null;
    const named = type as { displayName?: string; name?: string };
    return named.displayName || named.name || null;
  };

  const visit = (root: { current: FiberLike }) => {
    commit += 1;
    const stack: FiberLike[] = [root.current];
    while (stack.length) {
      const fiber = stack.pop()!;
      const name = nameOf(fiber);
      if (name && name in counts) {
        const own = seen.get(fiber);
        const other = fiber.alternate ? seen.get(fiber.alternate) : undefined;
        const previous = own && other ? (own.commit > other.commit ? own : other) : own ?? other;
        if (!previous || previous.props !== fiber.memoizedProps || previous.state !== fiber.memoizedState) {
          counts[name] += 1;
        }
        seen.set(fiber, { props: fiber.memoizedProps, state: fiber.memoizedState, commit });
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
    }
  };

  (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    inject: () => 1,
    onScheduleFiberRoot: () => undefined,
    onCommitFiberRoot: (_id: number, root: { current: FiberLike }) => {
      try {
        visit(root);
      } catch {
        // A counting failure must never break the page under test.
      }
    },
    onCommitFiberUnmount: () => undefined,
    onPostCommitFiberRoot: () => undefined,
    checkDCE: () => undefined,
  };
  (window as unknown as Record<string, unknown>)[countsKey] = {
    read: () => ({ ...counts }),
    reset: () => {
      for (const name of Object.keys(counts)) counts[name] = 0;
    },
  };
}

async function resetCounts(page: Page) {
  await page.evaluate((key) => {
    (globalThis as unknown as Record<string, { reset: () => void }>)[key].reset();
  }, RENDERS_KEY);
}

async function readCounts(page: Page): Promise<Record<string, number>> {
  return await page.evaluate(
    (key) => (globalThis as unknown as Record<string, { read: () => Record<string, number> }>)[key].read(),
    RENDERS_KEY,
  );
}

interface Seed {
  /** Whether this account is in the group at all. A non-member gets no row. */
  member?: boolean;
  /** This account's role in the group. Only an administrator may start or end a voice chat. */
  role?: "owner" | "admin" | "member";
  /** The channel row, or none at all. */
  channel?: { participantCount: number; maxParticipants?: number } | null;
  /** Who the table says is in the channel. */
  present?: string[];
  /**
   * Who the table says is in the **other** conversation's room.
   *
   * Needed because every row the participants mock answered named `CHANNEL_ID`,
   * so the second group's room was always empty however a test seeded it — and
   * a test that walked over to that room and asserted nothing was ringed there
   * was asserting over an empty list. Measured by mutation on 2026-09-18:
   * deleting the room scope from `useVoiceSpeaking` left it green.
   */
  presentElsewhere?: string[];
  /** What the gateway answers. */
  token?: { status: number; body: unknown };
  /** Make the transport refuse every output device, as Firefox does. */
  refuseOutput?: boolean;
  /** Extra people in the room, for the one test that counts rows. */
  others?: string[];
  /**
   * Which readings the transport answers, for the connection panel (D-217).
   *
   * «none» — every field null, which is what a transport without statistics
   * gives and what the panel must report as «unknown» rather than as healthy.
   * «good» — 40–49ms and nothing lost, the band the owner's screenshot shows.
   * «bad» — over 250ms and climbing, with twenty per cent of everything sent
   * since the last reading lost.
   *
   * A series the test controls, never a plausible-looking invention: the
   * arithmetic is pinned in `voice-connection-health.test.mts`, and a fixture
   * that made up numbers for a behavioural assertion to read back would be
   * measuring itself.
   */
  health?: "none" | "good" | "bad";
  /** What `serverName()` answers — «finland14135» in Discord's shape. */
  serverName?: string | null;
  /**
   * The output device already chosen in settings before the page boots. Written
   * to `localStorage` under the key `useAudioSettings` reads, because that is
   * the only channel the running application has: a call reads the stored
   * choice, it is not handed one.
   */
  outputDevice?: string;
  /**
   * Boot in this theme.
   *
   * Registered **after** `openFixture`, which writes `kub-theme = "dark"` in an
   * init script of its own — init scripts run in registration order, so the
   * later write is the one the application reads. Stamping the DOM after load
   * instead is the trap `chat-roles-reach.spec.ts` records: the tokens move
   * while React still holds the old theme, and the photograph is a hybrid with
   * a light label.
   */
  theme?: "light" | "dark";
  /** Install the React commit counter before the application boots. */
  countRenders?: boolean;
  /**
   * Whether «Смета и склад» has a voice channel of its own.
   *
   * `false` is the state the call bar exists for and the one no test could
   * reach before: a conversation with no voice channel at all — a private
   * chat, or any group made before channels existed. `voiceCapsuleState`
   * returns `HIDDEN` first for those, so a running call used to be
   * completely invisible there. `channel: null` is not the same seed: it
   * takes the channel away from **both** chats and leaves no way to start a
   * call in the first place.
   */
  otherChannel?: boolean;
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
  /** How many times the call asked the transport how it is doing. */
  healthSamples: number;
  /** Every output device the call asked the transport to switch to. */
  outputDevices: string[];
  /** Every deafen the call asked the transport for, in order. */
  deafened: boolean[];
}

declare global {
  interface Window {
    __voiceProbe?: {
      joins: { url: string; token: string; hasTrack: boolean }[];
      muted: boolean[];
      left: number;
      track: MediaStreamTrack | null;
      /** How many times the call asked the transport how it is doing. */
      healthSamples: number;
      /** Every output device the call asked the transport to switch to. */
      outputDevices: string[];
      /** Every deafen the call asked the transport for, in order. */
      deafened: boolean[];
      /**
       * Answer `false` to `setOutputDevice`, as Firefox does — it has no
       * `setSinkId` — and as every browser does for a device that has been
       * unplugged since it was chosen.
       */
      refuseOutput: boolean;
      /**
       * Drive `RoomEvent.ActiveSpeakersChanged` from a test.
       *
       * Set when the call asks for a transport, which is the only moment the
       * events object exists. The whole set each time, never a diff, because
       * that is what the interface promises and what the SDK actually sends.
       */
      speak: ((userIds: string[]) => void) | null;
      /**
       * Take this client's publish permission away, or give it back.
       *
       * What a force-mute looks like from inside the transport. There is no
       * column to seed and no route to mock — the gateway revokes `canPublish`
       * on the SFU and writes nothing — so this is the only way a test can
       * reach the state. `null` is «the permission is unknown», which must not
       * be read as a refusal.
       */
      revokeSpeech: ((allowed: boolean | null) => void) | null;
    };
  }
}

/** The SDK's own active-speaker event, and two frames for React to commit it. */
async function speak(page: Page, userIds: string[]): Promise<void> {
  await page.evaluate(async (ids) => {
    const held = window.__voiceProbe;
    if (!held?.speak) throw new Error("the transport was never asked for, so no speaker event can be sent");
    held.speak(ids);
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
  }, userIds);
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
      // Widened with the seam. Both default to a value rather than to
      // `undefined`: a reader that answers undefined makes «the closed panel
      // sampled nothing» and «this reader does not know» the same result, and
      // the first assertion written against it failed with «Expected 0,
      // Received undefined» rather than with anything about the product.
      healthSamples: held?.healthSamples ?? 0,
      outputDevices: held?.outputDevices ?? [],
      deafened: held?.deafened ?? [],
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
async function installVoiceSeam(
  page: Page,
  options: {
    refuseOutput?: boolean;
    others?: string[];
    /** Which readings `sampleHealth` answers; «none» is the default. */
    health?: "none" | "good" | "bad";
    /** What `serverName()` answers, as LiveKit composes it. */
    serverName?: string | null;
  } = {},
) {
  await page.addInitScript(
    ({ me, anna, refuseOutput, others, health, serverName }) => {
      const held: NonNullable<Window["__voiceProbe"]> = {
        joins: [],
        muted: [],
        left: 0,
        track: null,
        healthSamples: 0,
        outputDevices: [],
        deafened: [],
        refuseOutput: Boolean(refuseOutput),
        speak: null,
        revokeSpeech: null,
      };
      window.__voiceProbe = held;
      const roster = (muted: boolean) =>
        [
          { userId: me, name: "", muted },
          { userId: anna, name: "Анна (из токена)", muted: false },
          // A room with more people in it than the two this file has always had.
          // Only the render-cost test asks for them: the number that matters
          // there is «how many rows did one syllable rebuild», and two rows
          // cannot tell a list apart from a row.
          ...(others as string[]).map((userId, index) => ({
            userId,
            name: `Гость ${index + 1}`,
            muted: false,
          })),
        ].map((entry) => ({
          // The permission the SDK reports per participant, added with
          // `canSpeak` on 2026-09-18. `true` rather than absent: a stand-in that
          // left it `undefined` would be claiming «unknown» in a state where a
          // real transport answers, and «unknown» is the shape the *table* gives
          // outside a call. Nobody here is silenced; the spec that needs one is
          // `server-channel-rail.spec.ts`, where the moderation menu lives.
          ...entry,
          canSpeak: true,
        }));
      window.__letscubeVoiceRoom = (events) => {
        held.speak = (userIds: string[]) => events.onSpeakers(userIds);
        // What a force-mute looks like from inside the transport: the SFU
        // revokes `canPublish` and the seam announces the permission. There is
        // no database column to seed and no route to mock — the fact exists
        // only in the SDK — so the stand-in has to be able to raise it.
        held.revokeSpeech = (allowed: boolean | null) => events.onSpeechAllowed(allowed);
        return {
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
        // Widened on 2026-09-18 with the seam itself. The stand-in answers the
        // shape rather than plausible numbers: a spec that invented a round
        // trip would be measuring its own fixture, and the arithmetic that
        // turns readings into a panel is pinned by
        // `tests/unit/voice-connection-health.test.mts` against readings it
        // controls. What this proves is that the call asks and does not fall
        // over — `null` is the honest answer from a transport that is not one.
        async sampleHealth() {
          held.healthSamples += 1;
          const at = Date.now();
          // `null` is the default and it is the honest answer from a transport
          // that is not one. A `health` seed asks for a deterministic series
          // instead, and it exists for one purpose: the panel's DRAWING cannot
          // be photographed against an empty graph. The series is the test's
          // own, exactly as `voice-connection-health.test.mts` controls its
          // readings — the fixture never invents a plausible-looking number for
          // a behavioural assertion to read back.
          if (health === "none") {
            return { at, rttMs: null, jitterMs: null, packetsSent: null, packetsLost: null };
          }
          const step = held.healthSamples;
          if (health === "bad") {
            return {
              at,
              // Past 250ms, and climbing, so the verdict is «lagging» and the
              // graph's ceiling has to rise above its own peak.
              rttMs: 240 + step * 12,
              jitterMs: 18,
              packetsSent: 1000 + step * 100,
              // Twenty per cent of everything sent since the last reading.
              packetsLost: step * 20,
            };
          }
          return {
            at,
            // Between 40 and 49, which is the band the owner's screenshot
            // shows and the case the graph's 50ms floor exists for.
            rttMs: 40 + (step % 10),
            jitterMs: 3,
            packetsSent: 1000 + step * 100,
            packetsLost: 0,
          };
        },
        async setDeafened(next: boolean) {
          held.deafened.push(next);
        },
        async setOutputDevice(deviceId: string) {
          held.outputDevices.push(deviceId);
          // A browser that will not do it answers `false`; it does not throw.
          // `Room.switchActiveDevice` returns exactly this boolean.
          return !held.refuseOutput;
        },
        serverName() {
          // Discord's own shape, «region» then «node», which is what
          // `createLiveKitRoom` composes from `room.serverInfo`.
          return serverName;
        },
        };
      };
    },
    {
      me: ME.id,
      anna: ANNA.id,
      refuseOutput: Boolean(options.refuseOutput),
      others: options.others ?? [],
      health: options.health ?? "none",
      serverName: options.serverName ?? null,
    },
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
  await installVoiceSeam(page, {
    refuseOutput: seed.refuseOutput,
    others: seed.others,
    health: seed.health,
    serverName: seed.serverName,
  });
  const data = rows(seed);
  await openFixture(page, {
    me: ME,
    chats: data.chats,
    memberships: data.memberships,
    messages: data.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });

  if (seed.theme) {
    await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), seed.theme);
  }
  if (seed.outputDevice) {
    // The shape `normalizeAudioSettings` parses. Only the one field is written:
    // everything else falls back to its default, which is what a person who has
    // touched nothing but the output device actually has in storage.
    await page.addInitScript(
      ({ key, deviceId }) =>
        localStorage.setItem(key as string, JSON.stringify({ selectedOutputDeviceId: deviceId })),
      { key: AUDIO_SETTINGS_KEY, deviceId: seed.outputDevice },
    );
  }
  if (seed.countRenders) await page.addInitScript(installRenderCounter, RENDERS_KEY);

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
      channel && seed.otherChannel !== false
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
      // `channel_id` as well as `user_id`, because that is what the client now
      // asks for and therefore what PostgREST returns. The reader was widened
      // on 2026-09-14 — one query for every room of the group, bucketed by
      // `channel_id` — and a mock answering rows without that column put
      // everybody in a bucket named `undefined`, which showed up as an empty
      // participant list in the information panel. The row shape a fixture
      // answers has to be the row shape the query selects.
      body: JSON.stringify([
        ...(seed.present ?? []).map((user_id) => ({ channel_id: CHANNEL_ID, user_id })),
        ...(seed.presentElsewhere ?? []).map((user_id) => ({ channel_id: OTHER_CHANNEL_ID, user_id })),
      ]),
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
  /**
   * Make the team's room vanish from every later read.
   *
   * The card used to do this with «Завершить голосовой чат», and that
   * control is gone with the one-room mechanic. A room now disappears
   * because somebody removed it in «Каналы», or because another
   * administrator did — in both cases what this client sees is simply a
   * read that no longer contains it, which is exactly what this is.
   */
  const removeTeamChannel = () => {
    team = null;
  };
  return { tokenCalls, writes, removeTeamChannel };
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
/* The card does not make or remove rooms. None of these joins a call, so every */
/* one runs on every project.                                                   */
/*                                                                              */
/* «Начать голосовой чат» and «Завершить голосовой чат» lived here until         */
/* 2026-09-14, with a confirmation behind the second, and the six tests that     */
/* drove them are gone with them. They were the one-room mechanic: a group had   */
/* a voice chat or it did not. A group has rooms now — made, renamed, reordered  */
/* and removed in «Каналы» on the settings screen — and a second creator on this */
/* card would be two ways to make a thing that differ in what they can make.     */
/*                                                                              */
/* What is left here is the assertion that they are gone, so they cannot come    */
/* back by accident, and that the card still writes nothing at all.              */
/* -------------------------------------------------------------------------- */

test("a group with no voice room is offered no way to make one here", async ({ page }) => {
  await open(page, { role: "owner", channel: null });
  await openInfo(page);

  // Not «the section is empty»: the section does not exist. A band headed
  // «Голосовой чат» with nothing under it would read as a room that failed to
  // load rather than as a group that has none.
  await expect(page.getByTestId("chat-info-voice")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-voice-start")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-voice-end")).toHaveCount(0);
});

test("a plain member of that same group is offered nothing either", async ({ page }) => {
  await open(page, { role: "member", channel: null });
  await openInfo(page);
  await expect(page.getByTestId("chat-info-voice")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-voice-start")).toHaveCount(0);
});

test("an administrator with a room is offered the way in and nothing that writes", async ({ page }) => {
  const { writes } = await open(page, { role: "owner", channel: { participantCount: 2 }, present: [ANNA.id, PETR.id] });
  await openInfo(page);

  // The room, its people and the way in are still the card's job.
  await expect(page.getByTestId("chat-info-voice-name")).toHaveText("Общий голос");
  await expect(page.getByTestId("chat-info-voice-join")).toBeVisible();
  // And the two controls that used to sit beside them are not there for an
  // owner either — the strongest role there is, so this is not a permission
  // check passing for a removal.
  await expect(page.getByTestId("chat-info-voice-end")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-voice-start")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-voice-end-confirm")).toHaveCount(0);

  // Opening the card wrote nothing. A creator that came back as a silent
  // insert — a row made on open, a row removed on close — would pass every
  // assertion above and still be the mechanic this removed.
  expect(writes.filter((entry) => entry.method === "POST")).toHaveLength(0);
  expect(writes.filter((entry) => entry.method === "DELETE")).toHaveLength(0);
  expect(writes.filter((entry) => entry.method === "PATCH")).toHaveLength(0);
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
 * A NOTE WHERE A TEST WAS, because the absence is the finding.
 *
 * `VoiceCallCapsule` carries a hook, and on 2026-09-18 it was written below
 * `if (!view.visible) return null` — a conditional hook, which React throws on
 * the instant the state changes (D-218). I wrote an end-to-end test for it
 * here and then took it out, because **this suite cannot reach that state**.
 *
 * Every path in this file that hides the capsule also remounts its whole
 * subtree: `openChat` reloads the page and `switchChat` clicks the chat list,
 * and both tear `ChatWindow` down. So the component is never rendered twice
 * with `view.visible` moving from false to true — which is precisely what
 * production does when a group's `voice_channels` read lands after the
 * conversation is already on screen. Making it happen here needs an in-place
 * re-read: the rail refreshes on Supabase realtime, which this fixture cannot
 * drive, and building a refresh mechanism for one test is the wrong trade.
 *
 * The guard is `tests/unit/rules-of-hooks.test.mjs` instead — one biome rule,
 * `correctness/useHookAtTopLevel`, over the whole client. It is strictly
 * stronger than the test would have been: it found two more violations in
 * `MessageInput.tsx`, in shipped code, which no end-to-end test was ever going
 * to look for. Putting the conditional hook back turns it red.
 */

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
test("a room that disappears disconnects the person who is in it", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  const { removeTeamChannel } = await open(page, {
    role: "owner",
    channel: { participantCount: 1 },
    present: [ANNA.id],
  });

  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
  expect((await probe(page)).track).toMatchObject({ readyState: "live" });

  // Removed from somewhere that is not this card — «Каналы», or another
  // administrator. What this client has is a read that no longer contains the
  // room its call is in, which is the only thing `voiceCallLostItsChannel` has
  // ever actually looked at.
  removeTeamChannel();
  await switchChat(page, "Смета и склад", OTHER_LINE);
  await switchChat(page, "Команда проекта", LINE);

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

/* -------------------------------------------------------------------------- */
/* Who is speaking, and where the call's audio comes out. Both were blocked by  */
/* the width of `VoiceRoom` until 2026-09-18: the SDK's active-speaker event     */
/* had nowhere to arrive, and nothing could ask the transport to move its        */
/* audio. Neither is drawn from a guess — `onSpeakers` is the SFU's own answer,  */
/* and `setOutputDevice` is the browser's.                                       */
/* -------------------------------------------------------------------------- */

/** Every avatar drawn for one person, in every surface on screen. */
const rings = (page: Page, userId: string) =>
  page.locator('[data-testid="voice-speaking"][data-user-id="' + userId + '"]');

/**
 * The ring as the browser actually paints it, per surface.
 *
 * `data-speaking` is a declaration; an outline colour read back off the
 * computed style is the thing a person sees. A stylesheet that stopped
 * selecting on the attribute would keep every attribute assertion below green.
 */
async function ringPaint(page: Page, userId: string) {
  return page.evaluate((id) => {
    const nodes = [
      ...document.querySelectorAll('[data-testid="voice-speaking"][data-user-id="' + id + '"]'),
    ];
    return nodes.map((node) => {
      const style = getComputedStyle(node as HTMLElement);
      return { color: style.outlineColor, width: style.outlineWidth, style: style.outlineStyle };
    });
  }, userId);
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";

test("the ring follows the SDK's speaker list, and nobody else", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
  // The information panel draws every participant at every width; the capsule's
  // stack of faces is `hidden sm:flex`, so on a phone it is in the DOM but not
  // on screen. Both wear the same wrapper and both are asserted.
  await openInfo(page);

  // Nobody is speaking until the SFU says somebody is — in particular not the
  // person whose microphone is open. A local analyser would answer for them
  // here, and answering for one person is the mistake this event avoids.
  await expect(rings(page, ME.id).first()).toHaveAttribute("data-speaking", "false");
  await expect(rings(page, ANNA.id).first()).toHaveAttribute("data-speaking", "false");
  for (const paint of await ringPaint(page, ANNA.id)) {
    expect(paint.color, "a ring is painted before anybody has spoken").toBe(TRANSPARENT);
  }

  await speak(page, [ANNA.id]);
  const anna = rings(page, ANNA.id);
  const drawn = await anna.count();
  expect(drawn, "no surface drew this person at all").toBeGreaterThan(0);
  for (let index = 0; index < drawn; index += 1) {
    await expect(anna.nth(index)).toHaveAttribute("data-speaking", "true");
  }
  const me = rings(page, ME.id);
  for (let index = 0; index < (await me.count()); index += 1) {
    await expect(me.nth(index)).toHaveAttribute("data-speaking", "false");
  }

  // The pixels, not the attribute. 200ms is past `--kub-motion-fast`.
  await page.waitForTimeout(200);
  for (const paint of await ringPaint(page, ANNA.id)) {
    expect(paint.color, "the ring is declared but never painted").not.toBe(TRANSPARENT);
    expect(paint.width).toBe("2px");
    expect(paint.style).toBe("solid");
  }
  for (const paint of await ringPaint(page, ME.id)) {
    expect(paint.color, "a silent person is ringed too, so the ring says nothing").toBe(TRANSPARENT);
  }

  // Both at once, which is the whole set arriving rather than a diff applied.
  await speak(page, [ANNA.id, ME.id]);
  await expect(rings(page, ME.id).first()).toHaveAttribute("data-speaking", "true");
  await expect(rings(page, ANNA.id).first()).toHaveAttribute("data-speaking", "true");

  // And it goes when they stop.
  await speak(page, []);
  await expect(rings(page, ANNA.id).first()).toHaveAttribute("data-speaking", "false");
  await expect(rings(page, ME.id).first()).toHaveAttribute("data-speaking", "false");
  await page.waitForTimeout(200);
  for (const paint of await ringPaint(page, ANNA.id)) {
    expect(paint.color, "the ring stayed after the talking stopped").toBe(TRANSPARENT);
  }
});

/**
 * The ring under `prefers-reduced-motion`, measured rather than argued.
 *
 * It does not pulse, so there is no animation for the preference to remove. The
 * one thing that moves is a 140ms colour fade, which exists to stop the ring
 * strobing through a run of short words — and `--kub-motion-fast` is already
 * collapsed to 1ms by the block `tests/unit/motion-contract.test.mts` pins. So
 * the contract is: a transition at rest, none of it under the preference, and
 * the ring still there either way. A ring that vanished under reduced motion
 * would be removing information, which the preference is explicitly not for.
 */
for (const reduced of [false, true] as const) {
  test("the ring " + (reduced ? "snaps" : "fades") + " and stays visible with reduced motion " +
    (reduced ? "on" : "off"), async ({ page, browserName }) => {
    needsWebRtc(browserName);
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
    await action(page).click();
    await expect(action(page)).toHaveText("Выйти");
    await speak(page, [ANNA.id]);
    await expect(rings(page, ANNA.id).first()).toHaveAttribute("data-speaking", "true");
    await page.waitForTimeout(250);

    const measured = await page.evaluate((id) => {
      const node = document.querySelector('[data-testid="voice-speaking"][data-user-id="' + id + '"]');
      const style = getComputedStyle(node as HTMLElement);
      return {
        duration: style.transitionDuration,
        property: style.transitionProperty,
        animation: style.animationName,
        color: style.outlineColor,
      };
    }, ANNA.id);

    // Whatever the preference, the ring is painted: the information survives.
    expect(measured.color, "the ring is gone, so the preference removed information").not.toBe(TRANSPARENT);
    // And nothing pulses in either mode — a keyframe animation here would be
    // movement driven by the SFU's opinion of who is talking, several times a
    // second, which is not motion anybody asked for.
    expect(measured.animation, "the ring animates; it was meant to be static").toBe("none");
    expect(measured.property).toContain("outline-color");
    expect(measured.duration, "the fade is not taking the motion token").toBe(reduced ? "0.001s" : "0.14s");
  });
}

test("the ring belongs to the room the call is in, not to a stale row elsewhere", async ({
  page,
  browserName,
}) => {
  needsWebRtc(browserName);
  // The same person, in this room **and** in the other conversation's room. That
  // is the stale state the scope is for: `voice_participants` is up to one
  // reconciliation period behind, so somebody who has just moved is listed in
  // both for a moment.
  await open(page, {
    channel: { participantCount: 1 },
    present: [ANNA.id],
    presentElsewhere: [ANNA.id],
  });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
  await speak(page, [ANNA.id]);
  await expect(rings(page, ANNA.id).first()).toHaveAttribute("data-speaking", "true");

  // The other conversation has a room of its own and this client's call is not
  // in it. Ringing her there would say the SFU is hearing her from a room
  // nobody is connected to.
  await switchChat(page, "Смета и склад", OTHER_LINE);
  await openInfo(page);
  const elsewhere = rings(page, ANNA.id);
  const drawn = await elsewhere.count();
  // The premise, and the thing that was missing until 2026-09-18: without a
  // face in that room there is nothing here to be wrong about, and the
  // assertion below passes against any code at all.
  expect(drawn, "the other room lists nobody, so this test proves nothing").toBeGreaterThan(0);
  for (let index = 0; index < drawn; index += 1) {
    await expect(elsewhere.nth(index)).toHaveAttribute("data-speaking", "false");
  }

  // And back in the room the call is in, she is still ringed — so what the
  // scope refuses is the room, not the person. The card is closed first: at 390
  // it is a full-screen surface and it covers «Назад», which is what the chat
  // list is reached through on a phone.
  await page.getByTestId("chat-info-panel").getByLabel("Закрыть").click();
  await expect(page.getByTestId("chat-info-panel")).toHaveCount(0);
  await switchChat(page, "Команда проекта", LINE);
  await expect(rings(page, ANNA.id).first()).toHaveAttribute("data-speaking", "true");
});

/**
 * What one syllable costs, measured rather than asserted.
 *
 * The speaker list is replaced several times a second. If drawing it rebuilt
 * every occupant row on every syllable it would be a worse product than not
 * having it at all — so this counts React commits over ten changes, with eight
 * people in the room and every one of them drawn.
 *
 * The number to read is `VoiceSpeakingAvatar`: one person started or stopped
 * talking, so the faces that had to change are that person's — one per surface
 * drawing them — and not the other seven. Everything else in the list is there
 * to catch the cost arriving from above instead: a conversation that re-renders
 * its bubbles because somebody said «да» is the failure this is looking for.
 */
test("a speaker change renders the faces that changed and nothing else", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  const others = Array.from({ length: 6 }, (_, index) => "11111111-1111-4111-8111-00000000001" + index);
  await open(page, {
    channel: { participantCount: 1 },
    present: [ANNA.id],
    others,
    countRenders: true,
  });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
  await openInfo(page);
  // Every one of the eight has a face in the panel; the capsule draws the first
  // three of them and a «+5».
  await expect(page.getByTestId("chat-info-voice-participant")).toHaveCount(8);
  const drawn = await page.locator('[data-testid="voice-speaking"]').count();
  expect(drawn, "not enough faces on screen for this measurement to mean anything").toBeGreaterThanOrEqual(8);
  // How many faces one person has on screen at once. Measured rather than
  // assumed: at 1440 the information panel is in the tree twice beside the
  // capsule's stack, so a person can be drawn three times, and a bound written
  // as a number would either be brittle or be no bound at all. This is the
  // exact floor — one render per surface that draws the person who changed —
  // and rebuilding the list would be `drawn` per change instead.
  const copies = await rings(page, ANNA.id).count();
  expect(copies, "the person this test makes talk is not drawn anywhere").toBeGreaterThan(0);
  expect(copies, "one person is drawn as often as the whole room, so the bound below proves nothing").toBeLessThan(
    drawn,
  );

  await page.waitForTimeout(500);
  await resetCounts(page);

  const CHANGES = 10;
  for (let index = 0; index < CHANGES; index += 1) {
    await speak(page, index % 2 === 0 ? [ANNA.id] : []);
  }
  await page.waitForTimeout(300);

  const counts = await readCounts(page);
  const perChange = counts.VoiceSpeakingAvatar / CHANGES;
  console.log(
    "[voice-speaking] " + test.info().project.name + " " + drawn + " faces on screen (" +
      copies + " of them one person's), " + CHANGES + " speaker changes: " + JSON.stringify(counts) +
      " — " + perChange.toFixed(2) + " face renders per change",
  );

  // The premise: the rings really did change, so a counter reading zero is a
  // broken counter rather than a free feature.
  expect(
    counts.VoiceSpeakingAvatar,
    "no face rendered at all, so nothing was measured",
  ).toBeGreaterThanOrEqual(CHANGES);
  // The contract. One person changed, so the faces that had to render are that
  // person's and nobody else's — `copies` of them, which is the floor. A list
  // rebuilt from above is `drawn` per change instead, and that is what this
  // measured before `speakers` was moved out of `VoiceCallState`: 19 of 19.
  expect(
    perChange,
    "one speaker change rebuilt " + perChange.toFixed(1) + " faces of the " + drawn + " on screen, " +
      "where only " + copies + " belong to the person who changed",
  ).toBeLessThanOrEqual(copies);
  // And it must not arrive from above. A conversation whose bubbles re-render
  // because somebody spoke is the same defect `message-render-stability.spec.ts`
  // measures from the composer.
  expect(counts.MessageBubble, "speaking re-rendered message bubbles: " + JSON.stringify(counts)).toBe(0);
  expect(counts.MessageList, "speaking re-rendered the message list: " + JSON.stringify(counts)).toBe(0);
  expect(counts.ChatWindow, "speaking re-rendered the whole conversation: " + JSON.stringify(counts)).toBe(0);
  expect(counts.VoiceChannelRow, "speaking rebuilt the participant list: " + JSON.stringify(counts)).toBe(0);
});

/* ── The output device, reaching a call at last ───────────────────────────── */

/** Every device the call asked the transport to switch to, in order. */
const outputDevices = (page: Page) => page.evaluate(() => window.__voiceProbe?.outputDevices ?? []);

test("the chosen output device reaches the transport when the call is joined", async ({
  page,
  browserName,
}) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id], outputDevice: HEADSET });

  // Nothing is asked of the transport before there is one.
  expect(await outputDevices(page)).toEqual([]);

  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
  await expect.poll(() => outputDevices(page)).toEqual([HEADSET]);
  // The browser took it, so nothing says otherwise.
  await expect(page.getByTestId("voice-capsule-output-refused")).toHaveCount(0);
});

test("changing the device while the call runs reaches the transport again", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id], outputDevice: HEADSET });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
  await expect.poll(() => outputDevices(page)).toEqual([HEADSET]);

  // The settings screen's own write: `updateSettings` stores the new value and
  // dispatches `AUDIO_SETTINGS_EVENT` carrying it. This is that write, made the
  // way the hook makes it, rather than a call into the module under test.
  const choose = async (deviceId: string) => {
    await page.evaluate(
      ({ key, event, id }) => {
        const held = JSON.parse(localStorage.getItem(key as string) ?? "{}") as Record<string, unknown>;
        const next = { ...held, selectedOutputDeviceId: id };
        localStorage.setItem(key as string, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent(event as string, { detail: next }));
      },
      { key: AUDIO_SETTINGS_KEY, event: "kub:audio-settings-change", id: deviceId },
    );
  };

  await choose(SPEAKERS);
  await expect.poll(() => outputDevices(page)).toEqual([HEADSET, SPEAKERS]);

  // Back to the first one. A call outlives the choice, so moving back has to
  // move the audio back — this is where the element helper's «skip it» rule for
  // the default device would leave somebody on a headset they just unplugged.
  await choose(HEADSET);
  await expect.poll(() => outputDevices(page)).toEqual([HEADSET, SPEAKERS, HEADSET]);

  // The same choice twice asks the transport once: a settings screen that
  // rewrites every field on every keystroke must not restart the audio path.
  await choose(HEADSET);
  await page.waitForTimeout(250);
  expect(await outputDevices(page)).toEqual([HEADSET, SPEAKERS, HEADSET]);
});

test("a browser that refuses the device is not reported as having taken it", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page, {
    channel: { participantCount: 1 },
    present: [ANNA.id],
    outputDevice: HEADSET,
    refuseOutput: true,
  });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");

  // It was asked for — a refusal is the browser's answer, not this client
  // deciding not to ask.
  await expect.poll(() => outputDevices(page)).toEqual([HEADSET]);
  // And the call says so. Without this the settings screen would show a headset
  // selected while the call came out of the laptop, and nothing anywhere would
  // contradict it.
  const mark = page.getByTestId("voice-capsule-output-refused");
  await expect(mark).toBeVisible();
  await expect(mark.getByRole("img")).toHaveAttribute(
    "aria-label",
    "Звук звонка остался на системном устройстве",
  );

  // Leaving clears it: the next call asks again rather than inheriting a
  // refusal from the last one.
  await action(page).click();
  await expect(action(page)).toHaveText("Присоединиться");
  await expect(page.getByTestId("voice-capsule-output-refused")).toHaveCount(0);
});

/**
 * The connection panel (D-217), which the owner asked for by showing Discord's.
 *
 * The readings come from the stand-in's `health` seed rather than from a real
 * transport, and that is the only way this can be honest: the arithmetic is
 * pinned in `tests/unit/voice-connection-health.test.mts` against readings it
 * controls, and what is left to prove here is that the panel asks, draws, and
 * says the right sentence about numbers it was given.
 */
test("the panel asks the transport and draws what it is told", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page, {
    channel: { participantCount: 1 },
    present: [ANNA.id],
    health: "good",
    serverName: "finland14135",
  });

  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");

  // Nothing is sampled before the panel is opened. A call runs for hours and
  // this graph is read for seconds; a timer on every call would be a getStats
  // round trip a second on every device for a graph nobody asked to see.
  await page.waitForTimeout(1200);
  expect((await probe(page)).healthSamples, "the closed panel is sampling anyway").toBe(0);

  await page.getByTestId("voice-capsule-health").click();
  const panel = page.getByTestId("voice-connection-panel");
  await expect(panel).toBeVisible();

  await expect.poll(async () => (await probe(page)).healthSamples, { timeout: 8_000 }).toBeGreaterThan(1);

  // «45 мс» shaped, not «—»: the numbers reached the panel.
  await expect(page.getByTestId("voice-connection-average")).toHaveText(/^4[0-9] мс$/);
  await expect(page.getByTestId("voice-connection-last")).toHaveText(/^4[0-9] мс$/);
  // «0.0%», not «0%»: the first says somebody measured and the second reads
  // like a default. `voice-connection-health.test.mts` states that distinction
  // and the component was quietly dropping the decimal until the pixels showed
  // it beside the owner's own screenshot.
  await expect(page.getByTestId("voice-connection-loss")).toHaveText("0.0%");
  await expect(page.getByTestId("voice-connection-server")).toHaveText("finland14135");
  await expect(panel).toHaveAttribute("data-voice-verdict", "good");

  // Between 40 and 49 the ceiling stays at its floor, which is the case a
  // data-driven ceiling would flatten onto the graph's base.
  await expect(page.getByTestId("voice-connection-ceiling")).toHaveText("50 мс");

  // Closing it stops the sampling rather than leaving a timer behind.
  const before = (await probe(page)).healthSamples;
  await page.getByTestId("voice-capsule-health").click();
  await expect(panel).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(
    (await probe(page)).healthSamples,
    "the panel is closed and still sampling",
  ).toBe(before);
});

test("a bad connection says which threshold it crossed, and raises the ceiling", async ({
  page,
  browserName,
}) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id], health: "bad" });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
  await page.getByTestId("voice-capsule-health").click();
  const panel = page.getByTestId("voice-connection-panel");
  await expect(panel).toBeVisible();

  // Twenty per cent lost beats a round trip over 250ms: a voice that arrives
  // broken is worse news than one that arrives late, and this connection has
  // both.
  await expect(panel).toHaveAttribute("data-voice-verdict", "distorting", { timeout: 8_000 });
  await expect(page.getByTestId("voice-connection-advice")).toContainText("10%");
  await expect(page.getByTestId("voice-connection-verdict")).toContainText("Потеря выше 10%");

  // The peak is inside the frame rather than on its edge.
  const ceiling = await page.getByTestId("voice-connection-ceiling").innerText();
  const max = Number(ceiling.replace(/[^0-9]/g, ""));
  const last = Number((await page.getByTestId("voice-connection-last").innerText()).replace(/[^0-9]/g, ""));
  expect(max, `the ceiling ${max} does not clear the peak ${last}`).toBeGreaterThan(last);
});

test("a transport that measures nothing says so, rather than drawing a flat line", async ({
  page,
  browserName,
}) => {
  needsWebRtc(browserName);
  // The default seed: every reading is null, which is what a transport without
  // statistics answers. The panel must not report a perfect connection.
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
  await page.getByTestId("voice-capsule-health").click();
  const panel = page.getByTestId("voice-connection-panel");
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await probe(page)).healthSamples, { timeout: 8_000 }).toBeGreaterThan(1);

  await expect(panel).toHaveAttribute("data-voice-verdict", "unknown");
  await expect(page.getByTestId("voice-connection-average")).toHaveText("—");
  await expect(page.getByTestId("voice-connection-loss")).toHaveText("—");
  await expect(page.getByTestId("voice-connection-verdict")).toHaveCount(0);
  // The graph has slots and no line, which is a different picture from a line
  // along the floor.
  await expect(page.getByTestId("voice-connection-graph")).toBeVisible();
  const drawn = await page.evaluate(
    () => document.querySelectorAll('[data-testid="voice-connection-graph"] polyline').length,
  );
  expect(drawn, "a line was drawn from readings that measured nothing").toBe(0);
});

test("deafening also mutes, and undeafening does not unmute somebody who was muted", async ({
  page,
  browserName,
}) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");

  const deafen = page.getByTestId("voice-capsule-deafen");
  const mute = page.getByTestId("voice-capsule-mute");
  await expect(deafen).toHaveAttribute("data-deafened", "false");
  await expect(mute).toHaveAttribute("data-muted", "false");

  // Deafening mutes as well. Every product with this control does it, and the
  // alternative is worse than inconsistent: somebody who cannot hear the room
  // cannot hear themselves being asked to stop talking.
  await deafen.click();
  await expect(deafen).toHaveAttribute("data-deafened", "true");
  await expect(mute).toHaveAttribute("data-muted", "true");
  expect((await probe(page)).deafened).toEqual([true]);
  expect((await probe(page)).muted, "the microphone was not muted with the ears").toContain(true);

  // Undeafening gives the microphone back, because it was not muted first.
  await deafen.click();
  await expect(deafen).toHaveAttribute("data-deafened", "false");
  await expect(mute).toHaveAttribute("data-muted", "false");
  expect((await probe(page)).deafened).toEqual([true, false]);
});

test("somebody already muted stays muted after undeafening", async ({ page, browserName }) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");

  const deafen = page.getByTestId("voice-capsule-deafen");
  const mute = page.getByTestId("voice-capsule-mute");

  // Muted first, deliberately, and this is the case a naive implementation
  // gets wrong: undeafening unmutes and the person is publishing again without
  // having asked to be.
  await mute.click();
  await expect(mute).toHaveAttribute("data-muted", "true");
  await deafen.click();
  await expect(mute).toHaveAttribute("data-muted", "true");
  await deafen.click();
  await expect(deafen).toHaveAttribute("data-deafened", "false");
  await expect(
    mute,
    "undeafening unmuted somebody who had muted themselves first",
  ).toHaveAttribute("data-muted", "true");
});

test("a listener who may not publish can still stop hearing the room", async ({
  page,
  browserName,
}) => {
  needsWebRtc(browserName);
  // The gateway refusing publication is the `canPublish: false` grant. The mute
  // control is gated on it — a control over a microphone the SFU will not carry
  // has nothing behind it — and deafening is not, because not hearing the room
  // needs no permission to speak.
  await open(page, {
    channel: { participantCount: 1 },
    present: [ANNA.id],
    token: { status: 200, body: { ...GRANT, canPublish: false } },
  });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");

  await expect(page.getByTestId("voice-capsule-mute")).toHaveCount(0);
  const deafen = page.getByTestId("voice-capsule-deafen");
  await expect(deafen).toBeVisible();
  await deafen.click();
  await expect(deafen).toHaveAttribute("data-deafened", "true");
  expect((await probe(page)).deafened).toEqual([true]);
});

/* ── The pixels ───────────────────────────────────────────────────────────── */

for (const theme of ["dark", "light"] as const) {
  test("the connection panel is photographed in the " + theme + " theme", async ({ page, browserName }, info: TestInfo) => {
    needsWebRtc(browserName);
    await open(page, {
      channel: { participantCount: 1 },
      present: [ANNA.id],
      health: "good",
      serverName: "finland14135",
      theme,
    });
    expect(
      await page.evaluate(() => document.documentElement.classList.contains("dark")),
      "the application booted in the other theme",
    ).toBe(theme === "dark");

    await action(page).click();
    await expect(action(page)).toHaveText("Выйти");
    await page.getByTestId("voice-capsule-health").click();
    await expect(page.getByTestId("voice-connection-panel")).toBeVisible();
    // Long enough for the graph to have a line rather than two points.
    await expect
      .poll(async () => (await probe(page)).healthSamples, { timeout: 12_000 })
      .toBeGreaterThan(6);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.screenshot({
      path: "output/voice/connection-" + theme + "-" + info.project.name + ".png",
    });
  });

  test("the speaking ring is photographed in the " + theme + " theme", async ({ page, browserName }, info: TestInfo) => {
    needsWebRtc(browserName);
    await open(page, {
      channel: { participantCount: 1 },
      present: [ANNA.id],
      others: ["11111111-1111-4111-8111-000000000010"],
      outputDevice: HEADSET,
      theme,
    });
    // The theme the application resolved, not one a later stamp painted over
    // it. A hybrid — tokens moved while React still holds the old theme — is
    // the trap `chat-roles-reach.spec.ts` records, and it photographs as a
    // light screen labelled dark.
    expect(
      await page.evaluate(() => document.documentElement.classList.contains("dark")),
      "the application booted in the other theme",
    ).toBe(theme === "dark");

    await action(page).click();
    await expect(action(page)).toHaveText("Выйти");
    await speak(page, [ANNA.id]);
    await expect(rings(page, ANNA.id).first()).toHaveAttribute("data-speaking", "true");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);

    const shot = (name: string) => "output/voice/" + name + "-" + theme + "-" + info.project.name + ".png";
    await page.screenshot({ path: shot("screen-speaking") });

    // The rail, which is where the ring lives on a phone: the capsule's stack of
    // faces is `hidden sm:flex`, so below 640 it is in the tree and not on
    // screen. As a column when the pane fits one, and as the sheet behind
    // «Каналы» when it does not — one of the two is always there.
    const column = page.getByTestId("channel-rail");
    const trigger = page.getByTestId("channel-rail-trigger");
    if (await column.isVisible().catch(() => false)) {
      await column.screenshot({ path: shot("rail-speaking") });
    } else {
      await trigger.click();
      const sheet = page.getByTestId("channel-rail-sheet");
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(250);
      await sheet.screenshot({ path: shot("rail-speaking") });
      await page.getByTestId("channel-rail-close").click();
      await expect(sheet).toHaveCount(0);
    }

    await openInfo(page);
    const row = page.getByTestId("chat-info-voice");
    await expect(row).toBeVisible();
    // The element rather than the page: at 390 this band is below the fold, and
    // a photograph of the fold is not a photograph of the ring.
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await row.screenshot({ path: shot("panel-speaking") });
  });
}

/**
 * The call, seen and touched from outside the conversation it is in (D-225).
 *
 * `tests/unit/voice-call-bar.test.mts` holds the rule about when the bar is
 * drawn and what it says. What is measured here is everything that cannot be:
 * that it actually appears in a conversation with **no voice channel at all** —
 * where `voiceCapsuleState` returns `HIDDEN` before it says anything, and a
 * running microphone therefore had nothing on screen about it — that its
 * controls reach the same transport the capsule's do, and that exactly one bar
 * is ever visible, the two placements being the column's foot on a computer and
 * a band across the top on a phone.
 */

/** The bar the person can actually see. Two are mounted; one at most is shown. */
const bar = (page: Page) => page.locator('[data-testid="voice-call-bar"]:visible');

/** Take this client's publish permission away from inside the transport. */
async function revokeSpeech(page: Page, allowed: boolean | null): Promise<void> {
  await page.evaluate(async (value) => {
    const held = window.__voiceProbe;
    if (!held?.revokeSpeech) throw new Error("the transport was never asked for");
    held.revokeSpeech(value as boolean | null);
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
  }, allowed);
}

test("a call in a conversation with no voice channel is visible and can be left", async ({
  page,
  browserName,
}) => {
  needsWebRtc(browserName);
  // The worst case, and the reason this exists: «Смета и склад» has no channel,
  // so the capsule is not merely quiet there — it is not rendered at all.
  await open(page, {
    channel: { participantCount: 1 },
    present: [ANNA.id],
    otherChannel: false,
  });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");

  await switchChat(page, "Смета и склад", OTHER_LINE);
  // The capsule really is absent — this is the premise, and asserting it stops
  // this whole test from passing against a capsule that quietly came back.
  await expect(capsule(page)).toHaveCount(0);

  await expect(bar(page)).toBeVisible();
  await expect(bar(page).getByTestId("voice-call-bar-room")).toHaveText("Общий голос");
  // The group, so somebody knows which conversation they are talking in, and
  // the state, so they know the call is still up.
  // Two boxes rather than one string: the group truncates where the column
  // is narrow and the state never does, because the state is what somebody
  // reads to know the call is up. The first capture cut it — «Команда
  // проекта · Вы в разг…» — at the column default of 360 points.
  await expect(bar(page).getByTestId("voice-call-bar-where")).toHaveText("Команда проекта");
  await expect(bar(page).getByTestId("voice-call-bar-state")).toHaveText("Вы в разговоре");

  // Not clipped, measured rather than looked at. `toHaveText` reads
  // `textContent`, which is the same string whether or not the box it sits in
  // can show it — so the assertion above passed while the pixels read «Вы в
  // разг…». This is the check that would have caught it: the state must fit
  // its own box, and the group's name is the one allowed not to.
  const clipped = await bar(page).evaluate((node) => {
    const read = (testId: string) => {
      const found = node.querySelector(`[data-testid="${testId}"]`);
      if (!found) return null;
      return { scroll: found.scrollWidth, client: found.clientWidth };
    };
    return { state: read("voice-call-bar-state"), where: read("voice-call-bar-where") };
  });
  expect(clipped.state, "the state has no box of its own").not.toBeNull();
  expect(clipped.state.scroll).toBeLessThanOrEqual(clipped.state.client + 1);

  // The controls reach the same transport the capsule's do.
  await bar(page).getByTestId("voice-call-bar-mute").click();
  await expect.poll(async () => (await probe(page)).muted).toEqual([true]);
  await expect(bar(page).getByTestId("voice-call-bar-state")).toHaveText("Микрофон выключен");

  await bar(page).getByTestId("voice-call-bar-leave").click();
  await expect.poll(async () => (await probe(page)).left).toBe(1);
  // And the bar goes with the call rather than lingering over nothing.
  await expect(bar(page)).toHaveCount(0);
});

test("voice-call-bar-one-visible: the bar stands down where the capsule stands", async ({
  page,
  browserName,
}) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id] });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");

  // In the call's own conversation the capsule has these same three controls
  // over this same state. Two identical control sets on one screen is the
  // duplicate this product refuses.
  await expect(bar(page)).toHaveCount(0);

  await switchChat(page, "Смета и склад", OTHER_LINE);
  // That chat has a channel of its own, so the capsule is there and says where
  // the call is — but it still offers nothing, which is what the bar is for.
  await expect(detail(page)).toHaveText("Вы в другом голосовом чате");
  await expect(action(page)).toHaveCount(0);
  // Exactly one, never two: both placements are mounted and CSS decides which
  // shell shows which, so a mistake there is two bars rather than none.
  await expect(bar(page)).toHaveCount(1);

  await switchChat(page, "Команда проекта", LINE);
  await expect(bar(page)).toHaveCount(0);
});

test("the bar's body goes back to the conversation the call is in", async ({
  page,
  browserName,
}) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id], otherChannel: false });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
  await switchChat(page, "Смета и склад", OTHER_LINE);

  await bar(page).getByTestId("voice-call-bar-open").click();
  // Back in the call's own conversation: its capsule offers «Выйти» again, and
  // the bar has stood down because the capsule now stands there.
  await expect(action(page)).toHaveText("Выйти");
  await expect(bar(page)).toHaveCount(0);
  // The same call throughout — not a rejoin.
  expect(await probe(page)).toMatchObject({ left: 0 });
});

test("a moderator's silence reaches the bar, and the microphone stops being pressable", async ({
  page,
  browserName,
}) => {
  needsWebRtc(browserName);
  await open(page, { channel: { participantCount: 1 }, present: [ANNA.id], otherChannel: false });
  await action(page).click();
  await expect(action(page)).toHaveText("Выйти");
  await switchChat(page, "Смета и склад", OTHER_LINE);
  await expect(bar(page)).toBeVisible();

  await revokeSpeech(page, false);
  await expect(bar(page)).toHaveAttribute("data-voice-tone", "danger");
  await expect(bar(page).getByTestId("voice-call-bar-state")).toHaveText(
    "Модератор выключил ваш микрофон",
  );
  const mute = bar(page).getByTestId("voice-call-bar-mute");
  // Drawn and inert, not absent: a control that disappears reads as a feature
  // that went away.
  await expect(mute).toBeVisible();
  await expect(mute).toBeDisabled();
  await expect(mute).toHaveAttribute("data-unavailable", "true");
  // Leaving is not the moderator's to take away.
  await expect(bar(page).getByTestId("voice-call-bar-leave")).toBeEnabled();

  // And «unknown» is not a refusal: a permission nobody reported must not be
  // read as a silence somebody imposed.
  await revokeSpeech(page, null);
  await expect(bar(page)).toHaveAttribute("data-voice-tone", "danger");
  await revokeSpeech(page, true);
  await expect(bar(page)).toHaveAttribute("data-voice-tone", "live");
  await expect(bar(page).getByTestId("voice-call-bar-mute")).toBeEnabled();
});

for (const theme of ["dark", "light"] as const) {
  test("the call bar, photographed in the " + theme + " theme", async ({
    page,
    browserName,
  }, info: TestInfo) => {
    needsWebRtc(browserName);
    await open(page, {
      channel: { participantCount: 1 },
      present: [ANNA.id],
      otherChannel: false,
      theme,
    });
    await action(page).click();
    await expect(action(page)).toHaveText("Выйти");
    await switchChat(page, "Смета и склад", OTHER_LINE);
    // The premise, asserted before the thing being photographed, so a failure
    // names its own cause. This capture went red once out of three cold runs
    // with «element(s) not found», which is indistinguishable between «the bar
    // is not drawn» and «the call is no longer running».
    expect(await probe(page)).toMatchObject({ left: 0 });
    await expect(bar(page)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `output/voice-call-bar/bar-${info.project.name}-${theme}.png`,
    });
  });
}
