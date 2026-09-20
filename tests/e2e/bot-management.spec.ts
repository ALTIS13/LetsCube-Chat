import { expect, test, type Page, type Route } from "@playwright/test";

const API = "http://127.0.0.1:54322/bot/manage/v1";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_BOT_ID = "22222222-2222-4222-8222-222222222222";
const DEVELOPER_BOT_ID = "33333333-3333-4333-8333-333333333333";
const RAW_TOKEN = "lc_bot_0123456789.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const NOW = "2026-08-31T12:00:00.000Z";
const DEVELOPER_USER_ID = "44444444-4444-4444-8444-000000000001";
const DEVELOPER_NAME = "Анна Смирнова";
const WEBHOOK_URL = "https://hooks.example.invalid/letscube";
/**
 * A picture for one of the two bots, so «the bot's own picture» and «the robot
 * where there is none» are both on the screen at once (D-145, row B-03).
 *
 * Inline rather than fetched: it has to be a URL the page can really load, and
 * the management fixture owns a different origin than the storage bucket a real
 * avatar lives in. Drawn, not photographic, so nothing recognisable can end up
 * in a screenshot.
 */
const BOT_AVATAR = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">' +
    '<rect width="96" height="96" fill="#f2a33c"/>' +
    '<circle cx="48" cy="37" r="17" fill="#1d2430"/>' +
    '<rect x="19" y="60" width="58" height="28" rx="14" fill="#1d2430"/>' +
    "</svg>",
).toString("base64")}`;

test.describe("authenticated bot management", () => {
  test.beforeEach(async ({ page }) => {
    await installSession(page);
    await installSupabaseFixture(page);
  });

  test("creates and rotates a token without retaining it", async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on("console", (message) => consoleMessages.push(message.text()));
    await installManagementFixture(page);
    await page.goto("/bots");

    await expect(page.getByRole("heading", { name: "Мои боты" })).toBeVisible();
    await page.getByRole("button", { name: "Создать бота" }).click();
    await page.getByLabel("Название").fill("Release bot");
    await page.getByLabel("Имя пользователя").fill("release_bot");
    await page.getByLabel("Описание").fill("Проверка одноразового токена");
    await page.getByRole("button", { name: "Создать", exact: true }).click();

    const tokenDialog = page.getByRole("dialog", { name: "Токен бота" });
    await expect(tokenDialog).toContainText(RAW_TOKEN);
    await page.keyboard.press("Escape");
    await expect(tokenDialog).toBeVisible();
    expect(page.url()).not.toContain(RAW_TOKEN);
    expect(await browserStorageContains(page, RAW_TOKEN)).toBe(false);
    await tokenDialog.getByRole("button", { name: "Готово, закрыть" }).click();
    await expect(page.getByText(RAW_TOKEN)).toHaveCount(0);
    expect(await browserTokenResidue(page, RAW_TOKEN, consoleMessages)).toEqual({
      queryClient: false,
      cacheStorage: false,
      indexedDb: false,
      historyOrUrl: false,
      console: false,
      dom: false,
      localStorage: false,
      sessionStorage: false,
    });

    const createdRow = page.getByRole("button", { name: /Release bot/ });
    if (await createdRow.isVisible().catch(() => false)) await createdRow.click();
    await page.getByRole("tab", { name: "API" }).click();
    await page.getByRole("button", { name: "Выпустить новый токен" }).click();
    await page.getByRole("button", { name: "Подтвердить выпуск" }).click();
    await expect(tokenDialog).toContainText(RAW_TOKEN);
    await tokenDialog.getByRole("button", { name: "Готово, закрыть" }).click();
    await expect(page.getByText(RAW_TOKEN)).toHaveCount(0);
    expect(await browserTokenResidue(page, RAW_TOKEN, consoleMessages)).toEqual({
      queryClient: false,
      cacheStorage: false,
      indexedDb: false,
      historyOrUrl: false,
      console: false,
      dom: false,
      localStorage: false,
      sessionStorage: false,
    });
  });

  test("uses field-specific create errors with stable accessible descriptions", async ({ page }) => {
    await installManagementFixture(page);
    await page.goto("/bots");

    await page.getByRole("button", { name: "Создать бота" }).click();
    await page.getByLabel("Название").fill("x");
    await page.getByLabel("Имя пользователя").fill("valid_bot");
    await page.getByRole("button", { name: "Создать", exact: true }).click();

    const displayName = page.getByLabel("Название");
    const username = page.getByLabel("Имя пользователя");
    await expect(displayName).toHaveAttribute("aria-invalid", "true");
    await expect(displayName).toHaveAttribute("aria-describedby", "bot-create-display-name-error");
    await expect(page.locator("#bot-create-display-name-error")).toBeVisible();
    await expect(username).toHaveAttribute("aria-invalid", "false");
    await expect(username).not.toHaveAttribute("aria-describedby", "bot-create-display-name-error");
  });

  test("keeps light-theme primary actions at AA contrast inside bot dialogs", async ({ page }) => {
    await installManagementFixture(page);
    await page.goto("/bots");
    await page.evaluate(() => localStorage.setItem("kub-theme", "light"));
    await page.reload();

    await expect.poll(() => buttonContrast(page.getByRole("button", { name: "Создать бота" }))).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button", { name: "Создать бота" }).click();
    await expect.poll(() => buttonContrast(page.getByRole("button", { name: "Создать", exact: true }))).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button", { name: "Отмена" }).click();

    await page.getByRole("button", { name: /Owner bot/ }).click();
    await page.getByRole("tab", { name: "API" }).click();
    await page.getByRole("button", { name: "Выпустить новый токен" }).click();
    await expect.poll(() => buttonContrast(page.getByRole("button", { name: "Подтвердить выпуск" }))).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button", { name: "Подтвердить выпуск" }).click();
    await expect.poll(() => buttonContrast(page.getByRole("button", { name: "Готово, закрыть" }))).toBeGreaterThanOrEqual(4.5);
  });

  test("treats an interrupted create as uncertain and refreshes without offering a repeat", async ({ page }) => {
    let listReads = 0;
    await installManagementFixture(page);
    await page.route(`${API}/bots`, async (route) => {
      if (route.request().method() === "POST") {
        await route.abort("failed");
        return;
      }
      listReads += 1;
      await route.fallback();
    });
    await page.goto("/bots");

    await page.getByRole("button", { name: "Создать бота" }).click();
    await page.getByLabel("Название").fill("Uncertain bot");
    await page.getByLabel("Имя пользователя").fill("uncertain_bot");
    await page.getByRole("button", { name: "Создать", exact: true }).click();

    await expect(page.getByRole("alert")).toContainText("Запрос мог выполниться");
    await expect(page.getByRole("alert")).toContainText("Не повторяйте создание");
    await expect(page.getByRole("button", { name: "Создать", exact: true })).toBeDisabled();
    await expect.poll(() => listReads).toBeGreaterThan(1);
  });

  test("treats a create HTTP 500 as uncertain and refreshes without offering a repeat", async ({ page }) => {
    let listReads = 0;
    await installManagementFixture(page);
    await page.route(`${API}/bots`, async (route) => {
      if (route.request().method() === "POST") {
        await failure(route, 500, "internal_error");
        return;
      }
      listReads += 1;
      await route.fallback();
    });
    await page.goto("/bots");

    await page.getByRole("button", { name: "Создать бота" }).click();
    await page.getByLabel("Название").fill("Uncertain server bot");
    await page.getByLabel("Имя пользователя").fill("uncertain_server_bot");
    await page.getByRole("button", { name: "Создать", exact: true }).click();

    await expect(page.getByRole("alert")).toContainText("Запрос мог выполниться");
    await expect(page.getByRole("alert")).toContainText("Не повторяйте создание");
    await expect(page.getByRole("button", { name: "Создать", exact: true })).toBeDisabled();
    await expect.poll(() => listReads).toBeGreaterThan(1);
  });

  test("treats an interrupted rotation as uncertain and guides explicit recovery", async ({ page }) => {
    let detailReads = 0;
    await installManagementFixture(page);
    await page.route(`${API}/bots/${OWNER_BOT_ID}`, async (route) => {
      detailReads += 1;
      await route.fallback();
    });
    await page.route(`${API}/bots/${OWNER_BOT_ID}/token/rotate`, (route) => route.abort("failed"));
    await page.goto(`/bots?bot=${OWNER_BOT_ID}`);

    await page.getByRole("tab", { name: "API" }).click();
    await page.getByRole("button", { name: "Выпустить новый токен" }).click();
    await page.getByRole("button", { name: "Подтвердить выпуск" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Запрос мог выполниться");
    await expect(alert).toContainText("повторно выпустите новый токен");
    await expect(page.getByRole("dialog", { name: "Выпустить новый токен?" })).toHaveCount(0);
    await expect.poll(() => detailReads).toBeGreaterThan(1);
  });

  test("treats a rotate HTTP 500 as uncertain and guides explicit recovery", async ({ page }) => {
    let detailReads = 0;
    await installManagementFixture(page);
    await page.route(`${API}/bots/${OWNER_BOT_ID}`, async (route) => {
      detailReads += 1;
      await route.fallback();
    });
    await page.route(`${API}/bots/${OWNER_BOT_ID}/token/rotate`, (route) =>
      failure(route, 500, "upstream_failure"),
    );
    await page.goto(`/bots?bot=${OWNER_BOT_ID}`);

    await page.getByRole("tab", { name: "API" }).click();
    await page.getByRole("button", { name: "Выпустить новый токен" }).click();
    await page.getByRole("button", { name: "Подтвердить выпуск" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Запрос мог выполниться");
    await expect(alert).toContainText("повторно выпустите новый токен");
    await expect(page.getByRole("dialog", { name: "Выпустить новый токен?" })).toHaveCount(0);
    await expect.poll(() => detailReads).toBeGreaterThan(1);
  });

  test("keeps deterministic create 4xx responses out of uncertain recovery", async ({ page }) => {
    const cases = [
      {
        displayName: "Validation failure",
        status: 400,
        serverCode: "validation_failed",
        clientCode: "validation_failed",
      },
      {
        displayName: "Auth failure",
        status: 401,
        serverCode: "unauthorized",
        clientCode: "session_expired",
      },
      {
        displayName: "Eligibility failure",
        status: 403,
        serverCode: "bot_creation_not_allowed",
        clientCode: "bot_creation_not_allowed",
      },
      {
        displayName: "Conflict failure",
        status: 409,
        serverCode: "conflict",
        clientCode: "conflict",
      },
    ];
    await installManagementFixture(page);
    await page.route(`${API}/bots`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      const body = route.request().postDataJSON() as { display_name?: string };
      const current = cases.find((item) => item.displayName === body.display_name);
      if (!current) throw new Error("missing deterministic error fixture");
      await failure(route, current.status, current.serverCode);
    });
    await page.goto("/bots");

    const clientCodes = await page.evaluate(async (inputs) => {
      const { botManagement } = await import("/src/lib/botManagement.ts");
      const results: string[] = [];
      for (const [index, current] of inputs.entries()) {
        try {
          await botManagement.createOnce({
            display_name: current.displayName,
            username: `failure_bot_${index}`,
            description: "",
          });
          results.push("unexpected_success");
        } catch (error) {
          results.push(String((error as { code?: unknown }).code ?? "missing_code"));
        }
      }
      return results;
    }, cases);

    expect(clientCodes).toEqual(cases.map((current) => current.clientCode));
    expect(clientCodes).not.toContain("uncertain_result");
  });

  test("enforces owner and developer controls through lifecycle states", async ({ page }) => {
    await installManagementFixture(page);
    await page.goto("/bots");

    await page.getByRole("button", { name: /Owner bot/ }).click();
    await expect(page.getByRole("button", { name: "Поставить на паузу" })).toBeVisible();
    await page.getByRole("button", { name: "Поставить на паузу" }).click();
    await page.getByRole("button", { name: "Подтвердить паузу" }).click();
    await expect(page.getByTestId("bots-detail-pane").getByText("На паузе").first()).toBeVisible();

    await page.getByRole("tab", { name: "Диагностика" }).click();
    await expect(page.getByText("Не настроен", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Команда" }).click();
    await expect(page.getByRole("button", { name: "Добавить разработчика" })).toBeVisible();
    await page.getByRole("tab", { name: "Основное" }).click();
    await page.getByRole("button", { name: "Запросить удаление" }).click();
    await page.getByRole("button", { name: "Запланировать удаление" }).click();
    await expect(page.getByTestId("bots-detail-pane").getByText("Удаление запланировано").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Отменить удаление" })).toBeVisible();

    const back = page.getByRole("button", { name: "Назад к списку" });
    if (await back.isVisible().catch(() => false)) await back.click();
    await page.getByRole("button", { name: /Developer bot/ }).click();
    await expect(page.getByText("Доступ разработчика")).toBeVisible();
    await expect(page.getByRole("button", { name: "Запросить удаление" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Выпустить новый токен" })).toHaveCount(0);
  });

  // D-145, row B-03. The list drew a robot for every bot and never read
  // `avatar_url`, while the settings header one pane to the right drew the
  // picture — so an owner could see their own upload and its absence at once.
  test("draws a bot's own picture in the list, and the robot only where there is none", async ({ page }) => {
    await installManagementFixture(page);
    await page.goto("/bots");

    const withPicture = page.getByRole("button", { name: /Owner bot/ });
    const without = page.getByRole("button", { name: /Developer bot/ });
    await expect(withPicture.locator("img")).toHaveAttribute("src", BOT_AVATAR);
    await expect(withPicture.locator("img")).toHaveAttribute("alt", "Owner bot");
    // The fallback is a glyph on a fill rather than an image, and it is still a
    // bot rather than the monogram a person would get.
    await expect(without.locator("img")).toHaveCount(0);
    await expect(without.locator('[data-message-actor-kind="bot"]')).toHaveCount(1);
    await expect(without.locator('[data-message-actor-kind="bot"] svg')).toHaveCount(1);

    // And the same picture in the settings header, which is where it already
    // was — the two panes have to agree.
    await withPicture.click();
    await expect(page.getByTestId("bots-detail-pane").locator("img").first()).toHaveAttribute("src", BOT_AVATAR);
  });

  // D-145, row B-19. Every save ended in silence, so pressing the button again
  // was the only way to learn whether the first press had done anything.
  test("says a save worked, in the product's own confirmation", async ({ page }) => {
    await installManagementFixture(page);
    await page.goto(`/bots?bot=${OWNER_BOT_ID}`);

    await expect(page.getByTestId("kub-feedback-viewport")).toHaveCount(0);
    await page.getByRole("button", { name: "Сохранить профиль" }).click();
    const feedback = page.getByTestId("kub-feedback-viewport");
    await expect(feedback).toContainText("Сохранено");
    await expect(feedback).toContainText("Профиль бота обновлён.");
  });

  // D-186, found by looking at the 1440 frames of the test above: the card sat
  // at y 108-169 and the tab strip at 147-191, so for the 2.4 seconds a
  // confirmation was up, a press on «Диагностика» went into the toast. The
  // viewport's offset had been measured against the staff area, whose tabs end
  // at 101; the bots page stacks them lower. The fix is not another number —
  // the card takes no clicks at all now, only its close button does.
  test("a confirmation floats over the tabs without swallowing a press", async ({ page }) => {
    await installManagementFixture(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/bots?bot=${OWNER_BOT_ID}`);

    await page.getByRole("button", { name: "Сохранить профиль" }).click();
    const feedback = page.getByTestId("kub-feedback-viewport");
    await expect(feedback).toContainText("Сохранено");

    const card = feedback.locator("[role=status], [role=alert]").first();
    const box = await card.boundingBox();
    expect(box, "the confirmation was not drawn").not.toBeNull();

    // What is under the middle of the card, asked of the browser rather than
    // worked out from two rectangles.
    const underneath = await page.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return {
          isTheCard: Boolean(element?.closest("[data-testid=kub-feedback-viewport]")),
          tag: element?.tagName.toLowerCase() ?? null,
        };
      },
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    );
    expect(underneath.isTheCard, "the card is still taking presses meant for what is behind it").toBe(false);

    // And it is still dismissible, which is the whole reason the card used to
    // take clicks in the first place.
    const close = feedback.getByRole("button", { name: "Закрыть уведомление" }).first();
    await expect(close).toBeVisible();
    await close.click();
    await expect(feedback).toHaveCount(0);
  });

  // D-145, row B-19. Every failure landed in one banner above the tabs, which
  // on another tab belonged to a section the reader could not see at all.
  test("puts a failure beside the section that failed, and nowhere else", async ({ page }) => {
    await installManagementFixture(page);
    await page.route(`${API}/bots/${OWNER_BOT_ID}/webhook`, async (route) => {
      if (route.request().method() === "PUT") {
        await failure(route, 400, "validation_failed");
        return;
      }
      await route.fallback();
    });
    await page.goto(`/bots?bot=${OWNER_BOT_ID}`);

    await page.getByRole("tab", { name: "API" }).click();
    await page.getByLabel("URL webhook").fill(WEBHOOK_URL);
    await page.getByLabel("Секрет подписи").fill("fixture_secret_0123456789");
    await page.getByRole("button", { name: "Сохранить webhook", exact: true }).click();

    const webhookSection = section(page, "Webhook");
    await expect(webhookSection.getByRole("alert")).toContainText("Проверьте заполненные поля.");
    // Inside its own box and nowhere else: not above the tabs, and not in a
    // sibling section that had nothing to do with the press.
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(section(page, "Команды").getByRole("alert")).toHaveCount(0);
    const tabs = page.getByRole("tablist");
    expect(await verticalOrder(tabs, webhookSection.getByRole("alert"))).toBe("after");
  });

  // D-133, rows B-08, B-12 and B-15. Each acted the moment it was pressed.
  test("asks before removing the picture, the webhook and a developer", async ({ page }) => {
    await installManagementFixture(page);
    const calls = { avatar: 0, webhook: 0, developer: 0 };
    await page.route(`${API}/bots/${OWNER_BOT_ID}/avatar`, async (route) => {
      if (route.request().method() === "PATCH") calls.avatar += 1;
      await route.fallback();
    });
    await page.route(`${API}/bots/${OWNER_BOT_ID}/webhook`, async (route) => {
      if (route.request().method() === "DELETE") calls.webhook += 1;
      await route.fallback();
    });
    await page.route(`${API}/bots/${OWNER_BOT_ID}/developers/${DEVELOPER_USER_ID}`, async (route) => {
      if (route.request().method() === "DELETE") calls.developer += 1;
      await route.fallback();
    });
    await page.goto(`/bots?bot=${OWNER_BOT_ID}`);

    // B-08 — the picture.
    await page.getByRole("button", { name: "Убрать", exact: true }).click();
    const avatarQuestion = confirmation(page, "Убрать картинку бота?");
    await expect(avatarQuestion).toContainText("значком робота");
    await avatarQuestion.getByRole("button", { name: "Отмена" }).click();
    await expect(avatarQuestion).toHaveCount(0);
    expect(calls.avatar).toBe(0);
    await page.getByRole("button", { name: "Убрать", exact: true }).click();
    await confirmation(page, "Убрать картинку бота?").getByRole("button", { name: "Убрать", exact: true }).click();
    await expect(page.getByTestId("kub-feedback-viewport")).toContainText("Картинка убрана");
    expect(calls.avatar).toBe(1);

    // B-12 — the webhook.
    await page.getByRole("tab", { name: "API" }).click();
    await page.getByRole("button", { name: "Удалить webhook", exact: true }).click();
    const webhookQuestion = confirmation(page, "Удалить webhook?");
    await expect(webhookQuestion).toContainText("перестанет получать обновления");
    await expect(webhookQuestion).toContainText("останутся в очереди");
    await webhookQuestion.getByRole("button", { name: "Отмена" }).click();
    expect(calls.webhook).toBe(0);
    // The line follows the box above the button: with pending updates dropped,
    // the queue is thrown away rather than kept.
    await page.getByLabel("Удалить ожидающие обновления").check();
    await page.getByRole("button", { name: "Удалить webhook", exact: true }).click();
    const droppingQuestion = confirmation(page, "Удалить webhook?");
    await expect(droppingQuestion).toContainText("удалены без доставки");
    await droppingQuestion.getByRole("button", { name: "Удалить webhook", exact: true }).click();
    await expect(page.getByTestId("kub-feedback-viewport")).toContainText("Webhook удалён");
    expect(calls.webhook).toBe(1);

    // B-15 — the one that reaches somebody else, so the question names them.
    await page.getByRole("tab", { name: "Команда" }).click();
    await page.getByRole("button", { name: `Удалить разработчика ${DEVELOPER_NAME}` }).click();
    const developerQuestion = confirmation(page, "Убрать разработчика?");
    await expect(developerQuestion).toContainText(DEVELOPER_NAME);
    await expect(developerQuestion).toContainText("потеряет доступ");
    await developerQuestion.getByRole("button", { name: "Отмена" }).click();
    expect(calls.developer).toBe(0);
    await page.getByRole("button", { name: `Удалить разработчика ${DEVELOPER_NAME}` }).click();
    await confirmation(page, "Убрать разработчика?").getByRole("button", { name: "Убрать", exact: true }).click();
    await expect(page.getByTestId("kub-feedback-viewport")).toContainText("Разработчик убран");
    expect(calls.developer).toBe(1);
  });

  // D-145. The secret is not kept by the server in a form the browser can
  // resend, so the field says why instead of looking broken.
  test("explains why the signing secret has to be typed again", async ({ page }) => {
    await installManagementFixture(page);
    await page.goto(`/bots?bot=${OWNER_BOT_ID}`);
    await page.getByRole("tab", { name: "API" }).click();

    const webhookSection = section(page, "Webhook");
    await expect(webhookSection).toContainText("Сервер не возвращает сохранённый секрет");
    await expect(webhookSection).toContainText("даже если меняется только адрес");
    // The address is already filled from the saved webhook, and the button is
    // still held back — which is exactly the state the sentence explains.
    await expect(page.getByLabel("URL webhook")).toHaveValue(WEBHOOK_URL);
    await expect(page.getByLabel("Секрет подписи")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Сохранить webhook", exact: true })).toBeDisabled();
    await page.getByLabel("Секрет подписи").fill("fixture_secret_0123456789");
    await expect(page.getByRole("button", { name: "Сохранить webhook", exact: true })).toBeEnabled();
  });

  test("records the bot surfaces in both themes", async ({ page }, testInfo) => {
    await installManagementFixture(page);
    let failWebhookSave = false;
    await page.route(`${API}/bots/${OWNER_BOT_ID}/webhook`, async (route) => {
      if (failWebhookSave && route.request().method() === "PUT") {
        await failure(route, 400, "validation_failed");
        return;
      }
      await route.fallback();
    });

    for (const theme of ["dark", "light"] as const) {
      const shot = (name: string) => `output/bots/${name}-${theme}-${testInfo.project.name}.png`;

      failWebhookSave = false;
      await page.goto("/bots");
      await page.evaluate((value) => localStorage.setItem("kub-theme", value), theme);
      await page.reload();
      await expect(page.getByRole("button", { name: /Owner bot/ })).toBeVisible();
      await page.screenshot({ path: shot("list") });

      await page.getByRole("button", { name: /Owner bot/ }).click();
      await page.getByRole("button", { name: "Сохранить профиль" }).click();
      await expect(page.getByTestId("kub-feedback-viewport")).toContainText("Сохранено");
      await page.screenshot({ path: shot("save") });

      // The success is evidence of its own; leaving it up would put it over the
      // next frame, whose subject is an error somewhere else on the screen.
      await page.getByRole("button", { name: "Закрыть уведомление" }).click();
      await expect(page.getByTestId("kub-feedback-viewport")).toHaveCount(0);

      failWebhookSave = true;
      await page.getByRole("tab", { name: "API" }).click();
      await page.getByLabel("Секрет подписи").fill("fixture_secret_0123456789");
      await page.getByRole("button", { name: "Сохранить webhook", exact: true }).click();
      const webhookSection = section(page, "Webhook");
      await expect(webhookSection.getByRole("alert")).toBeVisible();
      await webhookSection.scrollIntoViewIfNeeded();
      await page.screenshot({ path: shot("error") });

      await page.getByRole("button", { name: "Удалить webhook", exact: true }).click();
      const question = confirmation(page, "Удалить webhook?");
      await expect(question).toBeVisible();
      await settledDialog(page);
      await page.screenshot({ path: shot("confirm") });
      await question.getByRole("button", { name: "Отмена" }).click();
    }
  });

  test("uses desktop master-detail and mobile one-pane without overflow", async ({ page }, testInfo) => {
    await installManagementFixture(page);
    await page.goto("/bots");
    const shell = page.getByTestId("bots-page");
    await expect(shell).toBeVisible();
    await page.getByRole("button", { name: /Owner bot/ }).click();
    const initialWidth = testInfo.project.use.viewport?.width ?? 1440;
    if (initialWidth >= 768) {
      await expect(page.getByTestId("bots-list-pane")).toBeVisible();
    } else {
      await expect(page.getByTestId("bots-list-pane")).toBeHidden();
    }
    await expect(page.getByTestId("bots-detail-pane")).toBeVisible();
    await assertNoHorizontalOverflow(shell);
    if (initialWidth === 1440) await page.screenshot({ path: "output/task-5-bots-1440.png", fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("bots-list-pane")).toBeHidden();
    await expect(page.getByTestId("bots-detail-pane")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(4);
    await assertNoHorizontalOverflow(shell);
    await page.screenshot({ path: `output/task-5-bots-390-${testInfo.project.name}.png`, fullPage: false });
    await page.evaluate(() => localStorage.setItem("kub-theme", "light"));
    await page.reload();
    await expect(page.getByTestId("bots-detail-pane")).toBeVisible();
    await assertNoHorizontalOverflow(shell);
    await page.screenshot({ path: `output/task-5-bots-390-light-${testInfo.project.name}.png`, fullPage: false });
    await page.getByRole("button", { name: "Назад к списку" }).click();
    await expect(page.getByTestId("bots-list-pane")).toBeVisible();
    await expect(page.getByTestId("bots-detail-pane")).toBeHidden();
  });
});

/** One of the panel's settings boxes, by the heading it is labelled with. */
const section = (page: Page, title: string) =>
  page.locator(`section[aria-labelledby="bot-section-${title}"]`);

/** The shared confirmation, whichever question it is asking. */
const confirmation = (page: Page, title: string) =>
  page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: title });

/**
 * Which of two elements is lower on the page.
 *
 * The defect this replaces was a position, not a wording: the message really
 * did exist, above the tabs, where nothing connected it to the button that
 * produced it. Measuring the box is the only way to hold that.
 */
async function verticalOrder(first: ReturnType<Page["locator"]>, second: ReturnType<Page["locator"]>) {
  const [above, below] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  if (!above || !below) throw new Error("both elements must be on the screen to be ordered");
  return below.y > above.y ? "after" : "before";
}

/**
 * Until the dialog has finished arriving.
 *
 * The overlay fades and the panel lifts, and Playwright calls both visible at
 * an opacity of zero — so a screenshot taken on «visible» catches the entrance
 * rather than the dialog. The same trap the settings specs record.
 */
async function settledDialog(page: Page) {
  await page.waitForFunction(() => {
    const last = (selector: string) => {
      const all = document.querySelectorAll(selector);
      return all.length ? all[all.length - 1] : null;
    };
    const parts = [last(".kub-modal-overlay"), last(".kub-modal-panel")];
    if (parts.some((part) => !part)) return false;
    return parts.every((part) => part!.getAnimations().every((animation) => animation.playState !== "running"));
  });
}

async function installSession(page: Page) {
  await page.addInitScript(({ userId }) => {
    const user = {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "bot-owner@example.invalid",
      user_metadata: { full_name: "Bot Owner" },
      app_metadata: {},
      created_at: "2026-08-29T00:00:00.000Z",
    };
    if (!localStorage.getItem("kub-theme")) localStorage.setItem("kub-theme", "dark");
    localStorage.setItem(
      "kub-auth",
      JSON.stringify({
        access_token: "playwright.user.jwt",
        refresh_token: "playwright-refresh",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user,
      }),
    );
  }, { userId: USER_ID });
}

async function installSupabaseFixture(page: Page) {
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/rest/v1/profiles")) {
      await json(route, {
        id: USER_ID,
        full_name: "Bot Owner",
        username: "bot_owner",
        avatar_url: null,
        bio: null,
        online_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      });
      return;
    }
    await json(route, []);
  });
}

async function installManagementFixture(page: Page) {
  const bots = [
    // One with a picture and one without, so the list shows both halves of the
    // B-03 fix in the same frame.
    summary(OWNER_BOT_ID, "owner_bot", "Owner bot", "owner", BOT_AVATAR),
    summary(DEVELOPER_BOT_ID, "developer_bot", "Developer bot", "developer", null),
  ];
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/bot/manage/v1", "");
    expect(request.headers().authorization).toBe("Bearer playwright.user.jwt");
    if (request.method() === "GET" && path === "/bots") {
      await ok(route, {
        bots,
        eligibility: {
          email_verified: true,
          phone_verified: true,
          account_age_met: true,
          not_banned: true,
          under_limit: true,
          active_bot_count: 2,
          max_bots: 3,
          can_create: true,
        },
      });
      return;
    }
    if (request.method() === "POST" && path === "/bots") {
      const bot = summary("55555555-5555-4555-8555-555555555555", "release_bot", "Release bot", "owner", null);
      bots.unshift(bot);
      await ok(route, {
        bot: {
          id: bot.id,
          username: bot.username,
          display_name: bot.display_name,
          description: bot.description,
          state: bot.state,
          created_at: bot.created_at,
        },
        token: RAW_TOKEN,
      }, 201);
      return;
    }
    const detailMatch = path.match(/^\/bots\/([0-9a-f-]+)$/);
    if (request.method() === "GET" && detailMatch) {
      const bot = bots.find((item) => item.id === detailMatch[1])!;
      await ok(route, detail(bot));
      return;
    }
    if (request.method() === "POST" && path.endsWith("/token/rotate")) {
      await ok(route, { token: RAW_TOKEN, token_prefix: "lc_bot_0123456789", created_at: NOW });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/pause")) {
      bots[0].state = "paused";
    }
    if (request.method() === "POST" && path.endsWith("/deletion/request")) {
      bots[0].state = "pending_delete";
      bots[0].delete_after = "2026-09-07T12:00:00.000Z";
      bots[0].token = null;
    }
    await ok(route, { success: true });
  });
}

function summary(id: string, username: string, displayName: string, role: "owner" | "developer", avatarUrl: string | null) {
  return {
    id,
    username,
    display_name: displayName,
    description: "A bot description that remains readable at narrow widths.",
    avatar_url: avatarUrl,
    state: "active",
    delete_after: null as string | null,
    role,
    token: role === "owner" ? { prefix: "lc_bot_0123456789", created_at: NOW, last_used_at: null } : null,
    created_at: NOW,
    updated_at: NOW,
  };
}

function detail(bot: ReturnType<typeof summary>) {
  return {
    bot,
    commands: [{ command: "help", description: "Показать справку" }],
    // A developer to remove (B-15) and a webhook to delete (B-12); both
    // controls are only drawn when there is something for them to act on.
    developers: [{
      user_id: DEVELOPER_USER_ID,
      display_name: DEVELOPER_NAME,
      username: "anna",
      created_at: NOW,
    }],
    privacy: [{
      chat_id: "44444444-4444-4444-8444-444444444444",
      chat_name: "Команда продукта",
      privacy_mode: "restricted",
    }],
    webhook: { configured: true, url: WEBHOOK_URL },
    diagnostics: {
      delivery_mode: null,
      pending_update_count: 0,
      failure_count: 0,
      last_error_code: null,
      refreshed_at: NOW,
    },
  };
}

async function browserStorageContains(page: Page, value: string) {
  return page.evaluate((needle) => {
    return [localStorage, sessionStorage].some((storage) =>
      Object.values(storage).some((entry) => entry.includes(needle)),
    );
  }, value);
}

async function browserTokenResidue(page: Page, value: string, consoleMessages: string[]) {
  const browserResidue = await page.evaluate(async (needle) => {
    const contains = (candidate: unknown) => {
      try {
        return JSON.stringify(candidate).includes(needle);
      } catch {
        return String(candidate).includes(needle);
      }
    };
    const appModule = await import("/src/App.tsx");
    const queryClient = appModule.queryClient;
    const queryData = queryClient
      ? {
          queries: queryClient.getQueryCache().getAll().map((query: { state: unknown }) => query.state),
          mutations: queryClient.getMutationCache().getAll().map((mutation: { state: unknown }) => mutation.state),
        }
      : { missingQueryClientExport: needle };

    let cacheStorage = false;
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (request.url.includes(needle) || (response && (await response.clone().text()).includes(needle))) {
          cacheStorage = true;
        }
      }
    }

    let indexedDb = false;
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const database = await new Promise<IDBDatabase | null>((resolve) => {
        const open = indexedDB.open(info.name!);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => resolve(null);
      });
      if (!database || database.objectStoreNames.length === 0) {
        database?.close();
        continue;
      }
      const transaction = database.transaction(Array.from(database.objectStoreNames), "readonly");
      for (const storeName of Array.from(database.objectStoreNames)) {
        const values = await new Promise<unknown[]>((resolve) => {
          const request = transaction.objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve([]);
        });
        if (contains(values)) indexedDb = true;
      }
      database.close();
    }

    return {
      queryClient: contains(queryData),
      cacheStorage,
      indexedDb,
      historyOrUrl: location.href.includes(needle) || contains(history.state),
      dom: document.documentElement.innerHTML.includes(needle),
      localStorage: Object.values(localStorage).some((entry) => entry.includes(needle)),
      sessionStorage: Object.values(sessionStorage).some((entry) => entry.includes(needle)),
    };
  }, value);

  return {
    ...browserResidue,
    console: consoleMessages.some((message) => message.includes(value)),
  };
}

async function buttonContrast(locator: ReturnType<Page["getByRole"]>) {
  return locator.evaluate((element) => {
    const parse = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
    const luminance = (channels: number[]) => {
      const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    const style = getComputedStyle(element);
    const [bright, dark] = [luminance(parse(style.color)), luminance(parse(style.backgroundColor))]
      .sort((left, right) => right - left);
    return (bright + 0.05) / (dark + 0.05);
  });
}

async function assertNoHorizontalOverflow(locator: ReturnType<Page["getByTestId"]>) {
  const dimensions = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function ok(route: Route, result: unknown, status = 200) {
  await json(route, { ok: true, result }, status);
}

async function failure(route: Route, status: number, code: string) {
  await json(route, {
    ok: false,
    error: { code, message: "Request failed", request_id: "playwright-request" },
  }, status);
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
