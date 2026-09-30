"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useCreateChat } from "@/hooks/useCreateChat";
import { usePersonalBlocks } from "@/hooks/usePersonalModeration";
import { useUserContacts } from "@/hooks/useUserContacts";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { FIELD_SHELL } from "@/lib/fieldShell";
import { DISABLED_SINK, FOCUS_RING } from "@/lib/controlSurface";
import { MICRO_GROUP_CAP, microGroupErrorText, microGroupRoom, microGroupRoomLabel } from "@/lib/microGroup";
import { peopleSearchNeedle, personMatchesSearch } from "@/lib/peopleSearchScope";
import { safeOpenChat } from "@/lib/safeOpenChat";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types/database";

type Target =
  /** The gesture: from a private chat, a new micro-group with its two people and whoever is picked. */
  | { kind: "create"; privateChatId: string; partnerId: string }
  /** More people into one that exists. */
  | { kind: "add"; chatId: string; memberIds: readonly string[] };

type Person = Pick<Profile, "id" | "full_name" | "username" | "avatar_url">;

/**
 * Who to bring into a micro-group (tracker item 45).
 *
 * The people offered first are the ones the reader already has — everybody in
 * their conversations and their contacts; typing reaches anybody else by the
 * start of their handle, the scope search has (`lib/peopleSearchScope.ts`,
 * item 73). Somebody the reader has blocked is not
 * offered: the database would refuse them anyway. Somebody who blocked the
 * reader is refused by the database without saying why.
 */
export function MicroGroupPeopleModal({ target, onClose }: { target: Target; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const chats = useAppStore((s) => s.chats);
  const blocks = usePersonalBlocks();
  const contacts = useUserContacts();
  const { searchUsers } = useCreateChat();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inside = useMemo(
    () => new Set(target.kind === "create" ? [target.partnerId] : target.memberIds),
    [target],
  );
  const memberCount = target.kind === "create" ? 2 : target.memberIds.length;
  const room = microGroupRoom(memberCount);

  /** Everybody the reader already has, most recent conversation first. */
  const known = useMemo(() => {
    const people = new Map<string, Person>();
    for (const chat of chats) {
      for (const member of chat.members ?? []) {
        const profile = (member as { profile?: Person | null }).profile;
        if (profile && profile.id !== userId && !people.has(profile.id)) people.set(profile.id, profile);
      }
    }
    for (const contact of contacts.list.data ?? []) {
      if (contact.profile && contact.contact_user_id !== userId && !people.has(contact.contact_user_id)) {
        people.set(contact.contact_user_id, { ...contact.profile, id: contact.contact_user_id });
      }
    }
    return [...people.values()];
  }, [chats, contacts.list.data, userId]);

  useEffect(() => {
    const needle = peopleSearchNeedle(query);
    if (!needle) {
      setFound([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const people = await searchUsers(query);
      if (!cancelled) setFound(people);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchUsers]);

  const offered = useMemo(() => {
    const needle = peopleSearchNeedle(query);
    const base = needle ? [...known.filter((person) => personMatchesSearch(person, needle, true)), ...found] : known;
    const seen = new Set<string>();
    return base.filter((person) => {
      if (seen.has(person.id) || person.id === userId || inside.has(person.id) || blocks.ids.has(person.id)) return false;
      seen.add(person.id);
      return true;
    }).slice(0, 60);
  }, [blocks.ids, found, inside, known, query, userId]);

  const isPicked = (id: string) => selected.some((person) => person.id === id);
  const toggle = (person: Person) => {
    setError(null);
    setSelected((current) => {
      if (current.some((picked) => picked.id === person.id)) return current.filter((picked) => picked.id !== person.id);
      if (current.length >= room) return current;
      return [...current, person];
    });
  };

  const submit = async () => {
    if (saving || selected.length === 0) return;
    setSaving(true);
    setError(null);
    const ids = selected.map((person) => person.id);
    if (target.kind === "create") {
      const { data, error: createError } = await supabase.rpc("micro_group_create", {
        p_private_chat_id: target.privateChatId,
        p_user_ids: ids,
      });
      if (createError || !data) {
        setSaving(false);
        setError(microGroupErrorText(createError, "Не удалось создать групповой чат. Попробуйте ещё раз."));
        return;
      }
      dispatchChatsRefresh({ reason: "membership-change", chatId: data });
      await safeOpenChat(data);
      onClose();
      return;
    }
    const { error: addError } = await supabase.rpc("micro_group_add", { p_chat_id: target.chatId, p_user_ids: ids });
    setSaving(false);
    if (addError) {
      setError(microGroupErrorText(addError, "Не удалось добавить. Попробуйте ещё раз."));
      return;
    }
    dispatchChatsRefresh({ reason: "membership-change", chatId: target.chatId });
    onClose();
  };

  const creating = target.kind === "create";
  return (
    <KubModal
      open={true}
      onClose={onClose}
      title={creating ? "Групповой чат" : "Добавить участников"}
      description={creating
        ? "Кого добавить в беседу? Появится групповой чат с вами двумя и выбранными."
        : microGroupRoomLabel(memberCount)}
      icon={<KubIcon name="userPlus" size={16} />}
      size="sm"
      contentClassName="px-4 py-3 space-y-3"
      footer={(
        <KubButton
          fullWidth
          onClick={() => void submit()}
          disabled={selected.length === 0}
          loading={saving}
          data-testid="micro-group-submit"
        >
          {creating
            ? selected.length ? `Создать групповой чат (${selected.length + 2})` : "Выберите, кого добавить"
            : selected.length ? `Добавить (${selected.length})` : "Выберите, кого добавить"}
        </KubButton>
      )}
    >
      {error && (
        <div
          role="alert"
          data-testid="micro-group-error"
          className="flex items-start gap-2 rounded-xl border border-[color:var(--kub-danger)]/30 bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-danger-text)]"
        >
          <KubIcon name="alert" size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className={FIELD_SHELL}>
        <KubIcon name="search" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Имя или @никнейм"
          aria-label="Поиск людей"
          className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
        />
      </div>

      <p className="text-xs text-[color:var(--kub-muted)]" data-testid="micro-group-room">
        {selected.length >= room
          ? `Больше нельзя: в групповом чате до ${MICRO_GROUP_CAP} человек.`
          : `Выбрано ${selected.length} из ${room}`}
      </p>

      <div className="-mx-4 max-h-72 overflow-y-auto px-1" data-testid="micro-group-candidates">
        {offered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-[color:var(--kub-muted)]">
            {query.trim() ? "Никого не нашлось. Незнакомого человека ищите по началу @никнейма." : "Пока некого добавить."}
          </p>
        ) : offered.map((person) => {
          const picked = isPicked(person.id);
          const full = !picked && selected.length >= room;
          return (
            <button
              key={person.id}
              type="button"
              role="checkbox"
              aria-checked={picked}
              disabled={full}
              onClick={() => toggle(person)}
              data-testid="micro-group-candidate"
              className={cn(
                "kub-button kub-interactive flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors kub-raise-hover",
                DISABLED_SINK,
                FOCUS_RING,
              )}
            >
              <UserAvatar user={person} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[color:var(--kub-text)]">{person.full_name || person.username || "Без имени"}</span>
                {person.username && <span className="block truncate text-xs text-[color:var(--kub-muted)]">@{person.username}</span>}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  picked
                    ? "border-[color:var(--kub-cyan)] bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                    : "border-[color:var(--kub-muted)]",
                )}
              >
                {picked && <KubIcon name="check" size={12} />}
              </span>
            </button>
          );
        })}
      </div>
    </KubModal>
  );
}
