import { useEffect, useMemo, useState } from "react";

import { loadBotCommands } from "@/lib/botCallback";
import { createClient } from "@/lib/supabase/client";
import type { BotCommand } from "@/lib/botChatSurfaces";
import type { BotProfileSeed } from "@/lib/botProfile";
import {
  PROFILE_FRESHNESS_MS,
  profileRequestDecision,
  type ProfileCacheEntry,
} from "@/lib/profileCache";

/**
 * One bot, read once for every surface that draws it (D-263).
 *
 * Deliberately the same arrangement as `useUserProfile`, down to the module
 * held maps and the 60-second window, and the decision it asks is literally
 * the same function: `profileRequestDecision` in `lib/profileCache.ts`. That
 * module's header records why Discord's two profile surfaces never disagree —
 * one store, one fetch path, an in-flight gate and `Date.now() - fetchEndedAt
 * >= 6e4` — and the moment a second kind of card appeared here, the cheapest
 * way to inherit that property was to inherit the rule rather than to write a
 * second one beside it.
 *
 * **Two reads, both allowed to an ordinary account**, and both already used
 * elsewhere in the product:
 *
 *   - `public.bots`, whose SELECT policy admits anyone sharing a live chat
 *     with the bot **whatever its state** — which is what lets a disabled
 *     bot's name stay readable to the people it was talking to, and why the
 *     card names the state rather than hiding the bot (D-247);
 *   - `public.bot_commands`, through `loadBotCommands`, under «members and
 *     owners read bot commands».
 *
 * Nothing streams. No bot table is in the `supabase_realtime` publication, so
 * a bot that replaces its commands is seen the next time the card is opened —
 * the same fact `useBotChat` records, and the same reason not to poll.
 */

interface BotProfileRecord {
  readonly row: BotProfileSeed | null;
  readonly commands: readonly BotCommand[];
}

const cache = new Map<string, ProfileCacheEntry<BotProfileRecord>>();
const pending = new Map<string, Promise<void>>();
let revision = 0;
const listeners = new Set<() => void>();

function announce(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

/**
 * The `bots` row, read loosely for the reason `botCallback.ts` states: the bot
 * tables are outside the generated types, and asserting a shape a generator
 * never saw is worse than parsing what arrives.
 */
function readBotRow(value: unknown): BotProfileSeed | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : null;
  const username = typeof row.username === "string" ? row.username.trim() : "";
  const displayName = typeof row.display_name === "string" ? row.display_name : "";
  if (!id || !username) return null;
  return {
    id,
    username,
    display_name: displayName,
    description: typeof row.description === "string" ? row.description : null,
    avatar_url: typeof row.avatar_url === "string" ? row.avatar_url : null,
    state: typeof row.state === "string" ? row.state : null,
  };
}

async function loadBot(botId: string): Promise<void> {
  const supabase = createClient() as unknown as {
    from(table: string): {
      select(columns: string): {
        eq(column: string, value: string): {
          maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
  try {
    const [rowAnswer, commands] = await Promise.all([
      supabase.from("bots").select("id,username,display_name,description,avatar_url,state").eq("id", botId).maybeSingle(),
      loadBotCommands(botId),
    ]);
    if (rowAnswer.error) {
      console.error("useBotProfile read error:", rowAnswer.error);
      cache.set(botId, { profile: null, failed: true, fetchedAt: Date.now() });
      return;
    }
    const row = readBotRow(rowAnswer.data);
    // A refusal and an absence are the same shape under row-level security, so
    // neither is claimed: the card falls back to what the opener handed it, and
    // says the unavailable sentence only when there was nothing to fall back on.
    cache.set(botId, { profile: { row, commands }, failed: false, fetchedAt: Date.now() });
  } finally {
    pending.delete(botId);
    announce();
  }
}

function requestBot(botId: string | null): void {
  const decision = profileRequestDecision({
    userId: botId,
    entry: botId ? cache.get(botId) : undefined,
    inFlight: botId ? pending.has(botId) : false,
    now: Date.now(),
  });
  if (decision !== "fetch" || !botId) return;
  pending.set(botId, loadBot(botId));
}

export interface BotProfileState {
  /** The `bots` row, or null while it is on its way or was refused. */
  readonly row: BotProfileSeed | null;
  readonly commands: readonly BotCommand[];
  /** Whether an answer — or a refusal — has arrived. */
  readonly settled: boolean;
  readonly failed: boolean;
}

export function useBotProfile(botId: string | null): BotProfileState {
  const [, setRevision] = useState(revision);

  useEffect(() => {
    const listener = () => setRevision(revision);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    requestBot(botId);
    if (!botId) return;
    const entry = cache.get(botId);
    if (!entry) return;
    const left = PROFILE_FRESHNESS_MS - (Date.now() - entry.fetchedAt);
    if (left <= 0) return;
    const timer = window.setTimeout(() => requestBot(botId), left + 1);
    return () => window.clearTimeout(timer);
  }, [botId, revision]);

  return useMemo(() => {
    if (!botId) return { row: null, commands: [], settled: false, failed: false };
    const entry = cache.get(botId);
    if (!entry) return { row: null, commands: [], settled: false, failed: false };
    return {
      row: entry.profile?.row ?? null,
      commands: entry.profile?.commands ?? [],
      settled: true,
      failed: entry.failed,
    };
  }, [botId, revision]);
}

/** For tests and for a sign-out, which must not leave one account's reads behind. */
export function forgetBotProfiles(): void {
  cache.clear();
  pending.clear();
  announce();
}
