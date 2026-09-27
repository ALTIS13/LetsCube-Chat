"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import type { Profile } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { createSingleFlight } from "@/lib/singleFlight";
import { signedMediaUrls } from "@/lib/media/mediaUrl";

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

/**
 * One profile load at a time, per user.
 *
 * The profile was fetched from three places at once on a restored session: the
 * mount effect, and again for every auth event Supabase emits while recovering
 * a stored session (`INITIAL_SESSION`, then `TOKEN_REFRESHED`). Measured
 * against production, that produced three identical
 * `GET /profiles?select=*&id=eq.<uuid>` requests, and six restores out of ten
 * ended on the loading screen with all three still outstanding — the same query
 * answers in half a millisecond when the database is asked directly. With one
 * request instead of three, ten restores out of ten reached the app in about a
 * second.
 */
const profileLoads = createSingleFlight<boolean>();

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
  const activeUserIdRef = useRef<string | null>(null);

  const loadProfileOnce = useCallback(async (userId: string): Promise<boolean> => {
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

    if (activeUserIdRef.current !== userId) return false;
    if (data) {
      setCurrentUser(data);
      return true;
    }

    const authUser = await supabase.auth.getUser();
    if (activeUserIdRef.current !== userId || authUser.data.user?.id !== userId) return false;
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

    if (!inserted || activeUserIdRef.current !== userId) return false;
    setCurrentUser(inserted as Profile);
    return true;
  }, [setCurrentUser, supabase]);

  const fetchProfile = useCallback(
    (userId: string): Promise<boolean> => profileLoads.run(userId, () => loadProfileOnce(userId)),
    [loadProfileOnce],
  );



  useEffect(() => {
    let cancelled = false;
    let authEventSeen = false;

    const loadSession = async () => {
      setLoading(true);
      setLoadingError(null);
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (cancelled || authEventSeen) return;
        if (error) throw error;

        activeUserIdRef.current = session?.user.id ?? null;
        setUser(session?.user ?? null);
        if (session?.user) {
          supabase.realtime.setAuth(session.access_token);
          const ok = await fetchProfile(session.user.id);
          if (!cancelled && !authEventSeen && !ok) setLoadingError(PROFILE_LOAD_ERROR);
        } else {
          setCurrentUser(null);
        }
      } catch {
        if (!cancelled && !authEventSeen) setLoadingError(PROFILE_LOAD_ERROR);
      } finally {
        if (!cancelled && !authEventSeen) setLoading(false);
      }
    };

    void loadSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // The parallel getSession() read may finish after a newer auth event.
      authEventSeen = true;
      activeUserIdRef.current = session?.user.id ?? null;
      signedMediaUrls().setAccount(session?.user.id ?? null);
      setUser(session?.user ?? null);
      if (session?.user) {
        supabase.realtime.setAuth(session.access_token);
        const currentProfile = useAppStore.getState().currentUser;
        const isSameLoadedUser = currentProfile?.id === session.user.id;
        // Supabase can emit SIGNED_IN again when a hidden tab is focused.
        // For the same loaded user this is a silent session refresh, not an
        // app state transition; showing LoadingScreen here remounts chat UI.
        const shouldBlockUiForProfile = !isSameLoadedUser;

        if (shouldBlockUiForProfile) {
          setLoading(true);
          setLoadingError(null);
        }
        void fetchProfile(session.user.id)
          .then((ok) => {
            if (activeUserIdRef.current === session.user.id && !ok && shouldBlockUiForProfile) setLoadingError(PROFILE_LOAD_ERROR);
          })
          .catch(() => {
            if (activeUserIdRef.current === session.user.id && shouldBlockUiForProfile) setLoadingError(PROFILE_LOAD_ERROR);
          })
          .finally(() => {
            if (activeUserIdRef.current === session.user.id && shouldBlockUiForProfile) setLoading(false);
          });
      } else {
        supabase.realtime.setAuth(null);
        setCurrentUser(null);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      activeUserIdRef.current = null;
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
