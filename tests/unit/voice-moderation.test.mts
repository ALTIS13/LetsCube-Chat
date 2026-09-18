import assert from "node:assert/strict";
import test from "node:test";

import {
  isVoiceModerator,
  voiceModerationActions,
  voiceModerationAuthBlock,
  voiceModerationBlock,
  voiceModerationFeedback,
  voiceModerationRoute,
  type VoiceModerationBlock,
  type VoiceModerationTarget,
  type VoiceModerationViewer,
} from "../../artifacts/kub/src/lib/voiceModeration.ts";
import { moderationRefusal } from "../../supabase/functions/voice-gateway/moderation.mjs";

/**
 * Who the interface offers to silence or disconnect, and — the part that
 * matters — whether it agrees with the server that would answer.
 *
 * The client's copy of the matrix exists so a control is not offered for
 * something the rules forbid: a menu that offers «Заглушить» on the owner and
 * then says «Владельца нельзя заглушить» has told the reader a rule it knew
 * before they touched anything. But a second copy of a rule is a second place
 * for it to be wrong, so the first test below does not check the copy against
 * my understanding of it — it checks it against
 * `supabase/functions/voice-gateway/moderation.mjs`, the module the deployed
 * gateway actually runs, on every combination of both roles, both routes and a
 * target who is the caller.
 *
 * Two deliberate divergences, and they are asserted rather than tolerated:
 *
 *  - **`canSpeak`.** The server has no opinion about whether somebody is
 *    already silenced; both directions are idempotent and both succeed. The
 *    interface does have one, because offering a control that changes nothing is
 *    the defect being closed. So the mirrored function takes no `canSpeak` at
 *    all and the state decision is tested separately.
 *  - **An unknown reader.** The gateway always has a caller — it read the JWT —
 *    so it has no refusal for «I do not know who I am». The client can be in
 *    that state before the session resolves, and must fail closed.
 */

const OWNER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADMIN = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e";
const MEMBER = "2a3b4c5d-6e7f-4a8b-8c9d-0e1f2a3b4c5f";
const OTHER = "3a4b5c6d-7e8f-4a9b-8c9d-0e1f2a3b4c60";

/** The client's names for the gateway's refusals. Only `self` is spelled differently. */
const AS_WIRE: Record<string, string> = {
  not_a_member: "not_a_member",
  not_a_moderator: "not_a_moderator",
  self: "self_not_allowed",
  target_is_owner: "target_is_owner",
  target_not_a_member: "target_not_a_member",
  target_protected: "target_protected",
};

const viewer = (role: string | null, selfId: string | null = ADMIN): VoiceModerationViewer => ({
  selfId,
  role,
});

const target = (
  role: string | null,
  userId = MEMBER,
  canSpeak: boolean | null = null,
): VoiceModerationTarget => ({ userId, role, canSpeak });

test("the client's matrix is the deployed gateway's matrix, combination for combination", () => {
  const roles = [null, "", "  ", "owner", "admin", "member", "OWNER", "Admin", "moderator", "guest"];
  const routes = ["force-mute", "remove"] as const;
  let compared = 0;

  for (const callerRole of roles) {
    for (const targetRole of roles) {
      for (const route of routes) {
        for (const targetId of [MEMBER, ADMIN]) {
          const mine = voiceModerationAuthBlock(
            viewer(callerRole, ADMIN),
            target(targetRole, targetId),
            route,
          );
          const theirs = moderationRefusal({
            action: route,
            callerId: ADMIN,
            callerRole,
            targetId,
            targetRole,
          });

          const expected = theirs === null ? null : theirs.error;
          const actual = mine === null ? null : AS_WIRE[mine];
          assert.equal(
            actual,
            expected,
            `caller ${JSON.stringify(callerRole)} / target ${JSON.stringify(targetRole)} / ` +
              `${route} / ${targetId === ADMIN ? "self" : "other"}: the interface says ` +
              `${JSON.stringify(mine)} and the gateway says ${JSON.stringify(expected)}`,
          );
          compared += 1;
        }
      }
    }
  }

  // The control. Without it a mistake that made both sides answer `null` for
  // everything — or a loop that ran zero times — would read as agreement.
  assert.equal(compared, roles.length * roles.length * routes.length * 2);
  assert.equal(
    voiceModerationAuthBlock(viewer("member"), target("member"), "remove"),
    "not_a_moderator",
    "the matrix agreed with the gateway about nothing at all",
  );
  assert.equal(voiceModerationAuthBlock(viewer("owner", OWNER), target("member"), "remove"), null);
});

test("a reader whose own id is not known yet may not act on anybody", () => {
  // Fails closed, and the reason is specific rather than tidy: the one action
  // that must never be offered about yourself is this one, because lifting a
  // silence recomputes a permission the gateway deliberately recomputes, and a
  // second door to it is one door too many.
  for (const route of ["force-mute", "remove"] as const) {
    assert.equal(
      voiceModerationAuthBlock(viewer("owner", null), target("member"), route),
      "self",
      "an unresolved session was allowed to moderate",
    );
  }
  // And it is the *unknown id* that refuses, not the role: the same viewer with
  // an id is allowed.
  assert.equal(voiceModerationAuthBlock(viewer("owner", OWNER), target("member"), "remove"), null);
});

test("somebody with no membership row can be put out of the room but not silenced", () => {
  const stranger = target(null, OTHER);
  assert.equal(voiceModerationAuthBlock(viewer("admin"), stranger, "remove"), null);
  assert.equal(
    voiceModerationAuthBlock(viewer("admin"), stranger, "force-mute"),
    "target_not_a_member",
    "a silence was offered over a role that does not exist to compute it from",
  );
});

test("the owner is refused by name, before the set of moderatable roles is consulted", () => {
  // The distinction the gateway's own comment records: adding `owner` to
  // MODERATABLE_ROLES changes nothing, because this line answers first. Asserted
  // by the code it carries — `target_protected` would mean the wrong line
  // refused, and the reader would be told «недоступно» instead of the rule.
  assert.equal(voiceModerationAuthBlock(viewer("owner", OWNER), target("owner", OTHER), "remove"), "target_is_owner");
  assert.equal(voiceModerationAuthBlock(viewer("admin"), target("owner", OTHER), "force-mute"), "target_is_owner");
  assert.equal(voiceModerationAuthBlock(viewer("admin"), target("moderator", OTHER), "remove"), "target_protected");
});

test("each action travels the route the gateway named, and only «disconnect» is the other one", () => {
  assert.equal(voiceModerationRoute("silence"), "force-mute");
  assert.equal(voiceModerationRoute("unsilence"), "force-mute");
  assert.equal(voiceModerationRoute("disconnect"), "remove");
});

test("a silence is not offered to somebody already silenced, nor a lift to somebody who is not", () => {
  const admin = viewer("admin");
  assert.equal(voiceModerationBlock(admin, target("member", MEMBER, true), "silence"), null);
  assert.equal(
    voiceModerationBlock(admin, target("member", MEMBER, false), "silence"),
    "already_silenced",
  );
  assert.equal(voiceModerationBlock(admin, target("member", MEMBER, false), "unsilence"), null);
  assert.equal(
    voiceModerationBlock(admin, target("member", MEMBER, true), "unsilence"),
    "not_silenced",
  );
  // Disconnecting has nothing to do with whether they may speak.
  for (const canSpeak of [true, false, null]) {
    assert.equal(voiceModerationBlock(admin, target("member", MEMBER, canSpeak), "disconnect"), null);
  }
});

test("unknown offers both directions, because the alternative is a silence nobody can lift", () => {
  // `null` means the reader is looking at a room this client is not connected
  // to, where nothing reports a permission. Hiding the lift there would leave a
  // moderator who silences somebody and then leaves the room unable to undo it.
  const both = voiceModerationActions(viewer("admin"), target("member", MEMBER, null));
  assert.deepEqual(both, ["silence", "unsilence", "disconnect"]);

  // The mutation this is here for is reading `null` as «can speak», which would
  // silently drop the lift everywhere outside the current room.
  assert.ok(both.includes("unsilence"), "«unknown» was read as «not silenced»");
  assert.ok(both.includes("silence"), "«unknown» was read as «already silenced»");
});

test("the list of actions is what decides whether the row is a menu at all", () => {
  // A plain member gets nothing, so the rail must not make the row pressable.
  assert.deepEqual(voiceModerationActions(viewer("member", MEMBER), target("member", OTHER)), []);
  // Nor does a moderator get anything on their own row.
  assert.deepEqual(voiceModerationActions(viewer("admin", ADMIN), target("admin", ADMIN)), []);
  // Nor on the owner's.
  assert.deepEqual(voiceModerationActions(viewer("admin", ADMIN), target("owner", OWNER)), []);
  // A moderator looking at a member in the room they are in gets two: the
  // silence that applies and the disconnect. Not the lift — they are not
  // silenced.
  assert.deepEqual(
    voiceModerationActions(viewer("admin", ADMIN), target("member", MEMBER, true)),
    ["silence", "disconnect"],
  );
});

test("«owner» and «admin» moderate, in any casing, and nothing else does", () => {
  for (const role of ["owner", "admin", "OWNER", " Admin "]) {
    assert.equal(isVoiceModerator(role), true, `${role} could not moderate`);
  }
  for (const role of [null, "", "member", "moderator", "guest", "owners"]) {
    assert.equal(isVoiceModerator(role), false, `${JSON.stringify(role)} could moderate`);
  }
});

test("every block this module can answer is one the interface knows what to do with", () => {
  // The control against a widened union nobody taught the rail about: a new
  // block code added here with no handling anywhere is a row that silently
  // stops offering something, which is exactly how a control disappears without
  // anybody noticing.
  const known: VoiceModerationBlock[] = [
    "not_a_member",
    "not_a_moderator",
    "self",
    "target_is_owner",
    "target_not_a_member",
    "target_protected",
    "already_silenced",
    "not_silenced",
  ];
  const seen = new Set<string>();
  for (const callerRole of [null, "member", "admin", "owner", "moderator"]) {
    for (const targetRole of [null, "member", "admin", "owner", "moderator"]) {
      for (const canSpeak of [true, false, null]) {
        for (const action of ["silence", "unsilence", "disconnect"] as const) {
          for (const selfId of [null, ADMIN]) {
            const block = voiceModerationBlock(
              viewer(callerRole, selfId),
              target(targetRole, MEMBER, canSpeak),
              action,
            );
            if (block) seen.add(block);
          }
        }
      }
    }
  }
  for (const block of seen) {
    assert.ok(known.includes(block as VoiceModerationBlock), `${block} is not in the known set`);
  }
  // And the reverse: every name in the union is actually reachable. A block
  // nobody can produce is dead vocabulary, and one that stops being reachable
  // is a rule that quietly stopped applying.
  assert.deepEqual([...seen].sort(), [...known].sort());
});

test("a lift the gateway refused to grant is not reported as a success", () => {
  // The branch this file exists for as much as the matrix. `muted: false` makes
  // the gateway recompute the permission from the person's role against the
  // channel's `speak_role` and any staff mute; when the answer is still no, the
  // silence really was lifted and they really still cannot speak. Both halves
  // have to be in the sentence.
  const refused = voiceModerationFeedback("unsilence", "Анна", { ok: true, canSpeak: false });
  assert.equal(refused.kind, "warning", "a lift that granted nothing was called a success");
  assert.ok(
    !refused.title.includes("снова может говорить"),
    "the line claims speech over an answer that refused it",
  );
  assert.match(String(refused.detail), /не хватает прав/);

  const granted = voiceModerationFeedback("unsilence", "Анна", { ok: true, canSpeak: true });
  assert.equal(granted.kind, "success");
  assert.equal(granted.title, "Анна снова может говорить");

  // Unknown is not «no». `remove` reports no permission and an older gateway
  // might omit the field; warning every moderator about a restriction that
  // probably is not there would be its own false statement.
  assert.equal(voiceModerationFeedback("unsilence", "Анна", { ok: true, canSpeak: null }).kind, "success");
});

test("each action's own line says what it did, and the disconnect says what it did not", () => {
  const silenced = voiceModerationFeedback("silence", "Пётр", { ok: true, canSpeak: false });
  assert.equal(silenced.kind, "success");
  assert.match(silenced.title, /Пётр/);
  assert.match(silenced.title, /не может говорить/);

  const disconnected = voiceModerationFeedback("disconnect", "Пётр", { ok: true, canSpeak: null });
  assert.equal(disconnected.kind, "success");
  // A disconnect is not a ban, and a moderator who reads it as one will be
  // surprised a second later when the person walks back in.
  assert.match(String(disconnected.detail), /не запрещает/);

  const refused = voiceModerationFeedback("silence", "Пётр", {
    ok: false,
    refusalText: "Владельца группы нельзя заглушить или отключить.",
  });
  assert.equal(refused.kind, "error");
  assert.equal(refused.title, "Владельца группы нельзя заглушить или отключить.");
  assert.equal(refused.detail, undefined, "a refusal grew a second line the gateway never sent");
});
