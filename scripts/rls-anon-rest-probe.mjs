#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const defaultEnvFiles = [
  process.env.KUB_QA_ENV_FILE,
  path.join(process.cwd(), ".local", "secrets", "letscube-infra.env"),
  path.join(os.homedir(), ".kub-messenger-qa.env"),
].filter(Boolean);

const env = loadFirstEnvFile(defaultEnvFiles);
const strict = readEnv("RLS_ANON_REST_STRICT") === "1";
const supabaseUrl = stripTrailingSlash(
  readEnv("SUPABASE_URL") || readEnv("VITE_SUPABASE_URL") || readEnv("KUB_SUPABASE_URL"),
);
const anonKey =
  readEnv("SUPABASE_PUBLISHABLE_KEY") ||
  readEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ||
  readEnv("SUPABASE_ANON_KEY") ||
  readEnv("VITE_SUPABASE_ANON_KEY") ||
  readEnv("ANON_KEY");

const probes = [
  { kind: "table", name: "messages", path: "/rest/v1/messages?select=id" },
  { kind: "table", name: "chats", path: "/rest/v1/chats?select=id" },
  { kind: "table", name: "profiles", path: "/rest/v1/profiles?select=id" },
  { kind: "table", name: "tasks", path: "/rest/v1/tasks?select=id" },
  { kind: "table", name: "notifications", path: "/rest/v1/notifications?select=id" },
  {
    kind: "table",
    name: "push_subscriptions",
    path: "/rest/v1/push_subscriptions?select=id",
  },
  {
    kind: "table",
    name: "notification_preferences",
    path: "/rest/v1/notification_preferences?select=user_id",
  },
];

if (!supabaseUrl || !anonKey) {
  console.log("RLS anon REST probe skipped: Supabase URL/anon key are not configured.");
  process.exit(0);
}

const results = [];
for (const probe of probes) {
  results.push(await runProbe(probe));
}

console.table(
  results.map(({ kind, name, status, allowed, leaked, unknown, total, contentRange, message }) => ({
    kind,
    name,
    status,
    allowed,
    leaked,
    unknown,
    total,
    contentRange,
    message,
  })),
);

const leaks = results.filter((result) => result.leaked);
const unknowns = results.filter((result) => result.unknown);

if (leaks.length > 0) {
  console.error("RLS anon REST probe failed: anon can see rows on protected surfaces.");
  for (const leak of leaks) console.error(`- ${leak.kind}:${leak.name}`);
  process.exit(1);
}

if (strict && unknowns.length > 0) {
  console.error("RLS anon REST probe failed in strict mode: unknown row counts.");
  for (const unknown of unknowns) console.error(`- ${unknown.kind}:${unknown.name}`);
  process.exit(1);
}

console.log("RLS anon REST probe passed: no anonymous row visibility detected.");

async function runProbe(probe) {
  const response = await fetch(`${supabaseUrl}${probe.path}`, {
    method: "HEAD",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      prefer: "count=exact",
      range: "0-0",
    },
  });

  const contentRange = response.headers.get("content-range") || "";
  const total = parseContentRangeTotal(contentRange);
  const denied = response.status === 401 || response.status === 403 || response.status === 404;
  const allowed = response.status >= 200 && response.status < 300;
  const leaked = allowed && typeof total === "number" && total > 0;
  const unknown = allowed && typeof total !== "number";

  return {
    ...probe,
    status: response.status,
    allowed,
    denied,
    leaked,
    unknown,
    total: typeof total === "number" ? total : null,
    contentRange: contentRange || null,
    message: denied ? "denied" : allowed ? "no rows or count checked" : "unexpected status",
  };
}

function parseContentRangeTotal(value) {
  if (!value) return null;
  const match = value.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function readEnv(key) {
  return process.env[key] || env[key] || "";
}

function stripTrailingSlash(value) {
  return value ? value.replace(/\/+$/g, "") : "";
}

function loadFirstEnvFile(filePaths) {
  for (const filePath of filePaths) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    return loadEnvFile(filePath);
  }
  return {};
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
