import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Person,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * Reaching somebody from inside a group (D-170), and not losing the action in
 * silence (D-165).
 *
 * The owner of this deployment reported on 2026-09-15 that they could not make
 * a group at all: the invitee step opened as a blank box with a disabled button
 * under it. That was fixed in `NewGroupModal`. **This screen is the other half
 * of the same complaint** — the one you use once the group exists — and it was
 * still a blank box behind «Введите минимум 2 символа для поиска пользователя.»
 *
 * Measured on production on 2026-09-17, read-only, before anything here was
 * written:
 *
 *   - `Profiles are viewable by everyone` is the live SELECT policy, so a blank
 *     list was never protecting anything.
 *   - `public.search_profiles_by_phone` returns early unless the caller holds
 *     `users.view`, which four administrative global roles hold and nobody
 *     else. An ordinary person has never been able to find anybody by
 *     telephone number, so nothing here offers or implies it.
 *   - 'ivan_petrov' ILIKE '%ivan petrov%' is **false**. This screen replaced
 *     «_» with a space before searching, and 4 of the 11 usernames on this
 *     deployment contain one — typed out in full, those people could not be
 *     found. `NewGroupModal` escaped nothing at all instead, so a «,» in the
 *     field broke the PostgREST filter. One rule now, `lib/adminUserSearch.ts`.
 *
 * The `profiles` route below applies the pattern the client sends with real
 * `ILIKE` semantics — «%» as any run, «_» as any single character — so a test
 * that says «typing anna_s finds Анна» is measuring the filter and not a mock
 * that agrees with it.
 *
 * Everything is fictional and mocked on the DEV fixture host. No production
 * screen is rendered and no production data is fetched.
 */

const AT = "2026-09-16T09:00:00.000Z";
const LINE = "Собираемся в четверг";
const GROUP = "31111111-1111-4111-8111-000000000001";

const ME = person("32222222-2222-4222-8222-000000000001", "Зоя Яблокова", "zoya");
/** In the chat already, so she is a member and cannot be invited again. */
const OLGA = person("32222222-2222-4222-8222-000000000002", "Ольга Мишина", "olga");
/** Shares a private chat with me: the one the list has to offer first. */
const ANNA = person("32222222-2222-4222-8222-000000000003", "Анна Смирнова", "anna_s");
/** A stranger whose name sorts before Anna's, to prove the order is not the name. */
const ALEK = person("32222222-2222-4222-8222-000000000004", "Алексей Ворон", "alex");
const BORIS = person("32222222-2222-4222-8222-000000000005", "Борис Ильин", null);

const PRIVATE = "31111111-1111-4111-8111-000000000002";

type Policy = "owner_admin_only" | "members_can_invite" | "unreadable";

interface OpenOptions {
  /** My role in the group, which is also what opens the panel's invite button. */
  myRole?: "owner" | "admin" | "member";
  /** What the group's row says when the panel reads it. */
  panelPolicy?: "owner_admin_only" | "members_can_invite";
  /**
   * What the *modal's* own read of the same row says.
   *
   * Two reads, a minute apart: an administrator can change the policy while the
   * invite screen is opening, and a client whose schema cache predates the
   * column gets the row without it. Both are why this is a separate knob.
   */
  modalPolicy?: Policy;
  permissions?: readonly string[];
  theme?: "light" | "dark";
  /**
   * People the `profiles` page leaves out.
   *
   * The read is `limit(20)`, so on a deployment with more people than that the
   * unfiltered page can easily omit the person you talk to every day. That is
   * what the merge with the chat list the store already holds is for, and
   * without this knob the fixture's four people always fit and the merge is
   * untestable.
   */
  omitFromPage?: readonly string[];
}

interface Seen {
  /** Every `or=(…)` this screen sent to `profiles`, in order. */
  filters: string[];
}

/** `%` and `_` as Postgres reads them inside ILIKE, and nothing else special. */
function ilike(value: string | null, pattern: string): boolean {
  const body = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`)
    .replace(/%/g, "[\\s\\S]*")
    .replace(/_/g, "[\\s\\S]");
  return new RegExp(`^${body}$`, "iu").test(value ?? "");
}

/** The people a `profiles?or=(…)` read would answer with. */
function matching(people: Person[], or: string | null): Person[] {
  if (!or) return people;
  const inner = or.replace(/^\(/, "").replace(/\)$/, "");
  // `full_name.ilike.%x%,username.ilike.%x%` — the value is everything after
  // the second dot, which is how PostgREST reads it too.
  const clauses = inner.split(",").map((clause) => {
    const [field, operator, ...rest] = clause.split(".");
    return { field, operator, value: rest.join(".") };
  });
  return people.filter((candidate) =>
    clauses.some(({ field, operator, value }) => {
      if (operator === "eq") return field === "id" && candidate.id === value;
      if (operator !== "ilike") return false;
      const held = field === "username" ? candidate.username : candidate.full_name;
      return ilike(held, value);
    }),
  );
}

async function openInvite(page: Page, options: OpenOptions = {}): Promise<Seen> {
  const {
    myRole = "owner",
    panelPolicy = "owner_admin_only",
    modalPolicy = panelPolicy,
    permissions = [],
    theme = "dark",
    omitFromPage = [],
  } = options;
  const seen: Seen = { filters: [] };
  const everybody = [ANNA, ALEK, BORIS, OLGA];

  const groupRow = { ...chat(GROUP, "group", "Команда проекта", AT), invite_policy: panelPolicy };

  await openFixture(page, {
    me: ME,
    people: everybody,
    chats: [groupRow, chat(PRIVATE, "private", null, AT)],
    memberships: [
      membership(GROUP, ME, myRole, AT),
      membership(GROUP, OLGA, myRole === "owner" ? "admin" : "owner", AT),
      // The private conversation is what makes Anna «somebody you already talk
      // to», and it is read from the chat list the store already holds.
      membership(PRIVATE, ME, "member", AT),
      membership(PRIVATE, ANNA, "member", AT),
    ] as Row[],
    messages: [message("33333333-3333-4333-8333-000000000001", GROUP, OLGA, LINE, AT)],
    rpc: (name, body) => {
      if (name === "search_chat_messages") return missingFunction(name);
      if (name === "current_user_access_snapshot") return missingFunction(name);
      if (name === "has_permission") {
        return { body: permissions.includes(String(body.p_permission_key)) };
      }
      return undefined;
    },
  });

  // The invitations this chat holds: none, so every candidate is fresh.
  await page.route("**/rest/v1/group_invites*", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  // The modal's own read of «my role, and this chat's row». The fixture's
  // `chat_members` handler answers the member list and carries no embedded
  // chat, so this one answers the embed and falls back for everything else.
  await page.route("**/rest/v1/chat_members*", (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.fallback();
    if (!(url.searchParams.get("select") ?? "").includes("chat:chats")) return route.fallback();
    const embedded: Record<string, unknown> = { ...groupRow };
    if (modalPolicy === "unreadable") delete embedded.invite_policy;
    else embedded.invite_policy = modalPolicy;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ role: myRole, chat: embedded }),
    });
  });

  await page.route("**/rest/v1/profiles*", (route: Route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const url = new URL(request.url());
    const select = url.searchParams.get("select") ?? "";
    const or = url.searchParams.get("or");
    // Only the invite screen's read: `select=*` with no `eq` on a single row.
    if (select !== "*" || url.searchParams.get("username")) return route.fallback();
    seen.filters.push(or ?? "");
    const excluded = (url.searchParams.get("id") ?? "").startsWith("neq.")
      ? url.searchParams.get("id")!.slice(4)
      : null;
    const rows = matching(everybody, or)
      .filter((candidate) => candidate.id !== excluded)
      .filter((candidate) => !omitFromPage.includes(candidate.id));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });

  await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
  await openChat(page, "Команда проекта", LINE);
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  await page.getByRole("button", { name: "Пригласить пользователя" }).first().click();
  await expect(page.getByTestId("invite-candidates")).toBeVisible();
  await page.evaluate(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", (root.dataset.theme ?? "") !== "light");
  });
  return seen;
}

function shotPath(info: TestInfo, name: string): string {
  return `output/group-invite-reach/${name}-${info.project.name}.png`;
}

const search = (page: Page) => page.getByPlaceholder("Поиск по имени или @никнейму…");
/**
 * The list, and nothing else on screen.
 *
 * Scoped deliberately: «Анна Смирнова» is also the private conversation's row
 * in the sidebar behind the modal, and an unscoped `getByText` matched both.
 */
const list = (page: Page) => page.getByTestId("invite-candidates");
const rows = (page: Page) => list(page).locator("[data-invite-candidate]");
const rowFor = (page: Page, name: string) => rows(page).filter({ hasText: name });

/**
 * The newest `or=(…)` this screen sent, once it has been sent.
 *
 * The list narrows locally before the debounced request goes out — the people
 * the store already holds are filtered on this side — so reading the recorded
 * filters as soon as a row appears catches the opening unfiltered load instead.
 */
async function lastFilter(seen: Seen, contains: string): Promise<string> {
  await expect
    .poll(() => seen.filters[seen.filters.length - 1] ?? "", { timeout: 5_000 })
    .toContain(contains);
  return seen.filters[seen.filters.length - 1];
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("the screen opens with people, not with an instruction to start typing", async ({ page }) => {
  await openInvite(page);
  // The sentence that used to stand in place of the list.
  await expect(page.getByText(/Введите минимум 2 символа/)).toHaveCount(0);
  await expect(rowFor(page, "Анна Смирнова")).toBeVisible();
  await expect(rowFor(page, "Алексей Ворон")).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
});

test("people you already share a chat with come first, and the order is stated", async ({ page }) => {
  await openInvite(page);
  await expect(list(page).getByText("Вы уже общаетесь")).toBeVisible();
  await expect(list(page).getByText("Остальные")).toBeVisible();
  // By position, not by eye: Анна sorts after Алексей by name and is first
  // anyway, because a private chat with her already exists.
  const text = (await list(page).innerText()).replace(/\s+/g, " ");
  expect(text.indexOf("Анна Смирнова")).toBeGreaterThan(-1);
  expect(text.indexOf("Анна Смирнова")).toBeLessThan(text.indexOf("Алексей Ворон"));
  expect(text.indexOf("Вы уже общаетесь")).toBeLessThan(text.indexOf("Анна Смирнова"));
  expect(text.indexOf("Остальные")).toBeLessThan(text.indexOf("Алексей Ворон"));
});

test("somebody the page of profiles left out is still offered", async ({ page }) => {
  // The read is `limit(20)`. With more people than that on a deployment, the
  // page can perfectly well omit the person you speak to daily — so the list is
  // the union of that page and the chat list the store already holds. Without
  // the union this row is simply absent, and the person is unreachable by any
  // means but spelling the name.
  await openInvite(page, { omitFromPage: [ANNA.id] });
  await expect(rowFor(page, "Анна Смирнова")).toBeVisible();
  await expect(list(page).getByText("Вы уже общаетесь")).toBeVisible();
});

test("a search puts the people you know first, in one list with no headings", async ({ page }) => {
  // The headings only exist over the unfiltered list; a search is one answer to
  // one question. So here the order is the comparator's alone, and «Анна» leads
  // «Алексей» — who sorts first by name — because a chat with her exists.
  await openInvite(page);
  await search(page).fill("А");
  await expect(rowFor(page, "Алексей Ворон")).toBeVisible();
  await expect(list(page).getByText("Вы уже общаетесь")).toHaveCount(0);
  const text = (await list(page).innerText()).replace(/\s+/g, " ");
  expect(text.indexOf("Анна Смирнова")).toBeGreaterThan(-1);
  expect(text.indexOf("Анна Смирнова")).toBeLessThan(text.indexOf("Алексей Ворон"));
});

test("somebody already in the group is not offered until you search for them", async ({ page }) => {
  await openInvite(page);
  await expect(rowFor(page, "Ольга Мишина")).toHaveCount(0);
  await search(page).fill("Ольга");
  await expect(rowFor(page, "Ольга Мишина")).toBeVisible();
  // And it says why, rather than answering nothing — which cannot be told apart
  // from a search that never ran.
  await expect(rowFor(page, "Ольга Мишина")).toHaveAttribute("data-invite-state", "member");
  await expect(list(page).getByRole("button", { name: "Уже здесь" })).toBeVisible();
});

test("a никнейм with an underscore is findable by typing it out", async ({ page }) => {
  const seen = await openInvite(page);
  await search(page).fill("anna_s");
  await expect(rowFor(page, "Анна Смирнова")).toBeVisible();
  // The load-bearing half: the underscore reached the server. Replacing it with
  // a space is what this screen used to do, and Postgres answers false to
  // 'anna_s' ILIKE '%anna s%'.
  const last = await lastFilter(seen, "ilike");
  expect(last).toContain("anna_s");
  expect(last).not.toContain("anna s");
});

test("a leading @ is dropped, because usernames are not stored with one", async ({ page }) => {
  const seen = await openInvite(page);
  await search(page).fill("@anna_s");
  await expect(rowFor(page, "Анна Смирнова")).toBeVisible();
  const last = await lastFilter(seen, "ilike");
  expect(last).toContain("username.ilike.%anna_s%");
  expect(last).not.toContain("@anna");
});

test("a comma in the field does not turn one filter into two", async ({ page }) => {
  const seen = await openInvite(page);
  await search(page).fill("Смирнова, Анна");
  const last = await lastFilter(seen, "Смирнова");
  // Exactly two clauses, whatever was typed: the comma is gone from the value
  // rather than read as the separator inside `or=(…)`, which is what would have
  // turned this one search into two and then into a parse error.
  expect(last.split(",").length).toBe(2);
  expect(last).toBe("(full_name.ilike.%Смирнова Анна%,username.ilike.%Смирнова Анна%)");
});

test("nothing found says what was looked for", async ({ page }) => {
  await openInvite(page);
  await search(page).fill("Жанна");
  await expect(page.getByText("По запросу «Жанна» никого не нашли.")).toBeVisible();
});

test("an invitation can be sent, and the row stops offering it", async ({ page }) => {
  await openInvite(page);
  await page.route("**/rest/v1/rpc/group_invite_create", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "34444444-4444-4444-8444-000000000001",
        chat_id: GROUP,
        inviter_id: ME.id,
        invitee_id: ANNA.id,
        status: "pending",
        created_at: AT,
        expires_at: null,
        responded_at: null,
      }),
    }),
  );
  const row = rowFor(page, "Анна Смирнова");
  await row.getByRole("button", { name: "Пригласить" }).click();
  await expect(page.getByText("Приглашение отправлено: Анна Смирнова.")).toBeVisible();
  await expect(row.getByRole("button", { name: "Ждёт ответа" })).toBeVisible();
  await expect(row).toHaveAttribute("data-invite-state", "pending");
});

/**
 * D-165's open part, on the two states the panel's own gate cannot produce.
 *
 * `ChatInfoPanel.tsx:388` opens this screen only for a chat's owner or
 * administrator, or for a member of a `members_can_invite` chat — so the modal
 * is reached with a second, later read of the same row. An administrator
 * changing the policy in between, or a client whose schema cache predates the
 * column, is how these two arrive in the real product.
 */
test("a policy that has changed under the reader refuses, and names the reason", async ({ page }) => {
  await openInvite(page, { myRole: "member", panelPolicy: "members_can_invite", modalPolicy: "owner_admin_only", permissions: ["chats.invite"] });
  await expect(page.getByTestId("invite-denied")).toHaveText("В группе приглашают только владелец и администраторы.");
  // And no row pretends otherwise. Not a disabled «Пригласить» either: a row of
  // inert offers under a sentence saying you may not invite is the screen
  // disagreeing with itself. The people stay, the controls go.
  await expect(list(page).getByRole("button")).toHaveCount(0);
  await expect(rowFor(page, "Анна Смирнова")).toBeVisible();
});

test("a policy that could not be read does not remove the action in silence", async ({ page }) => {
  await openInvite(page, { myRole: "member", panelPolicy: "members_can_invite", modalPolicy: "unreadable", permissions: ["chats.invite"] });
  await expect(page.getByTestId("invite-policy-unread")).toContainText("Не удалось прочитать");
  await expect(page.getByTestId("invite-denied")).toHaveCount(0);
  // The old rule required the policy to have been read before honouring
  // `members_can_invite`, so this member lost the button with nothing said.
  await expect(list(page).getByRole("button", { name: "Пригласить", exact: true }).first()).toBeEnabled();
});

test("a member of a members_can_invite group is offered it, with no note", async ({ page }) => {
  await openInvite(page, { myRole: "member", panelPolicy: "members_can_invite", permissions: ["chats.invite"] });
  await expect(page.getByTestId("invite-denied")).toHaveCount(0);
  await expect(page.getByTestId("invite-policy-unread")).toHaveCount(0);
  await expect(list(page).getByRole("button", { name: "Пригласить", exact: true }).first()).toBeEnabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`the list holds in the ${theme} theme`, async ({ page }, info) => {
    await openInvite(page, { theme });
    await expect(rowFor(page, "Анна Смирнова")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath(info, `list-${theme}`), fullPage: false });
  });

  test(`a searched-out member reads correctly in the ${theme} theme`, async ({ page }, info) => {
    await openInvite(page, { theme });
    await search(page).fill("Ольга");
    await expect(list(page).getByRole("button", { name: "Уже здесь" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath(info, `member-${theme}`), fullPage: false });
  });

  test(`the refusal reads correctly in the ${theme} theme`, async ({ page }, info) => {
    await openInvite(page, {
      theme,
      myRole: "member",
      panelPolicy: "members_can_invite",
      modalPolicy: "owner_admin_only",
      permissions: ["chats.invite"],
    });
    await expect(page.getByTestId("invite-denied")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath(info, `denied-${theme}`), fullPage: false });
  });
}
