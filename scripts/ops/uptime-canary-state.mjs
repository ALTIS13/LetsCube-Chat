import { createHash, randomUUID } from "node:crypto";
import { closeSync, lstatSync, openSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createUptimeCanary, observeUptimeCanary, retireUptimeCanary } from "./uptime-canary.mjs";

const MONITOR = "uptime-canary";
const MAX_RUN_SECONDS = 1200;
const APP_ID = 0x4c435531;
const FORMAT = 1;
const uuid = value => typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const eventKey = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
const validWindow = (start, end) => time(start) && time(end) && end > start && end - start <= MAX_RUN_SECONDS;
const utcNow = () => Math.floor(Date.now() / 1000);

class StateError extends Error {}
function need(condition, code) {
  if (!condition) throw new StateError(code);
}

const ddl = `
  CREATE TABLE run (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    run_id TEXT NOT NULL,
    starts_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL CHECK(expires_at > starts_at AND expires_at - starts_at <= ${MAX_RUN_SECONDS}),
    last_at INTEGER NOT NULL CHECK(last_at >= starts_at),
    phase TEXT NOT NULL CHECK(phase IN ('WATCHING','OPEN','RETIRED')),
    termination TEXT CHECK(termination IN ('RETIRED','EXPIRED')),
    last_slot INTEGER,
    pending_at INTEGER,
    incident_opened_at INTEGER,
    CHECK((termination IS NOT NULL) = (phase = 'RETIRED')),
    CHECK((incident_opened_at IS NOT NULL) = (phase = 'OPEN'))
  ) STRICT;
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('OPENED','RECOVERED','RETIRED')),
    incident_opened_at INTEGER NOT NULL,
    emitted_at INTEGER NOT NULL CHECK(emitted_at >= incident_opened_at),
    attempt_id TEXT UNIQUE,
    intent_at INTEGER CHECK(intent_at >= emitted_at),
    dispatch_ack_at INTEGER,
    qa_receipt_at INTEGER,
    UNIQUE(incident_opened_at, kind),
    CHECK((attempt_id IS NOT NULL) = (intent_at IS NOT NULL)),
    CHECK(dispatch_ack_at IS NULL OR (intent_at IS NOT NULL AND dispatch_ack_at >= intent_at)),
    CHECK(qa_receipt_at IS NULL OR (intent_at IS NOT NULL AND qa_receipt_at >= intent_at))
  ) STRICT;
`;

function project(input, keys) {
  if (!input || typeof input !== "object") return null;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).length !== keys.length ||
      !keys.every(key => descriptors[key] && Object.hasOwn(descriptors[key], "value"))) return null;
    return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  } catch {
    return null;
  }
}

function privateMode(st) {
  // Windows callers must supply a directory with a private ACL.
  return process.platform === "win32" || (st.uid === process.getuid() && (st.mode & 0o077) === 0);
}

function statePath(directory, create) {
  need(typeof directory === "string" && isAbsolute(directory), "STATE_DIRECTORY_REFUSED");
  const dir = resolve(directory);
  let file;
  try {
    const st = lstatSync(dir);
    need(st.isDirectory() && privateMode(st) && realpathSync(dir) === dir, "STATE_DIRECTORY_REFUSED");
    file = join(dir, "state.sqlite");
    if (create) {
      const names = readdirSync(dir);
      need(!names.includes("state.sqlite"), "STATE_EXISTS");
      need(names.length === 0, "STATE_DIRECTORY_NOT_EMPTY");
      closeSync(openSync(file, "wx", 0o600));
    }
  } catch (error) {
    if (error instanceof StateError) throw error;
    throw new StateError(error.code === "EEXIST" ? "STATE_EXISTS" : "STATE_DIRECTORY_REFUSED");
  }
  try {
    const st = lstatSync(file);
    need(st.isFile() && st.nlink === 1 && privateMode(st), "STATE_FILE_REFUSED");
    return file;
  } catch (error) {
    if (error instanceof StateError) throw error;
    throw new StateError(error.code === "ENOENT" ? "STATE_MISSING" : "STATE_FILE_REFUSED");
  }
}

function transaction(db, writable, body, code) {
  let began = false;
  try {
    db.exec(writable ? "BEGIN IMMEDIATE" : "BEGIN");
    began = true;
    const result = body();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (began) {
      try { db.exec("ROLLBACK"); } catch { /* Already rolled back or commit outcome unknown. */ }
    }
    if (error instanceof StateError) throw error;
    throw new StateError(code);
  }
}

const stateOf = row => ({
  phase: row.phase, lastSlot: row.last_slot, pendingAt: row.pending_at, incidentOpenedAt: row.incident_opened_at,
});
const safeEvent = row => ({
  id: row.id, kind: row.kind, incidentOpenedAt: row.incident_opened_at, emittedAt: row.emitted_at,
  dispatch: row.intent_at === null ? "NOT_CLAIMED" : row.dispatch_ack_at === null ? "ACK_UNKNOWN" : "ACKNOWLEDGED",
  intentAt: row.intent_at, dispatchAckAt: row.dispatch_ack_at, qaReceiptAt: row.qa_receipt_at,
});

/**
 * Open an explicitly owned, local filesystem store. A run has at most 20 minutes
 * of claims. Keep one authoritative file; never resume a stale copy, recreate
 * a lost run, or reuse a returned claim. This module has no transport or
 * automatic replay and cannot recall a claim already handed to a caller.
 */
function store(options, create) {
  need(process.versions.node.startsWith("24."), "NODE_24_REQUIRED");
  const { directory, runId, startsAt, expiresAt, clock = utcNow, verifyQaReceipt } = options ?? {};
  need(uuid(runId) && typeof clock === "function" &&
    (verifyQaReceipt === undefined || typeof verifyQaReceipt === "function"), "STATE_OPTIONS_REFUSED");
  if (create) need(validWindow(startsAt, expiresAt), "INVALID_WINDOW");
  const file = statePath(directory, create);
  let db;
  try {
    // No implicit schema reset; retained format and journal are checked on every open.
    db = new DatabaseSync(file, { timeout: 3000 });
    db.exec("PRAGMA synchronous=EXTRA; PRAGMA trusted_schema=OFF");
    need(db.prepare("PRAGMA journal_mode").get().journal_mode === "delete", "STATE_FORMAT_REFUSED");
    if (create) transaction(db, true, () => {
      db.exec(ddl);
      db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=${FORMAT}`);
      db.prepare("INSERT INTO run(singleton,run_id,starts_at,expires_at,last_at,phase) VALUES(1,?,?,?,?,?)")
        .run(runId, startsAt, expiresAt, startsAt, createUptimeCanary().phase);
    }, "STATE_INIT_FAILED");
    need(db.prepare("PRAGMA application_id").get().application_id === APP_ID &&
      db.prepare("PRAGMA user_version").get().user_version === FORMAT, "STATE_FORMAT_REFUSED");
    const row = db.prepare("SELECT * FROM run WHERE singleton=1").get();
    need(row && validWindow(row.starts_at, row.expires_at) && time(row.last_at), "STATE_FORMAT_REFUSED");
    need(row.run_id === runId, "RUN_MISMATCH");
    db.prepare("SELECT id,attempt_id,intent_at,dispatch_ack_at,qa_receipt_at FROM events LIMIT 0").all();
  } catch (error) {
    try { db?.close(); } catch { /* Preserve the sanitized opening failure. */ }
    if (error instanceof StateError) throw error;
    throw new StateError("STATE_OPEN_FAILED");
  }

  let closed = false;
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const write = (sql, ...args) => db.prepare(sql).run(...args).changes;
  const runRow = () => one("SELECT * FROM run WHERE singleton=1");
  const getEvent = id => one("SELECT * FROM events WHERE id=?", id);
  const envelope = row => Object.freeze({
    monitor: MONITOR, runId, eventId: row.id, kind: row.kind, incidentOpenedAt: row.incident_opened_at,
  });

  function apply(change, now, termination = null) {
    const { state, notice } = change;
    write("UPDATE run SET phase=?,termination=?,last_slot=?,pending_at=?,incident_opened_at=? WHERE singleton=1",
      state.phase, termination, state.lastSlot, state.pendingAt, state.incidentOpenedAt);
    if (!notice) return null;
    const id = createHash("sha256").update(JSON.stringify([MONITOR, runId, notice.incidentOpenedAt, notice.kind])).digest("hex");
    write("INSERT INTO events(id,kind,incident_opened_at,emitted_at) VALUES(?,?,?,?)",
      id, notice.kind, notice.incidentOpenedAt, now);
    return safeEvent(getEvent(id));
  }

  function readClock() {
    let now;
    try { now = clock(); } catch { throw new StateError("CLOCK_REFUSED"); }
    need(time(now), "CLOCK_REFUSED");
    return now;
  }

  function update(body, observedAt) {
    need(!closed, "STATE_CLOSED");
    return transaction(db, true, () => {
      let run = runRow();
      const now = observedAt ?? readClock();
      need(now >= run.last_at, "CLOCK_REWOUND");
      if (now >= run.expires_at && run.termination === null) {
        apply(retireUptimeCanary(stateOf(run)), now, "EXPIRED");
        run = runRow();
      }
      const result = body(run, now);
      if (now !== run.last_at) write("UPDATE run SET last_at=? WHERE singleton=1", now);
      return result;
    }, "STATE_WRITE_FAILED");
  }

  return Object.freeze({
    observe(input) {
      const observation = project(input, ["observedAt", "outcome"]);
      if (!observation || !time(observation.observedAt) || !["PASS", "FAIL", "UNKNOWN"].includes(observation.outcome)) return null;
      return update((run, now) => {
        if (run.termination !== null || observation.observedAt < run.starts_at) return null;
        const state = stateOf(run);
        const transition = observeUptimeCanary(state, observation, now);
        return transition.state === state ? null : apply(transition, now);
      });
    },
    retire() {
      return update((run, now) => run.termination === null ?
        apply(retireUptimeCanary(stateOf(run)), now, "RETIRED") : null);
    },
    claim(id) {
      if (!eventKey(id)) return null;
      const handoff = update((run, now) => {
        if (now >= run.expires_at) return null;
        const row = getEvent(id);
        if (!row || row.intent_at !== null || (run.termination !== null && row.kind !== "RETIRED")) return null;
        // An unresolved attempt is never leased again and fences other sends.
        if (one("SELECT 1 AS unknown FROM events WHERE intent_at IS NOT NULL AND dispatch_ack_at IS NULL AND qa_receipt_at IS NULL LIMIT 1")) return null;
        // Retirement supersedes unsent notices, but never an unresolved intent.
        if (row.kind !== "RETIRED" &&
            one("SELECT 1 FROM events WHERE seq < ? AND intent_at IS NULL LIMIT 1", row.seq)) return null;
        const attemptId = randomUUID();
        write("UPDATE events SET attempt_id=?,intent_at=? WHERE id=?", attemptId, now, id);
        return { claim: Object.freeze({ eventId: id, attemptId, envelope: envelope(row) }),
          intentAt: now, expiresAt: run.expires_at };
      });
      if (!handoff) return null;
      // Commit can wait for readers. Do not hand out an expired intent.
      const releasedAt = readClock();
      need(releasedAt >= handoff.intentAt, "CLOCK_REWOUND");
      if (releasedAt >= handoff.expiresAt) {
        update(() => null, releasedAt);
        return null;
      }
      return handoff.claim;
    },
    recordDispatchAck(handle) {
      const claim = project(handle, ["eventId", "attemptId"]);
      if (!claim || !eventKey(claim.eventId) || !uuid(claim.attemptId)) return false;
      return update((_, now) => write(`UPDATE events SET dispatch_ack_at=?
        WHERE id=? AND attempt_id=? AND intent_at IS NOT NULL AND dispatch_ack_at IS NULL`,
      now, claim.eventId, claim.attemptId) === 1);
    },
    recordQaReceipt(id, evidence) {
      if (!eventKey(id) || !verifyQaReceipt) return false;
      const expected = update((run) => {
        const row = getEvent(id);
        return row && row.intent_at !== null && row.qa_receipt_at === null ?
          Object.freeze({ event: envelope(row), intentAt: row.intent_at, expiresAt: run.expires_at }) : null;
      });
      if (!expected) return false;
      // Only a trusted, synchronous verifier may bind recipient-side evidence.
      // Neither the raw input nor the provider's identifiers enter SQLite.
      let decision;
      try {
        const result = verifyQaReceipt(Object.freeze({ ...expected, evidence }));
        if (result instanceof Promise) {
          result.catch(() => {});
          throw new StateError("QA_DECISION_FAILED");
        }
        decision = project(result, ["eventId", "receivedAt"]);
      } catch {
        throw new StateError("QA_DECISION_FAILED");
      }
      if (!decision || decision.eventId !== id || !time(decision.receivedAt) ||
        decision.receivedAt < expected.intentAt || decision.receivedAt >= expected.expiresAt) return false;
      return update((_, now) => decision.receivedAt <= now && write(`UPDATE events SET qa_receipt_at=?
        WHERE id=? AND intent_at=? AND qa_receipt_at IS NULL`, decision.receivedAt, id, expected.intentAt) === 1);
    },
    snapshot() {
      need(!closed, "STATE_CLOSED");
      // A snapshot is evidence, not permission to send. Only claim checks time.
      return transaction(db, false, () => {
        const run = runRow();
        return { runId, startsAt: run.starts_at, expiresAt: run.expires_at, lastAt: run.last_at,
          termination: run.termination, state: stateOf(run),
          events: db.prepare("SELECT * FROM events ORDER BY seq").all().map(safeEvent) };
      }, "STATE_READ_FAILED");
    },
    close() {
      if (!closed) {
        closed = true;
        try { db.close(); } catch { throw new StateError("STATE_CLOSE_FAILED"); }
      }
    },
  });
}

export const createUptimeCanaryState = options => store(options, true);
export const openUptimeCanaryState = options => store(options, false);
