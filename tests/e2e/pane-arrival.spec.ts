import { expect, test } from "@playwright/test";
import { chat, membership, message, openChat, openFixture, person, requireFixtureServer } from "./helpers/messageActionsFixture";

const me = person("11111111-1111-4111-8111-1111111111e1", "QA Reader");
const peer = person("11111111-1111-4111-8111-1111111111e2", "QA Sender");
const chatId = "22222222-2222-4222-8222-2222222222e1";

for (const reduced of [false, true]) {
  test(`conversation arrival is immediate and respects reduced motion=${reduced}`, async ({ page, request }) => {
    await requireFixtureServer(request);
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.addInitScript(() => {
      const run = Element.prototype.animate;
      const calls: unknown[] = [];
      (window as unknown as { __paneArrivals: unknown[] }).__paneArrivals = calls;
      Element.prototype.animate = function (frames, options) {
        const animation = run.call(this, frames, options);
        if (typeof options === "object" && options.id === "kub-pane-arrival") {
          calls.push({ frames, duration: options.duration, transform: getComputedStyle(this).transform });
          animation.pause();
        }
        return animation;
      };
    });
    const now = new Date().toISOString();
    await openFixture(page, { me, chats: [chat(chatId, "private", null, now)],
      memberships: [membership(chatId, me, "owner", now), membership(chatId, peer, "member", now)],
      messages: [message("55555555-5555-4555-8555-5555555555e1", chatId, peer, "Synthetic arrival message", now)],
    });
    await openChat(page, peer.full_name, "Synthetic arrival message");
    const arrivals = await page.evaluate(() =>
      (window as unknown as { __paneArrivals: { frames: unknown; duration: number; transform: string }[] }).__paneArrivals,
    );
    expect(arrivals).toHaveLength(reduced ? 0 : 1);
    if (!reduced) {
      expect(arrivals[0].duration).toBe(220);
      expect(arrivals[0].frames).toEqual([{ opacity: 0.86 }, { opacity: 1 }]);
      expect(arrivals[0].transform).toBe("none");
    }
    await page.getByTestId("chat-chrome-stack").getByRole("button", { name: "Ещё", exact: true }).click();
    await expect(page.getByRole("menu").getByRole("button", { name: "Поиск в чате", exact: true })).toBeVisible();
  });
}
