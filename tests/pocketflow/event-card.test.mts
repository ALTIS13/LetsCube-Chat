import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEventCard,
  extractEventFields,
} from "../../artifacts/pocketflow/src/lib/eventCard.ts";
import { MAX_MESSAGE_LENGTH } from "../../artifacts/pocketflow/src/lib/render.ts";

/**
 * What the reader actually sees.
 *
 * A replica of the client's renderer, ported from
 * `artifacts/kub/src/lib/formatText.tsx` as it stood on 2026-09-19: the same
 * six patterns in the same order, the same «earliest match wins» rule, and the
 * same per-line tokenizing. It returns the visible text — markers removed,
 * because that is precisely what a sender loses.
 *
 * This exists because asserting that the card *contains* a `*` proves nothing:
 * the character is in the string either way, and the question is whether the
 * client eats it. The control test below pins that this replica is not inert —
 * a replica that returned its input unchanged would make every other
 * assertion here pass for free.
 */
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "code", re: /`([^`\n]+?)`/ },
  { name: "strike", re: /~~([^~\n]+?)~~/ },
  { name: "bold", re: /\*\*([^*\n]+?)\*\*/ },
  { name: "italic", re: /\*([^*\n]+?)\*/ },
  { name: "url", re: /\bhttps?:\/\/[^\s<]+[^\s<.,;:'")\]]/ },
  { name: "mention", re: /(^|\s)@([a-zA-Z0-9_]{2,32})/ },
];

function renderLine(line: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < line.length) {
    const slice = line.slice(cursor);
    let best: { start: number; len: number; visible: string } | null = null;
    for (const { name, re } of PATTERNS) {
      const match = re.exec(slice);
      if (!match) continue;
      if (best && match.index >= best.start) continue;
      let start = match.index;
      let len = match[0].length;
      let visible: string;
      if (name === "url") {
        visible = match[0];
      } else if (name === "mention") {
        visible = `@${match[2]}`;
        start += (match[1] ?? "").length;
        len = match[0].length - (match[1] ?? "").length;
      } else {
        visible = match[1] ?? "";
      }
      best = { start, len, visible };
    }
    if (!best) {
      out += slice;
      break;
    }
    out += slice.slice(0, best.start) + best.visible;
    cursor += best.start + best.len;
  }
  return out;
}

function renderAsClient(content: string): string {
  return content.split("\n").map(renderLine).join("\n");
}

test("the replica strips formatting — without this every other assertion is free", () => {
  assert.equal(renderAsClient("*deploy* failed"), "deploy failed");
  assert.equal(renderAsClient("a **b** c"), "a b c");
  assert.equal(renderAsClient("~~gone~~"), "gone");
  assert.equal(renderAsClient("`kept`"), "kept");
  // A backtick span shields what is inside it: this is the property the card
  // relies on, and it is the reason `untrusted()` wraps rather than escapes.
  assert.equal(renderAsClient("`*deploy* failed`"), "*deploy* failed");
});

test("a payload's asterisks survive the client's formatter", () => {
  const card = buildEventCard({
    sourceName: "CI",
    body: { title: "*deploy* failed", status: "failed" },
  });
  const seen = renderAsClient(card);
  assert.ok(seen.includes("*deploy* failed"), seen);
  // The label on the other side of the card is untouched by the payload.
  assert.ok(seen.includes("Статус: failed"), seen);
});

test("a payload's backticks survive, and do not swallow the rest of the line", () => {
  const card = buildEventCard({
    sourceName: "cron",
    body: { message: "run `rm -rf /tmp/x` and then `ls`" },
  });
  const seen = renderAsClient(card);
  assert.ok(seen.includes("run `rm -rf /tmp/x` and then `ls`"), seen);
});

test("a hash with formatting characters in it arrives whole", () => {
  // The §7 failure this prevents: a checksum that looks right and is not.
  const digest = "a*b*c~~d~~e`f`g";
  const card = buildEventCard({ sourceName: "files", body: { title: "sha256", message: digest } });
  assert.ok(renderAsClient(card).includes(digest), renderAsClient(card));
});

test("one field cannot reformat another", () => {
  const card = buildEventCard({
    sourceName: "monitor",
    body: { host: "db*1", note: "disk*full" },
  });
  const seen = renderAsClient(card);
  assert.ok(seen.includes("db*1"), seen);
  assert.ok(seen.includes("disk*full"), seen);
});

test("the owner's own webhook name cannot reformat the card either", () => {
  const card = buildEventCard({ sourceName: "*prod*", body: { title: "ok" } });
  assert.ok(renderAsClient(card).includes("*prod*"));
});

test("a GitHub-shaped payload reports the pull request, not the repository", () => {
  const fields = extractEventFields({
    action: "opened",
    number: 12,
    pull_request: {
      title: "Fix the thing",
      html_url: "https://github.com/octo/demo/pull/12",
      user: { login: "octocat" },
    },
    repository: { full_name: "octo/demo" },
  });
  assert.equal(fields.title, "Fix the thing");
  assert.equal(fields.status, "opened");
  assert.equal(fields.url, "https://github.com/octo/demo/pull/12");
  assert.equal(fields.recognised, true);
});

test("a Grafana-shaped payload maps all four roles", () => {
  const fields = extractEventFields({
    title: "[Alerting] Disk",
    state: "alerting",
    message: "Свободно 3%",
    ruleUrl: "https://grafana.example/d/abc",
  });
  assert.equal(fields.title, "[Alerting] Disk");
  assert.equal(fields.status, "alerting");
  assert.equal(fields.message, "Свободно 3%");
  assert.equal(fields.url, "https://grafana.example/d/abc");
});

test("an Uptime Kuma-shaped payload is read out of its two nested objects", () => {
  const fields = extractEventFields({
    heartbeat: { status: "down", msg: "connect ETIMEDOUT" },
    monitor: { name: "api", url: "https://api.example/health" },
  });
  assert.equal(fields.title, "api");
  assert.equal(fields.status, "down");
  assert.equal(fields.message, "connect ETIMEDOUT");
  assert.equal(fields.url, "https://api.example/health");
});

test("a shallow field beats a deep one, and a more specific name beats a vaguer one", () => {
  assert.equal(extractEventFields({ message: "shallow", inner: { message: "deep" } }).message, "shallow");
  assert.equal(extractEventFields({ name: "vague", title: "specific" }).title, "specific");
});

test("a plain text body is the message", () => {
  const fields = extractEventFields("диск заполнен на 95%");
  assert.equal(fields.message, "диск заполнен на 95%");
  assert.equal(fields.recognised, true);
});

test("an unrecognised flat object becomes labelled lines rather than JSON", () => {
  const card = buildEventCard({ sourceName: "скрипт", body: { disk: "95%", host: "db1" } });
  assert.ok(card.includes("disk: 95%"), card);
  assert.ok(card.includes("host: db1"), card);
  assert.ok(!card.includes("{"), card);
});

test("something with no readable fields at all falls back to bounded JSON", () => {
  const card = buildEventCard({ sourceName: "raw", body: [{ a: [1, 2] }] });
  assert.ok(renderAsClient(card).includes('"a"'), card);
});

test("a field whose name looks like a credential is never rendered", () => {
  const card = buildEventCard({
    sourceName: "ci",
    body: {
      title: "build",
      api_key: "sk-do-not-print-me",
      githubToken: "ghp_secret",
      Authorization: "Bearer nope",
    },
  });
  assert.ok(!card.includes("sk-do-not-print-me"), card);
  assert.ok(!card.includes("ghp_secret"), card);
  assert.ok(!card.includes("Bearer nope"), card);
  assert.ok(card.includes("build"), card);
});

test("bidi overrides and control characters are stripped", () => {
  const override = "\u202E";
  const bell = "\u0007";
  const card = buildEventCard({
    sourceName: "alert",
    body: { title: `safe${override}evil`, message: `line${bell}break` },
  });
  assert.ok(!card.includes(override), JSON.stringify(card));
  assert.ok(!card.includes(bell), JSON.stringify(card));
  assert.ok(card.includes("safe") && card.includes("evil"), card);
});

test("a 2 MB body does not become a 2 MB message", () => {
  const body: Record<string, unknown> = { message: "x".repeat(2_000_000) };
  for (let index = 0; index < 500; index += 1) body[`field_${index}`] = "y".repeat(2000);
  const card = buildEventCard({ sourceName: "flood", body });
  assert.ok(card.length <= MAX_MESSAGE_LENGTH, `card was ${card.length} characters`);
});

test("a long single field is cut to the platform's limit", () => {
  const card = buildEventCard({ sourceName: "log", body: { message: "строка ".repeat(5000) } });
  assert.ok(card.length <= MAX_MESSAGE_LENGTH, `card was ${card.length} characters`);
});

test("a card can never be read as the client's location preview", () => {
  // `parseLocationPreview` in the client replaces the *whole* message with a
  // map when it is exactly «Местоположение: <maps url>». The source line is
  // what makes that impossible, so it is worth pinning rather than assuming.
  const card = buildEventCard({
    sourceName: "Местоположение",
    body: { url: "https://maps.google.com/?q=55.75,37.61" },
  });
  assert.ok(!/^(?:📍\s*)?Местоположение:\s*https?:\/\/\S+$/u.test(card.trim()), card);
  assert.ok(card.split("\n").length > 1, card);
});

test("the status glyph comes from a closed set, not from the payload", () => {
  assert.ok(buildEventCard({ sourceName: "s", body: { status: "failed" } }).startsWith("❌"));
  assert.ok(buildEventCard({ sourceName: "s", body: { status: "OK" } }).startsWith("✅"));
  assert.ok(buildEventCard({ sourceName: "s", body: { status: "неведомо" } }).startsWith("🔔"));
});

test("prose in a status field stays prose instead of being cut into a word", () => {
  const long = "the check has been failing since 14:02 and the last successful run was yesterday";
  const fields = extractEventFields({ state: long });
  assert.equal(fields.status, null);
  assert.ok((fields.message ?? fields.details.map((d) => d.value).join("")).includes("14:02"));
});
