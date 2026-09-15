/**
 * What the settings ask before removing something of the person's own (D-133).
 *
 * The entry's administration and bot halves were closed on 2026-09-14; its last
 * two rows are here, and they are the two that are about the person rather than
 * about other people: «Удалить фото» in the profile header and «Удалить» on a
 * verified telephone number. Both acted on the press.
 *
 * **The shape is not redefined.** `AdminConfirmPrompt` from `adminPrompts.ts`
 * is the product's one confirmation shape — the title is the question, one line
 * says what changes, the confirming button names the action, «Отмена» is the way
 * out — and it is imported rather than copied. Only the words are new, because
 * these are not administration words: nothing here reaches anybody else, and a
 * line borrowed from a screen that does would overstate what is happening.
 *
 * Like its neighbour this module imports nothing that pulls in React, so
 * `node --test` can reach the sentences directly. A confirmation written inline
 * in a `.tsx` can be deleted in one line and no test would notice.
 *
 * ## Both descriptions were measured before they were written
 *
 * The obvious line for the telephone — «вас перестанут находить по номеру» — is
 * **false**, and writing it would have been the easy mistake.
 * `public.search_profiles_by_phone`, read off production on 2026-09-15, refuses
 * every caller who does not hold `users.view`:
 *
 *     if public.is_banned(v_actor)
 *        or not public.has_permission(v_actor, 'users.view') then
 *       return;
 *     end if;
 *
 * So an ordinary person has never been able to find anybody by telephone number,
 * and telling somebody they are giving that up would be describing a feature
 * that does not exist. What removal actually costs is the verification itself,
 * which has a 120-second cooldown and per-hour and per-day limits, so it is not
 * free to redo. That is what the line says.
 *
 * The photograph's line is the fallback the avatar really draws: `ChatAvatar`
 * renders the person's initials when `avatar_url` is absent, in chats and on the
 * profile alike.
 */

import type { AdminConfirmPrompt } from "./adminPrompts.ts";

/**
 * Removing one's own profile photograph.
 *
 * Reversible — another can be uploaded at once — so the line says what changes
 * rather than warning. A confirmation that sounds graver than the act teaches
 * people to press through the next one.
 */
export function avatarRemovalPrompt(): AdminConfirmPrompt {
  return {
    title: "Удалить фото профиля?",
    description: "В чатах и в профиле вместо него будут показаны ваши инициалы.",
    confirmLabel: "Удалить фото",
    cancelLabel: "Отмена",
    tone: "danger",
  };
}

/**
 * Removing one's own verified telephone number.
 *
 * The cost is the verification, not discoverability — see the module note.
 */
export function phoneRemovalPrompt(): AdminConfirmPrompt {
  return {
    title: "Удалить номер телефона?",
    description: "Чтобы вернуть его, номер придётся подтвердить заново.",
    confirmLabel: "Удалить номер",
    cancelLabel: "Отмена",
    tone: "danger",
  };
}

/** Every sentence this module puts on screen, for the test that none explains the machine. */
export const SETTINGS_PROMPT_MESSAGES: readonly string[] = [
  avatarRemovalPrompt().title,
  avatarRemovalPrompt().description,
  avatarRemovalPrompt().confirmLabel,
  phoneRemovalPrompt().title,
  phoneRemovalPrompt().description,
  phoneRemovalPrompt().confirmLabel,
];
