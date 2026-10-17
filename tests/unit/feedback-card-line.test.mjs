import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../artifacts/kub/src/components/kub/KubFeedbackViewport.tsx", import.meta.url),
  "utf8",
);
const card = source.slice(source.indexOf("kub-feedback-card"), source.indexOf("Закрыть уведомление"));

test("D-084 feedback card stays one line instead of stacking a title over its detail", () => {
  assert.equal(card.includes("items-start"), false);
  assert.equal(card.includes("mt-0.5 block text-xs"), false);
  assert.match(card, /items-center/);
  assert.match(card, /truncate/);
});
