/**
 * The question asked before a session ends (D-135).
 *
 * «Выйти» sat at the foot of both account menus and signed out on the tap. It
 * is the one irreversible thing on that list — everything else it offers opens
 * a screen — and on a shared device it ends somebody's session with a mis-tap
 * next to «Помощь». Telegram confirms it on all three of its clients
 * (`lng_sure_logout`), and so does this product now.
 *
 * The question lives here rather than in either menu because there are two of
 * them — the avatar menu on a phone, the side list on a computer — and a
 * confirmation that is worded one way in one place and another way in the other
 * reads as two different actions. One object, used twice.
 *
 * The tone is destructive and the icon is the menu's own, so the dialog looks
 * like the row it came from.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 * `tone` and `icon` are literal types rather than imports from the dialog and
 * icon modules, which would drag components into a module that has no need of
 * them; they are still checked against `requestAppConfirm` at each call site.
 */

export interface SignOutConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "danger";
  icon: "logout";
}

/**
 * How the account reads in the question, or null when nothing identifies it.
 *
 * The никнейм and not the name, for two reasons. It is the account — two people
 * sharing a device can carry the same «Максим», and only one of them can be
 * `@maks`. And it needs no declension: «Сеанс @maks завершится» is Russian,
 * while the same sentence with a name in the nominative is not, and inventing
 * declension for a name somebody typed themselves is not something a
 * confirmation should attempt.
 *
 * A name is never used as a fallback for the same reason. Where there is no
 * никнейм the sentence simply drops the clause — the menu the question was
 * raised from has the person's name and picture at its top either way.
 */
export function signOutAccountHandle(username: string | null | undefined): string | null {
  const cleaned = (username ?? "").trim().replace(/^@+/, "").trim();
  return cleaned ? `@${cleaned}` : null;
}

/**
 * What to hand `requestAppConfirm`.
 *
 * The description answers the question a person actually has at that moment —
 * what ends, and what it will take to come back — and does it without scolding
 * them for reaching the row.
 */
export function signOutConfirm(account: { username?: string | null } = {}): SignOutConfirmRequest {
  const handle = signOutAccountHandle(account.username);
  return {
    // Not «Вы действительно хотите выйти?», which is the wording the register
    // proposed from Telegram Desktop's `lng_sure_logout`. Measured at 390 on
    // 2026-09-13: `KubModal` truncates its title to one line, and beside the
    // icon and the ✕ that sentence became «Вы действительно хотите в...» —
    // a question cut off mid-word asks nothing. This one is a question too, it
    // names the thing being left, and it fits with room to spare.
    title: "Выйти из аккаунта?",
    description: handle
      ? `Сеанс ${handle} на этом устройстве завершится. Чтобы вернуться, нужно будет войти снова.`
      : "Сеанс на этом устройстве завершится. Чтобы вернуться, нужно будет войти снова.",
    confirmLabel: "Выйти",
    cancelLabel: "Отмена",
    tone: "danger",
    icon: "logout",
  };
}
