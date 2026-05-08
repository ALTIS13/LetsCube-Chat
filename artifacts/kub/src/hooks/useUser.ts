"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import type { Profile } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";

const PROFILE_LOAD_ERROR = "Не удалось загрузить профиль. Проверьте соединение и попробуйте снова.";

export function useSignOut(): () => Promise<void> {
  return useCallback(async () => {
    await createClient().auth.signOut();
  }, []);
}

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
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const supabase = createClient();

  const fetchProfile = useCallback(async (userId: string): Promise<boolean> => {
    let data: Profile | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (result.data) {
        data = result.data as Profile;
        break;
      }
      if (result.error && result.error.code !== "PGRST116") {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      } else {
        break;
      }
    }

    if (data) {
      setCurrentUser(data);
      return true;
    }

    const authUser = await supabase.auth.getUser();
    const meta = authUser.data.user?.user_metadata;
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

    if (!inserted) return false;
    setCurrentUser(inserted as Profile);
    return true;
  }, [setCurrentUser, supabase]);

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      setLoading(true);
      setLoadingError(null);
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (cancelled) return;
        if (error) throw error;

        setUser(session?.user ?? null);
        if (session?.user) {
          supabase.realtime.setAuth(session.access_token);
          const ok = await fetchProfile(session.user.id);
          if (!cancelled && !ok) setLoadingError(PROFILE_LOAD_ERROR);
        } else {
          setCurrentUser(null);
        }
      } catch {
        if (!cancelled) setLoadingError(PROFILE_LOAD_ERROR);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        supabase.realtime.setAuth(session.access_token);
        const currentProfile = useAppStore.getState().currentUser;
        const isSameLoadedUser = currentProfile?.id === session.user.id;
        const shouldBlockUiForProfile =
          !isSameLoadedUser || event === "SIGNED_IN" || event === "INITIAL_SESSION";

        if (shouldBlockUiForProfile) {
          setLoading(true);
          setLoadingError(null);
        }
        void fetchProfile(session.user.id)
          .then((ok) => {
            if (!ok && shouldBlockUiForProfile) setLoadingError(PROFILE_LOAD_ERROR);
          })
          .catch(() => {
            if (shouldBlockUiForProfile) setLoadingError(PROFILE_LOAD_ERROR);
          })
          .finally(() => {
            if (shouldBlockUiForProfile) setLoading(false);
          });
      } else {
        supabase.realtime.setAuth(null);
        setCurrentUser(null);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchProfile, retryNonce, setCurrentUser, supabase]);

  useEffect(() => {
    if (!user?.id) return;
    const detach = attachProfileChannel(user.id);
    return () => detach();
  }, [user?.id]);

  const signOut = async () => { await supabase.auth.signOut(); };
  const retry = useCallback(() => {
    setLoadingError(null);
    setLoading(true);
    setRetryNonce((current) => current + 1);
  }, []);

  return { user, loading, loadingError, retry, signOut };
}
