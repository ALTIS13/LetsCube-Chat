/**
 * Making a chat: the client chooses the id, and never asks for the row back.
 *
 * `POST /rest/v1/chats?select=id` answered **403** on production — five times
 * in the gateway log over three days, while **no chat was created at all in
 * those three days**. Nobody could make a group, the owner of this deployment
 * included.
 *
 * It is not a permission anybody lacks. **When an INSERT carries a RETURNING
 * clause, PostgreSQL applies the SELECT policy to the returned row as well**,
 * and `chats` has exactly one SELECT policy:
 *
 *     Chat members can view chats
 *       EXISTS (select 1 from chat_members
 *                where chat_members.chat_id = chats.id
 *                  and chat_members.user_id = auth.uid())
 *
 * The creator's membership row is written by `trg_add_chat_creator_as_owner`,
 * an **AFTER INSERT** trigger, so at the moment RETURNING is evaluated that row
 * does not exist yet. The insert succeeds and is then refused on the way back,
 * and the statement rolls back with it. Measured on production, rolled back,
 * as the same account both times:
 *
 *     insert into public.chats (...) values (...)              -> OK
 *     insert into public.chats (...) values (...) returning id  -> new row
 *                                violates row-level security policy for "chats"
 *
 * `.insert(row).select("id").single()` is precisely the second form, which is
 * why two call sites were broken and neither said anything useful: the client
 * saw a 403 and printed «Не удалось создать группу».
 *
 * **Why the fix is here and not in the database.** A SELECT policy of
 * `created_by = auth.uid()` would make RETURNING work for every caller, and it
 * would also let somebody who was removed from a group they once created go on
 * reading its row. That is a real widening for a defect the client can fix by
 * not asking a question it already knows the answer to. `chats.id` has a
 * default but nothing stops the client supplying one, and the INSERT policy
 * constrains `created_by` and `type` only.
 *
 * The rest of the class was checked rather than assumed: `topics`,
 * `voice_channels` and `chat_channel_categories` all accept an insert WITH
 * RETURNING for a real group owner, because their policies ask
 * `is_chat_admin(chat_id)` — a row that already exists — rather than one a
 * trigger is about to write.
 */

/**
 * A fresh chat id.
 *
 * `crypto.randomUUID` needs a secure context, which the browser, the Windows
 * shell and the Android WebView all are — but a missing one would break making
 * a chat on whichever shell lacked it, which is the same shape of failure this
 * module exists to remove. So it falls back to `getRandomValues` and shapes a
 * v4 by hand, and only then to a last resort that is weaker but still unique
 * enough for one row.
 */
export function newChatId(): string {
  const source = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  if (source && typeof source.randomUUID === "function") return source.randomUUID();

  const bytes = new Uint8Array(16);
  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return uuidV4FromBytes(bytes);
}

/**
 * Sixteen bytes shaped into a version 4 uuid.
 *
 * Exported so the fallback can be measured without replacing `globalThis.crypto`
 * — which Node refuses to reassign, so a test that tried would be testing its
 * own mock rather than this.
 */
export function uuidV4FromBytes(source: Uint8Array): string {
  if (source.length < 16) throw new Error("a uuid needs sixteen bytes");
  const bytes = source.slice(0, 16);
  // Version 4, variant 1 — the two fields a reader of the id can check.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** What the client writes for a new chat, id included so nothing is read back. */
export interface NewChatRow {
  readonly id: string;
  readonly type: "group";
  readonly name: string;
  readonly created_by: string;
}

/**
 * The row for a new group.
 *
 * The name is trimmed here rather than at each call site, because the INSERT
 * policy does not constrain it and two callers trimming differently is how one
 * of them ends up with a group called « ».
 */
export function newGroupRow(input: { name: string; createdBy: string; id?: string }): NewChatRow {
  return {
    id: input.id ?? newChatId(),
    type: "group",
    name: input.name.trim(),
    created_by: input.createdBy,
  };
}
