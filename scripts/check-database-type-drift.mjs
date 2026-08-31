#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manualPath = path.join(root, "artifacts", "kub", "src", "types", "database.ts");
const generatedPath = path.join(root, "artifacts", "kub", "src", "types", "database.generated.ts");

const criticalTables = [
  "messages",
  "tasks",
  "chats",
  "chat_members",
  "profiles",
  "locations",
  "location_members",
  "roles",
  "permissions",
  "group_invites",
  "task_recurrences",
];

const appFacingFunctions = [
  "global_search",
  "global_search_v2",
  "search_profiles_by_phone",
  "search_chat_messages",
  "task_claim",
  "task_recurrence_run_due",
  "task_soft_delete",
  "task_restore",
];

const serviceRoleOnlyFunctions = new Set([
  "bot_create_internal",
  "bot_list_owned_internal",
  "bot_rotate_token_internal",
  "bot_token_lookup_internal",
  "bot_token_touch_internal",
  "bot_membership_authorize_internal",
  "bot_upload_authorize_internal",
  "bot_send_message_internal",
  "bot_media_command_preflight_internal",
  "bot_get_me_internal",
  "bot_message_command_internal",
  "bot_commands_replace_internal",
  "bot_commands_list_internal",
  "bot_file_lookup_internal",
  "bot_callback_answer_internal",
  "bot_updates_poll_internal",
  "bot_updates_poll_release_internal",
  "bot_updates_ack_internal",
  "bot_webhook_set_internal",
  "bot_webhook_delete_internal",
  "bot_webhook_info_internal",
  "bot_update_enqueue_internal",
  "bot_delivery_claim_internal",
  "bot_delivery_prepare_internal",
  "bot_delivery_finish_internal",
  "bot_delivery_cleanup_internal",
  "registration_lifecycle_register_internal",
  "registration_lifecycle_extend_by_email_internal",
  "registration_cleanup_claim",
  "registration_cleanup_recheck",
  "registration_cleanup_delete",
  "registration_cleanup_finish",
  "registration_cleanup_report",
  "registration_cleanup_recover_dead_letter",
  "registration_cleanup_purge_audit",
  "registration_lifecycle_backfill_internal",
]);

const manual = read(manualPath);
const generated = read(generatedPath);
const manualSchema = parseSchema(manual, "manual database.ts");
const generatedSchema = parseSchema(generated, "generated database.generated.ts");

const warnings = [];
const notes = [];

for (const table of criticalTables) {
  const manualFields = manualSchema.tables.get(table);
  const generatedFields = generatedSchema.tables.get(table);

  if (!generatedFields) {
    notes.push(`generated is missing critical table ${table}`);
    continue;
  }
  if (!manualFields) {
    warnings.push(`manual database.ts is missing generated table ${table}`);
    continue;
  }

  const missingFromManual = difference(generatedFields, manualFields);
  const manualOnly = difference(manualFields, generatedFields);

  if (missingFromManual.length > 0) {
    warnings.push(`${table}: manual Row is missing generated field(s): ${missingFromManual.join(", ")}`);
  }
  if (manualOnly.length > 0) {
    notes.push(`${table}: manual-only compatibility field(s): ${manualOnly.join(", ")}`);
  }
}

for (const table of generatedSchema.tables.keys()) {
  if (!manualSchema.tables.has(table)) {
    notes.push(`generated-only table: ${table}`);
  }
}

for (const functionName of appFacingFunctions) {
  const generatedFunction = generatedSchema.functions.get(functionName);
  const manualFunction = manualSchema.functions.get(functionName);
  if (generatedFunction && !manualFunction) {
    warnings.push(`manual database.ts is missing generated RPC: ${functionName}`);
  } else if (!generatedFunction && manualFunction) {
    notes.push(`manual-only RPC: ${functionName}`);
  }
}

for (const functionName of serviceRoleOnlyFunctions) {
  if (manualSchema.functions.has(functionName)) {
    warnings.push(
      `manual database.ts exposes service-role-only RPC: ${functionName}`,
    );
  } else if (generatedSchema.functions.has(functionName)) {
    notes.push(`generated-only service-role RPC: ${functionName}`);
  }
}

printSection("Database type drift check");
console.log(`Manual:    ${path.relative(root, manualPath)}`);
console.log(`Generated: ${path.relative(root, generatedPath)}`);
console.log(`Tables checked: ${criticalTables.length}`);
console.log(`RPC checked:    ${appFacingFunctions.length}`);
console.log(`Private RPCs:   ${serviceRoleOnlyFunctions.size}`);

if (warnings.length > 0) {
  printSection("Warnings");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (notes.length > 0) {
  printSection("Notes");
  for (const note of notes) console.log(`- ${note}`);
}

if (warnings.length === 0) {
  console.log("\nNo generated fields are missing from the manual compatibility layer for critical tables.");
} else {
  console.log("\nWarnings are advisory. Keep database.ts as the compatibility layer and migrate app surfaces intentionally.");
}

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing file: ${path.relative(root, filePath)}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseSchema(source, label) {
  const publicBlock = blockAfter(source, "public:");
  const tablesBlock = blockAfter(publicBlock, "Tables:");
  const functionsBlock = blockAfter(publicBlock, "Functions:");

  if (!tablesBlock || !functionsBlock) {
    console.error(`Could not parse ${label}`);
    process.exit(1);
  }

  const tables = new Map();
  const functions = new Map();

  for (const key of topLevelKeys(tablesBlock)) {
    const tableBlock = blockAfter(tablesBlock, `${key}:`);
    const rowBlock = tableBlock ? blockAfter(tableBlock, "Row:") : null;
    if (rowBlock) tables.set(key, fieldNames(rowBlock));
  }

  for (const key of topLevelKeys(functionsBlock)) {
    functions.set(key, true);
  }

  return { tables, functions };
}

function topLevelKeys(block) {
  const keys = [];
  let depth = 0;

  for (const line of block.split(/\r?\n/)) {
    const match = depth === 0 ? line.match(/^\s{6}([A-Za-z_][A-Za-z0-9_]*):\s*\{/) : null;
    if (match) keys.push(match[1]);

    for (const char of line) {
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
    }
  }

  return keys;
}

function fieldNames(block) {
  const names = new Set();
  for (const match of block.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*):/gm)) {
    names.add(match[1]);
  }
  return names;
}

function blockAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const openIndex = source.indexOf("{", markerIndex);
  if (openIndex < 0) return null;

  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return null;
}

function difference(left, right) {
  return [...left].filter((item) => !right.has(item)).sort();
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}
