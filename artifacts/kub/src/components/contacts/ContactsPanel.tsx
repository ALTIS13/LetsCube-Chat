"use client";

import { useEffect, useMemo, useState } from "react";

import { KubButton, KubEmptyState, KubIcon, KubModal } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useCreateChat } from "@/hooks/useCreateChat";
import { useUserContacts } from "@/hooks/useUserContacts";
import { DISABLED_SINK, FOCUS_RING, FOCUS_RING_WITHIN } from "@/lib/controlSurface";
import { contactDisplayName, filterAndSortContacts, type UserContact } from "@/lib/userContacts";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";
import type { Profile } from "@/types/database";

export function ContactsPanel({ previewContacts }: { previewContacts?: UserContact[] } = {}) {
  const setMobileSection = useAppStore((state) => state.setMobileSection);
  const { list, add, rename, remove } = useUserContacts({ enabled: !previewContacts });
  const { searchUsers, openPrivateChat, loading: openingChat, error: chatError } = useCreateChat();
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [personQuery, setPersonQuery] = useState("");
  const [people, setPeople] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState<UserContact | null>(null);
  const [deleting, setDeleting] = useState<UserContact | null>(null);
  const [alias, setAlias] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * People outside the contacts who match what is typed (tracker item 57).
   *
   * The report, 2026-09-27: after the first contact this search box filtered
   * only contacts, and how to add a second was unclear. Telegram's contacts
   * search answers where the question is asked: it lists the contacts that
   * match, and under them everybody else who does, under «Глобальный поиск»
   * (`GlobalSearch`, read on translations.telegram.org 2026-09-28). The same
   * search the «Добавить контакт» window runs, so it finds nobody that window
   * would not.
   */
  const [globalPeople, setGlobalPeople] = useState<Profile[]>([]);
  const [globalSearching, setGlobalSearching] = useState(false);

  const contactRows = previewContacts ?? list.data ?? [];
  const contacts = useMemo(() => filterAndSortContacts(contactRows, query), [contactRows, query]);
  const existingIds = useMemo(() => new Set(contactRows.map((item) => item.contact_user_id)), [contactRows]);
  const globalQuery = previewContacts ? "" : query.trim().replace(/^@/, "");
  const outsideContacts = useMemo(
    () => globalPeople.filter((person) => !existingIds.has(person.id)),
    [globalPeople, existingIds],
  );

  useEffect(() => {
    if (!globalQuery) { setGlobalPeople([]); setGlobalSearching(false); return; }
    let active = true;
    setGlobalSearching(true);
    const timer = window.setTimeout(async () => {
      const found = await searchUsers(globalQuery);
      if (active) { setGlobalPeople(found); setGlobalSearching(false); }
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [globalQuery, searchUsers]);

  useEffect(() => {
    if (!addOpen || !personQuery.trim()) { setPeople([]); setSearching(false); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const found = await searchUsers(personQuery.trim().replace(/^@/, ""));
      if (active) { setPeople(found); setSearching(false); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [addOpen, personQuery, searchUsers]);

  const openChat = async (id: string) => {
    setActionError(null);
    const chatId = await openPrivateChat(id);
    if (chatId) setMobileSection("chats");
  };
  const addPerson = async (id: string) => {
    setActionError(null);
    try {
      await add.mutateAsync(id);
      setAddOpen(false);
      setPersonQuery("");
    } catch {
      setActionError("Не удалось добавить контакт. Повторите попытку.");
    }
  };
  const saveAlias = async () => {
    if (!editing) return;
    setActionError(null);
    try {
      await rename.mutateAsync({ contactUserId: editing.contact_user_id, alias });
      setEditing(null);
    } catch {
      setActionError("Не удалось сохранить имя контакта. Проверьте длину и попробуйте снова.");
    }
  };
  const removeContact = async () => {
    if (!deleting) return;
    setActionError(null);
    try {
      await remove.mutateAsync(deleting.contact_user_id);
      setDeleting(null);
    }
    catch { setActionError("Не удалось удалить контакт. Повторите попытку."); }
  };

  return (
    <section aria-label="Контакты" data-testid="contacts-panel" className="flex min-h-0 flex-1 flex-col text-[color:var(--kub-text)]">
      {/* The top of the window, as the chat list's header clears it: on the
          installed iPhone without this the title sat on the clock and the add
          button beside the battery, where the status bar takes the touch — and
          once one contact existed that button was the only way to add another
          (D-315, D-317). */}
      <div className="shrink-0 border-b border-[color:var(--kub-rule)] pt-window-top">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setMobileSection("chats")} aria-label="Назад к чатам" className={cn("kub-icon-action hidden h-10 w-10 items-center justify-center rounded-md text-[color:var(--kub-muted)] kub-raise-hover md:flex", FOCUS_RING)}><KubIcon name="back" size={18} /></button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Контакты</h2>
        <button type="button" onClick={() => { setActionError(null); setAddOpen(true); }} aria-label="Добавить контакт" title="Добавить контакт" className={cn("kub-icon-action flex h-11 w-11 items-center justify-center rounded-md text-[color:var(--kub-accent-text)] kub-raise-hover", FOCUS_RING)}><KubIcon name="userPlus" size={20} /></button>
      </div>
      </div>
      <div className="shrink-0 px-3 py-2">
        <label className={cn("kub-field flex h-10 items-center gap-2 rounded-md bg-[var(--kub-inset)] px-3", FOCUS_RING_WITHIN)}>
          <KubIcon name="search" size={16} className="text-[color:var(--kub-muted)]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск контактов" aria-label="Поиск контактов" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
      </div>
      {actionError && <p role="alert" className="px-3 pb-2 text-xs text-[color:var(--kub-danger-text)]">{actionError}</p>}
      {chatError && <p role="alert" className="px-3 pb-2 text-xs text-[color:var(--kub-danger-text)]">{chatError}</p>}
      {!previewContacts && list.isLoading ? <div role="status" className="flex flex-1 items-center justify-center"><KubIcon name="spinner" size={22} className="text-[color:var(--kub-cyan)]" /></div> :
        !previewContacts && list.isError ? <div role="alert" className="px-4 py-5 text-sm">Не удалось загрузить контакты. <KubButton size="sm" variant="secondary" onClick={() => void list.refetch()}>Повторить</KubButton></div> :
        contacts.length === 0 && (!globalQuery || (!globalSearching && outsideContacts.length === 0)) ? <KubEmptyState icon={<KubIcon name="contact" size={26} />} title={query ? "Ничего не найдено" : "Контактов пока нет"} description={query ? "Попробуйте другое имя или никнейм." : "Добавьте человека, чтобы находить его даже без открытого чата."} action={!query ? <KubButton size="sm" onClick={() => setAddOpen(true)}>Добавить контакт</KubButton> : undefined} /> :
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(var(--kub-bottom-nav)+var(--kub-bottom-nav-gap)+var(--kub-safe-bottom)+1rem)] md:pb-3">
          {contacts.map((contact) => (
            <div key={contact.contact_user_id} className="flex min-h-[76px] items-center gap-2 border-b border-[color:var(--kub-rule)] px-3">
              <button type="button" onClick={() => void openChat(contact.contact_user_id)} disabled={openingChat} className={cn("flex min-h-[76px] min-w-0 flex-1 items-center gap-3 rounded-md text-left kub-raise-hover", FOCUS_RING, DISABLED_SINK)}>
                {contact.profile ? <UserAvatar user={contact.profile} size="md" /> : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--kub-inset)]"><KubIcon name="contact" size={22} /></span>}
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{contactDisplayName(contact)}</span>{contact.profile?.username && <span className="block truncate text-[13px] text-[color:var(--kub-muted)]">@{contact.profile.username}</span>}</span>
              </button>
              <button type="button" onClick={() => { setEditing(contact); setAlias(contact.alias ?? ""); setActionError(null); }} aria-label={`Изменить имя: ${contactDisplayName(contact)}`} title="Изменить имя" className={cn("kub-icon-action flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[color:var(--kub-muted)] kub-raise-hover", FOCUS_RING)}><KubIcon name="edit" size={16} /></button>
              <button type="button" onClick={() => { setDeleting(contact); setActionError(null); }} aria-label={`Удалить контакт: ${contactDisplayName(contact)}`} title="Удалить контакт" className={cn("kub-icon-action flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[color:var(--kub-muted)] kub-raise-hover", FOCUS_RING)}><KubIcon name="delete" size={16} /></button>
            </div>
          ))}
          {globalQuery && (
            <section aria-label="Глобальный поиск" data-testid="contacts-global">
              <h3 className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--kub-muted)]">Глобальный поиск</h3>
              {globalSearching && outsideContacts.length === 0 && <p role="status" className="px-4 py-2 text-sm text-[color:var(--kub-muted)]">Ищем...</p>}
              {!globalSearching && outsideContacts.length === 0 && <p className="px-4 py-2 text-sm text-[color:var(--kub-muted)]">Больше никого не нашлось.</p>}
              {outsideContacts.map((person) => {
                const name = person.full_name || person.username || "Пользователь";
                return (
                  <div key={person.id} data-testid="contacts-global-row" className="flex min-h-[64px] items-center gap-2 border-b border-[color:var(--kub-rule)] px-3">
                    <button type="button" onClick={() => void openChat(person.id)} disabled={openingChat} className={cn("flex min-h-[64px] min-w-0 flex-1 items-center gap-3 rounded-md text-left kub-raise-hover", FOCUS_RING, DISABLED_SINK)}>
                      <UserAvatar user={person} size="md" />
                      <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{name}</span>{person.username && <span className="block truncate text-[13px] text-[color:var(--kub-muted)]">@{person.username}</span>}</span>
                    </button>
                    <button type="button" onClick={() => void addPerson(person.id)} disabled={add.isPending} aria-label={`Добавить в контакты: ${name}`} title="Добавить в контакты" className={cn("kub-icon-action flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[color:var(--kub-accent-text)] kub-raise-hover", FOCUS_RING, DISABLED_SINK)}><KubIcon name="userPlus" size={18} /></button>
                  </div>
                );
              })}
            </section>
          )}
        </div>}

      {addOpen && <KubModal open onClose={() => { setAddOpen(false); setPersonQuery(""); setActionError(null); }} title="Добавить контакт" icon={<KubIcon name="userPlus" size={17} />} size="sm" contentClassName="space-y-3 px-4 py-3">
        <input autoFocus value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Имя или @никнейм" aria-label="Найти человека" className={cn("kub-field h-11 w-full rounded-md bg-[var(--kub-inset)] px-3 text-sm", FOCUS_RING)} />
        {actionError && <p role="alert" className="text-xs text-[color:var(--kub-danger-text)]">{actionError}</p>}
        {chatError && <p role="alert" className="text-xs text-[color:var(--kub-danger-text)]">{chatError}</p>}
        <div className="max-h-72 overflow-y-auto">
          {searching && <p role="status" className="py-3 text-sm text-[color:var(--kub-muted)]">Ищем...</p>}
          {!personQuery.trim() && <p className="py-3 text-sm text-[color:var(--kub-muted)]">Введите имя или никнейм.</p>}
          {personQuery.trim() && !searching && people.length === 0 && !chatError && <p className="py-3 text-sm text-[color:var(--kub-muted)]">Пользователи не найдены.</p>}
          {people.map((person) => <button key={person.id} type="button" onClick={() => void addPerson(person.id)} disabled={existingIds.has(person.id) || add.isPending} className={cn("flex min-h-14 w-full items-center gap-3 rounded-md px-2 text-left kub-raise-hover", FOCUS_RING, DISABLED_SINK)}><UserAvatar user={person} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{person.full_name || person.username || "Пользователь"}</span>{person.username && <span className="block truncate text-xs text-[color:var(--kub-muted)]">@{person.username}</span>}</span>{existingIds.has(person.id) && <span className="text-xs text-[color:var(--kub-muted)]">Добавлен</span>}</button>)}
        </div>
      </KubModal>}

      {editing && <KubModal open onClose={() => setEditing(null)} title="Имя контакта" icon={<KubIcon name="edit" size={17} />} size="sm" contentClassName="space-y-3 px-4 py-3" footer={<><KubButton variant="secondary" onClick={() => setEditing(null)}>Отмена</KubButton><KubButton onClick={() => void saveAlias()} disabled={rename.isPending}>Сохранить</KubButton></>}>
        <p className="text-xs text-[color:var(--kub-muted)]">Имя видно только вам. Пустое поле вернёт имя из профиля.</p>
        <input autoFocus value={alias} onChange={(event) => setAlias(event.target.value)} maxLength={64} aria-label="Личное имя контакта" className={cn("kub-field h-11 w-full rounded-md bg-[var(--kub-inset)] px-3 text-sm", FOCUS_RING)} />
        {actionError && <p role="alert" className="text-xs text-[color:var(--kub-danger-text)]">{actionError}</p>}
      </KubModal>}
      {deleting && <KubModal open onClose={() => setDeleting(null)} title="Удалить контакт?" icon={<KubIcon name="delete" size={17} />} size="sm" contentClassName="space-y-3 px-4 py-3" footer={<><KubButton variant="secondary" onClick={() => setDeleting(null)}>Отмена</KubButton><KubButton onClick={() => void removeContact()} disabled={remove.isPending}>Удалить</KubButton></>}>
        <p className="text-sm">{contactDisplayName(deleting)} исчезнет из вашего списка. Переписка останется.</p>
        {actionError && <p role="alert" className="text-xs text-[color:var(--kub-danger-text)]">{actionError}</p>}
      </KubModal>}
    </section>
  );
}
