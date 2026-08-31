import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

test("PG smoke runner rehearses stripped proposal rollback before committed apply", () => {
  const temp = mkdtempSync(join(tmpdir(), "letscube-bot-pg-runner-"));
  const logPath = join(temp, "docker.log");
  const capturePath = join(temp, "migration-rehearsal.sql");

  try {
    const commandDriver = installFakeCommandDriver(temp);
    const result = spawnSync(
      process.execPath,
      ["tests/rls/bot-chat-search-notification-smoke.mjs"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          BOT_PG_SMOKE_COMMAND_DRIVER: commandDriver,
          FAKE_DOCKER_LOG: logPath,
          FAKE_DOCKER_CAPTURE: capturePath,
        },
      },
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(logPath), true, "runner did not use the command driver");
    const invocations = readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean);
    const schemaDumps = invocations.filter((line) => line.includes("pg_dump"));
    assert.equal(schemaDumps.length, 2, invocations.join("\n"));
    for (const dump of schemaDumps) {
      assert.match(dump, /--schema-only/);
      assert.match(dump, /--no-owner/);
      assert.match(dump, /--no-privileges/);
    }

    const rehearsalCopy = invocations.findIndex((line) => line.includes("/tmp/migration-rehearsal.sql"));
    const committedApply = invocations.findIndex((line) => line.includes("-f /tmp/migration.sql"));
    assert.ok(rehearsalCopy >= 0 && committedApply > rehearsalCopy, invocations.join("\n"));
    assert.match(result.stdout, /Running proposal rollback rehearsal/);
    assert.match(result.stdout, /Proposal rollback rehearsal restored schema/);

    assert.equal(existsSync(capturePath), true, "stripped proposal was not staged");
    const proposal = readFileSync(capturePath, "utf8");
    const executableLines = proposal
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("--"));
    assert.notEqual(executableLines[0]?.toLowerCase(), "begin;");
    assert.notEqual(executableLines.at(-1)?.toLowerCase(), "commit;");
    assert.match(proposal, /create schema if not exists private;/i);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

function installFakeCommandDriver(directory) {
  const driverPath = join(directory, "command-driver.mjs");
  writeFileSync(
    driverPath,
    `import { appendFileSync, copyFileSync } from "node:fs";\n` +
      `const [command, ...args] = process.argv.slice(2);\n` +
      `appendFileSync(process.env.FAKE_DOCKER_LOG, [command, ...args].join(" ") + "\\n");\n` +
      `if (args[0] === "cp" && args[2]?.endsWith("/tmp/migration-rehearsal.sql")) {\n` +
      `  copyFileSync(args[1], process.env.FAKE_DOCKER_CAPTURE);\n` +
      `}\n` +
      `if (args.includes("pg_dump")) process.stdout.write("-- deterministic schema\\n");\n` +
      `else if (args.includes("psql")) process.stdout.write("170000|0\\n");\n`,
    "utf8",
  );
  return driverPath;
}
