"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import type { Profile } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";

/**
 * `useSignOut()` — облегчённый хук без эффектов.
 *
 * Используется в `SidebarHeader`, чтобы не монтировать второй экземпляр
 * `useUser` (который заводил бы дубликат подписки на сессию и канала
 * `profile-self`). Возвращает мемоизированный коллбэк выхода.
 */
export function useSignOut(): () => Promise<void> {
  return useCallback(async () => {
    await createClient().auth.signOut();
  }, []);
}

// ── Module-level dedup для realtime-канала `profile-self:{userId}` ─────────
//
// Двойной монт `useUser` (если когда-нибудь снова случится) при общем имени
// канала ронял Supabase realtime-клиент: «channel already subscribed». Мы
// дедупим через ref-счётчик: первый монтаж создаёт канал, остальные просто
// инкрементят refCount; последний размонтаж убирает канал. Имя стабильное —
// никаких `Math.random` в идентификаторе.
interface ProfileChannelEntry {
  channel: RealtimeChannel;
  refCount: number;
}
const activeProfileChannels = new Map<string, ProfileChannelEntry>();

function attachProfileChannel(userId: string): () => void {
  const existing = activeProfileChannels.get(userId);
  if (existing) {
    existing.refCount += 1;
    return () => detachProfileChannel(userId);
  }
  const supabase = createClient();
  const name = `profile-self:${userId}`;
  const channel = supabase
    .channel(name)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "profiles",
        filter: `id=eq.${userId}`,
      },
      (payload) => {
        if (payload.new) {
          // setCurrentUser сам отбросит heartbeat-echo (online_at/updated_at-only)
          // через shallow-сравнение значимых полей в сторе — см. app.store.ts.
          useAppStore.getState().setCurrentUser(payload.new as Profile);
        }
      },
    )
    .subscribe();
  registerChannel(name);
  activeProfileChannels.set(userId, { channel, refCount: 1 });
  return () => detachProfileChannel(userId);
}

function detachProfileChannel(userId: string): void {
  const entry = activeProfileChannels.get(userId);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    createClient().removeChannel(entry.channel);
    activeProfileChannels.delete(userId);
    unregisterChannel(`profile-self:${userId}`);
  }
}

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        // Явно передаём JWT в realtime-клиент (тот же экземпляр),
        // чтобы WebSocket-соединение проходило аутентификацию.
        supabase.realtime.setAuth(session.access_token);
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        supabase.realtime.setAuth(session.access_token);
        fetchProfile(session.user.id);
      } else {
        supabase.realtime.setAuth(null);
        setCurrentUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Подписка на live-обновления собственной строки `profiles`. Имя канала
  // стабильное (`profile-self:{userId}`), дедуп через module-level Map.
  useEffect(() => {
    if (!user?.id) return;
    const detach = attachProfileChannel(user.id);
    return () => detach();
  }, [user?.id]);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (data) {
      setCurrentUser(data as Profile);
    } else {
      const authUser = await supabase.auth.getUser();
      const meta = authUser.data.user?.user_metadata;
      // Note: `role` is intentionally omitted so the DB-side
      // `bootstrap_first_admin` trigger can promote the very first profile
      // to admin.  We re-read the row after insert to pick up that role.
      // Note: phone fields live in the separate `profile_contacts`
      // table (RLS-protected). An AFTER INSERT trigger auto-creates
      // an empty contacts row for this profile.
      const newProfile = {
        id: userId,
        full_name: meta?.full_name ?? meta?.name ?? null,
        username: null,
        avatar_url: meta?.avatar_url ?? null,
        bio: null,
        online_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { data: inserted } = await supabase
        .from("profiles")
        .insert(newProfile)
        .select("*")
        .single();
      if (inserted) setCurrentUser(inserted as Profile);
    }
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  return { user, loading, signOut };
}
