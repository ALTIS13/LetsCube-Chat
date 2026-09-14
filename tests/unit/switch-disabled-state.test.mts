// What a switch nobody may press looks like, and where it paints it.
//
// D-137. The disabled inset and its sink veil used to sit on the **button**,
// which is the 44px target a finger needs rather than the switch itself, so an
// unavailable switch drew a hard dark square around itself — 44 by 44 in the
// dark theme, which is what the owner saw on the settings screen. And the track
// kept its accent whatever `disabled` said, so a switch nobody could press
// looked exactly like one that was on.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const SWITCH = readFileSync("artifacts/kub/src/components/kub/KubSwitch.tsx", "utf8");
const SETTINGS = readFileSync("artifacts/kub/src/components/settings/SettingsScreen.tsx", "utf8");

/** The class lists, with comments stripped: prose about a class is not a class. */
function classes(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the target paints nothing, because a target is not a surface", () => {
  const body = classes(SWITCH);
  const button = body.slice(body.indexOf("kub-switch group/switch"), body.indexOf('<span'));
  assert.ok(button.includes("disabled:cursor-not-allowed"), "the switch stopped saying it is unavailable");
  assert.ok(
    !/disabled:bg-\[/.test(button),
    "the disabled paint is back on the button, which is the 44px hit area and not the switch",
  );
  assert.ok(
    !/disabled:text-\[/.test(button),
    "the button is colouring text it does not draw",
  );
});

test("the track says «not yours to press», and does not fade to say it", () => {
  const body = classes(SWITCH);
  // The product's own word for unavailable, on the thing that is the switch.
  assert.match(body, /group-disabled\/switch:bg-\[var\(--kub-inset\)\]/u);
  assert.match(body, /group-disabled\/switch:bg-\[image:linear-gradient\(var\(--kub-sink-veil\)/u);
  assert.match(body, /group-disabled\/switch:border-\[color:var\(--kub-border-color\)\]/u);

  // And never by fading: `control-vocabulary.test.mjs` refuses that by name,
  // because fading says «loading» where the inset says «not yours».
  assert.doesNotMatch(body, /disabled(?:=true)?\]?:opacity-\d+/u);
});

test("the thumb keeps its position and loses its brightness", () => {
  const body = classes(SWITCH);
  // The stored value is still worth reading while the switch is unavailable, so
  // the thumb does not move — it only stops looking live.
  assert.match(body, /group-disabled\/switch:bg-\[color:var\(--kub-muted\)\]/u);
  assert.match(body, /checked \? "translate-x-5" : "translate-x-0"/u);
});

test("the notification categories are settable before the device permission is", () => {
  // They are stored preferences in `notification_preferences`, and the push
  // gate reads them whenever a push is made. Disabling them until
  // «Push-уведомления» was active meant a person could not say what they
  // wanted before granting the browser permission — and the row above already
  // states that the permission is missing, so nothing else has to.
  assert.ok(
    !SETTINGS.includes('disabled={loadingPreferences || pushStatus !== "active"}'),
    "a category is disabled by the device permission again",
  );
  const count = SETTINGS.split("disabled={loadingPreferences}").length - 1;
  assert.equal(count, 3, `expected three categories gated only on the read, found ${count}`);
});
