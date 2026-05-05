"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubIcon, KubPanel, type KubIconName } from "@/components/kub";

interface Metrics {
  totalUsers: number;
  online: number;
  newToday: number;
  newThisWeek: number;
  totalChats: number;
  messagesToday: number;
  activeBans: number;
  activeMutes: number;
}

const startOfDayIso = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
const startOfWeekIso = () => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export function DashboardTab() {
  const supabase = createClient();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const nowIso = new Date().toISOString();
    const todayIso = startOfDayIso();
    const weekIso = startOfWeekIso();
    const onlineCutoffIso = new Date(Date.now() - 60_000).toISOString();

    const [users, online, newToday, newWeek, chats, msgsToday, bans, mutes] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("online_at", onlineCutoffIso),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", weekIso),
      supabase.from("chats").select("id", { count: "exact", head: true }),
      supabase.from("messages").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
      supabase.from("bans").select("id", { count: "exact", head: true }).or(`expires_at.is.null,expires_at.gt.${nowIso}`),
      supabase.from("mutes").select("id", { count: "exact", head: true }).or(`expires_at.is.null,expires_at.gt.${nowIso}`),
    ]);

    setMetrics({
      totalUsers: users.count ?? 0,
      online: online.count ?? 0,
      newToday: newToday.count ?? 0,
      newThisWeek: newWeek.count ?? 0,
      totalChats: chats.count ?? 0,
      messagesToday: msgsToday.count ?? 0,
      activeBans: bans.count ?? 0,
      activeMutes: mutes.count ?? 0,
    });
    setUpdatedAt(new Date());
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void load();
      }, 500);
    };
    const channel = supabase
      .channel("admin-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "bans" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "mutes" }, debouncedLoad)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, debouncedLoad)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chats" }, debouncedLoad)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  if (loading || !metrics) {
    return (
      <div className="flex items-center justify-center py-16">
        <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
      </div>
    );
  }

  type Tone = "cyan" | "pink" | "online" | "danger" | "warn";
  const cards: Array<{ icon: KubIconName; label: string; value: number; tone: Tone }> = [
    { icon: "users",    label: "Всего пользователей", value: metrics.totalUsers,   tone: "cyan" },
    { icon: "activity", label: "Онлайн сейчас",        value: metrics.online,        tone: "online" },
    { icon: "userPlus", label: "Новых сегодня",        value: metrics.newToday,      tone: "pink" },
    { icon: "userPlus", label: "Новых за 7 дней",      value: metrics.newThisWeek,   tone: "pink" },
    { icon: "chatRect", label: "Чатов",                value: metrics.totalChats,    tone: "cyan" },
    { icon: "chatRect", label: "Сообщений за сегодня", value: metrics.messagesToday, tone: "online" },
    { icon: "shieldOff",label: "Активных банов",       value: metrics.activeBans,    tone: "danger" },
    { icon: "muted",    label: "Активных мьютов",      value: metrics.activeMutes,   tone: "warn" },
  ];

  const toneColor: Record<Tone, string> = {
    cyan:   "var(--kub-cyan)",
    pink:   "var(--kub-pink)",
    online: "var(--kub-online)",
    danger: "var(--kub-danger)",
    warn:   "var(--kub-warn)",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-[color:var(--kub-text)]">
          Сводка по системе
        </h2>
        {updatedAt && (
          <span className="text-[11px] uppercase tracking-wide text-[color:var(--kub-muted)]">
            обновлено в {updatedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map(({ icon, label, value, tone }) => {
          const c = toneColor[tone];
          return (
            <KubPanel key={label} padded={false} className="p-4 flex flex-col gap-2 hover:border-[color:var(--kub-cyan)]/40 transition-colors">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: `color-mix(in srgb, ${c} 18%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 38%, transparent)`, color: c }}
              >
                <KubIcon name={icon} size={16} tone="currentColor" />
              </div>
              <div className="text-2xl font-bold tabular-nums text-[color:var(--kub-text)]">
                {value.toLocaleString("ru-RU")}
              </div>
              <div className="text-[11px] uppercase tracking-wide leading-tight break-words text-[color:var(--kub-muted)]">
                {label}
              </div>
            </KubPanel>
          );
        })}
      </div>
    </div>
  );
}
