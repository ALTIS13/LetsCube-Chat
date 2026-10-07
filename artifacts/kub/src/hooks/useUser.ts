"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import type { Profile } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { createSingleFlight } from "@/lib/singleFlight";
import { signedMediaUrls } from "@/lib/media/mediaUrl";
import { readAuthSessionIdentity } from "@/lib/authSessionIdentity";

const PROFILE_LOAD_ERROR = "Не удалось загрузить профиль. Проверьте соединение и попробуйте снова.";

export function useSignOut(): () => Promise<void> {
  return useCallback(async () => {
    await createClient().auth.signOut();
  }, []);
}

interface ProfileChannelEntry {
  channel: RealtimeChannel;
  name: string;
  refCount: number;
}

const activeProfileChannels = new Map<string, ProfileChannelEntry>();
let nextObserverGeneration = 0;
let nextProfileChannelGeneration = 0;

type ProfileOwner = { userId: string; accountEpoch: number; observerGeneration: number };

function isCurrentProfileOwner(userId: string, accountEpoch: number): boolean {
  const state = useAppStore.getState();
  return state.accountEpoch === accountEpoch && state.authSessionIdentity?.userId === userId;
}

/**
 * One profile load at a time, per authenticated ownership generation.
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

function attachProfileChannel(userId: string, accountEpoch: number): () => void {
  const key = `${userId}:${accountEpoch}`;
  const existing = activeProfileChannels.get(key);
  if (existing) {
    existing.refCount += 1;
    return () => detachProfileChannel(key);
  }

  const supabase = createClient();
  // Realtime reuses equal topics until asynchronous removal finishes.
  const name = `profile-self:${key}:${++nextProfileChannelGeneration}`;
  let entry: ProfileChannelEntry;
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
        if (payload.new && activeProfileChannels.get(key) === entry && isCurrentProfileOwner(userId, accountEpoch)) {
          useAppStore.getState().setCurrentUser(payload.new as Profile, accountEpoch);
        }
      },
    )
    .subscribe();

  registerChannel(name);
  entry = { channel, name, refCount: 1 };
  activeProfileChannels.set(key, entry);
  return () => detachProfileChannel(key);
}

function detachProfileChannel(key: string): void {
  const entry = activeProfileChannels.get(key);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    activeProfileChannels.delete(key);
    unregisterChannel(entry.name);
    createClient().removeChannel(entry.channel);
  }
}

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const accountEpoch = useAppStore((s) => s.accountEpoch);
  const supabase = createClient();
  const activeOwnerRef = useRef<ProfileOwner | null>(null);

  const isCurrent = useCallback((owner: ProfileOwner) => activeOwnerRef.current === owner
    && isCurrentProfileOwner(owner.userId, owner.accountEpoch), []);

  const loadProfileOnce = useCallback(async (owner: ProfileOwner): Promise<boolean> => {
    const { userId } = owner;
    let data: Profile | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!isCurrent(owner)) return false;
      const result = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (!isCurrent(owner)) return false;
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

    if (!isCurrent(owner)) return false;
    if (data) {
      setCurrentUser(data, owner.accountEpoch);
      return true;
    }

    const authUser = await supabase.auth.getUser();
    if (!isCurrent(owner) || authUser.data.user?.id !== userId) return false;
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

    if (!inserted || !isCurrent(owner)) return false;
    setCurrentUser(inserted as Profile, owner.accountEpoch);
    return true;
  }, [isCurrent, setCurrentUser, supabase]);

  const fetchProfile = useCallback(
    (owner: ProfileOwner): Promise<boolean> => profileLoads.run(
      `${owner.userId}:${owner.accountEpoch}:${owner.observerGeneration}`, () => loadProfileOnce(owner)),
    [loadProfileOnce],
  );

  useEffect(() => {
    let cancelled = false;
    let authEventSeen = false;
    const observerGeneration = ++nextObserverGeneration;

    const observeSession = (session: unknown): ProfileOwner | null => {
      const identity = readAuthSessionIdentity(session);
      useAppStore.getState().setAuthSessionIdentity(identity);
      if (!identity) return activeOwnerRef.current = null;
      const epoch = useAppStore.getState().accountEpoch;
      const current = activeOwnerRef.current;
      if (current?.userId === identity.userId && current.accountEpoch === epoch
        && current.observerGeneration === observerGeneration) return current;
      return activeOwnerRef.current = { userId: identity.userId, accountEpoch: epoch, observerGeneration };
    };

    const loadSession = async () => {
      setLoading(true);
      setLoadingError(null);
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (cancelled || authEventSeen) return;
        if (error) throw error;

        const owner = observeSession(session);
        setUser(session?.user ?? null);
        if (session?.user && owner) {
          supabase.realtime.setAuth(session.access_token);
          const ok = await fetchProfile(owner);
          if (!cancelled && !authEventSeen && isCurrent(owner) && !ok) setLoadingError(PROFILE_LOAD_ERROR);
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
      if (cancelled) return;
      const owner = observeSession(session);
      signedMediaUrls().setAccount(session?.user.id ?? null);
      setUser(session?.user ?? null);
      if (session?.user && owner) {
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
        void fetchProfile(owner)
          .then((ok) => {
            if (isCurrent(owner) && !ok && shouldBlockUiForProfile) setLoadingError(PROFILE_LOAD_ERROR);
          })
          .catch(() => {
            if (isCurrent(owner) && shouldBlockUiForProfile) setLoadingError(PROFILE_LOAD_ERROR);
          })
          .finally(() => {
            if (isCurrent(owner) && shouldBlockUiForProfile) setLoading(false);
          });
      } else {
        supabase.realtime.setAuth(null);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      activeOwnerRef.current = null;
      subscription.unsubscribe();
    };
  }, [fetchProfile, isCurrent, retryNonce, supabase]);

  useEffect(() => {
    if (!user?.id || !isCurrentProfileOwner(user.id, accountEpoch)) return;
    const detach = attachProfileChannel(user.id, accountEpoch);
    return () => detach();
  }, [user?.id, accountEpoch]);

  const signOut = async () => { await supabase.auth.signOut(); };
  const retry = useCallback(() => {
    setLoadingError(null);
    setLoading(true);
    setRetryNonce((current) => current + 1);
  }, []);

  return { user, loading, loadingError, retry, signOut };
}
