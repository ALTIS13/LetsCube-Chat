#!/usr/bin/env node
/**
 * Renders the computer's shell as the owner approved it on 2026-09-12 —
 * «A с поправками»: a 72pt folder rail at the window's left edge, the
 * side-menu button on top of it, the side list as a layer, and a chat list the
 * person drags down to a strip of avatars.
 *
 * Every frame is the real application at `/`, signed in as a fictional person
 * against a backend played by route mocks on the fixture host — the pattern of
 * `tests/e2e/chat-list-event-cost.spec.ts` — so the rail, the list, the folders
 * and the role gating are the shipping components reading fictional rows.
 * Nothing on a network is reached except the two font hosts, and a server
 * that is not on the fixture configuration is refused. The exception is not
 * a convenience: the product loads Inter from Google Fonts and self-hosts no
 * face, so a run that blocks those hosts draws every frame in Segoe UI and
 * measures a narrower product than the one people use — measured here on
 * 2026-09-12, «Управление» 69.88 in the fallback against 75.19 in Inter.
 *
 * The Windows frames stub the desktop bridge the Tauri shell injects, so the
 * application draws its own window buttons, and outline the zone those buttons
 * take together with every page control that reaches into it (D-112).
 *
 * Measured on every frame, and written into `measurements.md`:
 *
 *  - the rail's width, the list column's width, the narrow ratio, and the
 *    width of one chat row — which is what says whether the strip really is
 *    Telegram's 66pt;
 *  - whether the bottom capsule is on screen, which on a computer it must
 *    never be;
 *  - the window buttons' zone and anything reaching into it;
 *  - contrast, from photographed pixels as rule 7 of
 *    docs/operations/interface-material.md asks, for the text the rail adds:
 *    a folder's label, the chosen folder's label and a folder's count. The
 *    text is made transparent, its backdrop photographed, the colour
 *    composited over every pixel, and the worst pixel reported with the median.
 *
 * It launches the full Chromium build, not Playwright's headless shell, which
 * does not frost the contents of a scrolling container.
 *
 * Usage:
 *   KUB_BASE_URL=http://127.0.0.1:5291 node scripts/render-desktop-shell-frames.mjs
 *     [--only dark-desktop-rest,dark-windows-tasks]   some frames
 *     [--sheets]                                      only the sheets
 *
 * Writes output/renders/2026-09-12-desktop-shell/: frames/*.png, crops/*.png,
 * measurements/*.json, measurements.md and sheet-*.png with their HTML.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function loadChromium() {
  // The pinned build first, as the other render scripts resolve it; a plain
  // resolve second, so a different install still works.
  const pinned = path.join(ROOT, "node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs");
  if (existsSync(pinned)) return (await import(pathToFileURL(pinned).href)).chromium;
  return (await import("playwright")).chromium;
}

const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] ?? null : null;
};
const only = argValue("--only") ? new Set(argValue("--only").split(",").map((id) => id.trim())) : null;
const sheetsOnly = process.argv.includes("--sheets");

const BASE = process.env.KUB_BASE_URL ?? "";

/**
 * The only hosts a frame may reach. The font hosts are here because the
 * product has no self-hosted face: block them and the frame is Segoe UI.
 */
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"]);
const OUT = path.join(ROOT, "output", "renders", "2026-09-12-desktop-shell");
const FRAMES_DIR = path.join(OUT, "frames");
const CROPS_DIR = path.join(OUT, "crops");
const MEASUREMENTS_DIR = path.join(OUT, "measurements");
const FIXTURE_HOST = "http://127.0.0.1:54321";
const SHELL_KEY = "kub-desktop-chat-list";
const CLOCK = new Date("2026-09-12T18:00:00+03:00");

/** Telegram Desktop's own constants, quoted in the 2026-09-12 assessment. */
const RAIL_WIDTH = 72;
const COLLAPSED_WIDTH = 66;

// ── the people, the chats and what they last said ──────────────────────────

const id = (prefix, n) => `${prefix}-${String(n).padStart(12, "0")}`;
const person = (n) => id("11111111-1111-4111-8111", n);
const chatId = (n) => id("22222222-2222-4222-8222", n);

const ME = person(1);
const PEOPLE = {
  [ME]: "Максим Орлов",
  [person(2)]: "Анна Смирнова",
  [person(3)]: "Борис Ковалёв",
  [person(4)]: "Вера Лебедева",
  [person(5)]: "Глеб Новиков",
  [person(6)]: "Дарья Соколова",
  [person(7)]: "Егор Павлов",
  [person(8)]: "Илья Фёдоров",
  [person(9)]: "Кира Волкова",
  [person(10)]: "Лев Зайцев",
};
const [ANNA, BORIS, VERA, GLEB, DARIA, EGOR, ILYA, KIRA, LEV] = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(person);

function at(time, days = 0) {
  const [hours, minutes] = time.split(":").map(Number);
  const stamp = new Date(CLOCK);
  stamp.setDate(stamp.getDate() - days);
  stamp.setHours(hours, minutes, 0, 0);
  return stamp.toISOString();
}

const OPEN_CHAT = chatId(2);
const PROBE_CHATS = { group: chatId(3), privateChat: chatId(4) };

/** Fifteen chats: the saved one, two pinned, groups, private chats, a channel. */
const CHATS = [
  { id: chatId(1), type: "group", name: "Избранное", members: [ME], last: { from: ME, text: "Черновик сметы для витрины", at: at("12:05") }, unread: 0 },
  { id: chatId(10), type: "group", name: "Команда проекта", pinned: 1, members: [ME, ANNA, BORIS, VERA], last: { from: ANNA, text: "Макет главной готов, посмотрите до вечера", at: at("17:40") }, unread: 12 },
  { id: OPEN_CHAT, type: "private", pinned: 2, members: [ME, ANNA], last: { from: ME, text: "Отправил адрес, до встречи у входа", at: at("17:54") }, unread: 0, readBy: [ANNA] },
  { id: chatId(3), type: "group", name: "Дизайн", members: [ME, VERA, GLEB], last: { from: VERA, text: "Обновила палитру и иконки для папок", at: at("17:31") }, unread: 7 },
  { id: chatId(4), type: "private", members: [ME, BORIS], last: { from: BORIS, text: "Созвонимся вечером? Есть пара вопросов по складу", at: at("16:58") }, unread: 2 },
  { id: chatId(5), type: "channel", name: "Релизы", members: [ME, GLEB], last: { from: GLEB, text: "Сборка 0.2.11 ушла тестерам, заметки в описании", at: at("16:20") }, unread: 291, muted: true },
  { id: chatId(6), type: "group", name: "Автоматизация", members: [ME, BORIS], last: { from: BORIS, text: "Новая задача: проверить витрину до пятницы", at: at("15:47") }, unread: 1 },
  { id: chatId(7), type: "private", members: [ME, GLEB], last: { from: ME, text: "Скинул фото стенда, глянь, когда будет минута", at: at("15:12") }, unread: 0 },
  { id: chatId(8), type: "group", name: "Склад", members: [ME, EGOR, BORIS], last: { from: EGOR, text: "Поставка перенесена на пятницу", at: at("14:05") }, unread: 3, muted: true },
  { id: chatId(9), type: "group", name: "Маркетинг", members: [ME, DARIA, KIRA, LEV], last: { from: ME, text: "Согласовал баннер для главной", at: at("13:30") }, unread: 0 },
  { id: chatId(11), type: "private", members: [ME, DARIA], last: { from: DARIA, text: "Спасибо, всё получила!", at: at("12:48") }, unread: 0 },
  { id: chatId(12), type: "private", members: [ME, ILYA], last: { from: ILYA, text: "Наберу после обеда", at: at("11:20") }, unread: 0 },
  { id: chatId(13), type: "private", members: [ME, KIRA], last: { from: KIRA, text: "Отправила смету на согласование", at: at("19:02", 1) }, unread: 0 },
  { id: chatId(14), type: "group", name: "Офис", members: [ME, LEV, EGOR], last: { from: LEV, text: "Кто сегодня заказывает воду?", at: at("18:15", 1) }, unread: 0 },
  { id: chatId(15), type: "private", members: [ME, LEV], last: { from: LEV, text: "Ок, завтра обсудим", at: at("10:40", 2) }, unread: 0 },
];

const MUTED = CHATS.filter((entry) => entry.muted).map((entry) => entry.id);

const CONVERSATION = [
  { from: ANNA, text: "Привет! Ты завтра будешь на площадке?", at: at("19:40", 1) },
  { from: ME, text: "Да, с утра. Нужно проверить витрину после монтажа.", at: at("19:44", 1) },
  { from: ANNA, text: "Доброе утро! Подрядчик подтвердил, приедет к одиннадцати.", at: at("09:12") },
  { from: ME, text: "Хорошо, буду к половине одиннадцатого", at: at("09:15") },
  { from: ANNA, text: "Возьми, пожалуйста, распечатку сметы — обсудим сроки на месте.", at: at("12:30") },
  { from: ME, text: "Взял. По срокам всё в силе, две недели", at: at("12:41") },
  { from: ANNA, text: "Жду. И напомни Борису про ключи от склада", at: at("17:20") },
  { from: ME, text: "Отправил адрес, до встречи у входа", at: at("17:54") },
];

const FOLDERS = [
  { id: "44444444-4444-4444-8444-000000000001", name: "Личные", scope: "personal", position: 1, chats: [OPEN_CHAT, chatId(4), chatId(7), chatId(11), chatId(12), chatId(13), chatId(15)] },
  { id: "44444444-4444-4444-8444-000000000002", name: "Работа", scope: "shared", position: 2, chats: [chatId(10), chatId(3), chatId(6), chatId(8), chatId(9), chatId(14)] },
  { id: "44444444-4444-4444-8444-000000000003", name: "Каналы", scope: "personal", position: 3, chats: [chatId(5)] },
];

const ROLES = {
  staff: {
    profileRole: "manager",
    globalRoles: new Set(["manager"]),
    permissions: new Set(["tasks.view", "tasks.create", "tasks.assign", "tasks.manage", "users.view", "location_members.view", "chats.invite"]),
  },
  regular: { profileRole: "user", globalRoles: new Set(), permissions: new Set(["chats.invite"]) },
};

// ── the backend ──────────────────────────────────────────────────────────────

const EPOCH = "2026-09-01T09:00:00.000Z";

function profile(userId, role = "user") {
  return {
    id: userId,
    full_name: PEOPLE[userId],
    username: userId === ME ? "maksim" : null,
    avatar_url: null,
    bio: null,
    role,
    is_test_account: false,
    profile_frame: null,
    profile_background: null,
    online_at: EPOCH,
    created_at: EPOCH,
    updated_at: EPOCH,
  };
}

function messageRow(messageId, chat, last) {
  return {
    id: messageId,
    chat_id: chat,
    topic_id: null,
    user_id: last.from,
    bot_id: null,
    sender_deleted_at: null,
    content: last.text,
    type: "text",
    media_bucket: null,
    media_path: null,
    media_url: null,
    media_metadata: {},
    reply_to_id: null,
    forwarded_from_id: null,
    client_message_id: null,
    client_sent_at: null,
    bot_reply_markup: null,
    pinned: false,
    created_at: last.at,
    edited_at: null,
    deleted_at: null,
  };
}

class Backend {
  constructor(role) {
    this.role = ROLES[role];
    this.me = profile(ME, this.role.profileRole);
    this.memberships = [];
    this.chats = [];
    this.messages = [];
    for (const entry of CHATS) {
      if (entry.id !== OPEN_CHAT) this.messages.push(messageRow(`${entry.id}-last`, entry.id, entry.last));
      this.chats.push({
        id: entry.id,
        type: entry.type,
        name: entry.name ?? null,
        description: null,
        avatar_url: null,
        created_by: ME,
        created_at: EPOCH,
        updated_at: entry.last.at,
        is_forum: false,
        invite_policy: "admins_only",
      });
      for (const userId of entry.members) {
        const lastRead = userId === ME
          ? entry.unread > 0 ? at("08:00", 3) : entry.last.at
          : entry.readBy?.includes(userId) ? entry.last.at : at("08:00", 3);
        this.memberships.push({
          chat_id: entry.id,
          user_id: userId,
          role: userId === ME ? "owner" : "member",
          joined_at: EPOCH,
          last_read_at: lastRead,
          last_delivered_at: lastRead,
          hidden_at: null,
          cleared_at: null,
          pinned: userId === ME && Boolean(entry.pinned),
          pinned_at: userId === ME && entry.pinned ? EPOCH : null,
          pinned_order: userId === ME && entry.pinned ? entry.pinned : null,
        });
      }
    }
    CONVERSATION.forEach((entry, index) => {
      this.messages.push(messageRow(`${OPEN_CHAT}-m${String(index).padStart(2, "0")}`, OPEN_CHAT, entry));
    });
  }

  profileOf(userId) {
    return userId === ME ? this.me : profile(userId);
  }

  joined(row) {
    return { ...row, sender: row.user_id ? this.profileOf(row.user_id) : null, bot: null, reply_to: null, reactions: [] };
  }

  unreadOf(chat) {
    const fixture = CHATS.find((entry) => entry.id === chat);
    const mine = this.memberships.find((row) => row.chat_id === chat && row.user_id === ME);
    if (!fixture || !mine) return 0;
    return Date.parse(mine.last_read_at) >= Date.parse(fixture.last.at) ? 0 : fixture.unread;
  }

  async handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const single = (request.headers().accept ?? "").includes("application/vnd.pgrst.object");
    const one = (rows) => (single ? rows[0] ?? null : rows);
    if (method === "OPTIONS") return route.fulfill({ status: 204 });
    if (url.pathname === "/auth/v1/user") return json(route, sessionUser());
    if (!url.pathname.startsWith("/rest/v1/")) return json(route, {});

    const resource = url.pathname.slice("/rest/v1/".length);
    if (resource.startsWith("rpc/")) {
      let body = {};
      try {
        body = request.postDataJSON() ?? {};
      } catch {
        body = {};
      }
      return this.rpc(route, resource.slice(4), body);
    }

    const params = url.searchParams;
    switch (resource) {
      case "profiles":
        return json(route, one(filterRows(Object.keys(PEOPLE).map((userId) => this.profileOf(userId)), params)));
      case "chat_members":
        if (method !== "GET") return json(route, single ? null : []);
        return json(route, one(filterRows(this.memberships, params).map((row) => ({ ...row, profile: this.profileOf(row.user_id) }))));
      case "chats": {
        if (method !== "GET") return route.fulfill({ status: 204 });
        const rows = orderRows(filterRows(this.chats, params), params.get("order")).map((entry) => ({
          ...entry,
          members: this.memberships.filter((row) => row.chat_id === entry.id).map((row) => ({ ...row, profile: this.profileOf(row.user_id) })),
        }));
        return json(route, one(rows));
      }
      case "messages": {
        if (method !== "GET") return json(route, single ? null : []);
        const matched = orderRows(filterRows(this.messages, params), params.get("order"));
        const limit = Number(params.get("limit") ?? matched.length);
        const rows = matched.slice(0, Number.isFinite(limit) ? limit : matched.length).map((row) => this.joined(row));
        if ((request.headers().prefer ?? "").includes("count=")) {
          return json(route, rows, 200, { "access-control-expose-headers": "Content-Range", "content-range": `*/${matched.length}` });
        }
        return json(route, single ? rows[0] ?? null : rows);
      }
      case "folders":
        return json(route, one(FOLDERS.map((folder) => ({ id: folder.id, user_id: ME, created_by: ME, scope: folder.scope, name: folder.name, emoji: null, position: folder.position, created_at: EPOCH }))));
      case "folder_chats":
        return json(route, one(FOLDERS.flatMap((folder) => folder.chats.map((entry) => ({ folder_id: folder.id, chat_id: entry })))));
      case "notifications":
        return json(route, one([]));
      default:
        return json(route, single ? null : []);
    }
  }

  rpc(route, name, body) {
    if (name === "chat_list_summaries") {
      const ids = body.p_chat_ids ?? CHATS.map((entry) => entry.id);
      return json(
        route,
        CHATS.filter((entry) => ids.includes(entry.id)).map((entry) => {
          const last = entry.id === OPEN_CHAT
            ? this.messages.filter((row) => row.chat_id === OPEN_CHAT).at(-1)
            : this.messages.find((row) => row.id === `${entry.id}-last`);
          return { chat_id: entry.id, last_message: last ? this.joined(last) : null, unread_count: this.unreadOf(entry.id) };
        }),
      );
    }
    if (name === "has_permission") return json(route, this.role.permissions.has(body.p_permission_key));
    if (name === "has_global_role") return json(route, this.role.globalRoles.has(body.p_role_key));
    if (name === "has_location_permission") return json(route, false);
    if (name === "mark_chat_read" || name === "mark_chat_read_through" || name === "mark_chat_delivered") {
      const mine = this.memberships.find((row) => row.chat_id === body.p_chat_id && row.user_id === ME);
      if (mine && name !== "mark_chat_delivered") mine.last_read_at = CLOCK.toISOString();
      return route.fulfill({ status: 204 });
    }
    return json(route, null);
  }
}

function sessionUser() {
  return {
    id: ME,
    aud: "authenticated",
    role: "authenticated",
    email: "desktop-shell-render@example.invalid",
    user_metadata: { full_name: PEOPLE[ME] },
    app_metadata: {},
    created_at: EPOCH,
  };
}

const NON_FILTER_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function filterRows(rows, params) {
  return rows.filter((row) => {
    for (const [column, expression] of params) {
      if (NON_FILTER_PARAMS.has(column) || column === "or") continue;
      if (!matches(row[column], expression)) return false;
    }
    return true;
  });
}

function matches(value, expression) {
  const negated = expression.startsWith("not.");
  const body = negated ? expression.slice(4) : expression;
  const dot = body.indexOf(".");
  const operator = body.slice(0, dot);
  const operand = decodeURIComponent(body.slice(dot + 1));
  const present = value !== null && value !== undefined;
  const compare = () => {
    const left = Date.parse(String(value));
    const right = Date.parse(operand);
    return Number.isFinite(left) && Number.isFinite(right) ? left - right : String(value).localeCompare(operand);
  };
  let result;
  switch (operator) {
    case "eq": result = present && String(value) === operand; break;
    case "neq": result = present && String(value) !== operand; break;
    case "is": result = operand === "null" ? !present : String(value) === operand; break;
    case "gt": result = present && compare() > 0; break;
    case "gte": result = present && compare() >= 0; break;
    case "lt": result = present && compare() < 0; break;
    case "lte": result = present && compare() <= 0; break;
    case "in": result = present && operand.replace(/^\(|\)$/g, "").split(",").map((item) => item.replace(/^"|"$/g, "")).includes(String(value)); break;
    default: result = true;
  }
  return negated ? !result : result;
}

function orderRows(rows, order) {
  if (!order) return rows;
  const keys = order.split(",").map((part) => {
    const [column, direction] = part.split(".");
    return { column, descending: direction === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const { column, descending } of keys) {
      const left = Date.parse(String(a[column]));
      const right = Date.parse(String(b[column]));
      const byValue = Number.isFinite(left) && Number.isFinite(right) ? left - right : String(a[column]).localeCompare(String(b[column]));
      if (byValue !== 0) return descending ? -byValue : byValue;
    }
    return 0;
  });
}

async function json(route, body, status = 200, headers) {
  await route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
}

// ── what is rendered ────────────────────────────────────────────────────────

const DEVICES = {
  /** A wide desktop: two panes with room to spare. */
  desktop: { viewport: { width: 1440, height: 900 }, windows: false },
  /** A narrow window: the smallest a person is likely to work in. */
  narrow: { viewport: { width: 1024, height: 720 }, windows: false },
  /** A phone. Below `md`, so the folder rail is hidden, the horizontal strip
   *  is the only folder surface, and the bottom bar is on screen. */
  phone: { viewport: { width: 390, height: 844 }, windows: false },
  /** The Windows app, drawing its own window buttons. */
  windows: { viewport: { width: 1440, height: 900 }, windows: true },
  /** The same, in the narrow window — where the buttons' zone is proportionally
   *  the largest share of the top edge and the panes have least room. */
  windowsNarrow: { viewport: { width: 1024, height: 720 }, windows: true },
};

/**
 * `rest` is the shell as it opens; `collapsed` is the list dragged to the strip
 * of avatars; `menu` has the side list open over the window; `chat` opens the
 * private chat with Анна; `tasks` is the page where D-112 was seen.
 */
const SCENES = {
  rest: { path: "/", openChat: false, collapsed: false, menu: false },
  /** The list scrolled past the point where a phone tucks its search row. */
  scrolled: { path: "/", openChat: false, collapsed: false, menu: false, scrolled: true },
  /** Settings open on the phone, at the row that introduces administration. */
  settings: { path: "/", openChat: false, collapsed: false, menu: false, settings: true },
  collapsed: { path: "/", openChat: true, collapsed: true, menu: false },
  menu: { path: "/", openChat: false, collapsed: false, menu: true },
  chat: { path: "/", openChat: true, collapsed: false, menu: false },
  tasks: { path: "/tasks", openChat: false, collapsed: false, menu: false },
};

const FRAMES = [];
const add = (theme, device, scene, role = "staff") =>
  FRAMES.push({ id: `${theme}-${device}-${scene}${role === "staff" ? "" : `-${role}`}`, theme, device, scene, role });

// The phone, in both themes, for the two changes of 2026-09-12: the folders
// are drawn once — the strip here, the rail on a computer — and the bottom
// bar carries four tabs instead of six. The staff role is deliberate: it is
// the role that used to be shown «Админка» as a sixth tab, so if that tab
// ever came back this is the frame it would come back in.
add("dark", "phone", "rest");
add("light", "phone", "rest");
// The same phone with the list scrolled: the search row tucked away and the
// magnifier in its place, which is the half of the change a resting frame
// cannot show.
add("dark", "phone", "scrolled");
add("light", "phone", "scrolled");
// Settings open at the administration row, with the hint that greets a
// person who has just been given the right.
add("dark", "phone", "settings");
add("light", "phone", "settings");
add("dark", "desktop", "rest");
add("dark", "desktop", "collapsed");
add("dark", "desktop", "menu");
add("dark", "desktop", "chat");
add("light", "desktop", "rest");
add("light", "desktop", "collapsed");
add("light", "desktop", "menu");
add("light", "desktop", "chat");
add("dark", "desktop", "menu", "regular");
add("dark", "narrow", "rest");
add("dark", "narrow", "collapsed");
add("light", "narrow", "chat");
// The Windows shell, at both widths and with the side list both closed and
// open, plus a chat open — which is the state the top bar's removal actually
// put at risk, because the chat header's «Ещё» is at the right of the pane's
// first row and that row is now the top of the window (D-112).
add("dark", "windows", "rest");
add("dark", "windows", "chat");
add("dark", "windows", "menu");
add("dark", "windows", "tasks");
add("dark", "windowsNarrow", "rest");
add("dark", "windowsNarrow", "chat");
add("dark", "windowsNarrow", "menu");

/**
 * Where the rail's and the side list's words are measured: the plain desktop
 * frames only.
 *
 * Contrast does not change with the shell. A Windows frame differs from its
 * desktop twin by the 2rem the window's own buttons take off the top edge, and
 * nothing the probe photographs moves because of it — so measuring those again
 * would add columns to a table that is already wide and no information to it.
 */
const measuresText = (frame) =>
  frame.device === "desktop" && (frame.scene === "menu" || frame.scene === "rest");

/** The text the rail adds, measured from photographed pixels (rule 7). */
const TEXT_TARGETS = [
  { id: "rail-active", label: "Полоса папок — выбранная" },
  { id: "rail-idle", label: "Полоса папок — другая" },
  { id: "rail-count", label: "Полоса папок — счётчик" },
  { id: "menu-row", label: "Боковой список — строка" },
  { id: "menu-admin", label: "Боковой список — «Управление»" },
  { id: "menu-version", label: "Боковой список — версия" },
];

// ── driving a frame ─────────────────────────────────────────────────────────

async function settle(page) {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity);
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function assertFixtureServer() {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) {
    throw new Error("KUB_BASE_URL must be a loopback dev server, e.g. http://127.0.0.1:5291");
  }
  const client = await fetch(`${BASE}/src/lib/supabase/client.ts`).then((response) => response.text());
  if (!client.includes("127.0.0.1:54321")) throw new Error("The dev server is not on the fixture configuration.");
  // A server that has taken hot updates hands the application a second store.
  if (client.includes("app.store.ts?t=")) throw new Error("The dev server is stale; restart it before rendering.");
}

async function installRealtime(page) {
  try {
    const { RealtimeFixture } = await import(pathToFileURL(path.join(ROOT, "tests/e2e/helpers/realtime-fixture.ts")).href);
    await new RealtimeFixture().install(page);
  } catch {
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, () => undefined);
  }
}

/** The window buttons' zone, and every page control that reaches into it. */
async function windowControlsZone(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="desktop-window-chrome"]');
    const buttons = host ? [...host.querySelectorAll("button")] : [];
    if (!buttons.length) return null;
    const boxes = buttons.map((button) => button.getBoundingClientRect());
    const zone = {
      x: Math.min(...boxes.map((box) => box.left)),
      y: Math.min(...boxes.map((box) => box.top)),
      right: Math.max(...boxes.map((box) => box.right)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
    };
    const intersects = [];
    for (const control of document.querySelectorAll('button, a[href], input, [role="button"], [role="tab"], [role="separator"], textarea')) {
      if (host.contains(control)) continue;
      const box = control.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      const style = getComputedStyle(control);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const overlapX = Math.min(box.right, zone.right) - Math.max(box.left, zone.x);
      const overlapY = Math.min(box.bottom, zone.bottom) - Math.max(box.top, zone.y);
      if (overlapX > 0.5 && overlapY > 0.5) {
        intersects.push({
          what: control.getAttribute("aria-label") || control.textContent?.trim().slice(0, 40) || control.tagName.toLowerCase(),
          box: { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) },
          covered: Number(((overlapX * overlapY) / (box.width * box.height)).toFixed(2)),
        });
      }
    }
    return {
      zone: { x: Math.round(zone.x), y: Math.round(zone.y), width: Math.round(zone.right - zone.x), height: Math.round(zone.bottom - zone.y) },
      intersects,
    };
  });
}

async function drawZone(page, zone) {
  await page.evaluate((value) => {
    const layer = document.createElement("div");
    layer.id = "render-zone";
    layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    const outline = (box, colour) =>
      `<div style="position:absolute;left:${box.x - 1}px;top:${box.y - 1}px;width:${box.width + 2}px;height:${box.height + 2}px;border:2px dashed ${colour};background:repeating-linear-gradient(135deg, ${colour}33 0 6px, transparent 6px 12px)"></div>`;
    layer.innerHTML = outline(value.zone, "#F5B50A") + value.intersects.map((item) => outline(item.box, "#FF3B30")).join("");
    document.body.appendChild(layer);
  }, zone);
}

/** Where the shell's parts are, in points, and how wide each one came out. */
async function readGeometry(page) {
  return page.evaluate(() => {
    const box = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
      };
    };
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden";
    };
    const rows = [...document.querySelectorAll('[data-testid="chat-list-item"]')];
    const railNode = document.querySelector('[data-testid="folder-rail"]');
    const railTop = railNode ? railNode.getBoundingClientRect().top : null;
    return {
      rail: box(railNode),
      // Where the rail starts relative to the window's top edge. The owner's
      // complaint on 2026-09-12 was that it started below it; Telegram
      // Desktop's window begins with the rail and this is the number that says
      // whether ours does.
      railTop: railTop === null ? null : Math.round(railTop),
      // Anything drawn across the window above the rail — a bar, by whatever
      // name. `[]` is the whole point of this stage.
      aboveRail:
        railTop === null
          ? null
          : [...document.querySelectorAll("header, nav, [data-testid]")]
              .filter((node) => {
                const rect = node.getBoundingClientRect();
                return rect.width > 400 && rect.height > 0 && rect.bottom <= railTop + 1;
              })
              .map((node) => node.getAttribute("data-testid") ?? node.tagName.toLowerCase()),
      // What the window's own frame takes out of the top edge, and what the
      // panes therefore pad out of themselves.
      caption: getComputedStyle(document.documentElement).getPropertyValue("--kub-window-caption").trim(),
      // The LETSCUBE mark, wherever it is drawn. Two was the other complaint.
      marks: [...document.querySelectorAll('img[alt="LETSCUBE"]')]
        .filter((node) => node.getBoundingClientRect().width > 0)
        .map((node) => (node.closest('[data-testid="sidebar-control-row"]') ? "list row" : "elsewhere")),
      railItems: document.querySelectorAll('[data-testid="folder-rail-item"]').length,
      sideMenuButtonOnRail: Boolean(
        document.querySelector('[data-testid="folder-rail"] [data-testid="side-menu-button"]'),
      ),
      sideMenuButtonInHeader: visible(
        document.querySelector('[data-testid="sidebar-control-row"] [aria-label="Меню"]'),
      ),
      leftRegion: box(document.querySelector("[data-kub-left-region]")),
      listColumn: box(document.querySelector(".kub-chat-list-column")),
      resizer: box(document.querySelector('[data-testid="chat-list-resizer"]')),
      sideMenu: box(document.querySelector('[data-testid="side-menu-layer"]')),
      sideMenuRows: document.querySelectorAll('[data-testid="side-menu-row"]').length,
      narrowRatio: Number(
        getComputedStyle(document.documentElement).getPropertyValue("--kub-chat-list-narrow").trim() || "0",
      ),
      // Where each row's avatar starts, deduplicated. The pinned drag handle
      // stood before the avatar and only on pinned rows, so more than one value
      // here is the owner's complaint of 2026-09-12 said as a number: «они
      // сдвигают аватарки».
      avatarAxes: [
        ...new Set(
          rows.map((row) => {
            const avatar = row.querySelector("[data-chat-avatar]");
            return avatar ? Number(avatar.getBoundingClientRect().left.toFixed(2)) : null;
          }),
        ),
      ],
      firstRow: box(rows[0]),
      rowsInView: rows.filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      }).length,
      // Telegram Desktop has no bottom capsule and neither do we.
      bottomCapsule: visible(document.querySelector('nav[aria-label="Навигация"]')),
      brandInListRow: visible(
        document.querySelector('[data-testid="sidebar-control-row"] img[alt="LETSCUBE"]'),
      ),
      chatPane: box(document.querySelector('[data-testid="chat-composer-dock"]')),
    };
  });
}

// ── colour, photographed ────────────────────────────────────────────────────

const PROBE = "data-render-contrast-probe";

function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

async function locateProbe(page, target) {
  return page.evaluate(
    ({ target: probeTarget, probe }) => {
      const leaves = (root) =>
        root ? [...root.querySelectorAll("*")].filter((node) => node.children.length === 0 && node.textContent.trim()) : [];
      const leafWithText = (root, text) => leaves(root).find((node) => node.textContent.trim() === text) ?? null;
      const rail = document.querySelector('[data-testid="folder-rail"]');
      const layer = document.querySelector('[data-testid="side-menu-layer"]');
      const railItem = (pressed) =>
        rail?.querySelector(`[data-testid="folder-rail-item"][aria-pressed="${pressed}"]`) ?? null;

      let element = null;
      switch (probeTarget.id) {
        case "rail-active": {
          const button = railItem("true");
          element = button ? leafWithText(button, button.getAttribute("aria-label")) : null;
          break;
        }
        case "rail-idle": {
          const button = railItem("false");
          element = button ? leafWithText(button, button.getAttribute("aria-label")) : null;
          break;
        }
        case "rail-count":
          element = rail?.querySelector('[data-testid="folder-rail-count"]') ?? null;
          break;
        case "menu-row":
          element = layer ? leafWithText(layer, "Настройки") : null;
          break;
        case "menu-admin":
          element = layer ? leafWithText(layer, "Управление") : null;
          break;
        case "menu-version":
          element = layer?.querySelector('[data-testid="side-menu-version"]') ?? null;
          break;
        default:
          element = null;
      }
      if (!element) return null;
      const own = element.getBoundingClientRect();
      if (own.width < 1 || own.height < 1) return null;
      if (getComputedStyle(element).visibility === "hidden") return null;
      // Occluded is not the same as illegible. The side list covers the rail,
      // so a rail label measured in that frame photographs the layer's own
      // fill, and compositing the label's colour over it returns ~1.00:1 — a
      // contrast failure reported where there is simply nothing to read.
      // Measured before this guard: rail-active 1.05 and rail-count 1.44 in
      // every `menu` frame, against 7.99 and 5.55 in the frames where the rail
      // is on top. Anything not topmost at its own centre is reported absent.
      const hit = document.elementFromPoint(own.left + own.width / 2, own.top + own.height / 2);
      if (!hit || (hit !== element && !element.contains(hit) && !hit.contains(element))) return null;

      let rect;
      if (probeTarget.id === "rail-count") {
        // A count on a small round pill is read against the pill's own fill.
        // The digits' line box reaches past the circle at its corners, and
        // those corners photograph whatever is behind the pill.
        rect = {
          x0: own.left + own.width * 0.3,
          y0: own.top + own.height * 0.3,
          x1: own.right - own.width * 0.3,
          y1: own.bottom - own.height * 0.3,
        };
      } else {
        const range = document.createRange();
        range.selectNodeContents(element);
        const rects = [...range.getClientRects()].filter((box) => box.width > 1 && box.height > 1);
        if (!rects.length) return null;
        const line = rects[0];
        // The first line without its leading: a fifth off the top and the
        // bottom, where no glyph reaches but an indicator can.
        const lead = line.height * 0.2;
        rect = {
          x0: Math.max(own.left, Math.min(...rects.map((box) => box.left))),
          y0: Math.max(own.top, line.top + lead),
          x1: Math.min(own.right, Math.max(...rects.filter((box) => Math.abs(box.top - line.top) < 1).map((box) => box.right))),
          y1: Math.min(own.bottom, line.bottom - lead),
        };
        if (rect.x1 - rect.x0 < 1 || rect.y1 - rect.y0 < 1) return null;
      }

      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      context.fillStyle = getComputedStyle(element).color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) {
        const value = parseFloat(getComputedStyle(node).opacity);
        opacity *= Number.isFinite(value) ? value : 1;
      }

      element.setAttribute(probe, "");
      if (!document.getElementById("render-contrast-style")) {
        const style = document.createElement("style");
        style.id = "render-contrast-style";
        style.textContent =
          `[${probe}], [${probe}] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }`;
        document.head.appendChild(style);
      }
      const x = Math.max(0, Math.floor(rect.x0));
      const y = Math.max(0, Math.floor(rect.y0));
      return {
        clip: {
          x,
          y,
          width: Math.max(1, Math.min(window.innerWidth, Math.ceil(rect.x1)) - x),
          height: Math.max(1, Math.min(window.innerHeight, Math.ceil(rect.y1)) - y),
        },
        colour: [r, g, b, (a / 255) * opacity],
        text: element.textContent.trim().slice(0, 40),
      };
    },
    { target, probe: PROBE },
  );
}

async function measureText(page, target) {
  const probe = await locateProbe(page, target);
  if (!probe) return { id: target.id, label: target.label, missing: true };
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const shot = await page.screenshot({ clip: probe.clip, animations: "disabled" });
  const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  await page.evaluate((value) => {
    for (const node of document.querySelectorAll(`[${value}]`)) node.removeAttribute(value);
  }, PROBE);
  const [tr, tg, tb, ta] = probe.colour;
  const ratios = [];
  for (let index = 0; index < data.length; index += info.channels) {
    const ground = [data[index], data[index + 1], data[index + 2]];
    const ink = [tr * ta + ground[0] * (1 - ta), tg * ta + ground[1] * (1 - ta), tb * ta + ground[2] * (1 - ta)];
    ratios.push(contrast(ink, ground));
  }
  ratios.sort((a, b) => a - b);
  return {
    id: target.id,
    label: target.label,
    text: probe.text,
    worst: Number(ratios[0].toFixed(2)),
    median: Number(ratios[Math.floor(ratios.length / 2)].toFixed(2)),
  };
}

// ── one frame ───────────────────────────────────────────────────────────────

async function renderFrame(browser, frame) {
  const device = DEVICES[frame.device];
  const scene = SCENES[frame.scene];
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: 1,
    colorScheme: frame.theme,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol !== "http:" && url.protocol !== "https:") return route.continue();
    return ALLOWED_HOSTS.has(url.hostname) ? route.continue() : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  const backend = new Backend(frame.role);
  await page.route(`${FIXTURE_HOST}/**`, (route) => backend.handle(route));
  await installRealtime(page);
  await page.clock.setFixedTime(CLOCK);
  await page.addInitScript(
    ({ windows, theme, muted, user, shellKey }) => {
      if (windows) {
        const version = "0.2.10";
        const state = { channel: "stable", phase: "current", installedVersion: version, availableVersion: null, downloadedBytes: 0, totalBytes: null, mandatory: false, errorCode: null };
        const quiet = async () => undefined;
        Object.defineProperty(window, "letscubeDesktop", {
          configurable: false,
          enumerable: false,
          writable: false,
          value: Object.freeze({
            platform: "windows",
            version,
            build: 14,
            getRuntimeInfo: async () => ({ platform: "windows", version, build: 14 }),
            getUpdateState: async () => ({ ...state }),
            getUpdateChannel: async () => "stable",
            setUpdateChannel: async () => ({ ...state }),
            checkUpdate: async () => ({ ...state }),
            installUpdate: async () => ({ ...state }),
            getStorageState: async () => null,
            setStorageLocation: quiet,
            setCacheLimit: quiet,
            clearCache: quiet,
            showMain: quiet,
            isMainForeground: async () => true,
            notify: async () => false,
            removeNotification: async () => false,
            takePendingNotificationRoute: async () => null,
            startDragging: quiet,
            minimize: quiet,
            toggleMaximize: quiet,
            isMaximized: async () => false,
            closeToTray: quiet,
          }),
        });
        localStorage.setItem("letscube:desktop:last-installed-version", version);
      }
      localStorage.setItem("kub-theme", theme);
      localStorage.setItem("ng_muted", JSON.stringify(muted));
      // Every frame starts from the same shell state; the scene drags it.
      localStorage.removeItem(shellKey);
      localStorage.setItem(
        "kub-auth",
        JSON.stringify({
          access_token: "playwright.user.jwt",
          refresh_token: "playwright-refresh",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: "bearer",
          user,
        }),
      );
    },
    { windows: device.windows, theme: frame.theme, muted: MUTED, user: sessionUser(), shellKey: SHELL_KEY },
  );

  await page.goto(`${BASE}${scene.path}`, { waitUntil: "domcontentloaded" });
  if (frame.scene === "tasks") {
    await page.getByRole("button", { name: "Новая" }).waitFor({ state: "visible", timeout: 30_000 });
  } else {
    await page.locator('[data-testid="chat-list-item"]').nth(CHATS.length - 1).waitFor({ state: "attached", timeout: 30_000 });
    await page.locator('[data-testid="folder-rail-item"]').nth(FOLDERS.length).waitFor({ state: "attached", timeout: 15_000 });
  }
  // The phone's resting frame is where the administration hint lives now, and
  // a fresh context has empty storage, so it must be in its first-run state.
  // A frame that quietly lost it would be filed as a picture of the feature.
  if (frame.device === "phone" && frame.scene === "rest") {
    const hint = page.locator('[data-testid="kub-hint"]');
    await hint.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    if ((await hint.count()) === 0) {
      throw new Error(
        "the administration hint is not on the main screen, so this frame would not show it",
      );
    }
    // And it has to clear the header block. The plate's offset is a measured
    // constant (88 at 390), which rots the moment a row is added above or
    // below it; this is what stops that happening quietly.
    const clears = await page.evaluate(() => {
      const box = (selector) => {
        const node = document.querySelector(selector);
        return node ? node.getBoundingClientRect() : null;
      };
      const plate = box('[data-testid="kub-hint"]');
      const chrome = box('[data-kub-list-chrome]');
      if (!plate || !chrome) return null;
      return { plateTop: Math.round(plate.top * 100) / 100, chromeBottom: Math.round(chrome.bottom * 100) / 100 };
    });
    if (clears && clears.plateTop < clears.chromeBottom) {
      throw new Error(
        "the hint opens at " + clears.plateTop + ", above the header block's foot at " + clears.chromeBottom + ", so it covers the search field or the filters",
      );
    }
  }

  await page.evaluate(() => document.fonts.ready);
  // document.fonts.check is not usable here: with the font hosts blocked it
  // answers true for a family that never loaded, while document.fonts is
  // empty in the same breath. The font is proved by width instead — the same
  // string in the page's own stack, and in that stack with Inter struck out.
  const inter = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.textContent = "Управление";
    probe.style.cssText = "position:absolute;left:-9999px;top:0;font-size:11px;font-weight:600;white-space:nowrap";
    document.body.appendChild(probe);
    const stack = getComputedStyle(document.body).fontFamily;
    probe.style.fontFamily = stack;
    const withInter = probe.getBoundingClientRect().width;
    probe.style.fontFamily = stack.split(",").filter((name) => !name.toLowerCase().includes("inter")).join(",");
    const withoutInter = probe.getBoundingClientRect().width;
    probe.remove();
    return withInter !== withoutInter;
  });
  if (!inter) {
    throw new Error(
      "Inter did not load; the frame would be measured in the fallback, which is narrower than the product",
    );
  }

  if (scene.openChat) {
    await page.locator(`[data-testid="chat-list-item"][data-chat-id="${OPEN_CHAT}"]`).click();
    await page.locator('[data-message-bubble="true"]').first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(4_700);
  } else {
    await page.waitForTimeout(1_200);
  }

  if (scene.settings) {
    // The way a person reaches it on a phone: the profile tab, which sets
    // the mobile section and opens the settings modal over the list.
    await page.locator('[aria-label="Профиль"]').first().click();
    const row = page.getByText("Админ-панель", { exact: true }).first();
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    // Inverted on 2026-09-12, when the owner moved administration to the main
    // screen because it did not sit well in the profile. This frame now shows
    // the row back to being a plain row, and the hint being here again would
    // mean two doors with two hints — which is what the move was to avoid.
    const hint = page.locator('[data-testid="kub-hint"]');
    if ((await hint.count()) !== 0) {
      throw new Error(
        "the administration hint is still inside settings; it belongs on the main screen now",
      );
    }
  }

  if (scene.scrolled) {
    // With the wheel, so the list scrolls the way it scrolls for a person and
    // the header hears the same event it hears in use.
    const list = page.locator('[data-testid="chat-list-scroller"]');
    const box = await list.boundingBox();
    if (!box) throw new Error("no chat list to scroll");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(600);
    // The frame has to prove what it claims. The header replaces the search
    // row with a magnifier named «Поиск» once the list has scrolled past its
    // threshold; if that button is not on screen the list did not scroll, and
    // photographing it would file an untucked row as evidence of a tucked one.
    const magnifier = page.locator('[aria-label="Поиск"]');
    if ((await magnifier.count()) === 0) {
      throw new Error(
        "the list did not scroll: the header still shows its search row, so this frame would not be the tucked state",
      );
    }
  }

  if (scene.collapsed) {
    // Through the handle, as a person does it, so what is photographed is the
    // drag's own result and not a value written into storage.
    const handle = await page.locator('[data-testid="chat-list-resizer"]').boundingBox();
    const region = await page.locator("[data-kub-left-region]").boundingBox();
    if (!handle || !region) throw new Error("no handle to drag");
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(region.x + 40, handle.y + handle.height / 2, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  }

  if (scene.menu) {
    await page.locator('[data-testid="side-menu-button"]').click();
    await page.locator('[data-testid="side-menu-layer"]').waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(500);
  }

  // The pointer rests off every control, so no hover is photographed.
  await page.mouse.move(device.viewport.width - 2, device.viewport.height - 2);
  await settle(page);

  const result = { id: frame.id, inter, errors, geometry: null, zone: null, text: null };
  if (frame.scene !== "tasks") result.geometry = await readGeometry(page);
  // The phone's header block, box by box. The administration hint hangs off
  // the shield and must not come down over the search field or the folder
  // strip, and «must not» is only checkable against numbers: the offset that
  // clears them is the distance from the shield's foot to the block's.
  if (frame.device === "phone") {
    result.header = await page.evaluate(() => {
      const rect = (node) => {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) return null;
        const round = (value) => Math.round(value * 100) / 100;
        return { top: round(box.top), bottom: round(box.bottom), left: round(box.left), right: round(box.right) };
      };
      return {
        shield: rect(document.querySelector('[aria-label="Управление"]')),
        search: rect(document.querySelector('[data-testid="sidebar-search-input"]')),
        controlRow: rect(document.querySelector('[data-testid="sidebar-control-row"]')),
        listChrome: rect(document.querySelector('[data-kub-list-chrome]')),
        firstRow: rect(document.querySelector('[data-testid="chat-list-item"]')),
        hint: rect(document.querySelector('[data-testid="kub-hint"]')),
      };
    });
  }
  if (device.windows) result.zone = await windowControlsZone(page);
  if (measuresText(frame)) {
    result.text = [];
    for (const target of TEXT_TARGETS) result.text.push(await measureText(page, target));
  }

  if (result.zone) await drawZone(page, result.zone);
  await page.screenshot({ path: path.join(FRAMES_DIR, `${frame.id}.png`), animations: "disabled" });
  await page.evaluate(() => document.getElementById("render-zone")?.remove());

  await context.close();
  writeFileSync(path.join(MEASUREMENTS_DIR, `${frame.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

// ── the sheets ──────────────────────────────────────────────────────────────

const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

function readResult(frameId) {
  const file = path.join(MEASUREMENTS_DIR, `${frameId}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

const SHEET_STYLE = `
  body { margin: 0; padding: 30px 34px 36px; background: #E6ECF2; color: #0F2238; font: 20px/1.4 "Segoe UI", Arial, sans-serif; }
  h1 { margin: 0 0 4px; font-size: 36px; line-height: 1.2; }
  .lede { margin: 0 0 22px; font-size: 21px; color: #354A61; }
  .stack { display: grid; gap: 22px; }
  figure { margin: 0; }
  figcaption { margin: 0 0 10px; font-size: 26px; font-weight: 700; line-height: 1.2; }
  figcaption span { display: block; margin-top: 2px; font-size: 19px; font-weight: 400; color: #354A61; }
  img { display: block; border-radius: 14px; box-shadow: 0 1px 0 #C2CEDB, 0 8px 22px rgba(16, 35, 59, 0.16); }
  .missing { display: grid; place-items: center; height: 240px; border-radius: 14px; background: #D3DCE6; }
  table { border-collapse: collapse; margin-bottom: 26px; background: #FFFFFF; border-radius: 12px; overflow: hidden; width: 100%; }
  th, td { padding: 8px 14px; border-bottom: 1px solid #E1E8EF; text-align: left; font-size: 19px; }
  thead th { background: #F2F5F9; }
  td span { color: #677A8F; font-size: 16px; }
  td.pass { color: #1D6A34; font-weight: 600; }
  td.fail { color: #B3261E; font-weight: 700; }
  h2 { margin: 26px 0 10px; font-size: 26px; }
`;

function figure(src, caption, note, width) {
  const exists = existsSync(path.join(OUT, src));
  return `<figure style="width:${width}px"><figcaption>${escapeHtml(caption)}${note ? `<span>${escapeHtml(note)}</span>` : ""}</figcaption>${
    exists ? `<img src="${src}" style="width:${width}px">` : '<div class="missing">кадра нет</div>'
  }</figure>`;
}

function sheetHtml(title, lede, body, width) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${SHEET_STYLE} body { width: ${width}px; }</style></head><body><h1>${escapeHtml(title)}</h1><p class="lede">${escapeHtml(lede)}</p>${body}</body></html>`;
}

/** The width note under a frame, so the picture and the number travel together. */
function widths(frameId) {
  const geometry = readResult(frameId)?.geometry;
  if (!geometry) return "";
  const parts = [];
  if (geometry.rail) parts.push(`полоса папок ${geometry.rail.width}`);
  // Where the rail starts relative to the window's top edge, which is the
  // owner's complaint of 2026-09-12 said as a number.
  if (geometry.railTop !== null && geometry.railTop !== undefined) {
    parts.push(`начинается на ${geometry.railTop} от верха`);
  }
  if (geometry.listColumn) parts.push(`список ${geometry.listColumn.width}`);
  if (geometry.firstRow) parts.push(`строка ${geometry.firstRow.width}`);
  if (geometry.avatarAxes) {
    parts.push(
      geometry.avatarAxes.length === 1
        ? `аватарки на одной оси (${geometry.avatarAxes[0]})`
        : `аватарки на ${geometry.avatarAxes.length} осях: ${geometry.avatarAxes.join(", ")}`,
    );
  }
  parts.push(`сужение ${geometry.narrowRatio}`);
  if (geometry.caption) parts.push(`кнопки окна ${geometry.caption}`);
  if (geometry.marks) parts.push(`знак LETSCUBE ×${geometry.marks.length}`);
  parts.push(geometry.bottomCapsule ? "нижняя панель ЕСТЬ" : "нижней панели нет");
  return parts.join(", ");
}

/**
 * The corner with the window buttons, cropped from the frame's own measured
 * zone rather than from a hard-coded x.
 *
 * The x was `1020` for every frame, which is the 1440 window's corner. The
 * narrow window is 1024 wide, so that box fell off the right edge — and sharp
 * would have thrown rather than shown the wrong corner, which is the better of
 * the two failures but still not a picture of anything.
 */
function zoneCrop(frameId, width) {
  const zone = readResult(frameId)?.zone?.zone;
  if (!zone) return null;
  const box = { left: Math.max(0, Math.round(zone.x - 290)), top: 0, width: 420, height: 104 };
  box.width = Math.min(box.width, width - box.left);
  return box;
}

async function makeCrops() {
  mkdirSync(CROPS_DIR, { recursive: true });
  const zones = FRAMES.filter((frame) => DEVICES[frame.device].windows).map((frame) => [
    `${frame.id}.png`,
    `${frame.id}-zone.png`,
    zoneCrop(frame.id, DEVICES[frame.device].viewport.width),
  ]);
  for (const [source, target, box] of [
    ...zones,
    // 360 rows at 2x rather than 620 at 3x. The strip is the same picture
    // either way — five rows of avatars say what one row says — and the old
    // crop was 1,860px tall, which is most of a sheet's whole budget for one
    // figure that repeats itself.
    ["dark-desktop-collapsed.png", "collapsed-strip.png", { left: 0, top: 0, width: 260, height: 360, scale: 2 }],
    ["light-desktop-collapsed.png", "collapsed-strip-light.png", { left: 0, top: 0, width: 260, height: 360, scale: 2 }],
  ]) {
    const file = path.join(FRAMES_DIR, source);
    if (!existsSync(file) || !box) continue;
    const { scale = 3, ...extract } = box;
    await sharp(file).extract(extract).resize({ width: extract.width * scale }).toFile(path.join(CROPS_DIR, target));
  }
}

async function buildSheets(browser) {
  await makeCrops();
  // 860, down from 1100, and three figures to a sheet rather than four.
  //
  // A 1440x900 frame at 1100 wide is 687 tall, so four of them plus captions
  // ran a sheet to about 3,000px and the set had to be rationed to be read at
  // all. At 860 a frame is 537, and three of them land a sheet under 2,000 —
  // more sheets, each of which can actually be looked at.
  const WIDE = 860;
  // A 1024x720 frame is taller for its width than a 1440x900 one, so three of
  // them at 860 ran to 2,318 and 2,289. At 760 each loses 70px and the sheets
  // land at about 2,100 — the budget is what a person can actually read in one
  // go, not a number to be met by shrinking the type.
  const NARROW_W = 760;
  /** Frames, with each one's own measurements printed under it. */
  const stack = (entries, width = WIDE) =>
    `<div class="stack">${entries
      .map(([frameId, caption]) => figure(`frames/${frameId}.png`, caption, widths(frameId), width))
      .join("")}</div>`;
  /** Crops, which carry no measurements of their own. */
  const crops = (entries, width = WIDE) =>
    `<div class="stack">${entries
      .map(([src, caption, note]) => figure(src, caption, note ?? "", width))
      .join("")}</div>`;
  /** What the window buttons' zone holds in one Windows frame, as a sentence. */
  const zoneNote = (frameId) => {
    const zone = readResult(frameId)?.zone;
    if (!zone) return "";
    return zone.intersects.length
      ? `В зоне кнопок: ${zone.intersects.map((item) => `«${item.what}» ${Math.round(item.covered * 100)}%`).join(", ")}`
      : "В зоне кнопок нет элементов страницы";
  };
  const sheets = [
    {
      id: "1-desktop-dark",
      title: "Компьютер 1440×900 · тёмная тема",
      lede:
        "Окно начинается полосой папок — панели с надписью LETSCUBE над ней больше нет. " +
        "Знак остаётся один, в верхней строке списка. Настоящие компоненты, вымышленные чаты.",
      width: WIDE,
      body: stack([
        ["dark-desktop-rest", "В покое"],
        ["dark-desktop-chat", "Открыт чат"],
        ["dark-desktop-collapsed", "Список сжат до аватарок"],
      ]),
    },
    {
      id: "2-desktop-light",
      title: "Компьютер 1440×900 · светлая тема",
      lede: "То же в светлой теме.",
      width: WIDE,
      body: stack([
        ["light-desktop-rest", "В покое"],
        ["light-desktop-chat", "Открыт чат"],
        ["light-desktop-collapsed", "Список сжат до аватарок"],
      ]),
    },
    {
      id: "3-side-list",
      title: "Боковой список",
      lede: "Слой поверх окна, а не колонка: закрытым он не стоит ни одной точки ширины. Внизу — тот же экран у человека без прав.",
      width: WIDE,
      body: stack([
        ["dark-desktop-menu", "Тёмная тема"],
        ["light-desktop-menu", "Светлая тема"],
        ["dark-desktop-menu-regular", "Без прав: ни «Управления», ни «Задач»"],
      ]),
    },
    {
      id: "4-narrow-window",
      title: "Узкое окно 1024×720",
      lede: "Самое узкое окно, в котором стоит работать: полоса папок остаётся 72 точки, список сужается, переписка не выдавливается.",
      width: NARROW_W,
      body: stack(
        [
          ["dark-narrow-rest", "В покое, тёмная"],
          ["dark-narrow-collapsed", "Сжат до аватарок"],
          ["light-narrow-chat", "Открыт чат, светлая"],
        ],
        NARROW_W,
      ),
    },
    {
      id: "5-windows-1440",
      title: "Приложение Windows 1440×900 · D-112",
      lede:
        "Жёлтая штриховка — кнопки окна, которые рисует само приложение. Красная — элемент страницы, который в них заходит. " +
        "Полоса папок доходит до верхнего края окна, а панели обеих сторон отступают от него на высоту кнопок.",
      width: WIDE,
      body: stack([
        ["dark-windows-rest", "В покое"],
        ["dark-windows-chat", "Открыт чат — строка заголовка чата сразу под кнопками"],
        ["dark-windows-menu", "Боковой список открыт"],
      ]),
    },
    {
      id: "6-windows-narrow",
      title: "Приложение Windows 1024×720 · D-112",
      lede: "Узкое окно: доля верхнего края, занятая кнопками, здесь наибольшая.",
      width: NARROW_W,
      body: stack(
        [
          ["dark-windowsNarrow-rest", "В покое"],
          ["dark-windowsNarrow-chat", "Открыт чат"],
          ["dark-windowsNarrow-menu", "Боковой список открыт"],
        ],
        NARROW_W,
      ),
    },
    {
      id: "7-windows-corner",
      title: "Угол с кнопками окна, увеличено втрое",
      lede: "То же место на четырёх кадрах мессенджера. Ни один элемент страницы в кнопки не заходит.",
      width: WIDE,
      body: crops([
        ["crops/dark-windows-rest-zone.png", "1440, в покое", zoneNote("dark-windows-rest")],
        ["crops/dark-windows-chat-zone.png", "1440, открыт чат", zoneNote("dark-windows-chat")],
        ["crops/dark-windows-menu-zone.png", "1440, боковой список", zoneNote("dark-windows-menu")],
        ["crops/dark-windowsNarrow-chat-zone.png", "1024, открыт чат", zoneNote("dark-windowsNarrow-chat")],
      ]),
    },
    {
      id: "8-tasks",
      title: "Страница «Задачи» · D-112 не закрыт",
      lede:
        "Эта страница не входит в работу по оболочке. Её собственная кнопка «+ Новая» стояла под кнопками окна " +
        "и до этой ветки, и осталась там: отступ делают панели мессенджера, а не страницы.",
      width: WIDE,
      body:
        stack([["dark-windows-tasks", "«Задачи» целиком"]]) +
        `<h2>Тот же угол</h2>` +
        crops([["crops/dark-windows-tasks-zone.png", "Увеличено втрое", zoneNote("dark-windows-tasks")]]),
    },
    {
      id: "9-collapsed-strip",
      title: "Полоса из одних аватарок",
      lede: "Увеличено вдвое. У Telegram это ровно 66 точек: отступ 10 + аватарка 46 + отступ 10. У нас те же 66, но 9 + 48 + 9 — аватарка в продукте одного размера везде.",
      width: 560,
      body: crops(
        [
          ["crops/collapsed-strip.png", "Тёмная тема"],
          ["crops/collapsed-strip-light.png", "Светлая тема"],
        ],
        520,
      ),
    },
    {
      id: "10-measurements",
      title: "Измерения",
      lede: "Ширины в точках и контраст по сфотографированным пикселям, худший пиксель / медиана, порог 4,5:1.",
      width: 1320,
      body: geometryTable() + contrastTable(),
    },
  ];

  for (const sheet of sheets) {
    const file = path.join(OUT, `sheet-${sheet.id}.html`);
    writeFileSync(file, sheetHtml(sheet.title, sheet.lede, sheet.body, sheet.width));
    const page = await browser.newPage({ viewport: { width: sheet.width + 68, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    const png = path.join(OUT, `sheet-${sheet.id}.png`);
    await page.screenshot({ path: png, fullPage: true });
    await page.close();
    const { height } = await sharp(png).metadata();
    console.log(`sheet ${sheet.id}: ${height}px tall${height > 2250 ? " (over 2,200)" : ""}`);
  }
}

const GEOMETRY_FRAMES = FRAMES.filter((frame) => frame.scene !== "tasks").map((frame) => frame.id);

function geometryTable() {
  const rows = GEOMETRY_FRAMES.map((frameId) => {
    const geometry = readResult(frameId)?.geometry;
    if (!geometry) return `<tr><th>${escapeHtml(frameId)}</th><td colspan="10">—</td></tr>`;
    const railOk = geometry.rail && geometry.rail.width === RAIL_WIDTH;
    const stripOk = !geometry.firstRow || geometry.narrowRatio < 1 || geometry.firstRow.width === COLLAPSED_WIDTH;
    // The rail starts at the window's top edge and nothing is drawn above it.
    // Both halves in one cell, because either one alone is the bar back.
    const topOk = geometry.railTop === 0 && (geometry.aboveRail ?? []).length === 0;
    const topCell = geometry.aboveRail?.length
      ? `${geometry.railTop} · ${escapeHtml(geometry.aboveRail.join(", "))}`
      : `${geometry.railTop}`;
    // Exactly one LETSCUBE mark, and it is in the list's top row.
    const marks = geometry.marks ?? [];
    const markOk = marks.length === 1 && marks[0] === "list row";
    return `<tr><th>${escapeHtml(frameId)}</th>` +
      `<td class="${railOk ? "pass" : "fail"}">${geometry.rail ? geometry.rail.width : "нет"}</td>` +
      `<td class="${topOk ? "pass" : "fail"}">${topCell}</td>` +
      `<td>${geometry.listColumn ? geometry.listColumn.width : "—"}</td>` +
      `<td class="${stripOk ? "pass" : "fail"}">${geometry.firstRow ? geometry.firstRow.width : "—"}</td>` +
      `<td class="${(geometry.avatarAxes ?? []).length === 1 ? "pass" : "fail"}">${(geometry.avatarAxes ?? []).join(" / ") || "—"}</td>` +
      `<td>${geometry.narrowRatio}</td>` +
      `<td>${escapeHtml(geometry.caption || "0px")}</td>` +
      `<td class="${markOk ? "pass" : "fail"}">${marks.length ? escapeHtml(marks.join(", ")) : "нет"}</td>` +
      `<td class="${geometry.bottomCapsule ? "fail" : "pass"}">${geometry.bottomCapsule ? "есть" : "нет"}</td>` +
      `<td class="${geometry.sideMenuButtonOnRail && !geometry.sideMenuButtonInHeader ? "pass" : "fail"}">${geometry.sideMenuButtonOnRail ? "на полосе" : "нет"}</td></tr>`;
  });
  return `<h2>Геометрия</h2><table><thead><tr><th>Кадр</th><th>Полоса</th><th>Верх полосы</th><th>Список</th><th>Строка</th><th>Аватарки</th><th>Сужение</th><th>Кнопки окна</th><th>Знак LETSCUBE</th><th>Низ</th><th>Меню</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function contrastTable() {
  const frames = FRAMES.filter(measuresText).map((frame) => frame.id);
  const rows = TEXT_TARGETS.map((target) => {
    const cells = frames.map((frameId) => {
      const entry = readResult(frameId)?.text?.find((item) => item.id === target.id);
      if (!entry) return "<td>—</td>";
      if (entry.missing) return '<td><span>нет на экране</span></td>';
      return `<td class="${entry.worst >= 4.5 ? "pass" : "fail"}">${entry.worst.toFixed(2)}<span> / ${entry.median.toFixed(2)}</span></td>`;
    });
    return `<tr><th>${escapeHtml(target.label)}</th>${cells.join("")}</tr>`;
  });
  return `<h2>Контраст</h2><table><thead><tr><th></th>${frames.map((frameId) => `<th>${escapeHtml(frameId)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function measurementsMarkdown() {
  const lines = ["# The computer's shell, measured", "", "Widths in CSS pixels, contrast from photographed pixels.", ""];
  lines.push("## Geometry", "");
  lines.push(
    "| frame | rail | rail top | above the rail | list column | first row | avatar axes | narrow ratio | window caption | LETSCUBE marks | bottom capsule | menu button on rail |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const frameId of GEOMETRY_FRAMES) {
    const geometry = readResult(frameId)?.geometry;
    if (!geometry) {
      lines.push(`| ${frameId} |${" — |".repeat(11)}`);
      continue;
    }
    const above = geometry.aboveRail?.length ? geometry.aboveRail.join(", ") : "nothing";
    const marks = geometry.marks ?? [];
    lines.push(
      `| ${frameId} | ${geometry.rail?.width ?? "none"} | ${geometry.railTop ?? "—"} | ${above} | ` +
        `${geometry.listColumn?.width ?? "—"} | ${geometry.firstRow?.width ?? "—"} | ` +
        `${(geometry.avatarAxes ?? []).join(" / ") || "—"} | ${geometry.narrowRatio} | ` +
        `${geometry.caption || "0px"} | ${marks.length} (${marks.join(", ") || "none"}) | ` +
        `${geometry.bottomCapsule ? "PRESENT" : "none"} | ` +
        `${geometry.sideMenuButtonOnRail ? "yes" : "no"}${geometry.sideMenuButtonInHeader ? " (also in header)" : ""} |`,
    );
  }
  lines.push("");

  lines.push("## The side list", "");
  lines.push("| frame | rows | box |", "|---|---|---|");
  for (const frame of FRAMES.filter((entry) => entry.scene === "menu")) {
    const geometry = readResult(frame.id)?.geometry;
    const box = geometry?.sideMenu;
    lines.push(`| ${frame.id} | ${geometry?.sideMenuRows ?? "—"} | ${box ? `${box.width}x${box.height} at ${box.x},${box.y}` : "—"} |`);
  }
  lines.push("");

  lines.push("## Windows: page controls inside the window buttons' zone", "");
  lines.push("| frame | zone | inside it |", "|---|---|---|");
  // Every Windows frame, not only the 1440 one. `entry.device === "windows"`
  // silently left the narrow window out of this table while the frames were
  // rendered and measured — the zone is proportionally the largest share of
  // the top edge there, so it is the row most worth reading.
  for (const frame of FRAMES.filter((entry) => DEVICES[entry.device].windows)) {
    const zone = readResult(frame.id)?.zone;
    if (!zone) {
      lines.push(`| ${frame.id} | — | — |`);
      continue;
    }
    const z = zone.zone;
    const inside = zone.intersects.length
      ? zone.intersects.map((item) => `${item.what} ${Math.round(item.covered * 100)}%`).join(", ")
      : "none";
    lines.push(`| ${frame.id} | ${z.width}x${z.height} at ${z.x},${z.y} | ${inside} |`);
  }
  lines.push("");

  lines.push("## Contrast, photographed (worst / median, threshold 4.5:1)", "");
  const frames = FRAMES.filter(measuresText).map((frame) => frame.id);
  lines.push(`| text | ${frames.join(" | ")} |`, `|---|${frames.map(() => "---").join("|")}|`);
  for (const target of TEXT_TARGETS) {
    const cells = frames.map((frameId) => {
      const entry = readResult(frameId)?.text?.find((item) => item.id === target.id);
      if (!entry) return "—";
      if (entry.missing) return "not on screen";
      return `${entry.worst.toFixed(2)} / ${entry.median.toFixed(2)}${entry.worst < 4.5 ? " FAIL" : ""}`;
    });
    lines.push(`| ${target.id} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  mkdirSync(FRAMES_DIR, { recursive: true });
  mkdirSync(MEASUREMENTS_DIR, { recursive: true });
  const chromium = await loadChromium();
  const browser = await chromium.launch({ channel: "chromium" });
  const failures = [];
  try {
    if (!sheetsOnly) {
      await assertFixtureServer();
      for (const frame of FRAMES) {
        if (only && !only.has(frame.id)) continue;
        try {
          const result = await renderFrame(browser, frame);
          const low = (result.text ?? []).filter((entry) => !entry.missing && entry.worst < 4.5);
          const zone = result.zone ? ` zone intersects ${result.zone.intersects.length}` : "";
          const geometry = result.geometry;
          const shape = geometry
            ? ` rail ${geometry.rail?.width ?? "none"} list ${geometry.listColumn?.width ?? "—"} row ${geometry.firstRow?.width ?? "—"} narrow ${geometry.narrowRatio}${geometry.bottomCapsule ? " BOTTOM CAPSULE" : ""}`
            : "";
          console.log(
            `${frame.id}: ok${result.inter ? "" : " (Inter did not load)"}${shape}${zone}` +
              `${low.length ? ` under 4.5: ${low.map((entry) => `${entry.id}=${entry.worst}`).join(", ")}` : ""}` +
              `${result.errors.length ? ` errors: ${JSON.stringify(result.errors)}` : ""}`,
          );
        } catch (error) {
          failures.push(frame.id);
          console.error(`${frame.id}: FAILED ${error instanceof Error ? error.message.split("\n")[0] : error}`);
        }
      }
    }
    writeFileSync(path.join(OUT, "measurements.md"), measurementsMarkdown());
    await buildSheets(browser);
  } finally {
    await browser.close();
  }
  if (failures.length) process.exitCode = 1;
}

await main();
