"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { KubBadge, KubButton, KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";
import type { ProfileContact } from "@/types/database";
import { mapPgError } from "@/lib/errors";

const RESEND_WAIT_MS = 120_000;
const PHONE_FORMAT_HINT = "Введите номер в международном формате, например +79991234567.";
const CODE_DELIVERY_UNAVAILABLE_MESSAGE =
  "Сервис доставки кода не настроен. Обратитесь к администратору.";

/**
 * Settings → Phone section.
 *
 * Phone numbers live in the RLS-protected `profile_contacts` table —
 * NOT on `profiles` — so non-staff readers cannot see other users'
 * numbers at the data-access layer. This component manages the
 * caller's own row.
 *
 * Verified-only flow: `auth.updateUser({phone})` triggers delivery of a
 * 6-digit OTP; the user enters the code, we call `verifyOtp`, then the
 * SECURITY DEFINER RPC `profile_phone_mark_verified()` mirrors the
 * verified state into `profile_contacts`. The RPC re-checks
 * `auth.users.phone_confirmed_at`, so the client cannot lie.
 *
 * If the project's delivery provider is not configured, `auth.updateUser`
 * fails with a recognisable error. We surface a friendly setup message
 * and do not persist a new phone number as verified or unverified.
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
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

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

  useEffect(() => {
    if (stage !== "code-sent" || !resendAvailableAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [resendAvailableAt, stage]);

  if (!currentUser) return null;

  const storedPhone = contact?.phone ?? null;
  const verified = !!contact?.phone_verified;
  const normalised = normaliseE164(phoneInput);
  const isValid = normalised !== null;
  const dirty = (storedPhone ?? "") !== (normalised ?? "");
  const otpValid = /^\d{6}$/.test(code);
  const resendSeconds =
    stage === "code-sent" && resendAvailableAt
      ? Math.max(0, Math.ceil((resendAvailableAt - now) / 1_000))
      : 0;
  const verifiedAtLabel = verified && contact?.phone_verified_at
    ? formatVerifiedAt(contact.phone_verified_at)
    : null;

  const reset = () => { setError(null); setInfo(null); };

  const refreshSelf = async () => {
    const { data } = await supabase
      .from("profile_contacts")
      .select("*")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (data) setContact(data);
  };

  const cancelPhoneClaim = async () => {
    await supabase.functions.invoke("phone-verification-gateway", {
      body: { action: "cancel" },
    });
  };

  const sendCode = async (resend = false) => {
    reset();
    if (!isValid || !normalised) {
      setError(PHONE_FORMAT_HINT);
      return;
    }
    setBusy("send");

    // Re-adding the same phone after removing it from profile_contacts is an
    // Auth no-op: GoTrue keeps the previously confirmed phone and does not
    // invoke the Send SMS Hook. Restore the profile mirror through the same
    // server-verified RPC instead of claiming a delivery that cannot happen.
    const { data: authState, error: authLookupError } = await supabase.auth.getUser();
    const confirmedAuthPhone = normaliseAuthPhone(authState.user?.phone);
    if (
      !authLookupError &&
      authState.user?.phone_confirmed_at &&
      confirmedAuthPhone === normalised
    ) {
      const { error: restoreError } = await supabase.rpc("profile_phone_mark_verified");
      await cancelPhoneClaim();
      setBusy(null);
      if (restoreError) {
        setStage("idle");
        setError(humanise(restoreError.message));
        return;
      }
      await refreshSelf();
      setStage("idle");
      setCode("");
      setResendAvailableAt(null);
      editingRef.current = false;
      setInfo("Телефон уже подтверждён.");
      return;
    }

    const { data: claimData, error: claimError } = await supabase.functions.invoke(
      "phone-verification-gateway",
      { body: { action: "begin", phone: normalised } },
    );
    const claimCreated = !claimError && claimData?.ok === true;
    if (!claimCreated) {
      const claimErrorCode = await readPhoneGatewayErrorCode(claimData, claimError);
      setBusy(null);
      setStage("idle");
      setError(humanisePhoneGatewayError(claimErrorCode));
      return;
    }
    const { error: err } = resend
      ? await supabase.auth.resend({ phone: normalised, type: "phone_change" })
      : await supabase.auth.updateUser({ phone: normalised });
    setBusy(null);
    if (err) {
      if (claimCreated) await cancelPhoneClaim();
      if (looksLikeProviderUnavailable(err.message)) {
        setStage("unsupported");
        setCode("");
        setResendAvailableAt(null);
        setInfo(CODE_DELIVERY_UNAVAILABLE_MESSAGE);
      } else {
        setStage("idle");
        setError(humanise(err.message));
      }
      return;
    }
    const nextResendAt = Date.now() + RESEND_WAIT_MS;
    setStage("code-sent");
    setNow(Date.now());
    setResendAvailableAt(nextResendAt);
    setInfo(`Код отправлен на номер ${normalised}`);
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
      setError(
        looksLikeProviderUnavailable(vErr.message)
          ? CODE_DELIVERY_UNAVAILABLE_MESSAGE
          : humanise(vErr.message),
      );
      return;
    }
    const { error: rpcErr } = await supabase.rpc("profile_phone_mark_verified");
    if (rpcErr) {
      setBusy(null);
      setError(humanise(rpcErr.message));
      return;
    }
    await cancelPhoneClaim();
    await refreshSelf();
    setBusy(null);
    setStage("idle");
    setCode("");
    setResendAvailableAt(null);
    editingRef.current = false;
    setInfo("Телефон подтверждён.");
  };

  const cancelCodeEntry = async () => {
    await cancelPhoneClaim();
    setStage("idle");
    setCode("");
    setResendAvailableAt(null);
    reset();
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
    setResendAvailableAt(null);
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
              setResendAvailableAt(null);
              reset();
            }}
            placeholder="+7 999 123 45 67"
            className="w-full bg-transparent text-sm outline-none text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
          />
          {phoneInput && !isValid && (
            <div className="text-[11px] mt-1 text-[color:var(--kub-warn)]">
              {PHONE_FORMAT_HINT}
            </div>
          )}
          {storedPhone && !dirty && (
            <div className="text-[11px] mt-1 text-[color:var(--kub-muted)]">
              Сохранённый номер: {storedPhone}
              {verifiedAtLabel ? ` · подтверждён ${verifiedAtLabel}` : ""}
            </div>
          )}
        </div>
      </div>

      {stage === "code-sent" && (
        <div className="px-4 pt-0 pb-3 border-t border-[color:var(--kub-border-color)]">
          <label className="text-[10px] font-semibold uppercase tracking-wider mt-3 mb-1.5 block text-[color:var(--kub-cyan)]">
            Код подтверждения (6 цифр)
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
              onClick={cancelCodeEntry}
            >
              Отмена
            </KubButton>
            <KubButton
              variant="secondary"
              size="sm"
              onClick={() => sendCode(true)}
              loading={busy === "send"}
              disabled={resendSeconds > 0 || !dirty || !isValid}
            >
              {resendSeconds > 0
                ? `Повторно через ${formatResendCountdown(resendSeconds)}`
                : "Отправить код повторно"}
            </KubButton>
          </>
        ) : stage === "unsupported" ? (
          <KubButton
              variant="secondary"
              size="sm"
              onClick={() => sendCode(false)}
            loading={busy === "send"}
            disabled={!dirty || !isValid}
          >
            Повторить отправку
          </KubButton>
        ) : (
          <>
            <KubButton
              variant="primary"
              size="sm"
              leftIcon={<KubIcon name="check" size={13} />}
              onClick={() => sendCode(false)}
              loading={busy === "send"}
              disabled={!dirty || !isValid}
            >
              {storedPhone ? "Изменить номер" : "Подтвердить номер"}
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

// Strict E.164 client-side check. The DB-side `_normalize_phone_e164`
// remains the final guard, but the UI should not silently convert local
// numbers without an explicit country code.
function normaliseE164(p: string): string | null {
  const v = p.trim().replace(/[\s().-]/g, "");
  if (!v || !v.startsWith("+")) return null;
  if (!/^\+\d+$/.test(v)) return null;
  return /^\+[1-9]\d{6,14}$/.test(v) ? v : null;
}

function normaliseAuthPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.trim();
  return normaliseE164(phone.startsWith("+") ? phone : `+${phone}`);
}

function formatVerifiedAt(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatResendCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
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
    m.includes("not configured") ||
    m.includes("twilio") ||
    m.includes("account sid")
  );
}

// Тонкая обёртка над общим маппером — оставлена ради единообразия с
// остальными вызовами и на случай добавления специфики страницы.
function humanise(msg: string): string {
  return mapPgError(msg);
}

function humanisePhoneGatewayError(code: unknown): string {
  switch (code) {
    case "disabled":
      return "Подтверждение телефона пока недоступно для этого аккаунта.";
    case "phone_in_use":
      return "Этот номер уже привязан к другому аккаунту.";
    case "invalid_phone":
    case "invalid":
      return PHONE_FORMAT_HINT;
    default:
      return "Не удалось подготовить отправку кода. Попробуйте позже.";
  }
}

async function readPhoneGatewayErrorCode(data: unknown, error: unknown): Promise<unknown> {
  const directCode = readGatewayErrorCode(data);
  if (directCode) return directCode;

  const context = error && typeof error === "object" && "context" in error
    ? (error as { context?: unknown }).context
    : null;
  if (!context || typeof context !== "object" || !("clone" in context)) return undefined;

  try {
    const response = (context as Response).clone();
    return readGatewayErrorCode(await response.json());
  } catch {
    return undefined;
  }
}

function readGatewayErrorCode(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("error" in value)) return undefined;
  return (value as { error?: unknown }).error;
}
