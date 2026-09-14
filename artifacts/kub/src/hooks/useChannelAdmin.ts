"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { mapPgError } from "@/lib/errors";
import {
  CHANNEL_NAME_MAX,
  nextPosition,
  normalizeChannelName,
  reorderPositions,
  type ChannelCategory,
  type ChannelKind,
  type ChatRole,
  type ServerChannel,
} from "@/lib/serverChannels";
import {
  CATEGORY_CREATE_FAILED,
  CATEGORY_REMOVE_FAILED,
  CHANNEL_CREATE_FAILED,
  CHANNEL_MOVE_FAILED,
  CHANNEL_REMOVE_FAILED,
  CHANNEL_SAVE_FAILED,
  channelWriteRefusalText,
  channelsReadFailureText,
  classifyChannelWriteError,
  normalizeSeatLimit,
} from "@/lib/serverChannelVocabulary";

/**
 * Everything that **changes** a group's channels.
 *
 * The rail reads; this writes. Both halves talk to the same three tables and
 * they are deliberately separate hooks, because the read runs on every open
 * conversation and the write runs only while an administrator has the
 * management dialog open — one subscription per group and one form's worth of
 * state have no business sharing a lifetime.
 *
 * The decisions are not here. The arrangement and the rules are in
 * `lib/serverChannels.ts`, the words are in `lib/serverChannelVocabulary.ts`,
 * and both import nothing that needs a browser, so `node --test` reaches every
 * branch of them. What is left in this file is the three reads, the nine
 * writes, and the local list that keeps the dialog honest between them.
 *
 * **`as any` on all three table names.** `voice_channels` and
 * `chat_channel_categories` are not in the generated database types at all, and
 * `topics.category_id` was added on 2026-09-14, after the schema those types
 * were generated from. It is the cast `useVoiceChannel`, `lib/achievements.ts`
 * and `lib/support/userTickets.ts` already use for exactly this reason.
 *
 * **Why the inserts may chain `.select()`.** PostgREST asks for the row back
 * with `Prefer: return=representation`, which needs the SELECT policy as well
 * as the INSERT one. On `content_reports` that is a production failure, because
 * its SELECT policy is staff-only. Here all three tables read
 * `members read …` = `is_chat_member(chat_id)`, and the author of any of these
 * writes passed `is_chat_admin(chat_id)` to make it — an administrator of a
 * chat is a member of it — so the row is readable by whoever just wrote it.
 * That is the whole argument, and it is written down rather than assumed
 * because the opposite case cost an hour on 2026-09-14.
 *
 * **Nothing here writes `voice_participants`.** It has no INSERT, UPDATE or
 * DELETE policy at all; every write to it would be refused. Who is in a room
 * arrives from the voice server's own webhooks, and removing a room does not
 * pretend otherwise — it archives the room and says nothing about the call.
 */

const CATEGORY_TABLE = "chat_channel_categories";
const TEXT_TABLE = "topics";
const VOICE_TABLE = "voice_channels";

function tableFor(kind: ChannelKind): string {
  return kind === "voice" ? VOICE_TABLE : TEXT_TABLE;
}

interface CategoryRow {
  id: string;
  name: string;
  position: number | null;
  created_at: string | null;
}

interface TopicRow {
  id: string;
  name: string;
  emoji: string | null;
  position: number | null;
  category_id: string | null;
  is_general: boolean | null;
  created_at: string | null;
}

interface VoiceRow {
  id: string;
  name: string;
  position: number | null;
  category_id: string | null;
  max_participants: number | null;
  speak_role: string | null;
  participant_count: number | null;
  created_at: string | null;
}

export interface ChannelAdminState {
  /** Whether the first read has come back, so an empty list is not drawn as «нет каналов». */
  ready: boolean;
  /**
   * The chat this answer was read for, and null before any read.
   *
   * The same guard `useVoiceChannel` carries and for the same reason: opening
   * another conversation changes `chatId` without clearing what is held, and a
   * decision made against the previous group's answer would rename or remove a
   * channel in a conversation nobody was looking at.
   */
  chatId: string | null;
  categories: ChannelCategory[];
  channels: ServerChannel[];
  /** False when this deployment has no `chat_channel_categories`; channels still work. */
  categoriesSupported: boolean;
  /** The read's own failure, already plain. Null when the read worked. */
  error: string | null;
  /** The last write's failure, already plain. Null when nothing has failed since. */
  writeError: string | null;
  /** Whether a write is in flight, so a second press cannot start a second one. */
  busy: boolean;
}

const EMPTY: ChannelAdminState = {
  ready: false,
  chatId: null,
  categories: [],
  channels: [],
  categoriesSupported: true,
  error: null,
  writeError: null,
  busy: false,
};

export interface CreateChannelInput {
  kind: ChannelKind;
  name: string;
  categoryId?: string | null;
}

export interface VoiceSettingsInput {
  /**
   * The seat field as it stands, which is a **string** while somebody is typing
   * into it — including the empty string and a lone minus.
   *
   * Deliberately not narrowed to a number, and deliberately not clamped by the
   * caller either. It used to be both: the dialog called `normalizeSeatLimit`
   * before handing the value over and this clamped it again, and a mutation
   * that replaced the clamp here with a bare `Number()` left every test green —
   * measured on 2026-09-14, which is redundancy rather than reach. One place
   * decides what number reaches the column, and it is the place that writes.
   */
  maxParticipants?: number | string | null;
  speakRole?: ChatRole | null;
}

export interface ChannelAdmin extends ChannelAdminState {
  createChannel: (input: CreateChannelInput) => Promise<ServerChannel | null>;
  renameChannel: (kind: ChannelKind, id: string, name: string) => Promise<boolean>;
  /** Puts a channel under a heading, or under none. */
  moveChannelToCategory: (kind: ChannelKind, id: string, categoryId: string | null) => Promise<boolean>;
  /** Archives it. Nothing is deleted — see `channelRemovalPrompt`. */
  removeChannel: (kind: ChannelKind, id: string) => Promise<boolean>;
  updateVoiceSettings: (id: string, settings: VoiceSettingsInput) => Promise<boolean>;
  createCategory: (name: string) => Promise<ChannelCategory | null>;
  renameCategory: (id: string, name: string) => Promise<boolean>;
  /** Deletes it. Its channels survive and lose their heading. */
  removeCategory: (id: string) => Promise<boolean>;
  /** Moves one row within the run it is drawn in, writing positions rather than indices. */
  reorderChannels: (siblings: readonly ServerChannel[], movedId: string, toIndex: number) => Promise<boolean>;
  reorderCategories: (movedId: string, toIndex: number) => Promise<boolean>;
  clearWriteError: () => void;
  refresh: () => void;
}

/**
 * The three ways PostgREST and Postgres say «that object is not here».
 *
 * Repeated from `classifyChannelWriteError` rather than shared, because that
 * one answers about a **write** and this one decides whether a failed *read* of
 * the categories is a deployment without the migration — a state this feature
 * is deliberately built to pass through, since the client and the migration are
 * two separate pieces of work and the group must stay manageable without
 * headings.
 */
function readIsMissingObject(error: { code?: string | null } | null): boolean {
  return classifyChannelWriteError(error) === "missing";
}

export function useChannelAdmin(chatId: string | null, enabled: boolean): ChannelAdmin {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<ChannelAdminState>(EMPTY);
  const [nonce, setNonce] = useState(0);
  /**
   * The chat the in-flight read belongs to.
   *
   * A write resolves after the read it raced, and without this a rename
   * finishing after the conversation changed would paste its row into another
   * group's list. Checked against `chatId` at every point a result is applied.
   */
  const liveChatId = useRef<string | null>(null);
  liveChatId.current = chatId;

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const clearWriteError = useCallback(
    () => setState((held) => (held.writeError === null ? held : { ...held, writeError: null })),
    [],
  );

  useEffect(() => {
    if (!enabled || !chatId) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;

    void (async () => {
      const [categoryRead, textRead, voiceRead] = await Promise.all([
        supabase
          .from(CATEGORY_TABLE as any)
          .select("id,name,position,created_at")
          .eq("chat_id", chatId)
          .order("position", { ascending: true }),
        supabase
          .from(TEXT_TABLE as any)
          .select("id,name,emoji,position,category_id,is_general,created_at")
          .eq("chat_id", chatId)
          .eq("archived", false)
          .order("position", { ascending: true }),
        supabase
          .from(VOICE_TABLE as any)
          .select("id,name,position,category_id,max_participants,speak_role,participant_count,created_at")
          .eq("chat_id", chatId)
          .eq("archived", false)
          .order("position", { ascending: true }),
      ]);
      if (cancelled) return;

      // A missing categories table is not a failure of this screen: the channels
      // are still readable and still manageable, they simply cannot be grouped.
      const categoriesMissing = Boolean(categoryRead.error) && readIsMissingObject(categoryRead.error);
      const fatal = textRead.error ?? voiceRead.error ?? (categoriesMissing ? null : categoryRead.error);
      if (fatal) {
        console.error("[channels] read failed.", fatal.code ?? "", fatal.message ?? "");
        setState({
          ...EMPTY,
          ready: true,
          chatId,
          error: channelsReadFailureText(mapPgError(fatal)),
        });
        return;
      }

      setState({
        ready: true,
        chatId,
        categoriesSupported: !categoriesMissing,
        categories: ((categoryRead.data as unknown as CategoryRow[] | null) ?? []).map(toCategory),
        channels: [
          ...((textRead.data as unknown as TopicRow[] | null) ?? []).map(toTextChannel),
          ...((voiceRead.data as unknown as VoiceRow[] | null) ?? []).map(toVoiceChannel),
        ],
        error: null,
        writeError: null,
        busy: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, enabled, nonce, supabase]);

  /**
   * One write, with the busy flag, the log and the plain sentence around it.
   *
   * Every mutation below goes through this, so none of them can forget to clear
   * `busy` on a failure — which is the shape of bug that leaves a dialog
   * permanently unable to do anything and looks like a dead button.
   */
  const run = useCallback(
    async <T,>(
      failedLabel: string,
      work: () => Promise<{ value: T; error: unknown }>,
    ): Promise<T | null> => {
      const startedFor = liveChatId.current;
      setState((held) => ({ ...held, busy: true, writeError: null }));
      let result: { value: T; error: unknown };
      try {
        result = await work();
      } catch (thrown) {
        result = { value: null as T, error: thrown };
      }
      if (liveChatId.current !== startedFor) return null;
      if (result.error) {
        const error = result.error as { code?: string; message?: string };
        console.error("[channels] write failed.", error?.code ?? "", error?.message ?? "");
        const text = channelWriteRefusalText(
          classifyChannelWriteError(result.error),
          failedLabel,
          mapPgError(result.error as never),
        );
        setState((held) => ({ ...held, busy: false, writeError: text }));
        return null;
      }
      setState((held) => ({ ...held, busy: false, writeError: null }));
      return result.value;
    },
    [],
  );

  const createChannel = useCallback(
    async (input: CreateChannelInput): Promise<ServerChannel | null> => {
      const name = normalizeChannelName(input.name);
      if (!chatId || !name) return null;
      const kind = input.kind;
      const siblings = state.channels.filter((channel) => channel.kind === kind);
      const row = {
        chat_id: chatId,
        name,
        position: nextPosition(siblings),
        category_id: state.categoriesSupported ? input.categoryId ?? null : null,
      };
      const created = await run<ServerChannel | null>(CHANNEL_CREATE_FAILED, async () => {
        const { data, error } = await supabase
          .from(tableFor(kind) as any)
          .insert(row as any)
          .select(
            kind === "voice"
              ? "id,name,position,category_id,max_participants,speak_role,participant_count,created_at"
              : "id,name,emoji,position,category_id,is_general,created_at",
          )
          .single();
        if (error || !data) return { value: null, error };
        return {
          value: kind === "voice"
            ? toVoiceChannel(data as unknown as VoiceRow)
            : toTextChannel(data as unknown as TopicRow),
          error: null,
        };
      });
      if (created) setState((held) => ({ ...held, channels: [...held.channels, created] }));
      return created;
    },
    [chatId, run, state.categoriesSupported, state.channels, supabase],
  );

  const renameChannel = useCallback(
    async (kind: ChannelKind, id: string, name: string): Promise<boolean> => {
      const next = normalizeChannelName(name);
      if (!next) return false;
      const done = await run(CHANNEL_SAVE_FAILED, async () => {
        const { error } = await supabase
          .from(tableFor(kind) as any)
          .update({ name: next, updated_at: new Date().toISOString() } as any)
          .eq("id", id);
        return { value: !error, error };
      });
      if (done) {
        setState((held) => ({
          ...held,
          channels: held.channels.map((channel) =>
            channel.id === id && channel.kind === kind ? { ...channel, name: next } : channel,
          ),
        }));
      }
      return done === true;
    },
    [run, supabase],
  );

  const moveChannelToCategory = useCallback(
    async (kind: ChannelKind, id: string, categoryId: string | null): Promise<boolean> => {
      const done = await run(CHANNEL_SAVE_FAILED, async () => {
        const { error } = await supabase
          .from(tableFor(kind) as any)
          .update({ category_id: categoryId, updated_at: new Date().toISOString() } as any)
          .eq("id", id);
        return { value: !error, error };
      });
      if (done) {
        setState((held) => ({
          ...held,
          channels: held.channels.map((channel) =>
            channel.id === id && channel.kind === kind ? { ...channel, categoryId } : channel,
          ),
        }));
      }
      return done === true;
    },
    [run, supabase],
  );

  const removeChannel = useCallback(
    async (kind: ChannelKind, id: string): Promise<boolean> => {
      // `archived = true`, never a DELETE. The product already removes a topic
      // this way (`useTopics.archiveTopic`), `buildChannelTree` already filters
      // on it, and it is what lets the question promise the messages survive.
      const done = await run(CHANNEL_REMOVE_FAILED, async () => {
        const { error } = await supabase
          .from(tableFor(kind) as any)
          .update({ archived: true, updated_at: new Date().toISOString() } as any)
          .eq("id", id);
        return { value: !error, error };
      });
      if (done) {
        setState((held) => ({
          ...held,
          channels: held.channels.filter((channel) => !(channel.id === id && channel.kind === kind)),
        }));
      }
      return done === true;
    },
    [run, supabase],
  );

  const updateVoiceSettings = useCallback(
    async (id: string, settings: VoiceSettingsInput): Promise<boolean> => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const seats =
        settings.maxParticipants === undefined ? null : normalizeSeatLimit(settings.maxParticipants);
      if (seats !== null) patch.max_participants = seats;
      if (settings.speakRole) patch.speak_role = settings.speakRole;
      const done = await run(CHANNEL_SAVE_FAILED, async () => {
        const { error } = await supabase
          .from(VOICE_TABLE as any)
          .update(patch as any)
          .eq("id", id);
        return { value: !error, error };
      });
      if (done) {
        setState((held) => ({
          ...held,
          channels: held.channels.map((channel) =>
            channel.id === id && channel.kind === "voice"
              ? {
                  ...channel,
                  maxParticipants: seats ?? channel.maxParticipants,
                  speakRole: settings.speakRole ?? channel.speakRole,
                }
              : channel,
          ),
        }));
      }
      return done === true;
    },
    [run, supabase],
  );

  const createCategory = useCallback(
    async (name: string): Promise<ChannelCategory | null> => {
      const next = normalizeChannelName(name);
      if (!chatId || !next) return null;
      const created = await run<ChannelCategory | null>(CATEGORY_CREATE_FAILED, async () => {
        const { data, error } = await supabase
          .from(CATEGORY_TABLE as any)
          .insert({ chat_id: chatId, name: next, position: nextPosition(state.categories) } as any)
          .select("id,name,position,created_at")
          .single();
        if (error || !data) return { value: null, error };
        return { value: toCategory(data as unknown as CategoryRow), error: null };
      });
      if (created) setState((held) => ({ ...held, categories: [...held.categories, created] }));
      return created;
    },
    [chatId, run, state.categories, supabase],
  );

  const renameCategory = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const next = normalizeChannelName(name);
      if (!next) return false;
      const done = await run(CHANNEL_SAVE_FAILED, async () => {
        const { error } = await supabase
          .from(CATEGORY_TABLE as any)
          .update({ name: next, updated_at: new Date().toISOString() } as any)
          .eq("id", id);
        return { value: !error, error };
      });
      if (done) {
        setState((held) => ({
          ...held,
          categories: held.categories.map((category) =>
            category.id === id ? { ...category, name: next } : category,
          ),
        }));
      }
      return done === true;
    },
    [run, supabase],
  );

  const removeCategory = useCallback(
    async (id: string): Promise<boolean> => {
      const done = await run(CATEGORY_REMOVE_FAILED, async () => {
        const { error } = await supabase.from(CATEGORY_TABLE as any).delete().eq("id", id);
        return { value: !error, error };
      });
      if (done) {
        // `on delete set null (category_id)` does this in the database; doing
        // the same locally is what stops the rows vanishing from the dialog for
        // the moment before the next read. They belong in «Без раздела» now.
        setState((held) => ({
          ...held,
          categories: held.categories.filter((category) => category.id !== id),
          channels: held.channels.map((channel) =>
            channel.categoryId === id ? { ...channel, categoryId: null } : channel,
          ),
        }));
      }
      return done === true;
    },
    [run, supabase],
  );

  const reorderChannels = useCallback(
    async (siblings: readonly ServerChannel[], movedId: string, toIndex: number): Promise<boolean> => {
      const writes = reorderPositions(siblings, movedId, toIndex);
      // A drag that landed where it started. `reorderPositions` returns the rows
      // that actually change, so this is the whole of «write nothing».
      if (writes.length === 0) return true;
      const kindById = new Map(siblings.map((channel) => [channel.id, channel.kind]));
      const done = await run(CHANNEL_MOVE_FAILED, async () => {
        for (const write of writes) {
          const kind = kindById.get(write.id) ?? "text";
          const { error } = await supabase
            .from(tableFor(kind) as any)
            .update({ position: write.position, updated_at: new Date().toISOString() } as any)
            .eq("id", write.id);
          if (error) return { value: false, error };
        }
        return { value: true, error: null };
      });
      if (done) {
        const byId = new Map(writes.map((write) => [write.id, write.position]));
        setState((held) => ({
          ...held,
          channels: held.channels.map((channel) =>
            byId.has(channel.id) ? { ...channel, position: byId.get(channel.id)! } : channel,
          ),
        }));
      } else {
        // A reorder is several writes and stops at the first that fails, so the
        // run can be half renumbered. Showing the order the person asked for
        // would then be a lie, and showing the order they started from would be
        // a different one; the only honest answer is to read it back.
        refresh();
      }
      return done === true;
    },
    [refresh, run, supabase],
  );

  const reorderCategories = useCallback(
    async (movedId: string, toIndex: number): Promise<boolean> => {
      const ordered = [...state.categories].sort((a, b) => a.position - b.position);
      const writes = reorderPositions(ordered, movedId, toIndex);
      if (writes.length === 0) return true;
      const done = await run(CHANNEL_MOVE_FAILED, async () => {
        for (const write of writes) {
          const { error } = await supabase
            .from(CATEGORY_TABLE as any)
            .update({ position: write.position, updated_at: new Date().toISOString() } as any)
            .eq("id", write.id);
          if (error) return { value: false, error };
        }
        return { value: true, error: null };
      });
      if (done) {
        const byId = new Map(writes.map((write) => [write.id, write.position]));
        setState((held) => ({
          ...held,
          categories: held.categories.map((category) =>
            byId.has(category.id) ? { ...category, position: byId.get(category.id)! } : category,
          ),
        }));
      } else {
        refresh();
      }
      return done === true;
    },
    [refresh, run, state.categories, supabase],
  );

  return {
    ...state,
    createChannel,
    renameChannel,
    moveChannelToCategory,
    removeChannel,
    updateVoiceSettings,
    createCategory,
    renameCategory,
    removeCategory,
    reorderChannels,
    reorderCategories,
    clearWriteError,
    refresh,
  };
}

export { CHANNEL_NAME_MAX };

function toCategory(row: CategoryRow): ChannelCategory {
  return {
    id: row.id,
    name: row.name,
    position: row.position ?? 0,
    createdAt: row.created_at,
  };
}

function toTextChannel(row: TopicRow): ServerChannel {
  return {
    id: row.id,
    kind: "text",
    name: row.name,
    position: row.position ?? 0,
    categoryId: row.category_id ?? null,
    createdAt: row.created_at,
    emoji: row.emoji,
    isGeneral: row.is_general === true,
  };
}

/**
 * `speak_role` is read back as whatever the column holds, and anything that is
 * not one of the three is treated as the column's default rather than kept.
 *
 * The enum cannot hold a fourth value, so this branch exists for the row read
 * from a deployment where the column is absent — where the answer is null and
 * «all members may speak» is the right reading of it.
 */
function toVoiceChannel(row: VoiceRow): ServerChannel {
  const role = row.speak_role;
  return {
    id: row.id,
    kind: "voice",
    name: row.name,
    position: row.position ?? 0,
    categoryId: row.category_id ?? null,
    createdAt: row.created_at,
    maxParticipants: row.max_participants,
    speakRole: role === "owner" || role === "admin" || role === "member" ? role : "member",
    participantCount: row.participant_count ?? 0,
  };
}
