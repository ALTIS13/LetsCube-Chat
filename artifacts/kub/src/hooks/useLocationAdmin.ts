"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";

/**
 * `public.is_location_admin(p_location_id, auth.uid())`, asked of the database.
 *
 * This one is **not** copied into the client, and that is a decision rather
 * than an omission. Read off production on 2026-09-15:
 *
 *     is_location_admin(loc, uid) =
 *         has_permission(uid, 'locations.manage')
 *      or has_location_permission(uid, loc, 'location_members.manage')
 *      or exists (select 1 from location_members lm
 *                  where lm.location_id = loc and lm.user_id = uid
 *                    and lm.role in ('owner', 'admin', 'manager'))
 *
 * The third branch reads the legacy `location_members.role` **text** column,
 * which no permission lookup reaches and which `useAccessSnapshot` does not
 * carry — the snapshot holds global role keys, global permission keys and
 * per-location permission keys, and nothing else. Measured over the ten people
 * who hold a location membership, the branches disagree:
 *
 *     person | location role    | is_location_admin | location_members.manage
 *     3e7836d4 | location_admin   | t               | t
 *     f31ebd8e | location_manager | t               | f   <-- legacy branch only
 *     3adfd4e6 | location_staff   | f               | f
 *
 * So a client predicate built out of the permission keys would hide a control
 * from `f31ebd8e` that the database would accept — the narrow half of the same
 * mistake `lib/serverRoleAccess.ts` was written to stop. The function is
 * `security definer` and granted to `authenticated`, so asking it is both
 * cheaper and more truthful than mirroring it.
 *
 * `enabled` is how a caller says the question does not arise — a task with no
 * location, or no task loaded yet. A disabled hook asks nothing and answers
 * `false`, which is what `task_update_v3` does with a null location too.
 */
export function useIsLocationAdmin(
  locationId: string | null | undefined,
  options: { enabled?: boolean } = {},
): { isLocationAdmin: boolean; checking: boolean } {
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const supabase = useMemo(() => createClient(), []);
  const enabled = options.enabled ?? true;
  const location = locationId ?? null;
  const shouldAsk = Boolean(enabled && currentUserId && location);

  const [state, setState] = useState<{ isLocationAdmin: boolean; checking: boolean }>({
    isLocationAdmin: false,
    checking: shouldAsk,
  });

  useEffect(() => {
    let cancelled = false;

    if (!shouldAsk || !currentUserId || !location) {
      setState({ isLocationAdmin: false, checking: false });
      return () => {
        cancelled = true;
      };
    }

    setState((previous) => ({ ...previous, checking: true }));

    supabase
      .rpc("is_location_admin", { p_location_id: location, p_user_id: currentUserId })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // A refused read is not a "no". It is an unknown, and the honest
          // rendering of an unknown control is to leave it out rather than to
          // claim the person lacks the right (D-140 / D-198). `false` is what
          // this hook can say; the refusal is reported so a caller can keep
          // waiting instead of drawing a conclusion.
          if (import.meta.env.DEV) console.warn("[location-admin] lookup failed", error);
          setState({ isLocationAdmin: false, checking: false });
          return;
        }
        setState({ isLocationAdmin: data === true, checking: false });
      });

    return () => {
      cancelled = true;
    };
  }, [currentUserId, location, shouldAsk, supabase]);

  return state;
}
