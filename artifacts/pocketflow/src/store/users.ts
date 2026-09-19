import type { Db } from "#pf/store/db";

/**
 * Who PocketFlow is talking to, and the one setting that changes behaviour.
 *
 * A time zone is not a preference here, it is a correctness requirement: «завтра
 * в 18:00» has no meaning without one, and a reminder fired three hours early
 * is worse than one that was never created.
 */

export type PocketFlowUser = {
  userId: string;
  displayName: string | null;
  username: string | null;
  timeZone: string;
  developerMode: boolean;
};

type Row = {
  user_id: string;
  display_name: string | null;
  username: string | null;
  time_zone: string;
  developer_mode: boolean;
};

function toUser(row: Row): PocketFlowUser {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    username: row.username,
    timeZone: row.time_zone,
    developerMode: row.developer_mode,
  };
}

/**
 * Records that we have seen this person, and returns their settings.
 *
 * The display name is refreshed on every sighting because people rename
 * themselves, and a reminder addressed to a name from three months ago reads
 * as a bug. The time zone is **not** overwritten: `defaultTimeZone` is only the
 * value a first sighting starts from, and a later default change must not undo
 * somebody's choice.
 */
export async function upsertUser(
  db: Db,
  input: {
    userId: string;
    displayName: string | null;
    username: string | null;
    defaultTimeZone: string;
  },
): Promise<PocketFlowUser> {
  const result = await db.query<Row>(
    `insert into pf_users (user_id, display_name, username, time_zone)
     values ($1, $2, $3, $4)
     on conflict (user_id) do update
       set display_name = excluded.display_name,
           username = excluded.username,
           updated_at = now()
     returning user_id, display_name, username, time_zone, developer_mode`,
    [input.userId, input.displayName, input.username, input.defaultTimeZone],
  );
  const row = result.rows[0];
  if (!row) throw new Error("upsertUser returned no row");
  return toUser(row);
}

export async function getUser(db: Db, userId: string): Promise<PocketFlowUser | null> {
  const result = await db.query<Row>(
    `select user_id, display_name, username, time_zone, developer_mode
     from pf_users where user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

export async function setTimeZone(db: Db, userId: string, timeZone: string): Promise<void> {
  // Validated here rather than trusted: an unknown zone reaches Postgres as a
  // perfectly good string and only fails much later, inside a date format, on
  // a scheduler tick nobody is watching.
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
  } catch {
    throw new Error(`unknown time zone: ${timeZone}`);
  }
  await db.query(`update pf_users set time_zone = $2, updated_at = now() where user_id = $1`, [
    userId,
    timeZone,
  ]);
}

export async function setDeveloperMode(
  db: Db,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await db.query(
    `update pf_users set developer_mode = $2, updated_at = now() where user_id = $1`,
    [userId, enabled],
  );
}

/**
 * Whether this person may use `/dev`.
 *
 * Two conditions and both are required (§14): they must be in the configured
 * `DEVELOPER_IDS`, and they must have switched the mode on. The allowlist is
 * the authorization; the toggle only stops a developer's own ordinary use of
 * the bot from being cluttered with test commands. A toggle alone would be a
 * self-service privilege escalation, which is the shape of defect this kind of
 * feature usually ships with.
 */
export function developerAllowed(
  developerIds: ReadonlySet<string>,
  user: PocketFlowUser | null,
): boolean {
  return user !== null && developerIds.has(user.userId);
}
