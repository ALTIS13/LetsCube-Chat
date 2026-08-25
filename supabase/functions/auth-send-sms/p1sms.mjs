export const SMS_MAX_LENGTH = 65;
export const P1SMS_ENDPOINT = "https://admin.p1sms.ru/apiSms/create";

const ACCEPTED_STATUSES = new Set(["created", "moderation", "sent", "delivered", "read"]);
const MAX_PROVIDER_RESPONSE_BYTES = 32_000;

export function renderSmsOtp(otp) {
  if (!/^\d{4}$/u.test(String(otp ?? ""))) throw new Error("invalid_otp");
  const message = `LETSCUBE: код ${otp}. Никому его не сообщайте.`;
  if (message.length > SMS_MAX_LENGTH) throw new Error("sms_too_long");
  return message;
}

export function buildP1SmsRequest({ apiKey, phone, message }) {
  if (
    typeof apiKey !== "string" ||
    apiKey.trim().length === 0 ||
    !/^\+7\d{10}$/u.test(phone) ||
    typeof message !== "string" ||
    message.length === 0 ||
    message.length > SMS_MAX_LENGTH
  ) {
    throw new Error("invalid_sms_request");
  }

  return {
    url: P1SMS_ENDPOINT,
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      apiKey,
      sms: [
        {
          // P1SMS tracks delivery and creates the Telegram fallback when the
          // primary digit message reaches a supported terminal failure state.
          channel: "digit",
          text: message,
          phone: phone.slice(1),
          cascade: {
            schemeDetail: [
              {
                // Provider support confirmed that aggregator failures are
                // reported as agg_error and must be matched explicitly.
                needStatus: "agg_error",
                smstemplate: {
                  channel: "telegram_auth",
                  texts: [message],
                },
              },
              {
                needStatus: "not_delivered",
                smstemplate: {
                  channel: "telegram_auth",
                  texts: [message],
                },
              },
              {
                // Keep the generic terminal error path covered as well.
                needStatus: "error",
                smstemplate: {
                  channel: "telegram_auth",
                  texts: [message],
                },
              },
            ],
          },
        },
      ],
    }),
  };
}

export async function sendP1Sms(input, fetchImpl = fetch) {
  if (!input.enabled) return { ok: false, category: "disabled" };
  if (!input.apiKey) return { ok: false, category: "not_configured" };

  let request;
  try {
    request = buildP1SmsRequest({
      apiKey: input.apiKey,
      phone: input.phone,
      message: renderSmsOtp(input.otp),
    });
  } catch {
    return { ok: false, category: "invalid_request" };
  }

  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      if (response.status === 429) return { ok: false, category: "rate_limited" };
      if (response.status === 402) return { ok: false, category: "provider_balance_or_limit" };
      return { ok: false, category: "provider_unavailable" };
    }

    const responseBody = await response.text();
    if (new TextEncoder().encode(responseBody).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
      return { ok: false, category: "provider_rejected" };
    }
    let provider;
    try {
      provider = JSON.parse(responseBody);
    } catch {
      return { ok: false, category: "provider_rejected" };
    }
    if (provider?.status !== "success" || !Array.isArray(provider.data) || provider.data.length !== 1) {
      return { ok: false, category: "provider_rejected" };
    }

    const providerMessage = provider.data[0];
    if (
      !Number.isInteger(providerMessage?.id) ||
      providerMessage.id <= 0 ||
      providerMessage.phone !== input.phone.slice(1)
    ) {
      return { ok: false, category: "provider_rejected" };
    }
    const status = typeof providerMessage.status === "string" ? providerMessage.status : "";
    if (ACCEPTED_STATUSES.has(status)) return { ok: true, category: "accepted" };
    if (status === "low_balance" || status === "low_partner_balance") {
      return { ok: false, category: "provider_balance_or_limit" };
    }
    return { ok: false, category: "provider_rejected" };
  } catch (error) {
    return {
      ok: false,
      category:
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "timeout_unknown"
          : "provider_unavailable",
    };
  }
}

export function scheduleP1SmsDelivery({ waitUntil, deliver, finish }) {
  if (typeof waitUntil !== "function" || typeof deliver !== "function" || typeof finish !== "function") {
    throw new Error("invalid_delivery_scheduler");
  }

  const task = (async () => {
    let result;
    try {
      result = await deliver();
    } catch {
      result = { ok: false, category: "background_failed" };
    }

    try {
      await finish(result);
    } catch {
      // The hook has already acknowledged the queued delivery. Keep provider
      // and database details out of the Auth response and runtime logs.
    }
  })();

  waitUntil(task);
}
