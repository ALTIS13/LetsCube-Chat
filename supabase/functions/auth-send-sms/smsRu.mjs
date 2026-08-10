export const SMS_MAX_LENGTH = 65;
export const SMS_RU_ENDPOINT = "https://sms.ru/sms/send";

export function renderSmsOtp(otp) {
  if (!/^\d{6}$/u.test(String(otp ?? ""))) throw new Error("invalid_otp");
  const message = `LETSCUBE: код ${otp}. Никому его не сообщайте.`;
  if (message.length > SMS_MAX_LENGTH) throw new Error("sms_too_long");
  return message;
}

export function buildSmsRuRequest({ apiId, phone, message, sender }) {
  if (!apiId || !/^\+\d{8,15}$/u.test(phone) || !message || message.length > SMS_MAX_LENGTH) {
    throw new Error("invalid_sms_request");
  }

  const body = new URLSearchParams({
    api_id: apiId,
    to: phone,
    msg: message,
    json: "1",
  });
  if (sender) body.set("from", sender);

  return {
    url: SMS_RU_ENDPOINT,
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  };
}

export async function sendSmsRu(input, fetchImpl = fetch) {
  if (!input.enabled) return { ok: false, category: "disabled" };
  if (!input.apiId) return { ok: false, category: "not_configured" };

  let request;
  try {
    request = buildSmsRuRequest({
      apiId: input.apiId,
      phone: input.phone,
      message: renderSmsOtp(input.otp),
      sender: input.sender,
    });
  } catch {
    return { ok: false, category: "invalid_request" };
  }

  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, category: "provider_unavailable" };

    const provider = await response.json();
    if (!provider || provider.status !== "OK" || provider.status_code !== 100) {
      return { ok: false, category: mapSmsRuCategory(provider?.status_code) };
    }

    const firstResult = provider.sms && Object.values(provider.sms)[0];
    if (!firstResult || firstResult.status !== "OK" || firstResult.status_code !== 100) {
      return { ok: false, category: mapSmsRuCategory(firstResult?.status_code) };
    }
    return { ok: true, category: "accepted" };
  } catch (error) {
    return {
      ok: false,
      category: error?.name === "TimeoutError" ? "timeout_unknown" : "provider_unavailable",
    };
  }
}

function mapSmsRuCategory(statusCode) {
  if (statusCode === 202 || statusCode === 204) return "destination_rejected";
  if (statusCode === 203 || statusCode === 205) return "provider_balance_or_limit";
  if (statusCode === 220 || statusCode === 230) return "rate_limited";
  return "provider_rejected";
}
