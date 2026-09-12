import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * D-162: a casual hint must never take a tap meant for what is underneath it.
 *
 * This shipped in `8629549` and was live on production until 2026-09-13. A
 * member of staff on a phone could not open a chat while the administration
 * hint was showing: `KubHint` renders through a Radix popover, a popover is a
 * dismissable layer, and the layer kept every pointer event that landed on its
 * rectangle. It was found by a signed-in run whose two scroll contracts timed
 * out on `locator.click`, with Playwright naming the plate itself.
 *
 * The unit guard beside the fix asserts the two classes are present in the
 * source. It was **green while the defect was alive** — a class in a file says
 * nothing about whether a tap arrives. So this one presses.
 *
 * Two earlier shapes of this test were wrong, and both are worth stating
 * because each would have gone green while proving nothing:
 *
 *  1. It first reproduced the *search-syntax* hint instead, on the belief that
 *     `person()` fixes every account to `role: "user"` and the staff-only
 *     administration hint was therefore out of reach. It does — but the store
 *     reads the profile row this fixture serves, so seeding `role: "manager"`
 *     brings the real hint back. Measured at 390: the search plate ends at 235
 *     and the first result begins at 229, so it covered six pixels of a row's
 *     top edge; the administration plate covers 52 of 68.
 *  2. Its precondition then asked whether the two rectangles *overlapped*.
 *     That is not the question. Playwright presses an element's centre, and a
 *     six-pixel overlap leaves that centre in the clear — the press would have
 *     landed with the defect fully present. What has to be true is that the
 *     **point that gets pressed** lies under the plate.
 *
 * So the order here is: prove the press point is covered, then press.
 *
 * Needs the dev server on the fixture host.
 */

const AT = "2026-09-13T09:00:00.000Z";
const PLAIN = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");

/**
 * A manager, because the administration hint is offered to staff alone.
 * `useUser` puts the `profiles` row straight into the store and `useRole`
 * reads `currentUser.role`, so this is all it takes — no permission rows.
 */
const ME = { ...PLAIN, role: "manager" } as typeof PLAIN;
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");

const TITLES = ["Команда проекта", "Витрина и смета", "Поставщики", "Бухгалтерия", "Ремонт зала"];

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  const chats: Row[] = [];
  const memberships: Row[] = [];
  const messages: Row[] = [];
  TITLES.forEach((title, index) => {
    const id = "22222222-2222-4222-8222-" + String(index + 1).padStart(12, "0");
    chats.push(chat(id, "group", title, AT));
    memberships.push(membership(id, ME, "owner", AT), membership(id, ANNA, "member", AT));
    messages.push(
      message(
        "55555555-5555-4555-8555-" + String(index + 1).padStart(12, "0"),
        id,
        ANNA,
        "Смета " + title + " готова",
        new Date(Date.parse(AT) + index * 60_000).toISOString(),
      ),
    );
  });
  return { chats, memberships, messages };
}

interface Geometry {
  covered: boolean;
  plate: string;
  row: string;
  centre: string;
}

/** Where the plate is, where the first row's press point is, and whether one is over the other. */
async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const say = (r: DOMRect | null) =>
      r ? "x " + Math.round(r.left) + ".." + Math.round(r.right) + ", y " + Math.round(r.top) + ".." + Math.round(r.bottom) : "absent";
    const plateEl = document.querySelector('[data-testid="kub-hint"]');
    const rowEl = document.querySelector('[data-testid="chat-list-item"]');
    const plate = plateEl ? plateEl.getBoundingClientRect() : null;
    const row = rowEl ? rowEl.getBoundingClientRect() : null;
    if (!plate || !row) {
      return { covered: false, plate: say(plate), row: say(row), centre: "unknown" };
    }
    // Playwright presses the centre of the element unless told otherwise.
    const x = row.left + row.width / 2;
    const y = row.top + row.height / 2;
    return {
      covered: x >= plate.left && x <= plate.right && y >= plate.top && y <= plate.bottom,
      plate: say(plate),
      row: say(row),
      centre: Math.round(x) + ", " + Math.round(y),
    };
  });
}

test.describe("a hint does not take the tap", () => {
  test("a chat row under the plate still answers the press", async ({ page, request }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("mobile"),
      "the entry is md:hidden, so the hint that covered the list exists only on a phone",
    );
    await requireFixtureServer(request);
    const seed = rows();
    await openFixture(page, { me: ME, chats: seed.chats, memberships: seed.memberships, messages: seed.messages });

    // `openFixture` mocks the network; it does not open the page. Without this
    // the browser stays on about:blank and every locator below times out on a
    // document that was never there.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(TITLES.length);

    // The staff entry, and with it the hint. If this is absent the account is
    // not staff and the rest of the test would be measuring the wrong screen.
    await expect(page.getByLabel("Управление")).toBeVisible();

    const plate = page.getByTestId("kub-hint");
    await expect(plate).toBeVisible();
    await expect(plate).toContainText("Управление сообществом");

    // The popover animates in, so the first reading is taken before it has
    // settled. Poll until the press point is covered rather than measuring
    // once and calling a half-open plate a layout change.
    let geo = await geometry(page);
    for (let attempt = 0; attempt < 50 && !geo.covered; attempt += 1) {
      await page.waitForTimeout(100);
      geo = await geometry(page);
    }

    // First, that this test is testing anything at all. Rectangles touching is
    // not enough: the press lands on the row's centre, and that is the point
    // which has to be under the plate.
    expect(
      geo.covered,
      [
        "the plate no longer covers the point this test presses, so a landing click proves nothing.",
        "Plate " + geo.plate + "; row " + geo.row + "; press point " + geo.centre + ".",
        "Move the anchor back, or point this test at whatever the plate covers now —",
        "do not delete it: D-162 was invisible to every check that did not press.",
      ].join(" "),
    ).toBe(true);

    // Then, that the press lands. A failure here reads as
    // "<div data-radix-popper-content-wrapper> intercepts pointer events".
    await page.getByTestId("chat-list-item").first().click({ timeout: 5_000 });

    // And that it did something. A click that is swallowed silently would
    // otherwise pass as long as it did not time out.
    await expect(page.getByTestId("chat-header-shell")).toBeVisible();
  });
});
