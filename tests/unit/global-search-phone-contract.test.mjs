import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { normalizePhoneSearchQuery } from "../../artifacts/kub/src/lib/phoneSearch.ts";

const migrationDirectory = new URL(
  "../../.migration-backup/supabase/migrations/",
  import.meta.url,
);

async function readPhoneSearchMigration() {
  const names = await readdir(migrationDirectory);
  const name = names.find((candidate) =>
    candidate.endsWith("_privacy_safe_phone_search.sql"),
  );
  assert.ok(name, "missing privacy-safe phone search migration");
  return readFile(new URL(name, migrationDirectory), "utf8");
}

test("phone search accepts only explicit complete E.164 input", () => {
  assert.equal(normalizePhoneSearchQuery("+7 999 123-45-67"), "+79991234567");
  assert.equal(normalizePhoneSearchQuery("+44 (7700) 900123"), "+447700900123");
  assert.equal(normalizePhoneSearchQuery("89991234567"), null);
  assert.equal(normalizePhoneSearchQuery("9991234567"), null);
  assert.equal(normalizePhoneSearchQuery("+7999"), null);
  assert.equal(normalizePhoneSearchQuery("+79991234567 ext 1"), null);
});

test("phone lookup is permission-gated, exact and never returns a phone", async () => {
  const sql = await readPhoneSearchMigration();

  assert.match(
    sql,
    /create or replace function public\.search_profiles_by_phone\(\s*p_query text,\s*p_limit integer/i,
  );
  assert.match(sql, /security definer/i);
  assert.match(sql, /auth\.uid\(\) is null/i);
  assert.match(sql, /public\.has_permission\(v_actor, 'users\.view'\)/i);
  assert.match(sql, /contact\.phone_verified is true/i);
  assert.match(sql, /contact\.phone = v_phone/i);
  assert.match(sql, /v_phone !~ '\^\\\+\[1-9\]\[0-9\]\{7,14\}\$'/i);
  assert.match(
    sql,
    /revoke all on function public\.search_profiles_by_phone\(text, integer\)[\s\S]+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.search_profiles_by_phone\(text, integer\)[\s\S]+to authenticated/i,
  );

  const returnsBlock = sql.match(/returns table \(([\s\S]+?)\)\s*language/i)?.[1] ?? "";
  assert.doesNotMatch(returnsBlock, /phone/i);
});

test("global search uses the bounded RPC and never queries contact rows directly", async () => {
  const hook = await readFile(
    new URL("../../artifacts/kub/src/hooks/useGlobalSearch.ts", import.meta.url),
    "utf8",
  );

  assert.match(hook, /search_profiles_by_phone/);
  assert.match(hook, /normalizePhoneSearchQuery/);
  assert.doesNotMatch(hook, /from\(["']profile_contacts["']\)/);
});
