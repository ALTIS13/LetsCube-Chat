import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  EPOCH,
  openAdmin,
  openAdminFixture,
  person,
  requireFixtureServer,
  stampTheme,
  type Row,
} from "./helpers/adminFixture";

/**
 * The support workspace stops hiding its rules and stops trapping a phone
 * (D-144 and D-143).
 *
 * Everything on screen is fictional and mocked; the session is injected and no
 * request leaves this machine. See `helpers/adminFixture.ts` for why a fixture
 * rather than a QA sign-in — and for the thing a QA account could not give
 * these tests: the permission set is an argument, and one of the entries here
 * is about an operator who holds fewer permissions than any QA account does.
 */

const ME = person("55555555-5555-4555-8555-000000000001", "Павел Ильин", "pavel");
const MARIA = person("55555555-5555-4555-8555-000000000002", "Мария Соколова", "maria");
/** The person who wrote in. Not an operator, and never named as one. */
const CLIENT = person("55555555-5555-4555-8555-000000000003", "Ольга Крылова", "olga");

const T_POOL = "66666666-6666-4666-8666-000000000001";
const T_WAITING_COLLEAGUE = "66666666-6666-4666-8666-000000000002";
const T_MINE = "66666666-6666-4666-8666-000000000003";
const T_CLOSED = "66666666-6666-4666-8666-000000000004";
/** A well-formed id the fixture holds no ticket for: a load that fails. */
const T_GONE = "66666666-6666-4666-8666-000000000009";

const SUPPORT_PERMISSIONS = [
  "support.view",
  "support.claim",
  "support.reply",
  "support.transfer",
  "support.escalate",
  "support.manage",
  "support.settings",
  "support.lookup_customer",
  // Reaches the administration shell at all.
  "users.view",
];

function ticket(
  id: string,
  over: Row & { status: string; subject: string },
): Row {
  return {
    id,
    public_reference: `LC-2026-${id.slice(-6).toUpperCase()}`,
    requester_user_id: CLIENT.id,
    source: "web",
    category: "access",
    priority: "normal",
    assigned_operator_id: null,
    assigned_at: null,
    urgent: false,
    linked_ticket_id: null,
    resolution_summary: null,
    resolved_at: null,
    closed_at: null,
    last_requester_message_at: EPOCH,
    last_operator_message_at: null,
    last_activity_at: EPOCH,
    created_at: EPOCH,
    updated_at: EPOCH,
    version: 1,
    ...over,
  };
}

const TICKETS: Row[] = [
  ticket(T_POOL, { status: "new", subject: "Не приходит код подтверждения" }),
  ticket(T_WAITING_COLLEAGUE, {
    status: "waiting_user",
    subject: "Не открывается вложение в чате",
    assigned_operator_id: MARIA.id,
    assigned_at: EPOCH,
  }),
  ticket(T_MINE, {
    status: "waiting_support",
    subject: "Просьба перенести бронь",
    assigned_operator_id: ME.id,
    assigned_at: EPOCH,
  }),
  ticket(T_CLOSED, {
    status: "closed",
    subject: "Вопрос по счёту",
    assigned_operator_id: ME.id,
    assigned_at: EPOCH,
    closed_at: EPOCH,
  }),
];

const MESSAGES: Row[] = [
  {
    id: "77777777-7777-4777-8777-000000000001",
    ticket_id: T_MINE,
    author_user_id: CLIENT.id,
    author_kind: "requester",
    source: "web",
    body: "Добрый день! Нужно перенести бронь на следующую неделю.",
    created_at: EPOCH,
  },
  {
    id: "77777777-7777-4777-8777-000000000002",
    ticket_id: T_MINE,
    author_user_id: ME.id,
    author_kind: "operator",
    source: "web",
    body: "Здравствуйте! Уточняю у коллег, вернусь с ответом сегодня.",
    created_at: "2026-09-01T09:05:00.000Z",
  },
  {
    id: "77777777-7777-4777-8777-000000000003",
    ticket_id: T_CLOSED,
    author_user_id: CLIENT.id,
    author_kind: "requester",
    source: "web",
    body: "Спасибо, вопрос решён.",
    created_at: EPOCH,
  },
];

/** Three events with three different actors: nobody, the reader, a colleague. */
const EVENTS: Row[] = [
  {
    id: "88888888-8888-4888-8888-000000000001",
    ticket_id: T_MINE,
    event_type: "ticket_created",
    actor_user_id: null,
    visibility: "requester",
    payload: {},
    created_at: EPOCH,
  },
  {
    id: "88888888-8888-4888-8888-000000000002",
    ticket_id: T_MINE,
    event_type: "transferred",
    actor_user_id: MARIA.id,
    visibility: "operator",
    payload: { comment: "Это ближе к твоей локации." },
    created_at: "2026-09-01T09:02:00.000Z",
  },
  {
    id: "88888888-8888-4888-8888-000000000003",
    ticket_id: T_MINE,
    event_type: "claimed",
    actor_user_id: ME.id,
    visibility: "operator",
    payload: {},
    created_at: "2026-09-01T09:03:00.000Z",
  },
  {
    id: "88888888-8888-4888-8888-000000000004",
    ticket_id: T_CLOSED,
    event_type: "closed",
    actor_user_id: ME.id,
    visibility: "operator",
    payload: { summary: "Счёт выставлен повторно." },
    created_at: EPOCH,
  },
];

const CONTACTS: Row[] = [
  {
    ticket_id: T_MINE,
    contact_name: "Ольга Крылова",
    email_original: "olga@example.invalid",
    phone_e164: "+70000000000",
    email_verified: false,
    phone_verified: false,
  },
];

const SETTINGS: Row[] = [
  {
    id: true,
    intake_enabled: true,
    guest_intake_enabled: true,
    closed_message: "Приём обращений временно закрыт. Попробуйте позже.",
    ticket_limit_15m: 3,
    ticket_limit_day: 10,
    message_limit_5m: 20,
    message_limit_day: 200,
  },
];

async function openWorkspace(
  page: Page,
  options: { path?: string; permissions?: string[]; operators?: boolean } = {},
) {
  await openAdminFixture(page, {
    me: ME,
    globalRoleKeys: ["admin"],
    globalPermissionKeys: options.permissions ?? SUPPORT_PERMISSIONS,
    people: [MARIA, CLIENT],
    tables: {
      support_tickets: TICKETS,
      support_ticket_messages: MESSAGES,
      support_ticket_events: EVENTS,
      support_ticket_contacts: CONTACTS,
      support_settings: SETTINGS,
      support_operator_preferences: [],
    },
    rpc: (name) => {
      if (name === "support_operator_directory") {
        // Refused for anybody without `support.transfer` or `support.manage`,
        // which is the case `operators: false` reproduces.
        if (options.operators === false) {
          return { status: 400, body: { code: "P0001", message: "support_permission_denied" } };
        }
        return {
          body: [
            { id: ME.id, full_name: ME.full_name, username: ME.username },
            { id: MARIA.id, full_name: MARIA.full_name, username: MARIA.username },
          ],
        };
      }
      return undefined;
    },
  });
  await openAdmin(page, options.path ?? "/admin/support");
  await expect(page.getByTestId("support-operator-workspace")).toBeVisible();
}

function shot(info: TestInfo, name: string): string {
  return `output/support-workspace/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

// ---------------------------------------------------------------------------
// A-60 — a queue row names who holds the ticket
// ---------------------------------------------------------------------------

test("a queue row names the operator, and says when it is you", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Ожидают", exact: true }).click();

  const colleague = page.getByRole("button").filter({ hasText: "Не открывается вложение" });
  const mine = page.getByRole("button").filter({ hasText: "Просьба перенести бронь" });
  await expect(colleague.getByTestId("support-queue-assignee")).toHaveText("Назначено: Мария Соколова");
  await expect(mine.getByTestId("support-queue-assignee")).toHaveText("Назначено вам");

  // The pool is still the pool, with nobody's name on it.
  await page.getByRole("button", { name: "Общий пул", exact: true }).click();
  await expect(
    page.getByRole("button").filter({ hasText: "Не приходит код" }).getByTestId("support-queue-assignee"),
  ).toHaveText("Общий пул");
});

test("without the directory the row keeps the old words rather than inventing a name", async ({ page }) => {
  // `support_operator_directory` refuses anybody without `support.transfer` or
  // `support.manage`, so this is the ordinary case for a plain operator.
  await openWorkspace(page, {
    operators: false,
    permissions: ["support.view", "support.claim", "support.reply", "users.view"],
  });
  await page.getByRole("button", { name: "Ожидают", exact: true }).click();

  const colleague = page.getByRole("button").filter({ hasText: "Не открывается вложение" });
  await expect(colleague.getByTestId("support-queue-assignee")).toHaveText("Назначено оператору");
  // And their own row is still theirs, which needs no directory at all.
  await expect(
    page.getByRole("button").filter({ hasText: "Просьба перенести бронь" }).getByTestId("support-queue-assignee"),
  ).toHaveText("Назначено вам");
});

// ---------------------------------------------------------------------------
// D-143 — the address and the screen
// ---------------------------------------------------------------------------

test("the back button closes the ticket instead of leaving the address behind", async ({ page }, info) => {
  const wide = (info.project.use.viewport?.width ?? 1440) >= 768;
  await openWorkspace(page);
  await page.getByRole("button").filter({ hasText: "Не приходит код" }).click();

  await expect(page).toHaveURL(new RegExp(`ticket=${T_POOL}`));
  await expect(page.getByRole("heading", { name: "Не приходит код подтверждения" })).toBeVisible();

  await page.goBack();

  // The defect: the ticket stayed on screen while the address said otherwise,
  // because the selection was read from the URL once, at mount.
  await expect(page).not.toHaveURL(/ticket=/);
  await expect(page.getByRole("heading", { name: "Не приходит код подтверждения" })).toHaveCount(0);
  // The queue is what a phone gets back; the invitation to choose belongs to
  // the second column, which below `md` is not on the screen at all.
  await expect(page.getByRole("button").filter({ hasText: "Не приходит код" })).toBeVisible();
  if (wide) await expect(page.getByText("Выберите обращение")).toBeVisible();

  // And forward puts it back, which is the same rule read the other way.
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`ticket=${T_POOL}`));
  await expect(page.getByRole("heading", { name: "Не приходит код подтверждения" })).toBeVisible();
});

test("a ticket that will not load leaves a way back, on a phone too", async ({ page }, info) => {
  await openWorkspace(page, { path: `/admin/support?ticket=${T_GONE}` });

  const escape = page.getByTestId("support-ticket-unavailable");
  await expect(escape).toBeVisible();
  await expect(escape).toContainText("Обращение не открылось");
  // «Выберите обращение» was the old answer, and it is the wrong sentence: a
  // choice had been made and it failed.
  await expect(page.getByText("Выберите обращение")).toHaveCount(0);

  // On a phone the queue is hidden while a ticket is selected, so this button
  // is the only way out that is not the browser's own chrome.
  await page.setViewportSize({ width: 390, height: 844 });
  const back = escape.getByRole("button", { name: "Назад к очереди" });
  await expect(back).toBeVisible();
  await back.click();

  await expect(page).not.toHaveURL(/ticket=/);
  await expect(page.getByRole("button").filter({ hasText: "Не приходит код" })).toBeVisible();
  await page.setViewportSize(info.project.use.viewport ?? { width: 1440, height: 900 });
});

// ---------------------------------------------------------------------------
// A-65 — the editor says what it wants
// ---------------------------------------------------------------------------

test("the transfer editor names its minimum, its maximum and what is missing", async ({ page }) => {
  await openWorkspace(page, { path: `/admin/support?ticket=${T_MINE}` });
  await page.getByRole("button", { name: "Передать", exact: true }).click();

  const confirm = page.getByRole("button", { name: "Подтвердить", exact: true });
  const hint = page.getByTestId("support-action-hint");
  const blocker = page.getByTestId("support-action-blocker");

  // The requirement is on screen before anything is typed. It used to be
  // nowhere at all.
  await expect(hint).toHaveText("От 3 до 1000 символов. Текст попадёт в историю обращения.");
  await expect(confirm).toBeDisabled();
  await expect(blocker).toHaveText("Выберите коллегу, которому передаёте обращение.");

  await page.getByTestId("support-action-operator").selectOption({ label: "Мария Соколова (@maria)" });
  await expect(blocker).toContainText("не меньше 3 символов");

  // By test id, not by position: the composer's own textarea is earlier in
  // the DOM, so `getByRole("textbox").first()` is the reply box and a test
  // written that way measures the wrong field's ceiling.
  const field = page.getByTestId("support-action-comment");
  await field.fill("да");
  await expect(blocker).toContainText("не меньше 3 символов");
  await expect(confirm).toBeDisabled();

  await field.fill("Это её локация.");
  await expect(blocker).toHaveCount(0);
  await expect(confirm).toBeEnabled();
});

test("the field's ceiling is the ceiling of the function the press calls", async ({ page }) => {
  // Not in the register: the textarea allowed 4000 characters for all five
  // actions, and `support_ticket_transfer` refuses anything over 1000. Typing
  // 1500 characters of reason was possible and came back as
  // `invalid_support_transfer`.
  await openWorkspace(page, { path: `/admin/support?ticket=${T_MINE}` });

  await page.getByRole("button", { name: "Передать", exact: true }).click();
  await expect(page.getByTestId("support-action-comment")).toHaveAttribute("maxlength", "1000");

  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.getByRole("button", { name: "Решить", exact: true }).click();
  await expect(page.getByTestId("support-action-comment")).toHaveAttribute("maxlength", "4000");
  await expect(page.getByTestId("support-action-hint")).toContainText("до 4000 символов");
});

// ---------------------------------------------------------------------------
// A-67 — the history says who
// ---------------------------------------------------------------------------

test("every event in the history carries its actor", async ({ page }) => {
  await openWorkspace(page, { path: `/admin/support?ticket=${T_MINE}` });

  const rows = page.getByTestId("support-event-meta");
  const text = await rows.allInnerTexts();
  expect(text.length).toBe(3);

  // Newest first: claimed (me), transferred (Мария), created (nobody).
  expect(text[0]).toContain("Вы · ");
  expect(text[1]).toContain("Мария Соколова · ");
  // A guest form's `ticket_created` has no actor, and none is invented for it.
  expect(text[2]).not.toContain("·");
  expect(text[2].trim().length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// A-63 — the composer says the true reason
// ---------------------------------------------------------------------------

test("a closed ticket says it is closed, not that it must be accepted first", async ({ page }) => {
  await openWorkspace(page, { path: `/admin/support?ticket=${T_CLOSED}` });

  const notice = page.getByTestId("support-reply-notice");
  await expect(notice).toHaveText("Обращение закрыто. Откройте его заново, чтобы ответить.");
  await expect(page.getByText("Сначала примите обращение")).toHaveCount(0);
  // And the way out it names is on the screen beside it.
  await expect(page.getByRole("button", { name: "Открыть заново", exact: true })).toBeVisible();
});

test("a missing permission is named as the catalogue names it", async ({ page }) => {
  await openWorkspace(page, {
    path: `/admin/support?ticket=${T_MINE}`,
    permissions: ["support.view", "users.view"],
    operators: false,
  });

  const notice = page.getByTestId("support-reply-notice");
  await expect(notice).toHaveText("Чтобы отвечать в обращениях, нужно право «Отвечать в обращениях».");
  // «Ответы поддержки» was the old sentence, and no such right exists.
  await expect(page.getByText("Ответы поддержки")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// A-69 — «Сохранить» says why
// ---------------------------------------------------------------------------

test("the settings dialog says why a save is unavailable", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();

  const save = page.getByRole("button", { name: "Сохранить", exact: true });
  await expect(save).toBeEnabled();
  await expect(page.getByTestId("support-settings-blocker")).toHaveCount(0);

  await page.getByRole("textbox").first().fill("ок");
  // The dialog's only textbox is the closed-intake message; the workspace
  // behind it is covered by the modal.
  await expect(page.getByTestId("support-settings-blocker")).toHaveText(
    "Сообщение при закрытом приёме — не меньше 3 символов.",
  );
  await expect(save).toBeDisabled();

  await page.getByRole("textbox").first().fill("Приём закрыт до понедельника.");
  await expect(save).toBeEnabled();

  // A limit that contradicts another one is named too, and by the pair it
  // breaks rather than by a general «проверьте поля».
  await page.getByRole("spinbutton").nth(1).fill("1");
  await expect(page.getByTestId("support-settings-blocker")).toContainText("Суточный лимит обращений");
  await expect(save).toBeDisabled();
});

// ---------------------------------------------------------------------------
// The frames
// ---------------------------------------------------------------------------

for (const theme of ["dark", "light"] as const) {
  test(`frames — ${theme}`, async ({ page }, info) => {
    const workspace = page.getByTestId("support-operator-workspace");

    await openWorkspace(page);
    await stampTheme(page, theme);
    await page.getByRole("button", { name: "Ожидают", exact: true }).click();
    await expect(page.getByTestId("support-queue-assignee").first()).toBeVisible();
    await workspace.screenshot({ path: shot(info, `queue-assignees-${theme}`) });

    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByRole("textbox").first().fill("ок");
    await expect(page.getByTestId("support-settings-blocker")).toBeVisible();
    await page.screenshot({ path: shot(info, `settings-blocker-${theme}`) });
    await page.getByRole("button", { name: "Закрыть настройки" }).click();

    await page.goto(`/admin/support?ticket=${T_MINE}`, { waitUntil: "domcontentloaded" });
    await stampTheme(page, theme);
    await expect(workspace).toBeVisible();
    await page.getByRole("button", { name: "Передать", exact: true }).click();
    await expect(page.getByTestId("support-action-hint")).toBeVisible();
    // The editor opens below the fold of its own column, so the frame is taken
    // with it scrolled to. Recorded rather than fixed: nothing here scrolls it
    // into view on the press, which is worth its own entry and not this batch.
    await page.getByRole("button", { name: "Подтвердить", exact: true }).scrollIntoViewIfNeeded();
    await workspace.screenshot({ path: shot(info, `transfer-editor-${theme}`) });

    await page.goto(`/admin/support?ticket=${T_CLOSED}`, { waitUntil: "domcontentloaded" });
    await stampTheme(page, theme);
    await expect(page.getByTestId("support-reply-notice")).toBeVisible();
    await workspace.screenshot({ path: shot(info, `closed-ticket-${theme}`) });

    await page.goto(`/admin/support?ticket=${T_GONE}`, { waitUntil: "domcontentloaded" });
    await stampTheme(page, theme);
    await expect(page.getByTestId("support-ticket-unavailable")).toBeVisible();
    await workspace.screenshot({ path: shot(info, `unavailable-${theme}`) });
  });
}
