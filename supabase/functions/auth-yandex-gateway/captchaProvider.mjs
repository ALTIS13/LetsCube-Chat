const YANDEX_PROVIDER = "yandex-smartcaptcha";
const TURNSTILE_PROVIDER = "turnstile";

export function normalizeCaptchaProvider(value) {
  if (typeof value !== "string") return null;
  const provider = value.trim().toLowerCase();
  if (provider === TURNSTILE_PROVIDER) return TURNSTILE_PROVIDER;
  if (
    provider === "yandex" ||
    provider === YANDEX_PROVIDER ||
    provider === "smartcaptcha"
  ) {
    return YANDEX_PROVIDER;
  }
  return null;
}

export function resolveCaptchaVerificationConfig({
  requestedProvider,
  configuredProvider,
  yandexSecret,
  turnstileSecret,
}) {
  const hasRequestedProvider =
    typeof requestedProvider === "string" && requestedProvider.trim() !== "";
  const requested = normalizeCaptchaProvider(requestedProvider);
  if (hasRequestedProvider && !requested) {
    return { ok: false, error: "captcha_failed", status: 400 };
  }

  const hasConfiguredProvider =
    typeof configuredProvider === "string" && configuredProvider.trim() !== "";
  const configured = normalizeCaptchaProvider(configuredProvider);
  if (hasConfiguredProvider && !configured) {
    return { ok: false, error: "not_configured", status: 500 };
  }

  // Existing Yandex clients did not send captchaProvider. Keep that wire
  // contract while allowing an explicitly configured Turnstile deployment.
  const provider = requested || configured || YANDEX_PROVIDER;
  if (configured && requested && configured !== requested) {
    return { ok: false, error: "not_configured", status: 500 };
  }
  if (!configured && provider !== YANDEX_PROVIDER) {
    return { ok: false, error: "not_configured", status: 500 };
  }

  const secret =
    provider === YANDEX_PROVIDER
      ? normalizeSecret(yandexSecret)
      : normalizeSecret(turnstileSecret);
  if (!secret) return { ok: false, error: "not_configured", status: 500 };

  return { ok: true, provider, secret };
}

export async function verifyCaptchaToken({
  requestedProvider,
  configuredProvider,
  yandexSecret,
  turnstileSecret,
  token,
  ip,
  fetchImpl = fetch,
}) {
  const config = resolveCaptchaVerificationConfig({
    requestedProvider,
    configuredProvider,
    yandexSecret,
    turnstileSecret,
  });
  if (!config.ok) return config;

  const params = new URLSearchParams();
  params.set("secret", config.secret);
  if (config.provider === YANDEX_PROVIDER) {
    params.set("token", token);
    if (ip) params.set("ip", ip);
  } else {
    params.set("response", token);
    if (ip) params.set("remoteip", ip);
  }

  const endpoint =
    config.provider === YANDEX_PROVIDER
      ? "https://smartcaptcha.cloud.yandex.ru/validate"
      : "https://challenges.cloudflare.com/turnstile/v0/siteverify";

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
    });
  } catch {
    return { ok: false, error: "captcha_failed", status: 503 };
  }

  if (!response.ok) {
    return { ok: false, error: "captcha_failed", status: 503 };
  }

  try {
    const result = await response.json();
    const accepted =
      config.provider === YANDEX_PROVIDER
        ? result?.status === "ok"
        : result?.success === true;
    return accepted
      ? { ok: true }
      : { ok: false, error: "captcha_failed", status: 400 };
  } catch {
    return { ok: false, error: "captcha_failed", status: 503 };
  }
}

function normalizeSecret(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
