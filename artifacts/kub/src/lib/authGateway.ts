import { getAuthCallbackUrl } from "@/lib/authRedirect";

const env = import.meta.env as Record<string, string | undefined>;

type AuthGatewayAction = "signup" | "recovery";

interface SignupPayload {
  action: "signup";
  email: string;
  password: string;
  fullName: string;
  captchaToken: string;
}

interface RecoveryPayload {
  action: "recovery";
  email: string;
  captchaToken: string;
}

type AuthGatewayPayload = SignupPayload | RecoveryPayload;

export async function requestAuthGateway(payload: AuthGatewayPayload): Promise<void> {
  const gatewayUrl = getAuthGatewayUrl();
  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      ...payload,
      redirectTo: getAuthCallbackUrl(),
    }),
  });

  const body = await readJson(response);
  if (!response.ok || body?.ok !== true) {
    throw new Error(mapAuthGatewayError(body?.error, payload.action));
  }
}

function getAuthGatewayUrl(): string {
  const explicit = env.VITE_AUTH_GATEWAY_URL?.trim();
  if (explicit) return explicit;

  const supabaseUrl = env.VITE_SUPABASE_URL?.replace(/\/+$/g, "");
  if (!supabaseUrl) {
    throw new Error("Не удалось выполнить операцию. Попробуйте позже.");
  }
  return `${supabaseUrl}/functions/v1/auth-yandex-gateway`;
}

function buildHeaders(): HeadersInit {
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  return {
    "content-type": "application/json",
    ...(key ? { apikey: key, authorization: `Bearer ${key}` } : {}),
  };
}

async function readJson(response: Response): Promise<{ ok?: boolean; error?: string } | null> {
  try {
    return (await response.json()) as { ok?: boolean; error?: string };
  } catch {
    return null;
  }
}

function mapAuthGatewayError(error: string | undefined, action: AuthGatewayAction): string {
  if (error === "captcha_required" || error === "captcha_failed") {
    return "Подтвердите защиту от автоматической регистрации.";
  }
  if (error === "invalid_email") return "Введите корректный email.";
  if (error === "invalid_password") return "Пароль должен быть не короче 6 символов.";
  if (error === "invalid_name") return "Введите имя и фамилию.";
  if (error === "not_configured") {
    return "Защита регистрации временно недоступна. Обратитесь к администратору.";
  }
  return action === "recovery"
    ? "Не удалось отправить ссылку. Попробуйте позже."
    : "Не удалось создать аккаунт. Попробуйте позже.";
}
