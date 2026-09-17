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
 * D-180: an ordinary account can see who somebody is.
 *
 * Until today it could not. `ProfileRoleSummary` has drawn roles as chips since
 * long before this, and it was switched off for everyone but an administrator —
 * because reading somebody else's role means reading `roles`, and that policy
 * admits only your own rows. Measured read-only on production: a signed-in
 * account gets its own and nothing else. So a contact card showed the word
 * «Пользователь» to everybody, whoever they were looking at.
 *
 * `profile_badges` is the read path — a SECURITY DEFINER function returning
 * presentation fields only, so no permission, no `assigned_by` and no
 * `assigned_at` can come with them. This spec stubs that function on the
 * fixture backend and asserts what reaches the screen.
 *
 * Everything here is fictional and mocked. No production screen is rendered.
 */

const AT = "2026-09-12T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_PRIVATE = "22222222-2222-4222-8222-000000000002";
const LINE = "Привет, посмотри смету пожалуйста";

/** What `profile_badges` answers for Анна: a standing and a medal. */
const BADGE_ROWS = [
  {
    user_id: ANNA.id,
    kind: "global_role",
    key: "owner",
    title: "Владелец",
    detail: "Полный доступ ко всему LETSCUBE",
    icon: "crown",
    colour: "#F5B50A",
    rank: 100,
  },
  {
    user_id: ANNA.id,
    kind: "achievement",
    key: "veteran",
    title: "Ветеран",
    detail: "С нами больше года",
    icon: "clock",
    colour: null,
    rank: 100000 - 40,
  },
];

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT_PRIVATE, "private", null, AT)],
    memberships: [membership(CHAT_PRIVATE, ME, "member", AT), membership(CHAT_PRIVATE, ANNA, "member", AT)],
    messages: [
      message("55555555-5555-4555-8555-000000000001", CHAT_PRIVATE, ANNA, LINE, AT),
    ],
  };
}

function shotPath(info: TestInfo, name: string): string {
  return `output/profile-badges/${name}-${info.project.name}.png`;
}

async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
}

async function openCard(page: Page, badges: unknown[] = BADGE_ROWS, theme: "light" | "dark" = "light") {
  const seed = rows();
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => {
      // The helper answers with an envelope, not a bare body.
      if (name === "profile_badges") return { body: badges };
      if (name === "search_chat_messages") return missingFunction(name);
      return undefined;
    },
  });
  await openChat(page, ANNA.full_name as string, LINE);
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  await stampTheme(page, theme);
}

test("a contact card says who somebody is, not what everybody is", async ({ page }, info) => {
  await openCard(page);

  const strip = page.getByTestId("profile-badges");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Владелец");
  // The word the card used to show to everybody, whoever they were looking at.
  await expect(strip).not.toContainText("Пользователь");

  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "card") });
});

test("the standing comes before the medal, and the strip says how many it did not show", async ({ page }) => {
  await openCard(page, [
    ...BADGE_ROWS,
    {
      user_id: ANNA.id,
      kind: "achievement",
      key: "tester",
      title: "Тестировщик",
      detail: null,
      icon: "shield",
      colour: null,
      rank: 100000 - 10,
    },
  ]);

  const chips = page.getByTestId("profile-badges").locator("[data-badge-key]");
  // The standing first, then the medals in the catalogue's own order. Two sort
  // keys: a medal's rank is `100000 - sort_order`, so ranking alone would put
  // every medal in front of every role, which is how this rendered before it
  // was looked at.
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toContainText("Владелец");
  await expect(chips.nth(1)).toContainText("Тестировщик");
  await expect(page.getByTestId("profile-badges")).toContainText("+1");
});

test("somebody who wears nothing is not called «Пользователь»", async ({ page }) => {
  // This test used to require the opposite, and it was pinning the defect.
  //
  // `profiles.role` is an enum of `admin | manager | user` and 16 of this
  // deployment's 18 accounts carry `user`, so «Пользователь» was printed on
  // almost every contact card in the product. It is the column's default, not a
  // fact about a person — which is the sentence D-180 opened with («nobody could
  // see who anybody was: a contact card said «Пользователь» to everyone») and
  // the one D-146's fix left behind when it made the legacy label the fallback.
  //
  // «Администратор» and «Менеджер» from that same column ARE facts, because
  // every authoritative predicate on the server still honours it — `is_admin`
  // reads `profiles.role = 'admin'` **or** `has_global_role(...)`. So the label
  // survives for those two and is gone for the default.
  await openCard(page, []);
  await expect(page.getByTestId("profile-badges")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-panel")).not.toContainText("Пользователь");
  // And the card is not blanker than before: the name, the username line and
  // the presence sentence are what it was always carrying.
  await expect(page.getByTestId("chat-info-panel")).toContainText(ANNA.full_name as string);
});

test("an answer that never came leaves the card as it was", async ({ page }) => {
  // A failed RPC is not an answer that nothing is worn, and it is certainly not
  // a reason for the card to break. The first draft of this test called the
  // same helper as the one above it and proved nothing; this one refuses the
  // function the way a database without it would.
  const seed = rows();
  await openFixture(page, {
    me: ME,
    chats: seed.chats,
    memberships: seed.memberships,
    messages: seed.messages,
    rpc: (name) => {
      if (name === "profile_badges") return missingFunction(name);
      if (name === "search_chat_messages") return missingFunction(name);
      return undefined;
    },
  });
  await openChat(page, ANNA.full_name as string, LINE);
  await page.getByTestId("chat-header-info-button").click();

  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  await expect(page.getByTestId("profile-badges")).toHaveCount(0);
  // Not «Пользователь», for the reason above, and not a spinner either: a
  // refused function is answered for, so the strip settles on nothing rather
  // than waiting forever. `profile-badges-pending` is the state while the
  // answer is genuinely in flight, and it must not be the resting state.
  await expect(page.getByTestId("chat-info-panel")).not.toContainText("Пользователь");
  await expect(page.getByTestId("profile-badges-pending")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-panel")).toContainText(ANNA.full_name as string);
});

test("the strip holds in the dark theme", async ({ page }, info) => {
  await openCard(page, BADGE_ROWS, "dark");
  await expect(page.getByTestId("profile-badges")).toContainText("Владелец");
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "dark") });
});
