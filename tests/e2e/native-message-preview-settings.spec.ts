import { expect, test, type Page } from "@playwright/test";
import { ME, openSettingsScreen } from "./helpers/settingsColumnFixture";

// This file uses invented accounts, the localhost-only backend and native wire doubles.
test.use({ screenshot: "off", trace: "off", video: "off" });
const SESSION = "22222222-2222-4222-8222-000000000001";
const DEVICE = "33333333-3333-4333-8333-000000000001";

async function nativeShell(page: Page, supported = false) {
  await page.addInitScript(({ supported, owner, session, device }) => {
    const wire = window as unknown as Record<string, unknown>;
    wire.androidBridge = { postMessage() {} };
    wire.Capacitor = {
      PluginHeaders: supported ? [{ name: "MessagePreviews", methods: [{ name: "getCapabilities", rtype: "promise" }] }] : [],
      nativePromise: async (plugin: string, method: string) => {
        if (plugin !== "MessagePreviews" || method !== "getCapabilities") throw Error("unexpected native boundary");
        await wire.previewNativeGate;
        return { protocol: 1, recipientId: owner, recipientSessionId: session, deviceId: device };
      },
    };
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "kub-auth") {
        const auth = JSON.parse(value);
        auth.access_token = "fixture." + btoa(JSON.stringify({ sub: owner, session_id: session, role: "authenticated",
          is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 3600 })) + ".fixture";
        value = JSON.stringify(auth);
      }
      return original.call(this, key, value);
    };
  }, { supported, owner: ME.id, session: SESSION, device: DEVICE });
}

async function openPreview(page: Page) {
  await page.getByTestId("settings-open-message-preview").click();
  return page.getByTestId("settings-section-message-preview");
}

for (const width of [1440, 390]) for (const theme of ["dark", "light"] as const) {
  test(`old APK has truthful device status without unknown account choices ${width} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await nativeShell(page);
    const forbidden: string[] = [];
    page.on("request", request => {
      if (request.url().includes("native_message_preview") || request.url().includes("notification_preview_preferences")) forbidden.push(request.url());
    });
    await openSettingsScreen(page, { theme });
    const panel = page.getByTestId("native-message-preview-setting");
    await expect(panel).toContainText("Общий текст на этом устройстве");
    await expect(panel.getByRole("radio")).toHaveCount(0);
    await expect(panel.getByRole("button")).toHaveCount(0);
    await expect(panel).not.toContainText("Для аккаунта");
    expect(forbidden).toEqual([]);
    const geometry = await panel.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, overflow: element.scrollWidth > element.clientWidth + 1 };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.overflow).toBe(false);
    await panel.screenshot({ path: info.outputPath("preview-settings.png") });
    if (width >= 768) {
      await page.getByTestId("settings-search-input").fill("текст уведомлений");
      await expect(panel).toBeVisible();
    }
  });
}

for (const width of [1440, 390]) for (const theme of ["dark", "light"] as const) {
test(`actual Settings consumer enables choices only with exact native/server capability and verified write ${width} ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await nativeShell(page, true);
  let level = "sender";
  const capabilityArgs: unknown[] = [];
  await openSettingsScreen(page, { theme, rpc(name, args) {
    if (name !== "native_message_preview_capability") return undefined;
    capabilityArgs.push(args);
    return { body: [{ preview_v: 1, recipient_id: ME.id, session_id: SESSION, device_id: DEVICE, preview_level: level }] };
  } });
  const panel = await openPreview(page);
  await expect(panel.getByRole("radio", { name: "Имя отправителя", exact: true })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "Имя и сообщение", exact: true })).toBeEnabled();
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.screenshot({ path: info.outputPath("preview-ready.png") });
  const writes: unknown[] = [];
  await page.route("**/rest/v1/notification_preview_preferences?**", async route => {
    expect(route.request().method()).toBe("POST");
    const row = route.request().postDataJSON();
    writes.push(row);
    expect(row).toEqual({ user_id: ME.id, preview_level: "message" });
    level = row.preview_level;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([row]) });
  });
  await panel.getByRole("radio", { name: "Имя и сообщение", exact: true }).click();
  await expect(panel.getByRole("radio", { name: "Имя и сообщение", exact: true })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "Имя и сообщение", exact: true })).toBeEnabled();
  expect(writes).toHaveLength(1);
  expect(capabilityArgs.length).toBeGreaterThanOrEqual(3);
  expect(capabilityArgs.every(args => JSON.stringify(args) === JSON.stringify({ p_device_id: DEVICE }))).toBe(true);
});
}

test("uninstalled capability RPC exposes generic device status, not inferred saved none", async ({ page }) => {
  await nativeShell(page, true);
  let calls = 0;
  await openSettingsScreen(page, { rpc(name) {
    if (name !== "native_message_preview_capability") return undefined;
    calls++;
    return { status: 404, body: { code: "PGRST202", message: "fixture missing function" } };
  } });
  const row = page.getByTestId("native-message-preview-setting");
  await expect(row).toContainText("Общий текст на этом устройстве");
  expect(calls).toBeGreaterThan(0);
  await expect(row.getByRole("radio")).toHaveCount(0);
  await expect(row).not.toContainText("Для аккаунта");
  await expect(row).not.toContainText("Последний подтверждённый выбор");
});

test("ordinary browser Settings stays unchanged and never calls preview capability", async ({ page }) => {
  let calls = 0;
  await openSettingsScreen(page, { rpc(name) { if (name === "native_message_preview_capability") calls++; return undefined; } });
  await expect(page.getByTestId("native-message-preview-setting")).toHaveCount(0);
  expect(calls).toBe(0);
});

test("actual Settings distinguishes pending capability, saving and last confirmed account choice", async ({ page }) => {
  await nativeShell(page, true);
  await page.addInitScript(() => {
    const wire = window as unknown as Record<string, unknown>;
    wire.previewNativeGate = new Promise<void>(resolve => { wire.releasePreviewNative = resolve; });
  });
  let level = "sender";
  await openSettingsScreen(page, { rpc(name) {
    return name === "native_message_preview_capability"
      ? { body: [{ preview_v: 1, recipient_id: ME.id, session_id: SESSION, device_id: DEVICE, preview_level: level }] }
      : undefined;
  } });
  const row = page.getByTestId("native-message-preview-setting");
  await expect(row).toContainText("Проверка…");
  await expect(row.getByRole("radio")).toHaveCount(0);
  await page.evaluate(() => ((window as unknown as Record<string, () => void>).releasePreviewNative)());
  const panel = await openPreview(page);
  await expect(panel.getByRole("radio", { name: "Имя отправителя", exact: true })).toBeChecked();
  let finishWrite!: () => void;
  const write = new Promise<void>(resolve => { finishWrite = resolve; });
  await page.route("**/rest/v1/notification_preview_preferences?**", async route => {
    const consent = route.request().postDataJSON();
    await write;
    level = consent.preview_level;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([consent]) });
  });
  const height = await row.evaluate(element => element.getBoundingClientRect().height);
  await panel.getByRole("radio", { name: "Имя и сообщение", exact: true }).click();
  await expect(row).toContainText("Сохранение…");
  await expect(row.getByRole("radio", { name: "Имя отправителя", exact: true })).toBeChecked();
  await expect(row.getByRole("radio")).toHaveCount(3);
  for (const name of ["Общий текст", "Имя отправителя", "Имя и сообщение"]) {
    await expect(row.getByRole("radio", { name, exact: true })).toBeDisabled();
  }
  expect(Math.abs(await row.evaluate(element => element.getBoundingClientRect().height) - height)).toBeLessThanOrEqual(2);
  finishWrite();
  await expect(row.getByRole("radio", { name: "Имя и сообщение", exact: true })).toBeChecked();
});
