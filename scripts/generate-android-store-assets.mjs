import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const darkSurface = "#17212b";

function featureSurface() {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
      <rect width="1024" height="500" fill="${darkSurface}"/>
      <rect x="512" width="1" height="500" fill="#253443"/>
      <text x="530" y="220" fill="#ffffff" font-family="Arial, sans-serif" font-size="64" font-weight="700">LETSCUBE</text>
      <text x="534" y="272" fill="#b8c6d5" font-family="Arial, sans-serif" font-size="27" font-weight="400">Messenger</text>
    </svg>`, "utf8");
}

async function renderPng(surface, mark, outputPath, width, height, markSize, left, top) {
  const markImage = await sharp(mark, { density: 300 })
    .resize(markSize.width, markSize.height, { fit: "contain", background: darkSurface })
    .flatten({ background: darkSurface })
    .removeAlpha()
    .png()
    .toBuffer();
  await sharp(surface)
    .resize(width, height, { fit: "fill" })
    .composite([{ input: markImage, left, top }])
    .flatten({ background: darkSurface })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(outputPath);
}

export async function generateAndroidStoreAssets(workspaceRoot = root) {
  const storeDirectory = resolve(workspaceRoot, "assets/android/store");
  const mark = readFileSync(resolve(workspaceRoot, "assets/logo.svg"));
  mkdirSync(storeDirectory, { recursive: true });

  await renderPng(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${darkSurface}"/></svg>`),
    mark,
    resolve(storeDirectory, "icon-512.png"),
    512,
    512,
    { width: 360, height: 400 },
    76,
    56,
  );
  await renderPng(featureSurface(), mark, resolve(storeDirectory, "feature-graphic-1024x500.png"), 1024, 500, { width: 330, height: 380 }, 90, 60);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  generateAndroidStoreAssets().catch((error) => {
    console.error(error instanceof Error ? error.message : "Android store asset generation failed.");
    process.exitCode = 1;
  });
}
