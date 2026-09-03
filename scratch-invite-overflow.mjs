import { chromium } from "@playwright/test";

/**
 * Overflow on the Windows client's screen while registration is invite-only.
 *
 * The Windows window is 1360x860 by default with a 960x640 minimum, and the
 * auth shell owns its own vertical scrolling — so the question is whether the
 * invite-only state, which adds a code field and an explanation, pushes content
 * out of a window a person can actually have.
 */

const BASE = process.argv[2] ?? "https://app.letscube.ru";

const browser = await chromium.launch();

for (const [width, height, label] of [
  [1360, 860, "Windows default"],
  [960, 640, "Windows minimum"],
  [1360, 700, "short window"],
]) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: "dark",
    locale: "ru-RU",
    // The shell is a native WebView, and the app reads that to change routing
    // and the install prompts.
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0 letscube-desktop",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    // The shell marks itself, which is what the app checks for a native shell.
    Object.defineProperty(window, "__LETSCUBE_DESKTOP__", { value: true, configurable: true });
  });

  await page.goto(`${BASE}/register`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const overflowing = [];
    for (const node of document.querySelectorAll("*")) {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > window.innerWidth + 1 || box.left < -1) {
        const style = window.getComputedStyle(node);
        if (style.position === "fixed" && box.width >= window.innerWidth) continue;
        overflowing.push({
          tag: `${node.tagName}.${(node.className || "").toString().slice(0, 30)}`,
          left: Math.round(box.left),
          right: Math.round(box.right),
        });
      }
    }
    // Anything the person cannot reach at all.
    const submit = [...document.querySelectorAll("button")].find((node) =>
      /Создать|Зарегистр|Продолжить/i.test(node.textContent ?? ""),
    );
    const submitBox = submit?.getBoundingClientRect() ?? null;
    return {
      text: (body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 90),
      pageScrollsHorizontally: doc.scrollWidth > window.innerWidth + 1,
      verticalOverflow: Math.max(0, doc.scrollHeight - window.innerHeight),
      overflowing: overflowing.slice(0, 5),
      submitVisible: submitBox
        ? submitBox.top >= 0 && submitBox.bottom <= window.innerHeight + 1
        : null,
      submitBottom: submitBox ? Math.round(submitBox.bottom) : null,
      innerHeight: window.innerHeight,
    };
  });

  console.log(`\n${label} (${width}x${height}):`);
  console.log(`  showing: "${report.text}"`);
  console.log(
    `  horizontal page scroll: ${report.pageScrollsHorizontally} · content taller than the window by ${report.verticalOverflow}px`,
  );
  console.log(`  submit reachable without scrolling: ${report.submitVisible} (bottom ${report.submitBottom} of ${report.innerHeight})`);
  for (const entry of report.overflowing) {
    console.log(`  overflows sideways: ${entry.tag} left ${entry.left} right ${entry.right}`);
  }
  await page.screenshot({ path: `output/windows/invite-${width}x${height}.png`, fullPage: false });
  await context.close();
}

await browser.close();
