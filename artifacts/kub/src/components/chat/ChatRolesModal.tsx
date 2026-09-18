"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubIcon, KubModal, KubNotice } from "@/components/kub";
import { KUB_ICON_NAMES, type KubIconName } from "@/components/kub/icons";
import { newChatId } from "@/lib/chatCreation";
import {
  CHAT_ROLE_COLOURS,
  chatRoleColourValue,
  readChatRoleColour,
  type ChatRoleColour,
} from "@/lib/chatRolePalette";
import {
  CHAT_ROLE_LIMITS,
  chatRoleDefineDenial,
  chatRoleDenialText,
  chatRoleNameTaken,
  isChatRoleNameValid,
  normalizeChatRoleName,
  type ChatMemberStanding,
  type ChatRole,
} from "@/lib/chatRoles";
import { newChatRoleRow, type ChatRolesView } from "@/hooks/useChatRoles";
import { mapPgError, prefixError } from "@/lib/errors";
import { requestAppConfirm } from "@/lib/appDialogs";
import { cn } from "@/lib/utils";
import { ChatRoleChip } from "./ChatRoleChip";

/**
 * The screen where a group names its own standings (D-215).
 *
 * The owner's, not an administrator's: `"owners manage chat roles"` is
 * `is_chat_owner(chat_id)`, while handing an existing tag to somebody is an
 * administrator's job. That split is the server's and `lib/chatRoles.ts`
 * mirrors it; this screen asks that mirror rather than deciding again.
 *
 * **The glyphs are a short list, not the whole icon set.** `KubIcon` has around
 * a hundred names and most of them mean something else in this product — a
 * paperclip, a microphone, a bin. Offering all of them would let a group tag
 * somebody «Наставник 🗑». The eight below are the ones that read as a standing
 * at 11px and are not already spoken for by the LETSCUBE badges, whose
 * silhouettes `tests/unit/badge-vocabulary.test.mts` keeps apart.
 */
const ROLE_ICONS: readonly KubIconName[] = (
  ["crown", "shield", "star", "zap", "key", "check", "heart", "tasks"] as const
).filter((name) => KUB_ICON_NAMES.has(name)) as KubIconName[];

interface Draft {
  id: string | null;
  name: string;
  colour: ChatRoleColour | null;
  icon: KubIconName | null;
  priority: number;
}

const BLANK: Draft = { id: null, name: "", colour: "blue", icon: null, priority: 0 };

export function ChatRolesModal({
  open,
  onClose,
  chatId,
  chatType,
  standing,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  chatId: string;
  chatType: string | null;
  standing: ChatMemberStanding;
  roles: ChatRolesView;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const denial = chatRoleDefineDenial({
    chatType,
    standing,
    definedCount: roles.ready ? roles.roles.length : undefined,
  });
  // The gate that stops a control being drawn is not the gate that stops the
  // list being read: a member sees the vocabulary, only the owner changes it.
  const mayDefine = denial === null;

  const trimmed = normalizeChatRoleName(draft?.name ?? "");
  const nameTaken = draft ? chatRoleNameTaken(trimmed, roles.roles, draft.id ?? undefined) : false;
  const nameValid = draft ? isChatRoleNameValid(draft.name) : false;
  const canSave = Boolean(draft) && nameValid && !nameTaken && !busy;

  const startNew = () => {
    setError(null);
    setDraft({ ...BLANK, priority: nextPriority(roles.roles) });
  };
  const startEdit = (role: ChatRole) => {
    setError(null);
    setDraft({
      id: role.id,
      name: role.name,
      colour: readChatRoleColour(role.colour),
      icon: role.icon && KUB_ICON_NAMES.has(role.icon) ? (role.icon as KubIconName) : null,
      priority: role.priority,
    });
  };

  const save = async () => {
    if (!draft || !canSave) return;
    setBusy(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    const me = auth.user?.id ?? null;
    if (!me) {
      setBusy(false);
      setError("Не удалось определить вашу учётную запись.");
      return;
    }

    const written = draft.id
      ? await supabase
          .from("chat_roles" as never)
          .update({
            name: trimmed,
            colour: draft.colour,
            icon: draft.icon,
            priority: draft.priority,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", draft.id)
      : // No read-back, deliberately: `INSERT ... RETURNING` is judged by the
        // SELECT policy too, which is what made group creation answer 403 for
        // three days (`lib/chatCreation.ts`). The id is ours.
        await supabase
          .from("chat_roles" as never)
          .insert(
            newChatRoleRow(
              chatId,
              { name: trimmed, colour: draft.colour, icon: draft.icon, priority: draft.priority },
              me,
              newChatId(),
            ) as never,
          );

    setBusy(false);
    if (written.error) {
      setError(prefixError("Не удалось сохранить роль", mapPgError(written.error)));
      return;
    }
    setDraft(null);
    roles.refresh();
  };

  const remove = async (role: ChatRole) => {
    const sure = await requestAppConfirm({
      title: `Удалить роль «${role.name}»?`,
      // Said plainly because the cascade is real and invisible otherwise: the
      // composite foreign key takes every assignment with the role.
      description: "Роль исчезнет у всех, кому она выдана. Участники останутся в группе.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!sure) return;
    setBusy(true);
    setError(null);
    const { error: removeError } = await supabase
      .from("chat_roles" as never)
      .delete()
      .eq("id", role.id);
    setBusy(false);
    if (removeError) {
      setError(prefixError("Не удалось удалить роль", mapPgError(removeError)));
      return;
    }
    roles.refresh();
  };

  return (
    <KubModal
      open={open}
      onClose={onClose}
      title="Роли группы"
      description="Своё название для участника — оно видно только в этой группе."
      icon={<KubIcon name="shield" size={18} />}
      size="md"
      scrollBody
      footer={
        <KubButton variant="ghost" onClick={onClose}>
          Готово
        </KubButton>
      }
    >
      <div className="space-y-3" data-testid="chat-roles-modal">
        {error && <KubNotice tone="danger">{error}</KubNotice>}
        {denial && denial !== "chat_full" && (
          <KubNotice tone="info" data-testid="chat-roles-denial">
            {chatRoleDenialText(denial)}
          </KubNotice>
        )}
        {roles.failed && (
          <KubNotice tone="danger">Не удалось прочитать роли группы. Попробуйте ещё раз.</KubNotice>
        )}

        {roles.ready && roles.roles.length === 0 && !draft && (
          <p className="text-sm text-[color:var(--kub-muted)]" data-testid="chat-roles-empty">
            В группе пока нет ролей.
          </p>
        )}

        <ul className="space-y-1" data-testid="chat-roles-list">
          {roles.roles.map((role) => (
            <li
              key={role.id}
              data-testid="chat-roles-row"
              data-role-id={role.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 kub-raise-hover"
            >
              <ChatRoleChip role={role} className="shrink-0" />
              <span className="min-w-0 flex-1" />
              {mayDefine && (
                <>
                  <button
                    type="button"
                    onClick={() => startEdit(role)}
                    aria-label={`Изменить роль «${role.name}»`}
                    data-testid="chat-roles-edit"
                    className="kub-icon-action h-8 w-8 shrink-0 rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
                  >
                    <KubIcon name="edit" size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(role)}
                    aria-label={`Удалить роль «${role.name}»`}
                    data-testid="chat-roles-delete"
                    className="kub-icon-action h-8 w-8 shrink-0 rounded-lg text-[color:var(--kub-danger)] transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
                  >
                    <KubIcon name="delete" size={15} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>

        {draft && (
          <div className="space-y-3 rounded-xl bg-[color:var(--kub-surface-2)] p-3" data-testid="chat-roles-form">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--kub-muted)]">
                Название
              </span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Наставник, Дежурный…"
                data-testid="chat-roles-name"
                className="mt-1 w-full rounded-lg bg-[color:var(--kub-surface-3)] px-3 py-2 text-sm text-[color:var(--kub-text)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
              />
            </label>
            {draft.name.length > 0 && !nameValid && (
              <p className="text-xs text-[color:var(--kub-danger)]" data-testid="chat-roles-name-error">
                {`Название — от ${CHAT_ROLE_LIMITS.nameMin} до ${CHAT_ROLE_LIMITS.nameMax} символов.`}
              </p>
            )}
            {nameTaken && (
              <p className="text-xs text-[color:var(--kub-danger)]" data-testid="chat-roles-name-taken">
                Такая роль в группе уже есть.
              </p>
            )}

            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--kub-muted)]">
                Цвет
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5" data-testid="chat-roles-colours">
                {CHAT_ROLE_COLOURS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setDraft({ ...draft, colour: entry.key })}
                    aria-label={entry.label}
                    aria-pressed={draft.colour === entry.key}
                    data-testid={`chat-roles-colour-${entry.key}`}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
                      draft.colour === entry.key ? "scale-110" : "border-transparent",
                    )}
                    style={{
                      backgroundColor: `color-mix(in srgb, ${chatRoleColourValue(entry.key)} 30%, transparent)`,
                      borderColor:
                        draft.colour === entry.key ? chatRoleColourValue(entry.key) : undefined,
                    }}
                  />
                ))}
              </div>
            </div>

            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--kub-muted)]">
                Значок
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5" data-testid="chat-roles-icons">
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, icon: null })}
                  aria-label="Без значка"
                  aria-pressed={draft.icon === null}
                  data-testid="chat-roles-icon-none"
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg border text-[color:var(--kub-muted)]",
                    draft.icon === null
                      ? "border-[color:var(--kub-cyan)]"
                      : "border-[color:var(--kub-border-color)]",
                  )}
                >
                  <KubIcon name="close" size={13} />
                </button>
                {ROLE_ICONS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setDraft({ ...draft, icon: name })}
                    aria-label={name}
                    aria-pressed={draft.icon === name}
                    data-testid={`chat-roles-icon-${name}`}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg border text-[color:var(--kub-text)]",
                      draft.icon === name
                        ? "border-[color:var(--kub-cyan)]"
                        : "border-[color:var(--kub-border-color)]",
                    )}
                  >
                    <KubIcon name={name} size={14} />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <KubButton variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                Отмена
              </KubButton>
              <KubButton onClick={() => void save()} disabled={!canSave} data-testid="chat-roles-save">
                {draft.id ? "Сохранить" : "Создать"}
              </KubButton>
            </div>
          </div>
        )}

        {mayDefine && !draft && (
          <KubButton
            variant="ghost"
            onClick={startNew}
            data-testid="chat-roles-new"
            className="w-full justify-start"
          >
            <KubIcon name="create" size={15} className="mr-2 shrink-0" />
            Новая роль
          </KubButton>
        )}
        {denial === "chat_full" && (
          <KubNotice tone="info" data-testid="chat-roles-full">
            {chatRoleDenialText("chat_full")}
          </KubNotice>
        )}
      </div>
    </KubModal>
  );
}

/**
 * Where a new role sits: above everything that exists.
 *
 * The owner is inventing it now and the thing you invent last is usually the
 * thing you care about; putting it at the bottom of twenty-five would make the
 * first thing after creating it a reorder. `priority` is not unique, so a
 * collision is harmless — the index breaks ties by name.
 */
function nextPriority(roles: readonly ChatRole[]): number {
  return roles.reduce((highest, role) => Math.max(highest, role.priority), 0) + 10;
}
