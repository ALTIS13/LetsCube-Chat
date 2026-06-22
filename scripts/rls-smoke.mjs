#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fakeUuid = "00000000-0000-4000-8000-000000000001";
const defaultEnvFiles = [
  process.env.KUB_QA_ENV_FILE,
  path.join(process.cwd(), ".local", "secrets", "letscube-infra.env"),
  path.join(os.homedir(), ".kub-messenger-qa.env"),
].filter(Boolean);
const env = loadEnvFiles(defaultEnvFiles);
const strict = readEnv("RLS_SMOKE_STRICT") === "1";
const allowMutations = process.env.KUB_QA_ALLOW_MUTATIONS === "1";
const roles = ["owner", "tech_admin", "location_admin", "location_staff", "client"];
const authStateDir =
  readEnv("KUB_QA_AUTH_STATE_DIR") || path.join(process.cwd(), "output", "playwright-auth");
const defaultAuthStatePath =
  readEnv("KUB_QA_AUTH_STATE_PATH") || path.join(process.cwd(), "output", "e2e-auth-state.json");
const supabaseUrl = readEnv("SUPABASE_URL") || readEnv("VITE_SUPABASE_URL");
const supabaseKey =
  readEnv("SUPABASE_PUBLISHABLE_KEY") ||
  readEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ||
  readEnv("SUPABASE_ANON_KEY") ||
  readEnv("VITE_SUPABASE_ANON_KEY");
const operatorApiKey = readEnv("SELFHOST_SERVICE_ROLE_KEY");
const restApiKey = operatorApiKey || supabaseKey;
const testLocationConfig =
  readEnv("KUB_QA_TEST_LOCATION_ID") || readEnv("KUB_QA_TEST_LOCATION_NAME");
let testLocationId = testLocationConfig && isUuid(testLocationConfig) ? testLocationConfig : null;

if (!supabaseUrl || !restApiKey) {
  console.log("RLS smoke skipped: Supabase URL/key are not configured.");
  process.exit(0);
}

const accounts = collectAccounts();
if (accounts.length === 0) {
  console.log("RLS smoke skipped: QA credentials are not configured.");
  process.exit(0);
}

if (testLocationConfig && !testLocationId) {
  testLocationId = await resolveLocationIdByName(accounts, testLocationConfig);
  if (testLocationId) {
    console.log("RLS smoke: resolved configured test location name to an id.");
  } else {
    console.log("RLS smoke: configured test location name was not visible to configured QA users.");
  }
}

if (!allowMutations) {
  console.log(
    "RLS smoke: mutation probes use fake IDs only. Set KUB_QA_ALLOW_MUTATIONS=1 for fixture-backed mutations.",
  );
}

const taskClaimPermissionPresent = await permissionExists(accounts, "tasks.claim");
if (!taskClaimPermissionPresent) {
  console.log(
    "RLS smoke: tasks.claim permission is not present yet; claim checks are advisory until migration is applied.",
  );
}

const allResults = [];
const expectationFailures = [];
const signedAccounts = [];
let usableSessionCount = 0;

for (const account of accounts) {
  let session;
  try {
    session = await signIn(account);
    usableSessionCount += 1;
    signedAccounts.push({ ...account, session });
  } catch (error) {
    allResults.push(
      skippedProbe(
        account.role,
        "auth session",
        error instanceof Error ? error.message : "auth unavailable",
      ),
    );
    expectationFailures.push(`${account.role} QA session is unavailable`);
    continue;
  }
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
  results.push(
    await rpcProbe(account.role, session, "has_permission:tasks.claim", "has_permission", {
      p_user_id: session.user.id,
      p_permission_key: "tasks.claim",
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
    results.push(
      await rpcProbe(
        account.role,
        session,
        "has_location_permission:tasks.claim",
        "has_location_permission",
        {
          p_user_id: session.user.id,
          p_location_id: testLocationId,
          p_permission_key: "tasks.claim",
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
  results.push(await runDueProbe(account.role, session));
  results.push(
    await rpcProbe(account.role, session, "group_invite_create:fake", "group_invite_create", {
      p_chat_id: fakeUuid,
      p_invitee_id: fakeUuid,
    }),
  );
  results.push(
    await ownerScopedRestProbe(
      account.role,
      session,
      "notifications own rows",
      "/rest/v1/notifications?select=id,user_id&limit=50",
      "user_id",
    ),
  );
  results.push(
    await ownerScopedRestProbe(
      account.role,
      session,
      "push_subscriptions own rows",
      "/rest/v1/push_subscriptions?select=id,user_id&limit=50",
      "user_id",
    ),
  );
  results.push(
    await ownerScopedRestProbe(
      account.role,
      session,
      "notification_preferences own rows",
      "/rest/v1/notification_preferences?select=user_id&limit=50",
      "user_id",
    ),
  );
  results.push(
    await ownerScopedRestProbe(
      account.role,
      session,
      "chat_notification_preferences own rows",
      "/rest/v1/chat_notification_preferences?select=user_id,chat_id&limit=50",
      "user_id",
    ),
  );
  results.push(await profileContactBoundaryProbe(account.role, session));
  results.push(await messageChatBoundaryProbe(account.role, session));
  results.push(await storageListBoundaryProbe(account.role, session, "media", ""));
  results.push(await storageListBoundaryProbe(account.role, session, "chat-media", ""));

  allResults.push(...results);
  expectationFailures.push(
    ...checkRoleExpectations(account.role, results, taskClaimPermissionPresent),
  );
}

if (allowMutations) {
  const mutationResults = await runFixtureMutationProbes(signedAccounts);
  allResults.push(...mutationResults);
  expectationFailures.push(
    ...mutationResults.filter((result) => !result.ok).map((result) => result.message),
  );
}

const storageObjectResults = await runStorageObjectBoundaryProbes(signedAccounts);
allResults.push(...storageObjectResults);
expectationFailures.push(
  ...storageObjectResults.filter((result) => !result.ok).map((result) => result.message),
);

console.table(
  allResults.map(({ role, probe, status, ok, missing, value, leakCount, message }) => ({
    role,
    probe,
    status,
    ok,
    missing,
    value,
    leakCount,
    message,
  })),
);

if (expectationFailures.length > 0) {
  console.log("RLS smoke expectation warnings:");
  for (const failure of expectationFailures) console.log(`- ${failure}`);
}

if (usableSessionCount === 0) {
  console.log("RLS smoke skipped: no usable QA sessions are configured.");
  process.exit(0);
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
    if (credentials || hasSavedAuthState(role)) result.push({ role, ...(credentials ?? {}) });
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

async function restRowsProbe(role, session, probe, pathAndQuery) {
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
    rows: Array.isArray(parsed) ? parsed : [],
    value: Array.isArray(parsed) ? parsed.length : null,
    leakCount: null,
    message: response.ok ? "ok" : summarize(text),
  };
}

async function ownerScopedRestProbe(role, session, probe, pathAndQuery, ownerField) {
  const result = await restRowsProbe(role, session, probe, pathAndQuery);
  if (!result.ok) return result;
  const leakCount = result.rows.filter(
    (row) => row?.[ownerField] && row[ownerField] !== session.user.id,
  ).length;
  return {
    ...result,
    rows: undefined,
    leakCount,
    message: leakCount > 0 ? "non-owned rows visible" : "ok",
  };
}

async function profileContactBoundaryProbe(role, session) {
  const result = await ownerScopedRestProbe(
    role,
    session,
    "profile_contacts non-admin privacy",
    "/rest/v1/profile_contacts?select=user_id&limit=50",
    "user_id",
  );
  return result;
}

async function messageChatBoundaryProbe(role, session) {
  const chats = await restRowsProbe(
    role,
    session,
    "visible chats for message boundary",
    "/rest/v1/chats?select=id&limit=1000",
  );
  const messages = await restRowsProbe(
    role,
    session,
    "messages within visible chats",
    "/rest/v1/messages?select=id,chat_id&limit=200",
  );
  if (!chats.ok || !messages.ok) {
    return {
      role,
      probe: "messages within visible chats",
      status: messages.ok ? chats.status : messages.status,
      ok: false,
      missing: chats.missing || messages.missing,
      value: null,
      leakCount: null,
      message: "chat/message visibility probe failed",
    };
  }

  const visibleChatIds = new Set(chats.rows.map((row) => row?.id).filter(Boolean));
  const leakCount = messages.rows.filter(
    (row) => row?.chat_id && !visibleChatIds.has(row.chat_id),
  ).length;
  return {
    role,
    probe: "messages within visible chats",
    status: 200,
    ok: true,
    missing: false,
    value: messages.rows.length,
    leakCount,
    message: leakCount > 0 ? "messages reference hidden chats" : "ok",
  };
}

async function storageListBoundaryProbe(role, session, bucket, prefix) {
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
    {
      method: "POST",
      headers: authHeaders(session.access_token),
      body: JSON.stringify({ prefix, limit: 20, offset: 0 }),
    },
  );
  const text = await response.text();
  const parsed = parseJson(text);
  const rows = Array.isArray(parsed) ? parsed : [];
  const allowed = response.ok;
  const leakCount = allowed ? rows.length : null;
  return {
    role,
    probe: `storage ${bucket || "bucket"} broad list`,
    status: response.status,
    ok:
      response.ok ||
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404,
    missing: response.status === 404,
    value: allowed ? rows.length : null,
    leakCount,
    message: allowed
      ? rows.length > 0
        ? "broad storage list returned rows"
        : "ok"
      : summarize(text),
  };
}

async function runFixtureMutationProbes(signedCandidates) {
  const creator = signedCandidates[0];
  const challenger = signedCandidates.find(
    (candidate) => candidate.session.user.id !== creator?.session.user.id,
  );
  if (!creator || !challenger) {
    return [
      skippedProbe(
        "fixture",
        "push_subscriptions fixture ownership",
        "skipped: two distinct QA sessions are required",
      ),
    ];
  }

  return [
    await pushSubscriptionFixtureOwnershipProbe(creator, challenger),
    await taskFixtureOwnershipProbe(signedCandidates),
    await chatFixtureMembershipProbe(signedCandidates),
    await groupInviteFixtureOwnershipProbe(signedCandidates),
    await chatMediaFixtureOwnershipProbe(signedCandidates),
  ];
}

async function pushSubscriptionFixtureOwnershipProbe(creator, challenger) {
  const endpoint = `https://rls-smoke.invalid/push/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let fixtureId = null;
  const messages = [];

  try {
    const insert = await restMutationRows(creator.session, "POST", "/rest/v1/push_subscriptions", {
      user_id: creator.session.user.id,
      endpoint,
      p256dh: "rls-smoke-p256dh",
      auth: "rls-smoke-auth",
      user_agent: "rls-smoke:create",
      platform: "rls-smoke",
      is_active: false,
    });
    fixtureId = insert.rows[0]?.id;
    if (!insert.ok || !fixtureId) {
      return {
        role: `${creator.role}/${challenger.role}`,
        probe: "push_subscriptions fixture ownership",
        status: insert.status,
        ok: false,
        missing: insert.missing,
        value: null,
        leakCount: null,
        message: `fixture insert failed: ${insert.message}`,
      };
    }

    const crossInsert = await restMutationRows(
      challenger.session,
      "POST",
      "/rest/v1/push_subscriptions",
      {
        user_id: creator.session.user.id,
        endpoint: `${endpoint}/cross-insert`,
        p256dh: "rls-smoke-p256dh",
        auth: "rls-smoke-auth",
        user_agent: "rls-smoke:cross-insert",
        platform: "rls-smoke",
        is_active: false,
      },
    );
    if (crossInsert.rows.length > 0) {
      messages.push("cross-user insert with another user_id succeeded");
      for (const row of crossInsert.rows) {
        await deletePushSubscriptionFixture(creator.session, row.id);
      }
    }

    const crossSelect = await restRowsProbe(
      challenger.role,
      challenger.session,
      "push_subscriptions fixture cross select",
      `/rest/v1/push_subscriptions?select=id,user_id&id=eq.${fixtureId}`,
    );
    if (crossSelect.ok && crossSelect.rows.length > 0) {
      messages.push("cross-user select returned fixture row");
    }

    const crossUpdate = await restMutationRows(
      challenger.session,
      "PATCH",
      `/rest/v1/push_subscriptions?id=eq.${fixtureId}`,
      { user_agent: "rls-smoke:cross-update" },
    );
    if (crossUpdate.rows.length > 0) {
      messages.push("cross-user update returned fixture row");
    }

    const ownerUpdate = await restMutationRows(
      creator.session,
      "PATCH",
      `/rest/v1/push_subscriptions?id=eq.${fixtureId}`,
      { user_agent: "rls-smoke:owner-update" },
    );
    if (!ownerUpdate.ok || ownerUpdate.rows[0]?.user_agent !== "rls-smoke:owner-update") {
      messages.push("own update did not return updated fixture row");
    }

    const crossDelete = await restMutationRows(
      challenger.session,
      "DELETE",
      `/rest/v1/push_subscriptions?id=eq.${fixtureId}`,
    );
    if (crossDelete.rows.length > 0) {
      messages.push("cross-user delete returned fixture row");
    }

    const ownerVerify = await restRowsProbe(
      creator.role,
      creator.session,
      "push_subscriptions fixture owner verify",
      `/rest/v1/push_subscriptions?select=id,user_id&id=eq.${fixtureId}`,
    );
    if (!ownerVerify.ok || ownerVerify.rows.length !== 1) {
      messages.push("fixture row was not visible to owner after cross-user attempts");
    }

    return {
      role: `${creator.role}/${challenger.role}`,
      probe: "push_subscriptions fixture ownership",
      status: messages.length > 0 ? "fail" : 200,
      ok: messages.length === 0,
      missing: false,
      value: 1,
      leakCount: messages.length,
      message: messages.length > 0 ? messages.join("; ") : "ok",
    };
  } finally {
    if (fixtureId) await deletePushSubscriptionFixture(creator.session, fixtureId);
  }
}

async function deletePushSubscriptionFixture(session, id) {
  if (!id) return null;
  return restMutationRows(session, "DELETE", `/rest/v1/push_subscriptions?id=eq.${id}`);
}

async function restMutationRows(session, method, pathAndQuery, body) {
  const response = await fetch(`${supabaseUrl}${pathAndQuery}`, {
    method,
    headers: {
      ...authHeaders(session.access_token),
      prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = parseJson(text);
  const rows = Array.isArray(parsed) ? parsed : [];
  return {
    status: response.status,
    ok: response.ok,
    missing: response.status === 404,
    rows,
    message: response.ok ? "ok" : summarize(text),
  };
}

async function operatorRestRows(pathAndQuery) {
  const response = await fetch(`${supabaseUrl}${pathAndQuery}`, {
    method: "GET",
    headers: operatorHeaders(),
  });
  const text = await response.text();
  const parsed = parseJson(text);
  return {
    status: response.status,
    ok: response.ok,
    missing: response.status === 404,
    rows: Array.isArray(parsed) ? parsed : [],
    message: response.ok ? "ok" : summarize(text),
  };
}

async function operatorRestMutationRows(method, pathAndQuery, body) {
  const response = await fetch(`${supabaseUrl}${pathAndQuery}`, {
    method,
    headers: {
      ...operatorHeaders(),
      prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = parseJson(text);
  return {
    status: response.status,
    ok: response.ok,
    missing: response.status === 404,
    rows: Array.isArray(parsed) ? parsed : [],
    message: response.ok ? "ok" : summarize(text),
  };
}

async function taskFixtureOwnershipProbe(signedCandidates) {
  if (!operatorApiKey) {
    return skippedProbe(
      "fixture",
      "tasks fixture ownership",
      "skipped: operator cleanup key is required for task fixture cleanup",
    );
  }

  const pair = fixtureAccessPair(signedCandidates);
  if (!pair) {
    return skippedProbe(
      "fixture",
      "tasks fixture ownership",
      "skipped: three distinct QA sessions are required",
    );
  }

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let taskId = null;
  const cleanupTaskIds = [];
  const messages = [];

  try {
    const insert = await operatorRestMutationRows("POST", "/rest/v1/tasks", {
      title: `rls-smoke task fixture ${nonce}`,
      description: "temporary RLS smoke fixture",
      created_by: pair.owner.session.user.id,
      assignee_id: pair.participant.session.user.id,
      status: "new",
      priority: "low",
      visibility: "private",
      assignment_scope: "user",
      created_for_admin: false,
    });
    taskId = insert.rows[0]?.id;
    if (!insert.ok || !taskId) {
      return {
        role: `${pair.owner.role}/${pair.participant.role}/${pair.outsider.role}`,
        probe: "tasks fixture ownership",
        status: insert.status,
        ok: false,
        missing: insert.missing,
        value: null,
        leakCount: null,
        message: `fixture insert failed: ${insert.message}`,
      };
    }
    cleanupTaskIds.push(taskId);

    const ownerSelect = await restRowsProbe(
      pair.owner.role,
      pair.owner.session,
      "tasks fixture owner select",
      `/rest/v1/tasks?select=id&id=eq.${taskId}`,
    );
    if (!ownerSelect.ok || ownerSelect.rows.length !== 1) {
      messages.push("creator could not select task fixture");
    }

    const participantSelect = await restRowsProbe(
      pair.participant.role,
      pair.participant.session,
      "tasks fixture participant select",
      `/rest/v1/tasks?select=id&id=eq.${taskId}`,
    );
    if (!participantSelect.ok || participantSelect.rows.length !== 1) {
      messages.push("assignee could not select task fixture");
    }

    const outsiderSelect = await restRowsProbe(
      pair.outsider.role,
      pair.outsider.session,
      "tasks fixture outsider select",
      `/rest/v1/tasks?select=id&id=eq.${taskId}`,
    );
    if (outsiderSelect.ok && outsiderSelect.rows.length > 0) {
      messages.push("non-participant selected task fixture");
    }

    const directInsert = await restMutationRows(pair.outsider.session, "POST", "/rest/v1/tasks", {
      title: `rls-smoke forbidden task ${nonce}`,
      created_by: pair.outsider.session.user.id,
      assignee_id: pair.outsider.session.user.id,
    });
    for (const row of directInsert.rows) {
      if (row?.id) cleanupTaskIds.push(row.id);
    }
    if (directInsert.rows.length > 0) {
      messages.push("direct task insert returned rows");
    }

    const outsiderUpdate = await restMutationRows(
      pair.outsider.session,
      "PATCH",
      `/rest/v1/tasks?id=eq.${taskId}`,
      { title: `rls-smoke task fixture tampered ${nonce}` },
    );
    if (outsiderUpdate.rows.length > 0) {
      messages.push("non-participant updated task fixture");
    }

    const outsiderDelete = await restMutationRows(
      pair.outsider.session,
      "DELETE",
      `/rest/v1/tasks?id=eq.${taskId}`,
    );
    if (outsiderDelete.rows.length > 0) {
      messages.push("non-participant deleted task fixture");
    }

    const ownerVerify = await restRowsProbe(
      pair.owner.role,
      pair.owner.session,
      "tasks fixture owner verify",
      `/rest/v1/tasks?select=id&id=eq.${taskId}`,
    );
    if (!ownerVerify.ok || ownerVerify.rows.length !== 1) {
      messages.push("task fixture disappeared after outsider attempts");
    }

    return {
      role: `${pair.owner.role}/${pair.participant.role}/${pair.outsider.role}`,
      probe: "tasks fixture ownership",
      status: messages.length > 0 ? "fail" : 200,
      ok: messages.length === 0,
      missing: false,
      value: 1,
      leakCount: messages.length,
      message: messages.length > 0 ? messages.join("; ") : "ok",
    };
  } finally {
    await cleanupTaskFixtures(cleanupTaskIds);
  }
}

async function chatFixtureMembershipProbe(signedCandidates) {
  if (!operatorApiKey) {
    return skippedProbe(
      "fixture",
      "chats fixture membership",
      "skipped: operator cleanup key is required for chat fixture cleanup",
    );
  }

  const pair = fixtureAccessPair(signedCandidates);
  if (!pair) {
    return skippedProbe(
      "fixture",
      "chats fixture membership",
      "skipped: three distinct QA sessions are required",
    );
  }

  let chatId = null;
  const messages = [];

  try {
    const chat = await createChatFixture(pair.owner, "membership");
    chatId = chat.id;

    const ownerSelect = await restRowsProbe(
      pair.owner.role,
      pair.owner.session,
      "chats fixture member select",
      `/rest/v1/chats?select=id&id=eq.${chatId}`,
    );
    if (!ownerSelect.ok || ownerSelect.rows.length !== 1) {
      messages.push("fixture member could not select chat");
    }

    const outsiderSelect = await restRowsProbe(
      pair.outsider.role,
      pair.outsider.session,
      "chats fixture outsider select",
      `/rest/v1/chats?select=id&id=eq.${chatId}`,
    );
    if (outsiderSelect.ok && outsiderSelect.rows.length > 0) {
      messages.push("non-member selected chat fixture");
    }

    const outsiderMembershipSelect = await restRowsProbe(
      pair.outsider.role,
      pair.outsider.session,
      "chat_members fixture outsider select",
      `/rest/v1/chat_members?select=chat_id,user_id&chat_id=eq.${chatId}`,
    );
    if (outsiderMembershipSelect.ok && outsiderMembershipSelect.rows.length > 0) {
      messages.push("non-member selected fixture membership rows");
    }

    const outsiderUpdate = await restMutationRows(
      pair.outsider.session,
      "PATCH",
      `/rest/v1/chats?id=eq.${chatId}`,
      { name: `rls-smoke tampered ${Date.now()}` },
    );
    if (outsiderUpdate.rows.length > 0) {
      messages.push("non-member updated chat fixture");
    }

    const outsiderDelete = await restMutationRows(
      pair.outsider.session,
      "DELETE",
      `/rest/v1/chats?id=eq.${chatId}`,
    );
    if (outsiderDelete.rows.length > 0) {
      messages.push("non-member deleted chat fixture");
    }

    const ownerVerify = await restRowsProbe(
      pair.owner.role,
      pair.owner.session,
      "chats fixture owner verify",
      `/rest/v1/chats?select=id&id=eq.${chatId}`,
    );
    if (!ownerVerify.ok || ownerVerify.rows.length !== 1) {
      messages.push("chat fixture disappeared after outsider attempts");
    }

    return {
      role: `${pair.owner.role}/${pair.outsider.role}`,
      probe: "chats fixture membership",
      status: messages.length > 0 ? "fail" : 200,
      ok: messages.length === 0,
      missing: false,
      value: 1,
      leakCount: messages.length,
      message: messages.length > 0 ? messages.join("; ") : "ok",
    };
  } finally {
    if (chatId) await cleanupChatFixture(chatId);
  }
}

async function groupInviteFixtureOwnershipProbe(signedCandidates) {
  if (!operatorApiKey) {
    return skippedProbe(
      "fixture",
      "group_invites fixture ownership",
      "skipped: operator cleanup key is required for invite fixture cleanup",
    );
  }

  const pair = fixtureAccessPair(signedCandidates);
  if (!pair) {
    return skippedProbe(
      "fixture",
      "group_invites fixture ownership",
      "skipped: three distinct QA sessions are required",
    );
  }

  let chatId = null;
  let inviteId = null;
  const messages = [];

  try {
    await cleanupRlsSmokeInviteNotifications();
    const chat = await createChatFixture(pair.owner, "invite");
    chatId = chat.id;

    const invite = await rpcRowsProbe(pair.owner.session, "group_invite_create", {
      p_chat_id: chatId,
      p_invitee_id: pair.participant.session.user.id,
    });
    inviteId = invite.rows[0]?.id;
    if (!invite.ok || !inviteId) {
      return {
        role: `${pair.owner.role}/${pair.participant.role}/${pair.outsider.role}`,
        probe: "group_invites fixture ownership",
        status: invite.status,
        ok: false,
        missing: invite.missing,
        value: null,
        leakCount: null,
        message: `invite create failed: ${invite.message}`,
      };
    }

    const inviterSelect = await restRowsProbe(
      pair.owner.role,
      pair.owner.session,
      "group_invites fixture inviter select",
      `/rest/v1/group_invites?select=id,status&id=eq.${inviteId}`,
    );
    if (!inviterSelect.ok || inviterSelect.rows.length !== 1) {
      messages.push("inviter could not select invite fixture");
    }

    const inviteeSelect = await restRowsProbe(
      pair.participant.role,
      pair.participant.session,
      "group_invites fixture invitee select",
      `/rest/v1/group_invites?select=id,status&id=eq.${inviteId}`,
    );
    if (!inviteeSelect.ok || inviteeSelect.rows.length !== 1) {
      messages.push("invitee could not select invite fixture");
    }

    const outsiderSelect = await restRowsProbe(
      pair.outsider.role,
      pair.outsider.session,
      "group_invites fixture outsider select",
      `/rest/v1/group_invites?select=id,status&id=eq.${inviteId}`,
    );
    if (outsiderSelect.ok && outsiderSelect.rows.length > 0) {
      messages.push("unrelated user selected invite fixture");
    }

    const outsiderCreate = await rpcRowsProbe(pair.outsider.session, "group_invite_create", {
      p_chat_id: chatId,
      p_invitee_id: pair.outsider.session.user.id,
    });
    if (outsiderCreate.rows.length > 0) {
      for (const row of outsiderCreate.rows) {
        if (row?.id) await cleanupGroupInviteNotifications(row.id);
      }
      messages.push("non-member created invite for fixture chat");
    }

    const outsiderUpdate = await restMutationRows(
      pair.outsider.session,
      "PATCH",
      `/rest/v1/group_invites?id=eq.${inviteId}`,
      { status: "cancelled" },
    );
    if (outsiderUpdate.rows.length > 0) {
      messages.push("unrelated user updated invite fixture");
    }

    const ownerVerify = await restRowsProbe(
      pair.owner.role,
      pair.owner.session,
      "group_invites fixture owner verify",
      `/rest/v1/group_invites?select=id,status&id=eq.${inviteId}`,
    );
    if (!ownerVerify.ok || ownerVerify.rows.length !== 1) {
      messages.push("invite fixture disappeared after outsider attempts");
    }

    return {
      role: `${pair.owner.role}/${pair.participant.role}/${pair.outsider.role}`,
      probe: "group_invites fixture ownership",
      status: messages.length > 0 ? "fail" : 200,
      ok: messages.length === 0,
      missing: false,
      value: 1,
      leakCount: messages.length,
      message: messages.length > 0 ? messages.join("; ") : "ok",
    };
  } finally {
    if (inviteId) {
      await cleanupGroupInviteNotifications(inviteId);
      await operatorRestMutationRows("DELETE", `/rest/v1/group_invites?id=eq.${inviteId}`);
    }
    if (chatId) await cleanupChatFixture(chatId);
    await cleanupRlsSmokeInviteNotifications();
  }
}

async function createChatFixture(owner, label) {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const insert = await operatorRestMutationRows("POST", "/rest/v1/chats", {
    type: "group",
    name: `rls-smoke ${label} ${nonce}`,
    description: "temporary RLS smoke fixture",
    created_by: owner.session.user.id,
    invite_policy: "owner_admin_only",
    is_forum: false,
  });
  const chat = insert.rows[0];
  if (!insert.ok || !chat?.id) {
    throw new Error(`chat fixture insert failed: ${insert.message}`);
  }

  const membership = await operatorRestRows(
    `/rest/v1/chat_members?select=chat_id,user_id&chat_id=eq.${chat.id}&user_id=eq.${owner.session.user.id}&limit=1`,
  );
  if (!membership.ok || membership.rows.length !== 1) {
    const memberInsert = await operatorRestMutationRows("POST", "/rest/v1/chat_members", {
      chat_id: chat.id,
      user_id: owner.session.user.id,
      role: "owner",
    });
    if (!memberInsert.ok) {
      throw new Error(`chat member fixture insert failed: ${memberInsert.message}`);
    }
  }

  return chat;
}

async function cleanupTaskFixtures(taskIds) {
  for (const taskId of new Set(taskIds.filter(Boolean))) {
    await operatorRestMutationRows("DELETE", `/rest/v1/task_events?task_id=eq.${taskId}`);
    await operatorRestMutationRows("DELETE", `/rest/v1/tasks?id=eq.${taskId}`);
  }
}

async function cleanupChatFixture(chatId) {
  await operatorRestMutationRows("DELETE", `/rest/v1/group_invites?chat_id=eq.${chatId}`);
  await operatorRestMutationRows("DELETE", `/rest/v1/chat_members?chat_id=eq.${chatId}`);
  await operatorRestMutationRows("DELETE", `/rest/v1/chats?id=eq.${chatId}`);
}

async function cleanupGroupInviteNotifications(inviteId) {
  const notifications = await operatorRestRows(
    "/rest/v1/notifications?select=id,payload&kind=eq.group_invite&order=created_at.desc&limit=100",
  );
  const matchingIds = notifications.rows
    .filter((row) => row?.payload?.invite_id === inviteId)
    .map((row) => row.id)
    .filter(Boolean);
  for (const notificationId of matchingIds) {
    await operatorRestMutationRows("DELETE", `/rest/v1/notifications?id=eq.${notificationId}`);
  }
}

async function cleanupRlsSmokeInviteNotifications() {
  const notifications = await operatorRestRows(
    "/rest/v1/notifications?select=id,payload&kind=eq.group_invite&order=created_at.desc&limit=100",
  );
  const inviteIds = notifications.rows
    .map((row) => row?.payload?.invite_id)
    .filter((inviteId) => typeof inviteId === "string" && isUuid(inviteId));
  for (const inviteId of inviteIds) {
    const invite = await operatorRestRows(`/rest/v1/group_invites?select=id&id=eq.${inviteId}`);
    if (invite.ok && invite.rows.length === 0) {
      await cleanupGroupInviteNotifications(inviteId);
    }
  }
}

async function rpcRowsProbe(session, rpcName, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: {
      ...authHeaders(session.access_token),
      prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = parseJson(text);
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? [parsed]
      : [];
  return {
    status: response.status,
    ok: response.ok,
    missing: response.status === 404,
    rows,
    message: response.ok ? "ok" : summarize(text),
  };
}

function fixtureAccessPair(signedCandidates) {
  const owner =
    signedCandidates.find((candidate) => candidate.role === "owner") ?? signedCandidates[0];
  const participant =
    signedCandidates.find(
      (candidate) =>
        candidate.role === "location_staff" && candidate.session.user.id !== owner?.session.user.id,
    ) ??
    signedCandidates.find(
      (candidate) =>
        candidate.role === "client" && candidate.session.user.id !== owner?.session.user.id,
    );
  const outsider =
    signedCandidates.find(
      (candidate) =>
        candidate.role === "client" &&
        candidate.session.user.id !== owner?.session.user.id &&
        candidate.session.user.id !== participant?.session.user.id,
    ) ??
    signedCandidates.find(
      (candidate) =>
        candidate.role === "location_staff" &&
        candidate.session.user.id !== owner?.session.user.id &&
        candidate.session.user.id !== participant?.session.user.id,
    ) ??
    signedCandidates.find(
      (candidate) =>
        candidate.session.user.id !== owner?.session.user.id &&
        candidate.session.user.id !== participant?.session.user.id &&
        candidate.role !== "tech_admin",
    );

  if (!owner || !participant || !outsider) return null;
  return { owner, participant, outsider };
}

async function chatMediaFixtureOwnershipProbe(signedCandidates) {
  if (!operatorApiKey) {
    return skippedProbe(
      "storage",
      "storage chat-media fixture ownership",
      "skipped: operator cleanup key is required for storage fixture cleanup",
    );
  }

  const pair = await findChatMediaFixturePair(signedCandidates);
  if (!pair) {
    return skippedProbe(
      "storage",
      "storage chat-media fixture ownership",
      "skipped: no suitable member/nonmember chat fixture found",
    );
  }

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const memberPath = `${pair.chatId}/rls-smoke/member-${nonce}.png`;
  const nonmemberPath = `${pair.chatId}/rls-smoke/nonmember-${nonce}.png`;
  const cleanupPaths = [];
  const messages = [];

  try {
    const memberUpload = await storageUploadProbe(pair.member.session, memberPath);
    if (!memberUpload.ok) {
      return {
        role: `${pair.member.role}/${pair.nonmember.role}`,
        probe: "storage chat-media fixture ownership",
        status: memberUpload.status,
        ok: false,
        missing: memberUpload.missing,
        value: 0,
        leakCount: null,
        message: `member upload failed: ${memberUpload.message}`,
      };
    }
    cleanupPaths.push(memberPath);

    const memberSign = await storageSignProbe(pair.member.session, memberPath);
    if (!memberSign.ok) messages.push("member could not sign own chat-media fixture");

    const nonmemberSign = await storageSignProbe(pair.nonmember.session, memberPath);
    if (nonmemberSign.ok) messages.push("non-member signed private chat-media fixture");

    const nonmemberUpload = await storageUploadProbe(pair.nonmember.session, nonmemberPath);
    if (nonmemberUpload.ok) {
      cleanupPaths.push(nonmemberPath);
      messages.push("non-member uploaded into private chat-media chat path");
    }

    return {
      role: `${pair.member.role}/${pair.nonmember.role}`,
      probe: "storage chat-media fixture ownership",
      status: messages.length > 0 ? "fail" : 200,
      ok: messages.length === 0,
      missing: false,
      value: 1,
      leakCount: messages.length,
      message: messages.length > 0 ? messages.join("; ") : "ok",
    };
  } finally {
    if (cleanupPaths.length > 0) await storageRemoveObjectsWithOperator(cleanupPaths);
  }
}

async function findChatMediaFixturePair(signedCandidates) {
  const memberChatsByUser = new Map();
  for (const candidate of signedCandidates) {
    memberChatsByUser.set(candidate.session.user.id, await fetchOwnChatMemberChatIds(candidate));
  }

  for (const member of signedCandidates) {
    const memberChatIds = memberChatsByUser.get(member.session.user.id) ?? new Set();
    for (const chatId of memberChatIds) {
      const nonmember = signedCandidates.find((candidate) => {
        if (candidate.session.user.id === member.session.user.id) return false;
        return !memberChatsByUser.get(candidate.session.user.id)?.has(chatId);
      });
      if (nonmember) return { member, nonmember, chatId };
    }
  }

  return null;
}

async function fetchOwnChatMemberChatIds(candidate) {
  const memberships = await restRowsProbe(
    candidate.role,
    candidate.session,
    "own chat memberships for storage fixture",
    `/rest/v1/chat_members?select=chat_id,user_id&user_id=eq.${candidate.session.user.id}&limit=1000`,
  );
  if (!memberships.ok) return new Set();
  return new Set(memberships.rows.map((row) => row?.chat_id).filter(Boolean));
}

async function storageUploadProbe(session, mediaPath) {
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/chat-media/${encodeStoragePath(mediaPath)}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(session.access_token),
        "content-type": "image/png",
        "x-upsert": "false",
      },
      body: tinyPngFixture(),
    },
  );
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    missing: response.status === 404,
    message: response.ok ? "ok" : summarize(text),
  };
}

async function storageRemoveObjectsWithOperator(mediaPaths) {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/chat-media`, {
    method: "DELETE",
    headers: operatorHeaders(),
    body: JSON.stringify({ prefixes: mediaPaths }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`storage fixture cleanup failed: ${summarize(text)}`);
  }
  return response;
}

async function runStorageObjectBoundaryProbes(signedCandidates) {
  if (signedCandidates.length < 2) {
    return [
      skippedProbe(
        "storage",
        "storage chat-media object sign nonmember",
        "skipped: two distinct QA sessions are required",
      ),
    ];
  }

  const visibleChatsByUser = new Map();
  for (const candidate of signedCandidates) {
    visibleChatsByUser.set(candidate.session.user.id, await fetchVisibleChatIds(candidate));
  }

  for (const source of signedCandidates) {
    const mediaMessages = await restRowsProbe(
      source.role,
      source.session,
      "storage chat-media fixture lookup",
      "/rest/v1/messages?select=chat_id,media_path&media_bucket=eq.chat-media&media_path=not.is.null&limit=20",
    );
    if (!mediaMessages.ok || mediaMessages.rows.length === 0) continue;

    for (const message of mediaMessages.rows) {
      if (!message?.chat_id || !message?.media_path) continue;
      const challenger = signedCandidates.find((candidate) => {
        if (candidate.session.user.id === source.session.user.id) return false;
        return !visibleChatsByUser.get(candidate.session.user.id)?.has(message.chat_id);
      });
      if (!challenger) continue;

      const ownSign = await storageSignProbe(source.session, message.media_path);
      const crossSign = await storageSignProbe(challenger.session, message.media_path);
      return [
        {
          role: source.role,
          probe: "storage chat-media object sign member",
          status: ownSign.status,
          ok: ownSign.ok,
          missing: ownSign.missing,
          value: ownSign.ok ? 1 : 0,
          leakCount: 0,
          message: ownSign.ok ? "ok" : ownSign.message,
        },
        {
          role: `${source.role}/${challenger.role}`,
          probe: "storage chat-media object sign nonmember",
          status: crossSign.status,
          ok: !crossSign.ok,
          missing: crossSign.missing,
          value: crossSign.ok ? 1 : 0,
          leakCount: crossSign.ok ? 1 : 0,
          message: crossSign.ok ? "non-member signed private object" : "ok",
        },
      ];
    }
  }

  return [
    skippedProbe(
      "storage",
      "storage chat-media object sign nonmember",
      "skipped: no suitable chat-media object/nonmember fixture found",
    ),
  ];
}

async function fetchVisibleChatIds(candidate) {
  const chats = await restRowsProbe(
    candidate.role,
    candidate.session,
    "visible chats for storage boundary",
    "/rest/v1/chats?select=id&limit=1000",
  );
  if (!chats.ok) return new Set();
  return new Set(chats.rows.map((row) => row?.id).filter(Boolean));
}

async function storageSignProbe(session, mediaPath) {
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/sign/chat-media/${encodeStoragePath(mediaPath)}`,
    {
      method: "POST",
      headers: authHeaders(session.access_token),
      body: JSON.stringify({ expiresIn: 60 }),
    },
  );
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    missing: response.status === 404,
    message: response.ok ? "ok" : summarize(text),
  };
}

function encodeStoragePath(value) {
  return String(value)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function tinyPngFixture() {
  return Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3,
    253, 167, 91, 198, 23, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
}

async function runDueProbe(role, session) {
  const elevatedRole = role === "default" || role === "owner" || role === "tech_admin";
  if (elevatedRole && !allowMutations) {
    return skippedProbe(role, "task_recurrence_run_due", "skipped unless KUB_QA_ALLOW_MUTATIONS=1");
  }

  return rpcProbe(role, session, "task_recurrence_run_due", "task_recurrence_run_due", {
    p_limit: allowMutations ? 50 : 1,
  });
}

function skippedProbe(role, probe, message) {
  return {
    role,
    probe,
    status: "skip",
    ok: true,
    missing: false,
    value: null,
    message,
  };
}

async function resolveLocationIdByName(accounts, locationName) {
  const query = new URLSearchParams({
    select: "id,name",
    name: `eq.${locationName}`,
    limit: "1",
  });

  for (const account of accounts) {
    let session;
    try {
      session = await signIn(account);
    } catch {
      continue;
    }
    const response = await fetch(`${supabaseUrl}/rest/v1/locations?${query.toString()}`, {
      method: "GET",
      headers: authHeaders(session.access_token),
    });
    if (!response.ok) continue;

    const parsed = parseJson(await response.text());
    const locationId = Array.isArray(parsed) ? parsed[0]?.id : null;
    if (isUuid(locationId)) return locationId;
  }

  return null;
}

async function permissionExists(candidateAccounts, permissionKey) {
  const query = new URLSearchParams({
    select: "key",
    key: `eq.${permissionKey}`,
    limit: "1",
  });

  for (const account of candidateAccounts) {
    let session;
    try {
      session = await signIn(account);
    } catch {
      continue;
    }
    const response = await fetch(`${supabaseUrl}/rest/v1/permissions?${query.toString()}`, {
      method: "GET",
      headers: authHeaders(session.access_token),
    });
    if (!response.ok) continue;

    const parsed = parseJson(await response.text());
    if (Array.isArray(parsed) && parsed.length > 0) return true;
  }

  return false;
}

function checkRoleExpectations(role, results, taskClaimPermissionPresent) {
  const failures = [];
  const byProbe = new Map(results.map((result) => [result.probe, result]));
  const tasksView = byProbe.get("has_permission:tasks.view");
  const locationTasksView = byProbe.get("has_location_permission:tasks.view");
  const tasksClaim = byProbe.get("has_permission:tasks.claim");
  const locationTasksClaim = byProbe.get("has_location_permission:tasks.claim");
  const systemManage = byProbe.get("has_permission:system.manage");
  const manageAllTasks = byProbe.get("has_permission:tasks.manage_all_locations");
  const runDue = byProbe.get("task_recurrence_run_due");
  const ownerScopedProbes = [
    "notifications own rows",
    "push_subscriptions own rows",
    "notification_preferences own rows",
    "chat_notification_preferences own rows",
  ];
  const nonAdminContactRoles = new Set(["location_staff", "client"]);
  const broadStorageProbes = ["storage chat-media broad list"];

  if (role === "client" && tasksView?.ok && tasksView.value !== false) {
    failures.push("client should not have global tasks.view by default");
  }
  if (
    role === "client" &&
    taskClaimPermissionPresent &&
    tasksClaim?.ok &&
    tasksClaim.value !== false
  ) {
    failures.push("client should not have global tasks.claim by default");
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
    role === "location_staff" &&
    testLocationId &&
    taskClaimPermissionPresent &&
    locationTasksClaim?.ok &&
    locationTasksClaim.value !== true
  ) {
    failures.push(
      "location_staff should have tasks.claim for KUB_QA_TEST_LOCATION_ID after claim migration",
    );
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
  if ((role === "location_admin" || role === "location_staff" || role === "client") && runDue?.ok) {
    failures.push(`${role} should not be allowed to run due recurrences`);
  }
  for (const probe of ownerScopedProbes) {
    const result = byProbe.get(probe);
    if (result?.ok && result.leakCount > 0) {
      failures.push(`${role} can read non-owned rows through ${probe}`);
    }
  }
  const contacts = byProbe.get("profile_contacts non-admin privacy");
  if (nonAdminContactRoles.has(role) && contacts?.ok && contacts.leakCount > 0) {
    failures.push(`${role} can read non-owned profile_contacts rows`);
  }
  const messageBoundary = byProbe.get("messages within visible chats");
  if (messageBoundary?.ok && messageBoundary.leakCount > 0) {
    failures.push(`${role} can read messages whose chats are not visible`);
  }
  for (const probe of broadStorageProbes) {
    const result = byProbe.get(probe);
    if (result?.ok && result.leakCount > 0) {
      failures.push(`${role} broad-listed ${result.leakCount} object(s) through ${probe}`);
    }
  }
  return failures;
}

async function signIn(account) {
  if (account.email && account.password) {
    for (const apiKey of [supabaseKey, operatorApiKey].filter(Boolean)) {
      const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: account.email, password: account.password }),
      });
      if (response.ok) return response.json();
    }
  }

  const savedSession = await readSavedOrRefreshedSession(account.role);
  if (savedSession) return savedSession;

  throw new Error(
    `QA sign-in failed for ${account.role}; no valid saved auth state was available.`,
  );
}

function authHeaders(accessToken) {
  return {
    apikey: restApiKey,
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
}

function operatorHeaders() {
  return {
    apikey: operatorApiKey,
    authorization: `Bearer ${operatorApiKey}`,
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

function hasSavedAuthState(role) {
  return fs.existsSync(authStatePath(role));
}

function authStatePath(role) {
  return role === "default" ? defaultAuthStatePath : path.join(authStateDir, `${role}.json`);
}

async function readSavedOrRefreshedSession(role) {
  const session = readSavedSession(role);
  if (!session?.access_token || !session?.user?.id) return null;
  const expiresAt = typeof session.expires_at === "number" ? session.expires_at : 0;
  if (expiresAt > Math.floor(Date.now() / 1000) + 60) return session;
  if (!session.refresh_token) return null;
  return refreshSession(session.refresh_token);
}

function readSavedSession(role) {
  const filePath = authStatePath(role);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const origin of raw.origins ?? []) {
      const entry = (origin.localStorage ?? []).find((item) => item.name === "kub-auth");
      if (!entry?.value) continue;
      const parsed = JSON.parse(entry.value);
      if (parsed?.access_token && parsed?.user?.id) return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

async function refreshSession(refreshToken) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: restApiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) return null;
  return response.json();
}

function readEnv(key) {
  return process.env[key] || env[key];
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
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

function loadEnvFiles(filePaths) {
  const result = {};
  for (const filePath of filePaths) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    Object.assign(result, loadEnvFile(filePath));
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
