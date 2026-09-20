import { expect, test, type Page } from "@playwright/test";
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
 * A photograph of the two profile surfaces, not a contract.
 *
 * The owner judges a visual change on rendered pixels, so this exists to
 * produce them at the two release widths in both themes: the compact card a
 * face opens, the full card the escalation reaches, and the phone's single
 * tier. Every row it seeds is invented — no production chat, no real person,
 * no badge belonging to anybody.
 *
 * The contract for the same surfaces is `profile-two-tier.spec.ts`; this file
 * asserts almost nothing about the design and is safe to delete once the pass
 * closes. What it does assert is that it photographed what it says it did —
 * a capture that silently shot the wrong tier would be worse than no capture.
 */

const AT = "2026-09-20T09:00:00.000Z";

const ME = person("51111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = {
  ...person("51111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna_smirnova"),
  bio: "Дизайнер интерфейсов. Веду витрину и макеты, отвечаю быстрее всего до обеда. Пишите сразу по делу — так быстрее.",
};

const CHAT_TEAM = "52222222-2222-4222-8222-000000000001";
const CHAT_DESIGN = "52222222-2222-4222-8222-000000000002";
const CHAT_NEWS = "52222222-2222-4222-8222-000000000003";
const IN_GROUP = "Макет главной готов, посмотрите";

/** Invented badges, so the strip and its «+N» can be seen doing their work. */
const BADGES = [
  { user_id: ANNA.id, kind: "global_role", key: "staff", title: "Сотрудник", detail: "С 3 марта 2026", icon: "shield", colour: "cyan", rank: 10 },
  { user_id: ANNA.id, kind: "achievement", key: "early", title: "Ранний участник", detail: "Первая сотня", icon: "star", colour: "pink", rank: 20 },
  { user_id: ANNA.id, kind: "achievement", key: "helper", title: "Помощник", detail: "50 ответов в поддержке", icon: "heart", colour: "violet", rank: 30 },
  { user_id: ANNA.id, kind: "achievement", key: "builder", title: "Строитель", detail: "10 собранных групп", icon: "create", colour: "amber", rank: 40 },
];

function seed(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [
      chat(CHAT_TEAM, "group", "Команда проекта", AT),
      chat(CHAT_DESIGN, "group", "Дизайн витрины", "2026-09-19T09:00:00.000Z"),
      chat(CHAT_NEWS, "channel", "Объявления", "2026-09-18T09:00:00.000Z"),
    ],
    memberships: [
      membership(CHAT_TEAM, ME, "owner", AT),
      membership(CHAT_TEAM, ANNA, "member", AT),
      membership(CHAT_DESIGN, ME, "member", AT),
      membership(CHAT_DESIGN, ANNA, "owner", AT),
      membership(CHAT_NEWS, ME, "member", AT),
      membership(CHAT_NEWS, ANNA, "admin", AT),
    ],
    messages: [
      message("55555555-5555-4555-8555-000000000001", CHAT_TEAM, ANNA, IN_GROUP, "2026-09-20T09:30:00.000Z"),
    ],
  };
}

async function open(page: Page, theme: "dark" | "light") {
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    ...seed(),
    rpc: (name) => {
      if (name === "search_chat_messages") return missingFunction(name);
      if (name === "profile_badges") return { body: BADGES };
      return undefined;
    },
  });
  // `openFixture` seeds the dark theme; a later init script wins.
  await page.addInitScript((value) => {
    localStorage.setItem("kub-theme", value as string);
  }, theme);
  await openChat(page, "Команда проекта", IN_GROUP);
  await page.evaluate(() => document.fonts.ready);
}

function shot(page: Page, name: string, theme: string) {
  const width = page.viewportSize()?.width ?? 0;
  return page.screenshot({ path: `output/profile-two-tier/${name}-${width}-${theme}.png` });
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

for (const theme of ["dark", "light"] as const) {
  test(`profile tiers — ${theme}`, async ({ page, request }) => {
    await requireFixtureServer(request);
    await open(page, theme);

    // 1. What a face opens. At 1440 that is the compact card; at 390 there is
    //    no compact tier at all and the same press lands on the full one,
    //    which is the finding the device produced and the reason both frames
    //    are worth looking at side by side.
    await page.getByTestId("message-author-avatar").first().click();
    const overlay = page.getByTestId("user-profile-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute(
      "data-profile-surface",
      isPhone(page) ? "full" : "compact",
    );
    await expect(overlay.getByTestId("member-card-badges")).toBeVisible();
    if (!isPhone(page)) {
      // The correction of 2026-09-21: the summary is a popout beside the face,
      // not a centred dialog. Photographed with the conversation still lit
      // behind it, which is the property the anchoring exists for.
      await expect(page.getByTestId("user-profile-popout")).toBeVisible();
    }
    await page.waitForTimeout(350);
    await shot(page, isPhone(page) ? "phone-single-tier" : "compact", theme);

    if (!isPhone(page)) {
      // 2. The escalation, and what it reaches.
      await page.getByTestId("profile-open-full").click();
      await expect(overlay).toHaveAttribute("data-profile-surface", "full");
      await page.waitForTimeout(350);
      await shot(page, "full", theme);
    }

    // 3. The conversation behind it, with the two new anchors on the author.
    await page.getByTestId("user-profile-close").click();
    await expect(page.getByTestId("user-profile-overlay")).toHaveCount(0);
    await page.waitForTimeout(250);
    await shot(page, "conversation", theme);
  });
}
