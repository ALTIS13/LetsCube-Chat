/**
 * What the product says when something it needs is not there (D-132).
 *
 * The administration half of that entry was closed first, in
 * `lib/adminPrompts.ts`, and it established two things this module now holds
 * for everybody:
 *
 *   - the pattern that decides whether a sentence is explaining the machine
 *     rather than the situation, and
 *   - the filter that refuses such a sentence at the surface, where the mapper
 *     that produced it belongs to a track that cannot change it.
 *
 * They were written there because that was the only surface that needed them.
 * The chat, settings, search and task surfaces need exactly the same rule, and
 * two copies of a pattern drift: one of them learns about a new internal and
 * the other keeps letting it through. So the pattern and the filter live here
 * and `adminPrompts.ts` imports them. Its behaviour is unchanged — the regular
 * expression below is byte-for-byte the one it used to declare, and
 * `plainAdminMessage` is this module's `plainMessage` under its old name.
 *
 * The module imports nothing, for the same reason `adminPrompts.ts` imports
 * nothing: a decision made of words has no business pulling React into a
 * `node --test` process, and one that cannot be reached from a test is a gap in
 * the module boundary rather than a gap in the suite.
 *
 * The rule for a sentence added here, taken from the entry:
 *
 *   - one plain Russian sentence about what the person can or cannot do now;
 *   - at most one more saying what still works;
 *   - it never names a database object, a file, a migration, a build
 *     prerequisite or a provider — those go to `console.error` beside the call
 *     that failed, which is where somebody who can act on them reads them;
 *   - it does not promise a retry will help when nothing about a retry would
 *     change the answer. A missing object is «недоступно», not «попробуйте
 *     позже».
 */

/**
 * The words that must never reach the screen.
 *
 * Written as a pattern rather than a list of the exact strings that were
 * removed, so that a new sentence naming a different table or a different file
 * is caught by the same rule. Byte-identical to the expression
 * `adminPrompts.ts` declared before this module existed; `ADMIN_INTERNALS_PATTERN`
 * is now an alias of it, so the administration's tests pin this one too.
 */
export const INTERNALS_PATTERN =
  /баз[аыуе] данных|обновлени[ея] базы|миграц|migration|\bsql\b|таблиц|серверн(?:ая|ой) функци|функци[яию]|\.sql|PGRST|admin_ops_security_report|legacy|backend/iu;

/**
 * The last filter in front of a message on its way to the screen.
 *
 * The shared mappers — `mapPgError`, `mapLocationRoutingError`,
 * `mapRecurringTasksError`, `mapRolesPermissionsError` — still answer with the
 * cause for a missing object, and several of them are owned by other tracks:
 * the same sentinels are compared against inside hooks. So the surfaces do not
 * rewrite those mappers, they refuse the result — anything carrying an internal
 * is replaced with the surface's own plain sentence, and the original is what
 * goes to the log.
 *
 * It is a filter, not a lookup, because the failure being described is a
 * missing object nobody enumerated. And it deliberately passes through
 * everything a person can act on: replacing «Недостаточно прав» with
 * «недоступно» would lose the one failure they could have fixed.
 */
export function plainMessage(message: string | null | undefined, unavailable: string): string {
  const text = (message ?? "").trim();
  if (!text) return unavailable;
  return INTERNALS_PATTERN.test(text) ? unavailable : text;
}

/**
 * What `mapPgError` answers when it recognised nothing.
 *
 * It is plain Russian, so `plainMessage` passes it through — correctly, since
 * `plainMessage`'s job is to refuse internals and this is not one. But it says
 * «операцию», and a surface that knows which operation failed can say so. Kept
 * in step with `errors.ts` by a test that calls the mapper rather than by
 * reading its source, so a change to the wording there turns this red.
 */
export const MAPPER_GENERIC_FAILURE = "Не удалось выполнить операцию. Попробуйте позже.";

/**
 * `plainMessage`, plus the surface's own name for the thing that failed.
 *
 * Used where a mapper stands between the failure and the screen and the
 * surface has a better sentence than «операцию» for the case the mapper did
 * not recognise: «Не удалось открыть чат», «Не удалось сохранить профиль».
 * Anything the mapper *did* recognise — a dead network, an expired session,
 * missing rights — is worth more than either and survives untouched.
 *
 * Separate from `plainMessage` rather than folded into it because
 * `plainAdminMessage` is `plainMessage`, and the administration was closed and
 * reviewed with this exact behaviour: there, the mapper's generic sentence is
 * shown as it is.
 */
export function plainFailure(message: string | null | undefined, failed: string): string {
  const text = (message ?? "").trim();
  if (!text || text === MAPPER_GENERIC_FAILURE) return failed;
  return plainMessage(text, failed);
}

// ---------------------------------------------------------------------------
// Starting a chat (chat-functions A3)
// ---------------------------------------------------------------------------

/**
 * `openPrivateChat` used to put `err.message` on screen, and
 * `JSON.stringify(err)` when the thrown thing was not an `Error` — a raw object
 * dump inside a modal, in English, under a search field.
 */
export const CHAT_OPEN_FAILED = "Не удалось открыть чат. Попробуйте ещё раз.";

/**
 * The same hook's «Not logged in», which was English and was also the one
 * sentence here a person can act on: the session is gone and signing in again
 * fixes it. It now says that, in the words `mapPgError` uses for the same
 * state, so the two cannot describe one situation differently.
 */
export const CHAT_OPEN_SIGNED_OUT = "Сессия не найдена. Войдите снова.";

// ---------------------------------------------------------------------------
// Saving a profile (settings-profile B5, C4)
// ---------------------------------------------------------------------------

/**
 * A никнейм somebody else already has.
 *
 * `mapPgError` answers «Такая запись уже существует.» for SQLSTATE 23505,
 * which is true of a row and says nothing about the field the person typed
 * into. This is the sentence the entry asked for.
 */
export const USERNAME_TAKEN = "Это имя пользователя уже занято.";

/** Anything else the profile save can fail with and nobody can act on. */
export const PROFILE_SAVE_FAILED = "Не удалось сохранить профиль. Попробуйте ещё раз.";

/**
 * A person's card could not be read (D-283).
 *
 * It covers two different situations on purpose, and says neither of them:
 * the read failed, and the read was refused by row-level security and came
 * back empty. «Такого пользователя нет» would report the second as a fact
 * about the person rather than about what we were allowed to see — the
 * mistake D-140 and D-193 record on the other side.
 */
export const PROFILE_UNAVAILABLE = "Не удалось открыть профиль.";

// ---------------------------------------------------------------------------
// Phone verification (settings-profile D5)
// ---------------------------------------------------------------------------

/**
 * «Сервис доставки кода не настроен. Обратитесь к администратору.»
 *
 * Two problems, not one. It described a deployment state — a service that was
 * never configured — to somebody who cannot configure one; and it sent them to
 * an administrator for a fault no administrator of this product can repair
 * from any screen it has. The gateway answers `delivery_unavailable` or
 * `not_configured` for both a missing configuration and a provider that is
 * down, and the second really does clear on its own, so the sentence says what
 * happened and that later may differ.
 */
export const PHONE_CODE_UNAVAILABLE = "Не удалось отправить код. Попробуйте позже.";

// ---------------------------------------------------------------------------
// Push (settings-profile F2)
// ---------------------------------------------------------------------------

/**
 * The Android one, which is the reason this row is in the entry: it named
 * `google-services.json`, a migration and «backend FCM credentials» to every
 * signed-in person who opened the notification settings of the Android
 * application. Three build prerequisites, none of which is theirs.
 *
 * No «попробуйте позже» here: when the shipped application has no delivery
 * configuration, waiting changes nothing, and a promise that it might is worse
 * than silence.
 */
export const ANDROID_PUSH_UNAVAILABLE = "Push-уведомления на этом устройстве пока недоступны.";

/** The browser's half of the same row, which named the VAPID key. */
export const BROWSER_PUSH_UNAVAILABLE = "Push-уведомления в этом браузере пока недоступны.";

/**
 * A read or a write against the preference storage that is not there.
 *
 * This one is genuinely temporary from the reader's side — the deployment
 * catches up — so it is the one push sentence that says «позже».
 */
export const PUSH_UNAVAILABLE = "Push-уведомления сейчас недоступны. Попробуйте позже.";

/** Registration that started and did not finish. */
export const PUSH_ENABLE_FAILED = "Не удалось включить push-уведомления. Попробуйте ещё раз.";

/** The one-line summaries the settings row prints instead of its status. */
export const PUSH_ROW_UNAVAILABLE_DEVICE = "Недоступны на этом устройстве";
export const PUSH_ROW_UNAVAILABLE_BROWSER = "Недоступны в этом браузере";
export const PUSH_ROW_UNAVAILABLE_NOW = "Временно недоступны";

// ---------------------------------------------------------------------------
// Search (chat-functions P3, O1)
// ---------------------------------------------------------------------------

/**
 * What the in-chat search says while the whole history cannot be reached.
 *
 * This one was already describing the situation rather than the machine, and
 * it stays a statement about the search. It is here so that the three places
 * that print it — the chat's own bar, the list column's panel, and the global
 * results — cannot say it three different ways.
 */
export const SEARCH_LOADED_MESSAGES_ONLY = "Сейчас поиск идёт по загруженным сообщениям.";

/** The global search's version, which used to name the repair instead. */
export const SEARCH_HISTORY_UNAVAILABLE = "Поиск по всей истории сейчас недоступен.";
export const SEARCH_HISTORY_UNAVAILABLE_DETAIL =
  "Сейчас доступны видимые чаты, загруженные сообщения, пользователи, задачи и локации.";

export const SEARCH_FILTERS_UNAVAILABLE = "Расширенные фильтры по всей истории сейчас недоступны.";
export const SEARCH_FILTERS_UNAVAILABLE_DETAIL = "Сейчас поиск применяет доступные локальные фильтры.";

// ---------------------------------------------------------------------------
// Tasks (work-surfaces T-F7)
// ---------------------------------------------------------------------------

/**
 * The two sentinels the task form prints when a section of it cannot be built.
 *
 * They keep the names they had — `RECURRING_TASKS_REQUIRED_MESSAGE` and
 * `LOCATION_ROUTING_REQUIRED_MESSAGE` in `recurringTasks.ts` and
 * `locationRouting.ts` — because those names are compared against inside
 * `useRecurringTasks` and `useTaskRouting`, which belong to another track. Only
 * the words changed, and they changed here so a `node --test` process can read
 * them: both modules reach `mapPgError` through the `@/` alias, which nothing
 * outside Vite resolves.
 */
export const TASK_RECURRENCE_UNAVAILABLE = "Повторение задач сейчас недоступно.";
export const TASK_RECURRENCE_UNAVAILABLE_DETAIL = "Задачу можно создать как обычно, без повторения.";

/**
 * Deliberately the same sentence as the administration's
 * `ADMIN_LOCATIONS_UNAVAILABLE`.
 *
 * `LocationsTab` reads `mapLocationRoutingError` and passes the answer through
 * `plainAdminMessage`. While this constant named the database the filter
 * replaced it; now that it does not, the filter passes it through — so if the
 * two sentences differed, changing this one would silently change what the
 * administration screen shows. They are pinned equal by the unit test.
 */
export const TASK_ROUTING_UNAVAILABLE = "Локации сейчас недоступны. Попробуйте позже.";
export const TASK_ROUTING_UNAVAILABLE_DETAIL = "Задачу можно создать как обычно, без этих полей.";

// ---------------------------------------------------------------------------
// Lists that could not be read (F-6, and D-140 before it)
// ---------------------------------------------------------------------------

/**
 * What a list says instead of «ничего нет» when the read was refused.
 *
 * Three surfaces said the opposite of the truth: the task list said the person
 * was caught up, the chat list said they had no conversations, and a forum drew
 * itself as an ordinary chat. Each one is the sentence a refused read is
 * allowed to be, and each names the thing that could not be read, because
 * «Не удалось загрузить» on its own leaves the reader to guess what is missing
 * from a screen that looks complete.
 *
 * No «попробуйте позже» and no «ещё раз» in the sentence itself: every one of
 * these surfaces draws a «Повторить» beside it, and a promise repeated in words
 * beside a control that already makes it is noise.
 */
export const CHATS_UNAVAILABLE = "Не удалось загрузить чаты.";
export const TASKS_UNAVAILABLE = "Не удалось загрузить задачи.";

/**
 * The last resort, for a list with no better name for itself and for a refusal
 * that arrives with no words at all. `listReadState.ts` puts it in place of an
 * empty message, because an empty one reads as success.
 */
export const LIST_UNAVAILABLE = "Не удалось загрузить список.";

/**
 * What stands above rows that are still true and are no longer current.
 *
 * The administration's sanctions and complaints tabs already print these words
 * — «Список мог устареть: …» — and the three surfaces this closes print the
 * same ones, so one product does not have two spellings of one situation.
 *
 * Neither tab is named here on purpose: `content-report-queue.test.mts` proves
 * the complaints queue is mounted in exactly one place by scanning every file
 * under `src/` for the component's name, and a note that mentioned it counted
 * as a second mount. A test that cannot tell a note from a mount is coarse, but
 * it is guarding a queue whose every row names somebody who asked not to be
 * named, and a comment is the cheaper thing to change.
 */
export const LIST_MAY_BE_STALE = "Список мог устареть";

/**
 * Every sentence this module shows, for the test that asserts none of them
 * explains the machine.
 */
export const PLAIN_UNAVAILABLE_MESSAGES: readonly string[] = [
  CHAT_OPEN_FAILED,
  CHAT_OPEN_SIGNED_OUT,
  USERNAME_TAKEN,
  PROFILE_SAVE_FAILED,
  PROFILE_UNAVAILABLE,
  PHONE_CODE_UNAVAILABLE,
  ANDROID_PUSH_UNAVAILABLE,
  BROWSER_PUSH_UNAVAILABLE,
  PUSH_UNAVAILABLE,
  PUSH_ENABLE_FAILED,
  PUSH_ROW_UNAVAILABLE_DEVICE,
  PUSH_ROW_UNAVAILABLE_BROWSER,
  PUSH_ROW_UNAVAILABLE_NOW,
  SEARCH_LOADED_MESSAGES_ONLY,
  SEARCH_HISTORY_UNAVAILABLE,
  SEARCH_HISTORY_UNAVAILABLE_DETAIL,
  SEARCH_FILTERS_UNAVAILABLE,
  SEARCH_FILTERS_UNAVAILABLE_DETAIL,
  TASK_RECURRENCE_UNAVAILABLE,
  TASK_RECURRENCE_UNAVAILABLE_DETAIL,
  TASK_ROUTING_UNAVAILABLE,
  TASK_ROUTING_UNAVAILABLE_DETAIL,
  CHATS_UNAVAILABLE,
  TASKS_UNAVAILABLE,
  LIST_UNAVAILABLE,
  LIST_MAY_BE_STALE,
];
