import assert from "node:assert/strict";
import test from "node:test";
import { storageHeadingMarker } from "../e2e/helpers/storageHeadingMarker.cjs";

const hint = 'a(H,{term:"Хранилище приложения",text:"Папка на диске, где LETSCUBE держит переписку, файлы и вход"})';
const heading = (className, label, explanation = hint) =>
  `b("div",{className:${JSON.stringify(className)},children:[${label},${explanation}]})`;

test("compiled heading marker distinguishes the exact old and new consumers", () => {
  const old = heading("flex flex-wrap items-center gap-x-1.5 text-sm text-[color:var(--kub-text)]", '"Хранилище приложения"');
  const next = heading("flex items-center gap-x-1.5 text-sm text-[color:var(--kub-text)]", 'a("span",{className:"min-w-0",children:"Хранилище приложения"})');
  assert.deepEqual(storageHeadingMarker(old), { schema: "storage-heading-consumer/v1", oldConsumerCount: 1, newConsumerCount: 0 });
  assert.deepEqual(storageHeadingMarker(next), { schema: "storage-heading-consumer/v1", oldConsumerCount: 0, newConsumerCount: 1 });
});

test("compiled heading marker refuses unrelated classes wrong labels and clipped text", () => {
  const className = "flex items-center gap-x-1.5 text-sm text-[color:var(--kub-text)]";
  for (const source of [
    JSON.stringify(className),
    heading(className, 'a("span",{className:"min-w-0",children:"Лимит кэша"})'),
    heading(className, 'a("span",{className:"min-w-0 truncate",children:"Хранилище приложения"})'),
    heading(className, 'a("span",{className:"min-w-0",children:"Хранилище приложения"})', hint.replace("term:", "other:")),
  ]) {
    assert.deepEqual(storageHeadingMarker(source), { schema: "storage-heading-consumer/v1", oldConsumerCount: 0, newConsumerCount: 0 });
  }
});

test("compiled heading marker reports duplicates and refuses unparseable input", () => {
  const next = heading("flex items-center gap-x-1.5 text-sm text-[color:var(--kub-text)]", 'a("span",{className:"min-w-0",children:"Хранилище приложения"})');
  assert.equal(storageHeadingMarker(`${next};${next}`).newConsumerCount, 2);
  assert.throws(() => storageHeadingMarker("function {"), /STORAGE_HEADING_JS_PARSE_REFUSED/);
});
