import assert from "node:assert/strict";
import test from "node:test";

import { textAfterSheet, textForSheet } from "../../artifacts/kub/src/lib/attachCaptionHandoff.ts";

/**
 * Tracker item 65: «если начать писать, а потом выбрать фото для загрузки. У
 * телеги ты тогда автоматом падаешь в поле подписи под фото со своим набранным
 * уже текстом. А здесь либо отправлять по отдельности, либо слетит что-то одно
 * из двух».
 */

test("what was typed goes to the sheet whole — its lines, its spaces", () => {
  assert.equal(textForSheet("Витрина после монтажа", false), "Витрина после монтажа");
  // A caption field that flattened this would be the loss the report is about.
  assert.equal(textForSheet("Первая строка\nвторая строка ", false), "Первая строка\nвторая строка ");
});

test("nothing is taken from an empty composer or from an edit", () => {
  assert.equal(textForSheet("", false), null);
  assert.equal(textForSheet("  \n ", false), null);
  // Editing a message, the field holds that message, not a caption.
  assert.equal(textForSheet("исправленный текст", true), null);
});

test("closing the sheet gives the composer its text back, and keeps anything typed meanwhile", () => {
  assert.equal(textAfterSheet("Витрина после монтажа", ""), "Витрина после монтажа");
  assert.equal(textAfterSheet("", "набрано позже"), "набрано позже");
  assert.equal(textAfterSheet("Витрина", "после монтажа"), "Витрина после монтажа");
  // No second space where one is already there.
  assert.equal(textAfterSheet("Витрина ", "после"), "Витрина после");
  assert.equal(textAfterSheet("Витрина\n", "после"), "Витрина\nпосле");
});
