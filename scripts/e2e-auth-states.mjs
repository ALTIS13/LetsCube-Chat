#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const roles = ["owner", "tech_admin", "location_admin", "location_staff", "client"];
const outputDir = path.join(process.cwd(), "output", "playwright-auth");
const legacyOutput = path.join(process.cwd(), "output", "e2e-auth-state.json");
const env = loadEnvFile(process.env.KUB_QA_ENV_FILE || path.join(os.homedir(), ".kub-messenger-qa.env"));
const baseUrl = readEnv("KUB_QA_BASE_URL") || readEnv("KUB_BASE_URL") || "http://127.0.0.1:5173";

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const defaultCredentials = readCredentials("default");
  if (defaultCredentials) {
    await writeAuthState({ name: "default", credentials: defaultCredentials, outputPath: legacyOutput });
  } else {
    console.log("default: skipped (credentials are not configured)");
  }

  for (const role of roles) {
    const credentials = readCredentials(role);
    if (!credentials) {
      console.log(`${role}: skipped (credentials are not configured)`);
      continue;
    }
    await writeAuthState({
      name: role,
      credentials,
      outputPath: path.join(outputDir, `${role}.json`),
    });
  }
} finally {
  await browser.close();
}

async function writeAuthState({ name, credentials, outputPath }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"]').first().waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('input[type="email"]').first().fill(credentials.email);
    await page.locator('input[type="password"]').first().fill(credentials.password);
    await page.locator('button[type="submit"]').first().click();
    await page.locator('input[type="password"]').waitFor({ state: "detached", timeout: 20_000 }).catch(async () => {
      await page.locator('input[type="password"]').waitFor({ state: "hidden", timeout: 5_000 });
    });
    await page.waitForTimeout(1_000);
    await context.storageState({ path: outputPath });
    console.log(`${name}: saved ${path.relative(process.cwd(), outputPath)}`);
  } catch (error) {
    console.log(`${name}: failed to create auth state (${summarizeError(error)})`);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

function readCredentials(role) {
  const emailKey = role === "default" ? "KUB_QA_EMAIL" : ["KUB", "QA", role.toUpperCase(), "EMAIL"].join("_");
  const passwordKey = role === "default" ? ["KUB", "QA", "PASSWORD"].join("_") : ["KUB", "QA", role.toUpperCase(), "PASSWORD"].join("_");
  const email = readEnv(emailKey);
  const password = readEnv(passwordKey);
  return email && password ? { email, password } : null;
}

function readEnv(key) {
  return process.env[key] || env[key];
}

function loadEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    result[line.slice(0, index).trim()] = line
      .slice(index + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  return result;
}

function summarizeError(error) {
  if (!error) return "unknown error";
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/password=[^&\s]+/gi, "password=<redacted>").slice(0, 160);
}
