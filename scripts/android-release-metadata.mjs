import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const POSITIVE_SAFE_INTEGER_PATTERN = /^[1-9]\d*$/;

function parseProperties(text, path) {
  const properties = new Map();

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) {
      throw new Error(`${path}:${index + 1} must use KEY=VALUE syntax.`);
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key || properties.has(key)) {
      throw new Error(`${path}:${index + 1} contains an invalid or duplicate property.`);
    }
    properties.set(key, value);
  }

  return properties;
}

export function readAndroidReleaseMetadata(root) {
  const path = resolve(root, "android/version.properties");
  const properties = parseProperties(readFileSync(path, "utf8"), path);
  const versionName = properties.get("VERSION_NAME");
  const versionCodeText = properties.get("VERSION_CODE");

  if (!versionName || !SEMVER_PATTERN.test(versionName)) {
    throw new Error(`${path} has an invalid VERSION_NAME.`);
  }
  if (!versionCodeText || !POSITIVE_SAFE_INTEGER_PATTERN.test(versionCodeText)) {
    throw new Error(`${path} has an invalid VERSION_CODE.`);
  }

  const versionCode = Number(versionCodeText);
  if (!Number.isSafeInteger(versionCode)) {
    throw new Error(`${path} has an invalid VERSION_CODE.`);
  }

  return { versionName, versionCode };
}
