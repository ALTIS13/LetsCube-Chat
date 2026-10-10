import { expect, test, type Locator, type Page } from "@playwright/test";
import { calibrateQaChoicePorts, choiceWireControl, choiceWireSnapshot, openChoiceSettings, requireLocalChoiceFixture } from "./helpers/nativeMessagePreviewUserChoiceFixture";

// Only invented Settings elements are explicitly captured. No automatic failure captures.
test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });
test.describe.configure({ retries: 0 });
test.beforeEach(async ({ page, request, baseURL }) => {
  await requireLocalChoiceFixture(page, request, baseURL);
});

const LABELS = ["Общий текст", "Имя отправителя", "Имя и сообщение"] as const;
async function openRadios(page: Page) {
  const disclosure = page.getByTestId("settings-open-message-preview");
  await expect(disclosure, "REAL_SETTINGS_QA_CHOICE_AVAILABLE_WITHOUT_PROTOCOL1").toBeVisible();
  await disclosure.click();
  const row = page.getByTestId("native-message-preview-setting");
  await expect(row.getByRole("radio")).toHaveCount(3);
  return row;
}
async function checked(row: Locator, name: string, enabled = true) {
  await expect(row.getByRole("radio", { name, exact: true })).toBeChecked();
  for (const label of LABELS) {
    if (enabled) await expect(row.getByRole("radio", { name: label, exact: true })).toBeEnabled();
    else await expect(row.getByRole("radio", { name: label, exact: true })).toBeDisabled();
  }
}
async function geometry(row: Locator, width: number) {
  await row.scrollIntoViewIfNeeded();
  const box = await row.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, overflow: element.scrollWidth > element.clientWidth + 1 };
  });
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(width);
  expect(box.overflow).toBe(false);
}

test("ordinary protocol0 control: generic status and zero preference mutations", async ({ page }) => {
  const fixture = await openChoiceSettings(page, { armed: false });
  await calibrateQaChoicePorts(page, false);
  await expect(fixture.row).toContainText("Общий текст на этом устройстве");
  await expect(fixture.row.getByRole("radio")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.rpcArgs).toEqual([]);
  const wire = await choiceWireSnapshot(page);
  expect(wire.protocol).toBe(0);
  expect(wire.begins).toBe(0);
  expect(wire.confirms).toBe(0);
});

test("real Settings QA choice absent; ordinary protocol0 closed", async ({ page }) => {
  const fixture = await openChoiceSettings(page);
  await calibrateQaChoicePorts(page);
  const row = await openRadios(page);
  await checked(row, "Общий текст");
  expect(fixture.writes).toEqual([]);
  expect(fixture.rpcArgs.length).toBeGreaterThanOrEqual(1);
  const wire = await choiceWireSnapshot(page);
  expect(wire.protocol).toBe(0);
  expect(wire.contexts).toBeGreaterThanOrEqual(2);
  expect(wire.begins).toBe(0);
  expect(wire.confirms).toBe(0);
});

for (const width of [1440, 390]) for (const theme of ["dark", "light"] as const) {
  test(`invented Settings choice sequence and retained saving radios ${width} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const fixture = await openChoiceSettings(page, { theme });
    const row = await openRadios(page);
    await checked(row, "Общий текст");
    await geometry(row, width);
    await row.screenshot({ path: info.outputPath(`invented-qa-ready-none-${width}-${theme}.png`) });
    const rpcBefore = fixture.rpcArgs.length;
    const release = fixture.holdNextWrite();
    try {
      await row.getByRole("radio", { name: "Имя отправителя", exact: true }).click();
      await expect.poll(() => fixture.writes.length).toBe(1);
      await expect(row).toContainText("Сохранение…");
      await checked(row, "Общий текст", false);
      const pending = await choiceWireSnapshot(page);
      expect(pending.begins).toBe(1);
      expect(pending.confirms).toBe(0);
      expect(pending.pending).not.toBeNull();
      expect(pending.confirmed).toBe("none");
      await geometry(row, width);
      await row.screenshot({ path: info.outputPath(`invented-qa-saving-sender-${width}-${theme}.png`) });
    } finally { release(); }
    await checked(row, "Имя отправителя");
    expect(fixture.rpcArgs.length - rpcBefore).toBe(2);
    expect((await choiceWireSnapshot(page)).confirmed).toBe("sender");
    await row.getByRole("radio", { name: "Имя и сообщение", exact: true }).click();
    await checked(row, "Имя и сообщение");
    expect((await choiceWireSnapshot(page)).confirmed).toBe("message");
    await geometry(row, width);
    await row.screenshot({ path: info.outputPath(`invented-qa-ready-message-${width}-${theme}.png`) });
    await row.getByRole("radio", { name: "Общий текст", exact: true }).click();
    await checked(row, "Общий текст");
    expect(fixture.writes).toEqual(["sender", "message", "none"]);
    expect(fixture.savedServerChoice()).toBe("none");
    expect(fixture.rpcArgs.length - rpcBefore).toBe(6);
    const done = await choiceWireSnapshot(page);
    expect(done.begins).toBe(3);
    expect(done.confirms).toBe(3);
    expect(done.confirmed).toBe("none");
    expect(done.protocol).toBe(0);
    await geometry(row, width);
    await row.screenshot({ path: info.outputPath(`invented-qa-final-none-${width}-${theme}.png`) });
  });
}

test("native begin refusal prevents pre-save capability and owner-row dispatch", async ({ page }) => {
  const fixture = await openChoiceSettings(page);
  const row = await openRadios(page);
  await checked(row, "Общий текст");
  const rpcBefore = fixture.rpcArgs.length;
  await choiceWireControl(page, "refuseNextBegin");
  await row.getByRole("radio", { name: "Имя отправителя", exact: true }).click();
  await expect(row.getByRole("button", { name: "Повторить", exact: true })).toBeVisible();
  expect(fixture.writes).toEqual([]);
  expect(fixture.rpcArgs.length - rpcBefore).toBe(0);
  const wire = await choiceWireSnapshot(page);
  expect(wire.begins).toBe(1);
  expect(wire.confirms).toBe(0);
  expect(wire.confirmed).toBe("none");
});

test("lost confirm ACK: late applied reply cannot republish or replay", async ({ page }) => {
  const fixture = await openChoiceSettings(page);
  const row = await openRadios(page);
  await checked(row, "Общий текст");
  await choiceWireControl(page, "holdConfirm");
  try {
    await row.getByRole("radio", { name: "Имя отправителя", exact: true }).click();
    await expect.poll(async () => (await choiceWireSnapshot(page)).confirms).toBe(1);
    await checked(row, "Общий текст", false);
    await expect(row).toContainText("Сохранение…");
    await expect.poll(async () => (await choiceWireSnapshot(page)).terminal).toBe(true);
    expect(fixture.savedServerChoice()).toBe("sender");
    expect(fixture.writes).toEqual(["sender"]);
    expect((await choiceWireSnapshot(page)).confirmed).toBe("none");
  } finally { await choiceWireControl(page, "releaseConfirm"); }
  await expect(row.getByRole("button", { name: "Повторить", exact: true })).toBeVisible();
  await expect(row.locator('input[type="radio"][value="sender"]:checked')).toHaveCount(0);
  await page.getByTestId("settings-close").click();
  expect(fixture.writes).toEqual(["sender"]);
  expect((await choiceWireSnapshot(page)).confirms).toBe(1);
});

test("disposal during held confirm erases captured intent without late Settings publication", async ({ page }) => {
  const fixture = await openChoiceSettings(page);
  const row = await openRadios(page);
  await checked(row, "Общий текст");
  await choiceWireControl(page, "holdConfirm");
  try {
    await row.getByRole("radio", { name: "Имя отправителя", exact: true }).click();
    await expect.poll(async () => (await choiceWireSnapshot(page)).confirms).toBe(1);
    await page.getByTestId("settings-close").click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await choiceWireSnapshot(page)).terminal).toBe(true);
  } finally { await choiceWireControl(page, "releaseConfirm"); }
  expect(fixture.writes).toEqual(["sender"]);
  expect(fixture.savedServerChoice()).toBe("sender");
  expect((await choiceWireSnapshot(page)).confirmed).toBe("none");
});

test("failed final none preserves server residue instead of inventing a saved ACK", async ({ page }) => {
  const fixture = await openChoiceSettings(page);
  const row = await openRadios(page);
  await checked(row, "Общий текст");
  await row.getByRole("radio", { name: "Имя и сообщение", exact: true }).click();
  await checked(row, "Имя и сообщение");
  fixture.refuseNextWrite();
  await row.getByRole("radio", { name: "Общий текст", exact: true }).click();
  await expect(row.getByRole("button", { name: "Повторить", exact: true })).toBeVisible();
  expect(fixture.writes).toEqual(["message", "none"]);
  expect(fixture.savedServerChoice()).toBe("message");
  await expect(row.locator('input[type="radio"][value="none"]:checked')).toHaveCount(0);
  const wire = await choiceWireSnapshot(page);
  expect(wire.begins).toBe(2);
  expect(wire.confirms).toBe(1);
  expect(wire.confirmed).toBe("none");
});

test("fixed context expiry during held write blocks post-save native confirmation", async ({ page }) => {
  await page.clock.install();
  const fixture = await openChoiceSettings(page);
  const row = await openRadios(page);
  await checked(row, "Общий текст");
  const release = fixture.holdNextWrite();
  try {
    await row.getByRole("radio", { name: "Имя отправителя", exact: true }).click();
    await expect.poll(() => fixture.writes.length).toBe(1);
    await checked(row, "Общий текст", false);
    await page.clock.fastForward(120_000);
    expect((await choiceWireSnapshot(page)).terminal).toBe(true);
  } finally { release(); }
  await expect(row).not.toContainText("Сохранение…");
  expect(fixture.writes).toEqual(["sender"]);
  expect(fixture.savedServerChoice()).toBe("sender");
  expect((await choiceWireSnapshot(page)).confirms).toBe(0);
  expect((await choiceWireSnapshot(page)).confirmed).toBe("none");
  await expect.poll(async () => (await choiceWireSnapshot(page)).retireAcks,
    "EXACT_RETIRE_ACK_SURVIVES_CONTEXT_EXPIRY").toBe(1);
});
