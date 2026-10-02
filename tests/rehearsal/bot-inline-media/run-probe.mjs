import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

const owner = randomUUID(), tag = `letscube-bot-inline-probe:${owner}`, name = `letscube-bot-probe-${owner}`;
const root = fileURLToPath(new URL("../../../", import.meta.url));
const exportFixtures = process.argv.includes("--export-fixtures");
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const sshArgs = ["-i", "C:/Users/maksi/.ssh/letscube_ed25519", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "root@ms.letscube.ru"];
let image, container;
function ssh(args, input, timeout = 120_000) {
  const child = spawn("ssh", [...sshArgs, args.map(quote).join(" ")]);
  let stdout = "", stderr = "";
  child.stdout.on("data", part => { stdout += part; });
  child.stderr.on("data", part => { stderr += part; });
  child.stdin.on("error", () => {});
  const timer = setTimeout(() => child.kill(), timeout);
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout: stdout.trim(), stderr }); });
  });
  if (input) input.pipe(child.stdin); else child.stdin.end();
  return done;
}
async function docker(args) {
  const result = await ssh(["docker", ...args]);
  assert.equal(result.code, 0, `isolated ${args[0]} failed: ${result.stderr.slice(-1200)}`);
  return result.stdout;
}
async function verifyImage() {
  const [state] = JSON.parse(await docker(["image", "inspect", image]));
  assert.equal(state.Id, image); assert.equal(state.Config.Labels["letscube.bot-probe.owner"], owner);
}
async function verifyContainer() {
  const [state] = JSON.parse(await docker(["inspect", container]));
  assert.equal(state.Id, container); assert.equal(state.Image, image); assert.equal(state.Name, `/${name}`);
  assert.equal(state.Config.Labels["letscube.bot-probe.owner"], owner);
  assert.equal(state.HostConfig.NetworkMode, "none"); assert.equal(state.HostConfig.Privileged, false);
  assert.equal(state.HostConfig.ReadonlyRootfs, true); assert.equal(state.Config.User, "node");
  assert.deepEqual(state.HostConfig.PortBindings, {});
  assert.ok(state.Mounts.every(mount => !["bind", "volume"].includes(mount.Type)));
}
try {
  const tar = spawn("tar", ["-cf", "-", "-C", `${root}/output/bot-inline-media-20261002`, "inlineMedia.mjs",
    "-C", `${root}/tests/rehearsal/bot-inline-media`, "probe.mjs", "Dockerfile.probe"]);
  const tarDone = new Promise((resolve, reject) => { tar.on("error", reject); tar.on("close", resolve); });
  const built = await ssh(["docker", "build", "--label", `letscube.bot-probe.owner=${owner}`, "-t", tag, "-f", "Dockerfile.probe", "-"], tar.stdout, 180_000);
  assert.equal(await tarDone, 0); assert.equal(built.code, 0, `probe image build failed: ${built.stderr.slice(-1200)}`);
  image = await docker(["image", "inspect", tag, "--format", "{{.Id}}"]);
  assert.match(image, /^sha256:[a-f0-9]{64}$/); await verifyImage();
  container = await docker(["create", "--name", name, "--label", `letscube.bot-probe.owner=${owner}`, "--network", "none",
    "--memory", "256m", "--cpus", "1", "--pids-limit", "64", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--tmpfs", "/tmp:rw,size=64m,mode=1777", "-e", "LETSCUBE_SYNTHETIC_PROBE=1",
    "-e", `LETSCUBE_EXPORT_SYNTHETIC=${exportFixtures ? "1" : "0"}`, image]);
  assert.match(container, /^[a-f0-9]{64}$/); await verifyContainer();
  const result = await ssh(["docker", "start", "-a", container]);
  assert.equal(result.code, 0, result.stderr.slice(-2000));
  assert.equal(await docker(["inspect", container, "--format", "{{.State.ExitCode}}"]), "0", result.stderr.slice(-2000));
  const lines = result.stdout.split("\n");
  if (exportFixtures) {
    const encoded = lines.filter(line => line.startsWith("SYNTHETIC_FIXTURES:"));
    assert.equal(encoded.length, 1);
    const fixtures = JSON.parse(encoded[0].slice("SYNTHETIC_FIXTURES:".length));
    assert.equal(fixtures.length, 6);
    for (const fixture of fixtures) {
      const bytes = Buffer.from(fixture.bytes_base64, "base64");
      assert.ok(bytes.length > 0 && bytes.length < 6_291_456);
      assert.equal(bytes.toString("base64"), fixture.bytes_base64);
    }
    await writeFile(`${root}/output/bot-inline-media-20261002/synthetic-fixtures.json`, JSON.stringify(fixtures), { mode: 0o600 });
  }
  console.log(lines.filter(line => !line.startsWith("SYNTHETIC_FIXTURES:")).join("\n"));
} finally {
  if (container) { await verifyContainer(); await docker(["rm", "-f", container]); }
  if (image) { await verifyImage(); await docker(["image", "rm", image]); }
}
