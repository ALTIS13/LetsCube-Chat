import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * D-216: the label on an icon button has to be readable where the button is.
 *
 * Reported by the owner on 2026-09-18: «сообщения при наведении на иконки с
 * функциями, сейчас их описания появляются под списком чатов».
 *
 * `KubTooltip` drew its bubble as a `position: absolute` span inside the
 * trigger's own wrapper. Absolute positioning is clipped by any ancestor with
 * `overflow: hidden`, and every one of its three call sites lives inside two of
 * them — the sidebar header block and `.kub-chat-list-column`. Measured at 1440
 * before the fix: the bell occupies y 10–46, its bubble was laid out at y 52–80,
 * and the header's edge cut everything below it away. What reached the screen
 * was a six-pixel sliver of a border sitting on the chat list and no word at
 * all.
 *
 * `components/ui/tooltip.tsx` had already been through this and says so in its
 * own comment. `KubTooltip` is a named shape of that one now.
 *
 * **What this spec asserts, and why it is not «the tooltip exists».** A clipped
 * tooltip is in the DOM, has the right text, and reports a sensible bounding
 * box — every cheap assertion passes over the defect. So the question asked
 * here is the one a person asks: *is the middle of the label actually the
 * thing on screen at that point.* `elementFromPoint` answers it, and it answers
 * it wrongly if the bubble is clipped, covered, or off the window.
 *
 * Everything here is fictional and mocked. No production screen is rendered.
 */

const AT = "2026-09-12T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT = "22222222-2222-4222-8222-000000000001";
const LINE = "Привет";

/** Whether this project is a phone, where the columns are screens. */
function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 768;
}

async function openApp(page: Page) {
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT, "group", "Команда проекта", AT)],
    memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT)],
    messages: [message("55555555-5555-4555-8555-000000000001", CHAT, ME, LINE, AT)],
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  // On a computer the conversation is opened so the header sits in its real
  // context beside it. On a phone the chat list IS the screen and opening a
  // chat pushes the header off it — which is how the first run of this spec
  // failed five tests at 390 on «the bell is not on screen», a fact about the
  // test rather than about the product.
  if (isPhone(page)) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Команда проекта").first()).toBeVisible();
  } else {
    await openChat(page, "Команда проекта", LINE);
  }
}

/**
 * The visible bubble, and whether its middle is what a person's pointer would
 * land on.
 *
 * Radix puts `role="tooltip"` on a 1x1 span for screen readers and draws the
 * bubble in a popper wrapper beside it. Measuring the first of those reported a
 * 1x1 box and would have read as a broken tooltip — so the wrapper is what is
 * measured, and the accessibility span is the fallback.
 */
async function readTooltip(page: Page) {
  return page.evaluate(() => {
    const wrapper = document.querySelector("[data-radix-popper-content-wrapper]");
    const bubble = (wrapper?.firstElementChild as HTMLElement | null) ?? null;
    if (!bubble) return { found: false as const };
    const rect = bubble.getBoundingClientRect();
    const centre = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    const hit = document.elementFromPoint(centre.x, centre.y);
    return {
      found: true as const,
      // The bubble's own text nodes, not `textContent` and not `innerText`.
      // Radix renders the word twice inside the content element — once to look
      // at and once in a visually hidden span that `aria-describedby` points at
      // — and the hidden one is hidden by clipping rather than by `display`, so
      // both of those APIs answer «Уведомления Уведомления». A test reading
      // either is measuring the library, not the screen. The visible label is
      // the direct text node this component passes as a child.
      text: [...bubble.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => (node.textContent ?? "").trim())
        .join("")
        .trim(),
      // Kept so the duplication is visible in a failure rather than surprising
      // the next person who reads this file.
      rawText: (bubble.textContent ?? "").trim(),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      centre,
      // The defect, stated as a measurement: with the bubble inside a clipped
      // column, the element at its middle is whatever the column is showing.
      hitIsTheBubble: Boolean(hit && (hit === bubble || bubble.contains(hit))),
      hitTag: hit ? hit.tagName.toLowerCase() : null,
      // Portalled out of the columns that clip. Kept separate from the hit test
      // because it names the cause rather than the symptom.
      insideAClippedColumn: Boolean(bubble.closest(".kub-chat-list-column")),
      insideTheViewport:
        rect.x >= 0 && rect.y >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
    };
  });
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

/**
 * Every call site of `KubTooltip`, not a sample.
 *
 * Three, and all three sit inside the two columns that clip: the folder rail on
 * the far left and the chat list's own header. A spec that covered only the
 * header would have left the rail's «Меню» clipped and looked complete.
 */
const ICONS = [
  { testId: "notification-bell-button", label: "Уведомления" },
  { testId: "sidebar-new-chat-button", label: "Новый чат" },
  { testId: "side-menu-button", label: "Меню" },
];

for (const icon of ICONS) {
  test(`«${icon.label}» is readable where its button is`, async ({ page }) => {
    await openApp(page);
    const button = page.getByTestId(icon.testId);

    if (isPhone(page)) {
      // A hover label is a pointer's affordance and Radix deliberately does not
      // open one from a touch, so the question on a phone is the other one: is
      // the function still named and still reachable.
      //
      // Not the same control, either — the folder rail is not on screen at 390
      // and the chat list's header carries «Меню» instead. So this asks by the
      // accessible name rather than by the test id, which is the question that
      // stays true when a width moves a control between columns.
      const named = page.getByRole("button", { name: icon.label, exact: true });
      await expect(
        named.first(),
        `nothing on the phone's first screen is named «${icon.label}»`,
      ).toBeVisible();
      const seenOnPhone = await readTooltip(page);
      expect(
        seenOnPhone.found,
        "a hover bubble appeared on a touch screen, where nothing can hover",
      ).toBe(false);
      return;
    }

    await expect(button, `${icon.testId} is not on screen at this width`).toBeVisible();
    await button.hover();

    await expect
      .poll(async () => (await readTooltip(page)).found, { timeout: 5_000 })
      .toBe(true);
    const seen = await readTooltip(page);
    if (!seen.found) throw new Error("unreachable");

    expect(seen.text).toBe(icon.label);
    expect(
      seen.insideAClippedColumn,
      "the bubble is back inside the column that clips it — it must be portalled",
    ).toBe(false);
    expect(
      seen.insideTheViewport,
      `the bubble is partly off the window at ${JSON.stringify(seen.rect)}`,
    ).toBe(true);
    expect(
      seen.hitIsTheBubble,
      `the middle of «${icon.label}» is not what is on screen there — ` +
        `${seen.hitTag} is, so the label is clipped or covered at ${JSON.stringify(seen.rect)}`,
    ).toBe(true);
  });
}

test("the bubble sits beside its button, not somewhere else on the page", async ({ page }) => {
  test.skip(
    (test.info().project.use.viewport?.width ?? 0) < 768,
    "a hover bubble is a pointer's affordance; the phone case is asserted above",
  );
  // Portalling moves the element into `body`, which is precisely the change that
  // could put it at the top left of the document instead of under the bell. So
  // the distance is measured rather than left to the library.
  await openApp(page);
  const bell = page.getByTestId("notification-bell-button");
  await bell.hover();
  await expect.poll(async () => (await readTooltip(page)).found, { timeout: 5_000 }).toBe(true);

  const seen = await readTooltip(page);
  if (!seen.found) throw new Error("unreachable");
  const button = await bell.boundingBox();
  expect(button).not.toBeNull();
  if (!button) throw new Error("unreachable");

  // Asked for `side="bottom"`: below the button, and horizontally overlapping it.
  expect(seen.rect.y, "the label is not below the button it belongs to").toBeGreaterThanOrEqual(
    Math.round(button.y + button.height) - 1,
  );
  expect(seen.rect.y - (button.y + button.height)).toBeLessThan(24);
  const overlaps =
    seen.rect.x < button.x + button.width && seen.rect.x + seen.rect.w > button.x;
  expect(overlaps, "the label is not under its own button horizontally").toBe(true);
});

/**
 * Boot the application in a theme, for real.
 *
 * Not `addInitScript`, and not a class stamped on `<html>` afterwards. The
 * fixture writes `kub-theme = "dark"` in its own init script, which runs after
 * any registered before it and wins; and stamping the document afterwards moves
 * the CSS tokens while React still holds «dark», so surfaces whose colour comes
 * from the class flip and surfaces that read the hook do not. The first light
 * capture taken that way was a hybrid — a light chat column against a dark rail
 * — and it was labelled «light». Caught by looking at the pixels, which is the
 * only thing that catches it.
 *
 * So the preference is written after the fixture has had its say, and the page
 * is reloaded so the application resolves it through its own code path.
 */
async function bootInTheme(page: Page, theme: "light" | "dark") {
  // Registered *after* the fixture's, because init scripts run in registration
  // order and the last writer wins. Writing the key with `evaluate` and
  // reloading is not enough on its own: the fixture's script runs again on the
  // reload and puts «dark» back, which is what the first attempt measured.
  await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.classList.contains("dark")), {
      timeout: 5_000,
    })
    .toBe(theme === "dark");
}

function shotPath(info: TestInfo, name: string): string {
  return `output/icon-tooltip/${name}-${info.project.name}.png`;
}

for (const theme of ["dark", "light"] as const) {
  test(`the label is photographed in the ${theme} theme`, async ({ page }, info) => {
    test.skip(
      (info.project.use.viewport?.width ?? 0) < 768,
      "there is no hover to photograph on a phone",
    );
    await openApp(page);
    await bootInTheme(page, theme);
    await expect(page.getByTestId("notification-bell-button")).toBeVisible();
    await page.getByTestId("notification-bell-button").hover();
    await expect.poll(async () => (await readTooltip(page)).found, { timeout: 5_000 }).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    await page.screenshot({ path: shotPath(info, `bell-${theme}`), fullPage: false });
  });
}
