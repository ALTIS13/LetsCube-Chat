"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubIcon, KubModal } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { cn } from "@/lib/utils";
import { createGroupInvite, formatGroupInviteError, GROUP_INVITES_MIGRATION_REQUIRED, isGroupInviteUnavailableError } from "@/lib/groupInvites";
import type { GroupInviteStatus } from "@/lib/groupInvites";
import type { GroupInvite, Profile } from "@/types/database";

interface GroupInviteModalProps {
  chatId: string;
  chatName: string;
  currentUserId: string | null;
  memberIds: string[];
  onClose: () => void;
}

type CandidateStatus = "self" | "member" | "pending" | "sent" | "declined" | "cancelled" | "expired" | "former" | "available";

export function GroupInviteModal({
  chatId,
  chatName,
  currentUserId,
  memberIds,
  onClose,
}: GroupInviteModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const memberIdSet = useMemo(() => new Set(memberIds), [memberIds]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [inviteStatuses, setInviteStatuses] = useState<Record<string, GroupInviteStatus>>({});
  const [sentInviteeIds, setSentInviteeIds] = useState<Set<string>>(new Set());
  const [loadingResults, setLoadingResults] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("group_invites")
      .select("invitee_id,status")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          if (isGroupInviteUnavailableError(err)) {
            setMigrationRequired(true);
            setMessage(GROUP_INVITES_MIGRATION_REQUIRED);
            return;
          }
          setError(formatGroupInviteError(err, "Не удалось загрузить приглашения."));
          return;
        }
        const next: Record<string, GroupInviteStatus> = {};
        for (const row of (data ?? []) as Pick<GroupInvite, "invitee_id" | "status">[]) {
          if (!next[row.invitee_id]) next[row.invitee_id] = row.status;
        }
        setInviteStatuses(next);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, supabase]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoadingResults(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoadingResults(true);
      const safeQuery = escapeSupabasePattern(trimmed);
      const { data, error: searchError } = await supabase
        .from("profiles")
        .select("*")
        .or(`full_name.ilike.%${safeQuery}%,username.ilike.%${safeQuery}%`)
        .limit(20);
      if (cancelled) return;
      setLoadingResults(false);
      if (searchError) {
        setError("Не удалось найти пользователей.");
        setResults([]);
        return;
      }
      setError(null);
      setResults((data as Profile[] | null) ?? []);
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, supabase]);

  const handleInvite = async (user: Profile) => {
    if (migrationRequired || !currentUserId || sendingId) return;
    setError(null);
    setMessage(null);
    setSendingId(user.id);
    const result = await createGroupInvite(supabase, chatId, user.id);
    setSendingId(null);

    if (!result.ok) {
      if (result.migrationRequired) setMigrationRequired(true);
      setError(result.message);
      return;
    }

    setSentInviteeIds((current) => new Set(current).add(user.id));
    setInviteStatuses((current) => ({ ...current, [user.id]: "pending" }));
    setMessage(`Приглашение отправлено: ${displayName(user)}.`);
  };

  return (
    <KubModal
      open={true}
      onClose={onClose}
      title="Пригласить пользователя"
      description={chatName}
      icon={<KubIcon name="userPlus" size={16} />}
      size="md"
      contentClassName="space-y-3"
      footer={(
        <KubButton variant="secondary" onClick={onClose}>
          Закрыть
        </KubButton>
      )}
    >
      <div className="flex items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 h-10 transition-all focus-within:border-[color:var(--kub-cyan)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)]">
        <KubIcon name="search" size={14} className="shrink-0 text-[color:var(--kub-muted)]" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по имени или @никнейму…"
          className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
        />
      </div>

      {message && (
        <div className="flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--kub-cyan)_35%,transparent)] bg-[color-mix(in_srgb,var(--kub-cyan)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-cyan)]">
          <KubIcon name="info" size={14} className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-danger)]">
          <KubIcon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="max-h-[min(56vh,360px)] overflow-y-auto -mx-1 px-1">
        {query.trim().length < 2 ? (
          <EmptyInviteState text="Введите минимум 2 символа для поиска пользователя." />
        ) : loadingResults ? (
          <EmptyInviteState text="Ищем пользователей…" />
        ) : results.length === 0 ? (
          <EmptyInviteState text="Пользователи не найдены." />
        ) : (
          <div className="space-y-1">
            {results.map((user) => {
              const status = getCandidateStatus(user.id, currentUserId, memberIdSet, inviteStatuses, sentInviteeIds);
              const canInvite = canInviteCandidate(status);
              const disabled = migrationRequired || !canInvite || sendingId !== null;
              return (
                <div
                  key={user.id}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--kub-surface-2)]"
                >
                  <UserAvatar user={user} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[color:var(--kub-text)]">{displayName(user)}</div>
                    <div className="truncate text-xs text-[color:var(--kub-muted)]">
                      {user.username ? `@${user.username}` : roleLabel(user.role)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleInvite(user)}
                    disabled={disabled}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-xs font-semibold transition-colors",
                      canInvite && !migrationRequired
                        ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] hover:bg-[var(--kub-cyan-hover)]"
                        : "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)]",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                    )}
                  >
                    {sendingId === user.id ? "Отправка..." : statusLabel(status, migrationRequired)}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </KubModal>
  );
}

function EmptyInviteState({ text }: { text: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-[color:var(--kub-border-color)] px-4 text-center text-xs text-[color:var(--kub-muted)]">
      {text}
    </div>
  );
}

function getCandidateStatus(
  userId: string,
  currentUserId: string | null,
  memberIdSet: Set<string>,
  inviteStatuses: Record<string, GroupInviteStatus>,
  sentInviteeIds: Set<string>,
): CandidateStatus {
  if (userId === currentUserId) return "self";
  if (memberIdSet.has(userId)) return "member";
  if (sentInviteeIds.has(userId)) return "sent";
  const inviteStatus = inviteStatuses[userId];
  if (inviteStatus === "accepted") return "former";
  if (inviteStatus) return inviteStatus;
  return "available";
}

function statusLabel(status: CandidateStatus, migrationRequired: boolean): string {
  if (migrationRequired) return "Недоступно";
  if (status === "self") return "Это вы";
  if (status === "member") return "Уже в чате";
  if (status === "pending" || status === "sent") return "Приглашение отправлено";
  if (status === "former" || status === "declined" || status === "cancelled" || status === "expired") return "Пригласить снова";
  return "Пригласить";
}

function canInviteCandidate(status: CandidateStatus): boolean {
  return status === "available" || status === "former" || status === "declined" || status === "cancelled" || status === "expired";
}

function displayName(user: Profile): string {
  return user.full_name ?? user.username ?? "Без имени";
}

function roleLabel(role: Profile["role"]): string {
  if (role === "admin") return "Администратор";
  if (role === "manager") return "Менеджер";
  return "Пользователь";
}

function escapeSupabasePattern(value: string): string {
  return value.replace(/[%_,]/g, " ").trim();
}
