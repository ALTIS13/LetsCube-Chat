"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { Folder } from "@/types/database";

/**
 * User's custom sidebar folders ("Работа", "Учёба", etc.) plus the
 * folder→chats membership map.
 *
 * folderChats[folderId] is a Set of chat ids currently in that folder.
 * The Set form is convenient for fast membership checks when filtering
 * the chat list.
 */
export function useFolders() {
  const supabase = createClient();
  const rt = getRealtimeClient();
  const { currentUser } = useAppStore();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderChats, setFolderChats] = useState<Record<string, Set<string>>>({});

  const fetchFolders = useCallback(async () => {
    if (!currentUser) {
      setFolders([]);
      setFolderChats({});
      return;
    }
    const { data: foldersData } = await supabase
      .from("folders")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("position", { ascending: true });
    const list = (foldersData ?? []) as Folder[];
    setFolders(list);

    if (!list.length) { setFolderChats({}); return; }
    const { data: fcData } = await supabase
      .from("folder_chats")
      .select("folder_id, chat_id")
      .in("folder_id", list.map((f) => f.id));
    const map: Record<string, Set<string>> = {};
    for (const f of list) map[f.id] = new Set();
    for (const fc of (fcData ?? [])) map[fc.folder_id]?.add(fc.chat_id);
    setFolderChats(map);
  }, [currentUser, supabase]);

  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  // Realtime — three .on per table because supabase-js typings disallow event="*".
  useEffect(() => {
    if (!currentUser) return;
    const refetch = () => fetchFolders();
    const ch = rt.channel(`folders:${currentUser.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "folders" }, refetch)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "folders" }, refetch)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "folders" }, refetch)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "folder_chats" }, refetch)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "folder_chats" }, refetch)
      .subscribe();
    return () => { rt.removeChannel(ch); };
  }, [currentUser, rt, fetchFolders]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const createFolder = useCallback(async (
    name: string,
    emoji: string | null = null,
  ): Promise<Folder | null> => {
    if (!currentUser) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    const nextPosition = folders.length;
    const { data, error } = await supabase
      .from("folders")
      .insert({ user_id: currentUser.id, name: trimmed, emoji, position: nextPosition })
      .select("*")
      .single();
    if (error) { console.error("createFolder:", error); return null; }
    return data as Folder;
  }, [currentUser, folders.length, supabase]);

  const updateFolder = useCallback(async (
    id: string,
    patch: { name?: string; emoji?: string | null },
  ) => {
    const { error } = await supabase
      .from("folders")
      .update({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}),
      })
      .eq("id", id);
    if (error) console.error("updateFolder:", error);
  }, [supabase]);

  const deleteFolder = useCallback(async (id: string) => {
    // folder_chats rows cascade via FK ON DELETE CASCADE (folder_chats refs folders).
    const { error } = await supabase.from("folders").delete().eq("id", id);
    if (error) console.error("deleteFolder:", error);
  }, [supabase]);

  /**
   * Replace the chat list of a folder atomically — diff against the current
   * membership and run only the necessary inserts/deletes.
   */
  const setChatsForFolder = useCallback(async (folderId: string, chatIds: string[]) => {
    const current = folderChats[folderId] ?? new Set<string>();
    const next = new Set(chatIds);
    const toAdd = [...next].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !next.has(id));

    if (toAdd.length) {
      const { error } = await supabase
        .from("folder_chats")
        .insert(toAdd.map((chat_id) => ({ folder_id: folderId, chat_id })));
      if (error) console.error("setChatsForFolder add:", error);
    }
    if (toRemove.length) {
      const { error } = await supabase
        .from("folder_chats")
        .delete()
        .eq("folder_id", folderId)
        .in("chat_id", toRemove);
      if (error) console.error("setChatsForFolder remove:", error);
    }
  }, [folderChats, supabase]);

  return {
    folders,
    folderChats,
    createFolder,
    updateFolder,
    deleteFolder,
    setChatsForFolder,
    refetch: fetchFolders,
  };
}
