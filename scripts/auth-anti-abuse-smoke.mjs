#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const defaultEnvFiles = [
  process.env.KUB_QA_ENV_FILE,
  path.join(process.cwd(), ".local", "secrets", "letscube-infra.env"),
  path.join(os.homedir(), ".kub-messenger-qa.env"),
].filter(Boolean);

const env = loadEnvFiles(defaultEnvFiles);
const args = new Set(process.argv.slice(2));
const strict = args.has("--strict") || readEnv("KUB_AUTH_SMOKE_STRICT") === "1";
const stressRateLimit =
  args.has("--stress-rate-limit") || readEnv("KUB_AUTH_SMOKE_STRESS_RATE_LIMIT") === "1";
const supabaseUrl = stripTrailingSlash(
  readEnv("SUPABASE_URL") || readEnv("VITE_SUPABASE_URL") || readEnv("KUB_SUPABASE_URL"),
);
const anonKey =
  readEnv("SUPABASE_PUBLISHABLE_KEY") ||
  readEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ||
  readEnv("SUPABASE_ANON_KEY") ||
  readEnv("VITE_SUPABASE_ANON_KEY") ||
  readEnv("ANON_KEY");
const gatewayUrl =
  readEnv("KUB_AUTH_GATEWAY_URL") ||
  readEnv("VITE_AUTH_GATEWAY_URL") ||
  (supabaseUrl ? `${supabaseUrl}/functions/v1/auth-yandex-gateway` : "");
const appOrigin = stripTrailingSlash(
  readEnv("KUB_AUTH_SMOKE_APP_ORIGIN") ||
    readEnv("KUB_BASE_URL") ||
    readEnv("VITE_PUBLIC_APP_URL") ||
    "https://app.letscube.ru",
);

if (!supabaseUrl || !anonKey || !gatewayUrl) {
  console.log("Auth anti-abuse smoke skipped: Supabase URL, anon key, or gateway URL is missing.");
  process.exit(0);
}

const directSignup = await directAuthProbe("direct signup bypass", "/auth/v1/signup", {
  email: "not-an-email",
  password: "short",
});
const directRecover = await directAuthProbe("direct recovery bypass", "/auth/v1/recover", {
  email: "not-an-email",
  redirect_to: `${appOrigin}/auth/callback`,
});
const gatewaySignup = await gatewayProbe("gateway signup captcha gate", {
  action: "signup",
  email: smokeEmail("signup"),
  password: randomPassword(),
  captchaToken: "",
  redirectTo: `${appOrigin}/auth/callback`,
});
const gatewayRecovery = await gatewayProbe("gateway recovery captcha gate", {
  action: "recovery",
  email: smokeEmail("recovery"),
  captchaToken: "",
  redirectTo: `${appOrigin}/auth/callback`,
});

const results = [directSignup, directRecover, gatewaySignup, gatewayRecovery];

if (stressRateLimit) {
  results.push(...(await gatewayRateLimitProbe()));
} else {
  results.push({
    probe: "gateway rate-limit stress",
    status: "skip",
    ok: true,
    expected: "opt-in",
    signal: "Set KUB_AUTH_SMOKE_STRESS_RATE_LIMIT=1 or pass --stress-rate-limit.",
  });
}

console.table(
  results.map(({ probe, status, ok, expected, signal }) => ({
    probe,
    status,
    ok,
    expected,
    signal,
  })),
);

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error("Auth anti-abuse smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure.probe}: status=${failure.status}, signal=${failure.signal}`);
  }
  process.exit(1);
}

if (strict && results.some((result) => result.status === "skip")) {
  console.error("Auth anti-abuse smoke failed in strict mode: skipped checks are not allowed.");
  process.exit(1);
}

console.log("Auth anti-abuse smoke passed.");

async function directAuthProbe(probe, endpointPath, body) {
  const response = await fetch(`${supabaseUrl}${endpointPath}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const signal = await responseSignal(response);
  const protectedStatus = [401, 403, 404, 429].includes(response.status);
  const reachableAuthValidation = response.status === 400;
  return {
    probe,
    status: response.status,
    ok: protectedStatus,
    expected: "401/403/404/429",
    signal: reachableAuthValidation ? "direct Auth endpoint validation is reachable" : signal,
  };
}

async function gatewayProbe(probe, body) {
  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const signal = await responseSignal(response);
  const ok =
    (response.status === 400 && signal === "captcha_required") ||
    (response.status === 429 && signal === "rate_limited");
  return {
    probe,
    status: response.status,
    ok,
    expected: "400 captcha_required or 429 rate_limited",
    signal,
  };
}

async function gatewayRateLimitProbe() {
  const email = smokeEmail("rate");
  const results = [];
  for (let index = 1; index <= 7; index += 1) {
    results.push(
      await gatewayProbe(`gateway rate-limit attempt ${index}`, {
        action: "signup",
        email,
        password: randomPassword(),
        captchaToken: "",
        redirectTo: `${appOrigin}/auth/callback`,
      }),
    );
  }
  const sawRateLimit = results.some((result) => result.status === 429);
  return [
    ...results,
    {
      probe: "gateway rate-limit assertion",
      status: sawRateLimit ? 429 : "missing",
      ok: sawRateLimit,
      expected: "at least one 429",
      signal: sawRateLimit ? "rate_limited" : "rate limit was not observed",
    },
  ];
}

async function responseSignal(response) {
  const text = await response.text();
  const parsed = parseJson(text);
  if (parsed && typeof parsed === "object") {
    return String(parsed.error || parsed.code || parsed.msg || parsed.message || "domain_error")
      .slice(0, 80)
      .replace(/[^\w.-]/g, "_");
  }
  if (!text) return response.ok ? "ok" : "empty_response";
  return text
    .slice(0, 80)
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_");
}

function smokeEmail(kind) {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `security-smoke-${kind}-${nonce}@example.invalid`;
}

function randomPassword() {
  return `Smoke-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
}

function readEnv(key) {
  return process.env[key] || env[key] || "";
}

function stripTrailingSlash(value) {
  return value ? value.replace(/\/+$/g, "") : "";
}

function loadEnvFiles(filePaths) {
  const result = {};
  for (const filePath of filePaths) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    Object.assign(result, loadEnvFile(filePath));
  }
  return result;
}

function loadEnvFile(filePath) {
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    result[line.slice(0, index).trim()] = line
      .slice(index + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  return result;
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
