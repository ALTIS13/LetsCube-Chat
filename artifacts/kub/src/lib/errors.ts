/**
 * Единый маппер серверных/сетевых ошибок в дружелюбные русские
 * сообщения для UI. Используется во всех местах, где раньше показывали
 * сырое `error.message` (часто на английском, прямо из Postgres / GoTrue).
 *
 * Контракт:
 *   • Принимает что угодно — `PostgrestError`, `AuthError`, `Error`,
 *     строку, `null`, `undefined`.
 *   • Если совпал известный код / шаблон — возвращает готовый русский
 *     текст.
 *   • Иначе — если исходное сообщение уже содержит кириллицу, отдаёт его
 *     как есть (часто это бизнес-ошибка из RPC: `RAISE 'Нельзя …'`).
 *   • В последний черёд — нейтральное «Не удалось выполнить операцию.
 *     Попробуйте позже.»  Сырая строка наружу не утекает.
 *
 * Здесь намеренно нет зависимости от Supabase-типов — модуль чисто
 * утилитарный, чтобы его можно было дёргать из любого хука/компонента.
 */

type AnyErr =
  | { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }
  | string
  | null
  | undefined
  | unknown;

const FALLBACK = "Не удалось выполнить операцию. Попробуйте позже.";

const CYRILLIC_RE = /[А-Яа-яЁё]/;

function asRecord(e: AnyErr): { message?: string; code?: string } {
  if (!e) return {};
  if (typeof e === "string") return { message: e };
  if (typeof e !== "object") return {};
  const obj = e as Record<string, unknown>;
  const msg = typeof obj.message === "string" ? obj.message : undefined;
  const code = typeof obj.code === "string" ? obj.code : undefined;
  return { message: msg, code };
}

/**
 * Превратить произвольную ошибку в человеческое русское сообщение.
 * Никогда не возвращает пустую строку.
 */
export function mapPgError(err: AnyErr): string {
  const { message, code } = asRecord(err);

  // 1. Известные SQLSTATE коды Postgres / PostgREST.
  if (code) {
    const c = code.toUpperCase();
    if (c === "42501")
      return "Недостаточно прав для этого действия.";
    if (c === "23505")
      return "Такая запись уже существует.";
    if (c === "23503")
      return "Связанная запись не найдена или защищена от удаления.";
    if (c === "23502")
      return "Не заполнено обязательное поле.";
    if (c === "23514")
      return "Значение не прошло проверку. Проверьте поля и повторите.";
    if (c === "22P02")
      return "Неверный формат данных.";
    if (c === "P0001")
      // Бизнес-ошибка из RAISE EXCEPTION внутри RPC — текст обычно уже
      // на русском, отдаём как есть, иначе fallback.
      return message && CYRILLIC_RE.test(message) ? message : FALLBACK;
    if (c === "PGRST301" || c === "PGRST116")
      return "Запись недоступна или защищена правами доступа.";
    if (c === "PGRST204")
      return "Запись не найдена.";
  }

  // 2. Текстовые шаблоны.
  if (message) {
    const m = message.toLowerCase();

    // Сеть.
    if (
      m.includes("failed to fetch") ||
      m.includes("network request failed") ||
      m.includes("networkerror") ||
      m.includes("load failed")
    )
      return "Сетевой сбой. Проверьте подключение и попробуйте ещё раз.";
    if (m.includes("timeout") || m.includes("timed out"))
      return "Превышено время ожидания. Попробуйте ещё раз.";
    if (m.includes("aborted"))
      return "Запрос отменён.";

    // Аутентификация / сессия (GoTrue / PostgREST).
    if (
      m.includes("jwt expired") ||
      m.includes("invalid jwt") ||
      m.includes("jwt is invalid")
    )
      return "Сессия истекла. Войдите снова.";
    if (
      m.includes("missing session") ||
      m.includes("not authenticated") ||
      m.includes("auth session missing")
    )
      return "Сессия не найдена. Войдите снова.";
    if (m.includes("invalid login credentials"))
      return "Неверный e-mail или пароль.";
    if (m.includes("user already registered"))
      return "Пользователь с таким e-mail уже зарегистрирован.";
    if (m.includes("email not confirmed"))
      return "Подтвердите e-mail по ссылке из письма.";
    if (m.includes("invalid otp") || m.includes("token has expired") || m.includes("invalid token"))
      return "Неверный или просроченный код.";
    if (m.includes("rate limit") || m.includes("too many"))
      return "Слишком много попыток. Подождите и повторите позже.";
    if (m.includes("phone_not_confirmed"))
      return "Сначала подтвердите номер по SMS.";
    if (
      m.includes("sms provider") ||
      m.includes("phone provider") ||
      m.includes("phone signups are disabled") ||
      m.includes("phone_provider_disabled") ||
      m.includes("provider is not enabled")
    )
      return "Подтверждение по SMS пока недоступно.";

    // RLS / права.
    if (
      m.includes("row-level security") ||
      m.includes("row level security") ||
      m.includes("permission denied") ||
      m.includes("not authorized") ||
      m.includes("not allowed")
    )
      return "Недостаточно прав для этого действия.";

    // Хранилище.
    if (m.includes("payload too large") || m.includes("file too large"))
      return "Файл слишком большой.";
    if (m.includes("invalid mime type") || m.includes("mime type"))
      return "Этот тип файла не поддерживается.";

    // Уже на русском — отдаём как есть.
    if (CYRILLIC_RE.test(message)) return message;
  }

  return FALLBACK;
}

/**
 * Сахар: подставить русское сообщение в шаблон с префиксом.
 * Пример: `prefixError("Не удалось снять блокировку", err)` →
 *         `"Не удалось снять блокировку: Недостаточно прав …"`.
 */
export function prefixError(prefix: string, err: AnyErr): string {
  return `${prefix}: ${mapPgError(err)}`;
}
