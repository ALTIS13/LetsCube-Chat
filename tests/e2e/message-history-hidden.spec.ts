import { expect, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

const ME = person("73000000-0000-4000-8000-000000000001", "History QA");
const PEER = person("73000000-0000-4000-8000-000000000002", "History Peer");
const CHAT = "73000000-0000-4000-8000-000000000010";
const id = (n: number) =>
  `73000000-0000-4000-8000-${String(1000 + n).padStart(12, "0")}`;

test.use({ screenshot: "off", trace: "off", video: "off" });
test.beforeEach(async ({ request }) => requireFixtureServer(request));

for (const theme of ["dark", "light"] as const)
  for (const shape of ["empty", "short"] as const)
    test(`${theme}/${shape}: hidden head has a reachable older-history action and reaches the next visible page`, async ({
      page,
    }) => {
      const base = Date.now() - 1_000_000;
      const rows = Array.from({ length: 201 }, (_, n) =>
        message(
          id(n),
          CHAT,
          PEER,
          `Synthetic history ${n}`,
          new Date(base + n * 1000).toISOString(),
        ),
      );
      const hidden = new Set(
        rows
          .slice(101)
          .filter((row) => shape === "empty" || row.id !== id(200))
          .map((row) => String(row.id)),
      );
      const requests: string[] = [];
      await openFixture(page, {
        me: ME,
        theme,
        chats: [chat(CHAT, "private", null, new Date().toISOString())],
        memberships: [
          membership(CHAT, ME, "owner", new Date().toISOString()),
          membership(CHAT, PEER, "member", null),
        ],
        messages: rows,
        rest(call) {
          const params = new URLSearchParams(call.search);
          if (
            call.resource === "message_hidden_for_users" &&
            call.method === "GET"
          ) {
            const scope = params.get("message_id");
            expect(scope?.startsWith("in.(")).toBe(true);
            const wanted = new Set(
              scope!
                .slice(4, -1)
                .split(",")
                .map((value) => value.replace(/^"|"$/g, "")),
            );
            return {
              status: 200,
              body: [...hidden]
                .filter((value) => wanted.has(value))
                .map((message_id) => ({ message_id })),
            };
          }
          if (
            call.resource !== "messages" ||
            call.method !== "GET" ||
            params.get("limit") !== "101"
          )
            return;
          expect(params.get("chat_id")).toBe(`eq.${CHAT}`);
          expect(params.get("order")).toBe("created_at.desc,id.desc");
          requests.push(call.search!);
          let selected: Row[] = rows.slice();
          const before = params.get("or");
          if (before) {
            const match =
              /^\(created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\.([0-9a-f-]{36})\)\)$/.exec(
                before,
              );
            expect(
              match,
              "the real SDK must emit the exclusive full tuple",
            ).not.toBeNull();
            expect(match![1]).toBe(match![2]);
            selected = selected.filter(
              (row) =>
                String(row.created_at) < match![1] ||
                (row.created_at === match![1] && String(row.id) < match![3]),
            );
          }
          selected.sort(
            (a, b) =>
              String(b.created_at).localeCompare(String(a.created_at)) ||
              String(b.id).localeCompare(String(a.id)),
          );
          return { status: 200, body: selected.slice(0, 101) };
        },
      });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const entry = page
        .getByTestId("chat-list-item")
        .filter({ hasText: PEER.full_name });
      await expect(entry).toBeVisible();
      await entry.click();
      await expect.poll(() => requests.length).toBeGreaterThan(0);
      await expect(page.locator('[data-message-bubble="true"]')).toHaveCount(
        shape === "empty" ? 0 : 1,
      );
      if (shape === "short") {
        const overflow = await page
          .getByTestId("message-scroll-container")
          .evaluate((node) => node.scrollHeight - node.clientHeight);
        expect(
          overflow,
          "one visible row cannot trigger the automatic scroll-only loader",
        ).toBeLessThanOrEqual(240);
      }
      const more = page.getByRole("button", {
        name: "Загрузить ранние сообщения",
        exact: true,
      });
      await expect(more).toBeVisible();
      if (shape === "short") {
        await more.focus();
        await more.press("Enter");
      } else {
        await more.click();
      }
      await expect(
        page.getByTestId("message-scroll-container"),
      ).toHaveAttribute("data-has-more-older", "true");
      await expect(
        page
          .locator('[data-message-text-content="true"]')
          .filter({ hasText: /^Synthetic history 100$/ }),
      ).toBeVisible();
      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(requests.some((search) => search.includes("or="))).toBe(true);
    });
