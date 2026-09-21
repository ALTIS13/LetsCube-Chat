// What a bot's card says, and what a person's card says that it must not
// (D-263, third complaint).
//
// The shape is Discord's rather than Telegram's, and both were read on the
// device on 2026-09-21 — `P212C6000159`, Telegram 12.10.3 and Discord 345.9.
// Telegram's bot profile lists **no commands at all**; Discord's carries them
// and a door to the whole list. The reason for taking Discord's is in
// `artifacts/kub/src/lib/botProfile.ts` and in `CLAUDE.md` §7.
//
// The module under test imports only `botChatSurfaces.ts`, which imports only
// `plainMessages.ts`, which imports nothing — so all of this runs in a bare
// `node --test` process.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BOT_PROFILE_COMMANDS_LABEL,
  BOT_PROFILE_DESCRIPTION_LABEL,
  BOT_PROFILE_MESSAGES,
  BOT_PROFILE_UNAVAILABLE,
  BOT_PROFILE_UNREACHABLE,
  botProfileCardModel,
  botProfileCommandDraft,
  botProfileCommandLabel,
  botProfileCommandsPressable,
} from "../../artifacts/kub/src/lib/botProfile.ts";
import { botCommandDraft, botMessageExplainsInternals } from "../../artifacts/kub/src/lib/botChatSurfaces.ts";

const ROW = {
  id: "b1",
  username: "shiftbot",
  display_name: "Смены",
  description: "  Подтверждение смен  ",
  avatar_url: "/media/bot.webp",
  state: "active",
};

const COMMANDS = [
  { command: "shift", description: "Ближайшая смена" },
  { command: "shifts", description: "Все смены" },
];

const model = (over: Record<string, unknown> = {}) =>
  botProfileCardModel({ seed: null, row: { ...ROW, ...over }, commands: COMMANDS, commandsSettled: true })!;

test("the card is built from the row, trimmed, with the handle spelled as everywhere else", () => {
  const card = model();
  assert.equal(card.botId, "b1");
  assert.equal(card.name, "Смены");
  assert.equal(card.handle, "@shiftbot");
  assert.equal(card.description, "Подтверждение смен");
  assert.equal(card.avatarUrl, "/media/bot.webp");
  assert.equal(card.reachable, true);
});

test("a bot without a display name is named by its handle rather than by nothing", () => {
  assert.equal(model({ display_name: "   " }).name, "@shiftbot");
});

test("a description of only whitespace is no description, so the block is absent", () => {
  assert.equal(model({ description: "   " }).description, null);
  assert.equal(model({ description: null }).description, null);
  assert.equal(model({ description: undefined }).description, null);
});

test("the read wins over the seed, and the seed is what paints first", () => {
  // The seed travels with a message and may be an hour of scrollback old.
  const seed = { ...ROW, display_name: "Старое имя" };
  const fresh = botProfileCardModel({ seed, row: ROW, commands: [], commandsSettled: true })!;
  assert.equal(fresh.name, "Смены");
  const painting = botProfileCardModel({ seed, row: null, commands: [], commandsSettled: false })!;
  assert.equal(painting.name, "Старое имя", "the opener's row is drawn while the read is out");
  assert.equal(painting.commandsSettled, false);
});

test("neither a seed nor a row is no card at all, never a bot with no name", () => {
  assert.equal(botProfileCardModel({ seed: null, row: null, commands: [], commandsSettled: true }), null);
});

test("only an active bot's commands can be pressed, and the card still names the bot", () => {
  // `public.bots`'s SELECT policy hands the row over whatever the state, which
  // is what keeps a disabled bot's name readable to the people it was talking
  // to (D-247). `private.bot_can_receive_message` admits `active` alone, so
  // the rows are drawn and dead rather than absent — with the reason said.
  for (const state of ["paused", "suspended", "pending_delete", "deleted"]) {
    const card = model({ state });
    assert.equal(card.reachable, false, state);
    assert.equal(card.name, "Смены", "a bot that cannot be reached still has a name");
    assert.equal(botProfileCommandsPressable(card), false, state);
  }
  assert.equal(botProfileCommandsPressable(model()), true);
});

test("a bot with no commands has nothing to press", () => {
  const card = botProfileCardModel({ seed: null, row: ROW, commands: [], commandsSettled: true })!;
  assert.equal(botProfileCommandsPressable(card), false);
});

test("a row missing its state is read as reachable, which is the column's own default", () => {
  assert.equal(model({ state: null }).reachable, true);
  assert.equal(model({ state: undefined }).reachable, true);
});

test("choosing a command on the card writes exactly the draft the composer's menu writes", () => {
  // One list, one behaviour, whichever door you came through. If these ever
  // disagree, the same command reaches a different bot depending on where it
  // was pressed — which is the drift `BotCommandMenu` is one component to avoid.
  const card = model();
  for (const chatType of ["group", "private", "channel", null, undefined]) {
    assert.equal(
      botProfileCommandDraft(card, COMMANDS[0], chatType),
      botCommandDraft(COMMANDS[0], { chatType, botUsername: "shiftbot" }),
      String(chatType),
    );
  }
});

test("the draft names THIS bot, which is the one thing the card can do that the menu cannot", () => {
  // `chooseChatBot` gives the composer a single bot, so in a group holding two
  // the menu reaches only the first. A card is opened from a particular face.
  const other = model({ id: "b2", username: "otherbot" });
  assert.equal(botProfileCommandDraft(other, COMMANDS[0], "group"), "/shift@otherbot ");
  assert.equal(botProfileCommandDraft(model(), COMMANDS[0], "group"), "/shift@shiftbot ");
});

test("a private chat's draft carries no address, because the authoriser needs none there", () => {
  assert.equal(botProfileCommandDraft(model(), COMMANDS[1], "private"), "/shifts ");
});

test("a row's name is written with the slash the menu uses", () => {
  assert.equal(botProfileCommandLabel(COMMANDS[0]), "/shift");
});

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

test("no sentence on this card explains the machine", () => {
  assert.deepEqual(
    BOT_PROFILE_MESSAGES.filter((message) => botMessageExplainsInternals(message)),
    [],
  );
});

test("the description's heading is this product's own word, not the reference's", () => {
  // Telegram writes «О себе» over the same field and Discord «Биография».
  // `BotSettingsPanel` and `BotCreateModal` have written «Описание» over it
  // since the bot platform shipped, and an owner who typed the text under one
  // heading should find it under the same one.
  assert.equal(BOT_PROFILE_DESCRIPTION_LABEL, "Описание");
  assert.equal(BOT_PROFILE_COMMANDS_LABEL, "Команды");
  const panel = readFileSync(
    new URL("../../artifacts/kub/src/components/bots/BotSettingsPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    panel.includes(`>${BOT_PROFILE_DESCRIPTION_LABEL}</label>`),
    "the settings panel must still print the same word over the same field",
  );
});

test("a failed read and an absent bot say the same sentence, because they cannot be told apart", () => {
  // Row-level security answers `null` with no error for a row nobody may read,
  // so «нет такого бота» would report a refusal as a fact about the world —
  // D-140's rule, and the same one `useUserProfile` follows.
  assert.equal(BOT_PROFILE_UNAVAILABLE, "Не удалось загрузить бота.");
  assert.ok(BOT_PROFILE_UNREACHABLE.length > 0);
  for (const message of BOT_PROFILE_MESSAGES) {
    assert.equal(message, message.trim());
    assert.ok(message.length > 0);
  }
});

// ---------------------------------------------------------------------------
// What the card refuses to carry
// ---------------------------------------------------------------------------

/**
 * The card's source **with its comments removed**.
 *
 * This register has already been caught by the other version: prose in a doc
 * comment reads as code to a scan, and the header below explains at length
 * which four things a bot's card refuses — naming every one of them. A scan
 * over the raw file would have matched its own explanation and passed for ever.
 */
function withoutComments(source: string): string {
  return source
    .split("\n")
    .map((line) => (line.trim().startsWith("*") || line.trim().startsWith("//") ? "" : line))
    .join("\n")
    .replace(/\/\*[^]*?\*\//g, "")
    .replace(/\{\/\*[^]*?\*\/\}/g, "");
}

const CARD = withoutComments(
  readFileSync(
    new URL("../../artifacts/kub/src/components/profile/BotProfileCard.tsx", import.meta.url),
    "utf8",
  ),
);

test("the comment stripper the scans below rest on actually removes a comment", () => {
  // A stripper that quietly did nothing would make every refusal below pass by
  // accident, which is the whole failure mode those scans exist to avoid.
  assert.equal(withoutComments("/* Открыть чат */\nconst a = 1;").includes("Открыть чат"), false);
  assert.equal(withoutComments("  // Открыть чат\nconst a = 1;").includes("Открыть чат"), false);
  assert.equal(withoutComments("const label = \"Открыть чат\";").includes("Открыть чат"), true);
});

test("a bot's card carries none of the four things only a person has", () => {
  // §8 of `docs/operations/reference-clients.md`: a control that cannot work
  // is absent, not drawn and empty. Telegram's bot profile makes the first
  // three refusals too; what it puts in their place is a count of the bot's
  // users, which this product does not have and does not invent.
  for (const absent of ["presenceLabel", "mutualChats", "Открыть чат", "Полный профиль"]) {
    assert.equal(CARD.includes(absent), false, `a bot's card must not carry «${absent}»`);
  }
});

test("the card's model is its only source, so a test can hand it one", () => {
  // No hook inside the card. The container reads; the card draws. It is what
  // lets the assertions above be about a value rather than about a screen.
  assert.equal(CARD.includes("useAppStore"), false);
  assert.equal(CARD.includes("useBotProfile"), false);
});
