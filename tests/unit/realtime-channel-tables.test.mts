import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A structural guard on the one-channel-per-table rule.
 *
 * The failure this protects against cannot be observed from the client: a
 * channel carrying two tables was measured, on production on 2026-09-05, to
 * report SUBSCRIBED, reach state `joined`, be assigned a server-side id for
 * every binding — and then deliver nothing, for *any* of its bindings, while
 * the same channel carrying one table delivered. So no behavioural test can
 * catch the regression on a developer's machine, and the feature that dies is
 * whichever one happened to share the channel.
 *
 * This paragraph used to attribute that to a binding on a table missing from
 * the `supabase_realtime` publication. That explanation was measured wrong on
 * 2026-09-18 and the rule never rested on it — see
 * `artifacts/kub/src/lib/realtimeTableChannels.ts`, which also says why the
 * rule is stated as "one channel per table" rather than "isolate the
 * unpublished tables": an allowlist of published tables would be a second copy
 * of a fact that lives in the database, and it would go stale silently and
 * dangerously.
 *
 * This scan does not read the publication, and it needs no list of published
 * tables. It only asserts the shape of the subscription. Bindings routed
 * through `subscribeByTable` are not scanned because the helper guarantees the
 * grouping by construction and is covered by
 * `realtime-table-channels.test.mts`; what is scanned is the hand-chained
 * `.channel(...).on("postgres_changes", ...)` form, which is the only way to
 * put two tables on one channel.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = join(here, "..", "..", "artifacts", "kub", "src");

type ChannelSite = {
  file: string;
  line: number;
  tables: string[];
};

/**
 * Chained channels that still carry more than one table.
 *
 * **Empty as of 2026-09-20, and it should stay that way.** Every entry this
 * list ever held has been converted; the last five went together — `useTask`,
 * `useTaskRouting`, `lib/support/operatorApi`, `BansMutesTab` and `UsersTab`.
 *
 * The paragraph that used to stand here said these were safe because every
 * table they bind is in the publication today. That reasoning is retired, and
 * for a better reason than tidiness: the publication explanation for the
 * 2026-09-05 outage was itself measured wrong (see
 * `lib/realtimeTableChannels.ts`), so «the tables are published» was never the
 * assurance it read as. What is known is that a channel carrying two tables
 * was measured dead while reporting SUBSCRIBED, and the same channel carrying
 * one was measured alive. An exception to that has to earn its place here with
 * a measurement, not with an argument.
 *
 * This list cannot rot the way a list of published tables would. It describes
 * the source, and the source is what this test reads: converting one of these
 * to `subscribeByTable`, or changing which tables it binds, fails the second
 * assertion below until the entry is updated or deleted. It never silently
 * excuses something it no longer describes.
 */
const KNOWN_MULTI_TABLE_CHANNELS: { file: string; tables: string[] }[] = [];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

function relative(file: string): string {
  return file.slice(srcRoot.length + 1).split("\\").join("/");
}

/**
 * Every hand-chained `.channel(...)` in the application source, with the
 * distinct tables it binds.
 *
 * A site runs from `.channel(` to the `.subscribe(` that closes it. A site with
 * no `.subscribe(` after it is not something this scanner can judge, so it is
 * reported as a parse failure rather than passed over — a channel that silently
 * fell out of the scan is exactly the hole this test exists to close.
 */
function channelSites(): { sites: ChannelSite[]; unterminated: string[] } {
  const sites: ChannelSite[] = [];
  const unterminated: string[] = [];

  for (const file of sourceFiles(srcRoot)) {
    const source = readFileSync(file, "utf8");
    let cursor = 0;
    for (;;) {
      const start = source.indexOf(".channel(", cursor);
      if (start === -1) break;
      cursor = start + ".channel(".length;
      const end = source.indexOf(".subscribe(", start);
      if (end === -1) {
        unterminated.push(`${relative(file)}:${source.slice(0, start).split("\n").length}`);
        continue;
      }
      const block = source.slice(start, end);
      const tables = new Set<string>();
      for (const match of block.matchAll(/\btable:\s*["'`]([A-Za-z0-9_]+)["'`]/g)) {
        tables.add(match[1]);
      }
      sites.push({
        file: relative(file),
        line: source.slice(0, start).split("\n").length,
        tables: [...tables].sort(),
      });
    }
  }

  return { sites, unterminated };
}

test("every chained realtime channel is parseable", () => {
  const { sites, unterminated } = channelSites();
  assert.deepEqual(unterminated, [], "a .channel( with no .subscribe( after it cannot be checked");
  assert.ok(sites.length > 10, `expected the scan to find the application's channels, found ${sites.length}`);
});

test("no chained realtime channel binds two tables outside the known list", () => {
  const { sites } = channelSites();
  const offenders = sites
    .filter((site) => site.tables.length > 1)
    .filter(
      (site) =>
        !KNOWN_MULTI_TABLE_CHANNELS.some(
          (known) => known.file === site.file && known.tables.join(",") === site.tables.join(","),
        ),
    )
    .map((site) => `${site.file}:${site.line} binds ${site.tables.join(", ")}`);

  assert.deepEqual(
    offenders,
    [],
    "a channel carrying two tables was measured dead on production while reporting SUBSCRIBED, " +
      "and the same channel carrying one was measured alive; " +
      "pass these through subscribeByTable (artifacts/kub/src/lib/realtimeTableChannels.ts)",
  );
});

test("the known multi-table list describes channels that still exist", () => {
  const { sites } = channelSites();
  const stale = KNOWN_MULTI_TABLE_CHANNELS.filter(
    (known) =>
      !sites.some(
        (site) => site.file === known.file && site.tables.join(",") === known.tables.join(","),
      ),
  ).map((known) => `${known.file} (${known.tables.join(", ")})`);

  assert.deepEqual(stale, [], "these entries no longer match any channel and must be deleted");
});

test("the repaired channels no longer chain more than one table", () => {
  const { sites } = channelSites();
  const repaired = [
    "components/chat/ChatInfoPanel.tsx",
    "components/sidebar/PhoneSection.tsx",
    "hooks/useAdminDashboard.ts",
    "hooks/useDynamicRoles.ts",
    // 2026-09-20. Seven bindings across three tables on one channel — the
    // largest violation in the list, and the one with the longest reach: the
    // sidebar's folders, and the only place outside this hook that heard a
    // membership row at all. It reported SUBSCRIBED throughout.
    "hooks/useFolders.ts",
    // 2026-09-20, the rest of the allow-list, emptied in one pass. Each had
    // held the two-table shape since the commit named beside it, and each
    // reported SUBSCRIBED the whole time.
    "hooks/useTask.ts", //            tasks + task_events, since c1ae9c67 (2026-05-05)
    "hooks/useTaskRouting.ts", //     locations + location_members, since ade989c6 (2026-05-15)
    "lib/support/operatorApi.ts", //  three support tables, since c44df3e9 (2026-07-27)
    "pages/admin/BansMutesTab.tsx", //bans + mutes, since c1ae9c67 (2026-05-05)
    "pages/admin/UsersTab.tsx", //    profiles + user_global_roles, since 92e18bf2 (2026-05-13)
  ];
  for (const file of repaired) {
    const chained = sites.filter((site) => site.file === file && site.tables.length > 0);
    assert.deepEqual(
      chained.map((site) => `${site.file}:${site.line}`),
      [],
      `${file} must subscribe through subscribeByTable, not by chaining postgres_changes bindings`,
    );
  }
});
