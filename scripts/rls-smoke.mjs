#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fakeUuid = "00000000-0000-4000-8000-000000000001";
const strict = process.env.RLS_SMOKE_STRICT === "1";
const allowMutations = process.env.KUB_QA_ALLOW_MUTATIONS === "1";
const roles = ["owner", "tech_admin", "location_admin", "location_staff", "client"];

const env = loadEnvFile(
  process.env.KUB_QA_ENV_FILE || path.join(os.homedir(), ".kub-messenger-qa.env"),
);
const supabaseUrl = readEnv("SUPABASE_URL") || readEnv("VITE_SUPABASE_URL");
const supabaseKey =
  readEnv("SUPABASE_PUBLISHABLE_KEY") ||
  readEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ||
  readEnv("SUPABASE_ANON_KEY") ||
  readEnv("VITE_SUPABASE_ANON_KEY");
const testLocationId = readEnv("KUB_QA_TEST_LOCATION_ID");

if (!supabaseUrl || !supabaseKey) {
  console.log("RLS smoke skipped: Supabase URL/key are not configured.");
  process.exit(0);
}

const accounts = collectAccounts();
if (accounts.length === 0) {
  console.log("RLS smoke skipped: QA credentials are not configured.");
  process.exit(0);
}

if (!allowMutations) {
  console.log(
    "RLS smoke: mutation probes use fake IDs only. Set KUB_QA_ALLOW_MUTATIONS=1 for future fixture-backed mutations.",
  );
}

const allResults = [];
const expectationFailures = [];

for (const account of accounts) {
  const session = await signIn(account);
  const results = [];

  results.push(
    await rpcProbe(account.role, session, "has_permission:tasks.view", "has_permission", {
      p_user_id: session.user.id,
      p_permission_key: "tasks.view",
    }),
  );
  results.push(
    await rpcProbe(
      account.role,
      session,
      "has_permission:tasks.manage_all_locations",
      "has_permission",
      {
        p_user_id: session.user.id,
        p_permission_key: "tasks.manage_all_locations",
      },
    ),
  );
  results.push(
    await rpcProbe(account.role, session, "has_permission:system.manage", "has_permission", {
      p_user_id: session.user.id,
      p_permission_key: "system.manage",
    }),
  );

  if (testLocationId) {
    results.push(
      await rpcProbe(
        account.role,
        session,
        "has_location_permission:tasks.view",
        "has_location_permission",
        {
          p_user_id: session.user.id,
          p_location_id: testLocationId,
          p_permission_key: "tasks.view",
        },
      ),
    );
    results.push(
      await rpcProbe(
        account.role,
        session,
        "has_location_permission:tasks.manage",
        "has_location_permission",
        {
          p_user_id: session.user.id,
          p_location_id: testLocationId,
          p_permission_key: "tasks.manage",
        },
      ),
    );
  }

  results.push(
    await restProbe(
      account.role,
      session,
      "tasks visible",
      "/rest/v1/tasks?select=id,created_for_admin,deleted_at,location_id&limit=5",
    ),
  );
  results.push(
    await rpcProbe(account.role, session, "task_soft_delete:fake", "task_soft_delete", {
      p_task_id: fakeUuid,
      p_reason: "rls-smoke",
    }),
  );
  results.push(
    await rpcProbe(account.role, session, "task_recurrence_pause:fake", "task_recurrence_pause", {
      p_recurrence_id: fakeUuid,
    }),
  );
  results.push(
    await rpcProbe(account.role, session, "group_invite_create:fake", "group_invite_create", {
      p_chat_id: fakeUuid,
      p_invitee_id: fakeUuid,
    }),
  );

  allResults.push(...results);
  expectationFailures.push(...checkRoleExpectations(account.role, results));
}

console.table(
  allResults.map(({ role, probe, status, ok, missing, value, message }) => ({
    role,
    probe,
    status,
    ok,
    missing,
    value,
    message,
  })),
);

if (expectationFailures.length > 0) {
  console.log("RLS smoke expectation warnings:");
  for (const failure of expectationFailures) console.log(`- ${failure}`);
}

if (strict && (allResults.some((result) => result.missing) || expectationFailures.length > 0)) {
  console.error("RLS smoke failed in strict mode.");
  process.exit(1);
}

function collectAccounts() {
  const result = [];
  const defaultCredentials = readCredentials("default");
  if (defaultCredentials) result.push({ role: "default", ...defaultCredentials });
  for (const role of roles) {
    const credentials = readCredentials(role);
    if (credentials) result.push({ role, ...credentials });
  }
  return result;
}

async function rpcProbe(role, session, probe, rpcName, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: authHeaders(session.access_token),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = parseJson(text);
  return {
    role,
    probe,
    status: response.status,
    ok: response.ok,
    missing: response.status === 404,
    value: typeof parsed === "boolean" ? parsed : null,
    message: response.ok ? "ok" : summarize(text),
  };
}

async function restProbe(role, session, probe, pathAndQuery) {
  const response = await fetch(`${supabaseUrl}${pathAndQuery}`, {
    method: "GET",
    headers: authHeaders(session.access_token),
  });
  const text = await response.text();
  const parsed = parseJson(text);
  return {
    role,
    probe,
    status: response.status,
    ok: response.ok,
    missing: response.status === 404,
    value: Array.isArray(parsed) ? parsed.length : null,
    message: response.ok ? "ok" : summarize(text),
  };
}

function checkRoleExpectations(role, results) {
  const failures = [];
  const byProbe = new Map(results.map((result) => [result.probe, result]));
  const tasksView = byProbe.get("has_permission:tasks.view");
  const locationTasksView = byProbe.get("has_location_permission:tasks.view");
  const systemManage = byProbe.get("has_permission:system.manage");
  const manageAllTasks = byProbe.get("has_permission:tasks.manage_all_locations");

  if (role === "client" && tasksView?.ok && tasksView.value !== false) {
    failures.push("client should not have global tasks.view by default");
  }
  if (
    role === "location_staff" &&
    testLocationId &&
    locationTasksView?.ok &&
    locationTasksView.value !== true
  ) {
    failures.push("location_staff should have tasks.view for KUB_QA_TEST_LOCATION_ID");
  }
  if (
    (role === "owner" || role === "tech_admin") &&
    systemManage?.ok &&
    manageAllTasks?.ok &&
    !systemManage.value &&
    !manageAllTasks.value
  ) {
    failures.push(`${role} should have system.manage or tasks.manage_all_locations`);
  }
  return failures;
}

async function signIn(account) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!response.ok) {
    throw new Error(`QA sign-in failed for ${account.role} with status ${response.status}.`);
  }
  return response.json();
}

function authHeaders(accessToken) {
  return {
    apikey: supabaseKey,
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
}

function readCredentials(role) {
  const emailKey =
    role === "default" ? "KUB_QA_EMAIL" : ["KUB", "QA", role.toUpperCase(), "EMAIL"].join("_");
  const passwordKey =
    role === "default"
      ? ["KUB", "QA", "PASSWORD"].join("_")
      : ["KUB", "QA", role.toUpperCase(), "PASSWORD"].join("_");
  const email = readEnv(emailKey);
  const password = readEnv(passwordKey);
  return email && password ? { email, password } : null;
}

function readEnv(key) {
  return process.env[key] || env[key];
}

function loadEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
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

function summarize(text) {
  if (!text) return "empty response";
  const parsed = parseJson(text);
  if (parsed && typeof parsed === "object") {
    return String(parsed.message || parsed.code || "domain error").slice(0, 120);
  }
  return text.slice(0, 120);
}
