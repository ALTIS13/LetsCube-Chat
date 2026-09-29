// How the search orders the conversations it finds on this device (tracker item
// 36, c): Discord's quick-switcher ladder, one rung of our own, a match in what
// was said below a match on the name, and a recency booster from the visits.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MATCH,
  matchQuality,
  recencyBooster,
  scoreLocalChat,
} from "../../artifacts/kub/src/lib/localChatSearch.ts";

test("the ladder, rung by rung", () => {
  assert.equal(matchQuality("Команда проекта", "команда проекта"), MATCH.exact);
  assert.equal(matchQuality("Команда проекта", "ком"), MATCH.prefix);
  assert.equal(matchQuality("Команда проекта", "про"), MATCH.wordStart);
  assert.equal(matchQuality("Спросить у Ани", "про"), MATCH.contains);
  assert.equal(matchQuality("Команда проекта", "проекта команда"), MATCH.allWords);
  assert.equal(matchQuality("Команда проекта", "кмнд"), MATCH.fuzzy);
  assert.equal(matchQuality("Команда проекта", "склад"), MATCH.none);
});

test("each rung outranks the next", () => {
  const order = [MATCH.exact, MATCH.prefix, MATCH.wordStart, MATCH.contains, MATCH.allWords, MATCH.elsewhere, MATCH.fuzzy, MATCH.none];
  for (let i = 1; i < order.length; i += 1) assert.ok(order[i - 1] > order[i], `${order[i - 1]} should outrank ${order[i]}`);
});

test("case and extra spaces do not matter", () => {
  assert.equal(matchQuality("  Команда   ПРОЕКТА ", "команда проекта"), MATCH.exact);
});

test("one letter is a plain match or none, never a guess", () => {
  assert.equal(matchQuality("Бухгалтерия", "х"), MATCH.contains);
  assert.equal(matchQuality("Бухгалтерия", "ю"), MATCH.none);
});

test("the most recent visit weighs most, and the rest in turn", () => {
  const recent = ["c", "b", "a"];
  assert.equal(recencyBooster("c", recent), 2);
  assert.ok(recencyBooster("b", recent) < recencyBooster("c", recent));
  assert.ok(recencyBooster("a", recent) < recencyBooster("b", recent));
  assert.ok(recencyBooster("a", recent) > 1);
  assert.equal(recencyBooster("z", recent), 1);
  assert.equal(recencyBooster("a", []), 1);
});

test("words in another order still find the conversation", () => {
  // The old scorer ran `indexOf` over one joined string and answered 0 here.
  assert.ok(scoreLocalChat({ id: "t", name: "Команда проекта" }, "проекта команда") > 0);
});

test("a name outranks what was last said in a conversation", () => {
  const named = scoreLocalChat({ id: "a", name: "Смета" }, "смета");
  const said = scoreLocalChat({ id: "b", name: "Склад", elsewhere: ["Смета готова, посмотрите"] }, "смета");
  assert.ok(said > 0, "a match in the last message is still found");
  assert.ok(named > said);
  // A match in what was said still outranks a fuzzy guess at a name.
  const guessed = scoreLocalChat({ id: "c", name: "Сметана и молоко" }, "смтн");
  assert.ok(guessed > 0);
  assert.ok(said > guessed);
});

test("between equal matches, the one visited lately comes first", () => {
  const recent = ["visited"];
  const visited = scoreLocalChat({ id: "visited", name: "Команда склада" }, "команда", recent);
  const other = scoreLocalChat({ id: "other", name: "Команда проекта" }, "команда", recent);
  assert.ok(visited > other);
});

test("a visit weighs at most double, so it lifts a match a rung or two and no further", () => {
  // Discord's usage score works the same way and to the same end: the place you
  // go to every day outranks a slightly better spelling of one you never open.
  const recent = ["visited"];
  const exactUnvisited = scoreLocalChat({ id: "exact", name: "Команда" }, "команда", recent);
  const wordStartVisited = scoreLocalChat({ id: "visited", name: "Моя команда" }, "команда", recent);
  assert.ok(wordStartVisited > exactUnvisited);
  // A guess stays a guess, however often it is visited.
  const fuzzyVisited = scoreLocalChat({ id: "visited", name: "Касса и дневной отчёт" }, "кдо", recent);
  const containsUnvisited = scoreLocalChat({ id: "other", name: "Предновогодний заказ" }, "днов", recent);
  assert.ok(fuzzyVisited > 0);
  assert.ok(containsUnvisited > fuzzyVisited);
});

test("a handle typed as one means that person", () => {
  // Both begin with the letters typed; only one of them is the handle.
  const byHandle = scoreLocalChat({ id: "p", name: "Ольга Крылова", handle: "@annet" }, "@ann");
  const byName = scoreLocalChat({ id: "q", name: "Anna Smith" }, "@ann");
  assert.ok(byName > 0);
  assert.ok(byHandle > byName);
  // Without the «@», the handle is one more thing the name can be matched by.
  assert.ok(scoreLocalChat({ id: "p", name: "Ольга Крылова", handle: "@anna_k" }, "anna") > 0);
});

test("nothing is found for nothing", () => {
  assert.equal(scoreLocalChat({ id: "a", name: "Команда" }, "   "), 0);
  assert.equal(scoreLocalChat({ id: "a", name: "Команда" }, "@"), 0);
  assert.equal(scoreLocalChat({ id: "a", name: "Команда", elsewhere: ["привет"] }, "склад"), 0);
});
