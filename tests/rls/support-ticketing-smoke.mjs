#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const env = loadEnvFiles(
  [
    process.env.KUB_QA_ENV_FILE,
    path.join(process.cwd(), ".local", "secrets", "letscube-infra.env"),
    path.join(os.homedir(), ".kub-messenger-qa.env"),
  ].filter(Boolean),
);

const enabled = readEnv("SUPPORT_RLS_SMOKE") === "1";
const allowMutations = readEnv("KUB_QA_ALLOW_MUTATIONS") === "1";
const supabaseUrl = trimTrailingSlash(
  readEnv("SUPABASE_URL") || readEnv("VITE_SUPABASE_URL"),
);
const publicKey =
  readEnv("SUPABASE_PUBLISHABLE_KEY")
  || readEnv("VITE_SUPABASE_PUBLISHABLE_KEY")
  || readEnv("SUPABASE_ANON_KEY")
  || readEnv("VITE_SUPABASE_ANON_KEY");
const serviceKey = readEnv("SELFHOST_SERVICE_ROLE_KEY");

if (!enabled) {
  console.log("Support RLS smoke skipped: set SUPPORT_RLS_SMOKE=1 to opt in.");
  process.exit(0);
}

if (!allowMutations) {
  console.log(
    "Support RLS smoke skipped: set KUB_QA_ALLOW_MUTATIONS=1 for temporary fixtures.",
  );
  process.exit(0);
}

if (!supabaseUrl || !publicKey || !serviceKey) {
  console.log("Support RLS smoke skipped: Supabase URL/public/backend keys are not configured.");
  process.exit(0);
}

const configuredSupportOperator = readAccount("SUPPORT_OPERATOR");
const temporaryOperatorFallback = !configuredSupportOperator;
const accounts = {
  requester: readAccount("CLIENT"),
  outsider: temporaryOperatorFallback
    ? readAccount("LOCATION_ADMIN")
    : readAccount("LOCATION_STAFF"),
  operator: configuredSupportOperator ?? readAccount("LOCATION_STAFF"),
  peer: readAccount("TECH_ADMIN"),
};

if (Object.values(accounts).some((account) => !account)) {
  console.log(
    temporaryOperatorFallback
      ? "Support RLS smoke skipped: client, location_admin, location_staff and tech_admin QA accounts are required for the temporary operator fixture."
      : "Support RLS smoke skipped: client, location_staff, support_operator and tech_admin QA accounts are required.",
  );
  process.exit(0);
}

const sessions = {};
const fixtureIds = [];
const notificationTicketIds = [];
const temporaryRoleIds = [];

try {
  for (const [name, account] of Object.entries(accounts)) {
    sessions[name] = await signIn(account);
  }

  if (temporaryOperatorFallback) {
    await createTemporaryOperatorRole(
      sessions.operator.user.id,
      sessions.peer.user.id,
    );
  }

  await assertPermission(sessions.operator, "support.view", true);
  await assertPermission(sessions.operator, "support.claim", true);
  await assertPermission(sessions.operator, "support.manage", false);
  await assertPermission(sessions.peer, "support.claim", true);
  await assertPermission(sessions.requester, "support.transfer", false);

  await assertAnonDenied("support_tickets");
  await assertAnonDenied("support_ticket_contacts");
  await assertAnonDenied("support_guest_sessions");

  const assignedFixture = await createTicketFixture(sessions.requester.user.id);
  fixtureIds.push(assignedFixture.ticketId);
  notificationTicketIds.push(assignedFixture.ticketId);

  await assertVisibleTicket(sessions.requester, assignedFixture.ticketId, true);
  await assertVisibleTicket(sessions.outsider, assignedFixture.ticketId, false);
  await assertVisibleTicket(sessions.operator, assignedFixture.ticketId, true);
  await assertVisibleContact(sessions.operator, assignedFixture.ticketId, false);

  await rpc(
    sessions.operator,
    "support_ticket_claim",
    { p_ticket_id: assignedFixture.ticketId },
    200,
  );

  await assertVisibleContact(sessions.operator, assignedFixture.ticketId, true);
  await assertRpcDenied(
    sessions.requester,
    "support_ticket_transfer",
    {
      p_ticket_id: assignedFixture.ticketId,
      p_operator_id: sessions.peer.user.id,
      p_comment: "unauthorized smoke transition",
    },
  );

  const raceFixture = await createTicketFixture(sessions.requester.user.id);
  fixtureIds.push(raceFixture.ticketId);
  notificationTicketIds.push(raceFixture.ticketId);

  const race = await Promise.all([
    rpcRaw(sessions.operator, "support_ticket_claim", {
      p_ticket_id: raceFixture.ticketId,
    }),
    rpcRaw(sessions.peer, "support_ticket_claim", {
      p_ticket_id: raceFixture.ticketId,
    }),
  ]);
  const winners = race.filter((result) => result.response.ok);
  const losers = race.filter((result) => !result.response.ok);
  assert(
    winners.length === 1 && losers.length === 1,
    `atomic claim expected one winner and one loser; got ${winners.length}/${losers.length}`,
  );

  const operatorEventRows = await rest(
    sessions.operator,
    "GET",
    `/rest/v1/support_ticket_events?select=id,event_type,ticket_id&ticket_id=eq.${raceFixture.ticketId}`,
    undefined,
    200,
  );
  assert(
    operatorEventRows.some((row) => row.event_type === "claimed"),
    "support operator must see immutable claim history",
  );
  const requesterEventRows = await rest(
    sessions.requester,
    "GET",
    `/rest/v1/support_ticket_events?select=id,event_type,ticket_id&ticket_id=eq.${raceFixture.ticketId}`,
    undefined,
    200,
  );
  assert(
    !requesterEventRows.some((row) => row.event_type === "claimed"),
    "requester must not see internal operator-only claim history",
  );

  console.log("Support RLS smoke passed.");
} catch (error) {
  console.error(
    `Support RLS smoke failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
} finally {
  for (const ticketId of notificationTicketIds) {
    await serviceRest(
      "DELETE",
      `/rest/v1/notifications?payload->>ticket_id=eq.${ticketId}`,
    ).catch(() => undefined);
  }
  for (const ticketId of fixtureIds.reverse()) {
    await serviceRest(
      "DELETE",
      `/rest/v1/support_tickets?id=eq.${ticketId}`,
    ).catch(() => undefined);
  }
  for (const roleId of temporaryRoleIds.reverse()) {
    await deleteRoleFixture(roleId).catch(() => undefined);
  }
}

async function createTemporaryOperatorRole(operatorUserId, assignedByUserId) {
  const roleId = randomUUID();
  const roleKey = `qa_support_${Date.now().toString(36)}_${roleId.slice(0, 6)}`;
  temporaryRoleIds.push(roleId);
  await serviceRest(
    "POST",
    "/rest/v1/roles",
    {
      id: roleId,
      key: roleKey,
      name: "QA support operator",
      description: "Temporary role created by the support RLS smoke.",
      scope: "global",
      is_system: false,
      is_active: true,
    },
    true,
  );
  await serviceRest(
    "POST",
    "/rest/v1/role_permissions",
    [
      { role_id: roleId, permission_key: "support.view" },
      { role_id: roleId, permission_key: "support.claim" },
    ],
    true,
  );
  await serviceRest(
    "POST",
    "/rest/v1/user_global_roles",
    {
      user_id: operatorUserId,
      role_id: roleId,
      assigned_by: assignedByUserId,
    },
    true,
  );
  return roleId;
}

async function deleteRoleFixture(roleId) {
  await serviceRest("DELETE", `/rest/v1/roles?id=eq.${roleId}`);
}

async function createTicketFixture(requesterUserId) {
  const ticketId = randomUUID();
  const suffix = ticketId.slice(0, 8);
  const email = `qa-support-${suffix}@example.invalid`;
  const phone = `+7000${suffix.replaceAll("-", "").replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`;
  const ticketRows = await serviceRest(
    "POST",
    "/rest/v1/support_tickets",
    {
      id: ticketId,
      requester_user_id: requesterUserId,
      source: "authenticated",
      status: "new",
      category: "technical",
      subject: `RLS smoke ${suffix}`,
      priority: "normal",
    },
    true,
  );
  assert(ticketRows.length === 1, "fixture ticket was not created");

  await serviceRest(
    "POST",
    "/rest/v1/support_ticket_contacts",
    {
      ticket_id: ticketId,
      contact_name: "QA Support",
      email_original: email,
      email_normalized: email,
      phone_original: phone,
      phone_e164: phone,
      email_hash: sha256(email),
      phone_hash: sha256(phone),
    },
    true,
  );

  await serviceRest(
    "POST",
    "/rest/v1/support_guest_sessions",
    {
      ticket_id: ticketId,
      secret_hash: sha256(randomUUID()),
      idle_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      absolute_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    },
    true,
  );

  return { ticketId };
}

async function assertAnonDenied(table) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1`, {
    headers: {
      apikey: publicKey,
      Authorization: `Bearer ${publicKey}`,
    },
  });
  assert(
    response.status === 401 || response.status === 403,
    `anon direct access to ${table} must be denied; got ${response.status}`,
  );
}

async function assertVisibleTicket(session, ticketId, expected) {
  const rows = await rest(
    session,
    "GET",
    `/rest/v1/support_tickets?select=id&id=eq.${ticketId}`,
    undefined,
    200,
  );
  assert(
    (rows.length === 1) === expected,
    `ticket visibility mismatch for ${session.label}`,
  );
}

async function assertVisibleContact(session, ticketId, expected) {
  const rows = await rest(
    session,
    "GET",
    `/rest/v1/support_ticket_contacts?select=ticket_id&ticket_id=eq.${ticketId}`,
    undefined,
    200,
  );
  assert(
    (rows.length === 1) === expected,
    `contact visibility mismatch for ${session.label}`,
  );
}

async function assertPermission(session, key, expected) {
  const result = await rpc(
    session,
    "has_permission",
    { p_user_id: session.user.id, p_permission_key: key },
    200,
  );
  assert(result === expected, `${session.label} permission ${key} mismatch`);
}

async function assertRpcDenied(session, name, body) {
  const { response } = await rpcRaw(session, name, body);
  assert(
    response.status === 400 || response.status === 401 || response.status === 403,
    `${name} must be denied for ${session.label}; got ${response.status}`,
  );
}

async function rpc(session, name, body, expectedStatus) {
  const { response, payload } = await rpcRaw(session, name, body);
  assert(
    response.status === expectedStatus,
    `${name} returned ${response.status}, expected ${expectedStatus}`,
  );
  return payload;
}

async function rpcRaw(session, name, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: userHeaders(session),
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  return { response, payload };
}

async function rest(session, method, pathname, body, expectedStatus) {
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    method,
    headers: userHeaders(session),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await readJson(response);
  assert(
    response.status === expectedStatus,
    `${method} ${pathname.split("?")[0]} returned ${response.status}`,
  );
  return payload;
}

async function serviceRest(method, pathname, body, returnRows = false) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  if (returnRows) headers.Prefer = "return=representation";
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await readJson(response);
  assert(response.ok, `trusted fixture ${method} ${pathname.split("?")[0]} failed`);
  return Array.isArray(payload) ? payload : [];
}

async function signIn(account) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: publicKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: account.email,
      password: account.password,
    }),
  });
  const payload = await readJson(response);
  assert(response.ok && payload.access_token && payload.user?.id, `sign-in failed for ${account.label}`);
  return {
    label: account.label,
    accessToken: payload.access_token,
    user: payload.user,
  };
}

function userHeaders(session) {
  return {
    apikey: publicKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readAccount(role) {
  const email = readEnv(`KUB_QA_${role}_EMAIL`);
  const password =
    readEnv(`KUB_QA_${role}_PASSWORD`)
    || readEnv("KUB_QA_PASSWORD");
  if (!email || !password) return null;
  return { label: role.toLowerCase(), email, password };
}

function readEnv(key) {
  return process.env[key] || env[key] || "";
}

function loadEnvFiles(files) {
  const result = {};
  for (const file of files) {
    if (!file || !fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in result)) result[key] = value;
    }
  }
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
