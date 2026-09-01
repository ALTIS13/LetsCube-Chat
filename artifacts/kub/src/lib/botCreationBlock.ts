import type { BotEligibility } from "@/lib/botManagement";

/**
 * Why bot creation is unavailable, as one sentence, or `null` when it is not.
 *
 * This lives in its own module so it can be exercised directly by the Node test
 * runner: `botManagement.ts` uses a TypeScript parameter property, which the
 * runner's strip-only mode refuses to load.
 *
 * The gateway reports the account requirements individually but folds the
 * feature-level switch into `can_create` with no flag of its own. Joining the
 * unmet requirements unconditionally therefore rendered "Создание недоступно: ."
 * — a disabled button, an empty list and no reason — for any account that met
 * every requirement while the feature itself was closed. Every branch below
 * names something, so the caller cannot print an empty reason.
 */
export function describeCreationBlock(eligibility: BotEligibility): string | null {
  if (eligibility.can_create) return null;

  const unmet = [
    !eligibility.email_verified && "подтвердите email",
    !eligibility.phone_verified && "подтвердите телефон",
    !eligibility.account_age_met && "дождитесь 24 часов после регистрации",
    !eligibility.not_banned && "снимите активную блокировку",
    !eligibility.under_limit && `достигнут лимит ${eligibility.max_bots}`,
  ].filter((entry): entry is string => typeof entry === "string");

  if (unmet.length === 0) {
    return "Создание ботов сейчас отключено на сервере. Ваш аккаунт всем требованиям соответствует.";
  }
  return `Создание недоступно: ${unmet.join("; ")}.`;
}
