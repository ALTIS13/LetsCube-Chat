#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fakeUuid = "00000000-0000-4000-8000-000000000001";
const strict = process.env.RLS_SMOKE_STRICT === "1";

const env = loadEnvFile(
  process.env.KUB_QA_ENV_FILE || path.join(os.homedir(), ".kub-messenger-qa.env"),
);
const supabaseUrl =
  env.SUPABASE_URL ||
  env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL;
const supabaseKey =
  env.SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;
const passwordKey = ["KUB", "QA", "PASSWORD"].join("_");
const email = env.KUB_QA_EMAIL || process.env.KUB_QA_EMAIL;
const password = env[passwordKey] || process.env[passwordKey];

if (!supabaseUrl || !supabaseKey || !email || !password) {
  console.log("RLS smoke skipped: Supabase URL/key or QA credentials are not configured.");
  process.exit(0);
}

const session = await signIn();
const probes = [
  { name: "has_permission", body: { p_user_id: session.user.id, p_permission_key: "roles.view" } },
  {
    name: "has_location_permission",
    body: {
      p_user_id: session.user.id,
      p_location_id: fakeUuid,
      p_permission_key: "tasks.view",
    },
  },
  { name: "task_recurrence_pause", body: { p_recurrence_id: fakeUuid } },
  { name: "task_recurrence_resume", body: { p_recurrence_id: fakeUuid } },
  { name: "task_recurrence_stop", body: { p_recurrence_id: fakeUuid } },
  { name: "task_soft_delete", body: { p_task_id: fakeUuid, p_reason: "rpc-smoke" } },
  { name: "task_restore", body: { p_task_id: fakeUuid } },
  { name: "group_invite_create", body: { p_chat_id: fakeUuid, p_invitee_id: fakeUuid } },
  { name: "group_invite_accept", body: { p_invite_id: fakeUuid } },
  { name: "group_invite_decline", body: { p_invite_id: fakeUuid } },
];

const results = [];
for (const probe of probes) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${probe.name}`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(probe.body),
  });
  const text = await response.text();
  results.push({
    rpc: probe.name,
    status: response.status,
    ok: response.ok,
    missing: response.status === 404,
    message: response.ok ? "ok" : summarize(text),
  });
}

console.table(results);
if (strict && results.some((result) => result.missing)) {
  console.error("RLS smoke failed: at least one expected RPC is missing.");
  process.exit(1);
}

async function signIn() {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`QA sign-in failed with status ${response.status}.`);
  }
  return response.json();
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

function summarize(text) {
  if (!text) return "empty response";
  try {
    const parsed = JSON.parse(text);
    return String(parsed.message || parsed.code || "domain error").slice(0, 120);
  } catch {
    return text.slice(0, 120);
  }
}
