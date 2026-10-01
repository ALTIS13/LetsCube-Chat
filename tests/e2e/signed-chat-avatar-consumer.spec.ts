import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  FIXTURE_HOST,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

const ME = person("a1111111-1111-4111-8111-000000000208", "Fixture Reader");
const GROUP = "a2222222-2222-4222-8222-000000000208";
const ORIGINAL = "chat-avatars/synthetic-group.png";
const SMALL = "variants/chats/synthetic-group/avatar_128.webp";
const LARGE = "variants/chats/synthetic-group/avatar_256.webp";
const AT = "2026-10-01T00:00:00.000Z";
const SIGNED_ORIGINAL = `${FIXTURE_HOST}/storage/v1/object/sign/media/chat-avatars/synthetic-group.png?token=synthetic-avatar`;
const SIGNED_SMALL = `${FIXTURE_HOST}/storage/v1/object/sign/media/variants/chats/synthetic-group/avatar_128.webp?token=synthetic-avatar&v=20261001000000`;
const SIGNED_LARGE = `${FIXTURE_HOST}/storage/v1/object/sign/media/variants/chats/synthetic-group/avatar_256.webp?token=synthetic-avatar&v=20261001000000`;

type Scenario = "ready" | "no-variants" | "broken-variants" | "refused";
type Evidence = {
  publicRequests: string[];
  signedLoads: string[];
  signedPaths: string[];
  variantQueries: URL[];
  pageErrors: string[];
  refusedReplies: number;
  rewrittenModules: number;
};

// Opt-in omission controls rewrite only the browser's real compiled consumer.
// They do not alter the component, hook/store, or another worker's Vite server.
const omission = process.env.KUB_CHAT_AVATAR_OMISSION;
if (omission && omission !== "srcset" && omission !== "signed-original") {
  throw new Error("KUB_CHAT_AVATAR_OMISSION must be srcset or signed-original");
}

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });
// A fresh isolated Vite cache can take over 20s to compile the app's graph.
// Warm only its modules in a disposable empty fixture, never the group's data
// or stores: every acceptance case below still starts in a new browser context.
test.beforeAll(async ({ browser, request, baseURL }) => {
  test.setTimeout(90_000);
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  await requireFixtureServer(request);
  const client = await request.get("/src/lib/supabase/client.ts");
  expect(await client.text()).toContain("playwright-public-fixture");
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    await page.routeWebSocket(/.*/, (socket) => socket.close());
    await openFixture(page, { me: ME, chats: [], memberships: [], messages: [] });
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 75_000 });
  } finally {
    await context.close();
  }
});
test.beforeEach(async ({ page, request, baseURL }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  await requireFixtureServer(request);
  const client = await request.get("/src/lib/supabase/client.ts");
  expect(await client.text(), "the server must use only the synthetic anon key").toContain(
    "playwright-public-fixture",
  );
  await page.routeWebSocket(/.*/, (socket) => socket.close());
});

function picture(width: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 128 128"><rect width="128" height="128" fill="#4ecdc4"/><path d="M0 0H64V128H0Z" fill="#ff6b6b"/><text x="64" y="82" text-anchor="middle" font-family="Arial" font-size="48" font-weight="bold" fill="#17212b">SG</text></svg>`;
}

async function mountAvatar(page: Page, scenario: Scenario, theme: "dark" | "light") {
  const evidence: Evidence = {
    publicRequests: [], signedLoads: [], signedPaths: [], variantQueries: [],
    pageErrors: [], refusedReplies: 0, rewrittenModules: 0,
  };
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  // Count attempts before routes answer: even an aborted public load is a leak.
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/storage/v1/object/public/")) {
      evidence.publicRequests.push(request.url());
    }
    if (request.method() === "GET" && url.pathname.startsWith("/storage/v1/object/sign/")) {
      evidence.signedLoads.push(request.url());
    }
  });
  await openFixture(page, { me: ME, theme, chats: [], memberships: [], messages: [] });

  if (omission) {
    await page.route("**/src/components/ui/ChatAvatar.tsx**", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const needle = omission === "srcset"
        ? "      srcSet,"
        : "const resolvedOriginalUrl = useAvatarMediaUrl(originalUrl);";
      expect(source.split(needle).length - 1, "the omission must hit exactly one real consumer").toBe(1);
      evidence.rewrittenModules++;
      await route.fulfill({
        response,
        body: source.replace(needle, omission === "srcset" ? "" : "const resolvedOriginalUrl = originalUrl;"),
      });
    });
  }

  await page.route(`${FIXTURE_HOST}/rest/v1/media_variants**`, async (route) => {
    const url = new URL(route.request().url());
    // Other app surfaces are not allowed to seed this component's answer.
    if (url.searchParams.get("chat_id") !== `in.(${GROUP})`) {
      await route.fulfill({ json: [] });
      return;
    }
    evidence.variantQueries.push(url);
    await route.fulfill({
      json: scenario === "no-variants" ? [] : [
        {
          id: "a6666666-6666-4666-8666-000000000128", chat_id: GROUP,
          profile_id: null, message_id: null, variant_kind: "avatar_128",
          variant_bucket: "media", variant_path: SMALL, width: 128, height: 128,
          status: "ready", error_code: null, updated_at: AT,
        },
        {
          id: "a6666666-6666-4666-8666-000000000256", chat_id: GROUP,
          profile_id: null, message_id: null, variant_kind: "avatar_256",
          variant_bucket: "media", variant_path: LARGE, width: 256, height: 256,
          status: "ready", error_code: null, updated_at: AT,
        },
      ],
    });
  });
  await page.route(`${FIXTURE_HOST}/storage/v1/object/sign/media`, async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as { paths: string[]; expiresIn: number };
    expect(body.expiresIn).toBe(3600);
    evidence.signedPaths.push(...body.paths);
    await route.fulfill({
      json: body.paths.map((path) => scenario === "refused"
        ? { path, signedURL: null, error: "Object not found" }
        : { path, signedURL: `/object/sign/media/${path}?token=synthetic-avatar`, error: null }),
    });
    if (scenario === "refused") evidence.refusedReplies += body.paths.length;
  });
  await page.route(`${FIXTURE_HOST}/storage/v1/object/sign/media/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice("/storage/v1/object/sign/media/".length);
    expect(url.searchParams.get("token")).toBe("synthetic-avatar");
    expect([ORIGINAL, SMALL, LARGE]).toContain(path);
    await route.fulfill(scenario === "broken-variants" && path !== ORIGINAL
      ? { status: 404, body: "" }
      : { contentType: "image/svg+xml", body: picture(path === LARGE ? 256 : path === SMALL ? 128 : 512) });
  });
  // The bucket is still public in production. A public omission must be caught
  // even when its image loads successfully, not hidden by a fixture's 404.
  await page.route(`${FIXTURE_HOST}/storage/v1/object/public/**`, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: picture(512) }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
  await page.evaluate(async ({ group, original }) => {
    const main = await fetch("/src/main.tsx").then((response) => response.text());
    const imports = [...main.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    const reactUrl = imports.find((url) => url.includes("/react.js?"));
    const domUrl = imports.find((url) => url.includes("/react-dom_client.js?"));
    if (!reactUrl || !domUrl) throw new Error("Missing Vite React runtime URLs");
    const [react, dom, consumer, media] = await Promise.all([
      import(/* @vite-ignore */ reactUrl),
      import(/* @vite-ignore */ domUrl),
      import("/src/components/ui/ChatAvatar.tsx"),
      import("/src/lib/media/mediaUrl.ts"),
    ]);
    if (media.mediaUrlMode() !== "signed-only") throw new Error("This spec requires a signed-only synthetic server");
    const React = react.default ?? react;
    const { createRoot } = dom.default ?? dom;
    const app = document.getElementById("root");
    if (!app) throw new Error("Missing application root");
    app.style.display = "none";
    const host = document.createElement("section");
    host.dataset.testid = "signed-chat-avatar-consumer";
    Object.assign(host.style, {
      display: "flex", gap: "24px", padding: "32px", alignItems: "center",
      background: "var(--kub-bg)", minHeight: "160px",
    });
    document.body.appendChild(host);
    // No avatarVariant prop: the actual consumer must find the group's rows,
    // resolve their signatures and re-render from its real subscriptions.
    createRoot(host).render(React.createElement(React.StrictMode, null,
      ...(["md", "xl"] as const).map((size) => React.createElement("div", {
        key: size, "data-testid": `group-avatar-${size}`,
      }, React.createElement(consumer.ChatAvatar, {
        chat: { id: group, type: "group", name: "Signed Group", avatar_url: original }, size,
      }))),
    ));
  }, { group: GROUP, original: `${FIXTURE_HOST}/storage/v1/object/public/media/${ORIGINAL}?v=old-column` });
  await expect(page.getByTestId("signed-chat-avatar-consumer")).toBeVisible();
  return evidence;
}

async function painted(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node) => {
    const image = node as HTMLImageElement;
    return image.complete && image.naturalWidth > 0;
  })).toBe(true);
}

async function accepted(page: Page, evidence: Evidence, variants: boolean) {
  await expect.poll(() => evidence.signedPaths.includes(ORIGINAL)).toBe(true);
  if (variants) {
    await expect.poll(() => [...new Set(evidence.signedPaths)].sort()).toEqual([
      "chat-avatars/synthetic-group.png",
      "variants/chats/synthetic-group/avatar_128.webp",
      "variants/chats/synthetic-group/avatar_256.webp",
    ]);
  } else {
    expect([...new Set(evidence.signedPaths)]).toEqual(["chat-avatars/synthetic-group.png"]);
  }
  expect(evidence.variantQueries).toHaveLength(1);
  expect(evidence.variantQueries[0].searchParams.get("message_id")).toBe("is.null");
  expect(evidence.variantQueries[0].searchParams.get("status")).toBe("eq.ready");
  expect(evidence.publicRequests, "even refused signing must never request a public URL").toEqual([]);
  expect(evidence.pageErrors).toEqual([]);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  if (omission) expect(evidence.rewrittenModules).toBe(1);
}

for (const width of [390, 1440]) {
  for (const theme of ["dark", "light"] as const) {
    test.describe(`${width} ${theme}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      });

      test("ready group variants reach the mounted src and srcSet", async ({ page }, testInfo) => {
        const evidence = await mountAvatar(page, "ready", theme);
        const small = page.getByTestId("group-avatar-md").locator("img");
        const large = page.getByTestId("group-avatar-xl").locator("img");
        await expect(small).toHaveAttribute("src", SIGNED_SMALL);
        await expect(large).toHaveAttribute("src", SIGNED_LARGE);
        await expect(small).toHaveAttribute("srcset", `${SIGNED_SMALL} 128w, ${SIGNED_LARGE} 256w`);
        await expect(large).toHaveAttribute("srcset", `${SIGNED_SMALL} 128w, ${SIGNED_LARGE} 256w`);
        await expect(small).toHaveAttribute("sizes", "48px");
        await expect(large).toHaveAttribute("sizes", "80px");
        await painted(small);
        await painted(large);
        expect(evidence.signedLoads.some((url) => url.includes("/variants/chats/synthetic-group/"))).toBe(true);
        await accepted(page, evidence, true);
        await page.getByTestId("signed-chat-avatar-consumer").screenshot({ path: testInfo.outputPath(`ready-${width}-${theme}.png`) });
      });

      test("no group variants falls back to the signed original", async ({ page }, testInfo) => {
        const evidence = await mountAvatar(page, "no-variants", theme);
        for (const size of ["md", "xl"]) {
          const image = page.getByTestId(`group-avatar-${size}`).locator("img");
          await painted(image);
          expect(evidence.publicRequests, "a successfully decoded public avatar is still forbidden").toEqual([]);
          await expect(image).toHaveAttribute("src", SIGNED_ORIGINAL);
          await expect(image).not.toHaveAttribute("srcset", /.+/);
        }
        expect(evidence.signedLoads.some((url) => url.includes("/chat-avatars/synthetic-group.png"))).toBe(true);
        await accepted(page, evidence, false);
        await page.getByTestId("signed-chat-avatar-consumer").screenshot({ path: testInfo.outputPath(`original-${width}-${theme}.png`) });
      });

      test("broken signed variants fall back without retaining srcSet", async ({ page }, testInfo) => {
        const evidence = await mountAvatar(page, "broken-variants", theme);
        for (const size of ["md", "xl"]) {
          const image = page.getByTestId(`group-avatar-${size}`).locator("img");
          await expect(image).toHaveAttribute("src", SIGNED_ORIGINAL);
          await expect(image).not.toHaveAttribute("srcset", /.+/);
          await painted(image);
        }
        expect(evidence.signedLoads.some((url) => url.includes("/variants/chats/synthetic-group/"))).toBe(true);
        expect(evidence.signedLoads.some((url) => url.includes("/chat-avatars/synthetic-group.png"))).toBe(true);
        await accepted(page, evidence, true);
        await page.getByTestId("signed-chat-avatar-consumer").screenshot({ path: testInfo.outputPath(`broken-variant-${width}-${theme}.png`) });
      });

      test("signing refusal leaves the mounted monogram and zero public requests", async ({ page }, testInfo) => {
        const evidence = await mountAvatar(page, "refused", theme);
        await expect.poll(() => evidence.refusedReplies).toBe(3);
        // Let both the signature notification and React effects reach the DOM.
        await page.evaluate(() => new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ));
        for (const size of ["md", "xl"]) {
          const avatar = page.getByTestId(`group-avatar-${size}`);
          await expect(avatar.locator("img")).toHaveCount(0);
          await expect(avatar).toHaveText("SG");
          await expect(avatar).toBeVisible();
        }
        expect(evidence.signedLoads).toEqual([]);
        await accepted(page, evidence, true);
        await page.getByTestId("signed-chat-avatar-consumer").screenshot({ path: testInfo.outputPath(`refused-${width}-${theme}.png`) });
      });
    });
  }
}
