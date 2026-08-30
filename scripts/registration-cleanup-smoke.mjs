#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);

if (
  process.env.REGISTRATION_CLEANUP_SMOKE !== "1" ||
  args.length !== 1 ||
  args[0] !== "--report-only"
) {
  console.error(
    "Registration cleanup smoke requires REGISTRATION_CLEANUP_SMOKE=1 and --report-only.",
  );
  process.exitCode = 1;
} else {
  await run();
}

async function run() {
  try {
    const env = loadEnvFiles([
      process.env.KUB_QA_ENV_FILE,
      path.join(process.cwd(), ".local", "secrets", "letscube-infra.env"),
      path.join(os.homedir(), ".kub-messenger-qa.env"),
    ]);
    const supabaseUrl =
      readEnv(env, "SUPABASE_URL") || readEnv(env, "VITE_SUPABASE_URL");
    const serviceRoleKey = readEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("registration_cleanup_smoke_credentials_missing");
    }

    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await client.rpc("registration_cleanup_report");
    if (error) throw new Error("registration_cleanup_smoke_report_failed");

    const rows = projectReportRows(data);
    for (const row of rows) {
      console.log(
        `${row.report_scope} ${row.signup_kind} ${row.reason_code} ${row.item_count}`,
      );
    }
    if (
      rows.some(
        (row) =>
          row.reason_code.startsWith("claimed_unsafe_") && row.item_count > 0,
      )
    ) {
      process.exitCode = 1;
    }
  } catch {
    console.error(
      "Registration cleanup smoke did not produce a valid aggregate report.",
    );
    process.exitCode = 1;
  }
}

function projectReportRows(data) {
  if (!Array.isArray(data))
    throw new Error("registration_cleanup_smoke_invalid_data");

  const seen = new Set();
  const rows = data.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("registration_cleanup_smoke_invalid_row");
    }
    const row = value;
    if (
      Object.keys(row).length !== 4 ||
      !Object.hasOwn(row, "report_scope") ||
      !Object.hasOwn(row, "signup_kind") ||
      !Object.hasOwn(row, "reason_code") ||
      !Object.hasOwn(row, "item_count")
    ) {
      throw new Error("registration_cleanup_smoke_invalid_row");
    }

    const itemCount = row.item_count;
    if (
      (row.report_scope !== "lifecycle" && row.report_scope !== "audit") ||
      typeof row.signup_kind !== "string" ||
      typeof row.reason_code !== "string" ||
      typeof itemCount !== "number" ||
      !Number.isSafeInteger(itemCount) ||
      itemCount < 0 ||
      !validReportShape(row.report_scope, row.signup_kind, row.reason_code)
    ) {
      throw new Error("registration_cleanup_smoke_invalid_row");
    }

    const key = `${row.report_scope}:${row.signup_kind}:${row.reason_code}`;
    if (seen.has(key))
      throw new Error("registration_cleanup_smoke_duplicate_row");
    seen.add(key);
    return {
      report_scope: row.report_scope,
      signup_kind: row.signup_kind,
      reason_code: row.reason_code,
      item_count: itemCount,
    };
  });

  return rows.sort((left, right) =>
    `${left.report_scope}:${left.signup_kind}:${left.reason_code}`.localeCompare(
      `${right.report_scope}:${right.signup_kind}:${right.reason_code}`,
    ),
  );
}

function validReportShape(reportScope, signupKind, reasonCode) {
  const lifecycleReasons = new Set([
    "claimed_unsafe_identity",
    "claimed_unsafe_email_confirmed",
    "claimed_unsafe_phone_confirmed",
    "claimed_unsafe_signed_in",
    "claimed_unsafe_product_activity",
    "admin_hold",
    "identity_exempt",
    "email_confirmed",
    "phone_confirmed",
    "signed_in",
    "product_activity",
    "not_due",
    "eligible_due",
  ]);
  if (reportScope === "lifecycle") {
    return (
      (signupKind === "public" || signupKind === "invite") &&
      lifecycleReasons.has(reasonCode)
    );
  }
  return (
    signupKind === "all" &&
    /^(?:reported|deleted|skipped|failed):[a-z][a-z0-9_]{0,63}$/.test(
      reasonCode,
    )
  );
}

function readEnv(env, name) {
  return process.env[name]?.trim() || env[name]?.trim() || "";
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
