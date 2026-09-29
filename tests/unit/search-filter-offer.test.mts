import assert from "node:assert/strict";
import test from "node:test";

import {
  chatNameMatchesSearch,
  completeSearchFilter,
  insertSearchPrefix,
  personMatchesSearch,
  SEARCH_FILTER_ROWS,
  SEARCH_HAS_CHOICES,
  searchFilterOffer,
  searchValueToken,
} from "../../artifacts/kub/src/lib/searchFilterOffer.ts";
import { parseAdvancedSearchQuery } from "../../artifacts/kub/src/lib/searchQuery.ts";

// Tracker item 36 c: the in-chat search offers its own grammar, as Discord's
// does — the filters on an empty field, a filter's values while it is typed.

test("an empty field offers the filters, and typing words offers nothing", () => {
  assert.deepEqual(searchFilterOffer(""), { kind: "filters" });
  assert.deepEqual(searchFilterOffer("   "), { kind: "filters" });
  assert.deepEqual(searchFilterOffer("смета"), { kind: "none" });
  assert.deepEqual(searchFilterOffer("смета "), { kind: "none" });
});

test("a from: or has: still being typed offers its values, with where it starts", () => {
  assert.deepEqual(searchFilterOffer("from:"), { kind: "from", partial: "", start: 0 });
  assert.deepEqual(searchFilterOffer("смета from:ан"), { kind: "from", partial: "ан", start: 6 });
  assert.deepEqual(searchFilterOffer('from:"Анна Сми'), { kind: "from", partial: "Анна Сми", start: 0 });
  assert.deepEqual(searchFilterOffer("has:ph"), { kind: "has", partial: "ph", start: 0 });
  assert.deepEqual(searchFilterOffer("FROM:x"), { kind: "from", partial: "x", start: 0 });
});

test("a finished filter offers nothing more", () => {
  assert.deepEqual(searchFilterOffer("from:anna "), { kind: "none" });
  assert.deepEqual(searchFilterOffer('from:"Анна Смирнова" '), { kind: "none" });
  assert.deepEqual(searchFilterOffer("before:2026-09-01"), { kind: "none" });
});

test("a completed value is what the parser reads back, quoted when it has a space", () => {
  assert.equal(searchValueToken("Анна Смирнова"), '"Анна Смирнова"');
  assert.equal(searchValueToken("anna"), "anna");
  const offer = searchFilterOffer("смета from:ан");
  assert.equal(offer.kind, "from");
  const next = completeSearchFilter("смета from:ан", offer.kind === "from" ? offer.start : 0, "from", "Анна Смирнова");
  assert.equal(next, 'смета from:"Анна Смирнова" ');
  const parsed = parseAdvancedSearchQuery(next, "message");
  assert.equal(parsed.filters.from, "Анна Смирнова");
  assert.equal(parsed.query, "смета");
  assert.deepEqual(parseAdvancedSearchQuery(completeSearchFilter("has:", 0, "has", "image"), "message").filters.has, ["image"]);
});

test("every row inserts a prefix the parser knows, and every has: choice parses", () => {
  for (const row of SEARCH_FILTER_ROWS) {
    const key = row.prefix.replace(/:$/, "");
    assert.ok(["from", "has", "before", "after"].includes(key), row.prefix);
    assert.equal(insertSearchPrefix("", row.prefix), row.prefix);
  }
  assert.equal(insertSearchPrefix("смета", "from:"), "смета from:");
  for (const choice of SEARCH_HAS_CHOICES) {
    assert.deepEqual(parseAdvancedSearchQuery(`has:${choice.value}`, "message").filters.has, [choice.value]);
  }
});

test("a filter still being typed at the end is not searched for", () => {
  const parse = (raw: string) => parseAdvancedSearchQuery(raw, "message");
  // Nothing after the colon yet: what a press on a row leaves in the field.
  // (`chatMessageSearch.canRunSearch` needs words or a filter; these have neither.)
  const nothing = { from: null, has: [], before: null, after: null };
  for (const raw of ["from:", "has:", "before:", "after:", "смета from:"]) {
    const parsed = parse(raw);
    assert.equal(parsed.query, raw.startsWith("смета") ? "смета" : "", raw);
    assert.equal(parsed.chips.length, 0, raw);
    const { from, has, before, after } = parsed.filters;
    assert.deepEqual({ from, has, before, after }, nothing, raw);
  }
  // A quoted name not closed yet is neither a filter nor words.
  const open = parse('from:"Анна Сми');
  assert.equal(open.query, "");
  assert.equal(open.filters.from, null);
  // A value that does not read yet, while it is the last thing typed.
  assert.equal(parse("has:фо").query, "");
  assert.deepEqual(parse("has:фо").filters.has, []);
  assert.equal(parse("before:2026-0").query, "");
  assert.equal(parse("before:2026-0").filters.before, null);
  // Once something follows it, a token nothing accepts is words again, as before.
  assert.equal(parse("has:xyz смета").query, "has:xyz смета");
  // A finished filter before the one being typed still applies.
  const both = parse('from:"Анна Смирнова" has:');
  assert.equal(both.filters.from, "Анна Смирнова");
  assert.equal(both.chips.length, 1);
  assert.equal(both.chips[0].end <= both.raw.length, true);
});

test("the words the has: offer shows read as its values when typed out", () => {
  for (const choice of SEARCH_HAS_CHOICES) {
    const typed = `has:${choice.label.toLocaleLowerCase("ru-RU")} `;
    assert.deepEqual(parseAdvancedSearchQuery(typed, "message").filters.has, [choice.value], typed);
  }
});

test("every row's hint is written the way the parser reads it", () => {
  for (const row of SEARCH_FILTER_ROWS) {
    const example = row.hint.split(/\s/)[0];
    const parsed = parseAdvancedSearchQuery(`${example} смета`, "message");
    assert.equal(parsed.chips[0]?.key, row.prefix.replace(/:$/, ""), row.hint);
  }
});

test("people are found by name or никнейм, in any case", () => {
  const anna = { name: "Анна Смирнова", username: "anna" };
  assert.equal(personMatchesSearch(anna, ""), true);
  assert.equal(personMatchesSearch(anna, "АН"), true);
  assert.equal(personMatchesSearch(anna, "@ann"), true);
  assert.equal(personMatchesSearch(anna, "смирн"), true);
  assert.equal(personMatchesSearch(anna, "борис"), false);
  assert.equal(personMatchesSearch({ name: "Борис", username: null }, "anna"), false);
});

// The global half (tracker item 36 c): the sidebar's search of everything offers
// the same completions, plus `in:`, and leaves its empty field to the quick
// switch.

test("the global field leaves its empty state to the quick switch, and knows in:", () => {
  assert.deepEqual(searchFilterOffer("", "global"), { kind: "none" });
  assert.deepEqual(searchFilterOffer("   ", "global"), { kind: "none" });
  assert.deepEqual(searchFilterOffer("in:", "global"), { kind: "in", partial: "", start: 0 });
  assert.deepEqual(searchFilterOffer("смета in:ком", "global"), { kind: "in", partial: "ком", start: 6 });
  assert.deepEqual(searchFilterOffer('in:"Команда пр', "global"), { kind: "in", partial: "Команда пр", start: 0 });
  assert.deepEqual(searchFilterOffer("from:ан", "global"), { kind: "from", partial: "ан", start: 0 });
  assert.deepEqual(searchFilterOffer("has:ph", "global"), { kind: "has", partial: "ph", start: 0 });
});

test("inside one conversation in: means nothing and is not offered", () => {
  assert.deepEqual(searchFilterOffer("in:ком"), { kind: "none" });
  assert.deepEqual(searchFilterOffer("in:ком", "chat"), { kind: "none" });
});

test("a word that only ends in «in:» is not the filter", () => {
  assert.deepEqual(searchFilterOffer("join:x", "global"), { kind: "none" });
  assert.deepEqual(searchFilterOffer("login:", "global"), { kind: "none" });
});

test("a completed in: is what the parser reads back, and offers nothing more", () => {
  const next = completeSearchFilter("смета in:ком", 6, "in", "Команда проекта");
  assert.equal(next, 'смета in:"Команда проекта" ');
  const parsed = parseAdvancedSearchQuery(next, "all");
  assert.equal(parsed.filters.in, "Команда проекта");
  assert.equal(parsed.query, "смета");
  assert.deepEqual(searchFilterOffer(next, "global"), { kind: "none" });
});

test("a conversation is found by any part of its name, in any case", () => {
  assert.equal(chatNameMatchesSearch("Команда проекта", "ПРОЕК"), true);
  assert.equal(chatNameMatchesSearch("Команда проекта", '"Команда пр'), true);
  assert.equal(chatNameMatchesSearch("Команда проекта", ""), true);
  assert.equal(chatNameMatchesSearch("Команда проекта", "склад"), false);
});
