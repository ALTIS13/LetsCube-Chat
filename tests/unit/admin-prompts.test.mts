// The administration asks before a far-reaching action, and stops explaining
// the database when a section cannot be read (D-133 and D-132).
//
// Two halves. The first is the words and the two predicates, which are pure and
// tested directly. The second reads the five tabs and asserts the wiring —
// unavoidable, because a confirmation lives inside a React handler with no
// harness in this repository, and because the whole defect is that the handler
// acted without asking. Each wiring assertion below was checked by deleting the
// line it protects; the mutations are named in the report.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADMIN_INTERNALS_PATTERN,
  ADMIN_INVITES_UNAVAILABLE,
  ADMIN_LOCATIONS_UNAVAILABLE,
  ADMIN_OPS_METRICS_UNAVAILABLE,
  ADMIN_ROLES_UNAVAILABLE,
  ADMIN_UNAVAILABLE_MESSAGES,
  adminPersonLabel,
  bulkGlobalRoleAssignPrompt,
  bulkLocationAssignPrompt,
  canLiftSanctionRow,
  canRevokeInvite,
  globalRoleRemovalPrompt,
  inviteRevokePrompt,
  locationArchivePrompt,
  locationMemberRemovePrompt,
  plainAdminMessage,
  registrationModePrompt,
  rolePermissionsSavePrompt,
  sanctionRowLiftPrompt,
  supportIntakeClosurePrompt,
  type AdminConfirmPrompt,
} from "../../artifacts/kub/src/lib/adminPrompts.ts";
import {
  REGISTRATION_INVITE_MODE_REQUIRED_MESSAGE,
  REGISTRATION_INVITES_REQUIRED_MESSAGE,
} from "../../artifacts/kub/src/lib/registrationInvite.ts";

const NOW = new Date("2026-09-14T09:00:00.000Z");

/** Every question this module can produce, so the shared shape is checked once. */
const EVERY_PROMPT: readonly [string, AdminConfirmPrompt][] = [
  ["globalRoleRemoval", globalRoleRemovalPrompt("Фиктивный Участник", "Менеджер")],
  ["rolePermissionsSave/known", rolePermissionsSavePrompt("Менеджер", 4)],
  ["rolePermissionsSave/none", rolePermissionsSavePrompt("Менеджер", 0)],
  ["rolePermissionsSave/unknown", rolePermissionsSavePrompt("Менеджер", null)],
  ["sanctionRowLift/ban", sanctionRowLiftPrompt("ban", "Фиктивный Участник")],
  ["sanctionRowLift/mute", sanctionRowLiftPrompt("mute", "Фиктивный Участник", "Смена")],
  ["bulkGlobalRoleAssign/one", bulkGlobalRoleAssignPrompt("Менеджер", ["Фиктивный Участник"])],
  ["bulkGlobalRoleAssign/many", bulkGlobalRoleAssignPrompt("Менеджер", ["А", "Б", "В"])],
  ["bulkLocationAssign/one", bulkLocationAssignPrompt("Север", "Работник", ["Фиктивный Участник"])],
  ["bulkLocationAssign/many", bulkLocationAssignPrompt("Север", "Работник", ["А", "Б"])],
  ["locationArchive", locationArchivePrompt("Север", 3)],
  ["locationMemberRemove", locationMemberRemovePrompt("Фиктивный Участник", "Север")],
  ["registrationMode/open", registrationModePrompt(false)],
  ["registrationMode/close", registrationModePrompt(true)],
  ["inviteRevoke", inviteRevokePrompt("LETSCUBE1", "Смена А")],
  [
    "supportIntake/closed",
    supportIntakeClosurePrompt(
      { intakeEnabled: true, guestIntakeEnabled: true },
      { intakeEnabled: false, guestIntakeEnabled: true },
    )!,
  ],
  [
    "supportIntake/guestClosed",
    supportIntakeClosurePrompt(
      { intakeEnabled: true, guestIntakeEnabled: true },
      { intakeEnabled: true, guestIntakeEnabled: false },
    )!,
  ],
];

// ---------------------------------------------------------------------
// The shape of the question
// ---------------------------------------------------------------------

test("every question is a question, answered by a button that names the action", () => {
  for (const [name, prompt] of EVERY_PROMPT) {
    assert.ok(prompt, `${name}: no prompt at all`);
    assert.match(prompt.title, /\?$/u, `${name}: the title is not a question`);
    assert.equal(prompt.cancelLabel, "Отмена", `${name}: the way out is not «Отмена»`);
    // The entry's rule, and the one most likely to be undone by somebody
    // reaching for a default: the confirming button says what it does.
    assert.notEqual(prompt.confirmLabel, "Подтвердить", `${name}: the confirm label says nothing`);
    assert.notEqual(prompt.confirmLabel, "ОК", `${name}: the confirm label says nothing`);
    assert.notEqual(prompt.confirmLabel, "Да", `${name}: the confirm label says nothing`);
    assert.ok(prompt.confirmLabel.length >= 5, `${name}: «${prompt.confirmLabel}» is not an action`);
  }
});

test("every question carries one line about what happens, not a repeat of the row", () => {
  for (const [name, prompt] of EVERY_PROMPT) {
    assert.doesNotMatch(prompt.description, /\n/u, `${name}: the line is more than a line`);
    assert.ok(prompt.description.length >= 40, `${name}: «${prompt.description}» says nothing`);
    assert.match(prompt.description, /[.!]$/u, `${name}: the line does not end`);
    // A question and its line must not be the same sentence twice.
    assert.notEqual(prompt.description, prompt.title, `${name}: the line repeats the title`);
  }
});

test("a question about destroying or withdrawing is marked as one", () => {
  const danger = new Map(EVERY_PROMPT.map(([name, prompt]) => [name, prompt.tone]));
  for (const name of [
    "globalRoleRemoval",
    "rolePermissionsSave/known",
    "sanctionRowLift/ban",
    "sanctionRowLift/mute",
    "locationArchive",
    "locationMemberRemove",
    "registrationMode/close",
    "inviteRevoke",
    "supportIntake/closed",
    "supportIntake/guestClosed",
  ]) {
    assert.equal(danger.get(name), "danger", `${name}: withdraws something but is not marked danger`);
  }
  // Granting is not destroying: a bulk assignment and opening registration are
  // far-reaching and must be asked, but tinting them red would spend the red on
  // everything and leave nothing for a deletion.
  assert.equal(danger.get("bulkGlobalRoleAssign/many"), "default");
  assert.equal(danger.get("bulkLocationAssign/many"), "default");
  assert.equal(danger.get("registrationMode/open"), "default");
});

// ---------------------------------------------------------------------
// Where the action reaches people who are not on the screen
// ---------------------------------------------------------------------

test("opening registration says it opens to everybody, not that a switch moved", () => {
  const open = registrationModePrompt(false);
  assert.match(open.title, /для всех/u);
  assert.match(open.description, /любой/u);
  assert.match(open.confirmLabel, /Открыть/u);

  const close = registrationModePrompt(true);
  assert.match(close.description, /только тот, у кого есть код|приглашени/u);
  assert.match(close.description, /остальные|отказ/iu);

  // The two directions must not be interchangeable: confirming the wrong one
  // is the whole failure this is here to prevent.
  assert.notEqual(open.title, close.title);
  assert.notEqual(open.confirmLabel, close.confirmLabel);
});

test("closing support intake says who stops being able to write", () => {
  const closed = supportIntakeClosurePrompt(
    { intakeEnabled: true, guestIntakeEnabled: true },
    { intakeEnabled: false, guestIntakeEnabled: true },
  );
  assert.ok(closed);
  assert.match(closed.description, /публичной формы|формы/u);
  assert.match(closed.description, /перестанут приходить/u);

  const guestClosed = supportIntakeClosurePrompt(
    { intakeEnabled: true, guestIntakeEnabled: true },
    { intakeEnabled: true, guestIntakeEnabled: false },
  );
  assert.ok(guestClosed);
  assert.match(guestClosed.description, /без аккаунта/u);
});

test("saving support settings that withdraw nothing asks nothing", () => {
  // A dialog on every save is a dialog nobody reads by the third one.
  const on = { intakeEnabled: true, guestIntakeEnabled: true };
  assert.equal(supportIntakeClosurePrompt(on, on), null, "nothing changed");
  assert.equal(
    supportIntakeClosurePrompt({ intakeEnabled: false, guestIntakeEnabled: false }, on),
    null,
    "opening intake back up",
  );
  // Closing the guest half while intake is already off still asks: the flag
  // outlives this save, and the next person to reopen intake would find the
  // public form shut without anybody having been told.
  const guestOnly = supportIntakeClosurePrompt(
    { intakeEnabled: false, guestIntakeEnabled: true },
    { intakeEnabled: false, guestIntakeEnabled: false },
  );
  assert.ok(guestOnly);
  assert.match(guestOnly.title, /гостевую форму/u);
  // But closing both at once is still one question, and it is the bigger one.
  const both = supportIntakeClosurePrompt(on, { intakeEnabled: false, guestIntakeEnabled: false });
  assert.ok(both);
  assert.match(both.title, /приём обращений/u);
});

test("replacing a role's permissions says whose access changes", () => {
  const known = rolePermissionsSavePrompt("Менеджер", 4);
  assert.match(known.description, /полностью заменит/u);
  assert.match(known.description, /4/u);
  assert.match(known.description, /кому назначена роль «Менеджер»/u);

  // Nobody holds it: saying «доступ изменится у всех» would be a scare.
  const none = rolePermissionsSavePrompt("Менеджер", 0);
  assert.match(none.description, /никому не назначена/u);

  // The location-role usage read can fail, and guessing «никому» then would be
  // a claim the screen cannot make.
  const unknown = rolePermissionsSavePrompt("Менеджер", null);
  assert.doesNotMatch(unknown.description, /никому не назначена/u);
  assert.match(unknown.description, /у всех, кому назначена/u);
});

test("a bulk assignment names one person, or counts several, and never declines a noun", () => {
  const one = bulkGlobalRoleAssignPrompt("Менеджер", ["Фиктивный Участник"]);
  assert.match(one.description, /Фиктивный Участник/u);
  assert.doesNotMatch(one.description, /: 1\./u, "a count of one instead of the name");

  const many = bulkGlobalRoleAssignPrompt("Менеджер", ["А", "Б", "В"]);
  assert.match(many.description, /выбранные пользователи: 3\./u);

  // A location assignment may have no dynamic role at all, and must not then
  // render « с ролью «»».
  const withoutRole = bulkLocationAssignPrompt("Север", null, ["А", "Б"]);
  assert.doesNotMatch(withoutRole.description, /ролью «»/u);
  assert.match(withoutRole.description, /локацию «Север»/u);
});

test("a thing without a name is still described", () => {
  for (const empty of [null, undefined, "", "   "]) {
    assert.equal(adminPersonLabel(empty), "этого пользователя");
    const removal = globalRoleRemovalPrompt(empty, empty);
    assert.match(removal.description, /этого пользователя/u);
    assert.doesNotMatch(removal.description, /«»/u, "an empty pair of quotes reached the screen");
    assert.doesNotMatch(locationArchivePrompt(empty, null).description, /«»/u);
    assert.doesNotMatch(inviteRevokePrompt(empty, empty).description, /«»/u);
  }
  // A location with no members must not claim «Её участники (0)».
  assert.doesNotMatch(locationArchivePrompt("Север", 0).description, /участник/u);
  assert.match(locationArchivePrompt("Север", 3).description, /участники \(3\)/u);
});

test("a mute names where it applied, because everywhere and one chat differ", () => {
  const everywhere = sanctionRowLiftPrompt("mute", "Фиктивный Участник");
  const inChat = sanctionRowLiftPrompt("mute", "Фиктивный Участник", "Смена");
  assert.match(everywhere.description, /во всех чатах/u);
  assert.match(inChat.description, /в «Смена»/u);
  assert.notEqual(everywhere.description, inChat.description);

  // A ban is not a mute; reading the wrong one over a row confirms the wrong
  // thing.
  const ban = sanctionRowLiftPrompt("ban", "Фиктивный Участник");
  assert.notEqual(ban.title, everywhere.title);
  assert.match(ban.description, /пользоваться приложением/u);
});

// ---------------------------------------------------------------------
// Where the action must not be offered at all
// ---------------------------------------------------------------------

test("a restriction that has run out cannot be ended", () => {
  assert.equal(canLiftSanctionRow({ expires_at: null }, NOW), true, "permanent");
  assert.equal(canLiftSanctionRow({}, NOW), true, "an absent field is permanent");
  assert.equal(canLiftSanctionRow({ expires_at: "2026-09-14T09:00:01.000Z" }, NOW), true);
  assert.equal(canLiftSanctionRow({ expires_at: "2026-09-14T08:59:59.000Z" }, NOW), false);
  // Exactly now is over — the same boundary the list uses to call a row
  // «истёк», so the chip and the button cannot disagree about one row.
  assert.equal(canLiftSanctionRow({ expires_at: NOW.toISOString() }, NOW), false);
  // An unreadable date is not evidence that a restriction has ended, and
  // hiding the only way to lift it would be worse than offering it.
  assert.equal(canLiftSanctionRow({ expires_at: "не дата" }, NOW), true);
});

test("an invitation that already creates no accounts cannot be withdrawn", () => {
  assert.equal(canRevokeInvite({ expires_at: null }, NOW), true, "no date");
  assert.equal(canRevokeInvite({ expires_at: "2026-09-14T09:00:01.000Z" }, NOW), true);
  assert.equal(canRevokeInvite({ expires_at: "2026-09-14T08:59:59.000Z" }, NOW), false, "expired");
  assert.equal(canRevokeInvite({ expires_at: NOW.toISOString() }, NOW), false, "exactly now");
  assert.equal(
    canRevokeInvite({ revoked_at: "2026-09-01T00:00:00.000Z", expires_at: null }, NOW),
    false,
    "already withdrawn",
  );
  // Withdrawn wins over a date still in the future.
  assert.equal(
    canRevokeInvite({ revoked_at: "2026-09-01T00:00:00.000Z", expires_at: "2027-01-01T00:00:00.000Z" }, NOW),
    false,
  );
  assert.equal(canRevokeInvite({ expires_at: "не дата" }, NOW), true, "an unreadable date is not an expiry");
});

// ---------------------------------------------------------------------
// D-132 — what the screen says when a section cannot be read
// ---------------------------------------------------------------------

test("no sentence the administration shows names a table, a function or a file", () => {
  for (const message of ADMIN_UNAVAILABLE_MESSAGES) {
    assert.doesNotMatch(message, ADMIN_INTERNALS_PATTERN, `internals reached the screen: ${message}`);
    assert.ok(message.length >= 20, `«${message}» is not a sentence`);
  }
  // The two the entry quotes by name (A-34). They are exported from
  // `registrationInvite.ts`, and the second of them is shown on the public
  // registration form, so a stranger was reading a migration file name.
  for (const message of [REGISTRATION_INVITES_REQUIRED_MESSAGE, REGISTRATION_INVITE_MODE_REQUIRED_MESSAGE]) {
    assert.doesNotMatch(message, ADMIN_INTERNALS_PATTERN, `internals reached the screen: ${message}`);
    assert.doesNotMatch(message, /20260622|\.sql/u);
  }
  assert.equal(REGISTRATION_INVITES_REQUIRED_MESSAGE, ADMIN_INVITES_UNAVAILABLE);
});

test("the filter refuses an internal from a mapper this track does not own", () => {
  // The exact sentences the shared mappers still answer with.
  assert.equal(
    plainAdminMessage("Локации требуют обновления базы данных.", ADMIN_LOCATIONS_UNAVAILABLE),
    ADMIN_LOCATIONS_UNAVAILABLE,
  );
  assert.equal(
    plainAdminMessage("Роли и права требуют обновления базы данных.", ADMIN_ROLES_UNAVAILABLE),
    ADMIN_ROLES_UNAVAILABLE,
  );
  // Shapes nobody has written yet, which is the point of a pattern.
  for (const internal of [
    "Примените SQL-предложение 20260622_admin_ops_security_report.sql.",
    "Серверная функция admin_ops_security_report недоступна.",
    "PGRST202: could not find the function",
    "Нужно применить migration.",
    "Таблица приглашений недоступна.",
  ]) {
    assert.equal(plainAdminMessage(internal, ADMIN_OPS_METRICS_UNAVAILABLE), ADMIN_OPS_METRICS_UNAVAILABLE, internal);
  }
  // A message a person can act on is passed through untouched — replacing
  // everything with «недоступно» would lose «Недостаточно прав», which is the
  // one failure an administrator can actually do something about.
  for (const useful of [
    "Недостаточно прав.",
    "Нельзя снять последний доступ владельца или тех. администратора.",
    "Пользователь уже имеет эту роль.",
    "Срок действия приглашения истёк.",
  ]) {
    assert.equal(plainAdminMessage(useful, ADMIN_OPS_METRICS_UNAVAILABLE), useful, useful);
  }
  // Nothing at all is not a message.
  assert.equal(plainAdminMessage("", ADMIN_LOCATIONS_UNAVAILABLE), ADMIN_LOCATIONS_UNAVAILABLE);
  assert.equal(plainAdminMessage(null, ADMIN_LOCATIONS_UNAVAILABLE), ADMIN_LOCATIONS_UNAVAILABLE);
  // The pattern carries no `g`, so repeated calls cannot start answering
  // differently from a leftover `lastIndex`.
  assert.equal(plainAdminMessage("Недостаточно прав.", ADMIN_LOCATIONS_UNAVAILABLE), "Недостаточно прав.");
});

// ---------------------------------------------------------------------
// The wiring: each surface actually asks, and asks with these words
// ---------------------------------------------------------------------

const ADMIN = "artifacts/kub/src/pages/admin";
const sources = new Map<string, string>();

function read(file: string): string {
  const cached = sources.get(file);
  if (cached !== undefined) return cached;
  const text = readFileSync(`${ADMIN}/${file}`, "utf8");
  sources.set(file, text);
  return text;
}

/** The body of a named top-level handler, by brace balance from its declaration. */
function block(file: string, name: string): string {
  const source = read(file);
  const start = source.indexOf(`const ${name} =`);
  assert.notEqual(start, -1, `${file}: ${name} is gone`);
  let depth = 0;
  let started = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
      started = true;
    } else if (char === "}") {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${file}: unbalanced braces after ${name}`);
}

/**
 * A handler that asks before it acts.
 *
 * Both halves matter and both were missing: raising the dialog without reading
 * the answer confirms nothing, and reading it without the words from this
 * module puts the sentence back inline where no test can reach it.
 */
function asksFirst(file: string, handler: string, promptFn: string): void {
  const body = block(file, handler);
  assert.match(body, /requestAppConfirm\(/u, `${file}: ${handler} does not ask`);
  assert.match(body, new RegExp(`${promptFn}\\(`, "u"), `${file}: ${handler} invents its own words`);
  assert.match(body, /if \(!confirmed\) return;/u, `${file}: ${handler} ignores the answer`);
  // The question has to come before the call it guards, or it is a dialog
  // raised over an action that already happened.
  const asked = body.indexOf("requestAppConfirm");
  const answered = body.indexOf("if (!confirmed) return;");
  assert.ok(asked < answered, `${file}: ${handler} reads the answer before asking`);
}

test("the roles panel asks before taking a role and before replacing a permission set", () => {
  asksFirst("RolesPermissionsTab.tsx", "savePermissions", "rolePermissionsSavePrompt");
  asksFirst("RolesPermissionsTab.tsx", "removeGlobalRole", "globalRoleRemovalPrompt");
  // The question names the person and the role, which means the row has to
  // hand them over: a prompt built from ids would read «этого пользователя»
  // for everybody.
  assert.match(read("RolesPermissionsTab.tsx"), /getProfileName\(profile\),\s*\n\s*getRoleLabel\(role\),/u);
});

test("the bans tab asks before lifting, and stops offering it on a row that is over", () => {
  asksFirst("BansMutesTab.tsx", "removeBan", "sanctionRowLiftPrompt");
  asksFirst("BansMutesTab.tsx", "removeMute", "sanctionRowLiftPrompt");
  const source = read("BansMutesTab.tsx");
  // The button is rendered only for a row still in force.
  assert.match(source, /\{!expired && \(\s*\n\s*<button/u, "«Снять» is offered on an expired row again");
  // And the expiry is decided in one place, shared with the list filter.
  assert.match(source, /canLiftSanctionRow\(row, new Date\(nowMs\)\)/u);
});

test("the user list asks before a bulk assignment reaches everybody selected", () => {
  asksFirst("UsersTab.tsx", "bulkAssignGlobalRole", "bulkGlobalRoleAssignPrompt");
  asksFirst("UsersTab.tsx", "bulkAssignLocation", "bulkLocationAssignPrompt");
  // D-134's work in the same file stays as it was: both menu items go through
  // the handler that asks and deletes only what is in force.
  const source = read("UsersTab.tsx");
  assert.match(source, /liftSanction\("ban", u\)/u);
  assert.match(source, /liftSanction\("mute", u\)/u);
  assert.match(source, /activeSanctionFilter\(new Date\(\)\)/u);
});

test("locations ask before archiving and before removing somebody", () => {
  asksFirst("LocationsTab.tsx", "archiveLocation", "locationArchivePrompt");
  asksFirst("LocationsTab.tsx", "removeMember", "locationMemberRemovePrompt");
  assert.match(read("LocationsTab.tsx"), /removeMember\(member\.user_id, getProfileName\(member\.profile\)\)/u);
});

test("invitations ask before the registration mode moves and before a link is withdrawn", () => {
  asksFirst("InvitesTab.tsx", "toggleInviteOnlyMode", "registrationModePrompt");
  asksFirst("InvitesTab.tsx", "revokeInvite", "inviteRevokePrompt");
  const source = read("InvitesTab.tsx");
  // «Отозвать» is live only while there is something to withdraw.
  assert.match(source, /const revocable = canRevokeInvite\(invite, new Date\(\)\)/u);
  assert.match(source, /disabled=\{!revocable\}/u);
  assert.doesNotMatch(source, /disabled=\{Boolean\(invite\.revoked_at\)\}/u);
});

test("support asks before intake closes, and the answer is read before it saves", () => {
  const body = block("SupportTab.tsx", "saveSettings");
  assert.match(body, /supportIntakeClosurePrompt\(settings, settingsDraft\)/u);
  assert.match(body, /requestAppConfirm\(/u);
  assert.match(body, /if \(!confirmed\) return;/u);
  assert.ok(
    body.indexOf("supportIntakeClosurePrompt") < body.indexOf("updateSupportSettings"),
    "the settings are written before the question is asked",
  );
  // The comparison needs the saved state as well as the draft, so the handler
  // must depend on both — a stale `settings` would ask the wrong question.
  assert.match(read("SupportTab.tsx"), /\}, \[settings, settingsDraft\]\);/u);
});

test("no administration tab explains the database to the person reading it", () => {
  const files = [
    "LocationsTab.tsx",
    "InvitesTab.tsx",
    "RolesPermissionsTab.tsx",
    "OpsReportTab.tsx",
    "UsersTab.tsx",
  ];
  for (const file of files) {
    // Rendered text only: a `console.error` tag, an identifier, and the notes
    // explaining what was removed are all allowed to name the cause. What is
    // checked is the strings and the JSX text that reach the screen.
    const source = read(file);
    for (const [index, line] of source.split("\n").entries()) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (trimmed.includes("console.error")) continue;
      for (const text of [...trimmed.matchAll(/"([^"]{20,})"/gu)].map((m) => m[1])) {
        assert.doesNotMatch(
          text,
          /Примените SQL|применения migration|требует обновления базы|требуют обновления базы|\.sql/u,
          `${file}:${index + 1} still explains the database: ${text}`,
        );
      }
    }
  }
  // The one the audit quoted by its function name.
  assert.doesNotMatch(read("OpsReportTab.tsx").split("\n").filter((line) => !line.trim().startsWith("//"))
    .join("\n"), /`admin_ops_security_report`/u);
});

test("the unavailable panels render this track's sentence, not the shared sentinel", () => {
  // The string-literal scan above cannot see a constant imported from a module
  // another track owns, and that is exactly how these panels used to say it:
  // `{routing.error ?? LOCATION_ROUTING_REQUIRED_MESSAGE}`.
  const locations = read("LocationsTab.tsx");
  assert.match(locations, /\{ADMIN_LOCATIONS_UNAVAILABLE\}/u);
  assert.doesNotMatch(locations, /LOCATION_ROUTING_REQUIRED_MESSAGE/u);
  assert.doesNotMatch(read("InvitesTab.tsx"), /LOCATION_ROUTING_REQUIRED_MESSAGE/u);

  // The roles panel still compares against the sentinel — that is how it knows
  // the object is missing rather than the read refused — but it must not show
  // it.
  const roles = read("RolesPermissionsTab.tsx");
  assert.match(roles, /rolesState\.error === ROLES_PERMISSIONS_REQUIRED_MESSAGE/u, "the sentinel comparison is gone");
  assert.match(roles, /\{ADMIN_ROLES_UNAVAILABLE\}/u);
  assert.doesNotMatch(roles, /\?\s*ROLES_PERMISSIONS_REQUIRED_MESSAGE/u, "the sentinel is rendered again");

  // And the cause reaches the log rather than the screen wherever a shared
  // mapper could still hand one over.
  for (const [file, calls] of [
    ["LocationsTab.tsx", 1],
    ["RolesPermissionsTab.tsx", 1],
    ["InvitesTab.tsx", 2],
    ["OpsReportTab.tsx", 1],
  ] as const) {
    const found = [...read(file).matchAll(/plainAdminMessage\(/gu)].length;
    assert.equal(found, calls, `${file}: ${found} calls to plainAdminMessage, expected ${calls}`);
    assert.match(read(file), /console\.error\(/u, `${file}: the cause goes nowhere`);
  }
});
