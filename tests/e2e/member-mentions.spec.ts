import { expect, test, type Page } from "@playwright/test";
import { chat, membership, message, openFixture, person, requireFixtureServer, type FixtureOptions } from "./helpers/messageActionsFixture";

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });
const AT = "2026-10-01T12:00:00.000Z";
const ME = person("76111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("76111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const OTHER = person("76111111-1111-4111-8111-000000000003", "Анна Смирнова", "anna_second");
const STRANGER = person("76111111-1111-4111-8111-000000000004", "Анна Незнакомая", "stranger");
const CHAT = "76222222-2222-4222-8222-000000000001";

test.beforeEach(async ({ request }) => { await requireFixtureServer(request); });
async function settlePaint(page: Page) {
  await page.evaluate(async () => {
    for (let turn = 0; turn < 6; turn += 1) {
      const finite = document.getAnimations().filter((animation) =>
        Number.isFinite(animation.effect?.getComputedTiming().endTime));
      await Promise.all(finite.map((animation) => animation.finished.catch(() => {})));
      await new Promise(requestAnimationFrame);
    }
  });
}

async function boot(page: Page, theme: "light" | "dark" = "dark", rest?: FixtureOptions["rest"]) {
  const fixture = await openFixture(page, { me: ME, theme, people: [ANNA, OTHER, STRANGER],
    rest, chats: [chat(CHAT, "group", "Упоминания", AT)],
    memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT), membership(CHAT, OTHER, "member", AT)],
    messages: [message("76333333-3333-4333-8333-000000000001", CHAT, OTHER, "Привет, @Анна Смирнова!", AT, {
      mention_entities: { version: 1, revision: "76444444-4444-4444-8444-000000000001", items: [
        { kind: "user", user_id: ANNA.id, offset: 8, length: 14, label: "@Анна Смирнова" },
      ] },
    })] });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-list-item").filter({ hasText: "Упоминания" }).click();
  await expect(page.getByPlaceholder("Сообщение…").first()).toBeVisible();
  return fixture;
}

async function pickFiles(page: Page) {
  const sheet = page.getByTestId("attach-sheet");
  await sheet.getByRole("tab", { name: "Файл", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await sheet.locator('[data-attach-entry="file"]').click();
  await (await chooserPromise).setFiles([
    { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic first file") },
    { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic second file") },
  ]);
  return sheet;
}

test("member choice is scoped, distinguishable and never sends until the arrow", async ({ page }) => {
  const fixture = await boot(page);
  const field = page.getByPlaceholder("Сообщение…").first();
  await field.fill("Привет, @Ан");
  const menu = page.getByRole("listbox", { name: "Участники чата" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option")).toHaveCount(2);
  await expect(menu).not.toContainText("Незнакомая");
  await expect(menu).toContainText("@anna_second");
  await menu.locator(`[data-mention-id="${ANNA.id}"]`).click();
  await expect(field).toHaveValue("Привет, @Анна Смирнова ");
  await expect(field).toBeFocused();
  expect(fixture.restCalls("messages", "POST")).toHaveLength(0);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(1);
  const payload = fixture.restCalls("messages", "POST")[0].body as Record<string, any>;
  expect(payload.content).toBe("Привет, @Анна Смирнова");
  expect(payload.mention_entities.items).toEqual([
    { kind: "user", user_id: ANNA.id, offset: 8, length: 14, label: "@Анна Смирнова" },
  ]);
});

test("picker Enter respects phone newline, desktop selection and Escape dismissal", async ({ page }) => {
  const fixture = await boot(page);
  const field = page.getByPlaceholder("Сообщение…").first();
  await field.fill("@Ан");
  await expect(page.getByRole("listbox", { name: "Участники чата" })).toBeVisible();
  await field.press("Enter");
  if ((page.viewportSize()?.width ?? 0) < 768) await expect(field).toHaveValue("@Ан\n");
  else await expect(field).toHaveValue("@Анна Смирнова ");
  expect(fixture.restCalls("messages", "POST")).toHaveLength(0);
  await field.fill("@См");
  await expect(page.getByRole("listbox", { name: "Участники чата" })).toBeVisible();
  await field.press("Escape");
  await expect(page.getByRole("listbox", { name: "Участники чата" })).toHaveCount(0);
  await field.click();
  await expect(page.getByRole("listbox", { name: "Участники чата" })).toHaveCount(0);
  await field.press("a");
  await expect(page.getByRole("listbox", { name: "Участники чата" })).toBeVisible();
});

test("editing a refused send restores its addressed draft, not just visible text", async ({ page }) => {
  let refuse = true;
  const fixture = await boot(page, "dark", (call) => {
    if (call.resource !== "messages" || !refuse) return undefined;
    if (call.method === "POST") return { status: 403, body: { code: "42501", message: "Synthetic refusal" } };
    if (call.method === "GET" && call.search?.includes("client_message_id=")) return { status: 200, body: [] };
    return undefined;
  });
  const field = page.getByPlaceholder("Сообщение…").first();
  await field.fill("@Ан");
  await page.locator(`[data-mention-id="${ANNA.id}"]`).click();
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const failed = page.locator('[data-message-send-error="true"]');
  await expect(failed).toBeVisible();
  await failed.getByRole("button", { name: "Изменить", exact: true }).click();
  await expect(field).toHaveValue("@Анна Смирнова");
  refuse = false;
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(2);
  const payload = fixture.restCalls("messages", "POST")[1].body as Record<string, any>;
  expect(payload.mention_entities.items).toEqual([
    { kind: "user", user_id: ANNA.id, offset: 0, length: 14, label: "@Анна Смирнова" },
  ]);
});

test("owned draft survives reload; legacy unowned draft is not consumed", async ({ page }) => {
  const fixture = await boot(page);
  await page.evaluate(({ chatId }) => localStorage.setItem(`kub:draft:${chatId}`, "Unowned historical text"), { chatId: CHAT });
  const field = page.getByPlaceholder("Сообщение…").first();
  await field.fill("@Ан");
  await page.locator(`[data-mention-id="${ANNA.id}"]`).click();
  const draftKey = `kub:draft:v2:${ME.id}:${CHAT}`;
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.mentionEntities.items.length, draftKey)).toBe(1);
  await page.reload();
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("@Анна Смирнова ");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(1);
  const payload = fixture.restCalls("messages", "POST")[0].body as Record<string, any>;
  expect(payload.mention_entities.items[0].user_id).toBe(ANNA.id);
  expect(await page.evaluate((chatId) => localStorage.getItem(`kub:draft:${chatId}`), CHAT)).toBe("Unowned historical text");
});

test("the newly committed attachment sheet already owns keyboard focus before its first frame", async ({ page }) => {
  const fixture = await boot(page);
  await page.evaluate(() => {
    const probe = { first: null as null | { inside: boolean; role: string | null } };
    (window as any).__firstAttachFocus = probe;
    const observer = new MutationObserver(() => {
      const sheet = document.querySelector('[data-testid="attach-sheet"]');
      if (!sheet || probe.first) return;
      probe.first = { inside: sheet.contains(document.activeElement),
        role: document.activeElement?.getAttribute("role") ?? null };
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__firstAttachFocus.first))
    .toEqual({ inside: true, role: "tab" });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("attach-sheet")).toHaveCount(0);
  expect(fixture.restCalls("messages", "POST")).toHaveLength(0);
});

test("caption handoff and cancel preserve the UUID; only the first file carries it", async ({ page }) => {
  const fixture = await boot(page);
  await page.route("http://127.0.0.1:54321/storage/v1/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "media/synthetic.txt" }) });
  });
  const field = page.getByPlaceholder("Сообщение…").first();
  await field.fill("@Ан");
  await page.locator(`[data-mention-id="${ANNA.id}"]`).click();
  await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
  await expect(field).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("attach-sheet")).toHaveCount(0);
  await expect(field).toHaveValue("@Анна Смирнова ");
  await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
  const sheet = await pickFiles(page);
  const caption = sheet.getByTestId("attach-caption");
  await expect(caption).toHaveValue("@Анна Смирнова ");
  await caption.press("End");
  await caption.press("Space");
  await caption.press("@");
  await caption.pressSequentially("А");
  await page.locator(`[data-mention-id="${OTHER.id}"]`).click();
  await sheet.getByTestId("attach-send").click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(2);
  const rows = fixture.restCalls("messages", "POST").map((call) => call.body as Record<string, any>);
  expect(rows.map((row) => row.type)).toEqual(["file", "file"]);
  expect(rows[0].mention_entities.items.map((item: any) => item.user_id)).toEqual([ANNA.id, OTHER.id]);
  expect(rows[1].mention_entities?.items ?? []).toEqual([]);
  expect(rows[1].content).not.toContain("@Анна");
});

test("a refused caption carrier is not copied into the next file or repinged on retry", async ({ page }) => {
  let firstClientId: string | undefined;
  let refuse = true;
  const fixture = await boot(page, "dark", (call) => {
    if (call.resource !== "messages") return undefined;
    const body = call.body as Record<string, any> | null;
    if (call.method === "POST" && !firstClientId) firstClientId = body?.client_message_id;
    if (refuse && call.method === "POST" && body?.client_message_id === firstClientId)
      return { status: 403, body: { code: "42501", message: "Synthetic first-file refusal" } };
    if (call.method === "GET" && call.search?.includes(`client_message_id=eq.${firstClientId}`))
      return { status: 200, body: [] };
    return undefined;
  });
  const field = page.getByPlaceholder("Сообщение…").first();
  await field.fill("@Ан");
  await page.locator(`[data-mention-id="${ANNA.id}"]`).click();
  await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
  const sheet = await pickFiles(page);
  await sheet.getByTestId("attach-send").click();
  await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(2);
  const rows = fixture.restCalls("messages", "POST").map((call) => call.body as Record<string, any>);
  expect(rows[0].mention_entities.items[0].user_id).toBe(ANNA.id);
  expect(rows[1].mention_entities?.items ?? []).toEqual([]);
  const failed = page.locator('[data-message-send-error="true"]');
  await expect(failed).toBeVisible();
  refuse = false;
  await failed.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(3);
  const retried = fixture.restCalls("messages", "POST")[2].body as Record<string, any>;
  expect(retried.client_message_id).toBe(firstClientId);
  expect(retried.mention_entities).toEqual(rows[0].mention_entities);
});

for (const surface of ["composer", "caption"] as const) for (const replacement of ["@Анна Смирнова", "@Анна Смирнова!"]) test(`${surface}: plain-text paste ${replacement.endsWith("!") ? "changed" : "identical"} replaces the selected identity`, async ({ page }) => {
  const fixture = await boot(page);
  await page.getByPlaceholder("Сообщение…").first().fill("@Ан");
  await page.locator(`[data-mention-id="${ANNA.id}"]`).click();
  let field = page.getByPlaceholder("Сообщение…").first();
  if (surface === "caption") {
    await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
    field = (await pickFiles(page)).getByTestId("attach-caption");
  }
  await field.evaluate((element: HTMLTextAreaElement, text) => {
    element.focus();
    element.setSelectionRange(0, 14);
    const data = new DataTransfer();
    data.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    element.setRangeText(text, 0, 14, "end");
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }));
  }, replacement);
  await expect(field).toHaveValue(`${replacement} `);
  if (surface === "caption") await page.getByTestId("attach-send").click();
  else await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(surface === "caption" ? 2 : 1);
  expect((fixture.restCalls("messages", "POST")[0].body as Record<string, any>).mention_entities?.items ?? []).toEqual([]);
});

test("an account change discards the open picker and cannot reuse the previous account's addressed draft", async ({ page }) => {
  let storeModule = "";
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/src/store/app.store.ts") storeModule = request.url();
  });
  const fixture = await boot(page);
  const field = page.getByPlaceholder("Сообщение…").first();
  await field.fill("@Ан");
  await page.locator(`[data-mention-id="${ANNA.id}"]`).click();
  await expect(field).toHaveValue("@Анна Смирнова ");
  await expect.poll(() => field.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(15);
  await field.press("End");
  await page.keyboard.insertText(" @Ан");
  await expect(page.getByRole("listbox", { name: "Участники чата" })).toBeVisible();
  expect(storeModule).not.toBe("");
  await page.evaluate(async ({ path, nextUser }) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    const previousChats = useAppStore.getState().chats;
    const previousChatId = useAppStore.getState().selectedChatId;
    useAppStore.getState().setCurrentUser(nextUser);
    useAppStore.getState().setChats(previousChats);
    useAppStore.getState().setSelectedChatId(previousChatId);
  }, { path: storeModule, nextUser: ANNA });
  await expect(page.getByRole("listbox", { name: "Участники чата" })).toHaveCount(0);
  await expect(field).toHaveValue("");
  await field.fill("Account B plain text");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(1);
  const payload = fixture.restCalls("messages", "POST")[0].body as Record<string, any>;
  expect(payload.user_id).toBe(ANNA.id);
  expect(payload.mention_entities?.items ?? []).toEqual([]);
  expect(await page.evaluate(({ owner, chatId }) =>
    JSON.parse(localStorage.getItem(`kub:draft:v2:${owner}:${chatId}`) ?? "null")?.mentionEntities.items[0].user_id,
  { owner: ME.id, chatId: CHAT })).toBe(ANNA.id);
});

test("IME Enter cannot select a member or send a message", async ({ page }) => {
  const fixture = await boot(page);
  const field = page.getByPlaceholder("Сообщение…").first();
  await field.fill("@Ан");
  await expect(page.getByRole("listbox", { name: "Участники чата" })).toBeVisible();
  await field.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true, bubbles: true });
  await expect(field).toHaveValue("@Ан");
  expect(fixture.restCalls("messages", "POST")).toHaveLength(0);
});

for (const width of [390, 1440]) for (const theme of ["dark", "light"] as const) {
  test(`${width} ${theme}: a received document caption activates its stored member UUID`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await openFixture(page, { me: ME, theme, people: [ANNA, OTHER],
      chats: [chat(CHAT, "group", "Упоминания", AT)],
      memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT), membership(CHAT, OTHER, "member", AT)],
      messages: [message("76333333-3333-4333-8333-000000000021", CHAT, OTHER, "  Привет, @Анна Смирнова!  ", AT, {
        type: "file", media_url: "/__fixture-media/report.txt",
        media_metadata: { file_name: "report.txt", mime_type: "text/plain", size_bytes: 12 },
        mention_entities: { version: 1, revision: "76444444-4444-4444-8444-000000000021", items: [
          { kind: "user", user_id: ANNA.id, offset: 10, length: 14, label: "@Анна Смирнова" },
        ] },
      })] });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("chat-list-item").filter({ hasText: "Упоминания" }).click();
    const caption = page.getByTestId("file-message-caption");
    await expect(caption).toHaveText("Привет, @Анна Смирнова!");
    await expect.poll(() => ["mark_chat_read_through", "notifications_mark_chat_messages_read", "mark_channel_read"]
      .every((rpc) => fixture.requests.some((entry) => entry.resource === `rpc/${rpc}`))).toBe(true);
    const mutations = () => fixture.requests.filter((entry) => /read|deliver|command/.test(entry.resource)
      || ["messages", "chat_members", "chats"].includes(entry.resource) && entry.method !== "GET").length;
    const before = mutations();
    const url = page.url();
    await settlePaint(page);
    if (process.env.KUB_CAPTURE_SYNTHETIC === "1")
      await page.screenshot({ path: `output/member-mentions/file-${width}-${theme}.png` });
    await caption.locator(`[data-member-mention="${ANNA.id}"]`).click();
    await expect(page.getByTestId("user-profile-overlay")).toContainText("@anna");
    await expect(page.getByTestId("user-profile-overlay")).not.toContainText("anna_second");
    expect(mutations()).toBe(before);
    expect(page.url()).toBe(url);
    expect(fixture.restCalls("messages", "POST")).toHaveLength(0);
    await expect(page.getByTestId("document-viewer")).toHaveCount(0);
  });
}

for (const width of [390, 1440]) for (const theme of ["dark", "light"] as const) {
  test(`${width} ${theme}: an album caption receives the tap on its stored member UUID`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    if (process.env.KUB_MENTION_POINTER_ABLATION === "1") {
      await page.route("**/src/lib/formatText.tsx*", async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        expect(source.split("pointer-events-auto")).toHaveLength(2);
        await route.fulfill({ response, body: source.replace("pointer-events-auto", "") });
      });
    }
    if (process.env.KUB_MENTION_CONTRAST_ABLATION === "1") {
      await page.route("**/src/components/chat/MessageAlbumTile.tsx*", async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        expect(source.split("[--kub-accent-text:#c7d2fe]")).toHaveLength(2);
        await route.fulfill({ response, body: source.replace("[--kub-accent-text:#c7d2fe]", "") });
      });
    }
    const fixture = await openFixture(page, { me: ME, theme, people: [ANNA, OTHER],
      chats: [chat(CHAT, "group", "Упоминания", AT)],
      // Both photos are already read: an unread boundary intentionally splits an album.
      memberships: [membership(CHAT, ME, "owner", new Date(Date.parse(AT) + 10000).toISOString()),
        membership(CHAT, ANNA, "member", AT), membership(CHAT, OTHER, "member", AT)],
      messages: [0, 1].map((index) => message(`76333333-3333-4333-8333-00000000003${index}`, CHAT, OTHER,
        index === 0 ? "  Привет, @Анна Смирнова!  " : "Второй кадр", new Date(Date.parse(AT) + index * 1000).toISOString(), {
          type: "image", media_url: `/__fixture-media/mention-album-${index}.svg`,
          media_metadata: { width: 800, height: 600, size_bytes: 512,
            album_id: "76444444-4444-4444-8444-000000000030", album_index: index, album_count: 2 },
          mention_entities: index === 0 ? { version: 1, revision: "76444444-4444-4444-8444-000000000031", items: [
            { kind: "user", user_id: ANNA.id, offset: 10, length: 14, label: "@Анна Смирнова" },
          ] } : { version: 1, revision: null, items: [] },
        })) });
    await page.route("**/__fixture-media/mention-album-*.svg", (route) => route.fulfill({ status: 200,
      contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#27815e"/></svg>' }));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("chat-list-item").filter({ hasText: "Упоминания" }).click();
    const album = page.locator('[data-message-album="76444444-4444-4444-8444-000000000030"]');
    await expect(album.locator("[data-message-album-tile]")).toHaveCount(2);
    await expect.poll(() => ["mark_chat_read_through", "notifications_mark_chat_messages_read", "mark_channel_read"]
      .every((rpc) => fixture.requests.some((entry) => entry.resource === `rpc/${rpc}`))).toBe(true);
    const mutations = () => fixture.requests.filter((entry) => /read|deliver|command/.test(entry.resource)
      || ["messages", "chat_members", "chats"].includes(entry.resource) && entry.method !== "GET").length;
    const before = mutations();
    const url = page.url();
    await settlePaint(page);
    if (process.env.KUB_CAPTURE_SYNTHETIC === "1")
      await page.screenshot({ path: `output/member-mentions/album-${width}-${theme}.png` });
    const mention = album.locator(`[data-member-mention="${ANNA.id}"]`);
    await expect(mention).toBeVisible();
    const contrast = await mention.evaluate((element) => {
      const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
      const foreground = rgb(getComputedStyle(element).color);
      const overlay = rgb(getComputedStyle(element.parentElement!.parentElement!).backgroundColor);
      if (foreground.length !== 3 || overlay.length !== 4) throw new Error("Expected RGB text on an RGBA media overlay");
      const luminance = (channels: number[]) => channels.reduce((total, channel, index) => {
        const value = channel / 255;
        return total + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          * [0.2126, 0.7152, 0.0722][index]!;
      }, 0);
      // A white photo is the brightest possible backdrop beneath this dark overlay.
      const background = overlay.slice(0, 3).map((channel) => channel * overlay[3]! + 255 * (1 - overlay[3]!));
      const light = luminance(foreground);
      const dark = luminance(background);
      return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    // Exercise hit testing, not a dispatchEvent or force-click through the photo.
    await mention.click({ timeout: 3000 });
    await expect(page.getByTestId("user-profile-overlay")).toContainText("@anna");
    await expect(page.getByTestId("user-profile-overlay")).not.toContainText("anna_second");
    expect(mutations()).toBe(before);
    expect(page.url()).toBe(url);
    expect(fixture.restCalls("messages", "POST")).toHaveLength(0);
    await expect(page.getByTestId("media-viewer-stage")).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Positive control: the photo's own target still opens the real viewer.
    await album.locator('[data-message-album-tile] > button').first().click();
    await expect(page.getByTestId("media-viewer-stage")).toBeVisible();
  });
}

test("a shared conversation cannot expose the previous account's failed local message", async ({ page }) => {
  let storeModule = "";
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/src/store/app.store.ts") storeModule = request.url();
  });
  await boot(page, "dark", (call) => {
    if (call.resource !== "messages") return undefined;
    if (call.method === "POST") return { status: 403, body: { code: "42501", message: "Synthetic refusal" } };
    if (call.method === "GET" && call.search?.includes("client_message_id=")) return { status: 200, body: [] };
    return undefined;
  });
  const field = page.getByPlaceholder("Сообщение…").first();
  await field.fill("Account A private unsent draft");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator('[data-message-send-error="true"]')).toBeVisible();
  await expect(page.getByTestId("message-scroll-container").getByText("Account A private unsent draft", { exact: true })).toBeVisible();
  const cachedBodies = await page.evaluate(async ({ path, nextUser }) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    const previousChats = useAppStore.getState().chats.map((row: any) => ({ ...row, last_message: undefined }));
    const previousChatId = useAppStore.getState().selectedChatId;
    useAppStore.getState().setCurrentUser(null);
    useAppStore.getState().setCurrentUser(nextUser);
    const bodies = Object.values(useAppStore.getState().messages).flat().map((row: any) => row.content);
    useAppStore.getState().setChats(previousChats);
    useAppStore.getState().setSelectedChatId(previousChatId);
    return bodies;
  }, { path: storeModule, nextUser: ANNA });
  expect(cachedBodies).not.toContain("Account A private unsent draft");
  await expect(field).toBeVisible();
  await expect(page.getByText("Account A private unsent draft", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-message-send-error="true"]')).toHaveCount(0);
});

test("caption Escape dismisses member choice without discarding picked files", async ({ page }) => {
  const fixture = await boot(page);
  await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
  const sheet = await pickFiles(page);
  const field = sheet.getByTestId("attach-caption");
  await field.fill("@Ан");
  await expect(page.getByRole("listbox", { name: "Участники чата" })).toBeVisible();
  await field.press("Escape");
  await expect(page.getByRole("listbox", { name: "Участники чата" })).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Выбрано 2");
  await expect(page.getByRole("dialog", { name: "Отменить выбор?" })).toHaveCount(0);
  expect(fixture.restCalls("messages", "POST")).toHaveLength(0);
});

for (const surface of ["composer", "caption"] as const) test(`${surface}: typing the same letter over a selection removes its member identity`, async ({ page }) => {
  const fixture = await boot(page);
  let field = page.getByPlaceholder("Сообщение…").first();
  await field.fill("@Ан");
  await page.locator(`[data-mention-id="${ANNA.id}"]`).click();
  await expect.poll(() => field.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(15);
  if (surface === "caption") {
    await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
    field = (await pickFiles(page)).getByTestId("attach-caption");
  }
  await field.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(1, 2);
  });
  await page.keyboard.insertText("А");
  await expect(field).toHaveValue("@Анна Смирнова ");
  if (surface === "caption") await page.getByTestId("attach-send").click();
  else await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(surface === "caption" ? 2 : 1);
  expect((fixture.restCalls("messages", "POST")[0].body as Record<string, any>).mention_entities?.items ?? []).toEqual([]);
});

for (const nextEdit of ["another message", "same message reopened"] as const) test(`a late edit response cannot close ${nextEdit} in the same conversation`, async ({ page }) => {
  let storeModule = "";
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/src/store/app.store.ts") storeModule = request.url();
  });
  await boot(page);
  const editA = message("76333333-3333-4333-8333-000000000011", CHAT, ME, "Edit A", AT);
  const editB = message("76333333-3333-4333-8333-000000000012", CHAT, ME, "Edit B", AT);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  await page.route("http://127.0.0.1:54321/rest/v1/messages?**", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    started = true;
    await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: editA.id }) });
  });
  const selectEdit = (row: Record<string, unknown>) => page.evaluate(async ({ path, next }) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    useAppStore.getState().setEditingMessage(next);
  }, { path: storeModule, next: row });
  const field = page.getByPlaceholder("Сообщение…").first();
  await selectEdit(editA);
  await expect(field).toHaveValue("Edit A");
  await field.fill("Edited A");
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  const next = nextEdit === "another message" ? editB : editA;
  if (nextEdit === "same message reopened") {
    await page.getByRole("button", { name: "Отменить редактирование", exact: true }).click();
  }
  await selectEdit(next);
  await expect(field).toHaveValue(next.content as string);
  await field.fill("New unsaved edit session");
  const response = page.waitForResponse((value) => value.request().method() === "PATCH" && value.url().includes("/messages?"));
  release();
  await response;
  await expect.poll(() => page.evaluate(async (path) => {
    const { useAppStore } = await import(/* @vite-ignore */ path);
    return useAppStore.getState().editingMessage?.id;
  }, storeModule)).toBe(next.id);
  await expect(field).toHaveValue("New unsaved edit session");
});

for (const width of [390, 1440]) for (const theme of ["dark", "light"] as const) {
  test(`${width} ${theme}: picker fits, rows are stable and profile action carries UUID`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await boot(page, theme);
    // Opening this fixture chat marks its visible history read after a 700ms
    // debounce. Observe that positive control before attributing writes to a
    // profile action; a 500ms sleep included the initial read in that action.
    await expect.poll(() => ["mark_chat_read_through", "notifications_mark_chat_messages_read", "mark_channel_read"]
      .every((rpc) => fixture.requests.some((entry) => entry.resource === `rpc/${rpc}`))).toBe(true);
    const sourceUrl = page.url();
    const activationBefore = fixture.requests.filter((entry) =>
      /read|deliver|command/.test(entry.resource) || ["messages", "chat_members", "chats"].includes(entry.resource) && entry.method !== "GET").length;
    const writesBefore = fixture.restCalls("messages", "POST").length;
    await page.locator(`[data-member-mention="${ANNA.id}"]`).click();
    await expect(page.getByTestId("user-profile-overlay")).toBeVisible();
    await expect(page.getByTestId("user-profile-overlay")).toContainText("@anna");
    await expect(page.getByTestId("user-profile-overlay")).not.toContainText("anna_second");
    expect(fixture.restCalls("messages", "POST")).toHaveLength(writesBefore);
    expect(fixture.requests.filter((entry) =>
      /read|deliver|command/.test(entry.resource) || ["messages", "chat_members", "chats"].includes(entry.resource) && entry.method !== "GET")).toHaveLength(activationBefore);
    expect(page.url()).toBe(sourceUrl);
    await page.keyboard.press("Escape");
    await page.getByPlaceholder("Сообщение…").first().fill("@Ан");
    const menu = page.getByRole("listbox", { name: "Участники чата" });
    await expect(menu).toBeVisible();
    await settlePaint(page);
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    const row = await menu.getByRole("option").first().boundingBox();
    expect(row!.height).toBeGreaterThanOrEqual(44);
    if (process.env.KUB_CAPTURE_SYNTHETIC === "1") {
      await page.screenshot({ path: `output/member-mentions/${width}-${theme}.png` });
    }
    await page.getByPlaceholder("Сообщение…").first().fill("");
    await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
    const sheet = await pickFiles(page);
    const caption = sheet.getByTestId("attach-caption");
    await caption.fill("@Ан");
    await expect(menu).toBeVisible();
    await settlePaint(page);
    const captionMenu = await menu.boundingBox();
    const captionBox = await caption.boundingBox();
    expect(captionMenu!.x).toBeGreaterThanOrEqual(0);
    expect(captionMenu!.x + captionMenu!.width).toBeLessThanOrEqual(width);
    expect(captionMenu!.y + captionMenu!.height).toBeLessThanOrEqual(captionBox!.y);
    if (process.env.KUB_CAPTURE_SYNTHETIC === "1") {
      await page.screenshot({ path: `output/member-mentions/caption-${width}-${theme}.png` });
    }
    expect(fixture.restCalls("messages", "POST")).toHaveLength(writesBefore);
  });
}
