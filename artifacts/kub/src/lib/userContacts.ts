import type { Profile } from "@/types/database";

export type ContactProfile = Pick<Profile, "id" | "full_name" | "username" | "avatar_url" | "profile_frame">;

export type UserContact = {
  contact_user_id: string;
  alias: string | null;
  created_at?: string;
  profile: ContactProfile | null;
};

export function normalizeContactAlias(value: string): string | null {
  const alias = value.trim();
  if (Array.from(alias).length > 64) throw new Error("Имя контакта не может быть длиннее 64 символов.");
  return alias || null;
}

export function contactDisplayName(contact: Pick<UserContact, "alias" | "profile">): string {
  return contact.alias || contact.profile?.full_name ||
    (contact.profile?.username ? `@${contact.profile.username}` : "Пользователь");
}

export function filterAndSortContacts<T extends UserContact>(contacts: readonly T[], query: string): T[] {
  const needle = query.trim().replace(/^@/, "").toLocaleLowerCase("ru-RU");
  return contacts
    .filter((contact) => !needle || [contact.alias, contact.profile?.full_name, contact.profile?.username]
      .some((part) => part?.toLocaleLowerCase("ru-RU").includes(needle)))
    .sort((a, b) => contactDisplayName(a).localeCompare(contactDisplayName(b), "ru-RU"));
}
