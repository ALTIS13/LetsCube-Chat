// The client's copies of the five task RPC authorization gates (D-124).
//
// `public.tasks` blocks INSERT, UPDATE and DELETE at RLS outright, so these
// SECURITY DEFINER functions are the only authority. Every gate below was read
// off production on 2026-09-15 and is quoted in `lib/taskActionAccess.ts`.
//
// The two assertions worth the most here are negative: a location administrator
// must **not** be offered confirm, reject or assign. D-124 proposed exactly
// that widening; the database refuses it, measured inside a rolled-back
// transaction against the one account holding `location_admin` with no global
// role.
import assert from "node:assert/strict";
import test from "node:test";

import {
  canAssignTask,
  canCancelTask,
  canConfirmTask,
  canEditTask,
  canRejectTask,
  type TaskActionActor,
  type TaskActionStatus,
} from "../../artifacts/kub/src/lib/taskActionAccess.ts";

const ALL_STATUSES: TaskActionStatus[] = [
  "new",
  "assigned",
  "accepted",
  "in_progress",
  "waiting_confirmation",
  "confirmed",
  "rejected",
  "cancelled",
];

function actor(overrides: Partial<TaskActionActor> = {}): TaskActionActor {
  return {
    isManagerOrAdmin: false,
    isCreator: false,
    isAssignee: false,
    isLocationAdmin: false,
    ...overrides,
  };
}

/** Nobody in particular: not staff, not the creator, not at a location they run. */
const stranger = actor();
/** `is_manager_or_admin(auth.uid())` — what `matchesIsManagerOrAdmin` answers. */
const staff = actor({ isManagerOrAdmin: true });
/**
 * The account measured on production: `location_admin` over two locations,
 * `profiles.role = 'user'`, no global role key. `is_location_admin` is true for
 * their locations; `is_manager_or_admin` is false.
 */
const locationAdmin = actor({ isLocationAdmin: true });

test("task_confirm: staff only, waiting_confirmation only, and never your own", () => {
  assert.equal(canConfirmTask(staff, "waiting_confirmation"), true);
  assert.equal(canConfirmTask(stranger, "waiting_confirmation"), false);
  // `if cur.assignee_id = caller then raise 'Нельзя подтверждать собственную задачу'`
  assert.equal(
    canConfirmTask(actor({ isManagerOrAdmin: true, isAssignee: true }), "waiting_confirmation"),
    false,
  );
  // Exactly one status admits, and the list is checked rather than sampled.
  const admitting = ALL_STATUSES.filter((status) => canConfirmTask(staff, status));
  assert.deepEqual(admitting, ["waiting_confirmation"]);
});

test("task_reject carries the identical gate to task_confirm, on every status", () => {
  for (const status of ALL_STATUSES) {
    for (const who of [stranger, staff, locationAdmin]) {
      assert.equal(canRejectTask(who, status), canConfirmTask(who, status), status);
    }
  }
});

test("task_assign: staff only, and only before the task is picked up", () => {
  const admitting = ALL_STATUSES.filter((status) => canAssignTask(staff, status));
  assert.deepEqual(admitting, ["new", "assigned"]);
  assert.equal(canAssignTask(stranger, "new"), false);
  // Being the creator does not let you assign — only `task_cancel` and
  // `task_update_v3` carry a creator branch.
  assert.equal(canAssignTask(actor({ isCreator: true }), "new"), false);
});

test("task_cancel: the creator counts, which is the branch the modal had dropped", () => {
  // `if not (cur.created_by = caller or public.is_manager_or_admin(caller))`.
  // Measured on production: this exact call SUCCEEDED for the location
  // administrator on a task they had created, while confirm and assign were
  // refused in the same transaction.
  assert.equal(canCancelTask(actor({ isCreator: true }), "new"), true);
  assert.equal(canCancelTask(staff, "new"), true);
  assert.equal(canCancelTask(stranger, "new"), false);
  // A location administrator who did not create it is not admitted: the RPC
  // has no location branch at all.
  assert.equal(canCancelTask(locationAdmin, "new"), false);
});

test("task_cancel locks on three statuses, task_update_v3 on two, and 'rejected' is the difference", () => {
  const cancellable = ALL_STATUSES.filter((status) => canCancelTask(staff, status));
  assert.deepEqual(cancellable, ["new", "assigned", "accepted", "in_progress", "waiting_confirmation"]);

  const editable = ALL_STATUSES.filter((status) => canEditTask(staff, status));
  assert.deepEqual(editable, [
    "new",
    "assigned",
    "accepted",
    "in_progress",
    "waiting_confirmation",
    "rejected",
  ]);

  // The two sets really do differ, and only there.
  assert.equal(canCancelTask(staff, "rejected"), false);
  assert.equal(canEditTask(staff, "rejected"), true);
});

test("task_update_v3: the location branch admits, and it is the one the modal never offered", () => {
  assert.equal(canEditTask(locationAdmin, "new"), true);
  assert.equal(canEditTask(actor({ isCreator: true }), "new"), true);
  assert.equal(canEditTask(staff, "new"), true);
  assert.equal(canEditTask(stranger, "new"), false);
  // A task with no location gives the caller `isLocationAdmin: false`, which is
  // what `coalesce(p_location_id, v_task.location_id) is not null` does.
  assert.equal(canEditTask(actor({ isLocationAdmin: false }), "new"), false);
});

test("the location administrator measured on production: edit yes, the other three no", () => {
  // loc_perm(tasks.manage)=true, loc_perm(location_members.manage)=true,
  // is_manager_or_admin=false, is_location_admin=true — and then:
  //   task_confirm : REFUSED -> Подтверждать может только администратор или менеджер
  //   task_assign  : REFUSED -> Только администратор или менеджер может назначать задачи
  // So holding `tasks.manage` for the location buys none of these three, and a
  // client that offered them would draw a button the database refuses.
  assert.equal(canConfirmTask(locationAdmin, "waiting_confirmation"), false);
  assert.equal(canRejectTask(locationAdmin, "waiting_confirmation"), false);
  assert.equal(canAssignTask(locationAdmin, "new"), false);
  assert.equal(canCancelTask(locationAdmin, "new"), false);
  assert.equal(canEditTask(locationAdmin, "new"), true);
});

test("no gate admits a stranger on any status", () => {
  for (const status of ALL_STATUSES) {
    assert.equal(canConfirmTask(stranger, status), false, `confirm ${status}`);
    assert.equal(canRejectTask(stranger, status), false, `reject ${status}`);
    assert.equal(canAssignTask(stranger, status), false, `assign ${status}`);
    assert.equal(canCancelTask(stranger, status), false, `cancel ${status}`);
    assert.equal(canEditTask(stranger, status), false, `edit ${status}`);
  }
});

// ---------------------------------------------------------------------------
// The wiring, not the rule.
//
// Every mutation of the module above is caught by the tests above. Two
// mutations of the *component* were not, and that is the gap this section
// exists for: a pure module can be perfect while the screen that is supposed to
// ask it computes its own answer instead. `node --test` cannot render
// `TaskDetailModal` — it imports React, the store and supabase-js — and this
// deployment has no live task to render it against (all 40 rows are
// soft-deleted, the last on 2026-07-13), so this reads the source.
//
// A source scan is the weakest kind of test in this repository and has gone
// green over a real regression before. It is bounded here: each assertion names
// one exact expression and the region it must appear in, so it cannot be
// satisfied by a similar line somewhere else in an 880-line file.
import { readFileSync } from "node:fs";

const MODAL_SOURCE = readFileSync(
  new URL("../../artifacts/kub/src/pages/tasks/TaskDetailModal.tsx", import.meta.url),
  "utf8",
);

/** The `const actor: TaskActionActor = { … };` literal, and nothing past it. */
function actorLiteral(): string {
  const match = MODAL_SOURCE.match(/const actor: TaskActionActor = \{([^}]*)\}/);
  assert.ok(match, "the modal no longer builds a TaskActionActor");
  return match[1];
}

test("wiring: the modal asks the server predicate, not the client's wide isStaff", () => {
  assert.match(
    MODAL_SOURCE,
    /const \{ allowed: isManagerOrAdmin \} = useMatchesIsManagerOrAdmin\(\);/,
    "isManagerOrAdmin must come from useMatchesIsManagerOrAdmin()",
  );
  // The wide predicate must not come back. Its import is gone too.
  assert.doesNotMatch(
    MODAL_SOURCE,
    /=\s*useIsManagerOrAdmin\(\)/,
    "useIsManagerOrAdmin() is the wide isStaff and must not gate a task RPC",
  );
});

test("wiring: the actor carries the four inputs, each as the live value", () => {
  // Shorthand only. A hardcoded `isLocationAdmin: false` was the second
  // component mutation that slipped through, and it is a property with a value
  // rather than a bare name — so compare the whole set of names instead of
  // searching for a substring that both spellings contain.
  const fields = actorLiteral()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  assert.deepEqual(
    fields.slice().sort(),
    ["isAssignee", "isCreator", "isLocationAdmin", "isManagerOrAdmin"],
    "each actor field must be passed as the live value, not a literal",
  );
});

test("wiring: each flag is computed by the module rather than re-derived", () => {
  assert.match(MODAL_SOURCE, /canConfirmReject = !taskIsDeleted && canConfirmTask\(actor, task\.status\)/);
  assert.match(MODAL_SOURCE, /canCancel = !taskIsDeleted && canCancelTask\(actor, task\.status\)/);
  assert.match(MODAL_SOURCE, /canAssign = !taskIsDeleted && canAssignTask\(actor, task\.status\)/);
  assert.match(MODAL_SOURCE, /canEdit = !taskIsDeleted && canEditTask\(actor, task\.status\)/);
});

test("wiring: the location answer comes from the database, gated on the task having one", () => {
  assert.match(
    MODAL_SOURCE,
    /const \{ isLocationAdmin \} = useIsLocationAdmin\(task\?\.location_id \?\? null, \{\s*enabled: Boolean\(task\?\.id && task\.location_id\),\s*\}\);/,
    "the modal must ask useIsLocationAdmin for the task's own location",
  );
});
