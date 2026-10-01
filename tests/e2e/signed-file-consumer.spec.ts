import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURE_HOST, chat, membership, message, openChat, openFixture, person, requireFixtureServer,
} from "./helpers/messageActionsFixture";

const AT = "2026-10-01T09:00:00.000Z";
const ME = person("de111111-1111-4111-8111-000000000001", "File QA");
const SENDER = person("de111111-1111-4111-8111-000000000002", "Document QA");
const CHAT = "de222222-2222-4222-8222-000000000001";
const NAME = "Signed document QA";
const PATH = `${SENDER.id}/handover.txt`;
const FILE = "handover.txt";
const BYTES = "Synthetic signed document\nSecond line\n";
const PUBLIC = `${FIXTURE_HOST}/storage/v1/object/public/media/${PATH}`;
const SIGNED = `${FIXTURE_HOST}/storage/v1/object/sign/media/${PATH}?token=fixture-only`;

test.use({ serviceWorkers: "block", trace: "off", video: "off" });
const omission = process.env.KUB_FILE_CONSUMER_OMISSION;
if (omission && !["path", "refusal", "focus", "background"].includes(omission)) throw new Error("Unknown FILE omission control");
test.beforeEach(async ({ page, request }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  await requireFixtureServer(request);
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  if (omission) {
    await page.route(omission === "background" ? "**/src/hooks/useMessages.ts**"
      : omission === "focus" ? "**/src/components/chat/FileMessageRow.tsx**" : "**/src/components/chat/MessageBubble.tsx**", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const needle = omission === "path" ? /hasOriginalMedia \|\| outgoingPlaceholder/g
        : omission === "refusal" ? /(?<=url: hasOriginalMedia \? originalUrl \?\? null : null,\s*)unavailable: originalUnavailable/g
        : omission === "background" ? /\(!background \|\| !holdsVerifiedBoundary\) && needsBoundaryRead/g : /returnTo: fileRef.current/g;
      expect([...source.matchAll(needle)]).toHaveLength(1);
      await route.fulfill({ response, body: source.replace(needle, omission === "path"
        ? "message.media_url || outgoingPlaceholder" : omission === "refusal" ? "unavailable: false"
        : omission === "background" ? "needsBoundaryRead" : "returnTo: null") });
    });
  }
});
async function boot(page: Page, theme: "light" | "dark", legacyUrl: boolean, refused: boolean, signingGate?: Promise<void>) {
  const storageRequests: { method: string; url: string; body: unknown }[] = [];
  await openFixture(page, {
    me: ME, theme, people: [SENDER],
    chats: [chat(CHAT, "group", NAME, AT)],
    memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, SENDER, "member", AT)],
    messages: [message("de555555-5555-4555-8555-000000000001", CHAT, SENDER, FILE, AT, {
      type: "file", media_bucket: "media", media_path: PATH,
      media_url: legacyUrl ? PUBLIC : null,
      media_metadata: { size_bytes: Buffer.byteLength(BYTES), mime_type: "text/plain", file_name: FILE },
    })],
  });
  await page.route(`${FIXTURE_HOST}/storage/v1/**`, async (route) => {
    const request = route.request();
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { /* GET has no JSON body. */ }
    storageRequests.push({ method: request.method(), url: request.url(), body });
    if (request.method() === "POST" && request.url() === `${FIXTURE_HOST}/storage/v1/object/sign/media`) {
      const payload = body as { paths?: string[] };
      if (signingGate) await signingGate;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(
        (payload.paths ?? []).map((path) => ({ path, error: refused ? "Object not found" : null,
          signedURL: refused ? null : `/object/sign/media/${path}?token=fixture-only` })),
      ) });
    }
    if (request.url() === SIGNED && !refused) {
      return route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: BYTES });
    }
    // A public fallback is a detectable failure, never a successful fixture.
    return route.fulfill({ status: 403, contentType: "text/plain", body: "denied" });
  });
  await openChat(page, NAME, FILE);
  expect(await page.evaluate(async () => (await import("/src/lib/media/mediaUrl.ts")).mediaUrlMode())).toBe("signed-only");
  return storageRequests;
}

for (const theme of ["dark", "light"] as const) {
  for (const answer of ["unchanged", "cleared", "refused", "hidden-refused", "history-refused"] as const) {
    test(`${theme}: active document survives pending history verification, then applies ${answer}`, async ({ page }) => {
      await boot(page, theme, false, false);
      const file = page.getByTestId("file-message");
      await expect(file).toBeEnabled();
      await file.click();
      const viewer = page.getByTestId("document-viewer");
      await expect(viewer.getByTestId("document-viewer-text")).toHaveText(BYTES);
      let release!: () => void;
      let releaseHistory!: () => void;
      let started = false;
      let historyStarted = false;
      let rechecking = false;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const historyGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
      await page.route(`${FIXTURE_HOST}/rest/v1/messages**`, async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== "GET" || !rechecking || url.searchParams.get("order") !== "created_at.desc,id.desc") return route.fallback();
        if (answer === "cleared") {
          expect(url.searchParams.get("created_at")).toBe("gt.2026-10-01T09:01:00.000Z");
          historyStarted = true;
          await historyGate;
          return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        if (answer === "history-refused") return route.fulfill({ status: 403, contentType: "application/json",
          body: JSON.stringify({ code: "42501", message: "synthetic history refusal" }) });
        return route.fallback();
      });
      await page.route(`${FIXTURE_HOST}/rest/v1/message_hidden_for_users**`, async (route) => {
        if (answer !== "hidden-refused" || !rechecking) return route.fallback();
        return route.fulfill({ status: 403, contentType: "application/json",
          body: JSON.stringify({ code: "42501", message: "synthetic hidden-ID refusal" }) });
      });
      await page.route(`${FIXTURE_HOST}/rest/v1/chat_members**`, async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get("select") !== "cleared_at") return route.fallback();
        started = true;
        await gate;
        await route.fulfill({ status: answer === "refused" ? 403 : 200, contentType: "application/json",
          body: JSON.stringify(answer === "refused" ? { code: "42501", message: "synthetic refusal" }
            : { cleared_at: answer === "cleared" ? "2026-10-01T09:01:00.000Z" : null }) });
      });
      rechecking = true;
      await page.evaluate(async (chatId) => {
        const { clearedAtCache } = await import("/src/lib/clearedAtCache.ts");
        clearedAtCache.evictChat(chatId);
        window.dispatchEvent(new CustomEvent("kub:chats-refresh", { detail: { reason: "message-realtime", chatId } }));
      }, CHAT);
      await expect.poll(() => started).toBe(true);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(viewer.getByTestId("document-viewer-text")).toHaveText(BYTES);
      const answered = page.waitForResponse((response) => new URL(response.url()).searchParams.get("select") === "cleared_at");
      release();
      await answered;
      if (answer === "cleared") {
        await expect.poll(() => historyStarted).toBe(true);
        await expect(viewer).toHaveCount(0);
        await expect(file).toHaveCount(0);
        releaseHistory();
      }
      if (answer === "unchanged") {
        await expect(viewer.getByTestId("document-viewer-text")).toHaveText(BYTES);
        await viewer.getByTestId("document-viewer-close").click();
        await expect(file).toBeFocused();
      } else {
        await expect(file).toHaveCount(0);
        await expect(viewer).toHaveCount(0);
        if (answer !== "cleared") await expect(page.getByText("Историю не удалось проверить")).toBeVisible();
      }
    });
  }
  test(`${theme}: settling a refused file does not resize its row`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const requests = await boot(page, theme, false, true, gate);
    const file = page.getByTestId("file-message");
    await expect(file).toHaveAttribute("aria-busy", "true");
    await expect(file.locator("svg.animate-spin")).toHaveCount(1);
    const before = await file.boundingBox();
    release();
    await expect(page.getByTestId("file-message-unavailable")).toBeVisible();
    const after = await file.boundingBox();
    expect(Math.abs(after!.height - before!.height)).toBeLessThan(0.5);
    await expect(file).toHaveAttribute("aria-busy", "false");
    expect(requests).toHaveLength(1);
  });
  for (const legacyUrl of [false, true]) {
    test(`${theme}: ${legacyUrl ? "legacy plus path" : "path-only"} file previews and downloads only signed bytes`, async ({ page }) => {
      const requests = await boot(page, theme, legacyUrl, false);
      const file = page.getByTestId("file-message").filter({ hasText: FILE });
      await expect(file).toBeVisible();
      await expect(file).toBeEnabled();
      await expect(file.getByTestId("file-message-kind")).toHaveText("38 Б · TXT");
      await page.screenshot({ path: `output/d208-file-${theme}-${legacyUrl ? "legacy" : "path"}-${page.viewportSize()!.width}.png` });
      await file.click();
      const viewer = page.getByTestId("document-viewer");
      await expect(viewer.getByTestId("document-viewer-text")).toHaveText(BYTES);
      await page.screenshot({ path: `output/d208-document-${theme}-${legacyUrl ? "legacy" : "path"}-${page.viewportSize()!.width}.png` });
      const pending = page.waitForEvent("download");
      await viewer.getByRole("button", { name: "Скачать", exact: true }).click();
      const download = await pending;
      expect(download.suggestedFilename()).toBe(FILE);
      expect(await download.failure()).toBeNull();
      expect(await readFile((await download.path())!, "utf8")).toBe(BYTES);
      await viewer.getByTestId("document-viewer-close").click();
      await expect(file).toBeFocused();
      expect(requests.filter((r) => r.method === "POST")).toEqual([{
        method: "POST", url: `${FIXTURE_HOST}/storage/v1/object/sign/media`,
        body: { paths: [PATH], expiresIn: 3600 },
      }]);
      expect(requests.filter((r) => r.method === "GET").map((r) => r.url)).toEqual([SIGNED, SIGNED]);
      expect(requests.some((r) => r.url.includes("/object/public/"))).toBe(false);
    });

    test(`${theme}: ${legacyUrl ? "legacy plus path" : "path-only"} refused file stops loading without public fallback`, async ({ page }) => {
      const requests = await boot(page, theme, legacyUrl, true);
      const file = page.getByTestId("file-message").filter({ hasText: FILE });
      await expect(file).toBeVisible();
      await expect(file).toBeDisabled();
      await expect(page.getByTestId("file-message-unavailable")).toHaveText("Файл недоступен");
      await expect(file).toHaveAttribute("aria-label", "Файл недоступен: handover.txt");
      await expect(file).toHaveAttribute("aria-busy", "false");
      await expect(file.locator("svg.animate-spin")).toHaveCount(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toEqual({ method: "POST", url: `${FIXTURE_HOST}/storage/v1/object/sign/media`,
        body: { paths: [PATH], expiresIn: 3600 } });
      await page.screenshot({ path: `output/d208-file-refused-${theme}-${legacyUrl ? "legacy" : "path"}-${page.viewportSize()!.width}.png` });
    });
  }
}
