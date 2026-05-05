"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubIcon, KubPanel, type KubIconName } from "@/components/kub";
import type { Ban, Mute, Profile, Chat } from "@/types/database";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { prefixError } from "@/lib/errors";

type BanRow = Ban & {
  user?: Pick<Profile, "id" | "full_name" | "username" | "avatar_url"> | null;
  issuer?: Pick<Profile, "full_name" | "username"> | null;
};

type MuteRow = Mute & {
  user?: Pick<Profile, "id" | "full_name" | "username" | "avatar_url"> | null;
  issuer?: Pick<Profile, "full_name" | "username"> | null;
  chat?: Pick<Chat, "id" | "name"> | null;
};

const fmt = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("ru-RU", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "бессрочно";

export function BansMutesTab() {
  const supabase = createClient();
  const [bans, setBans] = useState<BanRow[]>([]);
  const [mutes, setMutes] = useState<MuteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showExpired, setShowExpired] = useState(false);
  const [bansOpen, setBansOpen] = useState(true);
  const [mutesOpen, setMutesOpen] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const [bansRes, mutesRes] = await Promise.all([
      (() => {
        let q = supabase
          .from("bans")
          .select("*, user:profiles!bans_user_id_fkey(id,full_name,username,avatar_url), issuer:profiles!bans_issued_by_fkey(full_name,username)")
          .order("created_at", { ascending: false })
          .limit(200);
        if (!showExpired) q = q.or(`expires_at.is.null,expires_at.gt.${nowIso}`);
        return q;
      })(),
      (() => {
        let q = supabase
          .from("mutes")
          .select("*, user:profiles!mutes_user_id_fkey(id,full_name,username,avatar_url), issuer:profiles!mutes_issued_by_fkey(full_name,username), chat:chats!mutes_chat_id_fkey(id,name)")
          .order("created_at", { ascending: false })
          .limit(200);
        if (!showExpired) q = q.or(`expires_at.is.null,expires_at.gt.${nowIso}`);
        return q;
      })(),
    ]);
    const bansData = (bansRes.data ?? []) as unknown;
    const mutesData = (mutesRes.data ?? []) as unknown;
    setBans(bansData as BanRow[]);
    setMutes(mutesData as MuteRow[]);
    setLoading(false);
  }, [supabase, showExpired]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void load();
      }, 500);
    };
    const channel = supabase
      .channel("admin-bans-mutes")
      .on("postgres_changes", { event: "*", schema: "public", table: "bans" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "mutes" }, debouncedLoad)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  const removeBan = async (id: string) => {
    const { error } = await supabase.from("bans").delete().eq("id", id);
    if (error) { alert(prefixError("Не удалось снять блокировку", error)); return; }
    setBans((b) => b.filter((x) => x.id !== id));
  };

  const removeMute = async (id: string) => {
    const { error } = await supabase.from("mutes").delete().eq("id", id);
    if (error) { alert(prefixError("Не удалось снять мьют", error)); return; }
    setMutes((m) => m.filter((x) => x.id !== id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-[color:var(--kub-text)]">
          Блокировки и мьюты
        </h2>
        <label className="flex items-center gap-2 text-xs cursor-pointer text-[color:var(--kub-muted)]">
          <input
            type="checkbox"
            checked={showExpired}
            onChange={(e) => setShowExpired(e.target.checked)}
            className="accent-[color:var(--kub-cyan)]"
          />
          Показать истёкшие
        </label>
      </div>

      <CollapsibleSection
        title="Активные баны"
        icon="shieldOff"
        accentVar="--kub-danger"
        count={bans.length}
        open={bansOpen}
        setOpen={setBansOpen}
      >
        {bans.length === 0 ? (
          <Empty text="Активных банов нет" />
        ) : (
          bans.map((b) => {
            const expired = b.expires_at && new Date(b.expires_at).getTime() < Date.now();
            return (
              <RowCard
                key={b.id}
                user={b.user as Profile | null | undefined}
                fallbackId={b.user_id}
                expired={!!expired}
                reason={b.reason}
                meta={`${b.issuer?.full_name ?? "—"} · ${fmt(b.created_at)} → ${fmt(b.expires_at)}`}
                onRemove={() => removeBan(b.id)}
              />
            );
          })
        )}
      </CollapsibleSection>

      <div className="h-3" />

      <CollapsibleSection
        title="Активные мьюты"
        icon="muted"
        accentVar="--kub-warn"
        count={mutes.length}
        open={mutesOpen}
        setOpen={setMutesOpen}
      >
        {mutes.length === 0 ? (
          <Empty text="Активных мьютов нет" />
        ) : (
          mutes.map((m) => {
            const expired = m.expires_at && new Date(m.expires_at).getTime() < Date.now();
            return (
              <RowCard
                key={m.id}
                user={m.user as Profile | null | undefined}
                fallbackId={m.user_id}
                expired={!!expired}
                reason={m.reason}
                meta={`${m.chat ? `в «${m.chat.name ?? m.chat.id.slice(0, 8)}»` : "везде"} · ${m.issuer?.full_name ?? "—"} · ${fmt(m.created_at)} → ${fmt(m.expires_at)}`}
                onRemove={() => removeMute(m.id)}
              />
            );
          })
        )}
      </CollapsibleSection>
    </div>
  );
}

function CollapsibleSection({
  title, icon, accentVar, count, open, setOpen, children,
}: {
  title: string;
  icon: KubIconName;
  accentVar: string;
  count: number;
  open: boolean;
  setOpen: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const accent = `var(${accentVar})`;
  return (
    <KubPanel className="overflow-hidden p-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 h-12 text-left hover:bg-[var(--kub-surface-2)] transition-colors"
      >
        <KubIcon name={open ? "chevronDown" : "chevronRight"} size={16} tone="muted" />
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${accent} 18%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 38%, transparent)` }}
        >
          <KubIcon name={icon} size={13} tone="default" />
        </div>
        <div className="flex-1 text-sm font-bold text-[color:var(--kub-text)]">
          {title}
        </div>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]">
          {count}
        </span>
      </button>
      {open && <div>{children}</div>}
    </KubPanel>
  );
}

function RowCard({
  user, fallbackId, expired, reason, meta, onRemove,
}: {
  user: Profile | null | undefined;
  fallbackId: string;
  expired: boolean;
  reason: string;
  meta: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-t border-[color:var(--kub-border-color)]">
      {user ? (
        <UserAvatar user={user as Profile} size="sm" />
      ) : (
        <div className="w-9 h-9 rounded-full flex-shrink-0 bg-[var(--kub-surface-2)]" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-[color:var(--kub-text)]">
          {user?.full_name ?? fallbackId.slice(0, 8)}
          {user?.username && (
            <span className="ml-2 text-xs font-normal text-[color:var(--kub-muted)]">
              @{user.username}
            </span>
          )}
          {expired && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]">
              истёк
            </span>
          )}
        </div>
        <div className="text-xs mt-0.5 break-words text-[color:var(--kub-text)]">{reason}</div>
        <div className="text-[11px] mt-1 break-words text-[color:var(--kub-muted)]">{meta}</div>
      </div>
      <button
        onClick={onRemove}
        aria-label="Снять ограничение"
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-[var(--kub-surface-2)] flex-shrink-0 text-[color:var(--kub-cyan)]"
      >
        <KubIcon name="rotate" size={12} />
        Снять
      </button>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-center py-8 text-sm text-[color:var(--kub-muted)]">
      {text}
    </div>
  );
}
