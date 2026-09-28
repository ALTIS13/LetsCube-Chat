import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolveSupabaseConfig, type SupabasePublicEnv } from './config'
import { createDeadlineFetch } from './deadlineFetch'

// Read Supabase config from Vite env vars.
// Accept both the new `VITE_SUPABASE_PUBLISHABLE_KEY` name and the legacy
// `VITE_SUPABASE_ANON_KEY` so the app keeps working regardless of which
// secret name is configured in Replit.
//
// The resolution itself lives in `./config`, which imports nothing and is
// therefore reachable from the unit suite; see the note there for what went
// untested while it was inline here.
const { url: SUPABASE_URL, key: SUPABASE_KEY, configured: SUPABASE_CONFIGURED } =
  resolveSupabaseConfig(import.meta.env as SupabasePublicEnv)

const MISSING_SUPABASE_CONFIG_ERROR =
  "Supabase runtime configuration is missing. Build the app with the public Supabase URL and publishable key."

export function isSupabaseConfigured(): boolean {
  return SUPABASE_CONFIGURED
}

export function getSupabasePublicUrl(): string {
  if (!SUPABASE_URL) {
    throw new Error(MISSING_SUPABASE_CONFIG_ERROR)
  }
  return SUPABASE_URL
}

export function getSupabasePublishableKey(): string {
  if (!SUPABASE_KEY) {
    throw new Error(MISSING_SUPABASE_CONFIG_ERROR)
  }
  return SUPABASE_KEY
}

let instance: SupabaseClient<Database> | null = null

// Every request the client makes gets a deadline, and a network change can cut
// the reads it stranded (tracker item 53). The platform's `fetch` is looked up
// at each call, as supabase-js does when it is given none: whatever replaces
// `window.fetch` later — a test's interceptor, a monitoring shim — is still the
// one that runs.
const deadlineFetch = createDeadlineFetch(
  ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch,
)

/** Cuts the reads a change of network stranded; see `useConnectionRevival`. */
export function cutStrandedReads(): number {
  return deadlineFetch.cutStrandedReads()
}

export function createClient(): SupabaseClient<Database> {
  if (!isSupabaseConfigured()) {
    throw new Error(MISSING_SUPABASE_CONFIG_ERROR)
  }
  if (!instance) {
    // Use the standard supabase-js browser client.
    //
    // We deliberately do NOT use `@supabase/ssr` `createBrowserClient` here —
    // that one persists the session in cookies, which get blocked as
    // third-party cookies when the app runs inside an iframe (Replit preview,
    // embeds, etc). The standard client uses `localStorage`, which is
    // partitioned per-origin and works inside iframes.
    instance = createSupabaseClient<Database>(
      SUPABASE_URL ?? "",
      SUPABASE_KEY ?? "",
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storage:
            typeof window !== "undefined" ? window.localStorage : undefined,
          storageKey: "kub-auth",
        },
        global: { fetch: deadlineFetch },
      }
    )

    // Keep the Realtime WebSocket auth in sync with the current session.
    instance.auth.onAuthStateChange((event, session) => {
      if (!instance) return
      if (session?.access_token) {
        instance.realtime.setAuth(session.access_token)
      } else if (event === "SIGNED_OUT") {
        instance.realtime.setAuth(null)
      }
    })
  }
  return instance
}

export function createNonPersistedAuthClient(): SupabaseClient<Database> {
  if (!isSupabaseConfigured()) {
    throw new Error(MISSING_SUPABASE_CONFIG_ERROR)
  }
  return createSupabaseClient<Database>(SUPABASE_URL ?? "", SUPABASE_KEY ?? "", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

export function getRealtimeClient() {
  return createClient()
}

export function setRealtimeToken(_token: string) {}
