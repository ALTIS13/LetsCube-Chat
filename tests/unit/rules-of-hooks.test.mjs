// Not one hook below an early return, anywhere in the client.
//
// This is a linter standing in for a test, and it is here because the thing it
// catches is invisible to everything else the repository has.
//
// On 2026-09-18 `VoiceCallCapsule` was written with `useState` **below**
// `if (!view.visible) return null`. That renders fewer hooks while hidden than
// while visible, and React throws «Rendered fewer hooks than expected» the
// instant the state changes. Typecheck cannot see it. The e2e suite could not
// reach it either, and the reason is worth keeping: every path in those specs
// that hides the capsule also remounts its whole subtree, so the component is
// never rendered twice with its visibility moving — while in production a group
// whose channel list arrives after the conversation does exactly that.
//
// Running the rule over the whole client then found two more, in
// `MessageInput.tsx`, below BOTH of that component's early returns — so opening
// and closing the voice recorder, or being muted in a chat, crashed the
// composer. Shipped code, an ordinary thing to do, and nothing had noticed.
//
// The project's own `biome.json` has `linter.enabled: false` and a `files`
// list that does not include `artifacts/kub/src` at all, so turning the linter
// on globally is a separate and much larger decision. This runs exactly one
// rule with its own configuration and changes nothing about the project's.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const configDirectory = path.join(here, "helpers", "hook-lint");
const target = path.join("artifacts", "kub", "src");
const BIOME = path.join("node_modules", "@biomejs", "biome", "bin", "biome");

test("the hook rule's configuration is where the test says it is", () => {
  // The control. Biome answers «no files were processed» rather than failing
  // when a path is ignored, so a test pointed at nothing would pass forever.
  assert.ok(
    existsSync(path.join(configDirectory, "biome.json")),
    "the one-rule biome configuration is missing, so the check below proves nothing",
  );
  assert.ok(existsSync(path.join(root, target)), `${target} is not where this test looks`);
  assert.ok(existsSync(path.join(root, BIOME)), "biome is not installed where this test looks");
});

test("no hook is called below an early return", () => {
  let output = "";
  let failed = false;
  try {
    // Biome's own binary through node, not `pnpm exec`. On Windows
    // `execFileSync("pnpm.cmd", …)` needs a shell, and without one it threw
    // with both streams empty — which read as «biome produced no output» rather
    // than «the command never ran». That is why the file-count check below
    // exists as well.
    output = execFileSync(
      process.execPath,
      [
        BIOME,
        "lint",
        `--config-path=${configDirectory}`,
        "--reporter=summary",
        target,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    failed = true;
    output = String(error.stdout ?? "") + String(error.stderr ?? "");
  }

  // «Checked N files» is the proof the run happened. Without it a biome that
  // could not start, or a path it silently ignored, reads as a clean pass —
  // which is how this whole class of defect stayed invisible in the first place.
  const checked = /Checked (\d+) files/.exec(output)?.[1];
  assert.ok(checked, `biome did not report how many files it checked:\n${output}`);
  assert.ok(
    Number(checked) > 300,
    `biome checked only ${checked} files, so it is not looking at the client`,
  );

  assert.equal(
    failed,
    false,
    "a hook is called below an early return. React throws «Rendered fewer hooks " +
      "than expected» the moment the branch changes, and neither typecheck nor " +
      `the e2e suite can see it:\n${output}`,
  );
});
