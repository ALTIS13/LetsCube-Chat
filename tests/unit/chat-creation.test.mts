// Making a chat must not ask for the row back.
//
// `POST /rest/v1/chats?select=id` answered 403 on production five times over
// three days while no chat was created at all: `INSERT ... RETURNING` is judged
// by the SELECT policy as well, and `chats` grants SELECT only to a member — a
// row `trg_add_chat_creator_as_owner` writes AFTER the insert. So the row went
// in and was refused on the way out, taking the statement with it.
//
// Measured on production, rolled back, the same account both ways:
//   insert ... values (...)             -> OK
//   insert ... values (...) returning id -> new row violates RLS for "chats"
// and the fixed shape — our own id, no read-back — is accepted for a plain user
// and for an admin alike.
//
// The source guard below is the load-bearing half. The defect is one chained
// call, it typechecks, it passes every mocked test, and it is invisible until
// somebody tries to make a group against a real database.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { newChatId, newGroupRow, uuidV4FromBytes } from "../../artifacts/kub/src/lib/chatCreation.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("a fresh id is a v4 uuid, and a different one each time", () => {
  const first = newChatId();
  assert.match(first, UUID_V4);
  const many = new Set(Array.from({ length: 200 }, () => newChatId()));
  assert.equal(many.size, 200, "two ids collided in two hundred");
});

test("the fallback shapes a real v4, and stamps the two fields a reader checks", () => {
  // Measured directly rather than by replacing `globalThis.crypto`, which Node
  // refuses to reassign — a test that tried would be checking its own mock.
  const zeros = uuidV4FromBytes(new Uint8Array(16));
  assert.match(zeros, UUID_V4);
  // Version nibble and variant bits, from bytes that carried neither.
  assert.equal(zeros[14], "4");
  assert.ok(["8", "9", "a", "b"].includes(zeros[19]));

  const ones = uuidV4FromBytes(new Uint8Array(16).fill(0xff));
  assert.match(ones, UUID_V4);
  assert.notEqual(ones, zeros);

  assert.throws(() => uuidV4FromBytes(new Uint8Array(15)), /sixteen/);
});

test("the row carries its own id, a trimmed name and the creator", () => {
  const row = newGroupRow({ name: "  Команда проекта  ", createdBy: "u-1" });
  assert.match(row.id, UUID_V4);
  assert.equal(row.type, "group");
  assert.equal(row.name, "Команда проекта");
  assert.equal(row.created_by, "u-1");

  // An id may be supplied, so a caller that already has one does not get a
  // second.
  assert.equal(newGroupRow({ name: "x", createdBy: "u", id: "given" }).id, "given");
});

// ---------------------------------------------------------------------------
// The guard. Source-read, and the reason the defect could not be caught by a
// mocked test: every fixture answers the read-back happily.
// ---------------------------------------------------------------------------

const SITES = [
  "artifacts/kub/src/components/sidebar/NewGroupModal.tsx",
  "artifacts/kub/src/lib/savedMessages.ts",
];

test("no chats insert reads its own row back", () => {
  for (const file of SITES) {
    const source = readFileSync(file, "utf8");
    // Every `from("chats")` chain, up to the end of its statement.
    const chains = source.split('from("chats")').slice(1);
    assert.ok(chains.length > 0, `${file}: no chats access at all — has it moved?`);
    for (const chain of chains) {
      const statement = chain.slice(0, chain.indexOf(";") + 1);
      if (!/\.insert\(/.test(statement)) continue;
      assert.ok(
        !/\.select\(/.test(statement),
        `${file}: a chats insert reads its own row back again — PostgREST turns ` +
          `that into INSERT ... RETURNING, which the SELECT policy refuses ` +
          `because the creator is not a member until an AFTER trigger says so`,
      );
    }
  }
});

test("both call sites build the row through this module, not by hand", () => {
  // Not «the file mentions newGroupRow»: a mutation that spelled the row out
  // inline left the import behind, the file still contained the word, and this
  // test stayed green over the defect. What has to be true is that the value
  // being inserted came from here.
  for (const file of SITES) {
    const source = readFileSync(file, "utf8");
    const chains = source.split('from("chats")').slice(1);
    for (const chain of chains) {
      const statement = chain.slice(0, chain.indexOf(";") + 1);
      if (!/\.insert\(/.test(statement)) continue;
      const inserted = /\.insert\(([^)]*)\)/.exec(statement)?.[1]?.trim() ?? "";
      assert.ok(
        inserted.length > 0 && !inserted.includes("{"),
        `${file}: the row is spelled out inside .insert(...) again — it has to ` +
          `come from newGroupRow, or the id and the trimming live in two places`,
      );
      // Plain substring rather than a built regular expression: the escapes
      // in a generated pattern did not survive being written through a shell,
      // and the test failed on its own regex rather than on the product.
      assert.ok(
        source.includes(`const ${inserted} = newGroupRow(`) ||
          source.includes(`let ${inserted} = newGroupRow(`),
        `${file}: .insert(${inserted}) is fed by something other than newGroupRow`,
      );
    }
  }
});
