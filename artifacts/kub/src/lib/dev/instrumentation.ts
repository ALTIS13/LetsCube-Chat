/**
 * Development-only counters for long-session QA.
 *
 * The counters are intentionally metadata-only: hook names, channel names and
 * heartbeat counts. They do not capture tokens, message text, profile data or
 * request payloads. Production builds return early through import.meta.env.DEV.
 */

const isDev = import.meta.env.DEV;
const REPORT_INTERVAL_MS = 10_000;

export interface KubDevInstrumentationSnapshot {
  fetchesLastWindow: Record<string, number>;
  cumulativeFetches: Record<string, number>;
  activeRealtimeChannels: Record<string, number>;
  duplicateRealtimeChannels: Record<string, number>;
  activeMounts: Record<string, number>;
  heartbeat: {
    pingsLastWindow: number;
    cumulativePings: number;
    activeRunners: number;
  };
}

declare global {
  interface Window {
    __kubDevInstrumentation?: KubDevInstrumentationSnapshot;
  }
}

const fetchCounts = new Map<string, number>();
const cumulativeFetchCounts = new Map<string, number>();
const channelCounts = new Map<string, number>();
const mountCounts = new Map<string, number>();
let reportTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatPings = 0;
let cumulativeHeartbeatPings = 0;
let heartbeatActive = 0;

function mapToObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(map);
}

function duplicateChannelsSnapshot(): Record<string, number> {
  return Object.fromEntries(Array.from(channelCounts).filter(([, count]) => count > 1));
}

function currentSnapshot(): KubDevInstrumentationSnapshot {
  return {
    fetchesLastWindow: mapToObject(fetchCounts),
    cumulativeFetches: mapToObject(cumulativeFetchCounts),
    activeRealtimeChannels: mapToObject(channelCounts),
    duplicateRealtimeChannels: duplicateChannelsSnapshot(),
    activeMounts: mapToObject(mountCounts),
    heartbeat: {
      pingsLastWindow: heartbeatPings,
      cumulativePings: cumulativeHeartbeatPings,
      activeRunners: heartbeatActive,
    },
  };
}

function publishSnapshot() {
  if (!isDev || typeof window === "undefined") return;
  window.__kubDevInstrumentation = currentSnapshot();
}

function scheduleReport() {
  if (!isDev) return;
  publishSnapshot();
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    const snapshot = currentSnapshot();
    if (fetchCounts.size > 0) {
      console.debug("[kub:dev] fetches/10s", snapshot.fetchesLastWindow);
      fetchCounts.clear();
    }
    if (channelCounts.size > 0) {
      console.debug("[kub:dev] active realtime channels", snapshot.activeRealtimeChannels);
    }
    if (mountCounts.size > 0) {
      console.debug("[kub:dev] active mounts", snapshot.activeMounts);
    }
    if (heartbeatPings > 0 || heartbeatActive > 0) {
      console.debug("[kub:dev] heartbeat", snapshot.heartbeat);
      heartbeatPings = 0;
    }
    publishSnapshot();
    if (channelCounts.size > 0 || mountCounts.size > 0 || heartbeatActive > 0) {
      scheduleReport();
    }
  }, REPORT_INTERVAL_MS);
}

export function bumpFetch(hook: string): void {
  if (!isDev) return;
  fetchCounts.set(hook, (fetchCounts.get(hook) ?? 0) + 1);
  cumulativeFetchCounts.set(hook, (cumulativeFetchCounts.get(hook) ?? 0) + 1);
  scheduleReport();
}

export function registerChannel(name: string): void {
  if (!isDev) return;
  channelCounts.set(name, (channelCounts.get(name) ?? 0) + 1);
  scheduleReport();
}

export function unregisterChannel(name: string): void {
  if (!isDev) return;
  const current = channelCounts.get(name) ?? 0;
  if (current <= 1) channelCounts.delete(name);
  else channelCounts.set(name, current - 1);
  scheduleReport();
}

export function bumpMount(component: string): void {
  if (!isDev) return;
  mountCounts.set(component, (mountCounts.get(component) ?? 0) + 1);
  scheduleReport();
}

export function bumpUnmount(component: string): void {
  if (!isDev) return;
  const current = mountCounts.get(component) ?? 0;
  if (current <= 1) mountCounts.delete(component);
  else mountCounts.set(component, current - 1);
  scheduleReport();
}

export function bumpHeartbeat(): void {
  if (!isDev) return;
  heartbeatPings += 1;
  cumulativeHeartbeatPings += 1;
  scheduleReport();
}

export function setHeartbeatActive(count: number): void {
  if (!isDev) return;
  heartbeatActive = count;
  scheduleReport();
}
