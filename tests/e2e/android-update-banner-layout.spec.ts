import { expect, test } from "@playwright/test";
import { chat, membership, message, openChat, openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const me = person("11111111-1111-4111-8111-1111111111f1", "QA Reader");
const peer = person("11111111-1111-4111-8111-1111111111f2", "QA Sender");
const id = "22222222-2222-4222-8222-2222222222f1";

for (const width of [390, 1440]) for (const theme of ["dark", "light"] as const) {
  test(`native update status preserves chat geometry at ${width} ${theme}`, async ({ page, request }, info) => {
    await requireFixtureServer(request);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      const wire = window as unknown as Record<string, unknown>;
      wire.androidBridge = { postMessage() {} };
      wire.__updateState = { phase: "current", version: "0.1.31", bytes: 0, total: 0, canInstall: false, error: null };
      wire.Capacitor = {
        PluginHeaders: [{ name: "AndroidUpdates", methods: ["status", "check", "start", "cancel", "install", "permission"].map(name => ({ name, rtype: "promise" })) }],
        nativePromise: async (plugin: string, method: string) => {
          if (plugin !== "AndroidUpdates" || !["status", "check"].includes(method)) throw Error("Unexpected native action in layout fixture");
          return { ...(wire.__updateState as object) };
        },
      };
    });
    const now = new Date().toISOString();
    await openFixture(page, { me, theme, chats: [chat(id, "private", null, now)],
      memberships: [membership(id, me, "owner", now), membership(id, peer, "member", now)],
      messages: [message("55555555-5555-4555-8555-5555555555f1", id, peer, "Synthetic update layout message", now)],
    });
    await openChat(page, peer.full_name, "Synthetic update layout message");
    await expect(page.getByTestId("android-update-state")).toHaveCount(0);
    const port = page.getByTestId("message-scroll-container");
    const before = await port.boundingBox();
    expect(before).not.toBeNull();
    for (const phase of ["checking", "downloading", "ready", "current"]) {
      await page.evaluate(phase => {
        (window as unknown as Record<string, unknown>).__updateState = { phase, version: "0.1.32", bytes: 4300, total: 10000, canInstall: phase === "ready", error: null };
        window.dispatchEvent(new Event("focus"));
      }, phase);
      const notice = page.getByTestId("android-update-state");
      if (phase === "current") await expect(notice).toHaveCount(0);
      else {
        await expect(notice).toHaveAttribute("data-phase", phase);
        expect(await notice.evaluate(e => getComputedStyle(e).position)).toBe("fixed");
        expect(await notice.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
        await page.screenshot({ path: info.outputPath(`native-update-${phase}-${width}-${theme}.png`), animations: "disabled" });
      }
      const after = await port.boundingBox();
      expect(after).not.toBeNull();
      expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
      expect(Math.abs(after!.height - before!.height)).toBeLessThan(1);
      const blocked = await page.evaluate(() => {
        const nodes = document.querySelectorAll<HTMLElement>('[data-testid="chat-chrome-stack"] button, [data-testid="composer-input"], textarea');
        return Array.from(nodes).filter(e => {
          const b = e.getBoundingClientRect();
          if (!b.width || !b.height) return false;
          const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
          return !hit || !e.contains(hit);
        }).length;
      });
      expect(blocked).toBe(0);
    }
  });
}
