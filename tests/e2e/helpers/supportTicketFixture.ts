import { expect, type Page } from "@playwright/test";
import { EPOCH, openAdmin, openAdminFixture, person, type Row } from "./adminFixture";

/**
 * One open support ticket, on screen, without signing in.
 *
 * D-222 tier 2 names `SupportTicketDetails.tsx:150` — the `lg:` that splits the
 * details pane into a conversation column and a 20rem sidebar — and says the
 * arithmetic makes that 352+320 at a 1024 viewport. This puts the pane on the
 * page so the split can be photographed and measured instead.
 *
 * Every row is invented. `helpers/adminFixture.ts` explains why a fixture
 * rather than a QA sign-in: these frames are meant to be looked at, and a
 * signed-in run reaches production for the session even when the rows are
 * mocked.
 */

const ME = person("55555555-5555-4555-8555-00000000d222", "Павел Ильин", "pavel");
const MARIA = person("55555555-5555-4555-8555-00000000d223", "Мария Соколова", "maria");
const CLIENT = person("55555555-5555-4555-8555-00000000d224", "Ольга Крылова", "olga");

export const TICKET_ID = "66666666-6666-4666-8666-00000000d222";

const PERMISSIONS = [
  "support.view",
  "support.claim",
  "support.reply",
  "support.transfer",
  "support.escalate",
  "support.manage",
  "support.settings",
  "support.lookup_customer",
  "users.view",
];

const TICKETS: Row[] = [
  {
    id: TICKET_ID,
    public_reference: "LC-2026-00D222",
    requester_user_id: CLIENT.id,
    source: "web",
    category: "access",
    priority: "normal",
    assigned_operator_id: ME.id,
    assigned_at: EPOCH,
    urgent: false,
    linked_ticket_id: null,
    resolution_summary: null,
    resolved_at: null,
    closed_at: null,
    status: "waiting_support",
    subject: "Не приходит код подтверждения при входе",
    last_requester_message_at: EPOCH,
    last_operator_message_at: null,
    last_activity_at: EPOCH,
    created_at: EPOCH,
    updated_at: EPOCH,
    version: 1,
  },
];

const MESSAGES: Row[] = [
  {
    id: "77777777-7777-4777-8777-00000000d222",
    ticket_id: TICKET_ID,
    author_user_id: CLIENT.id,
    author_kind: "requester",
    source: "web",
    body: "Добрый день! Второй день не приходит код подтверждения на телефон, пробовала и через Telegram, и обычным сообщением.",
    created_at: EPOCH,
  },
  {
    id: "77777777-7777-4777-8777-00000000d223",
    ticket_id: TICKET_ID,
    author_user_id: ME.id,
    author_kind: "operator",
    source: "web",
    body: "Здравствуйте! Проверяю доставку по вашему номеру, вернусь с ответом сегодня.",
    created_at: "2026-09-01T09:05:00.000Z",
  },
];

const EVENTS: Row[] = [
  {
    id: "88888888-8888-4888-8888-00000000d222",
    ticket_id: TICKET_ID,
    event_type: "ticket_created",
    actor_user_id: null,
    visibility: "requester",
    payload: {},
    created_at: EPOCH,
  },
  {
    id: "88888888-8888-4888-8888-00000000d223",
    ticket_id: TICKET_ID,
    event_type: "claimed",
    actor_user_id: ME.id,
    visibility: "operator",
    payload: {},
    created_at: "2026-09-01T09:03:00.000Z",
  },
];

const CONTACTS: Row[] = [
  {
    ticket_id: TICKET_ID,
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

export interface SupportTicketFixtureOptions {
  theme?: "dark" | "light";
  /** Lets Inter through the fixture's blanket abort. Captures only. */
  webFont?: boolean;
}

export async function openSupportTicket(page: Page, options: SupportTicketFixtureOptions = {}) {
  const { theme = "dark", webFont = false } = options;

  await openAdminFixture(page, {
    me: ME,
    theme,
    globalRoleKeys: ["admin"],
    globalPermissionKeys: PERMISSIONS,
    people: [MARIA, CLIENT],
    tables: {
      support_tickets: TICKETS,
      support_ticket_messages: MESSAGES,
      support_ticket_events: EVENTS,
      support_ticket_contacts: CONTACTS,
      support_settings: SETTINGS,
      support_operator_preferences: [],
    },
    rpc: (name) =>
      name === "support_operator_directory"
        ? {
            body: [
              { id: ME.id, full_name: ME.full_name, username: ME.username },
              { id: MARIA.id, full_name: MARIA.full_name, username: MARIA.username },
            ],
          }
        : undefined,
  });

  // Registered after the fixture's blanket abort, and Playwright runs the most
  // recently added matching handler first.
  if (webFont) {
    await page.route(
      (url) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com",
      (route) => route.continue(),
    );
  }

  await openAdmin(page, `/admin/support?ticket=${TICKET_ID}`);
  await expect(page.getByRole("heading", { name: TICKETS[0].subject as string })).toBeVisible();
}
