import { expect, type Page, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  type Row,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * D-222 half B: a pill is only a pill while it is one line high.
 *
 * Above one line the `rounded-full` radius clamps to half the box, the corners
 * are eaten and the chip renders as an ellipse with its words crammed inside —
 * which is what the owner saw. Every case here measures the rendered box rather
 * than reading a class out of the source, because the class is only half the
 * claim: Tailwind has to have generated the utility, the browser has to have
 * applied it, and the flex item has to actually be allowed to shrink. A source
 * scan is green for all three of those the day any one of them stops being true.
 *
 * «One line» is measured against the same component holding a label that always
 * fitted, in a box of the same width, rather than against a number computed from
 * the font. That is what makes the assertion survive a type-scale change.
 */

const EPOCH = "2026-09-01T09:00:00.000Z";
const ME = person("33333333-3333-4333-8333-000000000001", "Максим Орлов", "maksim");
/**
 * Long on purpose, and measured rather than picked: nothing caps `full_name`,
 * and at 57 characters this one is 428px wide against the 342–358px row the
 * picked-people pills sit in. A 44-character name fitted, and the case was
 * quietly testing nothing.
 */
const ANNA = person(
  "33333333-3333-4333-8333-000000000002",
  "Анастасия Константинопольская-Преображенская Александровна",
  "anastasia",
);
const TEAM = "44444444-4444-4444-8444-000000000001";

/** The longest label the notification accent can produce, and the one beside it. */
const LONGEST_CHIP = "От администратора";
const LONGEST_ATTACHMENT = "Местоположение";

type PillCase = {
  id: string;
  width: number;
  component: "KubBadge" | "KubFilterChip";
  props: Record<string, unknown>;
  children: (string | { icon: string } | { swatch: string } | { element: string })[];
};

interface PillMeasurement {
  id: string;
  height: number;
  width: number;
  rowRight: number;
  right: number;
  /** Text that had to be cut, anywhere inside the pill. */
  ellipsised: boolean;
  /** Every element child, so a fix that collapses one is visible. */
  kids: { tag: string; w: number; h: number; left: number; right: number; text: string }[];
}

/**
 * Mounts the real primitives through the dev server and measures them.
 *
 * The modules are fetched from Vite by URL, so what is rendered is the component
 * in the repository, compiled the way the application compiles it, against the
 * application's own stylesheet — the page is the product's own `/`, and only the
 * app's root is hidden. Nothing here retypes a class name.
 */
async function mountPills(page: Page, cases: PillCase[]): Promise<PillMeasurement[]> {
  return page.evaluate(async (rows) => {
    const main = await fetch("/src/main.tsx").then((response) => response.text());
    const jsxUrl = [...main.matchAll(/from "([^"]+)"/g)]
      .map((match) => match[1])
      .find((url) => url.includes("react_jsx-dev-runtime"));
    if (!jsxUrl) throw new Error("no jsx runtime url in the transformed /src/main.tsx");
    const version = jsxUrl.slice(jsxUrl.indexOf("?"));

    const [react, dom, badge, filterChip, icon] = await Promise.all([
      import(/* @vite-ignore */ "/node_modules/.vite/deps/react.js" + version),
      import(/* @vite-ignore */ "/node_modules/.vite/deps/react-dom_client.js" + version),
      import("/src/components/kub/KubBadge.tsx"),
      import("/src/components/kub/KubFilterChip.tsx"),
      import("/src/components/kub/KubIcon.tsx"),
    ]);
    const React = (react as { default?: unknown }).default ?? react;
    const createRoot = ((dom as { default?: unknown }).default ?? dom).createRoot;
    const registry: Record<string, unknown> = {
      KubBadge: badge.KubBadge,
      KubFilterChip: filterChip.KubFilterChip,
    };

    const appRoot = document.getElementById("root");
    if (appRoot) appRoot.style.display = "none";
    document.getElementById("pill-mount")?.remove();
    const host = document.createElement("div");
    host.id = "pill-mount";
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;overflow:auto;padding:16px;background:var(--kub-bg)";
    document.body.appendChild(host);

    const h = React.createElement;
    const tree = rows.map((row) => {
      const props: Record<string, unknown> = { ...row.props };
      if (row.component === "KubFilterChip") props.onRemove = () => {};
      const children = row.children.map((child, index) => {
        if (typeof child === "string") return child;
        if ("icon" in child)
          return h(icon.KubIcon, { key: `i${index}`, name: child.icon, size: 11 });
        if ("element" in child) return h("em", { key: `e${index}` }, child.element);
        return h("span", {
          key: `s${index}`,
          "aria-hidden": true,
          className: "h-1.5 w-1.5 shrink-0 rounded-full",
          style: { backgroundColor: child.swatch },
        });
      });
      return h(
        "div",
        {
          key: row.id,
          "data-pill-row": row.id,
          style: {
            width: `${row.width}px`,
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            marginBottom: "10px",
          },
        },
        h(registry[row.component], props, ...children),
      );
    });

    createRoot(host).render(h(React.Fragment, null, ...tree));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const round = (value: number) => Math.round(value * 100) / 100;
    return [...host.querySelectorAll("[data-pill-row]")].map((row) => {
      const pill = row.firstElementChild as HTMLElement;
      const box = pill.getBoundingClientRect();
      return {
        id: row.getAttribute("data-pill-row") ?? "",
        height: round(box.height),
        width: round(box.width),
        right: round(box.right),
        rowRight: round(row.getBoundingClientRect().right),
        ellipsised: [pill, ...pill.querySelectorAll("*")].some(
          (node) => (node as HTMLElement).scrollWidth > (node as HTMLElement).clientWidth + 1,
        ),
        kids: [...pill.children].map((kid) => {
          const kidBox = kid.getBoundingClientRect();
          return {
            tag: kid.tagName.toLowerCase(),
            w: round(kidBox.width),
            h: round(kidBox.height),
            left: round(kidBox.left),
            right: round(kidBox.right),
            text: (kid.textContent ?? "").trim(),
          };
        }),
      };
    });
  }, cases);
}

const byId = (measured: PillMeasurement[], id: string) => {
  const found = measured.find((entry) => entry.id === id);
  expect(found, `no measurement for ${id}`).toBeTruthy();
  return found!;
};

const LONG_ROLE = "Старший администратор партнёрской сети";
const LONG_SEARCH = "Поиск: отчёт по продлению партнёрских договоров";

test.describe("the pill primitives", () => {
  test("a pill that cannot fit its text stays one line high and says it was cut", async ({
    page,
    request,
  }) => {
    await requireFixtureServer(request);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const measured = await mountPills(page, [
      {
        id: "badge-short",
        width: 200,
        component: "KubBadge",
        props: { tone: "cyan", pill: true },
        children: ["Активна"],
      },
      {
        id: "badge-long",
        width: 200,
        component: "KubBadge",
        props: { tone: "cyan", pill: true },
        children: [LONG_ROLE],
      },
      {
        id: "chip-short",
        width: 260,
        component: "KubFilterChip",
        props: { label: "Роль" },
        children: ["Роль: Администратор"],
      },
      {
        id: "chip-long",
        width: 260,
        component: "KubFilterChip",
        props: { label: "Поиск" },
        children: [LONG_SEARCH],
      },
    ]);

    const badgeShort = byId(measured, "badge-short");
    const badgeLong = byId(measured, "badge-long");
    // The whole contract in one number: the unbounded label takes exactly the
    // height the label that always fitted takes.
    expect(badgeLong.height).toBe(badgeShort.height);
    // And it gave way rather than pushing out of the column that holds it.
    expect(badgeLong.right).toBeLessThanOrEqual(badgeLong.rowRight + 0.5);
    // An ellipsis, not a silent cut: something inside really did overflow.
    expect(badgeLong.ellipsised).toBe(true);
    expect(badgeShort.ellipsised).toBe(false);

    const chipShort = byId(measured, "chip-short");
    const chipLong = byId(measured, "chip-long");
    expect(chipLong.height).toBe(chipShort.height);
    expect(chipLong.right).toBeLessThanOrEqual(chipLong.rowRight + 0.5);
    expect(chipLong.ellipsised).toBe(true);
    // The x is not what gives way; it is the only way to drop the filter. Its
    // floor is `.kub-icon-action`'s own `min-width`, which is why the chip needs
    // no `shrink-0` of its own — unlike the bare icon in `NewGroupModal`, which
    // measured 8px instead of 10 without one.
    const long = chipLong.kids.find((kid) => kid.tag === "button");
    const short = chipShort.kids.find((kid) => kid.tag === "button");
    expect(long?.w).toBe(short?.w);
  });

  test("a child that is an element, not a string, cannot make the pill two lines", async ({
    page,
    request,
  }) => {
    await requireFixtureServer(request);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // `pillTextChildren` only reaches text, by design — an icon and a colour
    // swatch have to stay flex items. So the one-line contract for anything
    // else is carried by `whitespace-nowrap` on the pill itself, and this is
    // the case that reaches it. Without it the assertion below is the defect
    // again, in a shape no call site has yet and any of them could grow.
    const measured = await mountPills(page, [
      {
        id: "element-short",
        width: 200,
        component: "KubBadge",
        props: { tone: "cyan", pill: true },
        children: [{ element: "Активна" }],
      },
      {
        id: "element-long",
        width: 200,
        component: "KubBadge",
        props: { tone: "cyan", pill: true },
        children: [{ element: LONG_ROLE }],
      },
      {
        id: "chip-element-short",
        width: 260,
        component: "KubFilterChip",
        props: { label: "Роль" },
        children: [{ element: "Роль: Администратор" }],
      },
      {
        id: "chip-element-long",
        width: 260,
        component: "KubFilterChip",
        props: { label: "Поиск" },
        children: [{ element: LONG_SEARCH }],
      },
    ]);
    expect(byId(measured, "element-long").height).toBe(byId(measured, "element-short").height);
    expect(byId(measured, "chip-element-long").height).toBe(
      byId(measured, "chip-element-short").height,
    );
  });

  test("the call sites that were already correct are not moved by the fix", async ({
    page,
    request,
  }) => {
    await requireFixtureServer(request);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const measured = await mountPills(page, [
      // `ProfileBadgeChip` and `TaskCard`: an icon beside the label, spaced by
      // the row's own `gap-1.5`. A fix that wrapped every child in one box
      // would fold the icon into the text and lose those 6px.
      {
        id: "icon-label",
        width: 320,
        component: "KubBadge",
        props: { tone: "pink", pill: true, dot: false },
        children: [{ icon: "crown" }, "Ветеран"],
      },
      // `RolesPermissionsTab`: a colour swatch sized `h-1.5 w-1.5`, which only
      // has a size while it is a flex item. Inline, it collapses to nothing.
      {
        id: "swatch-label",
        width: 320,
        component: "KubBadge",
        props: { tone: "cyan", pill: true, dot: false },
        children: [{ swatch: "#4ADE80" }, "Модератор"],
      },
      // `+{n}` reaches the component as two children, «+» and the number.
      // Wrapped apart they would be two flex items with a gap between them.
      {
        id: "plus-count",
        width: 320,
        component: "KubBadge",
        props: { tone: "muted", pill: true },
        children: ["+", "3"],
      },
    ]);

    const iconLabel = byId(measured, "icon-label");
    expect(iconLabel.kids.map((kid) => kid.tag)).toEqual(["svg", "span"]);
    expect(iconLabel.kids[0].w).toBe(11);
    expect(Math.round(iconLabel.kids[1].left - iconLabel.kids[0].right)).toBe(6);
    expect(iconLabel.ellipsised).toBe(false);

    const swatchLabel = byId(measured, "swatch-label");
    expect(swatchLabel.kids[0].w).toBe(6);
    expect(swatchLabel.kids[0].h).toBe(6);
    expect(Math.round(swatchLabel.kids[1].left - swatchLabel.kids[0].right)).toBe(6);

    const plusCount = byId(measured, "plus-count");
    // One box holding «+3», not two boxes six pixels apart.
    expect(plusCount.kids).toHaveLength(1);
    expect(plusCount.kids[0].text).toBe("+3");
  });

  test("a square badge is left alone, because 6px of radius survives a second line", async ({
    page,
    request,
  }) => {
    await requireFixtureServer(request);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const measured = await mountPills(page, [
      {
        id: "square-short",
        width: 200,
        component: "KubBadge",
        props: { tone: "muted" },
        children: ["Активна"],
      },
      {
        id: "square-long",
        width: 200,
        component: "KubBadge",
        props: { tone: "muted" },
        children: [LONG_ROLE],
      },
    ]);
    // The opposite assertion to the first test, on purpose: `rounded-md` is the
    // variant the register did not call a defect, and the one-line contract
    // must not have leaked onto it.
    expect(byId(measured, "square-long").height).toBeGreaterThan(
      byId(measured, "square-short").height,
    );
    expect(byId(measured, "square-long").ellipsised).toBe(false);
  });
});

// --------------------------------------------------------------------------

const notification = (id: string, kind: string, payload: Row, createdAt: string): Row => ({
  id,
  user_id: ME.id,
  kind,
  payload,
  read_at: null,
  created_at: createdAt,
});

async function openBell(page: Page, rows: Row[]) {
  await openFixture(page, {
    me: ME,
    chats: [chat(TEAM, "group", "Команда", EPOCH)],
    memberships: [membership(TEAM, ME, "owner", EPOCH), membership(TEAM, ANNA, "member", EPOCH)],
    messages: [message("m-1", TEAM, ANNA, "Привет", EPOCH)],
    people: [ANNA],
  });
  // Registered after `openFixture`, whose own handler covers the whole host.
  await page.route(`http://127.0.0.1:54321/rest/v1/notifications**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const bell = page.getByTestId("notification-bell-button");
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByTestId("notification-panel")).toBeVisible();
}

/** One line for this element, measured from its own line box rather than guessed. */
const oneLine = async (locator: ReturnType<Page["locator"]>) =>
  locator.evaluate((node) => {
    const style = getComputedStyle(node as HTMLElement);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    return {
      height: Math.round((node as HTMLElement).getBoundingClientRect().height * 100) / 100,
      oneLine:
        Math.round(
          (lineHeight +
            parseFloat(style.paddingTop) +
            parseFloat(style.paddingBottom) +
            parseFloat(style.borderTopWidth) +
            parseFloat(style.borderBottomWidth)) *
            100,
        ) / 100,
      right: Math.round((node as HTMLElement).getBoundingClientRect().right * 100) / 100,
    };
  });

/**
 * What this one really covers, said plainly.
 *
 * The register listed these three lines among the ones already broken on
 * screen; they are not. Measured at the panel's own 280px floor — which needs a
 * viewport under 296px, narrower than anything in the release matrix — the row
 * that holds them is 190px and the widest pill the accent can build is 124px.
 * Backing the fix out changes two anti-aliased pixels of a 430×520 capture and
 * nothing else, so the height assertions below cannot currently go red, and the
 * mutation run says so.
 *
 * They are still worth keeping for the thing that *is* reachable: the pill used
 * to be written out twice, once in the card and once in the grouped item, and
 * the count of two below is what says the extraction did not lose a render
 * path. Every label here is fixed copy, so the day one of them grows is the day
 * the geometry starts carrying weight too.
 */
test.describe("the notification panel", () => {
  test("its chips stay one line high, and both render paths still draw one", async ({ page }) => {
    await openBell(page, [
      notification(
        "n-task",
        "task_assigned",
        { priority: "urgent", created_for_admin: true, task_id: "t-1", title: "Проверить отчёт" },
        "2026-09-01T10:00:00.000Z",
      ),
      notification(
        "n-message-single",
        "new_message",
        { message_type: "location", sender_id: ANNA.id, sender_name: ANNA.full_name },
        "2026-09-01T09:30:00.000Z",
      ),
      notification(
        "n-message-grouped",
        "new_message",
        {
          message_type: "location",
          chat_id: TEAM,
          message_id: "m-1",
          sender_id: ANNA.id,
          sender_name: ANNA.full_name,
        },
        "2026-09-01T09:20:00.000Z",
      ),
    ]);

    const panel = page.getByTestId("notification-panel");
    const panelRight = await panel.evaluate(
      (node) => Math.round((node as HTMLElement).getBoundingClientRect().right * 100) / 100,
    );

    // The longest label `notificationAccent` can produce, and the longest
    // attachment word. Both are fixed copy, so this is the worst case rather
    // than a sample — which is exactly why it fits, and why the describe block
    // above calls these assertions a watch rather than a catch.
    const admin = page.getByTestId("notification-chip-admin");
    await expect(admin).toHaveText(LONGEST_CHIP);
    const adminBox = await oneLine(admin);
    expect(adminBox.height).toBe(adminBox.oneLine);
    expect(adminBox.right).toBeLessThanOrEqual(panelRight);

    const urgent = page.getByTestId("notification-chip-urgent");
    const urgentBox = await oneLine(urgent);
    expect(urgentBox.height).toBe(urgentBox.oneLine);

    // Both render paths, because until this change each carried its own copy of
    // the pill: the grouped item and the single card.
    const attachments = page.getByTestId("notification-attachment");
    await expect(attachments).toHaveCount(2);
    for (const index of [0, 1]) {
      const attachment = attachments.nth(index);
      await expect(attachment).toHaveText(LONGEST_ATTACHMENT);
      const box = await oneLine(attachment);
      expect(box.height).toBe(box.oneLine);
      expect(box.right).toBeLessThanOrEqual(panelRight);
    }
  });
});

// --------------------------------------------------------------------------

const photo = (index: number, createdAt: string) =>
  message(`55555555-5555-4555-8555-${String(index).padStart(12, "0")}`, TEAM, ANNA, "", createdAt, {
    type: "image",
    media_bucket: "chat-media",
    media_path: `${TEAM}/photo-${index}.png`,
    media_url: `http://127.0.0.1:54321/storage/v1/object/public/chat-media/${TEAM}/photo-${index}.png`,
    media_metadata: { width: 800, height: 800 },
  });

test.describe("the month marker over the shared-media grid", () => {
  test("it is a pill that cannot become two lines, whatever month it names", async ({ page }) => {
    const photos = [
      ...Array.from({ length: 12 }, (_, index) =>
        photo(index + 1, `2025-09-${String(10 + index).padStart(2, "0")}T09:00:00.000Z`),
      ),
      ...Array.from({ length: 12 }, (_, index) =>
        photo(index + 20, `2025-11-${String(10 + index).padStart(2, "0")}T09:00:00.000Z`),
      ),
    ];
    await openFixture(page, {
      me: ME,
      chats: [chat(TEAM, "group", "Команда", EPOCH)],
      memberships: [membership(TEAM, ME, "owner", EPOCH), membership(TEAM, ANNA, "member", EPOCH)],
      messages: [message("m-1", TEAM, ANNA, "Привет", EPOCH), ...photos],
      people: [ANNA],
      rpc: (name) =>
        name === "chat_media_counts"
          ? { body: [{ kind: "photo", total: photos.length }] }
          : undefined,
    });
    await page.route("**/storage/v1/object/public/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#456"/></svg>',
      }),
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const row = page.getByTestId("chat-list-item").filter({ hasText: "Команда" });
    await expect(row).toBeVisible();
    await row.click();
    await page.getByTestId("chat-header-info-button").click();
    await expect(page.getByTestId("chat-info-panel")).toBeVisible();
    const mediaRow = page.getByTestId("chat-info-media-row").filter({ hasText: "фотограф" });
    await expect(mediaRow).toBeVisible();
    await mediaRow.click();
    await expect(page.getByTestId("chat-info-gallery-view")).toBeVisible();
    await page.getByTestId("chat-info-gallery-view").hover({ position: { x: 120, y: 200 } });
    await page.mouse.wheel(0, 400);

    const marker = page.getByTestId("chat-info-media-month-marker");
    await expect(marker).toHaveAttribute("data-shown", "true");

    // This one is latent rather than live, and the test says so rather than
    // pretending otherwise. `mediaMonthLabel` can only produce «Сентябрь 2025»
    // and its eleven siblings, and the longest of those still fits in the half
    // of the card an absolutely positioned box with `left-1/2` is laid out in —
    // so no seedable data makes the old markup wrap, and a geometry assertion
    // would be green with the fix removed. What can be proved on the real
    // element is that the contract reached it: the utility exists in the
    // stylesheet, the class is on the node, and the cascade applied it. Remove
    // `truncate` from the component and `white-space` reads «normal» here.
    const applied = await marker.evaluate((node) => {
      const style = getComputedStyle(node as HTMLElement);
      const card = (node as HTMLElement).offsetParent as HTMLElement | null;
      const box = (node as HTMLElement).getBoundingClientRect();
      const probe = node.cloneNode(true) as HTMLElement;
      probe.style.position = "absolute";
      probe.style.left = "-9999px";
      probe.style.width = "max-content";
      probe.style.maxWidth = "none";
      (node.parentElement ?? document.body).appendChild(probe);
      const natural = probe.getBoundingClientRect().width;
      probe.remove();
      return {
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        overflowX: style.overflowX,
        height: Math.round(box.height * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        natural: Math.round(natural * 100) / 100,
        cardWidth: Math.round((card?.getBoundingClientRect().width ?? 0) * 100) / 100,
        lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2,
        padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      };
    });

    expect(applied.whiteSpace).toBe("nowrap");
    expect(applied.textOverflow).toBe("ellipsis");
    expect(applied.overflowX).toBe("hidden");
    // One line, and the box is the text's own width rather than the half of the
    // card the shrink-to-fit would otherwise hand it.
    expect(applied.height).toBe(Math.round((applied.lineHeight + applied.padding) * 100) / 100);
    expect(applied.width).toBe(applied.natural);
    expect(applied.width).toBeLessThanOrEqual(applied.cardWidth - 24);
  });
});

// --------------------------------------------------------------------------

test.describe("the people already picked for a new group", () => {
  test("a long name on the pill is cut rather than wrapped", async ({ page }) => {
    await openFixture(page, {
      me: ME,
      chats: [],
      memberships: [],
      messages: [],
      people: [ANNA],
    });
    // The picker lists everybody, so it needs more than the fixture's «me».
    await page.route(`http://127.0.0.1:54321/rest/v1/profiles**`, async (route, request) => {
      if (request.method() !== "GET") return route.fallback();
      const url = new URL(request.url());
      if (url.searchParams.get("username")) return route.fallback();
      if ((url.searchParams.get("id") ?? "").startsWith("in.")) return route.fallback();
      if ((request.headers().accept ?? "").includes("application/vnd.pgrst.object"))
        return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([ANNA]),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Two entry points, because the shell has two: the folder rail's layer from
    // `md`, and the header's own dropdown below it.
    const rail = page.getByTestId("side-menu-button");
    const onRail = await rail
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (onRail) {
      await rail.click();
      await page.getByTestId("side-menu-row").filter({ hasText: "Новая группа" }).click();
    } else {
      await page.getByRole("button", { name: "Меню" }).click();
      await page.getByRole("menu").getByText("Новая группа").click();
    }

    const candidate = page.getByRole("button").filter({ hasText: ANNA.full_name }).first();
    await expect(candidate).toBeVisible();
    await candidate.click();

    const picked = page.locator("button.rounded-full").filter({ hasText: ANNA.full_name }).first();
    await expect(picked).toBeVisible();
    const box = await oneLine(picked);
    expect(box.height).toBe(box.oneLine);
    // The whole name is still reachable even though the pill shows part of it.
    await expect(picked).toHaveAttribute("title", ANNA.full_name);
    // And the × is still there at its own size: `min-w-0` is on the name alone,
    // so every pixel the pill has to give up comes out of the name.
    const close = await picked.locator("svg").evaluate((node) => {
      const rect = (node as SVGElement).getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height) };
    });
    expect(close).toEqual({ w: 10, h: 10 });
  });
});
