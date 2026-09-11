import { expect, test, type Locator, type Page } from "@playwright/test";
import { canRenderCosmetic } from "../../artifacts/kub/src/lib/profileCosmetics";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  loginAsRoleOrSkip,
  qaMutationsAllowed,
} from "./helpers/auth";

/**
 * Earned decoration is visible to everyone, which is what makes it worth
 * earning — and what makes the interface the wrong place to enforce it. The
 * contracts here are that the screen reports what the server says, that a
 * locked option cannot be chosen, and, most importantly, that going around the
 * screen does not work either.
 *
 * "What the server says" is read from the very responses the section is drawn
 * from rather than written into this file. The catalogue is production data:
 * this spec used to name "Рамка ветерана" and "N из M", and whether that frame
 * is locked depends on what the QA account has earned by the day of the run,
 * while the progress line has read "N / M" since 4e87cba.
 *
 * Opening the section runs `achievements_sync`, which records any achievement
 * the account already qualifies for. That is the write every visit to this
 * screen makes, and it is limited to the account's own facts.
 */

type Catalogue = {
  achievements: Array<{ key: string; title: string }>;
  frames: Array<{ key: string; title: string; requiredAchievement: string | null }>;
  earned: ReadonlySet<string>;
  progress: Readonly<Record<string, { current: number; target: number }>>;
};

const ROLES = ["client", "owner", "tech_admin"] as const;

/**
 * Opens Settings and the decoration disclosure, and returns the section with the
 * server's answer it was drawn from.
 *
 * The section is a `DisclosureRow` whose panel is not rendered until the row is
 * opened, and every row starts closed. This spec was written against the tabbed
 * screen, the move to disclosures the next day left it looking for "Рамка
 * аватара" in a panel that did not exist, and nobody saw, because it never ran.
 */
async function openDecoration(page: Page): Promise<{ section: Locator; catalogue: Catalogue }> {
  const answer = (pattern: RegExp) =>
    page.waitForResponse((response) => pattern.test(new URL(response.url()).pathname), { timeout: 20_000 });
  const answers = Promise.all([
    answer(/\/rest\/v1\/achievements$/),
    answer(/\/rest\/v1\/cosmetics$/),
    answer(/\/rest\/v1\/rpc\/achievements_sync$/),
  ]);
  // Observed later; without this a failure before that point would surface as an
  // unhandled rejection instead of the real error.
  answers.catch(() => undefined);

  await page.getByRole("button", { name: "Меню" }).first().click();
  await page.getByText("Настройки", { exact: true }).first().click();
  const toggle = page.getByTestId("settings-open-decoration");
  await expect(toggle, "every settings disclosure starts closed").toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  const section = page.getByTestId("settings-section-decoration");
  await expect(section).toBeVisible();

  const [definitions, cosmetics, sync] = await answers;
  for (const response of [definitions, cosmetics, sync]) {
    expect(response.ok(), `${new URL(response.url()).pathname} answered ${response.status()}`).toBe(true);
  }
  const rows = async (response: typeof sync) => (await response.json()) as Array<Record<string, unknown>>;
  const synced = (await sync.json()) as { earned?: unknown; progress?: Record<string, unknown> };

  const progress: Record<string, { current: number; target: number }> = {};
  for (const [key, value] of Object.entries(synced.progress ?? {})) {
    const entry = value as { current?: unknown; target?: unknown };
    if (typeof entry?.current === "number" && typeof entry.target === "number" && entry.target > 0) {
      progress[key] = { current: Math.max(0, entry.current), target: entry.target };
    }
  }
  const catalogue: Catalogue = {
    achievements: (await rows(definitions))
      .filter((row) => typeof row.key === "string" && row.key)
      .map((row) => ({ key: String(row.key), title: String(row.title ?? "") })),
    frames: (await rows(cosmetics))
      .filter((row) => row.kind === "frame" && typeof row.key === "string" && row.key)
      .map((row) => ({
        key: String(row.key),
        title: String(row.title ?? ""),
        requiredAchievement: typeof row.required_achievement === "string" ? row.required_achievement : null,
      })),
    earned: new Set(
      Array.isArray(synced.earned) ? synced.earned.filter((key): key is string => typeof key === "string") : [],
    ),
    progress,
  };

  await expect(section.getByText("Загружаем…"), "the section settles once the answers are in").toHaveCount(0);
  await expect(section.getByText("Не удалось загрузить достижения.")).toHaveCount(0);
  return { section, catalogue };
}

/** Frames the account has not earned, among those this build can draw. */
function lockedFrames(catalogue: Catalogue) {
  return catalogue.frames.filter(
    (frame) =>
      frame.requiredAchievement !== null &&
      !catalogue.earned.has(frame.requiredAchievement) &&
      canRenderCosmetic(frame.key),
  );
}

async function signIn(page: Page) {
  const role = findFirstAvailableQaRole([...ROLES], { includeDefault: true });
  test.skip(!role, "QA credentials or auth state are not configured");
  await gotoOrSkip(page, "/");
  await loginAsRoleOrSkip(page, role!);
}

test.describe("profile decoration", () => {
  test("achievements show what is held and how far the rest are", async ({ page }) => {
    await signIn(page);
    const { section, catalogue } = await openDecoration(page);

    await expect(section.getByRole("heading", { name: /Достижения/ })).toBeVisible();
    expect(catalogue.achievements.length, "the server defines no achievements to show").toBeGreaterThan(0);

    const items = section.getByRole("listitem");
    await expect(items, "one row per achievement the server defines").toHaveCount(catalogue.achievements.length);

    let distances = 0;
    for (const achievement of catalogue.achievements) {
      const item = items.filter({ has: page.getByText(achievement.title, { exact: true }) });
      await expect(item, `${achievement.key} is listed once`).toHaveCount(1);
      const distance = catalogue.progress[achievement.key];
      if (distance && !catalogue.earned.has(achievement.key)) {
        // A countable criterion reports a distance rather than only an absence.
        await expect(item).toContainText(`${distance.current} / ${distance.target}`);
        distances += 1;
      } else {
        // Held, or not countable: no distance is claimed for it.
        await expect(item).not.toContainText(/\d+ \/ \d+/);
      }
    }
    test.info().annotations.push({
      type: "checked",
      description: `${catalogue.achievements.length} achievements, ${catalogue.earned.size} held, ${distances} distances`,
    });
  });

  test("a locked decoration cannot be chosen", async ({ page }) => {
    await signIn(page);
    const { section, catalogue } = await openDecoration(page);

    const locked = lockedFrames(catalogue);
    test.skip(
      locked.length === 0,
      "the server reports every drawable frame as earned by this account, so none is locked",
    );

    const picker = section.getByRole("heading", { name: /^Рамка аватара/ }).locator("xpath=..");
    for (const frame of locked) {
      const option = picker.getByRole("button", { name: frame.title, exact: true });
      await expect(option, `${frame.key} is offered`).toBeVisible();
      await expect(option, `${frame.key} is not earned, so it is announced as unavailable`).toBeDisabled();
      await expect(option).toHaveAttribute("aria-pressed", "false");
    }

    // Choosing one must neither select it nor ask the server to wear it. Any such
    // request is aborted here, so a broken screen cannot reach the real profile;
    // other profile traffic, such as the presence heartbeat, passes untouched.
    const attempts: string[] = [];
    await page.route("**/rest/v1/profiles**", async (route) => {
      const request = route.request();
      if (request.method() === "PATCH" && (request.postData() ?? "").includes("profile_frame")) {
        attempts.push(request.postData() ?? "");
        await route.abort();
        return;
      }
      await route.continue();
    });
    const target = picker.getByRole("button", { name: locked[0].title, exact: true });
    // `force`: the option is aria-disabled on purpose, and an ordinary click would
    // wait for it to become enabled instead of proving that clicking does nothing.
    await target.click({ force: true });
    // An absence can only be observed by waiting. The selection is optimistic and
    // the request leaves in the same tick, so half a second is ample for either.
    await page.waitForTimeout(500);
    await expect(target, "a locked frame must not become the selection").toHaveAttribute("aria-pressed", "false");
    expect(attempts, "choosing a locked frame must not ask the server to wear it").toEqual([]);
    await page.unroute("**/rest/v1/profiles**");
  });

  test("the server refuses an unearned decoration, not only the screen", async ({ page }) => {
    // It sends a PATCH to the account's real profile. Refused, it changes nothing;
    // accepted — which is exactly the regression it exists to catch — it changes
    // a decoration everyone can see, so it is put back below, and the test only
    // runs when writes to production are explicitly allowed.
    test.skip(
      !qaMutationsAllowed(),
      "this sends a PATCH to a production profile; set KUB_QA_ALLOW_MUTATIONS=1 to run it",
    );

    // The application's own REST traffic carries everything the probe needs:
    // the endpoint, the public key and this person's bearer token. Capturing a
    // real request avoids reconstructing configuration the test would then be
    // free to get wrong — and a probe that skips itself proves nothing, so a
    // missing prerequisite fails here rather than passing quietly.
    const captured = page.waitForRequest(
      (request) => request.url().includes("/rest/v1/") && request.headers().apikey !== undefined,
      { timeout: 20_000 },
    );
    await signIn(page);
    const sample = await captured;
    const headers = sample.headers();
    const origin = new URL(sample.url()).origin;

    const { catalogue } = await openDecoration(page);
    const unearned = catalogue.frames.find(
      (frame) => frame.requiredAchievement !== null && !catalogue.earned.has(frame.requiredAchievement),
    );
    test.skip(!unearned, "the server reports every frame as earned by this account; there is nothing to refuse");

    const userId = await page.evaluate(() => {
      // `kub-auth` is this application's storage key; see lib/supabase/client.
      const stored = localStorage.getItem("kub-auth");
      if (!stored) throw new Error("no stored session: the probe cannot prove anything");
      const id = JSON.parse(stored)?.user?.id;
      if (!id) throw new Error("stored session carries no user");
      return id as string;
    });
    const endpoint = `${origin}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`;
    const auth = { apikey: headers.apikey, authorization: headers.authorization };

    const before = await page.request.get(`${endpoint}&select=profile_frame`, { headers: auth });
    expect(before.ok(), "the current frame must be readable before anything is attempted").toBe(true);
    const previous = ((await before.json()) as Array<{ profile_frame: string | null }>)[0]?.profile_frame ?? null;

    // The screen is skipped entirely: this writes to the profile with the
    // person's own session, exactly as a REST client would. A badge that only
    // the interface protects is not earned, it is suggested.
    const response = await page.request.patch(endpoint, {
      headers: { ...auth, "content-type": "application/json", prefer: "return=representation" },
      data: { profile_frame: unearned!.key },
    });
    try {
      const outcome = { status: response.status(), body: (await response.text()).slice(0, 300) };
      expect(outcome.status, "an unearned frame must not be accepted").toBeGreaterThanOrEqual(400);
      expect(outcome.body).toContain("cosmetic_not_unlocked");
    } finally {
      if (response.ok()) {
        await page.request.patch(endpoint, {
          headers: { ...auth, "content-type": "application/json" },
          data: { profile_frame: previous },
        });
      }
    }
  });
});
