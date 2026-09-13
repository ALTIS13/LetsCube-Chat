import type { ReactNode } from "react";
import { KubIcon } from "@/components/kub";
import { FOCUS_RING } from "@/lib/controlSurface";
import type { ChatSettingsRow, ChatSettingsRowId } from "@/lib/chatSettings";
import type { InvitePolicy } from "@/lib/groupInvites";
import { cn } from "@/lib/utils";

interface ChatSettingsViewProps {
  rows: readonly ChatSettingsRow[];
  /** The picture and its camera badge, built by the panel that owns the upload. */
  avatar: ReactNode;
  canEditProfile: boolean;
  name: string;
  nameMaxLength: number;
  onNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  /** Which row has opened its choice, and the way to open one. */
  openRow: ChatSettingsRowId | null;
  onOpenRowChange: (id: ChatSettingsRowId | null) => void;
  invitePolicy: InvitePolicy | null;
  invitePolicySupported: boolean;
  invitePolicySaving: boolean;
  invitePolicyError: string | null;
  invitePolicyNotice: string | null;
  onInvitePolicyChange: (next: InvitePolicy) => void;
  topicsBusy: boolean;
  onToggleTopics: () => void;
  onNavigate: (id: ChatSettingsRowId) => void;
  onDelete: () => void;
}

const ROW = "flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm";
/**
 * The value takes the space the label does not need, and truncates first.
 *
 * Measured on a 390-point phone: with both halves growing, «Кто может
 * приглашать» came out as «Кто может пригл…» beside a value that had room to
 * spare. The label is what a person is looking for when they scan the screen,
 * so it keeps its own width and the value gives way.
 */
const VALUE = "min-w-0 flex-1 truncate text-right text-[13px] text-[color:var(--kub-muted)]";
const LABEL = "min-w-0 truncate";

/**
 * A group's settings, on their own screen (D-164).
 *
 * The pencil used to set `editing = true`, which swapped the card's title and
 * subtitle for a name box and a description box and offered no way out but to
 * save. Everything else a group has — who may invite, topics, who runs it — sat
 * on the information tab in front of people who cannot change any of it.
 *
 * This is the arrangement the owner's reference uses and the one the register
 * asked for: a view inside the same card, entered by the pencil and left by the
 * back arrow, one row per setting **with its current value on the right**. The
 * value is what makes the screen readable without opening anything, and it is
 * shown to people who may not change the setting too, because a rule about the
 * group they are in is a fact they are entitled to.
 *
 * A choice opens where it stands rather than pushing a third screen: there are
 * two options, and a screen to hold two buttons is a screen nobody needs.
 */
export function ChatSettingsView({
  rows,
  avatar,
  canEditProfile,
  name,
  nameMaxLength,
  onNameChange,
  description,
  onDescriptionChange,
  openRow,
  onOpenRowChange,
  invitePolicy,
  invitePolicySupported,
  invitePolicySaving,
  invitePolicyError,
  invitePolicyNotice,
  onInvitePolicyChange,
  topicsBusy,
  onToggleTopics,
  onNavigate,
  onDelete,
}: ChatSettingsViewProps) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4" data-testid="chat-settings-view">
      <div className="flex flex-col items-center gap-3">
        {avatar}
        <div className="w-full space-y-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
              Название
            </span>
            <input
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={nameMaxLength}
              disabled={!canEditProfile}
              data-testid="chat-settings-name"
              className={cn(
                "w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-sm text-[color:var(--kub-text)] disabled:text-[color:var(--kub-muted)]",
                FOCUS_RING,
              )}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
              Описание
            </span>
            <textarea
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="О чём эта группа"
              rows={3}
              disabled={!canEditProfile}
              data-testid="chat-settings-description"
              className={cn(
                "w-full resize-none rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-sm text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)] disabled:text-[color:var(--kub-muted)]",
                FOCUS_RING,
              )}
            />
          </label>
        </div>
      </div>

      {/* `--kub-rule`, not `--kub-border-color`: inside a sheet the heavier
          token is the edge of the sheet itself, and a divider drawn in it reads
          as a second edge. `tests/unit/edge-vocabulary.test.mjs` refuses the
          heavier one here by name. */}
      <div className="flex flex-col gap-1 border-t border-[color:var(--kub-rule)] pt-3">
        {rows.map((row) => {
          if (row.id === "delete") {
            return (
              <button
                key={row.id}
                type="button"
                onClick={onDelete}
                data-testid="chat-settings-row-delete"
                className={cn(ROW, "kub-interactive text-[color:var(--kub-danger-text)] kub-raise-hover", FOCUS_RING)}
              >
                <KubIcon name="delete" size={17} tone="danger" className="shrink-0" />
                <span className={LABEL}>{row.label}</span>
              </button>
            );
          }

          if (row.id === "topics") {
            return (
              <button
                key={row.id}
                type="button"
                onClick={onToggleTopics}
                disabled={!row.editable || topicsBusy}
                data-testid="chat-settings-row-topics"
                data-settings-value={row.value ?? ""}
                className={cn(ROW, "kub-interactive text-[color:var(--kub-text)] kub-raise-hover", FOCUS_RING)}
              >
                <KubIcon name="hash" size={17} tone="muted" className="shrink-0" />
                <span className={LABEL}>{row.label}</span>
                <span className={VALUE}>{row.value}</span>
              </button>
            );
          }

          if (row.id === "invites") {
            const open = openRow === "invites";
            return (
              <div key={row.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => onOpenRowChange(open ? null : "invites")}
                  disabled={!row.editable}
                  data-testid="chat-settings-row-invites"
                  data-settings-value={row.value ?? ""}
                  aria-expanded={open}
                  className={cn(ROW, "kub-interactive text-[color:var(--kub-text)] kub-raise-hover", FOCUS_RING)}
                >
                  <KubIcon name="userPlus" size={17} tone="muted" className="shrink-0" />
                  <span className={LABEL}>{row.label}</span>
                  <span className={VALUE}>{row.value}</span>
                  {row.editable && (
                    <KubIcon name={open ? "chevronUp" : "chevronDown"} size={14} tone="muted" className="shrink-0" />
                  )}
                </button>
                {open && row.editable && (
                  <div className="grid grid-cols-2 gap-1 px-3 pb-2 pt-1">
                    {(
                      [
                        ["owner_admin_only", "Только администраторы"],
                        ["members_can_invite", "Все участники"],
                      ] as ReadonlyArray<readonly [InvitePolicy, string]>
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        disabled={!invitePolicySupported || invitePolicySaving}
                        onClick={() => onInvitePolicyChange(value)}
                        data-testid={`chat-settings-invite-${value}`}
                        className={cn(
                          "h-9 rounded-lg px-2 text-xs font-semibold transition-colors",
                          "disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed",
                          invitePolicy === value
                            ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                            : "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)] kub-raise-hover",
                          FOCUS_RING,
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {open && invitePolicyNotice && (
                  <p className="px-3 pb-2 text-xs text-[color:var(--kub-muted)]">{invitePolicyNotice}</p>
                )}
                {invitePolicyError && (
                  <p className="px-3 pb-2 text-xs text-[color:var(--kub-danger-text)]">{invitePolicyError}</p>
                )}
              </div>
            );
          }

          return (
            <button
              key={row.id}
              type="button"
              onClick={() => onNavigate(row.id)}
              data-testid={`chat-settings-row-${row.id}`}
              data-settings-value={row.value ?? ""}
              className={cn(ROW, "kub-interactive text-[color:var(--kub-text)] kub-raise-hover", FOCUS_RING)}
            >
              <KubIcon
                name={row.id === "administrators" ? "shield" : row.id === "members" ? "users" : "image"}
                size={17}
                tone="muted"
                className="shrink-0"
              />
              <span className={LABEL}>{row.label}</span>
              <span className={VALUE}>{row.value}</span>
              <KubIcon name="chevronRight" size={14} tone="muted" className="shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
