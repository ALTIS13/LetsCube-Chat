"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The one authenticated identity observed by the configured application root.
 *
 * This context never talks to Supabase. `App.tsx` owns the sole `useUser()`
 * observer and publishes only the stable facts runtime services need. Voice
 * transport, resume and future public-route services consume this snapshot
 * instead of creating another `getSession()` call or auth subscription.
 */
export interface AuthRuntimeSnapshot {
  userId: string | null;
  loading: boolean;
}

const UNKNOWN_AUTH_RUNTIME: AuthRuntimeSnapshot = Object.freeze({
  userId: null,
  loading: true,
});

const AuthRuntimeContext = createContext<AuthRuntimeSnapshot>(UNKNOWN_AUTH_RUNTIME);

export function AuthRuntimeProvider({
  snapshot,
  children,
}: {
  snapshot: AuthRuntimeSnapshot;
  children: ReactNode;
}) {
  return <AuthRuntimeContext.Provider value={snapshot}>{children}</AuthRuntimeContext.Provider>;
}

export function useAuthRuntime(): AuthRuntimeSnapshot {
  return useContext(AuthRuntimeContext);
}
