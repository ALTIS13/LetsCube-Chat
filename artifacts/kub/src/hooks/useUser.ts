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
import { isWebBrowser } from "@/lib/platform/capabilities";
import { observeWebMessagePreviewIdentity, retireWebMessagePreviews } from "@/lib/platform/webMessagePreviews";
import { offlineHistory } from "@/lib/historyCache/appOfflineHistory";
import { CONNECTION_REVIVED_EVENT } from "@/lib/realtimeRevival";

const PROFILE_LOAD_ERROR = "Не удалось загрузить профиль. Проверьте соединение и попробуйте снова.";

export function useSignOut(): () => Promise<void> {
  return useCallback(async () => {
    if (isWebBrowser() && !await retireWebMessagePreviews()) throw new Error("Не удалось отключить предпросмотр на этой установке. Повторите выход.");
    await createClient().auth.signOut({ scope: "local" });
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

function isProfileRefusal(error: unknown, httpStatus?: number): boolean {
  if (httpStatus === 401 || httpStatus === 403) return true;
  if (!error || typeof error !== "object") return false;
  const { code, status } = error as { code?: string; status?: number };
  return status === 401 || status === 403 || code === "42501" || code === "PGRST301" || code === "PGRST302";
}

/** Invalidation/display hint only. Never pass these bytes to an Auth or network API. */
function readPersistedDisplaySession(): { session: unknown; raw: string } | null {
  try {
    const raw = localStorage.getItem("kub-auth");
    return raw ? { session: JSON.parse(raw), raw } : null;
  } catch { return null; }
}

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
  const authSessionSource = useAppStore((s) => s.authSessionSource);
  const supabase = createClient();
  const activeOwnerRef = useRef<ProfileOwner | null>(null);

  const isCurrent = useCallback((owner: ProfileOwner) => activeOwnerRef.current === owner
    && isCurrentProfileOwner(owner.userId, owner.accountEpoch), []);

  const restoreProfile = useCallback(async (owner: ProfileOwner, eligible: () => boolean = () => true) => {
    const cache = offlineHistory.capture();
    const before = useAppStore.getState().currentUser;
    if (!cache || cache.userId !== owner.userId || before) return;
    const profile = await cache.readProfile();
    if (!profile || profile.id !== owner.userId || !isCurrent(owner) || !eligible()
      || useAppStore.getState().currentUser !== before) return;
    setCurrentUser({ ...profile, role: "user" }, owner.accountEpoch);
    // Only the id is needed for routing local display; no cached server claims.
    setUser((current) => current ?? ({ id: owner.userId } as User));
    setLoading(false);
    setLoadingError(null);
  }, [isCurrent, setCurrentUser]);

  const refuseProfile = useCallback((owner: ProfileOwner) => {
    if (!isCurrent(owner)) return;
    void offlineHistory.capture()?.invalidate();
    setCurrentUser(null, owner.accountEpoch);
    setUser(null);
    setLoadingError(PROFILE_LOAD_ERROR);
    setLoading(false);
  }, [isCurrent, setCurrentUser]);

  const loadProfileOnce = useCallback(async (owner: ProfileOwner): Promise<boolean> => {
    const { userId } = owner;
    let data: Profile | null = null;
    let missing = false;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!isCurrent(owner)) return false;
      const result = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (!isCurrent(owner)) return false;
      if (isProfileRefusal(result.error, result.status)) {
        refuseProfile(owner);
        return false;
      }
      if (result.data) {
        data = result.data as Profile;
        break;
      }
      if (result.error) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      } else {
        missing = true;
        break;
      }
    }

    if (!isCurrent(owner)) return false;
    if (data) {
      setCurrentUser(data, owner.accountEpoch);
      void offlineHistory.capture()?.writeProfile(data, () => isCurrent(owner));
      return true;
    }

    // A failed request is not evidence that the profile does not exist.
    if (!missing) return false;

    const authUser = await supabase.auth.getUser();
    if (isProfileRefusal(authUser.error)) refuseProfile(owner);
    if (!isCurrent(owner) || authUser.data.user?.id !== userId) return false;
    if (authUser.error) return false;
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

    const { data: inserted, error: insertError, status: insertStatus } = await supabase
      .from("profiles")
      .insert(newProfile)
      .select("*")
      .single();

    if (isCurrent(owner) && isProfileRefusal(insertError, insertStatus)) refuseProfile(owner);
    if (!inserted || !isCurrent(owner)) return false;
    setCurrentUser(inserted as Profile, owner.accountEpoch);
    void offlineHistory.capture()?.writeProfile(inserted as Profile, () => isCurrent(owner));
    return true;
  }, [isCurrent, refuseProfile, setCurrentUser, supabase]);

  const fetchProfile = useCallback(
    (owner: ProfileOwner, revalidate = false): Promise<boolean> => {
      let started = false;
      const run = () => profileLoads.run(
        `${owner.userId}:${owner.accountEpoch}:${owner.observerGeneration}`, () => {
          started = true;
          return loadProfileOnce(owner);
        }).catch((error) => {
          if (isProfileRefusal(error)) refuseProfile(owner);
          return false;
        });
      const pending = run();
      // A reconnect may join the last failed outage read during its backoff.
      // Queue one fresh attempt only when we joined old work that failed.
      return revalidate && !started
        ? pending.then(ok => !ok && isCurrent(owner) ? run() : ok)
        : pending;
    },
    [isCurrent, loadProfileOnce, refuseProfile],
  );

  useEffect(() => {
    let cancelled = false;
    let authEventSeen = false;
    let sessionReadRevision = 0;
    let displaySessionRaw: string | null = null;
    const observerGeneration = ++nextObserverGeneration;

    const observeSession = (session: unknown, source: "cache" | "sdk" = "sdk"): ProfileOwner | null => {
      const identity = readAuthSessionIdentity(session);
      if (source === "sdk" && isWebBrowser()) observeWebMessagePreviewIdentity(identity);
      if (!identity) void offlineHistory.capture()?.invalidate();
      useAppStore.getState().setAuthSessionIdentity(identity, source);
      // setAuthSessionIdentity may retire the service even on its first owner.
      offlineHistory.setIdentity(useAppStore.getState().authSessionIdentity);
      if (!identity) return activeOwnerRef.current = null;
      const epoch = useAppStore.getState().accountEpoch;
      const current = activeOwnerRef.current;
      if (current?.userId === identity.userId && current.accountEpoch === epoch
        && current.observerGeneration === observerGeneration) return current;
      return activeOwnerRef.current = { userId: identity.userId, accountEpoch: epoch, observerGeneration };
    };

    const loadSession = async (revalidate = false) => {
      const revision = ++sessionReadRevision;
      const isCurrentRead = () => !cancelled && revision === sessionReadRevision;
      if (!useAppStore.getState().currentUser) setLoading(true);
      setLoadingError(null);
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!isCurrentRead()) return;
        if (error) throw error;
        authEventSeen = true;

        const owner = observeSession(session);
        setUser(session?.user ?? null);
        if (session?.user && owner) {
          supabase.realtime.setAuth(session.access_token);
          void restoreProfile(owner);
          const ok = await fetchProfile(owner, revalidate);
          if (isCurrentRead() && isCurrent(owner) && !ok
            && !useAppStore.getState().currentUser) setLoadingError(PROFILE_LOAD_ERROR);
        }
      } catch (error) {
        if (isCurrentRead() && isProfileRefusal(error) && activeOwnerRef.current) {
          refuseProfile(activeOwnerRef.current);
        }
        if (isCurrentRead() && !useAppStore.getState().currentUser) setLoadingError(PROFILE_LOAD_ERROR);
      } finally {
        if (isCurrentRead()) setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      // auth-js also emits INITIAL_SESSION(null) after a retryable load error.
      // Preserve only local display when the SDK has not replaced/removed its
      // exact stored bytes. SIGNED_OUT and positive SDK observations still win.
      if (event === "INITIAL_SESSION" && !session && displaySessionRaw !== null
        && useAppStore.getState().authSessionSource === "cache"
        && readPersistedDisplaySession()?.raw === displaySessionRaw) return;
      // The parallel getSession() read may finish after a newer auth event.
      authEventSeen = true;
      sessionReadRevision += 1;
      const owner = observeSession(session);
      signedMediaUrls().setAccount(session?.user.id ?? null);
      setUser(session?.user ?? null);
      if (session?.user && owner) {
        supabase.realtime.setAuth(session.access_token);
        void restoreProfile(owner);
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
            if (!useAppStore.getState().currentUser) {
              if (isCurrent(owner) && !ok && shouldBlockUiForProfile) setLoadingError(PROFILE_LOAD_ERROR);
            }
          })
          .catch(() => {
            if (!useAppStore.getState().currentUser) {
              if (isCurrent(owner) && shouldBlockUiForProfile) setLoadingError(PROFILE_LOAD_ERROR);
            }
          })
          .finally(() => {
            if (isCurrent(owner) && shouldBlockUiForProfile) setLoading(false);
          });
      } else {
        supabase.realtime.setAuth(null);
        setLoading(false);
      }
    });

    // Do not await SDK refresh: an expired token may keep getSession pending
    // for the whole outage. The service identity here is local ownership only.
    if (!authEventSeen && (!useAppStore.getState().authSessionIdentity || useAppStore.getState().authSessionSource === "cache")) {
      const persisted = readPersistedDisplaySession();
      if (persisted && readAuthSessionIdentity(persisted.session)) {
        displaySessionRaw = persisted.raw;
        const owner = observeSession(persisted.session, "cache");
        if (owner) {
          if (useAppStore.getState().currentUser?.id === owner.userId) {
            setUser({ id: owner.userId } as User);
            setLoading(false);
          }
          void restoreProfile(owner, () => !cancelled && !authEventSeen
            && readPersistedDisplaySession()?.raw === persisted.raw);
        }
      }
    }
    void loadSession();
    const onOnline = () => { void loadSession(true); };
    window.addEventListener("online", onOnline);
    window.addEventListener(CONNECTION_REVIVED_EVENT, onOnline);

    return () => {
      cancelled = true;
      activeOwnerRef.current = null;
      subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener(CONNECTION_REVIVED_EVENT, onOnline);
    };
  }, [fetchProfile, isCurrent, refuseProfile, restoreProfile, retryNonce, supabase]);

  useEffect(() => {
    if (!user?.id || authSessionSource !== "sdk"
      || !isCurrentProfileOwner(user.id, accountEpoch)) return;
    const detach = attachProfileChannel(user.id, accountEpoch);
    return () => detach();
  }, [user?.id, accountEpoch, authSessionSource]);

  const signOut = async () => {
    if (isWebBrowser() && !await retireWebMessagePreviews()) throw new Error("Не удалось отключить предпросмотр на этой установке. Повторите выход.");
    await supabase.auth.signOut({ scope: "local" });
  };
  const retry = useCallback(() => {
    setLoadingError(null);
    setLoading(true);
    setRetryNonce((current) => current + 1);
  }, []);

  return { user, loading, loadingError, retry, signOut };
}
