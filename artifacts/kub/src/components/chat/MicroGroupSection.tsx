"use client";

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { KubButton, KubIcon } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { usePersonalBlocks } from "@/hooks/usePersonalModeration";
import { requestAppConfirm } from "@/lib/appDialogs";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { FOCUS_RING } from "@/lib/controlSurface";
import { FIELD_SHELL } from "@/lib/fieldShell";
import {
  microGroupDrawnName,
  microGroupErrorText,
  microGroupOwnerId,
  microGroupRoom,
  type MicroGroupMember,
} from "@/lib/microGroup";
import { cn } from "@/lib/utils";
import type { ChatWithLastMessage, Profile } from "@/types/database";
import { MicroGroupPeopleModal } from "./MicroGroupPeopleModal";

type Member = MicroGroupMember & { profile?: (Pick<Profile, "id" | "full_name" | "username" | "avatar_url"> & MicroGroupMember["profile"]) | null };

/**
 * A micro-group's own part of the information card (tracker item 45): what the
 * owner specified and nothing more — «Участники — N» with a crown on its
 * creator, the name, adding people, and leaving. The container keeps its
 * lightness: no roles, channels, links or folders here, by the owner's word.
 *
 * Somebody the reader has blocked being in it is said at the top, as Discord
 * warns in a group DM that holds somebody blocked
 * (`GDM_BLOCKED_USER_WARNING` in its web bundle): the reader can stay or go.
 */
const TRAILING_SLOT = "flex h-8 w-8 shrink-0 items-center justify-center pointer-coarse:w-11";

export function MicroGroupSection({ chat, onLeft, part = "top", exitRowClassName }: {
  chat: ChatWithLastMessage;
  onLeft: () => void;
  /**
   * `top`: the notice, the name and the people. `exit`: leaving and deleting,
   * which go at the foot of the card, below the rows every conversation has,
   * in the band where this card already keeps its other endings.
   */
  part?: "top" | "exit";
  /** The card's own destructive row, so the foot reads as one run. */
  exitRowClassName?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const setSelectedChatId = useAppStore((s) => s.setSelectedChatId);
  const [, setLocation] = useLocation();
  const blocks = usePersonalBlocks();
  const members = useMemo(() => {
    const rows = ((chat.members ?? []) as unknown as Member[]).slice();
    return rows.sort((a, b) => {
      if (a.role === "owner" && b.role !== "owner") return -1;
      if (b.role === "owner" && a.role !== "owner") return 1;
      return (a.joined_at ?? "").localeCompare(b.joined_at ?? "") || a.user_id.localeCompare(b.user_id);
    });
  }, [chat.members]);
  const ownerId = microGroupOwnerId(members);
  const iAmOwner = ownerId !== null && ownerId === userId;
  const blockedHere = members.some((member) => member.user_id !== userId && blocks.ids.has(member.user_id));
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(chat.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leaveToList = () => {
    onLeft();
    setSelectedChatId(null);
    setLocation("/");
  };

  const saveName = async () => {
    setBusy(true);
    setError(null);
    const { error: renameError } = await supabase.rpc("micro_group_rename", { p_chat_id: chat.id, p_name: name.trim() || null });
    setBusy(false);
    if (renameError) {
      setError(microGroupErrorText(renameError, "Не удалось переименовать. Попробуйте ещё раз."));
      return;
    }
    setRenaming(false);
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const remove = async (member: Member) => {
    const who = member.profile?.full_name || member.profile?.username || "участника";
    const confirmed = await requestAppConfirm({
      title: "Удалить из группового чата?",
      description: `${who} больше не будет видеть новые сообщения.`,
      confirmLabel: "Удалить",
      tone: "danger",
      icon: "userRemove",
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    const { error: removeError } = await supabase.from("chat_members").delete().eq("chat_id", chat.id).eq("user_id", member.user_id);
    setBusy(false);
    if (removeError) {
      setError(microGroupErrorText(removeError, "Не удалось удалить участника. Попробуйте ещё раз."));
      return;
    }
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const leave = async () => {
    const confirmed = await requestAppConfirm({
      title: "Покинуть групповой чат?",
      description: iAmOwner
        ? "Вы больше не будете его видеть. Корона перейдёт тому, кто здесь дольше всех."
        : "Вы больше не будете его видеть. Вернуть вас сможет любой участник.",
      confirmLabel: "Покинуть",
      tone: "danger",
      icon: "logout",
    });
    if (!confirmed) return;
    setBusy(true);
    const { error: leaveError } = await supabase.rpc("micro_group_leave", { p_chat_id: chat.id });
    setBusy(false);
    if (leaveError) {
      setError(microGroupErrorText(leaveError, "Не удалось покинуть чат. Попробуйте ещё раз."));
      return;
    }
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
    leaveToList();
  };

  const destroy = async () => {
    const confirmed = await requestAppConfirm({
      title: "Удалить групповой чат?",
      description: "Он исчезнет у всех участников вместе с перепиской.",
      confirmLabel: "Удалить",
      tone: "danger",
      icon: "delete",
    });
    if (!confirmed) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("chats").delete().eq("id", chat.id);
    setBusy(false);
    if (deleteError) {
      setError(microGroupErrorText(deleteError, "Не удалось удалить чат. Попробуйте ещё раз."));
      return;
    }
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
    leaveToList();
  };

  const room = microGroupRoom(members.length);

  if (part === "exit") {
    return (
      <div className="contents" data-testid="micro-group-exit">
        {error && (
          <p role="alert" className="px-2 text-xs text-[color:var(--kub-danger-text)]">{error}</p>
        )}
        <button
          type="button"
          onClick={() => void leave()}
          disabled={busy}
          data-testid="micro-group-leave"
          className={exitRowClassName ?? cn("kub-button kub-interactive flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm text-[color:var(--kub-danger-text)] kub-raise-hover", FOCUS_RING)}
        >
          <KubIcon name="logout" size={17} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">Покинуть групповой чат</span>
        </button>
        {iAmOwner && (
          <button
            type="button"
            onClick={() => void destroy()}
            disabled={busy}
            data-testid="micro-group-delete"
            className={exitRowClassName ?? cn("kub-button kub-interactive flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm text-[color:var(--kub-danger-text)] kub-raise-hover", FOCUS_RING)}
          >
            <KubIcon name="delete" size={17} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Удалить групповой чат</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-3" data-testid="micro-group-section">
      {blockedHere && (
        <div
          role="note"
          data-testid="micro-group-blocked-note"
          className="flex items-start gap-2 rounded-xl bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-text)]"
        >
          <KubIcon name="ban" size={14} className="mt-0.5 shrink-0 text-[color:var(--kub-danger-text)]" />
          <span className="min-w-0 flex-1">
            Здесь есть человек, которого вы заблокировали. Его сообщения в этом чате видны.
          </span>
          <button
            type="button"
            onClick={() => void leave()}
            className={cn("kub-button kub-interactive shrink-0 rounded-md px-1.5 text-xs font-semibold text-[color:var(--kub-danger-text)] kub-raise-hover", FOCUS_RING)}
          >
            Покинуть
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-[color:var(--kub-danger-text)]" data-testid="micro-group-section-error">{error}</p>
      )}

      <div className="space-y-1.5">
        <div className="text-[12px] uppercase tracking-wider text-[color:var(--kub-accent-text)]">Название</div>
        {renaming ? (
          <div className="flex items-center gap-2">
            <div className={cn(FIELD_SHELL, "min-w-0 flex-1")}>
              <input
                autoFocus
                value={name}
                maxLength={64}
                onChange={(event) => setName(event.currentTarget.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void saveName(); if (event.key === "Escape") setRenaming(false); }}
                placeholder={microGroupDrawnName(members, userId)}
                aria-label="Название группового чата"
                data-testid="micro-group-name-input"
                className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
              />
            </div>
            <KubButton size="sm" onClick={() => void saveName()} loading={busy} data-testid="micro-group-name-save">
              Сохранить
            </KubButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setName(chat.name ?? ""); setRenaming(true); }}
            data-testid="micro-group-rename"
            className={cn("kub-button kub-interactive flex w-full min-w-0 items-center gap-2 rounded-lg px-1 text-left text-sm text-[color:var(--kub-text)] kub-raise-hover", FOCUS_RING)}
          >
            <span className="min-w-0 flex-1 truncate">
              {chat.name?.trim() || <span className="text-[color:var(--kub-muted)]">Без названия — {microGroupDrawnName(members, userId)}</span>}
            </span>
            <span className={TRAILING_SLOT}>
              <KubIcon name="edit" size={14} className="text-[color:var(--kub-muted)]" />
            </span>
          </button>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] uppercase tracking-wider text-[color:var(--kub-accent-text)]" data-testid="micro-group-members-heading">
            Участники — {members.length}
          </div>
          {room > 0 && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              data-testid="micro-group-add"
              className={cn("kub-button kub-interactive inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-[color:var(--kub-accent-text)] kub-raise-hover", FOCUS_RING)}
            >
              <KubIcon name="userPlus" size={13} />
              Добавить
            </button>
          )}
        </div>
        {members.map((member) => {
          const isOwnerRow = member.user_id === ownerId;
          const label = member.profile?.full_name || member.profile?.username || "Участник";
          return (
            <div key={member.user_id} className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg px-1" data-testid="micro-group-member" data-owner={isOwnerRow ? "true" : "false"}>
              {member.profile && <UserAvatar user={{ ...member.profile, id: member.user_id } as Profile} size="sm" />}
              <span className="min-w-0 flex-1 truncate text-sm text-[color:var(--kub-text)]">
                {label}
                {member.user_id === userId && <span className="text-[color:var(--kub-muted)]"> (вы)</span>}
              </span>
              {isOwnerRow && (
                <span title="Создатель" className={TRAILING_SLOT} data-testid="micro-group-crown">
                  <KubIcon name="crown" size={15} tone="warn" label="Создатель" />
                </span>
              )}
              {iAmOwner && !isOwnerRow && (
                <button
                  type="button"
                  onClick={() => void remove(member)}
                  disabled={busy}
                  aria-label={`Удалить из чата: ${label}`}
                  title="Удалить из чата"
                  className={cn("kub-icon-action kub-interactive", TRAILING_SLOT, "rounded-lg text-[color:var(--kub-muted)] kub-raise-hover hover:text-[color:var(--kub-danger-text)]", FOCUS_RING)}
                >
                  <KubIcon name="userRemove" size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {adding && (
        <MicroGroupPeopleModal
          target={{ kind: "add", chatId: chat.id, memberIds: members.map((member) => member.user_id) }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
