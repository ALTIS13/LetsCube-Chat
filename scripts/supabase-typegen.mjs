#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRef = process.env.SUPABASE_PROJECT_REF;
const schema = process.env.SUPABASE_SCHEMA || "public";
const outputFile =
  process.env.SUPABASE_TYPEGEN_OUT || "artifacts/kub/src/types/database.generated.ts";

if (!projectRef) {
  console.error(
    "SUPABASE_PROJECT_REF is required. Example: set SUPABASE_PROJECT_REF=<project-ref> && pnpm.cmd supabase:typegen",
  );
  process.exit(1);
}

const supabase = findSupabaseCli();
if (!supabase) {
  console.error(
    "Supabase CLI was not found in PATH. If installed with Scoop, open a new terminal or add ~/scoop/shims to PATH.",
  );
  process.exit(1);
}

const args = ["gen", "types", "typescript", "--project-id", projectRef, "--schema", schema];
const child = spawn(supabase, args, {
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
});

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

child.on("close", (code) => {
  if (code !== 0) {
    console.error(redact(stderr || `supabase gen types exited with code ${code}`));
    process.exit(code || 1);
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, stdout);
  console.log(`Generated ${outputFile} from schema "${schema}".`);
});

function findSupabaseCli() {
  const candidates = [
    process.env.SUPABASE_CLI_PATH,
    "supabase",
    path.join(
      os.homedir(),
      "scoop",
      "shims",
      process.platform === "win32" ? "supabase.exe" : "supabase",
    ),
    path.join(
      os.homedir(),
      "scoop",
      "apps",
      "supabase",
      "current",
      process.platform === "win32" ? "supabase.exe" : "supabase",
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "supabase" && commandExists(candidate)) return candidate;
    if (candidate !== "supabase" && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return result.status === 0;
}

function redact(value) {
  return value.replace(
    /(access_token|refresh_token|password|secret|service_role)[^\s]*/gi,
    "<redacted>",
  );
}
