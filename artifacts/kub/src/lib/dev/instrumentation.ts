/**
 * Dev-only диагностика для Task #48 (storm-петля fetch'ей).
 *
 * Под `import.meta.env.DEV` собирает счётчики:
 *   – fetch'и по хуку (`bumpFetch("useChats")` и т. п.);
 *   – активные realtime-каналы (`registerChannel`/`unregisterChannel`);
 * и раз в 10 с выводит сводку через `console.debug`.
 *
 * В production все функции — no-op (ранний return по `import.meta.env.DEV`),
 * так что обвязка не влияет на runtime.
 *
 * Никаких токенов, содержимого сообщений, телефонов или ключей не логируем —
 * только имена хуков и стабильные имена каналов.
 */

const isDev = import.meta.env.DEV;
const REPORT_INTERVAL_MS = 10_000;

const fetchCounts = new Map<string, number>();
const channelCounts = new Map<string, number>();
const mountCounts = new Map<string, number>();
let reportTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReport() {
  if (!isDev) return;
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    if (fetchCounts.size > 0) {
      console.debug("[kub:dev] fetches/10s", Object.fromEntries(fetchCounts));
      fetchCounts.clear();
    }
    if (channelCounts.size > 0) {
      console.debug("[kub:dev] active realtime channels", Object.fromEntries(channelCounts));
    }
    if (mountCounts.size > 0) {
      console.debug("[kub:dev] active mounts", Object.fromEntries(mountCounts));
    }
    if (heartbeatPings > 0 || heartbeatActive > 0) {
      console.debug("[kub:dev] heartbeat", {
        pingsLast10s: heartbeatPings,
        activeRunners: heartbeatActive,
      });
      heartbeatPings = 0;
    }
    // Self-reschedule: пока есть активные каналы / монтированные тяжёлые
    // компоненты / живой heartbeat — отчёт продолжает выходить каждые 10s
    // даже без новых событий. Это даёт «every-10s while active» гарантию
    // (без paint-storm в idle-вкладке, потому что условие закрытое).
    if (
      channelCounts.size > 0 ||
      mountCounts.size > 0 ||
      heartbeatActive > 0
    ) {
      scheduleReport();
    }
  }, REPORT_INTERVAL_MS);
}

export function bumpFetch(hook: string): void {
  if (!isDev) return;
  fetchCounts.set(hook, (fetchCounts.get(hook) ?? 0) + 1);
  scheduleReport();
}

export function registerChannel(name: string): void {
  if (!isDev) return;
  channelCounts.set(name, (channelCounts.get(name) ?? 0) + 1);
  scheduleReport();
}

export function unregisterChannel(name: string): void {
  if (!isDev) return;
  const cur = channelCounts.get(name) ?? 0;
  if (cur <= 1) channelCounts.delete(name);
  else channelCounts.set(name, cur - 1);
  scheduleReport();
}

/**
 * Mount/unmount счётчики для тяжёлых компонентов (ChatList, Sidebar,
 * ChatWindow). Используются под `import.meta.env.DEV`, чтобы убедиться,
 * что компоненты не ремаунтятся при каждом heartbeat-эхо или при
 * раскрытии модалок (Task #48).
 */
export function bumpMount(component: string): void {
  if (!isDev) return;
  mountCounts.set(component, (mountCounts.get(component) ?? 0) + 1);
  scheduleReport();
}

export function bumpUnmount(component: string): void {
  if (!isDev) return;
  const cur = mountCounts.get(component) ?? 0;
  if (cur <= 1) mountCounts.delete(component);
  else mountCounts.set(component, cur - 1);
  scheduleReport();
}

/**
 * Heartbeat-метрики (Task #48): сколько реальных PATCH-пингов
 * улетело за окно отчёта и сколько активных runner-ов сейчас живёт
 * (должен быть ровно 0 или 1; если выше — ref-counting сломан).
 */
let heartbeatPings = 0;
let heartbeatActive = 0;

export function bumpHeartbeat(): void {
  if (!isDev) return;
  heartbeatPings += 1;
  scheduleReport();
}

export function setHeartbeatActive(n: number): void {
  if (!isDev) return;
  heartbeatActive = n;
  scheduleReport();
}
