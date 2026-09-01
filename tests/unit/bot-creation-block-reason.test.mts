import assert from "node:assert/strict";
import test from "node:test";

import { describeCreationBlock } from "../../artifacts/kub/src/lib/botCreationBlock.ts";

type Eligibility = Parameters<typeof describeCreationBlock>[0];

const REQUIREMENTS = [
  "email_verified",
  "phone_verified",
  "account_age_met",
  "not_banned",
  "under_limit",
] as const;

function eligibility(met: Record<(typeof REQUIREMENTS)[number], boolean>, canCreate: boolean): Eligibility {
  return {
    ...met,
    active_bot_count: met.under_limit ? 0 : 3,
    max_bots: 3,
    can_create: canCreate,
  } as Eligibility;
}

test("an account that may create a bot is given no blocking reason", () => {
  const all = Object.fromEntries(REQUIREMENTS.map((key) => [key, true])) as Record<
    (typeof REQUIREMENTS)[number],
    boolean
  >;
  assert.equal(describeCreationBlock(eligibility(all, true)), null);
});

/**
 * The whole reachable space of requirement flags, not a chosen shape.
 *
 * The defect this closes was exactly a combination nobody wrote a case for: all
 * five requirements met while the feature itself was closed produced an empty
 * join and the page printed "Создание недоступно: ." — a disabled button with
 * no reason at all.
 */
test("a blocked account is always told something, in every combination", () => {
  for (let mask = 0; mask < 1 << REQUIREMENTS.length; mask += 1) {
    const met = Object.fromEntries(
      REQUIREMENTS.map((key, index) => [key, (mask & (1 << index)) !== 0]),
    ) as Record<(typeof REQUIREMENTS)[number], boolean>;

    const message = describeCreationBlock(eligibility(met, false));
    const where = REQUIREMENTS.filter((key) => !met[key]).join(",") || "all requirements met";

    assert.ok(message, `${where}: no message at all`);
    assert.ok(message.trim().length > 0, `${where}: empty message`);
    assert.doesNotMatch(message, /:\s*\.$/, `${where}: empty reason in "${message}"`);
    assert.match(message, /\.$/, `${where}: not a sentence`);

    const unmetCount = REQUIREMENTS.filter((key) => !met[key]).length;
    if (unmetCount === 0) {
      // Nothing about the account is wrong, so the reason must name the server
      // switch rather than imply the account is at fault.
      assert.match(message, /отключено на сервере/, `${where}: "${message}"`);
      continue;
    }

    // Each unmet requirement is named, and no met one is.
    const phrases: Record<(typeof REQUIREMENTS)[number], RegExp> = {
      email_verified: /подтвердите email/,
      phone_verified: /подтвердите телефон/,
      account_age_met: /24 часов/,
      not_banned: /блокировку/,
      under_limit: /лимит/,
    };
    for (const key of REQUIREMENTS) {
      assert.equal(
        phrases[key].test(message),
        !met[key],
        `${where}: "${message}" disagrees about ${key}`,
      );
    }
  }
});
