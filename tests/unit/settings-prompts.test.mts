// The last two rows of D-133: the settings ask before removing the person's own
// things.
//
// The entry's administration and bot halves closed on 2026-09-14 through
// `adminPrompts.ts`; these two were left. Both acted on the press: «Удалить
// фото» in the profile header, and «Удалить» on a verified telephone number,
// which reaches the gateway and undoes a verification that is rate-limited on
// the way back.
//
// The wiring half of this file reads source, which is a weaker kind of evidence
// than the sentence half and says so. It is here because the failure it guards
// against is one deleted line — `if (!confirmed) return;` — and nothing else in
// the suite would notice.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  avatarRemovalPrompt,
  phoneRemovalPrompt,
  SETTINGS_PROMPT_MESSAGES,
} from "../../artifacts/kub/src/lib/settingsPrompts.ts";
import { INTERNALS_PATTERN } from "../../artifacts/kub/src/lib/plainMessages.ts";

test("a question is a question, and the button names the act", () => {
  for (const prompt of [avatarRemovalPrompt(), phoneRemovalPrompt()]) {
    assert.ok(prompt.title.endsWith("?"), `«${prompt.title}» is not a question`);
    assert.equal(prompt.cancelLabel, "Отмена");
    assert.equal(prompt.tone, "danger");
    // Telegram's shape, and the entry's: never «Подтвердить», never «ОК».
    assert.ok(
      !/^(Подтвердить|ОК|Да)$/u.test(prompt.confirmLabel),
      `«${prompt.confirmLabel}» does not name the action`,
    );
    assert.ok(prompt.description.trim().length > 0, "the question says nothing about what changes");
  }
});

test("neither sentence explains the machine", () => {
  for (const line of SETTINGS_PROMPT_MESSAGES) {
    assert.doesNotMatch(line, INTERNALS_PATTERN, `«${line}» names an internal`);
  }
});

test("the telephone's line does not promise a feature that does not exist", () => {
  // The obvious wording is «вас перестанут находить по номеру», and it is
  // false: `public.search_profiles_by_phone` refuses every caller without
  // `users.view`, so an ordinary person has never been able to find anybody
  // that way. Measured on production on 2026-09-15 before the line was written.
  const prompt = phoneRemovalPrompt();
  assert.doesNotMatch(prompt.description, /находить|найти|поиск/iu);
  // What it does cost is the verification, which is what the line says.
  assert.match(prompt.description, /подтвердить|подтверждени/iu);
});

test("the photograph's line names the fallback the avatar really draws", () => {
  // `ChatAvatar` renders the person's initials when `avatar_url` is absent.
  assert.match(avatarRemovalPrompt().description, /инициал/iu);
  const avatar = readFileSync("artifacts/kub/src/components/ui/ChatAvatar.tsx", "utf8");
  assert.match(avatar, /\{initials\}/u, "the avatar no longer falls back to initials");
});

// ---------------------------------------------------------------------------
// The wiring. Source-read, and weaker for it.
// ---------------------------------------------------------------------------

const sources = new Map<string, string>();
function read(file: string): string {
  const cached = sources.get(file);
  if (cached !== undefined) return cached;
  const text = readFileSync(file, "utf8");
  sources.set(file, text);
  return text;
}

/** The body of a named handler, by brace balance from its declaration. */
function block(file: string, name: string): string {
  const source = read(file);
  const start = source.indexOf(`const ${name} =`);
  assert.notEqual(start, -1, `${file}: ${name} is gone`);
  let depth = 0;
  let started = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
      started = true;
    } else if (char === "}") {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${file}: unbalanced braces after ${name}`);
}

/** Asks, reads the answer, and uses this module's words rather than its own. */
function asksFirst(file: string, handler: string, promptFn: string): void {
  const body = block(file, handler);
  assert.match(body, /requestAppConfirm\(/u, `${file}: ${handler} does not ask`);
  assert.match(body, new RegExp(`${promptFn}\\(`, "u"), `${file}: ${handler} invents its own words`);
  assert.match(body, /if \(!confirmed\) return;/u, `${file}: ${handler} ignores the answer`);
  const asked = body.indexOf("requestAppConfirm");
  const answered = body.indexOf("if (!confirmed) return;");
  assert.ok(asked < answered, `${file}: ${handler} reads the answer before asking`);
  return void 0;
}

test("the profile header asks before the photograph goes", () => {
  const file = "artifacts/kub/src/components/settings/SettingsScreen.tsx";
  asksFirst(file, "handleRemoveAvatar", "avatarRemovalPrompt");
  // And it asks before it writes, not after.
  const body = block(file, "handleRemoveAvatar");
  const asked = body.indexOf("requestAppConfirm");
  const wrote = body.indexOf("avatar_url: null");
  assert.ok(asked < wrote, "the photograph is removed before the question is asked");
});

test("the telephone asks before the gateway is reached", () => {
  const file = "artifacts/kub/src/components/sidebar/PhoneSection.tsx";
  asksFirst(file, "removePhone", "phoneRemovalPrompt");
  const body = block(file, "removePhone");
  const asked = body.indexOf("requestAppConfirm");
  const called = body.indexOf("phone-verification-gateway");
  assert.ok(asked < called, "the gateway is called before the question is asked");
});

test("the settings do not carry a second copy of the confirmation shape", () => {
  // `AdminConfirmPrompt` is the product's one shape and is imported, not
  // redeclared. A second interface with the same four fields is how two
  // surfaces start drifting apart.
  const module = read("artifacts/kub/src/lib/settingsPrompts.ts");
  assert.match(module, /import type \{ AdminConfirmPrompt \}/u);
  assert.doesNotMatch(module, /interface\s+\w*ConfirmPrompt/u, "the shape was redeclared here");
});
