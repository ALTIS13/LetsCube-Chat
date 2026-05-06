import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { clearPasswordRecoveryFlow, markPasswordRecoveryFlow } from '@/lib/authRecovery'

// Read Supabase config from Vite env vars.
// Accept both the new `VITE_SUPABASE_PUBLISHABLE_KEY` name and the legacy
// `VITE_SUPABASE_ANON_KEY` so the app keeps working regardless of which
// secret name is configured in Replit.
const env = import.meta.env as Record<string, string | undefined>
const SUPABASE_URL = env.VITE_SUPABASE_URL
const SUPABASE_KEY =
  env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  // eslint-disable-next-line no-console
  console.error(
    "Missing Supabase environment variables. " +
      "Set VITE_SUPABASE_URL and either VITE_SUPABASE_PUBLISHABLE_KEY " +
      "(preferred) or VITE_SUPABASE_ANON_KEY in Replit Secrets."
  )
}

let instance: SupabaseClient<Database> | null = null

export function createClient(): SupabaseClient<Database> {
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
          detectSessionInUrl: true,
          storage:
            typeof window !== "undefined" ? window.localStorage : undefined,
          storageKey: "kub-auth",
        },
      }
    )

    // Keep the Realtime WebSocket auth in sync with the current session.
    instance.auth.onAuthStateChange((event, session) => {
      if (!instance) return
      if (event === "PASSWORD_RECOVERY") {
        markPasswordRecoveryFlow()
      }
      if (session?.access_token) {
        instance.realtime.setAuth(session.access_token)
      } else if (event === "SIGNED_OUT") {
        clearPasswordRecoveryFlow()
        instance.realtime.setAuth(null)
      }
    })
  }
  return instance
}

export function getRealtimeClient() {
  return createClient()
}

export function setRealtimeToken(_token: string) {}
