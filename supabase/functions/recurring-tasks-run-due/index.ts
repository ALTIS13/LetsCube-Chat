type RunDueRequestBody = {
  limit?: unknown;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const schedulerToken = Deno.env.get("KUB_RECURRING_SCHEDULER_TOKEN");
  if (!schedulerToken) {
    return json({ ok: false, error: "scheduler_token_not_configured" }, 500);
  }

  if (!isAuthorized(request, schedulerToken)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = readSupabaseSecretKey();
  if (!supabaseUrl || !secretKey) {
    return json({ ok: false, error: "supabase_runtime_env_not_configured" }, 500);
  }

  const body = await readBody(request);
  const limit = normalizeLimit(body?.limit);
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/task_recurrence_run_due`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_limit: limit }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error("recurring-tasks-run-due failed", {
      status: response.status,
      message: summarizeRemoteError(responseText),
    });
    return json(
      {
        ok: false,
        error: "run_due_failed",
        status: response.status,
        message: summarizeRemoteError(responseText),
      },
      500,
    );
  }

  const created = parseCreatedCount(responseText);
  console.log("recurring-tasks-run-due completed", { created, limit });
  return json({ ok: true, created, limit });
});

function isAuthorized(request: Request, expectedToken: string) {
  const headerToken = request.headers.get("x-kub-scheduler-token");
  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return headerToken === expectedToken || bearerToken === expectedToken;
}

function readSupabaseSecretKey() {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, string>;
      return parsed.default || Object.values(parsed).find(Boolean) || "";
    } catch {
      return "";
    }
  }
  return Deno.env.get("SUPABASE_SECRET_KEY") || "";
}

async function readBody(request: Request): Promise<RunDueRequestBody | null> {
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as RunDueRequestBody;
  } catch {
    return null;
  }
}

function normalizeLimit(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(value), MAX_LIMIT));
}

function parseCreatedCount(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "number" ? parsed : 0;
  } catch {
    return 0;
  }
}

function summarizeRemoteError(text: string) {
  if (!text) return "empty response";
  try {
    const parsed = JSON.parse(text) as { message?: string; code?: string };
    return String(parsed.message || parsed.code || "domain error").slice(0, 160);
  } catch {
    return text.slice(0, 160);
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
