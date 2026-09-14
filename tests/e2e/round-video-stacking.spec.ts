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

/**
 * D-129: a round video scrolled under the chrome painted over it.
 *
 * The circle's play button carried `z-10` and its corner button `z-20`, inside
 * the scrolling list. The header, the pinned capsule, the phone's search panel
 * and the composer are positioned boxes with `z-index: auto` — that is the
 * whole mechanism of the chat screen, and `ChatWindow.tsx` and rule 12 of
 * `docs/operations/interface-material.md` both say why it must stay that way —
 * so any positive z-index in the conversation wins against all of them.
 *
 * What is measured here is paint order, not CSS: at a point where the circle
 * and a piece of chrome overlap, `document.elementFromPoint` names the box the
 * engine drew on top. That is the same instrument rule 12 used when the header
 * turned out not to exist on WebKit, and it is the only one that cannot be
 * satisfied by a stylesheet that merely looks right.
 *
 * The fixture is the mocked message-actions backend: fictional people, and a
 * round video this spec records in a canvas. No production chat is opened and
 * no stored file is read.
 */

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";

const PINNED_TEXT = "Стенд собираем в четверг";
const CIRCLE_CAPTION = "Видео-сообщение (0:01)";
const CIRCLE_URL = "/__fixture-media/circle.webm";

/** Recorded here rather than checked in: an undecodable source draws the error panel, not a circle. */
let clip: Buffer | null = null;

/**
 * Recorded in Chromium whatever engine the project runs, because WebKit has
 * neither `canvas.captureStream` nor a `MediaRecorder` that answers it. The
 * clip is then played back in the project's own engine — if that engine cannot
 * decode it the circle draws its error panel instead, the locator below never
 * resolves, and the run fails rather than quietly measuring the wrong box.
 */
test.beforeAll(async () => {
  const recorder = await chromium.launch();
  const page = await recorder.newPage();
  await page.goto("about:blank");
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 480;
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
        // A loud, flat orange: over the chrome it is unmistakable in a frame,
        // and under it the frost has something worth sampling.
        ctx.fillStyle = "hsl(24 92% 52%)";
        ctx.fillRect(0, 0, 480, 480);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 120px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("КРУГ", 240, 280);
        if (t >= 1200) {
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
  await recorder.close();
  expect(clip.byteLength).toBeGreaterThan(2_000);
});

const iso = (minute: number) => new Date(Date.UTC(2026, 8, 14, 10, minute)).toISOString();

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  const filler = (index: number, from: typeof ME) =>
    message(
      `55555555-5555-4555-8555-100000000${String(index).padStart(3, "0")}`,
      CHAT_TEAM,
      from,
      `Сообщение ${index}: короткая строка, чтобы список был длиннее экрана.`,
      iso(index),
    );

  // Enough on both sides that the circle can be driven right under the header
  // and right under the composer without running out of scroll, which is what
  // an empty overlap — and a vacuous pass — would come from.
  // Enough on both sides at 3840x2160 too, where a 24-message tail did not
  // reach: the list simply ran out of scroll, the overlap came back empty, and
  // the guard below caught it as «the circle never reached the header stack»
  // rather than passing on nothing.
  //
  // And no more than that. `MESSAGE_PAGE_SIZE` is 100, so 102 rows left the two
  // oldest off the first page — including the one `openChat` waits for — and
  // every case failed on a missing bubble rather than on anything it measures.
  // 97 rows keep `hasMoreOlder` false and the whole conversation on one page.
  const before = Array.from({ length: 45 }, (_, i) => filler(i + 1, i % 2 ? ME : ANNA));
  // From 51, so no filler shares the circle's own minute below.
  const after = Array.from({ length: 50 }, (_, i) => filler(i + 51, i % 2 ? ME : ANNA));

  return {
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [
      membership(CHAT_TEAM, ME, "owner", AT),
      membership(CHAT_TEAM, ANNA, "member", AT),
    ],
    messages: [
      message("55555555-5555-4555-8555-000000000001", CHAT_TEAM, ANNA, PINNED_TEXT, iso(0), { pinned: true }),
      ...before,
      message("55555555-5555-4555-8555-000000000020", CHAT_TEAM, ANNA, CIRCLE_CAPTION, iso(50), {
        type: "video",
        media_url: CIRCLE_URL,
        media_metadata: { kind: "video_message", shape: "round", duration_ms: 1200 },
      }),
      ...after,
    ],
  };
}

/**
 * Whether this engine gets the clip's bytes at all.
 *
 * Playwright's WebKit on this machine decodes nothing Chromium's MediaRecorder
 * can produce: the VP8 WebM and an H.264 MP4 both come back
 * `MEDIA_ERR_SRC_NOT_SUPPORTED` (measured — `canPlayType` answers «probably»
 * for both, which is the trap). An errored source makes the bubble draw its
 * «Не удалось загрузить видео» panel instead of a circle, and there would be no
 * circle left to measure.
 *
 * So on that engine the response is held instead of refused. The element stays
 * at `readyState` 0 with no error, the circle renders at its own size in its
 * own black, and the boxes this spec hit-tests — the wrapper, the playback
 * button, the corner button — are exactly the ones a decoded clip would give.
 * The frames are worth less there; the paint order is worth the same.
 */
function holdsTheClip(browserName: string): boolean {
  return browserName === "webkit";
}

async function openConversation(page: Page, theme: "light" | "dark", browserName: string) {
  const seed = rows();
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  const hold = holdsTheClip(browserName);
  await page.route(`**${CIRCLE_URL}`, async (route) => {
    if (hold) await new Promise((resolve) => setTimeout(resolve, 30_000));
    await route
      .fulfill({ status: 200, contentType: "video/webm", body: clip as Buffer })
      .catch(() => undefined);
  });
  await openChat(page, "Команда проекта", "Сообщение 5:");
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
  await expect(page.getByTestId("sent-video-message-circle")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Puts the circle across a piece of chrome and reports what the engine painted
 * on top, at points inside the overlap.
 *
 * `overlapAtTop` scrolls the circle up under the header stack; the other way
 * round it is pushed down under the composer. The points are taken along the
 * circle's own horizontal middle band, where its box is widest, and only kept
 * when they are inside the chrome's box as well — a point in the gap between
 * two capsules still belongs to the chrome stack, which is the box a scrolling
 * message must not cover.
 */
async function whatIsOnTop(page: Page, chromeTestId: string, direction: "top" | "bottom") {
  // Three passes, because the list re-measures the chrome and re-anchors after
  // a scroll: one nudge lands short, and asking again from the new boxes is the
  // cheapest way to be sure the overlap is real rather than intended.
  for (let pass = 0; pass < 3; pass += 1) {
    const missed = await page.evaluate(
      ({ id, way }) => {
        const scroller = document.querySelector('[data-testid="message-scroll-container"]') as HTMLElement | null;
        const circle = document.querySelector('[data-testid="sent-video-message-circle"]') as HTMLElement | null;
        const chrome = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
        if (!scroller || !circle || !chrome) {
          return `missing box: scroller=${Boolean(scroller)} circle=${Boolean(circle)} chrome=${Boolean(chrome)}`;
        }
        const chromeBox = chrome.getBoundingClientRect();
        const circleBox = circle.getBoundingClientRect();
        // Half of the circle under the chrome, measured rather than guessed.
        const wanted = way === "top"
          ? chromeBox.bottom - circleBox.height / 2
          : chromeBox.top - circleBox.height / 2;
        scroller.scrollTop += circleBox.top - wanted;
        return null;
      },
      { id: chromeTestId, way: direction },
    );
    expect(missed, "the conversation did not lay out").toBeNull();
    await page.waitForTimeout(180);
  }

  return page.evaluate(
    ({ id }) => {
      const circle = document.querySelector('[data-testid="sent-video-message-circle"]') as HTMLElement | null;
      const chrome = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      if (!circle || !chrome) return { probed: 0, overCircle: [] as string[], overChrome: 0, overlap: "no box" };
      const circleBox = circle.getBoundingClientRect();
      const chromeBox = chrome.getBoundingClientRect();
      const top = Math.max(circleBox.top, chromeBox.top);
      const bottom = Math.min(circleBox.bottom, chromeBox.bottom);
      const left = Math.max(circleBox.left, chromeBox.left);
      const right = Math.min(circleBox.right, chromeBox.right);
      const overCircle: string[] = [];
      let probed = 0;
      let overChrome = 0;
      const describe = (node: Element) => {
        const tag = node.tagName.toLowerCase();
        const testId = node.getAttribute("data-testid");
        return testId ? `${tag}[${testId}]` : `${tag}.${(node.className || "").toString().split(" ")[0]}`;
      };
      for (let fx = 0.2; fx <= 0.81; fx += 0.2) {
        for (let fy = 0.25; fy <= 0.76; fy += 0.25) {
          const x = Math.round(left + (right - left) * fx);
          const y = Math.round(top + (bottom - top) * fy);
          if (x <= left || x >= right || y <= top || y >= bottom) continue;
          const hit = document.elementFromPoint(x, y);
          if (!hit) continue;
          probed += 1;
          if (circle.contains(hit)) overCircle.push(`${x},${y} -> ${describe(hit)}`);
          else if (chrome.contains(hit)) overChrome += 1;
        }
      }
      const box = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      return {
        probed,
        overCircle,
        overChrome,
        overlap: `circle ${box(circleBox)} / chrome ${box(chromeBox)} / overlap ${Math.round(right - left)}x${Math.round(bottom - top)}`,
      };
    },
    { id: chromeTestId },
  );
}

function shotPath(info: TestInfo, name: string): string {
  return `output/round-video-stacking/${name}-${info.project.name}.png`;
}

for (const theme of ["dark", "light"] as const) {
  test(`a round video scrolled under the chrome stays under it (${theme})`, async ({ page, request, browserName }, info) => {
    await requireFixtureServer(request);
    await openConversation(page, theme, browserName);

    const underHeader = await whatIsOnTop(page, "chat-chrome-stack", "top");
    await page.screenshot({ path: shotPath(info, `under-header-${theme}`) });
    const underComposer = await whatIsOnTop(page, "chat-composer-dock", "bottom");
    await page.screenshot({ path: shotPath(info, `under-composer-${theme}`) });

    // A vacuous pass is the failure mode worth guarding: no overlap, no points,
    // and every assertion below is satisfied by nothing.
    expect(underHeader.probed, `the circle never reached the header stack: ${underHeader.overlap}`).toBeGreaterThan(2);
    expect(underComposer.probed, `the circle never reached the composer dock: ${underComposer.overlap}`).toBeGreaterThan(2);

    expect(underHeader.overCircle, "the circle painted over the header stack").toEqual([]);
    expect(underComposer.overCircle, "the circle painted over the composer dock").toEqual([]);
    expect(underHeader.overChrome, "the header stack was not the topmost box anywhere").toBeGreaterThan(2);
    expect(underComposer.overChrome, "the composer dock was not the topmost box anywhere").toBeGreaterThan(2);
  });
}

test("the circle keeps its own order: the ring under the video, the corner button over it", async ({ page, request, browserName }) => {
  await requireFixtureServer(request);
  await openConversation(page, "dark", browserName);
  // In the clear, away from both pieces of chrome: this case is about the
  // circle's own three boxes, and a corner covered by the header would be the
  // fix working rather than the order failing.
  for (let pass = 0; pass < 3; pass += 1) {
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="message-scroll-container"]') as HTMLElement | null;
      const circle = document.querySelector('[data-testid="sent-video-message-circle"]') as HTMLElement | null;
      if (!scroller || !circle) return;
      const box = circle.getBoundingClientRect();
      scroller.scrollTop += box.top - (window.innerHeight - box.height) / 2;
    });
    await page.waitForTimeout(180);
  }

  const order = await page.evaluate(() => {
    const circle = document.querySelector('[data-testid="sent-video-message-circle"]') as HTMLElement | null;
    if (!circle) return null;
    const box = circle.getBoundingClientRect();
    const corner = circle.querySelector('button[aria-label="Открыть видео в просмотрщике"]');
    const cornerBox = corner?.getBoundingClientRect();
    const atCentre = document.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2));
    const atCorner = cornerBox
      ? document.elementFromPoint(Math.round(cornerBox.left + cornerBox.width / 2), Math.round(cornerBox.top + cornerBox.height / 2))
      : null;
    return {
      centreIsPlayback: atCentre?.closest('button[aria-label*="видео-сообщени"]') !== null,
      cornerIsOpen: Boolean(corner && atCorner && corner.contains(atCorner)),
      // In the circle's own corner, not somewhere else on the page: a box that
      // stopped being positioned keeps its hit test and loses its place, and
      // the assertion above would not notice.
      cornerInsideCircle: Boolean(
        cornerBox &&
        cornerBox.top >= box.top - 1 &&
        cornerBox.right <= box.right + 1 &&
        cornerBox.bottom <= box.bottom + 1,
      ),
      ringBehind: Boolean(
        circle.querySelector('[data-testid="video-message-progress-ring"]'),
      ),
    };
  });

  expect(order).not.toBeNull();
  // Dropping the z-indexes leaves tree order to do the same job; if it did not,
  // the corner button would stop being reachable, which is the cost that would
  // make the fix worse than the defect.
  expect(order!.cornerIsOpen, "the ↗ button is no longer the topmost box in its own corner").toBe(true);
  expect(order!.cornerInsideCircle, "the ↗ button left the circle's own corner").toBe(true);
  expect(order!.centreIsPlayback, "the circle's centre no longer belongs to the playback button").toBe(true);
  expect(order!.ringBehind).toBe(true);
});
