#!/usr/bin/env node
/**
 * Renders the composer's recording gesture as it now works (D-130), in both
 * themes, on an iPhone and on a desktop, over the checked-in fictional
 * conversation.
 *
 * Five states, and they are the gesture's own: held at rest, held with the
 * pointer resting on «Отмена», locked hands-free, stopped for a listen, and the
 * hint a press too short to be a recording leaves behind.
 *
 * Every frame is the real application on the DEV preview route, driven by real
 * input — a finger's touch and drag on the iPhone, the mouse on the desktop —
 * and it measures what it shows before it is photographed: which phase the row
 * is in, what the timer reads, how full the lock rail is, whether the row has
 * moved at all — since 2026-09-12 it must not — where «Отмена» sits against the
 * middle of the composer and the rail against the middle of the record button,
 * and that exactly one microphone was opened and no camera.
 * The numbers go into results.json beside the pictures, so what the owner is
 * looking at is described by the frame rather than by me.
 *
 * The microphone is Chromium's fake device, so nothing real is recorded and no
 * permission dialog is ever shown. Nothing on a network is reached: every
 * request off this machine and the font host is aborted.
 *
 * It does not start a server. Point it at a dev server on the fixture
 * configuration (`VITE_SUPABASE_URL=http://127.0.0.1:54321`,
 * `VITE_PUBLIC_PREVIEW_FIXTURE=1`); it refuses anything else.
 *
 * Usage:
 *   KUB_BASE_URL=http://127.0.0.1:5310 node scripts/render-recording-frames.mjs
 *     [--only dark-iphone-3-locked,light-desktop-1-holding]
 *     [--sheets]
 *
 * Writes output/renders/2026-09-12-recording-gesture/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { chromium } = await import(
  pathToFileURL(path.join(ROOT, "node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs")).href
);
const sharp = createRequire(import.meta.url)("sharp");

const BASE = process.env.KUB_BASE_URL ?? "";
const OUT = path.join(ROOT, "output", "renders", "2026-09-12-recording-gesture");
const RESULTS_FILE = path.join(OUT, "results.json");
const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const CLOCK = new Date("2026-09-11T18:00:00+03:00");
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"]);

/** How long each frame lets the recording run, on the page's own clock. */
const RECORD_MS = 3_000;
/** The one distance the gesture is measured against, from lib/recordingGesture.ts. */
const LOCK_DRAG_PX = 72;

const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] ?? null : null;
};
const only = argValue("--only") ? new Set(argValue("--only").split(",").map((id) => id.trim())) : null;
const sheetsOnly = process.argv.includes("--sheets");

// ── the conversation ────────────────────────────────────────────────────────

const CHAT = "Витрина на Садовой";

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: CHAT, memberCount: 4 },
  chats: [
    { name: CHAT, preview: "И геопозицию для курьера", time: "17:52", unread: 0 },
    { name: "Аня Смирнова", preview: "До завтра!", time: "16:10", unread: 2 },
    { name: "Борис", preview: "Созвонимся вечером?", time: "15:20", unread: 0 },
  ],
  messages: [
    { sender: "Аня", text: "Добрый вечер! Монтаж закончили?", time: "17:31", own: false },
    { sender: "Максим", text: "Да, только что. Сейчас пришлю фото витрины и полок", time: "17:40", own: true },
    { sender: "Борис", text: "И вход сфотографируйте, пожалуйста", time: "17:46", own: false },
    { sender: "Вера", text: "Смету пришлите файлом, чтобы цифры не поплыли", time: "17:48", own: false },
    { sender: "Аня", text: "И геопозицию для курьера — он завтра везёт стенды", time: "17:52", own: false },
  ],
  recentReactions: ["👍", "🔥", "😂", "🎉", "😮", "🙏"],
};

// ── what is rendered ────────────────────────────────────────────────────────

const THEMES = [
  { id: "dark", title: "Тёмная тема" },
  { id: "light", title: "Светлая тема" },
];

const DEVICES = {
  iphone: {
    viewport: { width: 430, height: 932 },
    scale: 2,
    touch: true,
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
    standalone: true,
  },
  desktop: { viewport: { width: 1440, height: 900 }, scale: 1, touch: false, insets: null, standalone: false },
};

const STATE_LIST = [
  { id: "1-holding", title: "1. Удержание: идёт запись" },
  { id: "2-cancel", title: "2. Палец на «Отмена»: отпустить — отменить" },
  { id: "3-locked", title: "3. Закреплено: руки свободны" },
  { id: "4-paused", title: "4. Остановлено: можно прослушать" },
  { id: "5-hint", title: "5. Слишком короткое нажатие" },
];

const FRAMES = [];
for (const theme of THEMES) {
  for (const device of Object.keys(DEVICES)) {
    for (const state of STATE_LIST) {
      FRAMES.push({ id: `${theme.id}-${device}-${state.id}`, theme: theme.id, device, state: state.id });
    }
  }
}

const framePath = (id) => path.join(OUT, `frame-${id}.png`);

// ── driving the gesture ─────────────────────────────────────────────────────

/**
 * A finger or a mouse on the record button, as raw input rather than a
 * synthesized helper: the composer reads pointer events and captures the
 * pointer, so the frames have to come from something the browser itself
 * dispatches.
 */
function gesture(page, device, cdp) {
  const touch = device.touch;
  let origin = null;

  const press = async () => {
    const box = await page.locator('[data-testid="composer-recorder-button"]').boundingBox();
    if (!box) throw new Error("the record button is not on screen");
    origin = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    if (touch) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: origin.x, y: origin.y }] });
      // A finger has to stay down past the long press before it is a recording,
      // and that is a `setTimeout` — which the installed clock fakes. Waiting in
      // real time would never fire it, and the frame would photograph a composer
      // that had quietly not started recording, so the clock is advanced instead.
      await page.clock.runFor(400);
    } else {
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
    }
    // Real time, this one: the microphone resolves on its own clock, not the
    // page's, and the row cannot be read until it has.
    await page.waitForTimeout(400);
  };

  const moveTo = async (dx, dy) => {
    if (!origin) throw new Error("nothing is being held");
    const x = origin.x + dx;
    const y = origin.y + dy;
    if (touch) {
      // In steps, as a finger travels, so every threshold on the way is seen.
      for (let step = 1; step <= 6; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: Math.round(origin.x + (dx * step) / 6), y: Math.round(origin.y + (dy * step) / 6) }],
        });
        await page.waitForTimeout(24);
      }
    } else {
      await page.mouse.move(x, y, { steps: 6 });
    }
  };

  const release = async (dx = 0, dy = 0) => {
    if (!origin) return;
    const x = origin.x + dx;
    const y = origin.y + dy;
    if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    else await page.mouse.up({ x, y });
    origin = null;
  };

  /** Onto something on the screen, which is how the cancel is now reached. */
  const moveToElement = async (selector) => {
    if (!origin) throw new Error("nothing is being held");
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`${selector} is not on screen`);
    await moveTo(
      Math.round(box.x + box.width / 2) - origin.x,
      Math.round(box.y + box.height / 2) - origin.y,
    );
  };

  return { press, moveTo, moveToElement, release };
}

const STATES = {
  "1-holding": async (g, page) => {
    await g.press();
    await page.clock.runFor(RECORD_MS);
  },
  "2-cancel": async (g, page) => {
    await g.press();
    await page.clock.runFor(RECORD_MS);
    // Onto «Отмена» itself, where letting go throws the recording away. Nothing
    // slides and nothing is discarded on the way: what changes is the button
    // under the pointer, which turns red to say what the release will do.
    await g.moveToElement('[data-testid="composer-recording-cancel"]');
  },
  "3-locked": async (g, page) => {
    await g.press();
    await page.clock.runFor(RECORD_MS);
    await g.moveTo(0, -(LOCK_DRAG_PX + 24));
    await g.release(0, -(LOCK_DRAG_PX + 24));
    await page.clock.runFor(2_000);
  },
  "4-paused": async (g, page) => {
    await STATES["3-locked"](g, page);
    await page.locator('[data-testid="composer-locked-recording-stop"]').click();
    await page.locator('[data-testid="composer-recording-preview"]').waitFor({ state: "visible", timeout: 10_000 });
  },
  "5-hint": async (g, page) => {
    await g.press();
    // Long enough to be a hold, far short of a recording.
    await page.clock.runFor(400);
    await g.release();
    await page.locator('[data-testid="composer-short-press-hint"]').waitFor({ state: "visible", timeout: 10_000 });
  },
};

// ── the server the frames come from ─────────────────────────────────────────

/** The modules these renders depend on, as the server serves them now. */
const SERVED_MARKERS = [
  ["/src/components/chat/MessageInput.tsx", "ComposerRecordingRow"],
  ["/src/components/chat/MessageInput.tsx", "readRecordingHold"],
  ["/src/components/chat/ComposerRecordingRow.tsx", "data-recording-phase"],
  ["/src/components/chat/ComposerRecordingRow.tsx", "composer-recording-cancel"],
  // The stopped row's own controls, added with the correction of 2026-09-12: a
  // server serving the version before it would photograph «Отмена» where the
  // bin belongs and be reported as the version after it.
  ["/src/components/chat/ComposerRecordingRow.tsx", "composer-recording-trash"],
  ["/src/components/chat/ComposerRecordingRow.tsx", "composer-recording-bar"],
  ["/src/lib/recordingGesture.ts", "releaseRecording"],
  ["/src/lib/recordingGesture.ts", "overCancelButton"],
  ["/src/lib/recordingGesture.ts", "recordingRowControls"],
];

/**
 * And what must **not** be served any more.
 *
 * A stale module is the failure this whole script exists to avoid, and the
 * cheapest tell that the server is serving the work before the ruling is the
 * name of the function that moved the row sideways. Without this the frames
 * would photograph the old gesture and be reported as the new one.
 */
const RETIRED_MARKERS = [
  ["/src/lib/recordingGesture.ts", "slideFollowX"],
  ["/src/components/chat/ComposerRecordingRow.tsx", "followX"],
];

async function assertFixtureServer() {
  let url;
  try {
    url = new URL(BASE);
  } catch {
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5310");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port || url.pathname !== "/") {
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5310");
  }
  const client = await fetch(`${BASE}/src/lib/supabase/client.ts`).then((response) => response.text());
  if (!client.includes("127.0.0.1:54321")) throw new Error("The dev server is not on the fixture configuration.");
  for (const [modulePath, marker] of SERVED_MARKERS) {
    const served = await fetch(`${BASE}${modulePath}`).then((response) => response.text());
    if (!served.includes(marker)) throw new Error(`The dev server serves a stale ${modulePath} (no «${marker}»). Restart it.`);
    // A module Vite has hot-updated is served under a timestamped URL, and the
    // page then holds two copies of it. Stale code photographs as new code.
    if (served.includes("app.store.ts?t=")) throw new Error(`${modulePath} carries a hot-update URL. Restart the server.`);
  }
  for (const [modulePath, marker] of RETIRED_MARKERS) {
    const served = await fetch(`${BASE}${modulePath}`).then((response) => response.text());
    if (served.includes(marker)) {
      throw new Error(`The dev server still serves the slide («${marker}» in ${modulePath}). Restart it.`);
    }
  }
  const capture = await fetch(`${BASE}${CAPTURE_PATH}`);
  if (!capture.ok) throw new Error(`The capture route answered ${capture.status}.`);
}

// ── the track, in photographed pixels ───────────────────────────────────────

const srgb = (value) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const commonest = (points) => {
  const seen = points.filter(Boolean);
  if (!seen.length) return null;
  const tally = new Map();
  for (const p of seen) tally.set(p.join(","), (tally.get(p.join(",")) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
};

/**
 * The unplayed track, the capsule it is cut into and the accent, read off the
 * screen rather than off the tokens.
 *
 * A token value is not what a reader sees: this track is a fill on a
 * translucent capsule whose glass samples a blurred, patterned wallpaper, and
 * the whole reason the dark track had to be lightened is that the composite
 * came out one and a half values from the capsule while the token looked like a
 * well. Rule 7 of docs/operations/interface-material.md, pointed at a surface.
 *
 * Taken before the device chrome is drawn, so nothing painted for scale can be
 * sampled by mistake.
 */
async function trackPixels(page, device) {
  const plan = await page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const { left, top, right, bottom, width } = el.getBoundingClientRect();
      return { left, top, right, bottom, width };
    };
    return {
      row: box('[data-testid="composer-recording-lock-indicator"]'),
      bar: box('[data-testid="composer-recording-bar"]'),
      pill: box('[data-testid="composer-recording-preview-toggle"]'),
      playhead: box('[data-testid="composer-recording-playhead"]'),
    };
  });
  if (!plan.row || !plan.bar) return null;

  const shot = await page.screenshot({ animations: "disabled" });
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  const read = (x, y) => {
    const px = Math.round(x * device.scale);
    const py = Math.round(y * device.scale);
    if (px < 0 || py < 0 || px >= info.width || py >= info.height) return null;
    const at = (py * info.width + px) * info.channels;
    return [data[at], data[at + 1], data[at + 2]];
  };

  const barMidY = (plan.bar.top + plan.bar.bottom) / 2;
  // Right of the play pill and right of the playhead, where the track is bare.
  const from = Math.max(plan.pill ? plan.pill.right + 6 : plan.bar.left + 20, plan.bar.left + 20);
  const to = plan.bar.right - 6;
  const columns = [];
  for (let i = 0; i <= 10; i += 1) columns.push(from + ((to - from) * i) / 10);

  const track = commonest(columns.map((x) => read(x, barMidY)));
  // The capsule's own fill at the same columns, above the bar and below it.
  const sheet = commonest([
    ...columns.map((x) => read(x, plan.row.top + 6)),
    ...columns.map((x) => read(x, plan.row.bottom - 6)),
  ]);
  // The playhead is filled from the same token as the played part, so it is the
  // played colour measured without having to play anything.
  const accent = plan.playhead
    ? commonest([read((plan.playhead.left + plan.playhead.right) / 2, (plan.playhead.top + plan.playhead.bottom) / 2)])
    : null;
  if (!track || !sheet) return null;

  const step = Math.round((Math.abs(track[0] - sheet[0]) + Math.abs(track[1] - sheet[1]) + Math.abs(track[2] - sheet[2])) / 3);
  return {
    track: hex(track),
    sheet: hex(sheet),
    accent: accent ? hex(accent) : null,
    trackVsSheet: Number(ratio(track, sheet).toFixed(3)),
    accentVsTrack: accent ? Number(ratio(accent, track).toFixed(3)) : null,
    step,
    trackDarkerThanSheet: luminance(track) < luminance(sheet),
  };
}

/**
 * What the track has to be true of, on the owner's ruling of 2026-09-12: the
 * unplayed part must read as a track, and it must not be lightened so far that
 * it starts competing with the played part.
 *
 * The two floors are per theme because the themes are not each other's mirror
 * here. The dark theme's number is the one that was just won — it stood at
 * 1.048:1 and the bar was invisible — so a ratio floor catches a revert to
 * --kub-inset. The light theme was already right and its step is carried by hue
 * rather than by lightness, so a ratio floor there would fail a working sheet;
 * what is pinned instead is the direction, that its well still goes down.
 */
function trackVerdict(frame, pixels) {
  if (frame.state !== "4-paused") return [];
  if (!pixels) return ["the track could not be photographed"];
  const problems = [];
  if (frame.theme === "dark") {
    if (pixels.trackVsSheet < 1.5) {
      problems.push(`the unplayed track is ${pixels.trackVsSheet}:1 against the capsule, which is a hairline again`);
    }
  } else if (!pixels.trackDarkerThanSheet) {
    problems.push("the light theme's track is no longer a well in the capsule");
  }
  // Both themes: the played part has to stay tellable from the unplayed one,
  // which is the whole meaning of a progress bar. 3:1 is the floor a graphical
  // object has to clear to be distinguishable.
  if (pixels.accentVsTrack !== null && pixels.accentVsTrack < 3) {
    problems.push(`the played part is ${pixels.accentVsTrack}:1 against the track, so the bar stops reading as progress`);
  }
  return problems;
}

/** What the frame shows, read off the page rather than assumed. */
async function measure(page, frame) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-testid="composer-recording-lock-indicator"]');
    const button = document.querySelector('[data-testid="composer-recorder-button"]');
    const hint = document.querySelector('[data-testid="composer-short-press-hint"]');
    const rail = document.querySelector('[data-testid="composer-recording-lock-progress"]');
    const cancel = document.querySelector('[data-testid="composer-recording-cancel"]');
    // The stopped row's own four: the bin at the left edge, the bar across the
    // width, the play control on it, and the send at the right.
    const trash = document.querySelector('[data-testid="composer-recording-trash"]');
    const bar = document.querySelector('[data-testid="composer-recording-bar"]');
    const playToggle = document.querySelector('[data-testid="composer-recording-preview-toggle"]');
    const send = document.querySelector('[data-testid="composer-recording-send"]');
    const probe = window.__recordingProbe ?? { audio: -1, video: -1 };
    const rowBox = row?.getBoundingClientRect();
    const styles = row ? getComputedStyle(row) : null;
    const cancelBox = cancel?.getBoundingClientRect();
    const trashBox = trash?.getBoundingClientRect();
    const barBox = bar?.getBoundingClientRect();
    const playBox = playToggle?.getBoundingClientRect();
    const sendBox = send?.getBoundingClientRect();
    const railBox = document
      .querySelector('[data-testid="composer-recording-lock-rail"]')
      ?.getBoundingClientRect();
    // The composer's own row is this row's parent, which is how the two offsets
    // below are taken without a selector carrying an escaped slash.
    const composerBox = row?.parentElement?.getBoundingClientRect();
    const buttonBox = button?.getBoundingClientRect();
    const centreX = (box) => (box ? (box.left + box.right) / 2 : null);
    return {
      phase: row?.getAttribute("data-recording-phase") ?? null,
      hold: row?.getAttribute("data-recording-hold") ?? null,
      mode: row?.getAttribute("data-recording-row") ?? null,
      timer: row?.querySelector('[data-testid="composer-recording-timer"]')?.textContent?.trim() ?? null,
      spoken: row?.querySelector('[data-testid="composer-recording-state"]')?.textContent?.trim() ?? null,
      cancelArmed: row?.getAttribute("data-cancel-armed") ?? null,
      lockFill: rail?.getAttribute("data-lock-progress") ?? null,
      transform: styles?.transform ?? null,
      opacity: styles?.opacity ?? null,
      rowWidth: rowBox ? Math.round(rowBox.width) : null,
      composerWidth: composerBox ? Math.round(composerBox.width) : null,
      // The two geometric claims this work makes, measured rather than asserted:
      // «Отмена» stands in the middle of the composer, and the lock rail stands
      // over the middle of the record button.
      cancelOffCentrePx:
        cancelBox && composerBox ? Math.round(centreX(cancelBox) - centreX(composerBox)) : null,
      railOffButtonPx: railBox && buttonBox ? Math.round(centreX(railBox) - centreX(buttonBox)) : null,
      railHeight: railBox ? Math.round(railBox.height) : null,
      recorderButtonOnScreen: Boolean(button),
      railOnScreen: Boolean(railBox),
      preview: Boolean(document.querySelector('[data-testid="composer-recording-preview"]')),
      cancelControl: Boolean(cancel),
      sendControl: Boolean(send),
      // The stopped row, measured rather than described: the bin against the
      // row's left edge, the send against its right, how much of the row the
      // bar takes, and whether the play control is on that bar near its middle.
      trashControl: Boolean(trash),
      trashOffRowLeftPx: trashBox && rowBox ? Math.round(trashBox.left - rowBox.left) : null,
      sendOffRowRightPx: sendBox && rowBox ? Math.round(rowBox.right - sendBox.right) : null,
      barShareOfRowPct:
        barBox && rowBox && rowBox.width > 0 ? Math.round((barBox.width / rowBox.width) * 100) : null,
      playOffRowCentrePx: playBox && rowBox ? Math.round(centreX(playBox) - centreX(rowBox)) : null,
      playOnBar: playBox && barBox ? playBox.left >= barBox.left && playBox.right <= barBox.right : null,
      length: document.querySelector('[data-testid="composer-recording-length"]')?.textContent?.trim() ?? null,
      hint: hint?.textContent?.trim() ?? null,
      // Nothing may be waiting in the tray: a released recording is sent, and a
      // cancelled one is gone.
      trayItems: document.querySelectorAll('[data-testid="staged-attachment-item"]').length,
      audioOpened: probe.audio,
      videoOpened: probe.video,
    };
  });
}

/** What each state must be true of, checked before the picture is taken. */
function verdict(frame, found) {
  const problems = [];
  const expected = {
    "1-holding": "holding",
    "2-cancel": "holding",
    "3-locked": "locked",
    "4-paused": "paused",
    "5-hint": null,
  }[frame.state];

  if (found.phase !== expected) problems.push(`phase ${found.phase}, expected ${expected}`);
  if (found.trayItems !== 0) problems.push(`${found.trayItems} item(s) waiting in the tray`);
  if (found.videoOpened !== 0) problems.push(`a camera was opened ${found.videoOpened} time(s)`);

  if (frame.state === "5-hint") {
    if (!found.hint) problems.push("no hint was left beside the button");
    if (!found.recorderButtonOnScreen) problems.push("the record button is gone");
    return problems;
  }

  if (found.audioOpened !== 1) problems.push(`the microphone was opened ${found.audioOpened} time(s)`);

  // The owner's ruling of 2026-09-12, on every state that has a row: nothing
  // slides and nothing fades. This is the old check inverted — the script used
  // to *require* the row to have moved in the state that slid, and to have
  // faded along with it.
  if (found.transform && found.transform !== "none") problems.push(`the row has moved: ${found.transform}`);
  if (found.opacity !== null && Number(found.opacity) < 1) problems.push(`the row is faded to ${found.opacity}`);

  // One way out per state, and which control it is belongs to the state — the
  // correction of 2026-09-12, from the owner's screenshot of Telegram Desktop's
  // stopped recording. «Отмена» stands while the recording is still running,
  // near the middle of the composer; the bin stands once it has stopped, and
  // then «Отмена» must be gone. A row carrying both, or neither, fails here.
  if (frame.state === "4-paused") {
    if (found.cancelControl) problems.push("the stopped row still carries «Отмена»");
    if (!found.trashControl) problems.push("the stopped row has no bin to throw the recording away with");
  } else {
    if (found.trashControl) problems.push("a running recording carries a bin as well as «Отмена»");
    if (!found.cancelControl) problems.push("the row has no «Отмена»");
    // While the finger is down the row is 52 points narrower than the composer
    // — the record button and its gap, which stay under the thumb — so the
    // button sits about half of that to the left; locked, the row is the whole
    // composer.
    const allowedOffCentre = frame.state === "3-locked" ? 8 : 28;
    if (found.cancelOffCentrePx === null) problems.push("«Отмена» could not be measured");
    else if (Math.abs(found.cancelOffCentrePx) > allowedOffCentre) {
      problems.push(`«Отмена» is ${found.cancelOffCentrePx}px off the composer's centre`);
    }
  }

  if (frame.state !== "4-paused") {
    if (!/^[0-9][0-9]:[0-9][0-9],[0-9]$/.test(found.timer ?? "")) {
      problems.push(`the timer reads ${JSON.stringify(found.timer)}, which is not MM:SS,d`);
    }
    if (/^00:00,/.test(found.timer ?? "")) problems.push("the timer never moved");
  }

  if (frame.state === "1-holding" || frame.state === "2-cancel") {
    if (!found.railOnScreen) problems.push("the lock rail is not drawn");
    else if (found.railOffButtonPx === null) problems.push("the lock rail could not be measured");
    else if (Math.abs(found.railOffButtonPx) > 2) {
      problems.push(`the rail is ${found.railOffButtonPx}px off the record button's centre`);
    }
    if (!found.recorderButtonOnScreen) problems.push("the button left from under the finger");
  }
  if (frame.state === "1-holding" && found.cancelArmed !== "false") {
    problems.push("«Отмена» is armed with the pointer nowhere near it");
  }
  if (frame.state === "2-cancel" && found.cancelArmed !== "true") {
    problems.push("the pointer is resting on «Отмена» and it is not armed");
  }
  if (frame.state === "3-locked") {
    if (found.lockFill !== null) problems.push("the lock rail is still drawn after locking");
    if (!found.sendControl) problems.push("the locked row has no send");
    if (found.recorderButtonOnScreen) problems.push("the record button is still there with the finger gone");
  }
  if (frame.state === "4-paused") {
    if (!found.preview) problems.push("there is nothing to listen to");
    if (!found.sendControl) problems.push("the paused row has no send");
    // Telegram's stopped row, as four measurements rather than four adjectives:
    // the bin at the left edge, the send at the right, the bar taking the width
    // between them, and the play control with the length **on** that bar rather
    // than beside it.
    if (found.trashOffRowLeftPx === null || found.trashOffRowLeftPx > 8) {
      problems.push(`the bin is ${found.trashOffRowLeftPx}px from the row's left edge`);
    }
    if (found.sendOffRowRightPx === null || found.sendOffRowRightPx > 8) {
      problems.push(`the send is ${found.sendOffRowRightPx}px from the row's right edge`);
    }
    if (found.barShareOfRowPct === null || found.barShareOfRowPct < 55) {
      problems.push(`the bar takes ${found.barShareOfRowPct}% of the row, which is not "the width"`);
    }
    if (found.playOnBar !== true) problems.push("the play control is not on the bar");
    if (found.playOffRowCentrePx === null || Math.abs(found.playOffRowCentrePx) > 24) {
      problems.push(`the play control is ${found.playOffRowCentrePx}px off the row's centre`);
    }
    if (!/^[0-9]+:[0-9][0-9]$/.test(found.length ?? "")) {
      problems.push(`the length reads ${JSON.stringify(found.length)}, which is not M:SS`);
    }
  }
  return problems;
}

async function renderFrame(browser, frame) {
  const device = DEVICES[frame.device];
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.scale,
    hasTouch: device.touch,
    isMobile: device.touch,
    colorScheme: frame.theme,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    permissions: ["microphone", "camera"],
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol !== "http:" && url.protocol !== "https:") return route.continue();
    return ALLOWED_HOSTS.has(url.hostname) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/ERR_CONNECTION_REFUSED|ERR_FAILED|websocket|Failed to load resource/i.test(text)) return;
    errors.push(text);
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: device.insets ?? { top: 0, right: 0, bottom: 0, left: 0 } });
  // Controllable rather than frozen: the conversation's times are worked out
  // once at load, and the recording's own clock is then advanced deliberately,
  // so a timer reads a real number instead of standing at zero.
  await page.clock.install({ time: CLOCK });
  await page.addInitScript(
    ({ key, fixture, theme, standalone }) => {
      if (standalone) {
        try {
          Object.defineProperty(Navigator.prototype, "standalone", { configurable: true, get: () => true });
        } catch {
          /* the media query below still answers */
        }
        const native = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const compact = String(query).split(" ").join("").toLowerCase();
          if (!compact.includes("(display-mode:")) return native(query);
          const mode = compact.split("(display-mode:")[1].split(")")[0];
          return {
            matches: mode === "standalone",
            media: String(query),
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent: () => false,
          };
        };
      }
      // Which devices the page opened, and of what kind: a voice recording must
      // ask for a microphone and never for a camera.
      const probe = { audio: 0, video: 0 };
      window.__recordingProbe = probe;
      if (navigator.mediaDevices?.getUserMedia) {
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (constraints) => {
          if (constraints?.audio) probe.audio += 1;
          if (constraints?.video) probe.video += 1;
          return getUserMedia(constraints);
        };
      }
      window[key] = fixture;
      localStorage.setItem("kub-theme", theme);
    },
    { key: WINDOW_KEY, fixture: FIXTURE, theme: frame.theme, standalone: device.standalone },
  );

  await page.goto(`${BASE}${CAPTURE_PATH}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-public-preview-ready="true"]').waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const inter = await page.evaluate(() => document.fonts.check("16px Inter"));
  await page.waitForTimeout(1_500);

  await STATES[frame.state](gesture(page, device, cdp), page);
  await page.waitForTimeout(400);

  const found = await measure(page, frame);
  const problems = verdict(frame, found);
  if (problems.length) throw new Error(`${frame.id}: ${problems.join("; ")}`);

  // The track, photographed before the device chrome goes on, so nothing drawn
  // for scale can be sampled as if it were part of the row.
  const pixels = await trackPixels(page, device);
  const trackProblems = trackVerdict(frame, pixels);
  if (trackProblems.length) throw new Error(`${frame.id}: ${trackProblems.join("; ")}`);

  if (device.touch) await drawDeviceChrome(page, frame.theme, device);
  await page.screenshot({ path: framePath(frame.id), animations: "disabled" });
  await context.close();
  return { id: frame.id, inter, errors, ...found, track: pixels };
}

/** The status bar, the island and the home indicator, drawn over the page for scale. */
async function drawDeviceChrome(page, theme, device) {
  await page.evaluate(
    ({ theme, width, top }) => {
      const ink = theme === "dark" ? "#FFFFFF" : "#000000";
      const side = (width - 126) / 2;
      const layer = document.createElement("div");
      layer.setAttribute("aria-hidden", "true");
      layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
      layer.innerHTML =
        `<div style="position:absolute;left:${side}px;top:11px;width:126px;height:37px;border-radius:19px;background:#000"></div>` +
        `<div style="position:absolute;left:0;top:0;width:${side}px;height:${top}px;display:flex;align-items:center;justify-content:center;font:600 17px/1 Inter,-apple-system,sans-serif;letter-spacing:-0.2px;color:${ink}">18:00</div>` +
        `<div style="position:absolute;left:${(width - 134) / 2}px;bottom:8px;width:134px;height:5px;border-radius:3px;background:${ink}"></div>`;
      document.body.appendChild(layer);
    },
    { theme, width: device.viewport.width, top: device.insets.top },
  );
}

// ── the sheets ──────────────────────────────────────────────────────────────

const INK = "#10233b";
const MUTED = "#3a4f66";
const PAPER = "#e9eef4";
const FONT_FILE = existsSync("C:/Windows/Fonts/segoeui.ttf") ? "C:/Windows/Fonts/segoeui.ttf" : undefined;

const escapeMarkup = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function text(markup, { size = 20, width, colour = INK } = {}) {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${colour}">${markup}</span>`,
      font: `Segoe UI ${size}`,
      ...(FONT_FILE ? { fontfile: FONT_FILE } : {}),
      rgba: true,
      dpi: 96,
      ...(width ? { width, wrap: "word" } : {}),
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

async function tile(file, cell) {
  const radius = 14;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cell.width}" height="${cell.height}"><rect width="${cell.width}" height="${cell.height}" rx="${radius}" ry="${radius}"/></svg>`,
  );
  if (!file || !existsSync(file)) {
    return sharp({ create: { width: cell.width, height: cell.height, channels: 4, background: "#d5dde7" } })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  }
  let image = sharp(file);
  if (cell.crop) image = image.extract(cell.crop);
  const resized = await image.resize({ width: cell.width, height: cell.height, fit: "cover", position: "bottom" }).png().toBuffer();
  return sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

async function buildSheet({ file, title, subtitle, columns, rows, cell }) {
  const margin = 32;
  const gap = 20;
  const width = margin * 2 + columns.length * cell.width + (columns.length - 1) * gap;
  const titleImage = await text(`<b>${escapeMarkup(title)}</b>`, { size: 26, width: width - margin * 2 });
  const subtitleImage = await text(escapeMarkup(subtitle), { size: 15, width: width - margin * 2, colour: MUTED });
  const columnImages = await Promise.all(columns.map((column) => text(`<b>${escapeMarkup(column)}</b>`, { size: 18, width: cell.width })));
  const columnHeight = Math.max(...columnImages.map((image) => image.height));
  const rowImages = await Promise.all(rows.map((row) => text(escapeMarkup(row.label), { size: 15, colour: MUTED })));
  const rowLabelHeight = Math.max(...rowImages.map((image) => image.height));

  const layers = [];
  let y = margin;
  layers.push({ input: titleImage.input, left: margin, top: y });
  y += titleImage.height + 6;
  layers.push({ input: subtitleImage.input, left: margin, top: y });
  y += subtitleImage.height + 18;
  columnImages.forEach((image, index) => layers.push({ input: image.input, left: margin + index * (cell.width + gap), top: y }));
  y += columnHeight + 10;
  for (const [rowIndex, row] of rows.entries()) {
    layers.push({ input: rowImages[rowIndex].input, left: margin, top: y });
    y += rowLabelHeight + 6;
    for (const [index, frameFile] of row.frames.entries()) {
      const left = margin + index * (cell.width + gap);
      const frame = await tile(frameFile, cell);
      const edge = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${cell.width + 2}" height="${cell.height + 2}"><rect x="0.5" y="0.5" width="${cell.width + 1}" height="${cell.height + 1}" rx="15" ry="15" fill="#c3cfdc"/></svg>`,
      );
      layers.push({ input: edge, left: left - 1, top: y - 1 });
      layers.push({ input: frame, left, top: y });
    }
    y += cell.height + gap;
  }
  const height = y + margin - gap;
  await sharp({ create: { width, height, channels: 3, background: PAPER } }).composite(layers).png().toFile(file);
  console.log(`sheet: ${path.relative(ROOT, file)} ${width}x${height}`);
  return { file, width, height };
}

const SHEET_NOTE =
  "Настоящие компоненты приложения на DEV-маршруте, вымышленная переписка, микрофон — тестовое устройство Chromium. " +
  "Строка больше никуда не съезжает. Пока запись идёт: слева точка и время, посередине «Отмена», справа отправка. " +
  "Удержание записывает; запись отменяют, отпустив палец на «Отмена» (мышью — клик по ней); отпускание в любом " +
  "другом месте отправляет, а не кладёт во вложения. Сдвиг вверх за 72 точки закрепляет запись: рейка фиксации — " +
  "капсула с замком и шевроном над кнопкой записи, теперь и на компьютере. Закреплённую запись можно остановить — " +
  "и остановленная строка собрана как в Telegram: слева корзина, дальше полоса на всю ширину с плеером «▶ 0:03» " +
  "прямо на ней, справа синяя отправка, а «Отмена» в этом состоянии уже нет. " +
  "Время идёт с десятыми долями, как в Telegram Desktop; у остановленной записи это длина, а не часы. " +
  "Слишком короткое нажатие оставляет подсказку у кнопки вместо модального окна. " +
  "Показан нижний край экрана — там, где находится строка ввода.";

/**
 * Each cell's shape matches its crop's exactly.
 *
 * `sharp`'s `cover` fit trims the sides to reach the cell's ratio, so a cell
 * shaped differently from what it is given silently cuts the picture — which is
 * what took the timer off the left of the first sheet. Cell height is therefore
 * derived from the crop rather than chosen.
 */
const cellFor = (width, crop) => ({ width, height: Math.round((width * crop.height) / crop.width), crop });

const DEVICE_SHEETS = {
  iphone: {
    label: "iPhone 430",
    // The bottom two fifths of the screen: the last messages and the composer,
    // which is the only part of the page this work changes.
    cell: cellFor(340, { left: 0, top: 1104, width: 860, height: 760 }),
    subtitle: "iPhone 430×932, режим установленного приложения; статус-бар и полоска «домой» дорисованы для масштаба.",
  },
  desktop: {
    label: "компьютер",
    // A desktop frame is wide, so its states run down the sheet and the two
    // themes across it. Five narrow columns scaled the composer's own words to
    // about seven pixels, which is a picture nobody can judge.
    statesDownTheSheet: true,
    cell: cellFor(900, { left: 380, top: 640, width: 1060, height: 260 }),
    subtitle: "Окно 1440×900; показан низ переписки со строкой ввода.",
  },
};

async function buildSheets() {
  const sheets = [];
  for (const [device, spec] of Object.entries(DEVICE_SHEETS)) {
    const rows = spec.statesDownTheSheet
      ? STATE_LIST.map((state) => ({
          label: state.title,
          frames: THEMES.map((theme) => framePath(`${theme.id}-${device}-${state.id}`)),
        }))
      : THEMES.map((theme) => ({
          label: theme.title,
          frames: STATE_LIST.map((state) => framePath(`${theme.id}-${device}-${state.id}`)),
        }));
    const columns = spec.statesDownTheSheet
      ? THEMES.map((theme) => theme.title)
      : STATE_LIST.map((state) => state.title);
    sheets.push(
      await buildSheet({
        file: path.join(OUT, `sheet-${device}.png`),
        title: `Запись голосового · ${spec.label}`,
        subtitle: `${spec.subtitle} ${SHEET_NOTE}`,
        columns,
        rows,
        cell: spec.cell,
      }),
    );
  }
  const tallest = Math.max(...sheets.map((sheet) => sheet.height));
  if (tallest > 2200) throw new Error(`A sheet is ${tallest}px tall; keep each under 2200 to read on a phone.`);
  return sheets;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const failures = [];
  const results = existsSync(RESULTS_FILE) ? JSON.parse(readFileSync(RESULTS_FILE, "utf8")) : {};
  if (!sheetsOnly) {
    await assertFixtureServer();
    // The full Chromium build, not the headless shell, which does not frost a
    // scrolling container under backdrop-filter — the glass would photograph
    // as a flat tint. The fake microphone means nothing real is ever recorded.
    const browser = await chromium.launch({
      channel: "chromium",
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    });
    try {
      for (const frame of FRAMES) {
        if (only && !only.has(frame.id)) continue;
        try {
          const result = await renderFrame(browser, frame);
          results[frame.id] = result;
          console.log(
            `${frame.id}: ok phase=${result.phase} timer=${result.timer ?? "-"} lock=${result.lockFill ?? "-"} ` +
              `armed=${result.cancelArmed ?? "-"} offCentre=${result.cancelOffCentrePx ?? "-"} ` +
              `rail=${result.railOffButtonPx ?? "-"}/${result.railHeight ?? "-"} ` +
              `said=${JSON.stringify(result.spoken ?? result.hint ?? "")} mic=${result.audioOpened} cam=${result.videoOpened}` +
              `${
                result.track
                  ? ` track=${result.track.track} on ${result.track.sheet} ${result.track.trackVsSheet}:1 ` +
                    `step=${result.track.step} played=${result.track.accentVsTrack}:1`
                  : ""
              }` +
              `${result.errors.length ? ` errors: ${JSON.stringify(result.errors)}` : ""}`,
          );
        } catch (error) {
          failures.push(frame.id);
          console.error(`${frame.id}: FAILED ${error instanceof Error ? error.message.split(String.fromCharCode(10))[0] : error}`);
        }
      }
    } finally {
      await browser.close();
    }
    writeFileSync(RESULTS_FILE, `${JSON.stringify(results, null, 2)}${String.fromCharCode(10)}`);
  }
  await buildSheets();
  if (failures.length) {
    console.error(`failed: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

await main();
