"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubCopyButton, KubIcon } from "@/components/kub";
import { copyWithFeedback } from "@/lib/actionFeedback";
import { requestAppConfirm } from "@/lib/appDialogs";
import { FOCUS_RING } from "@/lib/controlSurface";
import {
  DEFAULT_INVITE_LINK_EXPIRY,
  DEFAULT_INVITE_LINK_USES,
  INVITE_LINK_EXPIRY_CHOICES,
  INVITE_LINK_TITLE_MAX,
  INVITE_LINK_USES_CHOICES,
  inviteLinkErrorText,
  inviteLinkState,
  inviteLinkSummary,
  inviteLinkUrl,
  type InviteLinkExpiryId,
  type InviteLinkRow,
  type InviteLinkUsesId,
} from "@/lib/chatInviteLinks";
import { cn } from "@/lib/utils";
import { FIELD_SHELL } from "@/lib/fieldShell";

const LINK_COLUMNS = "id,token,title,created_by,created_at,expires_at,max_uses,uses,revoked_at";

/**
 * A group's links (D-170), where Telegram keeps them: beside inviting people by
 * name, as the other way in. A link is made with Telegram's two limits — how
 * long and how many — and is copied the moment it exists, because the only
 * thing anybody makes one for is to send it.
 */
export function ChatInviteLinksPanel({ chatId, currentUserId, canRevokeAny }: {
  chatId: string;
  currentUserId: string | null;
  /** The chat's owner or an administrator withdraws anybody's link; others only their own. */
  canRevokeAny: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [links, setLinks] = useState<InviteLinkRow[] | null>(null);
  const [expiry, setExpiry] = useState<InviteLinkExpiryId>(DEFAULT_INVITE_LINK_EXPIRY);
  const [uses, setUses] = useState<InviteLinkUsesId>(DEFAULT_INVITE_LINK_USES);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const load = useCallback(async () => {
    const { data, error: readError } = await supabase
      .from("chat_invite_links")
      .select(LINK_COLUMNS)
      .eq("chat_id", chatId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (readError) {
      setError("Не удалось загрузить ссылки. Проверьте соединение.");
      setLinks([]);
      return;
    }
    setNow(Date.now());
    setLinks((data ?? []) as InviteLinkRow[]);
  }, [chatId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    const { data, error: createError } = await supabase.rpc("chat_invite_link_create", {
      p_chat_id: chatId,
      p_expires_in_seconds: INVITE_LINK_EXPIRY_CHOICES.find((choice) => choice.id === expiry)?.seconds ?? null,
      p_max_uses: INVITE_LINK_USES_CHOICES.find((choice) => choice.id === uses)?.uses ?? null,
      p_title: title.trim() || null,
    });
    setCreating(false);
    if (createError || !data) {
      setError(inviteLinkErrorText(createError, "Не удалось создать ссылку. Попробуйте ещё раз."));
      return;
    }
    const made = data as InviteLinkRow;
    setNow(Date.now());
    setLinks((current) => [made, ...(current ?? []).filter((row) => row.id !== made.id)]);
    setTitle("");
    await copyWithFeedback(inviteLinkUrl(origin, made.token), {
      key: `invite-link:${made.id}`,
      success: "Ссылка создана и скопирована",
      error: "Ссылка создана, но не скопировалась",
    });
  };

  const revoke = async (row: InviteLinkRow) => {
    const confirmed = await requestAppConfirm({
      title: "Отозвать ссылку?",
      description: "По ней больше никто не войдёт. Те, кто уже вошёл, останутся на сервере.",
      confirmLabel: "Отозвать",
      tone: "danger",
      icon: "link",
    });
    if (!confirmed) return;
    setRevokingId(row.id);
    setError(null);
    const { error: revokeError } = await supabase.rpc("chat_invite_link_revoke", { p_link_id: row.id });
    setRevokingId(null);
    if (revokeError) {
      setError(inviteLinkErrorText(revokeError, "Не удалось отозвать ссылку. Попробуйте ещё раз."));
      return;
    }
    setLinks((current) => (current ?? []).filter((link) => link.id !== row.id));
  };

  return (
    <div className="space-y-4" data-testid="invite-links-panel">
      <section className="space-y-3" aria-label="Новая ссылка">
        <ChoiceRow<InviteLinkExpiryId>
          label="Срок действия"
          choices={INVITE_LINK_EXPIRY_CHOICES}
          value={expiry}
          onChange={setExpiry}
          testId="invite-link-expiry"
        />
        <ChoiceRow<InviteLinkUsesId>
          label="Сколько раз можно войти"
          choices={INVITE_LINK_USES_CHOICES}
          value={uses}
          onChange={setUses}
          testId="invite-link-uses"
        />
        <div className={FIELD_SHELL}>
          <KubIcon name="edit" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
          <input
            value={title}
            maxLength={INVITE_LINK_TITLE_MAX}
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="Название ссылки (необязательно)"
            aria-label="Название ссылки"
            data-testid="invite-link-title"
            className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
          />
        </div>
        <KubButton onClick={() => void create()} disabled={creating} className="w-full" data-testid="invite-link-create">
          <KubIcon name="link" size={14} />
          {creating ? "Создаём…" : "Создать ссылку"}
        </KubButton>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-danger-text)]">
          <KubIcon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="space-y-1" aria-label="Действующие ссылки">
        <div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
          Действующие ссылки
        </div>
        {links === null ? (
          <p className="px-2 py-3 text-xs text-[color:var(--kub-muted)]">Загружаем…</p>
        ) : links.length === 0 ? (
          <p className="px-2 py-3 text-xs text-[color:var(--kub-muted)]" data-testid="invite-links-empty">
            Ссылок пока нет. Созданную ссылку можно отправить кому угодно — по ней вступят без приглашения по имени.
          </p>
        ) : (
          links.map((row) => {
            const url = inviteLinkUrl(origin, row.token);
            const state = inviteLinkState(row, now);
            const mayRevoke = canRevokeAny || row.created_by === currentUserId;
            return (
              <div
                key={row.id}
                data-testid="invite-link-row"
                data-link-state={state}
                className="flex min-w-0 items-start gap-2 rounded-xl px-2 py-2"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]">
                  <KubIcon name="link" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  {/* The actions share the name's line, so the line under it has
                      the whole column: its end is the part worth reading —
                      when the link stops working. */}
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--kub-text)]" title={url}>
                      {row.title ?? url.replace(/^https?:\/\//, "")}
                    </div>
                    {state === "active" && (
                      <KubCopyButton value={url} label="Копировать" feedbackKey={`invite-link:${row.id}`} successTitle="Ссылка скопирована" />
                    )}
                    {mayRevoke && (
                      <button
                        type="button"
                        onClick={() => void revoke(row)}
                        disabled={revokingId !== null}
                        aria-label={`Отозвать ссылку ${row.title ?? ""}`.trim()}
                        title="Отозвать"
                        className={cn(
                          "kub-icon-action kub-interactive flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--kub-muted)] kub-raise-hover hover:text-[color:var(--kub-danger-text)] disabled:cursor-not-allowed",
                          FOCUS_RING,
                        )}
                      >
                        <KubIcon name="delete" size={15} />
                      </button>
                    )}
                  </div>
                  <div className="text-xs leading-4 text-[color:var(--kub-muted)]">{inviteLinkSummary(row, now)}</div>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function ChoiceRow<T extends string>({ label, choices, value, onChange, testId }: {
  label: string;
  choices: readonly { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  testId: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-[color:var(--kub-muted)]">{label}</div>
      <div role="radiogroup" aria-label={label} data-testid={testId} className="flex flex-wrap gap-1.5">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            role="radio"
            aria-checked={value === choice.id}
            onClick={() => onChange(choice.id)}
            className={cn(
              "min-w-0 max-w-full truncate rounded-full border px-3 py-1 text-xs transition-colors",
              value === choice.id
                ? "border-[color:var(--kub-accent-text)] bg-[color-mix(in_srgb,var(--kub-accent-text)_14%,transparent)] text-[color:var(--kub-text)]"
                : "border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)] kub-raise-hover",
              FOCUS_RING,
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
