"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearRoleAccessCache } from "@/hooks/useRole";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import {
  LOCATION_ROUTING_REQUIRED_MESSAGE,
  LOCATION_ROUTING_STORAGE_EVENT,
  getLocationRoutingEnabled,
  isLocationRoutingMissingError,
  mapLocationRoutingError,
  setLocationRoutingEnabled,
} from "@/lib/locationRouting";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { Location, LocationMember, Profile } from "@/types/database";

export type LocationMemberWithProfile = LocationMember & {
  profile?: Profile | null;
  primary_admin?: Profile | null;
};

interface UseTaskRoutingOptions {
  enabled?: boolean;
  includeMembers?: boolean;
}

type LoadOptions = {
  background?: boolean;
};

export interface TaskRoutingState {
  available: boolean;
  checked: boolean;
  loading: boolean;
  error: string | null;
  locations: Location[];
  members: LocationMemberWithProfile[];
  refetch: () => Promise<void>;
}

export function useTaskRouting(options: UseTaskRoutingOptions = {}): TaskRoutingState {
  const enabled = options.enabled ?? true;
  const includeMembers = options.includeMembers ?? true;
  const supabase = useMemo(() => createClient(), []);
  const rt = useMemo(() => getRealtimeClient(), []);
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const channelIdRef = useRef(`task-routing:${Math.random().toString(36).slice(2)}`);
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [members, setMembers] = useState<LocationMemberWithProfile[]>([]);

  const load = useCallback(
    async (options: LoadOptions = {}) => {
      const background = options.background === true;
      if (!enabled) {
        setAvailable(false);
        setChecked(true);
        setLoading(false);
        setError(null);
        setLocations([]);
        setMembers([]);
        return;
      }

      bumpFetch("useTaskRouting");
      if (!background) setLoading(true);
      setError(null);

      const locationQuery = supabase
        .from("locations")
        .select("*")
        .order("is_active", { ascending: false })
        .order("name", { ascending: true });

      const memberQuery = includeMembers
        ? supabase
            .from("location_members")
            .select(
              `*,
             profile:profiles!location_members_user_id_fkey(*),
             primary_admin:profiles!location_members_primary_admin_id_fkey(*)`,
            )
            .order("created_at", { ascending: false })
        : null;
      const ownMemberQuery =
        includeMembers && currentUserId
          ? supabase.from("location_members").select("*").eq("user_id", currentUserId)
          : null;

      const [locationRes, memberRes, ownMemberRes] = await Promise.all([
        locationQuery,
        memberQuery ?? Promise.resolve({ data: [], error: null }),
        ownMemberQuery ?? Promise.resolve({ data: [], error: null }),
      ]);

      const memberError = memberRes.error && ownMemberRes.error ? memberRes.error : null;
      const firstError = locationRes.error ?? memberError;
      if (firstError) {
        const friendlyError = isLocationRoutingMissingError(firstError)
          ? LOCATION_ROUTING_REQUIRED_MESSAGE
          : mapLocationRoutingError(firstError);
        setError(friendlyError);
        if (!isLocationRoutingMissingError(firstError)) {
          if (import.meta.env.DEV) console.warn("[task-routing] load failed", firstError);
        }
        if (background) {
          setLoading(false);
          return;
        }
        setAvailable(false);
        setLocations([]);
        setMembers([]);
        setChecked(true);
        setLoading(false);
        return;
      }

      const mergedMembers = mergeLocationMembers(
        (memberRes.error ? [] : (memberRes.data ?? [])) as LocationMemberWithProfile[],
        (ownMemberRes.error ? [] : (ownMemberRes.data ?? [])) as LocationMember[],
      ).map((member) => ({
        ...member,
        profile: member.profile ?? null,
        primary_admin: member.primary_admin ?? null,
      }));

      setAvailable(true);
      setLocations((current) => updateIfChanged(current, (locationRes.data ?? []) as Location[], locationSignature));
      setMembers((current) => updateIfChanged(current, mergedMembers, locationMemberSignature));
      setChecked(true);
      setLoading(false);
    },
    [currentUserId, enabled, includeMembers, supabase],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled || !available) return;
    let timer: number | null = null;
    const debounced = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void load({ background: true });
      }, 250);
    };
    const handleMembershipChange = (payload: { new?: { user_id?: string }; old?: { user_id?: string } }) => {
      clearRoleAccessCache(payload.new?.user_id ?? payload.old?.user_id);
      debounced();
    };
    const channelName = `${channelIdRef.current}:locations`;
    const channel = rt
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "location_members" }, handleMembershipChange)
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[task-routing]", status);
      });
    registerChannel(channelName);
    return () => {
      if (timer) window.clearTimeout(timer);
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [enabled, available, rt, load]);

  return { available, checked, loading, error, locations, members, refetch: load };
}

function mergeLocationMembers(
  members: LocationMemberWithProfile[],
  ownMembers: LocationMember[],
): LocationMemberWithProfile[] {
  const map = new Map<string, LocationMemberWithProfile>();
  for (const member of members) {
    map.set(locationMemberKey(member), member);
  }
  for (const member of ownMembers) {
    const key = locationMemberKey(member);
    map.set(key, {
      ...member,
      profile: map.get(key)?.profile ?? null,
      primary_admin: map.get(key)?.primary_admin ?? null,
    });
  }
  return Array.from(map.values());
}

function locationMemberKey(member: Pick<LocationMember, "user_id" | "location_id">): string {
  return `${member.user_id}:${member.location_id}`;
}

function updateIfChanged<T>(current: T[], next: T[], signature: (item: T) => string): T[] {
  return collectionSignature(current, signature) === collectionSignature(next, signature) ? current : next;
}

function collectionSignature<T>(items: T[], signature: (item: T) => string): string {
  return items.map(signature).sort().join("|");
}

function locationSignature(location: Location): string {
  return [
    location.id,
    location.name,
    location.address ?? "",
    location.is_active ? "1" : "0",
    location.updated_at,
  ].join(":");
}

function locationMemberSignature(member: LocationMemberWithProfile): string {
  const profile = member.profile;
  const primaryAdmin = member.primary_admin;
  return [
    member.user_id,
    member.location_id,
    member.role,
    member.role_id ?? "",
    member.primary_admin_id ?? "",
    member.is_primary ? "1" : "0",
    member.updated_at,
    profile?.full_name ?? "",
    profile?.username ?? "",
    profile?.avatar_url ?? "",
    primaryAdmin?.full_name ?? "",
    primaryAdmin?.username ?? "",
  ].join(":");
}

export function useTaskRoutingEnabledPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(() => getLocationRoutingEnabled());

  useEffect(() => {
    const sync = () => setEnabledState(getLocationRoutingEnabled());
    window.addEventListener(LOCATION_ROUTING_STORAGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(LOCATION_ROUTING_STORAGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setLocationRoutingEnabled(next);
    setEnabledState(next);
  }, []);

  return [enabled, setEnabled];
}
