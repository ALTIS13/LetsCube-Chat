import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePollArguments,
  parseTaskArguments,
  renderPoll,
} from "../../artifacts/pocketflow/src/app/group.ts";

/**
 * `/poll` and `/task`, which exist only because the platform has neither
 * (gap G-3). What is worth testing is the two halves a user actually meets:
 * whether their typing was understood, and whether the tally they read is the
 * tally that was recorded.
 */

test("a poll needs a question and at least two options", () => {
  assert.deepEqual(parsePollArguments("Обедаем? | Да | Нет"), {
    question: "Обедаем?",
    options: ["Да", "Нет"],
  });
});

test("newlines work as well as pipes, because somebody will type a list", () => {
  assert.deepEqual(parsePollArguments("Обедаем?\nДа\nНет"), {
    question: "Обедаем?",
    options: ["Да", "Нет"],
  });
});

test("a poll with one option is refused, with a sentence that says how", () => {
  const result = parsePollArguments("Обедаем? | Да");
  assert.ok("error" in result);
  assert.match(result.error, /два варианта/);
});

test("an empty command is refused with an example", () => {
  const result = parsePollArguments("   ");
  assert.ok("error" in result);
  assert.match(result.error, /\/poll/);
});

test("too many options are refused rather than silently truncated", () => {
  const result = parsePollArguments(
    ["Вопрос", ...Array.from({ length: 9 }, (_, index) => `в${index}`)].join(" | "),
  );
  assert.ok("error" in result);
  assert.match(result.error, /8/);
});

test("a checklist needs a title and at least one item", () => {
  assert.deepEqual(parseTaskArguments("Релиз | собрать | выкатить"), {
    title: "Релиз",
    items: ["собрать", "выкатить"],
  });
  const bad = parseTaskArguments("Релиз");
  assert.ok("error" in bad);
});

const poll = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "u1",
  chat_id: "g1",
  message_id: "m1",
  kind: "poll",
  question: "Обедаем?",
  options: ["Да", "Нет"],
  multiple: false,
  closed: false,
};

test("a poll renders its counts and its total", () => {
  const tally = new Map([
    [0, { count: 3, names: [] }],
    [1, { count: 1, names: [] }],
  ]);
  const text = renderPoll(poll, tally);
  assert.match(text, /Обедаем\?/);
  assert.match(text, /4 голоса/);
  // The bar is proportional: three of four is a fuller bar than one of four.
  const lines = text.split("\n");
  const yes = lines.find((line) => line.includes(" 3")) ?? "";
  const no = lines.find((line) => line.includes(" 1")) ?? "";
  assert.ok(
    (yes.match(/█/g)?.length ?? 0) > (no.match(/█/g)?.length ?? 0),
    "the larger count must draw the longer bar",
  );
});

test("an empty poll says nought rather than dividing by zero", () => {
  const text = renderPoll(poll, new Map());
  assert.match(text, /0 голосов/);
  assert.ok(!text.includes("NaN"));
});

test("one vote is «1 голос», not «1 голосов»", () => {
  const text = renderPoll(poll, new Map([[0, { count: 1, names: [] }]]));
  assert.match(text, /\n1 голос$/);
});

test("a checklist ticks what was done and names who did it", () => {
  const task = { ...poll, kind: "task", question: "Релиз", options: ["собрать", "выкатить"] };
  const text = renderPoll(task, new Map([[0, { count: 1, names: ["Аня"] }]]));
  assert.match(text, /✅ собрать — Аня/);
  assert.match(text, /☐ выкатить/);
  assert.ok(!text.includes("голос"), "a checklist is not a poll and does not count votes");
});

test("an option's own text cannot reformat the card around it", () => {
  // The client formats every message and there is no parse_mode (G-5), so an
  // option containing an asterisk would otherwise italicise the tally.
  const sneaky = { ...poll, question: "Что *дальше*?", options: ["a*b", "c"] };
  const text = renderPoll(sneaky, new Map());
  assert.ok(text.includes("`"), "the untrusted parts must be wrapped");
});

test("a closed poll says so", () => {
  const text = renderPoll({ ...poll, closed: true }, new Map());
  assert.match(text, /Опрос закрыт/);
  const task = renderPoll({ ...poll, kind: "task", closed: true }, new Map());
  assert.match(task, /Список закрыт/);
});

test("the plural agrees across the whole rule, not just at one", () => {
  const NL = String.fromCharCode(10);
  const cases = [
    [0, "0 голосов"],
    [1, "1 голос"],
    [2, "2 голоса"],
    [4, "4 голоса"],
    [5, "5 голосов"],
    [11, "11 голосов"],
    [12, "12 голосов"],
    [14, "14 голосов"],
    [21, "21 голос"],
    [22, "22 голоса"],
    [25, "25 голосов"],
    [101, "101 голос"],
    [111, "111 голосов"],
  ] as const;
  for (const [count, expected] of cases) {
    const tally = count === 0 ? new Map() : new Map([[0, { count, names: [] }]]);
    const text = renderPoll(poll, tally);
    assert.ok(
      text.endsWith(expected),
      count + ": ended with " + JSON.stringify(text.split(NL).pop()),
    );
  }
});
