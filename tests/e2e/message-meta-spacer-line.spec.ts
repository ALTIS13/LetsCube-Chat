import { expect, test, type Page } from "@playwright/test";

/**
 * D-070: an inline timestamp's reserved room sits on the last line of text.
 *
 * When the time is inline it is positioned at the bubble's corner, and an
 * invisible spacer at the end of the paragraph keeps the last words out from
 * under it. The spacer is an inline box: where the last line has less room than
 * the spacer needs, it does not widen the bubble — it wraps, and the message
 * grows a line that holds nothing but the time. `data-message-meta-placement`
 * still reads `inline` and the time still lands on the bubble's bottom right,
 * so every check on the attribute, or on where the time finally sits, reported
 * those messages as correct. Measured before this spec existed: 5 of 120 at
 * 390, 4 at 360 and 4 on WebKit at 390.
 *
 * So the assertions here are about line boxes, which is what the reader pays
 * for: the spacer's box must lie on the line box of the last text line, and the
 * paragraph must hold no more line boxes than its text does. They are asked of
 * every message of a conversation long and varied enough that the cases occur
 * at the phone widths — a single fixed string lands in the window at one width
 * and not at the next.
 *
 * The reverse is asserted too. A decision that refused every close call would
 * pass the first test by giving the time a row it did not need, which is D-008.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";

const TEMPLATES = [
  "Коротко",
  "Средней длины сообщение, которое на телефоне переносится на две строки, а на широком экране остаётся в одной",
  "Да, согласен",
  "Это довольно длинное сообщение, которое обязательно перенесётся на несколько строк в обычном пузыре, а закончится совсем коротко. Да",
  "Хорошо, посмотрю сегодня вечером",
  "Ещё одно длинное сообщение, у которого последняя строка занята текстом почти целиком и места для времени в ней уже не остаётся никакого совсем",
  "Ок",
  "Встречаемся завтра в десять у главного входа, не опаздывай, пожалуйста",
  "Я отправил документы на почту, проверь, всё ли на месте и нет ли ошибок в расчётах за прошлый месяц",
  "Спасибо!",
  "Средней длины сообщение, которое на телефоне переносится на две строки, а на широком экране остаётся в одной",
  "Длинный абзац о планах на неделю: в понедельник созвон с командой, во вторник разбор задач, в среду демонстрация, в четверг ретроспектива, а в пятницу отдыхаем",
  "Можно подробнее про второй пункт?",
  "Первая строка\nВторая строка подлиннее\nТретья",
  "Отлично, тогда так и сделаем, я предупрежу остальных",
  "Уже выхожу",
  "Сегодня не получится, давай перенесём на четверг или на пятницу после обеда, если тебе удобно",
];

const COUNT = 120;

/**
 * Numbered, because the prefix shifts every line by a few pixels from one
 * repetition of a template to the next, and that spread is what puts some last
 * line inside the few pixels where the old ceiling and the real width disagree.
 * Two own messages in every five, so both sides of the conversation wrap.
 */
const MESSAGES = Array.from({ length: COUNT }, (_, index) => {
  const own = index % 5 === 1 || index % 5 === 2;
  return {
    sender: own ? "Максим" : "Аня",
    text: `${String(index + 1).padStart(3, "0")}. ${TEMPLATES[index % TEMPLATES.length]}`,
    time: `09:${String(index % 60).padStart(2, "0")}`,
    own,
  };
});

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [{ name: "Команда проекта", preview: "Коротко", time: "09:59", unread: 0 }],
  messages: MESSAGES,
};

async function openCapture(page: Page) {
  // The fixture refuses a message stamped later than "now", so the clock is
  // pinned exactly as the sibling meta specs pin it.
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;

  // Same rule as the sibling meta specs: a missing prerequisite fails loudly
  // rather than reporting success while enforcing nothing.
  if (!ready) {
    if (process.env.KUB_ALLOW_PREVIEW_FIXTURE_SKIP === "1") {
      test.skip(true, "preview fixture route unavailable and skipping was explicitly allowed");
      return;
    }
    throw new Error(
      response
        ? "The preview capture route did not report ready. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1, or set KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1 to accept that this contract goes unchecked."
        : "The DEV preview capture route is not served. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1, or set KUB_ALLOW_PREVIEW_FIXTURE_SKIP=1 to accept that this contract goes unchecked.",
    );
  }

  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-message-text-meta-group="true"]').length >= count,
    COUNT,
  );

  // The real face, not a frozen fallback: this is the layout a reader gets.
  // On Chromium, Inter arrives about 2s in and re-wraps the conversation —
  // measured, 28 of 120 placements move in the frame after `loadingdone` — so
  // the face is waited for first.
  await page
    .waitForFunction(
      () => Array.from(document.fonts).some((face) => face.family.replace(/["']/g, "") === "Inter" && face.status === "loaded"),
      undefined,
      { timeout: 10_000 },
    )
    // Offline, the face never comes. The contract holds in any face, so that
    // is not a reason to fail; the stability wait below still applies.
    .catch(() => undefined);
  // That is not enough on WebKit, which reports Inter loaded from the first
  // sample and still re-lays the conversation out once more, about 1.3s after
  // the capture route reports ready (six runs, 1317–1383ms). The state before
  // that moment has 21 wrapped spacers and 7 wrapped messages refused their
  // room, under the old rule and this one alike; after it, this rule has none
  // (three runs of three). A first draft that waited a second after `ready`
  // read that state and failed. So the layout has to hold still for longer
  // than the plateau lasts.
  await waitForSettledLayout(page);
}

/** Until placements and paragraph boxes are unchanged for 2.5 seconds. */
async function waitForSettledLayout(page: Page) {
  const signature = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-message-text-meta-group="true"]'))
        .map((group) => {
          const paragraph = group.querySelector("[data-message-text-flow]");
          const box = paragraph?.getBoundingClientRect();
          return `${group.getAttribute("data-message-meta-placement")}:${box ? Math.round(box.width) : 0}x${box ? Math.round(box.height) : 0}`;
        })
        .join("|"),
    );
  let previous = await signature();
  let unchanged = 0;
  for (let sample = 0; sample < 80 && unchanged < 10; sample += 1) {
    await page.waitForTimeout(250);
    const current = await signature();
    unchanged = current === previous ? unchanged + 1 : 0;
    previous = current;
  }
  expect(unchanged, "the conversation never stopped re-laying itself out").toBeGreaterThanOrEqual(10);
}

type Measured = {
  text: string;
  placement: string | null;
  textLines: number;
  explicitLines: number;
  paragraphLines: number;
  lastLine: number;
  paragraph: number;
  footer: number;
  spacer: number | null;
  spacerOnLastLine: boolean | null;
  timeOnLastLine: boolean;
};

function readMessages(page: Page): Promise<Measured[]> {
  return page.evaluate(() => {
    // Rects that share a line box, merged: the same grouping the component uses.
    const lineBoxes = (rects: DOMRect[]) => {
      const lines: { top: number; bottom: number; left: number; right: number }[] = [];
      for (const rect of rects) {
        if (rect.width <= 0.5 || rect.height <= 0.5) continue;
        const centre = (rect.top + rect.bottom) / 2;
        const line = lines.find((candidate) => {
          const candidateCentre = (candidate.top + candidate.bottom) / 2;
          return Math.abs(candidateCentre - centre) <= Math.max(4, Math.min(candidate.bottom - candidate.top, rect.height) * 0.7);
        });
        if (line) {
          line.top = Math.min(line.top, rect.top);
          line.bottom = Math.max(line.bottom, rect.bottom);
          line.left = Math.min(line.left, rect.left);
          line.right = Math.max(line.right, rect.right);
        } else {
          lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
        }
      }
      return lines.sort((a, b) => a.top - b.top);
    };
    const rectsOf = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects());
      range.detach();
      return rects;
    };
    const within = (rect: DOMRect, line: { top: number; bottom: number }) => {
      const centre = (rect.top + rect.bottom) / 2;
      return centre >= line.top - 1 && centre <= line.bottom + 1;
    };

    const out: Measured[] = [];
    for (const group of Array.from(document.querySelectorAll('[data-message-text-meta-group="true"]'))) {
      const paragraph = group.querySelector<HTMLElement>("[data-message-text-flow]");
      const content = group.querySelector<HTMLElement>('[data-message-text-content="true"]');
      const footer = group.querySelector<HTMLElement>('[data-message-footer="true"]');
      if (!paragraph || !content || !footer) continue;
      const text = lineBoxes(rectsOf(content));
      const last = text.at(-1);
      if (!last) continue;
      const spacer = group.querySelector<HTMLElement>('[data-message-footer-reserve="true"]');
      const spacerRect = spacer?.getBoundingClientRect() ?? null;
      const footerRect = footer.getBoundingClientRect();
      out.push({
        text: (content.textContent ?? "").slice(0, 40),
        placement: group.getAttribute("data-message-meta-placement"),
        textLines: text.length,
        explicitLines: content.querySelectorAll("br").length + 1,
        paragraphLines: lineBoxes(rectsOf(paragraph)).length,
        lastLine: last.right - last.left,
        paragraph: paragraph.getBoundingClientRect().width,
        footer: footerRect.width,
        spacer: spacerRect ? spacerRect.width : null,
        spacerOnLastLine: spacerRect ? within(spacerRect, last) : null,
        timeOnLastLine: within(footerRect, last),
      });
    }
    return out;
  });
}

const describe = (row: Measured) =>
  `"${row.text}…" ${row.textLines} lines of text in ${row.paragraphLines} line boxes, last line ${row.lastLine.toFixed(1)}px + spacer ${row.spacer ?? "none"} in a ${row.paragraph.toFixed(1)}px paragraph`;

test.describe("message meta spacer line", () => {
  // A 120-message conversation is read once it has held still for 2.5s. On
  // WebKit beside other suites that measured 15–23s a test, which is too close
  // to the default 45s to be a margin.
  test.describe.configure({ timeout: 90_000 });

  test("an inline time never costs its message a line", async ({ page }) => {
    await openCapture(page);
    const rows = await readMessages(page);
    expect(rows.length, "the conversation did not render").toBe(COUNT);

    const inline = rows.filter((row) => row.placement === "inline");
    // Wrapped text is where the spacer can wrap; without enough of it this
    // would pass by checking nothing.
    expect(
      inline.filter((row) => row.textLines > 1).length,
      "too few wrapped inline messages to exercise the spacer at this viewport",
    ).toBeGreaterThan(10);

    const unreserved = inline.filter((row) => row.spacer === null);
    expect(unreserved.map(describe), "an inline time with no room reserved for it").toEqual([]);

    const wrappedSpacers = inline.filter((row) => row.spacerOnLastLine === false);
    expect(
      wrappedSpacers.map(describe),
      "the room reserved for the time wrapped off the last line of text, so the message grew a line holding only the time",
    ).toEqual([]);

    const extraLine = inline.filter((row) => row.paragraphLines > row.textLines);
    expect(extraLine.map(describe), "the paragraph holds more line boxes than its text").toEqual([]);

    const displaced = inline.filter((row) => !row.timeOnLastLine);
    expect(displaced.map(describe), "an inline time that is not beside the last line of text").toEqual([]);
  });

  test("and no wrapped message is refused room it has", async ({ page }) => {
    await openCapture(page);
    const rows = await readMessages(page);
    expect(rows.length, "the conversation did not render").toBe(COUNT);

    // Wrapped by width, not by the author's line breaks: only then is the
    // paragraph as wide as the bubble can be, which is the room being claimed.
    const wrapped = rows.filter((row) => row.textLines > row.explicitLines);
    expect(wrapped.length, "no message wrapped at this viewport").toBeGreaterThan(10);

    // The spacer is the footer plus an 8px gap, rounded up, and holds its width
    // through a change of a pixel; a pixel of tolerance keeps a close call from
    // reading as a refusal.
    const refused = wrapped.filter(
      (row) => row.placement === "anchored" && row.lastLine + Math.ceil(row.footer + 8) + 1 < row.paragraph,
    );
    expect(
      refused.map(describe),
      "a wrapped message gave its time a row of its own although its last line had room for it",
    ).toEqual([]);
  });
});
