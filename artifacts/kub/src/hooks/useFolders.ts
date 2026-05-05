"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import type { Folder, FolderScope, AppRole } from "@/types/database";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Translate a Supabase / Postgres / fetch error into a friendly Russian
 * message.  We split three buckets so the user sees the right next step:
 *
 *   1. `TypeError: Failed to fetch` → network/CORS/preview-iframe issue,
 *      direct them to open the app in a separate window.
 *   2. PostgREST 42501 (or any "row-level security" wording) → RLS
 *      rejection, tell them they don't have rights for this folder.
 *   3. Anything else → generic "couldn't do it" with the raw message
 *      appended for the dev console.
 */
type FolderOp = "create" | "update" | "delete" | "add" | "remove";

/**
 * Operation-aware friendly fallback messages.  Used as the last-resort
 * Russian copy when an error doesn't match any of the known buckets
 * (network / RLS / duplicate).  Picking the verb based on the actual
 * operation makes the toast far more diagnostic for the user.
 */
const FALLBACK_BY_OP: Record<FolderOp, string> = {
  create: "Не удалось создать папку. Проверьте подключение и попробуйте снова.",
  update: "Не удалось обновить папку. Проверьте подключение и попробуйте снова.",
  delete: "Не удалось удалить папку. Проверьте подключение и попробуйте снова.",
  add: "Не удалось добавить чат в папку. Проверьте подключение и права доступа.",
  remove: "Не удалось удалить чат из папки. Проверьте подключение и попробуйте снова.",
};

function friendlyFolderError(err: unknown, op?: FolderOp): string {
  const fallback = op ? FALLBACK_BY_OP[op] : "Не удалось выполнить действие. Попробуйте ещё раз.";
  if (!err) return fallback;
  // Plain network failure thrown by fetch() — supabase-js rethrows these
  // as TypeError instances rather than turning them into a postgrest
  // `error` shape, so they show up in `catch`, not in `{ data, error }`.
  if (err instanceof TypeError && /fetch/i.test(err.message ?? "")) {
    if (op === "add") {
      return "Сетевой сбой при добавлении чата в папку. Откройте приложение в отдельном окне и попробуйте снова.";
    }
    return "Сетевой сбой. Откройте приложение в отдельном окне и попробуйте снова.";
  }
  const e = err as { message?: string; code?: string };
  if (e.code === "42501" || /row-level security|permission|policy|denied/i.test(e.message ?? "")) {
    return "Недостаточно прав для действия с этой папкой.";
  }
  if (e.code === "23505" || /duplicate key|unique constraint/i.test(e.message ?? "")) {
    // Race with another tab/user adding the same chat — silently OK,
    // but if it bubbles up here treat it as a soft success message.
    return "Этот чат уже в папке.";
  }
  // Catch-all: keep the surface-level message in Russian so the user
  // never sees raw English Postgres / fetch errors.  The original error
  // is already logged to the console by the caller for debugging.
  return fallback;
}

/**
 * Sidebar folders — both PERSONAL (owner-only) and SHARED (visible to
 * everyone who is a member of at least one chat the folder contains).
 *
 * RLS does the heavy lifting on the server: this hook just selects every
 * `folders` row the current user can see and orders them.
 *
 * folderChats[folderId] is a Set of chat ids currently in that folder.
 * The Set form is convenient for fast membership checks when filtering
 * the chat list.
 */
export function useFolders() {
  const supabase = createClient();
  const rt = getRealtimeClient();
  // Узкие per-field селекторы: подписываемся ТОЛЬКО на нужные примитивы.
  // С учётом shallow-eq в `setCurrentUser` heartbeat-эхо не меняет ни id,
  // ни role, поэтому эти селекторы не будят useFolders без значимых
  // изменений. Это полностью соответствует анти-шторм паттерну Task #48
  // (primitive-only dependencies).
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const role = useAppStore((s) => s.currentUser?.role ?? null) as AppRole | null;
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderChats, setFolderChats] = useState<Record<string, Set<string>>>({});
  /** Last user-facing error from a mutation; cleared on the next successful op. */
  const [lastError, setLastError] = useState<string | null>(null);

  const isStaff = role === "admin" || role === "manager";

  const fetchFolders = useCallback(async () => {
    if (!userId) {
      setFolders([]);
      setFolderChats({});
      return;
    }
    bumpFetch("useFolders");
    // No `.eq("user_id", ...)`: RLS already gates personal vs shared
    // visibility, and we WANT shared folders that aren't ours to come back.
    const { data: foldersData } = await supabase
      .from("folders")
      .select("*")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    const list = (foldersData ?? []) as Folder[];
    // Avoid re-rendering consumers if the folder list didn't actually
    // change (common: realtime echo of our own insert).
    setFolders((prev) => {
      if (prev.length === list.length && prev.every((f, i) => f.id === list[i].id && f.position === list[i].position && f.name === list[i].name && f.emoji === list[i].emoji && f.scope === list[i].scope)) {
        return prev;
      }
      return list;
    });

    if (!list.length) { setFolderChats({}); return; }
    const { data: fcData } = await supabase
      .from("folder_chats")
      .select("folder_id, chat_id")
      .in("folder_id", list.map((f) => f.id));
    const map: Record<string, Set<string>> = {};
    for (const f of list) map[f.id] = new Set();
    for (const fc of (fcData ?? [])) map[fc.folder_id]?.add(fc.chat_id);
    setFolderChats(map);
  }, [userId, supabase]);

  // Stable ref to the latest fetcher so the realtime effect doesn't
  // resubscribe every time `fetchFolders` identity rotates.
  const fetchRef = useRef(fetchFolders);
  useEffect(() => { fetchRef.current = fetchFolders; }, [fetchFolders]);

  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  // Realtime — we listen to folders, folder_chats AND chat_members because
  // shared-folder visibility derives from chat membership.  When someone
  // is added to a chat that belongs to a shared folder, that folder must
  // immediately appear in their sidebar.
  //
  // Bursts of events (e.g. "save 20 chats into a folder") are coalesced
  // into a single delayed refetch so we don't slam Postgres with 20
  // back-to-back SELECTs and trigger UI lag.
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { fetchRef.current(); }, 300);
    };
    const channelName = `folders:${userId}`;
    const ch = rt.channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "folders" }, debouncedRefetch)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "folders" }, debouncedRefetch)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "folders" }, debouncedRefetch)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "folder_chats" }, debouncedRefetch)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "folder_chats" }, debouncedRefetch)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_members" }, debouncedRefetch)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_members" }, debouncedRefetch)
      .subscribe();
    registerChannel(channelName);
    return () => {
      if (timer) clearTimeout(timer);
      rt.removeChannel(ch);
      unregisterChannel(channelName);
    };
  }, [userId, rt]);

  // ── Permission helpers ──────────────────────────────────────────────────
  /**
   * True if the current user can rename / delete / change the chat list of
   * the given folder.  Mirrors the RLS matrix in 20260504_folders_shared.sql
   * so the UI can disable destructive actions before the server has to
   * reject them.
   */
  const canManageFolder = useCallback((folder: Folder): boolean => {
    if (!userId) return false;
    const creator = folder.created_by ?? folder.user_id;
    if (folder.scope === "personal") return folder.user_id === userId;
    if (folder.scope === "shared") return isStaff || creator === userId;
    if (folder.scope === "system") return role === "admin";
    return false;
  }, [userId, isStaff, role]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const createFolder = useCallback(async (
    name: string,
    emoji: string | null = null,
    scope: FolderScope = "personal",
  ): Promise<Folder | null> => {
    if (!userId) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (scope !== "personal" && !isStaff) {
      setLastError("Создавать общие папки могут только администраторы и менеджеры.");
      return null;
    }
    // Position is per-creator; for shared folders we still use the creator's
    // sequence so existing personal folders don't get renumbered.
    const ownPositions = folders
      .filter((f) => f.user_id === userId)
      .map((f) => f.position);
    const nextPosition = ownPositions.length ? Math.max(...ownPositions) + 1 : 0;
    try {
      const { data, error } = await supabase
        .from("folders")
        .insert({
          user_id: userId,
          created_by: userId,
          scope,
          name: trimmed,
          emoji,
          position: nextPosition,
        })
        .select("*")
        .single();
      if (error) {
        console.error("[folders insert error]", error);
        setLastError(friendlyFolderError(error, "create"));
        return null;
      }
      setLastError(null);
      return data as Folder;
    } catch (err) {
      console.error("[folders insert failed]", err);
      setLastError(friendlyFolderError(err, "create"));
      return null;
    }
  }, [userId, folders, isStaff, supabase]);

  const updateFolder = useCallback(async (
    id: string,
    patch: { name?: string; emoji?: string | null; scope?: FolderScope },
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { error } = await supabase
        .from("folders")
        .update({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}),
          ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
        })
        .eq("id", id);
      if (error) {
        console.error("[folders update error]", error);
        const msg = friendlyFolderError(error, "update");
        setLastError(msg);
        return { ok: false, error: msg };
      }
      setLastError(null);
      return { ok: true };
    } catch (err) {
      console.error("[folders update failed]", err);
      const msg = friendlyFolderError(err, "update");
      setLastError(msg);
      return { ok: false, error: msg };
    }
  }, [supabase]);

  const deleteFolder = useCallback(async (id: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      // folder_chats rows cascade via FK ON DELETE CASCADE.
      const { error } = await supabase.from("folders").delete().eq("id", id);
      if (error) {
        console.error("[folders delete error]", error);
        const msg = friendlyFolderError(error, "delete");
        setLastError(msg);
        return { ok: false, error: msg };
      }
      setLastError(null);
      return { ok: true };
    } catch (err) {
      console.error("[folders delete failed]", err);
      const msg = friendlyFolderError(err, "delete");
      setLastError(msg);
      return { ok: false, error: msg };
    }
  }, [supabase]);

  /**
   * Replace the chat list of a folder atomically — diff against the current
   * membership and run only the necessary inserts/deletes.  Wrapped in
   * try/catch and structured logging so `TypeError: Failed to fetch`
   * surfaces as a friendly Russian message instead of crashing the modal.
   */
  const setChatsForFolder = useCallback(async (folderId: string, chatIds: string[]): Promise<{ ok: boolean; error?: string }> => {
    // ── Argument validation ──────────────────────────────────────────────
    if (!folderId || !UUID_RE.test(folderId)) {
      const msg = "Не удалось определить папку для сохранения.";
      setLastError(msg);
      console.error("[folder_chats save] invalid folderId:", folderId);
      return { ok: false, error: msg };
    }
    const validChatIds = chatIds.filter((id) => id && UUID_RE.test(id));
    if (validChatIds.length !== chatIds.length) {
      console.warn("[folder_chats save] dropped non-UUID chat ids:",
        chatIds.filter((id) => !UUID_RE.test(id)));
    }

    // Pull a FRESH snapshot of folder_chats for this folder before
    // diffing.  The cached `folderChats[folderId]` may be stale because:
    //   • realtime refetches are debounced 300ms;
    //   • another tab / user may have edited the same shared folder;
    //   • the previous save may not have echoed back yet.
    // Using a stale baseline would silently drop or re-add rows.  If the
    // SELECT itself fails we fall back to the cached set so the save
    // attempt still goes through (better than blocking the user entirely).
    let current: Set<string>;
    try {
      const { data: freshRows, error: freshErr } = await supabase
        .from("folder_chats")
        .select("chat_id")
        .eq("folder_id", folderId);
      if (freshErr) {
        console.warn("[folder_chats save] fresh snapshot failed, using cache:", freshErr);
        current = new Set(folderChats[folderId] ?? []);
      } else {
        current = new Set((freshRows ?? []).map((r: { chat_id: string }) => r.chat_id));
      }
    } catch (snapErr) {
      console.warn("[folder_chats save] fresh snapshot threw, using cache:", snapErr);
      current = new Set(folderChats[folderId] ?? []);
    }
    const next = new Set(validChatIds);
    const toAdd = [...next].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !next.has(id));

    const folder = folders.find((f) => f.id === folderId);
    const diag = {
      operation: "setChatsForFolder",
      folderId,
      folderScope: folder?.scope,
      userId,
      role,
      origin: typeof window !== "undefined" ? window.location.origin : "n/a",
      embeddedIframe: typeof window !== "undefined" ? window.self !== window.top : false,
      addCount: toAdd.length,
      removeCount: toRemove.length,
    };

    // Nothing to do — no need to hit the network at all.
    if (!toAdd.length && !toRemove.length) {
      setLastError(null);
      return { ok: true };
    }

    if (toAdd.length) {
      try {
        // upsert + ignoreDuplicates so a race ("another tab added the
        // same chat first") doesn't surface as a 409 Conflict.  The
        // composite PK (folder_id, chat_id) is the natural conflict key.
        const { error, data } = await supabase
          .from("folder_chats")
          .upsert(
            toAdd.map((chat_id) => ({ folder_id: folderId, chat_id })),
            { onConflict: "folder_id,chat_id", ignoreDuplicates: true },
          )
          .select();
        if (error) {
          console.error("[folder_chats add error]", { ...diag, addIds: toAdd, error });
          const msg = friendlyFolderError(error, "add");
          setLastError(msg);
          return { ok: false, error: msg };
        }
        // Tiny dev breadcrumb so we can see the add succeeded.
        if (import.meta.env.DEV) {
          console.debug("[folder_chats add ok]", { ...diag, inserted: data?.length });
        }
      } catch (err) {
        console.error("[folder_chats add failed]", { ...diag, addIds: toAdd, err });
        const msg = friendlyFolderError(err, "add");
        setLastError(msg);
        return { ok: false, error: msg };
      }
    }

    if (toRemove.length) {
      try {
        const { error } = await supabase
          .from("folder_chats")
          .delete()
          .eq("folder_id", folderId)
          .in("chat_id", toRemove);
        if (error) {
          console.error("[folder_chats remove error]", { ...diag, removeIds: toRemove, error });
          const msg = friendlyFolderError(error, "remove");
          setLastError(msg);
          return { ok: false, error: msg };
        }
      } catch (err) {
        console.error("[folder_chats remove failed]", { ...diag, removeIds: toRemove, err });
        const msg = friendlyFolderError(err, "remove");
        setLastError(msg);
        return { ok: false, error: msg };
      }
    }
    setLastError(null);
    return { ok: true };
  }, [folderChats, folders, userId, role, supabase]);

  const clearError = useCallback(() => setLastError(null), []);

  // Stable returned object so consumers can rely on referential equality
  // for individual callbacks via destructuring.
  return useMemo(() => ({
    folders,
    folderChats,
    createFolder,
    updateFolder,
    deleteFolder,
    setChatsForFolder,
    canManageFolder,
    refetch: fetchFolders,
    lastError,
    clearError,
  }), [folders, folderChats, createFolder, updateFolder, deleteFolder, setChatsForFolder, canManageFolder, fetchFolders, lastError, clearError]);
}
