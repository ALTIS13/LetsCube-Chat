/**
 * Стоит ли обновление профиля перерисовки.
 *
 * Вынесено из `app.store.ts` отдельным модулем, потому что это контракт, а не
 * деталь: он один раз уже тихо устарел и сломал видимую функцию.
 */

/**
 * Поля, которые трогает только пульс присутствия.
 *
 * `useHeartbeat` пишет `online_at` раз в интервал, realtime присылает всю
 * строку обратно, и без фильтра каждый такой отклик пересоздавал бы
 * `currentUser` — это и есть storm-петля Task #48.
 */
export const HEARTBEAT_ONLY_PROFILE_FIELDS: ReadonlySet<string> = new Set([
  "online_at",
  "updated_at",
]);

/**
 * `true`, если между двумя версиями профиля не изменилось ничего, кроме полей
 * пульса, — тогда подписчиков будить не за чем.
 *
 * Сравниваются **все** поля, кроме перечисленных, а не список «значимых».
 * Раньше список был белым, и `profile_frame`/`profile_background` в него не
 * попали: выбор рамки проходил все сравнения, стор возвращал прежний объект,
 * и кнопка выглядела мёртвой при том, что запись в базу проходила. Чёрный
 * список делает любой новый столбец профиля значимым по умолчанию.
 *
 * Сравнение поверхностное: строка `profiles` состоит из скаляров.
 */
export function isHeartbeatOnlyProfileChange(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (HEARTBEAT_ONLY_PROFILE_FIELDS.has(key)) continue;
    if (!Object.is(previous[key], next[key])) return false;
  }
  return true;
}
