"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import {
  LOCATION_ROUTING_REQUIRED_MESSAGE,
  LOCATION_ROUTING_STORAGE_EVENT,
  getLocationRoutingEnabled,
  isLocationRoutingMissingError,
  mapLocationRoutingError,
  setLocationRoutingEnabled,
} from "@/lib/locationRouting";
import { registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import type { Location, LocationMember, Profile } from "@/types/database";

export type LocationMemberWithProfile = LocationMember & {
  profile?: Profile | null;
  primary_admin?: Profile | null;
};

interface UseTaskRoutingOptions {
  enabled?: boolean;
  includeMembers?: boolean;
}

interface TaskRoutingState {
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
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [members, setMembers] = useState<LocationMemberWithProfile[]>([]);

  const load = useCallback(async () => {
    if (!enabled) {
      setAvailable(false);
      setChecked(true);
      setLoading(false);
      setError(null);
      setLocations([]);
      setMembers([]);
      return;
    }

    setLoading(true);
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

    const [locationRes, memberRes] = await Promise.all([
      locationQuery,
      memberQuery ?? Promise.resolve({ data: [], error: null }),
    ]);

    const firstError = locationRes.error ?? memberRes.error;
    if (firstError) {
      if (isLocationRoutingMissingError(firstError)) {
        setAvailable(false);
        setError(LOCATION_ROUTING_REQUIRED_MESSAGE);
      } else {
        setAvailable(false);
        setError(mapLocationRoutingError(firstError));
        if (import.meta.env.DEV) console.warn("[task-routing] load failed", firstError);
      }
      setLocations([]);
      setMembers([]);
      setChecked(true);
      setLoading(false);
      return;
    }

    setAvailable(true);
    setLocations((locationRes.data ?? []) as Location[]);
    setMembers(
      ((memberRes.data ?? []) as LocationMemberWithProfile[]).map((member) => ({
        ...member,
        profile: member.profile ?? null,
        primary_admin: member.primary_admin ?? null,
      })),
    );
    setChecked(true);
    setLoading(false);
  }, [enabled, includeMembers, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled || !available) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void load();
      }, 250);
    };
    const channelName = "task-routing:locations";
    const channel = rt
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "location_members" }, debounced)
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[task-routing]", status);
      });
    registerChannel(channelName);
    return () => {
      if (timer) clearTimeout(timer);
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [enabled, available, rt, load]);

  return { available, checked, loading, error, locations, members, refetch: load };
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
