"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { KubBrandLogo, KubButton, KubIcon, KubPanel } from "@/components/kub";
import { useTheme } from "@/hooks/useTheme";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { chatAddressPath } from "@/lib/chatRoute";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import {
  inviteLinkErrorText,
  invitePreviewStateText,
  joinTokenFromPath,
  memberCountLabel,
  type InvitePreviewState,
} from "@/lib/chatInviteLinks";
import { clearPendingJoin } from "@/lib/pendingJoin";
import { FOCUS_RING } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";

interface Preview {
  state: InvitePreviewState;
  chatId: string | null;
  name: string | null;
  avatarUrl: string | null;
  memberCount: number | null;
}

const KNOWN_STATES: readonly InvitePreviewState[] = ["ok", "member", "invalid", "revoked", "expired", "used_up", "unavailable"];

/**
 * `/join/<token>` — a link into a group (D-170).
 *
 * Signed in only: the app sends a guest to sign-in first and brings them back
 * here (`lib/pendingJoin.ts`). What a person sees before joining is the owner's
 * answer, ± Telegram: the group's picture, its name and how many are in it, and
 * one button. A dead link says why and names nothing.
 */
export function JoinPage() {
  const supabase = useMemo(() => createClient(), []);
  const [location, setLocation] = useLocation();
  const token = joinTokenFromPath(location);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    clearPendingJoin();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setPreview({ state: "invalid", chatId: null, name: null, avatarUrl: null, memberCount: null });
      return () => { cancelled = true; };
    }
    void (async () => {
      const { data, error: previewError } = await supabase.rpc("chat_invite_link_preview", { p_token: token });
      if (cancelled) return;
      const row = Array.isArray(data) ? data[0] : null;
      if (previewError || !row) {
        setFailed(true);
        return;
      }
      const state = KNOWN_STATES.includes(row.state as InvitePreviewState) ? (row.state as InvitePreviewState) : "invalid";
      setPreview({
        state,
        chatId: row.chat_id,
        name: row.name,
        avatarUrl: row.avatar_url,
        memberCount: row.member_count,
      });
    })();
    return () => { cancelled = true; };
  }, [supabase, token]);

  const join = async () => {
    if (!token || joining) return;
    setJoining(true);
    setError(null);
    const { data, error: joinError } = await supabase.rpc("chat_invite_link_join", { p_token: token });
    if (joinError || !data) {
      setJoining(false);
      setError(inviteLinkErrorText(joinError, "Не удалось вступить. Попробуйте ещё раз."));
      return;
    }
    dispatchChatsRefresh({ reason: "membership-change", chatId: data });
    setLocation(chatAddressPath(data), { replace: true });
  };

  const open = () => {
    if (preview?.chatId) setLocation(chatAddressPath(preview.chatId), { replace: true });
  };

  const deadText = preview ? invitePreviewStateText(preview.state) : null;

  return (
    <div className="flex justify-center px-4 kub-grid-bg kub-auth-shell" data-testid="join-page">
      {/* `my-auto`: the shell centres its one column, as it does the sign-in
          form, whose marker this page must not borrow — tests read it as
          «the sign-in form is on screen». */}
      <div className="relative z-10 my-auto w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <KubBrandLogo
            variant="vertical"
            tone={resolvedTheme === "light" ? "dark" : "light"}
            className="h-20 w-48 justify-center"
            imgClassName="max-h-20"
            alt="LETSCUBE"
          />
        </div>
        <KubPanel glow="soft" className="flex flex-col items-center gap-4 text-center">
          {failed ? (
            <>
              <KubIcon name="alert" size={28} className="text-[color:var(--kub-muted)]" />
              <p className="text-sm text-[color:var(--kub-text)]" data-testid="join-failed">
                Не удалось открыть приглашение. Проверьте соединение и обновите страницу.
              </p>
            </>
          ) : !preview ? (
            <p className="py-6 text-sm text-[color:var(--kub-muted)]" role="status">Открываем приглашение…</p>
          ) : deadText ? (
            <>
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]">
                <KubIcon name="link" size={26} />
              </span>
              <p className="text-sm text-[color:var(--kub-text)]" data-testid="join-dead" data-join-state={preview.state}>
                {deadText}
              </p>
              <KubButton variant="secondary" onClick={() => setLocation("/", { replace: true })}>
                К чатам
              </KubButton>
            </>
          ) : (
            <>
              <ChatAvatar
                chat={{ id: preview.chatId ?? "join", name: preview.name, avatar_url: preview.avatarUrl, type: "group" }}
                size="xl"
              />
              <div className="min-w-0 space-y-1">
                <h1 className="break-words text-lg font-bold text-[color:var(--kub-text)]" data-testid="join-name">
                  {preview.name ?? "Сервер"}
                </h1>
                {preview.memberCount !== null && (
                  <p className="text-sm text-[color:var(--kub-muted)]" data-testid="join-count">
                    {memberCountLabel(preview.memberCount)}
                  </p>
                )}
              </div>
              {error && (
                <p className="text-xs text-[color:var(--kub-danger-text)]" role="alert">{error}</p>
              )}
              {preview.state === "member" ? (
                <KubButton className="w-full" onClick={open} data-testid="join-open">
                  Вы уже на сервере — открыть
                </KubButton>
              ) : (
                <KubButton className="w-full" onClick={() => void join()} disabled={joining} data-testid="join-button">
                  {joining ? "Присоединяемся…" : "Присоединиться к серверу"}
                </KubButton>
              )}
              <button
                type="button"
                onClick={() => setLocation("/", { replace: true })}
                className={cn("kub-button kub-interactive rounded-lg px-2 py-1 text-xs text-[color:var(--kub-muted)] kub-raise-hover", FOCUS_RING)}
              >
                Не сейчас
              </button>
            </>
          )}
        </KubPanel>
      </div>
    </div>
  );
}
