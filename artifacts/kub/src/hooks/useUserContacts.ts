import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { normalizeContactAlias, type ContactProfile, type UserContact } from "@/lib/userContacts";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { useAppStore } from "@/store/app.store";

const contactKey = (userId: string | null) => ["user-contacts", userId] as const;

async function loadContacts(ownerId: string): Promise<UserContact[]> {
  const supabase = createClient();
  const rows: Array<{ contact_user_id: string; alias: string | null; created_at: string }> = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.from("user_contacts")
      .select("contact_user_id,alias,created_at")
      .eq("owner_user_id", ownerId)
      .order("created_at", { ascending: false })
      .range(offset, offset + 199);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 200) break;
  }

  const profiles = new Map<string, ContactProfile>();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const ids = rows.slice(offset, offset + 100).map((row) => row.contact_user_id);
    const { data, error } = await supabase.from("profiles")
      .select("id,full_name,username,avatar_url,profile_frame")
      .in("id", ids);
    if (error) throw error;
    for (const profile of data ?? []) profiles.set(profile.id, profile);
  }
  return rows.map((row) => ({ ...row, profile: profiles.get(row.contact_user_id) ?? null }));
}

export function useUserContacts({ enabled = true }: { enabled?: boolean } = {}) {
  const ownerId = useAppStore((state) => state.currentUser?.id ?? null);
  const queryClient = useQueryClient();
  const queryKey = contactKey(ownerId);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey });
    dispatchChatsRefresh({ reason: "contact-change" });
  };
  const list = useQuery({
    queryKey,
    queryFn: () => loadContacts(ownerId!),
    enabled: enabled && Boolean(ownerId),
    staleTime: 30_000,
    retry: false,
  });

  const add = useMutation({
    mutationFn: async (contactUserId: string) => {
      if (!ownerId || contactUserId === ownerId) throw new Error("Нельзя добавить этот контакт.");
      const { error } = await createClient().from("user_contacts")
        .insert({ owner_user_id: ownerId, contact_user_id: contactUserId });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const rename = useMutation({
    mutationFn: async ({ contactUserId, alias }: { contactUserId: string; alias: string }) => {
      if (!ownerId) throw new Error("Требуется войти в аккаунт.");
      const { error } = await createClient().from("user_contacts")
        .update({ alias: normalizeContactAlias(alias) })
        .eq("owner_user_id", ownerId)
        .eq("contact_user_id", contactUserId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (contactUserId: string) => {
      if (!ownerId) throw new Error("Требуется войти в аккаунт.");
      const { error } = await createClient().from("user_contacts")
        .delete()
        .eq("owner_user_id", ownerId)
        .eq("contact_user_id", contactUserId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return { list, add, rename, remove };
}
