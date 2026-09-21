import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { chromium } from "@playwright/test";

const read = (name) => readFileSync(new URL(`../ui/${name}`, import.meta.url), "utf8");
const origin = "https://app.letscube.ru";
const readiness = read("app-readiness.js")
  .replaceAll("__LETSCUBE_PRODUCTION_ORIGIN__", JSON.stringify(origin));
const overlay = read("startup-overlay.js")
  .replaceAll("__LETSCUBE_PRODUCTION_ORIGIN__", JSON.stringify(origin))
  .replaceAll("__LETSCUBE_STARTUP_EVENT__", JSON.stringify("letscube://startup-state"))
  .replaceAll("__LETSCUBE_OVERLAY_CSS__", JSON.stringify(read("startup-overlay.css")))
  .replaceAll("__LETSCUBE_OVERLAY_HTML__", JSON.stringify(read("startup-overlay.html")
    .replace("__LETSCUBE_LOGO_SVG__", read("letscube-logo.svg"))));
let browser;
before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0", "run with the repository's no-mutations guard");
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

async function fixture(t, { head = "", scripts = [readiness, overlay], url = origin } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  t.after(() => context.close());
  // No server, credentials, saved profile, screenshots, or remote requests.
  await context.route("**/*", (route) => route.fulfill({ contentType: "text/html", body:
    `<!doctype html><html><head>${head}</head><body><div id="root"></div><button id="retry">Retry</button></body></html>` }));
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  for (const content of scripts) await page.addInitScript({ content });
  await page.goto(url);
  return page;
}

const host = (page) => page.locator('[data-testid="production-startup-overlay"]');
const complete = (page, documentId) => page.evaluate((documentId) => window.dispatchEvent(new CustomEvent("letscube://startup-state", {
  detail: {
    stage: "complete", connected: true,
    documentId: documentId ?? window.__letscubeReadiness?.().documentId,
    peer: { observedSha256: "ab".repeat(32), expectedSha256: "ab".repeat(32) },
  },
})), documentId);
const appReady = (page) => page.evaluate(() => {
  document.getElementById("root").dataset.kubAppReady = "true";
  document.documentElement.dataset.kubBootState = "ready";
  window.dispatchEvent(new CustomEvent("letscube:app-rendered"));
});
const receipt = (page) => page.evaluate(() => window.__letscubeReadiness?.());
const fail = (page) => page.evaluate(() => {
  document.documentElement.dataset.kubBootState = "failed";
  window.dispatchEvent(new CustomEvent("letscube:boot-failed", { detail: { ignored: "fixture-only" } }));
});

test("a native Finished/Complete snapshot cannot declare an uncommitted workspace ready", async (t) => {
  const page = await fixture(t);
  await complete(page);
  assert.equal(await host(page).getAttribute("data-connected"), "false");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("letscube:startup-overlay-complete")), null);
});

test("pre-React failure uncovers retry immediately without recording a successful workspace", async (t) => {
  const page = await fixture(t);
  await fail(page);
  assert.equal(await host(page).count(), 0);
  await page.locator("#retry").click();
  assert.equal(await page.evaluate(() => sessionStorage.getItem("letscube:startup-overlay-complete")), null);
});

test("receipt requires the event and ready markers on the currently committed root", async (t) => {
  const page = await fixture(t);
  assert.equal((await receipt(page)).state, "pending");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("letscube:app-rendered")));
  assert.equal((await receipt(page)).state, "pending");
  await page.evaluate(() => {
    document.getElementById("root").dataset.kubAppReady = "true";
    document.documentElement.dataset.kubBootState = "ready";
  });
  assert.equal((await receipt(page)).state, "pending", "markers cannot substitute for a commit event");
  await appReady(page);
  assert.equal((await receipt(page)).state, "ready");
  await page.evaluate(() => {
    const root = document.getElementById("root");
    root.replaceWith(root.cloneNode(true));
  });
  assert.equal((await receipt(page)).state, "pending", "a replacement root cannot reuse the old receipt");
  await appReady(page);
  assert.equal((await receipt(page)).state, "ready", "a committed error-boundary surface uses the same contract");
});

test("an early app event is retained without native bridge and native completion keeps the approved pacing and peer", async (t) => {
  const page = await fixture(t, { head: `<script>
    const root = document.createElement('div'); root.id = 'root';
    root.dataset.kubAppReady = 'true'; document.head.append(root);
    document.documentElement.dataset.kubBootState = 'ready';
    window.dispatchEvent(new CustomEvent('letscube:app-rendered'));
  </script>` });
  assert.equal((await receipt(page)).state, "ready");
  assert.equal(await page.evaluate(() => typeof window.letscubeDesktop), "undefined");
  await complete(page);
  assert.equal(await host(page).getAttribute("data-connected"), "true");
  assert.match(await page.locator('[data-testid="production-startup-server-fingerprint"]').textContent(), /AB:AB:AB:AB/);
  await page.clock.runFor(2199);
  assert.equal(await host(page).count(), 1);
  await page.clock.runFor(400);
  assert.equal(await host(page).count(), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("letscube:startup-overlay-complete")), "1");
});

test("a late app event waits for a fresh native receipt, not an earlier Complete snapshot", async (t) => {
  const page = await fixture(t);
  await complete(page);
  await appReady(page);
  assert.equal(await host(page).getAttribute("data-connected"), "false");
  await complete(page);
  assert.equal(await host(page).getAttribute("data-connected"), "true");
});

test("the web boot listener may set bootState after the native app-rendered listener", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    document.documentElement.dataset.kubBootState = "loading";
    window.addEventListener("letscube:app-rendered", () => {
      document.documentElement.dataset.kubBootState = "ready";
    }, { once: true });
    document.getElementById("root").dataset.kubAppReady = "true";
    window.dispatchEvent(new CustomEvent("letscube:app-rendered"));
  });
  assert.equal((await receipt(page)).state, "ready");
  await complete(page);
  assert.equal(await host(page).getAttribute("data-connected"), "true");
});

test("failure before DOMContentLoaded suppresses overlay mounting", async (t) => {
  const page = await fixture(t, { head: `<script>
    document.documentElement.dataset.kubBootState = 'failed';
    window.dispatchEvent(new CustomEvent('letscube:boot-failed'));
  </script>` });
  assert.equal(await host(page).count(), 0);
  assert.equal((await receipt(page)).state, "failed");
});

test("failure cancels success persistence but a fresh late commit can recover without resurrecting the overlay", async (t) => {
  const page = await fixture(t);
  await appReady(page);
  await complete(page);
  await fail(page);
  assert.equal((await receipt(page)).state, "failed");
  await page.evaluate(() => { document.documentElement.dataset.kubBootState = "ready"; });
  assert.notEqual((await receipt(page)).state, "ready", "old commit cannot recover a failed boot");
  await appReady(page);
  await complete(page);
  await page.clock.runFor(4000);
  assert.equal((await receipt(page)).state, "ready");
  assert.equal(await host(page).count(), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("letscube:startup-overlay-complete")), null);
});

test("the loading recovery surface is not a failure and timeout can recover on a late committed root", async (t) => {
  const page = await fixture(t, { head: `<script>
    document.documentElement.dataset.kubBootState = 'loading';
  </script>` });
  await page.evaluate(() => {
    const recovery = document.createElement("section");
    recovery.id = "kub-boot-recovery";
    recovery.textContent = "LETSCUBE loading";
    document.body.append(recovery);
  });
  assert.equal((await receipt(page)).state, "pending");
  assert.equal(await host(page).count(), 1);
  await fail(page);
  assert.equal(await host(page).count(), 0);
  await page.evaluate(() => {
    window.addEventListener("letscube:app-rendered", () => {
      document.documentElement.dataset.kubBootState = "ready";
      document.getElementById("kub-boot-recovery").remove();
    }, { once: true });
    const root = document.getElementById("root");
    root.append(document.createElement("main"));
    root.dataset.kubAppReady = "true";
    window.dispatchEvent(new CustomEvent("letscube:app-rendered"));
  });
  assert.equal((await receipt(page)).state, "ready");
  assert.equal(await page.locator("#kub-boot-recovery").count(), 0);
  assert.equal(await host(page).count(), 0);
});

test("a missing native receipt uncovers retry at the bounded deadline, never success", async (t) => {
  const page = await fixture(t);
  await page.clock.runFor(29_999);
  assert.equal(await host(page).count(), 1);
  await page.clock.runFor(1);
  assert.equal(await host(page).count(), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("letscube:startup-overlay-complete")), null);
  assert.equal((await receipt(page)).state, "pending");
});

test("a 35-second web commit stays usable after native timeout without fake success or navigation", async (t) => {
  const url = `${origin}/chat/fixture?returnTo=%2Fchat%2Ffixture#message-fixture`;
  const page = await fixture(t, { url });
  const documentId = (await receipt(page)).documentId;
  await fail(page);
  await page.clock.runFor(30_000);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("letscube://startup-state", {
    detail: { stage: "workspace_unconfirmed", connected: false, errorCode: null },
  })));
  await page.clock.runFor(5000);
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "live-interface";
    button.textContent = "Fixture action";
    button.onclick = () => { button.dataset.clicked = "true"; };
    document.getElementById("root").append(button);
  });
  await appReady(page);
  assert.equal((await receipt(page)).state, "ready");
  assert.equal((await receipt(page)).documentId, documentId);
  assert.equal(page.url(), url);
  assert.equal(await host(page).count(), 0);
  await page.locator("#live-interface").click();
  assert.equal(await page.locator("#live-interface").getAttribute("data-clicked"), "true");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("letscube:startup-overlay-complete")), null);
});

test("same-document history cannot create a commit and a new document rejects the previous receipt", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => history.pushState({}, "", "/chat/fixture#same-document"));
  await complete(page);
  assert.equal(await host(page).getAttribute("data-connected"), "false");
  await appReady(page);
  const old = (await receipt(page)).documentId;
  await page.reload();
  const current = await receipt(page);
  assert.notEqual(current.documentId, old);
  assert.equal(current.state, "pending");
  await appReady(page);
  await complete(page, old);
  assert.equal(await host(page).getAttribute("data-connected"), "false");
  await complete(page);
  assert.equal(await host(page).getAttribute("data-connected"), "true");
});

test("pagehide invalidates a receipt, including a restored cached document", async (t) => {
  const page = await fixture(t);
  await appReady(page);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await appReady(page);
  await complete(page);
  assert.equal((await receipt(page)).state, "inactive");
  assert.equal(await host(page).getAttribute("data-connected"), "false");
});

test("native same-document navigation cancels an old success hold and seals the previous receipt", async (t) => {
  const page = await fixture(t);
  await appReady(page);
  const old = (await receipt(page)).documentId;
  await complete(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("letscube:native-navigation")));
  await appReady(page);
  await complete(page, old);
  await page.clock.runFor(4000);
  assert.equal((await receipt(page)).state, "inactive");
  assert.equal(await host(page).count(), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("letscube:startup-overlay-complete")), null);
});

test("losing the committed root during the success hold cannot persist completion", async (t) => {
  const page = await fixture(t);
  await appReady(page);
  await complete(page);
  await page.evaluate(() => document.getElementById("root").remove());
  await page.clock.runFor(4000);
  assert.equal(await host(page).count(), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("letscube:startup-overlay-complete")), null);
});

test("origin near-matches and subframes never receive the native receipt runtime", async (t) => {
  for (const url of ["http://app.letscube.ru", "https://app.letscube.ru:444", "https://app.letscube.ru.invalid", "https://other.letscube.ru"]) {
    const page = await fixture(t, { url });
    assert.equal(await receipt(page), undefined);
    assert.equal(await host(page).count(), 0);
  }
  const page = await fixture(t);
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.srcdoc = '<div id="root"></div>';
    document.body.append(frame);
  });
  await page.waitForFunction(() => document.querySelector("iframe").contentDocument?.readyState === "complete");
  assert.equal(await page.frames()[1].evaluate(() => typeof window.__letscubeReadiness), "undefined");
});

test("blocked storage and untrusted failure detail cannot crash or fabricate readiness", async (t) => {
  const page = await fixture(t, { scripts: [
    `Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('fixture denial'); } });`,
    readiness, overlay,
  ] });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("letscube:boot-failed", {
    detail: { state: "failed", documentId: "untrusted" },
  })));
  assert.equal(await host(page).count(), 1);
  const value = await receipt(page);
  assert.deepEqual(Object.keys(value).sort(), ["documentId", "loaded", "state"]);
  assert.equal(value.state, "pending");
  await fail(page);
  assert.equal(await host(page).count(), 0);
});
