#!/usr/bin/env node
/**
 * Which recorded migrations are not on the database.
 *
 * Written on 2026-09-14, after six migrations sat unapplied for three days
 * while the register described them as fixed — among them the one that stopped
 * every signed-in account from reading every chat's reactions. A fix in a commit
 * is not a fix in a database, and nothing here was checking the difference.
 *
 * It reads `.migration-backup/supabase/migrations/*.sql` for the four shapes
 * those files use — `create function`, `create table`, `create policy`,
 * `create trigger` — and reports any of those objects the live database does
 * not have. It is deliberately not a SQL parser: it looks for the statements
 * this project writes, and a migration whose whole effect is an `alter` or a
 * `revoke` is invisible to it. What it catches is a migration that was never
 * run at all, which is the failure that actually happened.
 *
 * **An absent object is a question, not a verdict.** A policy renamed by a later
 * migration shows up here for ever; on the first run nine of the thirteen it
 * found were exactly that, and the check is only useful if somebody reads each
 * one rather than counting them. Triage what it prints, and when an entry is
 * settled as superseded, say so in `docs/operations/migration-inventory.md`
 * rather than teaching this script to hide it.
 *
 * Usage, from the repository root, with the live objects already exported:
 *
 *   ssh … 'docker exec -i supabase-db psql -U supabase_admin -d postgres' \
 *     < scripts/migration-inventory.sql > output/live-objects.txt
 *   node scripts/migration-inventory.mjs output/live-objects.txt
 *
 * The two halves are separate on purpose: the export is read-only SQL somebody
 * can read before running it against production, and this half never touches a
 * database at all.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIGRATIONS = ".migration-backup/supabase/migrations";

/** A name without a schema means `public`, which is what these files assume. */
function qualify(name) {
  return name.includes(".") ? name : `public.${name}`;
}

/** What one migration says it creates. */
export function objectsCreatedBy(sql) {
  // Strip comments first: a header quoting SQL is not SQL.
  const body = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
  const find = (pattern) => [...body.matchAll(pattern)];

  return {
    functions: [
      ...new Set(
        find(/create\s+(?:or\s+replace\s+)?function\s+((?:[a-z_]+\.)?[a-z0-9_]+)\s*\(/gi)
          .map((m) => qualify(m[1].toLowerCase())),
      ),
    ].sort(),
    tables: [
      ...new Set(
        find(/create\s+table(?:\s+if\s+not\s+exists)?\s+((?:[a-z_]+\.)?[a-z0-9_]+)/gi)
          .map((m) => qualify(m[1].toLowerCase())),
      ),
    ].sort(),
    policies: [
      ...new Set(
        find(/create\s+policy\s+"([^"]+)"\s+on\s+((?:[a-z_]+\.)?[a-z0-9_]+)/gi)
          .map((m) => `${m[1]}@${qualify(m[2].toLowerCase())}`),
      ),
    ].sort(),
    triggers: [
      ...new Set(find(/create\s+trigger\s+([a-z0-9_]+)/gi).map((m) => m[1].toLowerCase())),
    ].sort(),
  };
}

/** The export's lines, as four sets. */
export function readLiveObjects(text) {
  const live = { F: new Set(), T: new Set(), P: new Set(), G: new Set() };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed[1] !== "|") continue;
    const kind = trimmed[0];
    if (!(kind in live)) continue;
    live[kind].add(trimmed.slice(2));
  }
  return live;
}

export function compare(migrations, live) {
  const gaps = [];
  for (const { file, objects } of migrations) {
    const absent = [
      ...objects.functions.filter((f) => !live.F.has(f)).map((f) => `function ${f}`),
      ...objects.tables.filter((t) => !live.T.has(t)).map((t) => `table ${t}`),
      ...objects.policies.filter((p) => !live.P.has(p)).map((p) => {
        const [name, table] = p.split("@");
        return `policy "${name}" on ${table}`;
      }),
      ...objects.triggers.filter((g) => !live.G.has(g)).map((g) => `trigger ${g}`),
    ];
    if (absent.length > 0) gaps.push({ file, absent });
  }
  return gaps;
}

function main() {
  const exported = process.argv[2];
  if (!exported) {
    console.error("usage: node scripts/migration-inventory.mjs <live-objects.txt>");
    process.exit(2);
  }
  const migrations = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql") && !name.includes(".rollback."))
    .sort()
    .map((name) => ({
      file: name,
      objects: objectsCreatedBy(readFileSync(path.join(MIGRATIONS, name), "utf8")),
    }));

  const live = readLiveObjects(readFileSync(exported, "utf8"));
  if (live.F.size + live.T.size + live.P.size + live.G.size === 0) {
    console.error("the export names no objects at all — run the .sql half first");
    process.exit(2);
  }

  const gaps = compare(migrations, live);
  console.log(
    `${migrations.length} migrations read, ${live.F.size} functions / ${live.T.size} tables / ` +
      `${live.P.size} policies / ${live.G.size} triggers live.`,
  );
  console.log(`${gaps.length} migration(s) name an object the database does not have.\n`);
  for (const { file, absent } of gaps) {
    console.log(file);
    for (const one of absent) console.log("   -", one);
  }
  if (gaps.length > 0) {
    console.log(
      "\nEach of these is a question: applied and later superseded, or never applied?",
    );
  }
}

// `pathToFileURL` rather than a hand-built `file://…`: on Windows the path
// carries a drive letter and needs three slashes, and the hand-built form
// silently never matched, so this file printed nothing when it was run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
