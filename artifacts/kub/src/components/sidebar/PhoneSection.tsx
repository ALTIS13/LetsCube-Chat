"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { KubBadge, KubButton, KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";
import type { ProfileContact } from "@/types/database";
import { mapPgError } from "@/lib/errors";

/**
 * Settings → Phone section.
 *
 * Phone numbers live in the RLS-protected `profile_contacts` table —
 * NOT on `profiles` — so non-staff readers cannot see other users'
 * numbers at the data-access layer. This component manages the
 * caller's own row.
 *
 * Two save paths:
 *   1. Verified — `auth.updateUser({phone})` triggers a 6-digit SMS
 *      OTP; the user enters the code, we call `verifyOtp`, then the
 *      SECURITY DEFINER RPC `profile_phone_mark_verified()` mirrors
 *      the verified state into `profile_contacts`. The RPC re-checks
 *      `auth.users.phone_confirmed_at`, so the client cannot lie.
 *   2. Unverified — direct UPDATE on `profile_contacts`. The DB
 *      trigger normalises to E.164 and clamps `phone_verified=false`.
 *
 * If the project's SMS provider is not configured, `auth.updateUser`
 * fails with a recognisable error; we surface a friendly message and
 * leave only the unverified-save button available.
 */
export function PhoneSection() {
  const supabase = createClient();
  const currentUser = useAppStore((s) => s.currentUser);

  const [contact, setContact] = useState<ProfileContact | null>(null);
  const [phoneInput, setPhoneInput] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [stage, setStage] = useState<"idle" | "code-sent" | "unsupported">("idle");
  const [busy, setBusy] = useState<null | "send" | "verify" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const userId = currentUser?.id;
  const editingRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("profile_contacts")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setContact(data);
        if (!editingRef.current) setPhoneInput(data.phone ?? "");
      }
    };
    load();
    // Realtime: another tab or the verified-RPC will UPDATE this row.
    const ch = supabase
      .channel(`profile-contacts:${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profile_contacts", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as ProfileContact;
          setContact(row);
          if (!editingRef.current) setPhoneInput(row.phone ?? "");
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [userId, supabase]);

  if (!currentUser) return null;

  const storedPhone = contact?.phone ?? null;
  const verified = !!contact?.phone_verified;
  const normalised = normaliseE164(phoneInput);
  const isValid = normalised !== null;
  const dirty = (storedPhone ?? "") !== (normalised ?? "");
  const otpValid = /^\d{6}$/.test(code);

  const reset = () => { setError(null); setInfo(null); };

  const refreshSelf = async () => {
    const { data } = await supabase
      .from("profile_contacts")
      .select("*")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (data) setContact(data);
  };

  const sendCode = async () => {
    reset();
    if (!isValid || !normalised) {
      setError("Введите номер в формате +7 999 123 45 67");
      return;
    }
    setBusy("send");
    const { error: err } = await supabase.auth.updateUser({ phone: normalised });
    setBusy(null);
    if (err) {
      if (looksLikeProviderUnavailable(err.message)) {
        setStage("unsupported");
        setInfo("Подтверждение по SMS пока недоступно. Можно сохранить номер без проверки.");
      } else {
        setError(humanise(err.message));
      }
      return;
    }
    setStage("code-sent");
    setInfo(`Код из 6 цифр отправлен на ${normalised}`);
  };

  const verifyCode = async () => {
    reset();
    if (!normalised) return;
    if (!otpValid) {
      setError("Код должен состоять ровно из 6 цифр.");
      return;
    }
    setBusy("verify");
    const { error: vErr } = await supabase.auth.verifyOtp({
      phone: normalised,
      token: code,
      type: "phone_change",
    });
    if (vErr) {
      setBusy(null);
      setError(humanise(vErr.message));
      return;
    }
    const { error: rpcErr } = await supabase.rpc("profile_phone_mark_verified");
    if (rpcErr) {
      setBusy(null);
      setError(humanise(rpcErr.message));
      return;
    }
    await refreshSelf();
    setBusy(null);
    setStage("idle");
    setCode("");
    editingRef.current = false;
    setInfo("Телефон подтверждён.");
  };

  const saveUnverified = async () => {
    reset();
    if (!isValid || !normalised) {
      setError("Введите номер в формате +7 999 123 45 67");
      return;
    }
    setBusy("save");
    // The auto-create trigger guarantees a row exists, so UPDATE is
    // sufficient. The DB trigger normalises and clamps verified=false.
    const { error: upErr } = await supabase
      .from("profile_contacts")
      .update({ phone: normalised, updated_at: new Date().toISOString() })
      .eq("user_id", currentUser.id);
    if (upErr) {
      setBusy(null);
      if (upErr.code === "23505") {
        setError("Этот номер уже привязан к другому аккаунту.");
        return;
      }
      setError(humanise(upErr.message));
      return;
    }
    await refreshSelf();
    setBusy(null);
    setStage("idle");
    editingRef.current = false;
    setInfo("Номер сохранён без подтверждения.");
  };

  const removePhone = async () => {
    reset();
    setBusy("save");
    const { error: dErr } = await supabase
      .from("profile_contacts")
      .update({ phone: null, updated_at: new Date().toISOString() })
      .eq("user_id", currentUser.id);
    if (dErr) {
      setBusy(null);
      setError(humanise(dErr.message));
      return;
    }
    await refreshSelf();
    setBusy(null);
    setPhoneInput("");
    setStage("idle");
    editingRef.current = false;
    setInfo("Номер удалён.");
  };

  return (
    <div className="rounded-xl overflow-hidden bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0 text-[color:var(--kub-cyan)]">
          <KubIcon name="phone" size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-semibold text-[color:var(--kub-cyan)]">Телефон</span>
            {storedPhone && (
              verified ? (
                <KubBadge tone="online" dot>Подтверждён</KubBadge>
              ) : (
                <KubBadge tone="muted">Не подтверждён</KubBadge>
              )
            )}
          </div>
          <input
            type="tel"
            value={phoneInput}
            onChange={(e) => {
              editingRef.current = true;
              setPhoneInput(e.target.value);
              setStage("idle");
              reset();
            }}
            placeholder="+7 999 123 45 67"
            className="w-full bg-transparent text-sm outline-none text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
          />
          {phoneInput && !isValid && (
            <div className="text-[11px] mt-1 text-[color:var(--kub-warn)]">
              Формат: + и 7-15 цифр (например, +79991234567)
            </div>
          )}
          {storedPhone && !dirty && (
            <div className="text-[11px] mt-1 text-[color:var(--kub-muted)]">
              Сохранённый номер: {storedPhone}
            </div>
          )}
        </div>
      </div>

      {stage === "code-sent" && (
        <div className="px-4 pt-0 pb-3 border-t border-[color:var(--kub-border-color)]">
          <label className="text-[10px] font-semibold uppercase tracking-wider mt-3 mb-1.5 block text-[color:var(--kub-cyan)]">
            Код из SMS (6 цифр)
          </label>
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            className={cn(
              "w-full rounded-xl px-3 py-2 text-sm tracking-[0.4em] text-center outline-none",
              "bg-[var(--kub-surface-3)] text-[color:var(--kub-text)]",
              "border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)]",
            )}
          />
        </div>
      )}

      {(error || info) && (
        <div
          className={cn(
            "px-4 py-2 text-xs border-t border-[color:var(--kub-border-color)]",
            error
              ? "bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] text-[color:var(--kub-danger)]"
              : "bg-[color-mix(in_srgb,var(--kub-cyan)_10%,transparent)] text-[color:var(--kub-cyan)]",
          )}
        >
          {error ?? info}
        </div>
      )}

      <div className="px-4 py-3 border-t border-[color:var(--kub-border-color)] flex flex-wrap items-center gap-2">
        {stage === "code-sent" ? (
          <>
            <KubButton
              variant="primary"
              size="sm"
              onClick={verifyCode}
              loading={busy === "verify"}
              disabled={!otpValid}
            >
              Подтвердить
            </KubButton>
            <KubButton
              variant="ghost"
              size="sm"
              onClick={() => { setStage("idle"); setCode(""); reset(); }}
            >
              Отмена
            </KubButton>
          </>
        ) : stage === "unsupported" ? (
          <KubButton
            variant="primary"
            size="sm"
            onClick={saveUnverified}
            loading={busy === "save"}
            disabled={!dirty || !isValid}
          >
            Сохранить без подтверждения
          </KubButton>
        ) : (
          <>
            <KubButton
              variant="primary"
              size="sm"
              leftIcon={<KubIcon name="check" size={13} />}
              onClick={sendCode}
              loading={busy === "send"}
              disabled={!dirty || !isValid}
            >
              Отправить код
            </KubButton>
            <KubButton
              variant="secondary"
              size="sm"
              onClick={saveUnverified}
              loading={busy === "save"}
              disabled={!dirty || !isValid}
            >
              Сохранить без проверки
            </KubButton>
          </>
        )}
        {storedPhone && (
          <KubButton
            variant="ghost"
            size="sm"
            leftIcon={<KubIcon name="delete" size={13} />}
            onClick={removePhone}
            loading={busy === "save"}
            className="ml-auto text-[color:var(--kub-danger)]"
          >
            Удалить
          </KubButton>
        )}
      </div>
    </div>
  );
}

// Mirror of the DB-side `_normalize_phone_e164`.
function normaliseE164(p: string): string | null {
  if (!p) return null;
  let v = p.replace(/[^0-9+]/g, "");
  if (!v || v === "+") return null;
  if (v.startsWith("+")) {
    v = "+" + v.slice(1).replace(/\D/g, "");
  } else if (v.length === 11 && v.startsWith("8")) {
    v = "+7" + v.slice(1);
  } else if (v.length === 10) {
    v = "+7" + v;
  } else {
    v = "+" + v;
  }
  return /^\+[1-9]\d{6,14}$/.test(v) ? v : null;
}

function looksLikeProviderUnavailable(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("sms provider") ||
    m.includes("phone provider") ||
    m.includes("phone signups are disabled") ||
    m.includes("phone_provider_disabled") ||
    m.includes("provider is not enabled") ||
    m.includes("not enabled") ||
    m.includes("not configured")
  );
}

// Тонкая обёртка над общим маппером — оставлена ради единообразия с
// остальными вызовами и на случай добавления специфики страницы.
function humanise(msg: string): string {
  return mapPgError(msg);
}
