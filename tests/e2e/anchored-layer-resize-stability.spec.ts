import { expect, type Page, test } from "@playwright/test";
import {
  chat,
  FIXTURE_HOST,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

const AT = "2026-09-20T09:00:00.000Z";
const ME = person("41111111-1111-4111-8111-000000000011", "Fixture Reader", "fixture_reader");
const PEER = {
  ...person("41111111-1111-4111-8111-000000000012", "Fixture Profile", "fixture_profile"),
  bio: "Fictional profile for the glass audit. A long description expands the compact card after the pending profile request completes. No real account or message is used.",
};
const GROUP = "42222222-2222-4222-8222-000000000011";
type Box = { top: number; bottom: number; left: number; right: number };
type Probe = {
  kind: "AnchoredLayer" | "BesideLayer";
  anchor: Box;
  avoid?: Box;
  width: number;
  height: number;
  animated?: boolean;
  observerUnavailable?: boolean;
};

test.use({ trace: "off", video: "off", serviceWorkers: "block" });
test.beforeEach(async ({ page, request }) => {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  await requireFixtureServer(request);
  await page.routeWebSocket(/.*/, (socket) => socket.close());
});

// Mount the real Vite-compiled primitive with stable props. Only its content
// changes size, as an image or a completed request can without moving the anchor.
async function mountLayer(page: Page, probe: Probe, monitor = false) {
  await openFixture(page, { me: ME, chats: [], memberships: [], messages: [] });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("desktop-app-shell")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate(
    async ({ probe, monitor }) => {
      const main = await fetch("/src/main.tsx").then((response) => response.text());
      const jsxUrl = [...main.matchAll(/from "([^"]+)"/g)]
        .map((match) => match[1])
        .find((url) => url.includes("react_jsx-dev-runtime"));
      if (!jsxUrl) throw new Error("Missing Vite React runtime URL");
      const version = jsxUrl.slice(jsxUrl.indexOf("?"));
      const [react, dom, layers] = await Promise.all([
        import(/* @vite-ignore */ "/node_modules/.vite/deps/react.js" + version),
        import(/* @vite-ignore */ "/node_modules/.vite/deps/react-dom_client.js" + version),
        import("/src/components/ui/AnchoredLayer.tsx"),
      ]);
      const React = react.default ?? react;
      const { createRoot } = dom.default ?? dom;
      const app = document.getElementById("root");
      if (app) app.style.display = "none";
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      if (probe.observerUnavailable)
        Object.defineProperty(window, "ResizeObserver", { value: undefined, configurable: true });
      const observed = new Set<Element>();
      const resizeListeners = new Set<EventListenerOrEventListenerObject | null>();
      if (monitor) {
        const NativeObserver = window.ResizeObserver;
        window.ResizeObserver = class extends NativeObserver {
          private targets = new Set<Element>();
          observe(target: Element, options?: ResizeObserverOptions) {
            if (target.getAttribute("data-testid") === "resize-layer") {
              this.targets.add(target);
              observed.add(target);
            }
            super.observe(target, options);
          }
          disconnect() {
            for (const target of this.targets) observed.delete(target);
            this.targets.clear();
            super.disconnect();
          }
        };
        const add = window.addEventListener.bind(window);
        const remove = window.removeEventListener.bind(window);
        window.addEventListener = ((type, listener, options) => {
          if (type === "resize") resizeListeners.add(listener);
          add(type, listener, options);
        }) as typeof window.addEventListener;
        window.removeEventListener = ((type, listener, options) => {
          if (type === "resize") resizeListeners.delete(listener);
          remove(type, listener, options);
        }) as typeof window.removeEventListener;
      }
      let renders = 0;
      let current = probe;
      const render = () =>
        root.render(
          React.createElement(
            React.StrictMode,
            null,
            React.createElement(
              layers[current.kind],
              {
                anchor: current.anchor,
                avoid: current.avoid,
                className: current.animated ? "kub-glass-strong kub-menu-in" : "kub-glass-strong",
                "data-testid": "resize-layer",
              },
              (side: string) => {
                renders++;
                return React.createElement(
                  "div",
                  {
                    "data-testid": "resize-content",
                    "data-side": side,
                    style: { width: current.width, height: current.height },
                  },
                  React.createElement("input", {
                    "aria-label": "Fixture draft",
                    defaultValue: "Keep focus",
                  }),
                );
              },
            ),
          ),
        );
      Object.assign(window, {
        anchoredResizeProbe: {
          update: (next: Partial<Probe>) => {
            current = { ...current, ...next };
            render();
          },
          unmount: () => {
            root.unmount();
            host.remove();
          },
          stats: () => ({ renders, observed: observed.size, listeners: resizeListeners.size }),
        },
      });
      render();
    },
    { probe, monitor },
  );
  await expect(page.getByTestId("resize-layer")).toBeVisible();
  await page
    .getByTestId("resize-layer")
    .evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
}

async function resizeContent(page: Page, width: number, height: number) {
  await page.getByTestId("resize-content").evaluate(
    async (node, size) => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      node.style.width = `${size.width}px`;
      node.style.height = `${size.height}px`;
    },
    { width, height },
  );
}

async function geometry(page: Page, testId = "resize-layer") {
  return page.getByTestId(testId).evaluate((node) => {
    const box = node.getBoundingClientRect();
    return {
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      height: box.height,
    };
  });
}

for (const theme of ["dark", "light"]) {
  for (const width of [1440, 390]) {
    test(`cold profile keeps loaded actions on screen (${theme}, ${width})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await openFixture(page, {
        me: ME,
        people: [PEER],
        chats: [chat(GROUP, "group", "Glass Resize Fixture", AT)],
        memberships: [membership(GROUP, ME, "owner", AT), membership(GROUP, PEER, "member", AT)],
        messages: Array.from({ length: 40 }, (_, index) =>
          message(
            `45555555-5555-4555-8555-${String(index + 1).padStart(12, "0")}`,
            GROUP,
            PEER,
            `Synthetic message ${index + 1}`,
            new Date(Date.parse(AT) + index * 60_000).toISOString(),
          ),
        ),
        rpc: (name) =>
          name === "search_chat_messages"
            ? missingFunction(name)
            : name === "profile_badges"
              ? { body: [] }
              : undefined,
      });
      await page.addInitScript((value) => localStorage.setItem("kub-theme", value), theme);
      await openChat(page, "Glass Resize Fixture", "Synthetic message 40");
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
      await page.evaluate(() => document.fonts.ready);
      // Opening while chat-entry scrolling is still running correctly dismisses
      // the popout; settle that unrelated interaction before delaying the read.
      await page.waitForTimeout(1000);
      const face = page.getByTestId("message-author-avatar").last();
      await face.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let delayedReads = 0;
      await page.route(`${FIXTURE_HOST}/rest/v1/profiles?**`, async (route) => {
        const url = new URL(route.request().url());
        if (
          url.searchParams.get("id") === `eq.${PEER.id}` &&
          url.searchParams.get("select") === "*"
        ) {
          delayedReads++;
          await pending;
        }
        await route.fallback();
      });
      try {
        const anchor = await face.boundingBox();
        if (!anchor) throw new Error("Missing fixture avatar");
        await page.mouse.click(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
        await expect(page.getByTestId("user-profile-loading")).toBeVisible();
        const surface = width === 1440 ? "user-profile-popout" : "user-profile-modal";
        await expect(page.getByTestId("user-profile-overlay")).toHaveAttribute(
          "data-profile-surface",
          width === 1440 ? "compact" : "full",
        );
        await page
          .getByTestId(surface)
          .evaluate((node) =>
            Promise.all(node.getAnimations().map((animation) => animation.finished)),
          );
        const loading = await geometry(page, surface);
        expect(loading.bottom).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) + 1);
        release();
        await expect(page.getByTestId("user-profile-loading")).toHaveCount(0);
        expect(delayedReads).toBe(1);
        if (width === 1440) {
          await expect(page.getByTestId("profile-open-full")).toBeAttached();
          await expect
            .poll(async () => (await geometry(page, surface)).bottom)
            .toBeLessThanOrEqual(901);
          const loaded = await geometry(page, surface);
          expect(loaded.height).toBeGreaterThan(loading.height + 50);
          expect(loaded.top).toBeLessThan(loading.top);
          await expect(page.getByTestId("profile-open-full")).toBeInViewport({ ratio: 1 });
          await page.getByTestId("profile-open-full").click({ trial: true });
        } else {
          await expect(page.getByTestId("user-profile-close")).toBeInViewport({ ratio: 1 });
          await expect(page.getByTestId("user-profile-overlay")).toContainText(PEER.full_name);
        }
        await page.screenshot({ path: testInfo.outputPath(`profile-${width}-${theme}.png`) });
        await page
          .getByTestId(surface)
          .screenshot({ path: testInfo.outputPath(`profile-element-${width}-${theme}.png`) });
      } finally {
        release();
      }
    });
  }
}

for (const kind of ["AnchoredLayer", "BesideLayer"] as const) {
  for (const direction of ["grow", "shrink"] as const) {
    test(`${kind} follows async content ${direction} without moving focus`, async ({ page }) => {
      await page.setViewportSize({ width: 800, height: 600 });
      const small = { width: 180, height: 80 };
      const large = { width: 300, height: 260 };
      await mountLayer(page, {
        kind,
        anchor: { left: 420, right: 452, top: 490, bottom: 522 },
        avoid: { left: 420, right: 620, top: 480, bottom: 530 },
        ...(direction === "grow" ? small : large),
      });
      const draft = page.getByRole("textbox", { name: "Fixture draft" });
      await draft.focus();
      const before = await geometry(page);
      const size = direction === "grow" ? large : small;
      await resizeContent(page, size.width, size.height);
      await expect.poll(async () => (await geometry(page)).top).not.toBe(before.top);
      const after = await geometry(page);
      expect(after.height).toBe(size.height);
      expect(after.bottom).toBeLessThanOrEqual(592);
      if (direction === "grow") expect(after.top).toBeLessThan(before.top);
      else expect(after.top).toBeGreaterThan(before.top);
      if (kind === "AnchoredLayer") expect(after.bottom).toBe(484);
      else expect(after.right).toBe(412);
      await expect(draft).toBeFocused();
      await expect(draft).toHaveValue("Keep focus");
    });
  }

  test(`${kind} reflows on viewport shrink and expansion`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await mountLayer(page, {
      kind,
      anchor: { left: 310, right: 342, top: 400, bottom: 432 },
      avoid: { left: 200, right: 400, top: 400, bottom: 440 },
      width: 220,
      height: 160,
    });
    const before = await geometry(page);
    await page.getByRole("textbox").focus();
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(page.getByTestId("resize-content")).toHaveAttribute("data-side", "above");
    const narrow = await geometry(page);
    expect(narrow.left).toBeGreaterThanOrEqual(8);
    expect(narrow.right).toBeLessThanOrEqual(382);
    expect(narrow.bottom).toBeLessThanOrEqual(394);
    await expect(page.getByRole("textbox")).toBeFocused();
    await page.setViewportSize({ width: 800, height: 700 });
    await expect.poll(() => geometry(page)).toEqual(before);
    await expect(page.getByTestId("resize-content")).toHaveAttribute(
      "data-side",
      kind === "BesideLayer" ? "right" : "below",
    );
  });
}

test("new anchor and avoid props replace the observed placement without remounting", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await mountLayer(page, {
    kind: "BesideLayer",
    anchor: { left: 310, right: 342, top: 400, bottom: 432 },
    avoid: { left: 290, right: 400, top: 400, bottom: 440 },
    width: 180,
    height: 80,
  });
  await expect(page.getByTestId("resize-content")).toHaveAttribute("data-side", "right");
  await page.getByRole("textbox").focus();
  await page.evaluate(() =>
    window.anchoredResizeProbe.update({
      anchor: { left: 310, right: 342, top: 120, bottom: 152 },
      avoid: { left: 300, right: 720, top: 100, bottom: 180 },
    }),
  );
  await expect(page.getByTestId("resize-content")).toHaveAttribute("data-side", "left");
  await resizeContent(page, 220, 120);
  await expect.poll(async () => (await geometry(page)).right).toBe(292);
  expect((await geometry(page)).top).toBe(120);
  await expect(page.getByRole("textbox")).toBeFocused();
});

test("entry animation does not change the final anchor gap", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await mountLayer(page, {
    kind: "AnchoredLayer",
    anchor: { left: 310, right: 342, top: 590, bottom: 622 },
    width: 220,
    height: 300,
    animated: true,
  });
  await expect.poll(async () => (await geometry(page)).bottom).toBe(584);
});

test("a missing ResizeObserver keeps the layer and viewport fallback usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 800, height: 700 });
  await mountLayer(page, {
    kind: "AnchoredLayer",
    anchor: { left: 310, right: 342, top: 400, bottom: 432 },
    width: 220,
    height: 160,
    observerUnavailable: true,
  });
  await expect(page.getByTestId("resize-content")).toHaveAttribute("data-side", "below");
  await page.getByRole("textbox").focus();
  await page.setViewportSize({ width: 390, height: 500 });
  await expect(page.getByTestId("resize-content")).toHaveAttribute("data-side", "above");
  await expect(page.getByRole("textbox")).toBeFocused();
  expect(errors).toEqual([]);
});

test("observation settles and cleans up through StrictMode and unmount", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 800, height: 600 });
  await mountLayer(
    page,
    {
      kind: "AnchoredLayer",
      anchor: { left: 310, right: 342, top: 400, bottom: 432 },
      width: 180,
      height: 80,
    },
    true,
  );
  const stats = () => page.evaluate(() => window.anchoredResizeProbe.stats());
  await expect.poll(async () => (await stats()).observed).toBe(1);
  expect((await stats()).listeners).toBe(1);
  await resizeContent(page, 260, 180);
  await expect(page.getByTestId("resize-content")).toHaveAttribute("data-side", "above");
  await page.waitForTimeout(200);
  const settled = await stats();
  await page.evaluate(() => {
    for (let index = 0; index < 10; index++) window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(200);
  const afterBurst = await stats();
  // React may call the component once more to bail out (twice in StrictMode).
  expect(afterBurst.renders - settled.renders).toBeLessThanOrEqual(2);
  await page.waitForTimeout(200);
  expect(await stats()).toEqual(afterBurst);
  // Leave a resize pending while removing the portal, then resize again.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
    window.anchoredResizeProbe.unmount();
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(200);
  await expect(page.getByTestId("resize-layer")).toHaveCount(0);
  expect(await stats()).toEqual({ ...afterBurst, observed: 0, listeners: 0 });
  expect(errors).toEqual([]);
});

declare global {
  interface Window {
    anchoredResizeProbe: {
      update: (next: Partial<Probe>) => void;
      unmount: () => void;
      stats: () => { renders: number; observed: number; listeners: number };
    };
  }
}
