// The check that asks whether a recorded migration is actually on the database.
//
// It exists because six migrations sat unapplied for three days while the
// register called them fixed. These tests pin the two things that would make it
// lie: reading SQL out of a comment, and failing to notice an absent object.
import assert from "node:assert/strict";
import test from "node:test";

import {
  compare,
  objectsCreatedBy,
  readLiveObjects,
} from "../../scripts/migration-inventory.mjs";

test("it reads the four statements these migrations are written with", () => {
  const objects = objectsCreatedBy(`
    create table if not exists private.message_deletions (id uuid primary key);
    create table public.voice_channels (id uuid primary key);
    create or replace function public.forward_message(p_id uuid) returns void as $$ $$ language sql;
    create function private.advance_read_mark(p_chat uuid) returns void as $$ $$ language sql;
    create policy "Chat members can view reactions" on public.reactions for select using (true);
    create trigger trg_guard_chat_member_read_marks before update on public.chat_members
      for each row execute function private.guard_chat_member_read_marks();
  `);

  assert.deepEqual(objects.tables, ["private.message_deletions", "public.voice_channels"]);
  assert.deepEqual(objects.functions, ["private.advance_read_mark", "public.forward_message"]);
  assert.deepEqual(objects.policies, ['Chat members can view reactions@public.reactions']);
  assert.deepEqual(objects.triggers, ["trg_guard_chat_member_read_marks"]);
});

test("an unqualified name means public, which is what these files assume", () => {
  const objects = objectsCreatedBy(`
    create table reactions (id uuid);
    create function set_message_reaction(p uuid) returns void as $$ $$ language sql;
    create policy "open" on reactions for select using (true);
  `);
  assert.deepEqual(objects.tables, ["public.reactions"]);
  assert.deepEqual(objects.functions, ["public.set_message_reaction"]);
  assert.deepEqual(objects.policies, ['open@public.reactions']);
});

test("SQL quoted in a header is not SQL", () => {
  // Every migration in this project opens with a long block comment that
  // describes what exists today, and several of them quote the statement they
  // are replacing. Counting those would report objects no migration creates and
  // bury the real answer in noise.
  const objects = objectsCreatedBy(`
    /**
     * WHAT EXISTS. create policy "Anyone in chat can view reactions" on public.reactions
     * and create table public.ghost (…), neither of which this file makes.
     */
    -- create function public.also_not_made() returns void as $$ $$ language sql;
    create policy "Chat members can view reactions" on public.reactions for select using (true);
  `);
  assert.deepEqual(objects.policies, ["Chat members can view reactions@public.reactions"]);
  assert.deepEqual(objects.tables, []);
  assert.deepEqual(objects.functions, []);
});

test("the export's lines become four sets, and anything else is ignored", () => {
  const live = readLiveObjects(
    [
      "Pager usage is off.",
      "F|public.forward_message",
      "T|private.message_deletions",
      "P|Chat members can view reactions@public.reactions",
      "G|trg_guard_chat_member_read_marks",
      "",
      "ROLLBACK",
      "X|something else entirely",
    ].join("\n"),
  );
  assert.deepEqual([...live.F], ["public.forward_message"]);
  assert.deepEqual([...live.T], ["private.message_deletions"]);
  assert.deepEqual([...live.P], ["Chat members can view reactions@public.reactions"]);
  assert.deepEqual([...live.G], ["trg_guard_chat_member_read_marks"]);
});

test("an object the database does not have is reported, and one it has is not", () => {
  const migrations = [
    {
      file: "20260911150000_reactions_visible_to_chat_members.sql",
      objects: {
        functions: [],
        tables: [],
        policies: ["Chat members can view reactions@public.reactions"],
        triggers: [],
      },
    },
    {
      file: "20260913150000_voice_channels.sql",
      objects: {
        functions: ["public.voice_channel_chat"],
        tables: ["public.voice_channels"],
        policies: [],
        triggers: [],
      },
    },
  ];
  const live = readLiveObjects(
    ["F|public.voice_channel_chat", "T|public.voice_channels"].join("\n"),
  );

  const gaps = compare(migrations, live);
  assert.equal(gaps.length, 1, "the applied migration was reported as missing");
  assert.equal(gaps[0].file, "20260911150000_reactions_visible_to_chat_members.sql");
  assert.deepEqual(gaps[0].absent, [
    'policy "Chat members can view reactions" on public.reactions',
  ]);
});

test("nothing absent means nothing reported", () => {
  const live = readLiveObjects("F|public.a\nT|public.b\nP|c@public.b\nG|d");
  const gaps = compare(
    [{ file: "m.sql", objects: { functions: ["public.a"], tables: ["public.b"], policies: ["c@public.b"], triggers: ["d"] } }],
    live,
  );
  assert.deepEqual(gaps, []);
});
