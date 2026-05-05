// Tiny GitHub webhook listener.
// Validates the X-Hub-Signature-256 HMAC, then runs deploy.sh in a child process.
// Run via systemd as the deploy user (see webhook.service).
//
// Env vars:
//   GITHUB_WEBHOOK_SECRET — must match the secret set in GitHub repo webhook
//   PORT                  — defaults to 9000
//   BRANCH                — branch to deploy (default: main)
//   DEPLOY_SCRIPT         — absolute path to deploy.sh (default: /var/www/neogram/deploy/deploy.sh)

import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const PORT = Number(process.env.PORT ?? 9000);
const BRANCH = process.env.BRANCH ?? "main";
const DEPLOY_SCRIPT =
  process.env.DEPLOY_SCRIPT ?? "/var/www/neogram/deploy/deploy.sh";

if (!SECRET) {
  console.error("FATAL: GITHUB_WEBHOOK_SECRET is not set");
  process.exit(1);
}

let deploying = false;
let queued = false;

function runDeploy() {
  if (deploying) {
    queued = true;
    return;
  }
  deploying = true;
  console.log(`[${new Date().toISOString()}] starting deploy.sh`);
  const child = spawn("bash", [DEPLOY_SCRIPT], { stdio: "inherit" });
  child.on("exit", (code) => {
    deploying = false;
    console.log(`[${new Date().toISOString()}] deploy.sh exited with code ${code}`);
    if (queued) {
      queued = false;
      runDeploy();
    }
  });
}

function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);

    if (!verifySignature(raw, req.headers["x-hub-signature-256"])) {
      console.warn("invalid signature from", req.socket.remoteAddress);
      res.writeHead(401).end("invalid signature");
      return;
    }

    const event = req.headers["x-github-event"];
    if (event === "ping") {
      res.writeHead(200).end("pong");
      return;
    }
    if (event !== "push") {
      res.writeHead(204).end();
      return;
    }

    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }

    if (payload.ref !== `refs/heads/${BRANCH}`) {
      console.log(`ignoring push to ${payload.ref}`);
      res.writeHead(202).end(`ignored (not ${BRANCH})`);
      return;
    }

    res.writeHead(202).end("accepted");
    runDeploy();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`webhook listening on 127.0.0.1:${PORT}, branch=${BRANCH}`);
});
