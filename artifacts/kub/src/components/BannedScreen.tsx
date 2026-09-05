"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubIcon, KubLogo } from "@/components/kub";
import type { Ban } from "@/types/database";

interface Props {
  ban: Ban & { issuer?: { full_name: string | null; username: string | null } | null };
}

export function BannedScreen({ ban }: Props) {
  const supabase = createClient();
  const [secondsLeft, setSecondsLeft] = useState(8);

  useEffect(() => {
    const tick = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    const timeout = setTimeout(() => { supabase.auth.signOut(); }, 8000);
    return () => { clearInterval(tick); clearTimeout(timeout); };
  }, [supabase]);

  const expires = ban.expires_at ? new Date(ban.expires_at) : null;
  const issued = new Date(ban.created_at);
  const issuer =
    ban.issuer?.full_name ||
    (ban.issuer?.username ? `@${ban.issuer.username}` : "администратор");

  const fmt = (d: Date) => d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    // `kub-grid-bg` already sets --kub-bg as its own background-colour, so the
    // fill that used to sit here was a second copy of it.
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 kub-grid-bg text-[color:var(--kub-text)]">
      {/* This is a full-screen state rather than an overlay, so the question is
          whether there is anything under the card worth showing — and there is:
          the shell paints the lattice and both radial glows behind it. The card
          is `-strong` because it covers them, and it drops `shadow-2xl` because
          --glass-shadow is already one. */}
      <div className="kub-glass-strong relative w-full max-w-md rounded-2xl p-8 text-center border border-[color:var(--kub-danger)]/40 kub-cut">
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-50">
          <KubLogo size={28} />
        </div>

        <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4 bg-[color-mix(in_srgb,var(--kub-danger)_18%,transparent)] border border-[color:var(--kub-danger)]/40">
          <KubIcon name="ban" size={30} tone="danger" label="Заблокирован" />
        </div>

        <h1 className="text-xl font-bold mb-1 text-[color:var(--kub-text)]">
          Доступ ограничен
        </h1>
        <p className="text-[10px] uppercase tracking-[0.18em] mb-6 text-[color:var(--kub-danger-text)]">
          LETSCUBE
        </p>

        {/* A read-only block of facts, so it is cut into the card. The veil was
            tried here first and is measurably wrong for it: it is denser than
            the surface --kub-danger-text was chosen against, and "Бессрочно"
            fell to 4.33:1. On --kub-inset it is 6.54:1 dark, up from the
            5.85:1 this block gave before the pass, and 5.44:1 light, which is
            exactly what it was. */}
        <div className="rounded-xl p-4 text-left text-sm space-y-3 bg-[var(--kub-inset)] border border-[color:var(--kub-border-color)]">
          <Row label="Причина" value={ban.reason} mono />
          <Row label="Кто заблокировал" value={issuer} />
          <Row label="Когда" value={fmt(issued)} />
          <Row
            label="До какой даты"
            value={expires ? fmt(expires) : "Бессрочно"}
            danger={!expires}
          />
        </div>

        <KubButton
          onClick={() => supabase.auth.signOut()}
          variant="danger"
          fullWidth
          size="lg"
          leftIcon={<KubIcon name="logout" size={16} />}
          className="mt-6"
        >
          Выйти{secondsLeft > 0 ? ` (${secondsLeft})` : ""}
        </KubButton>
      </div>
    </div>
  );
}

function Row({ label, value, mono, danger }: {
  label: string; value: string; mono?: boolean; danger?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--kub-accent-text)]">
        {label}
      </span>
      <span className={`${mono ? "font-medium break-words" : "font-medium"} ${danger ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-text)]"}`}>
        {value}
      </span>
    </div>
  );
}
