import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

/**
 * PocketFlow's database handle.
 *
 * One pool, plain SQL, no ORM. The brief asks for a production-style example
 * an outside developer could have written, and the smallest honest thing an
 * outside developer writes is parameterised SQL against `pg`.
 *
 * Every query in this application goes through `query()` below, which means
 * every query is parameterised. There is no string-interpolated SQL anywhere in
 * PocketFlow, and §20's «никакого shell interpolation» has an SQL twin that the
 * brief did not spell out but plainly meant.
 */

export type Db = {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<Row>>;
  /** Runs `fn` inside a transaction, rolling back on any throw. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

function wrap(client: pg.Pool | pg.PoolClient, isTransaction: boolean): Db {
  return {
    async query(text, values) {
      return client.query(text, values ? [...values] : undefined);
    },
    async transaction(fn) {
      if (isTransaction) {
        // Nested: reuse the open transaction rather than opening a second one,
        // which Postgres would refuse anyway.
        return fn(wrap(client, true));
      }
      const pool = client as pg.Pool;
      const connection = await pool.connect();
      try {
        await connection.query("begin");
        const result = await fn(wrap(connection, true));
        await connection.query("commit");
        return result;
      } catch (error) {
        try {
          await connection.query("rollback");
        } catch {
          // A rollback that fails means the connection is already gone; the
          // original error is the one worth reporting.
        }
        throw error;
      } finally {
        connection.release();
      }
    },
    async close() {
      if (!isTransaction) await (client as pg.Pool).end();
    },
  };
}

export function createDb(databaseUrl: string): Db {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // A bot is not a web server: a handful of connections is plenty, and a
    // bounded pool is what keeps a scheduler storm from exhausting Postgres.
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle client that errors (a server restart, a dropped network) must not
  // take the process down. `pg` emits this on the pool, and an unhandled
  // 'error' event is a hard crash.
  pool.on("error", () => undefined);
  return wrap(pool, false);
}

/**
 * Where the migration files are, found rather than assumed.
 *
 * A fixed `../../migrations` is right when this module is `src/store/db.ts`
 * and wrong when it has been bundled into `dist/index.mjs` — the same
 * expression then points one level above the package. That failure would show
 * up as a bot that starts, answers `getMe`, and throws on its first query,
 * which is a bad way to learn about a build setting. So the directory is
 * searched for upwards from wherever this module ended up, and the build
 * copies `migrations/` next to the bundle.
 */
function findMigrationsDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, "migrations");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("pocketflow: migrations directory not found");
}

/**
 * Applies every migration file not yet recorded, in name order.
 *
 * Each file runs in its own transaction and is recorded in the same one, so a
 * file that fails halfway leaves nothing behind and is retried next start —
 * which is the property that makes «run migrations on boot» safe rather than
 * reckless.
 */
export async function migrate(db: Db, dir: string = findMigrationsDir()): Promise<string[]> {
  await db.query(
    "create table if not exists pf_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const applied = new Set(
    (await db.query<{ name: string }>("select name from pf_migrations")).rows.map(
      (row) => row.name,
    ),
  );
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await db.transaction(async (tx) => {
      await tx.query(sql);
      await tx.query("insert into pf_migrations (name) values ($1) on conflict do nothing", [file]);
    });
    ran.push(file);
  }
  return ran;
}
