"use client";

import { useEffect, useMemo, useState } from "react";
import { KubIcon } from "@/components/kub";
import { usePrivacyPreferences } from "@/hooks/usePrivacyPreferences";
import { FOCUS_RING_INSET } from "@/lib/controlSurface";
import { PHONE_FIND_OPTIONS, phoneFindNote } from "@/lib/phoneFindability";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";

/**
 * «Кто может найти меня по номеру» — Telegram's two answers (tracker item 74,
 * `lib/phoneFindability.ts`). Saved with the rest of the privacy row, at once,
 * as the switches beside it are.
 *
 * Mounted only while its row is open, so the one read it makes — whether the
 * person's own number is verified — costs nothing until somebody asks.
 */
export function PhoneSearchSetting() {
  const privacy = usePrivacyPreferences();
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const supabase = useMemo(() => createClient(), []);
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    setVerified(null);
    if (!userId) return;
    let cancelled = false;
    void supabase
      .from("profile_contacts")
      .select("phone_verified")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setVerified(data?.phone_verified === true);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  const chosen = privacy.preferences.phoneFindableBy;

  return (
    <div className="grid gap-2" data-testid="phone-search-setting" data-verified={verified === null ? "unknown" : String(verified)}>
      <div role="radiogroup" aria-label="Кто может найти меня по номеру" className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
        {PHONE_FIND_OPTIONS.map((option) => {
          const selected = chosen === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!privacy.ready}
              onClick={() => {
                if (!selected) void privacy.setPhoneFindableBy(option.id);
              }}
              data-testid={`phone-search-option-${option.id}`}
              className={cn(
                "flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm text-[color:var(--kub-text)] transition-colors kub-raise-hover",
                FOCUS_RING_INSET,
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate">{option.label}</span>
                <span className="text-xs text-[color:var(--kub-muted)]">{option.hint}</span>
              </span>
              {selected && <KubIcon name="check" size={14} tone="accent" />}
            </button>
          );
        })}
      </div>
      <p className="px-3 text-xs leading-relaxed text-[color:var(--kub-muted)]" data-testid="phone-search-note">
        {phoneFindNote({ verified })}
      </p>
    </div>
  );
}
