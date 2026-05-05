import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

let instance: ReturnType<typeof createBrowserClient<Database>> | null = null

export function createClient() {
  if (!instance) {
    instance = createBrowserClient<Database>(URL, KEY)

    // When the session token is refreshed (or user signs in/out),
    // update the Realtime connection so it uses the new JWT.
    // This fixes Realtime dropping with CHANNEL_ERROR on Vercel
    // where the middleware refreshes cookies but the singleton
    // Realtime socket still holds the old expired token.
    instance.auth.onAuthStateChange((event, session) => {
      if (!instance) return
      if (session?.access_token) {
        instance.realtime.setAuth(session.access_token)
      } else if (event === 'SIGNED_OUT') {
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
