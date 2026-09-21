// The rest of D-132: what the chat, the settings, the phone, push, search and
// the task form say when something they need is not there.
//
// Three kinds of claim, in this order. First the shared filter, which the
// administration half introduced and which now has exactly one copy — the
// identity assertions below are the whole point of the move, because two
// regular expressions that merely look alike are the drift this was meant to
// prevent. Then the pure decisions: which sentence, and for the profile save,
// which field it belongs under. Last the wiring, read off the surfaces —
// unavoidable, since a React handler has no harness in this repository, and
// the defect is precisely that the handler put the cause on screen.
//
// Every wiring assertion below was checked by removing the line it protects;
// the mutations are named in the report.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADMIN_INTERNALS_PATTERN,
  ADMIN_LOCATIONS_UNAVAILABLE,
  plainAdminMessage,
} from "../../artifacts/kub/src/lib/adminPrompts.ts";
import { mapPgError } from "../../artifacts/kub/src/lib/errors.ts";
import {
  ANDROID_PUSH_UNAVAILABLE,
  BROWSER_PUSH_UNAVAILABLE,
  CHAT_OPEN_FAILED,
  CHAT_OPEN_SIGNED_OUT,
  INTERNALS_PATTERN,
  MAPPER_GENERIC_FAILURE,
  PHONE_CODE_UNAVAILABLE,
  PLAIN_UNAVAILABLE_MESSAGES,
  PROFILE_SAVE_FAILED,
  PUSH_ENABLE_FAILED,
  PUSH_UNAVAILABLE,
  SEARCH_FILTERS_UNAVAILABLE,
  SEARCH_HISTORY_UNAVAILABLE,
  SEARCH_LOADED_MESSAGES_ONLY,
  TASK_RECURRENCE_UNAVAILABLE,
  TASK_ROUTING_UNAVAILABLE,
  USERNAME_TAKEN,
  plainFailure,
  plainMessage,
} from "../../artifacts/kub/src/lib/plainMessages.ts";
import {
  profileSaveFailure,
  validateUsername,
} from "../../artifacts/kub/src/lib/profileValidation.ts";

const SRC = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, SRC), "utf8");

/**
 * What the six surfaces must never print, over and above the shared pattern.
 *
 * The administration's internals were database objects. These surfaces carried
 * a second family of them — a delivery network, a build file, a signing key —
 * and the shared pattern was deliberately left byte-identical, so the extra
 * names are checked here instead of widened into it.
 */
const BUILD_INTERNALS = /firebase|fcm|google-services|vapid|Not logged in|JSON.stringify/iu;

/** The file with its comment lines dropped: a note may name what it removed. */
function code(source: string): string {
  return source
    .split(String.fromCharCode(10))
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join(String.fromCharCode(10));
}

/** Rendered text only: comment lines and logging calls may name the cause. */
function renderedStrings(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split(String.fromCharCode(10))) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    if (trimmed.includes("console.error")) continue;
    for (const [, text] of trimmed.matchAll(/"([^"]{20,})"/gu)) found.push(text);
  }
  return found;
}

// ---------------------------------------------------------------------
// One filter, not two
// ---------------------------------------------------------------------

test("the administration and the rest of the product share one pattern and one filter", () => {
  // Identity, not equality. Two regular expressions with the same source are
  // exactly the drift this move was meant to prevent: one of them learns about
  // a new internal tomorrow and the other keeps letting it through.
  assert.equal(ADMIN_INTERNALS_PATTERN, INTERNALS_PATTERN, "the pattern was copied rather than shared");
  assert.equal(plainAdminMessage, plainMessage, "the filter was copied rather than shared");

  // And `adminPrompts.ts` still pulls in nothing that needs a browser, which is
  // what let it be tested in the first place.
  const imports = [...read("lib/adminPrompts.ts").matchAll(/from "([^"]+)"/gu)].map((m) => m[1]);
  assert.deepEqual(imports, ["./plainMessages.ts"]);
  assert.deepEqual([...read("lib/plainMessages.ts").matchAll(/from "([^"]+)"/gu)], []);
});

test("no sentence this track shows explains the machine", () => {
  for (const message of PLAIN_UNAVAILABLE_MESSAGES) {
    assert.doesNotMatch(message, INTERNALS_PATTERN, `internals reached the screen: ${message}`);
    assert.doesNotMatch(message, BUILD_INTERNALS, `internals reached the screen: ${message}`);
    assert.ok(message.length >= 15, `«${message}» is not a sentence`);
  }
});

test("the task form and the administration describe one failure the same way", () => {
  // `LocationsTab` reads `mapLocationRoutingError` and passes the answer
  // through `plainAdminMessage`. While `LOCATION_ROUTING_REQUIRED_MESSAGE`
  // named the database the filter replaced it; now that it does not, the filter
  // passes it through — so a different wording here would silently change that
  // screen too, which is the one thing this change was told not to do.
  assert.equal(TASK_ROUTING_UNAVAILABLE, ADMIN_LOCATIONS_UNAVAILABLE);
  assert.equal(plainAdminMessage(TASK_ROUTING_UNAVAILABLE, ADMIN_LOCATIONS_UNAVAILABLE), ADMIN_LOCATIONS_UNAVAILABLE);
});

// ---------------------------------------------------------------------
// `plainFailure`: the surface's own name for what failed
// ---------------------------------------------------------------------

test("the mapper's generic answer is the one the surface may improve on", () => {
  // Pinned by calling the mapper, not by reading its source, so a change to the
  // wording in `errors.ts` — a module this track does not own — turns this red
  // rather than quietly disabling the branch.
  assert.equal(mapPgError(new Error("something nobody mapped")), MAPPER_GENERIC_FAILURE);
  assert.equal(plainFailure(MAPPER_GENERIC_FAILURE, CHAT_OPEN_FAILED), CHAT_OPEN_FAILED);
  assert.equal(plainFailure(null, CHAT_OPEN_FAILED), CHAT_OPEN_FAILED);
  assert.equal(plainFailure("   ", CHAT_OPEN_FAILED), CHAT_OPEN_FAILED);
});

test("a failure somebody can act on survives both filters", () => {
  for (const useful of [
    "Сессия истекла. Войдите снова.",
    "Сетевой сбой. Проверьте подключение и попробуйте ещё раз.",
    "Недостаточно прав для этого действия.",
    "Слишком много попыток. Подождите и повторите позже.",
  ]) {
    assert.equal(plainFailure(useful, CHAT_OPEN_FAILED), useful, useful);
    assert.equal(plainMessage(useful, CHAT_OPEN_FAILED), useful, useful);
  }
});

test("an internal is refused whichever of the two filters sees it", () => {
  for (const internal of [
    "Локации требуют обновления базы данных.",
    "Повторяемые задачи требуют обновления базы данных.",
    "Поиск по всей истории требует обновления базы данных.",
    "Нужно применить migration user_push_devices.",
    "PGRST202: could not find the function",
  ]) {
    assert.equal(plainFailure(internal, CHAT_OPEN_FAILED), CHAT_OPEN_FAILED, internal);
    assert.equal(plainMessage(internal, CHAT_OPEN_FAILED), CHAT_OPEN_FAILED, internal);
  }
});

// ---------------------------------------------------------------------
// Saving a профиль (settings-profile B5, C4)
// ---------------------------------------------------------------------

test("a taken никнейм is named as the никнейм, and put under it", () => {
  // What Postgres actually sends back, and what `mapPgError` makes of it.
  const duplicate = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "profiles_username_key"',
    details: "Key (username)=(sergey) already exists.",
  };
  assert.equal(mapPgError(duplicate), "Такая запись уже существует.", "the mapper changed under us");

  const failure = profileSaveFailure(duplicate, mapPgError(duplicate), true);
  assert.equal(failure.field, "username", "the sentence goes back to the banner under the header");
  assert.equal(failure.message, USERNAME_TAKEN);
  assert.doesNotMatch(failure.message, /запись/iu, "it still describes a row rather than a name");
});

test("the duplicate is only called the никнейм when it can be", () => {
  const detailless = { code: "23505", message: "duplicate key value violates unique constraint" };
  assert.equal(profileSaveFailure(detailless, mapPgError(detailless), true).field, "username");

  // The save wrote null into the никнейм, so nothing it sent could collide.
  const empty = profileSaveFailure(detailless, mapPgError(detailless), false);
  assert.equal(empty.field, null);
  assert.equal(empty.message, "Такая запись уже существует.");

  // A future unique column falls out of the branch instead of being mislabelled.
  const otherColumn = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "profiles_phone_key"',
    details: "Key (phone)=(+79990000000) already exists.",
  };
  assert.equal(profileSaveFailure(otherColumn, mapPgError(otherColumn), true).field, null);
});

test("every other way the profile save fails lands in the banner, in plain Russian", () => {
  const denied = { code: "42501", message: "permission denied for table profiles" };
  const deniedFailure = profileSaveFailure(denied, mapPgError(denied), true);
  assert.equal(deniedFailure.field, null);
  assert.equal(deniedFailure.message, "Недостаточно прав для этого действия.");

  // English the mapper did not recognise reached the screen as it was; now the
  // surface names what it was trying to do.
  const unknown = new Error("unexpected end of JSON input");
  const unknownFailure = profileSaveFailure(unknown, mapPgError(unknown), true);
  assert.equal(unknownFailure.field, null);
  assert.equal(unknownFailure.message, PROFILE_SAVE_FAILED);

  // And an internal that arrives already in Russian is still refused.
  const internal = profileSaveFailure({ code: "42P01" }, "Профиль требует обновления базы данных.", true);
  assert.equal(internal.message, PROFILE_SAVE_FAILED);
});

test("the никнейм rules that need nobody's permission are decidable without a server", () => {
  // C4 asked for the failure to be caught where it is typed. These three are
  // the part that can be: everything `validateUsername` already knew and the
  // screen used to consult only after «Сохранить».
  assert.equal(validateUsername("привет!"), "Никнейм может содержать только латинские буквы, цифры, точку и подчёркивание");
  assert.equal(validateUsername("a".repeat(33)), "Никнейм не должен быть длиннее 32 символов");
  assert.equal(validateUsername("support"), "Этот никнейм зарезервирован для администраторов.");
  assert.equal(validateUsername("support", { allowReserved: true }), null);
  assert.equal(validateUsername("sergey_2"), null);
  assert.equal(validateUsername(""), null, "an empty никнейм is allowed and must not shout");
});

// ---------------------------------------------------------------------
// The wiring: each surface refuses the cause, and logs it instead
// ---------------------------------------------------------------------

test("no surface in this half of the entry prints an internal", () => {
  const files = [
    "hooks/useCreateChat.ts",
    "hooks/usePush.ts",
    "components/sidebar/NewChatModal.tsx",
    "components/sidebar/PhoneSection.tsx",
    "components/settings/SettingsScreen.tsx",
    "components/chat/ChatSearchBar.tsx",
    "components/search/ChatSearchPanel.tsx",
    "components/search/SidebarSearchResults.tsx",
    "pages/tasks/TaskFormModal.tsx",
    "lib/plainMessages.ts",
    "lib/profileValidation.ts",
    "lib/recurringTasks.ts",
    "lib/locationRouting.ts",
    "lib/settingsRows.ts",
    "lib/platform/capabilities.ts",
    "lib/platform/nativePush.ts",
  ];
  for (const file of files) {
    for (const text of renderedStrings(read(file))) {
      // Identifiers, RPC names and import paths are not sentences. A sentence
      // has a space in it, and that is the only thing separating the two here.
      if (!text.includes(" ")) continue;
      assert.doesNotMatch(text, INTERNALS_PATTERN, `${file} still explains the machine: ${text}`);
      assert.doesNotMatch(text, BUILD_INTERNALS, `${file} still explains the build: ${text}`);
    }
  }
});

test("starting a chat says what failed, and the cause goes to the log", () => {
  const source = read("hooks/useCreateChat.ts");
  assert.match(source, /setError\(CHAT_OPEN_SIGNED_OUT\)/u, "«Not logged in» is back");
  assert.match(source, /setError\(plainFailure\(mapPgError\(err\), CHAT_OPEN_FAILED\)\)/u);
  assert.match(source, /console\.error\("openPrivateChat error:", err\)/u, "the cause goes nowhere");
  assert.doesNotMatch(code(source), /JSON\.stringify/u, "the object dump is back");
  assert.doesNotMatch(source, /setError\(msg\)/u);
  // The modal announces it: nothing else on that screen moves when a tap on a
  // person fails.
  assert.match(read("components/sidebar/NewChatModal.tsx"), /role="alert"/u);
});

test("the profile save decides the sentence and the field, and shows them together", () => {
  const source = read("components/settings/SettingsScreen.tsx");
  assert.match(source, /profileSaveFailure\(err, mapPgError\(err\), Boolean\(cleanUsername\)\)/u);
  assert.match(source, /console\.error\("profile save error:", err\)/u);
  assert.doesNotMatch(source, /setError\(mapPgError\(err\)\)/u, "the save writes the banner again");

  // The никнейм's own rules are consulted as it is typed, not inside the save.
  assert.match(source, /const usernameRuleError = validateUsername\(username, \{ allowReserved: isAdmin \}\)/u);
  const live = source.indexOf("const usernameRuleError");
  const save = source.indexOf("const handleSave");
  assert.ok(live >= 0 && save >= 0 && live < save, "the live check moved back inside the save");

  // Both text fields carry their own sentence.
  assert.match(source, /error=\{fieldError\("fullName"\)\}/u);
  assert.match(source, /error=\{fieldError\("username"\)\}/u);
  assert.match(source, /aria-describedby=\{error \? errorId : undefined\}/u);
  // And a field stops being told it is wrong once it is edited.
  assert.match(source, /clearFieldFailure\("username"\)/u);
});

test("push says whether it works here, not what the build is missing", () => {
  assert.match(read("lib/platform/capabilities.ts"), /return ANDROID_PUSH_UNAVAILABLE;/u);
  const native = read("lib/platform/nativePush.ts");
  assert.match(native, /return ANDROID_PUSH_UNAVAILABLE;/u);
  assert.match(native, /console\.error\("native push setup failed"\)/u);
  assert.doesNotMatch(native, /console\.(?:error|warn|log)\([^;\n]*\b(?:text|error|payload|token)\s*[,)]/u);
  assert.match(native, /message: PUSH_ENABLE_FAILED/u);

  const push = read("hooks/usePush.ts");
  assert.match(push, /setMessage\(PUSH_UNAVAILABLE\)/u);
  assert.match(push, /setMessage\(BROWSER_PUSH_UNAVAILABLE\)/u);
  assert.doesNotMatch(push, /console\.(?:error|warn|log)\([^;\n]*register_push_device[^;\n]*,\s*error\)/u);
  // The statuses are untouched: they are how the row and the rest of the hook
  // know what happened, and only the words were the defect.
  assert.match(push, /setStatus\("migration_missing"\)/u);
  assert.match(push, /setStatus\("missing_vapid"\)/u);

  // The sentences themselves are distinguishable: an Android build with no
  // delivery configuration is not going to start working by waiting.
  assert.notEqual(ANDROID_PUSH_UNAVAILABLE, PUSH_UNAVAILABLE);
  assert.doesNotMatch(ANDROID_PUSH_UNAVAILABLE, /позже/u);
  assert.match(PUSH_UNAVAILABLE, /позже/u);
  assert.doesNotMatch(BROWSER_PUSH_UNAVAILABLE, /позже/u);
});

test("the three search surfaces say one thing, from one place", () => {
  assert.match(read("components/chat/ChatSearchBar.tsx"), /\{SEARCH_LOADED_MESSAGES_ONLY\}/u);
  assert.match(read("components/search/ChatSearchPanel.tsx"), /\{SEARCH_LOADED_MESSAGES_ONLY\}/u);
  const sidebar = read("components/search/SidebarSearchResults.tsx");
  assert.match(sidebar, /\{SEARCH_HISTORY_UNAVAILABLE\} \{SEARCH_HISTORY_UNAVAILABLE_DETAIL\}/u);
  assert.match(sidebar, /\{SEARCH_FILTERS_UNAVAILABLE\} \{SEARCH_FILTERS_UNAVAILABLE_DETAIL\}/u);
  assert.doesNotMatch(SEARCH_HISTORY_UNAVAILABLE, /требует/u);
  assert.doesNotMatch(SEARCH_FILTERS_UNAVAILABLE, /требуют/u);
  assert.ok(SEARCH_LOADED_MESSAGES_ONLY.includes("загруженным сообщениям"));
});

test("the task form refuses the mapper's answer instead of rewriting the mapper", () => {
  const source = read("pages/tasks/TaskFormModal.tsx");
  const calls = [...source.matchAll(/plainMessage\(/gu)].length;
  assert.equal(calls, 2, `${calls} calls to plainMessage, expected 2`);
  assert.match(source, /\{plainMessage\(recurring\.message, TASK_RECURRENCE_UNAVAILABLE\)\}/u);
  assert.match(source, /\{plainMessage\(routing\.error, TASK_ROUTING_UNAVAILABLE\)\}/u);

  // The sentinels keep the names the hooks compare against; only the words
  // changed, and they changed where a test can read them.
  assert.match(read("lib/recurringTasks.ts"), /RECURRING_TASKS_REQUIRED_MESSAGE = TASK_RECURRENCE_UNAVAILABLE/u);
  assert.match(read("lib/locationRouting.ts"), /LOCATION_ROUTING_REQUIRED_MESSAGE = TASK_ROUTING_UNAVAILABLE/u);
  assert.doesNotMatch(TASK_RECURRENCE_UNAVAILABLE, /требуют/u);
});

test("the phone section stops describing a service nobody reading it configures", () => {
  const source = read("components/sidebar/PhoneSection.tsx");
  assert.match(source, /CODE_DELIVERY_UNAVAILABLE_MESSAGE = PHONE_CODE_UNAVAILABLE/u);
  assert.match(source, /console\.error\("phone gateway begin failed:", claimErrorCode\)/u);
  // The number itself never goes to the log — only the gateway's own code.
  assert.doesNotMatch(source, /console\.error\([^)]*normalised/u);
  assert.match(PHONE_CODE_UNAVAILABLE, /код/u);
});
