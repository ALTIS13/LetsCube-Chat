import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function parse(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

const publicEnv = parse(await readFile(process.env.KUB_PUBLIC_ENV_FILE ??
  fileURLToPath(new URL("../../artifacts/kub/.env.local", import.meta.url)), "utf8"));
const qa = parse(await readFile(process.env.KUB_QA_ENV_FILE ?? join(homedir(), ".kub-messenger-qa.env"), "utf8"));
const base = publicEnv.VITE_SUPABASE_URL;
const key = publicEnv.VITE_SUPABASE_ANON_KEY;
assert.equal(new URL(base).origin, "https://core.letscube.ru", "approved backend only");
assert.ok(key, "public client key is required");
if (key.split(".").length === 3) {
  assert.equal(JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role, "anon");
}
assert.ok(qa.KUB_QA_CLIENT_EMAIL && qa.KUB_QA_CLIENT_PASSWORD, "configured QA client required");

let token;
async function request(path, bearer, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method, redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, Authorization: `Bearer ${bearer ?? key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, data: text ? JSON.parse(text) : null };
}

try {
  const anonymous = await request("/rest/v1/privacy_preferences?select=user_id,phone_findable_by", null);
  assert.ok([401, 403].includes(anonymous.status) || (anonymous.ok && Array.isArray(anonymous.data) && anonymous.data.length === 0),
    "anonymous caller must receive no preference rows");
  const denied = await request("/rest/v1/rpc/search_profiles_by_phone", null, "POST", { p_query: "", p_limit: 10 });
  assert.equal(denied.status, 401, "anonymous RPC must be denied");
  const login = await request("/auth/v1/token?grant_type=password", null, "POST", {
    email: qa.KUB_QA_CLIENT_EMAIL, password: qa.KUB_QA_CLIENT_PASSWORD,
  });
  assert.equal(login.status, 200, `QA login HTTP ${login.status}`);
  token = login.data.access_token;
  assert.ok(token && login.data.user?.id, "authenticated QA session required");
  const id = login.data.user.id;
  const own = await request(`/rest/v1/privacy_preferences?select=user_id,presence_visible,forward_origin_visible,phone_findable_by&user_id=eq.${id}`, token);
  assert.equal(own.status, 200, `own preference read HTTP ${own.status}`);
  assert.ok(Array.isArray(own.data) && own.data.length <= 1);
  assert.ok(own.data.every((row) => row.user_id === id && ["everybody", "contacts"].includes(row.phone_findable_by)),
    "only valid own findability projections");
  const foreign = await request(`/rest/v1/privacy_preferences?select=user_id,phone_findable_by&user_id=neq.${id}`, token);
  assert.equal(foreign.status, 200, `foreign preference read HTTP ${foreign.status}`);
  assert.ok(Array.isArray(foreign.data) && foreign.data.length === 0, "foreign preferences stay private");
  // Malformed queries return before quota writes: this smoke changes no
  // profile, message, preference or lookup-log row and requests no real number.
  const malformed = await request("/rest/v1/rpc/search_profiles_by_phone", token, "POST", { p_query: "", p_limit: 10 });
  assert.equal(malformed.status, 200, `authenticated RPC HTTP ${malformed.status}`);
  assert.ok(Array.isArray(malformed.data) && malformed.data.length === 0);
  console.log("PASS live anonymous denial, authenticated own-column read, foreign RLS and non-mutating malformed RPC");
} finally {
  if (token) {
    const logout = await request("/auth/v1/logout?scope=local", token, "POST");
    assert.ok(logout.ok, `QA smoke session cleanup HTTP ${logout.status}`);
  }
}
