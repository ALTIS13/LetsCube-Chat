import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";

import {
  LATE_SHIFT_RECORDER,
  PAGE_CHECKS,
  assertStyled,
  checkFocusVisibility,
} from "../../scripts/interface-audit.mjs";

/**
 * The harness is only worth its output if it can find a defect that is
 * definitely there. Each case below plants exactly one defect class and asserts
 * the harness reports it; the control page asserts it does not invent any.
 *
 * This is the mutation check for the audit itself. Every finding the stage
 * records rests on it, so a silent harness would poison the whole register.
 */

const BASE_STYLE = `
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.4 system-ui, sans-serif; }
    button, a { font: inherit; color: #111111; background: #ffffff; }
  </style>
`;

async function findingsFor(html) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 }, colorScheme: "light" });
    const page = await context.newPage();
    await page.setContent(`${BASE_STYLE}<body>${html}</body>`, { waitUntil: "domcontentloaded" });
    const measured = await page.evaluate(PAGE_CHECKS);
    const focus = await checkFocusVisibility(page);
    await context.close();
    return [...measured, ...focus];
  } finally {
    await browser.close();
  }
}

const kinds = (findings) => new Set(findings.map((finding) => finding.kind));

/**
 * A real navigation to a page this file wrote.
 *
 * `page.setContent` writes into the document that is already open, which throws
 * away anything `addInitScript` installed into it — so a recorder that has to
 * start before the page does cannot be tested with it. Serving the markup from
 * a route and navigating there is what the harness itself does.
 */
async function gotoFixture(page, body) {
  await page.route("**/audit-fixture", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: `<body>${body}</body>` }),
  );
  await page.goto("https://audit.invalid/audit-fixture", { waitUntil: "domcontentloaded" });
}

const shiftRows = (page) =>
  page.evaluate(() => Array.from(window.__auditShift ?? [], ([id, record]) => ({ id, ...record })));

/**
 * Wait for something the recorder is supposed to have recorded, and say what
 * it holds instead when it never does. A bare `waitForFunction` timeout reports
 * only that a predicate stayed false, which is the least useful sentence
 * available about a recorder whose whole output is a table of numbers.
 *
 * The budget is generous on purpose: nothing here should take more than a few
 * frames, and a limit that is tight enough to be a stopwatch is the defect this
 * test had.
 */
async function waitForShift(page, predicate, expectation) {
  try {
    await page.waitForFunction(predicate, undefined, { timeout: 15_000 });
  } catch {
    assert.fail(`${expectation}; the recorder holds ${JSON.stringify(await shiftRows(page))}`);
  }
}

test("a page with nothing wrong produces no findings", async () => {
  const findings = await findingsFor(`
    <main style="padding:16px">
      <p style="color:#111111">Обычный текст с достаточным контрастом.</p>
      <button style="min-height:44px;min-width:120px;outline-offset:2px" onfocus="this.style.outline='2px solid #0b5'">
        Кнопка
      </button>
    </main>
  `);
  const found = kinds(findings);
  for (const kind of ["overflow-x-document", "clipped-horizontally", "text-clipped", "contrast"]) {
    assert.ok(!found.has(kind), `the harness invented a "${kind}" finding: ${JSON.stringify(findings, null, 1)}`);
  }
});

test("the harness sees a page that scrolls sideways", async () => {
  const findings = await findingsFor(`<div style="width:2000px;height:20px;background:#eee"></div>`);
  assert.ok(kinds(findings).has("overflow-x-document"), JSON.stringify(findings));
});

test("the harness sees a control clipped by its own box", async () => {
  const findings = await findingsFor(`
    <div style="width:100px;overflow-x:hidden;white-space:nowrap">
      <button style="margin-left:180px;min-height:44px">Скрытая кнопка</button>
    </div>
  `);
  assert.ok(kinds(findings).has("clipped-horizontally"), JSON.stringify(findings));
});

/**
 * A decorative image bleeding past a full-screen container is a design choice.
 * The first full run called the login page's mascot a 461px clipping defect at
 * every viewport; only content a person needs counts.
 */
test("a decorative image bleeding out of its container is not a defect", async () => {
  const findings = await findingsFor(`
    <div style="width:200px;height:120px;overflow-x:hidden;position:relative">
      <div style="position:absolute;left:150px;top:0;width:400px;height:120px;background:linear-gradient(#eee,#ddd)"></div>
      <p style="color:#111;position:relative">Текст на месте.</p>
    </div>
  `);
  const clipped = findings.filter((finding) => finding.kind === "clipped-horizontally");
  assert.equal(clipped.length, 0, `decorative bleed must not be a finding: ${JSON.stringify(clipped)}`);
});

test("the harness sees text cut off without an ellipsis", async () => {
  const findings = await findingsFor(`
    <p style="width:60px;overflow:hidden;white-space:nowrap;color:#111">
      Очень длинная строка, которая точно не помещается в узкую колонку
    </p>
  `);
  assert.ok(kinds(findings).has("text-clipped"), JSON.stringify(findings));
});

test("deliberate ellipsis truncation is not reported as a defect", async () => {
  const findings = await findingsFor(`
    <p style="width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#111">
      Очень длинная строка, обрезанная многоточием намеренно
    </p>
  `);
  assert.ok(!kinds(findings).has("text-clipped"), JSON.stringify(findings));
});

test("the harness sees an undersized touch target", async () => {
  const findings = await findingsFor(`<button style="height:24px;padding:0 8px">ок</button>`);
  const target = findings.find((finding) => finding.kind === "touch-target");
  assert.ok(target, JSON.stringify(findings));
  assert.equal(target.height, 24);
});

test("the harness sees text with too little contrast", async () => {
  const findings = await findingsFor(`<p style="color:#bbbbbb;background:#ffffff">Едва читаемый текст</p>`);
  const contrast = findings.find((finding) => finding.kind === "contrast");
  assert.ok(contrast, JSON.stringify(findings));
  assert.ok(contrast.ratio < 4.5, `reported ratio ${contrast.ratio} should be below the threshold`);
});

test("large text is held to the lower contrast threshold, not the body one", async () => {
  // 3.0:1 is the requirement for large text; this pair sits between the two
  // thresholds, so reporting it would be a false positive.
  const findings = await findingsFor(`
    <p style="color:#767676;background:#ffffff;font-size:32px">Крупный заголовок</p>
  `);
  assert.ok(!kinds(findings).has("contrast"), JSON.stringify(findings));
});

test("the harness sees a control that shows nothing when focused", async () => {
  const findings = await findingsFor(`
    <button style="outline:none;min-height:44px" aria-label="Без фокуса">Нажать</button>
  `);
  const focus = findings.find((finding) => finding.kind === "focus-invisible");
  assert.ok(focus, JSON.stringify(findings));
  assert.match(focus.selector, /Без фокуса/);
});

test("a control with a real focus style is not reported", async () => {
  const findings = await findingsFor(`
    <style>#ok:focus { outline: 2px solid #0b5; }</style>
    <button id="ok" style="min-height:44px">Нажать</button>
  `);
  const focus = findings.filter((finding) => finding.kind === "focus-invisible");
  assert.equal(focus.length, 0, JSON.stringify(focus));
});

/**
 * The regression that made this stage's first run produce three invented
 * findings. `:focus-visible` is what the product actually uses, and browsers do
 * not match it for scripted focus - only for keyboard navigation. A harness
 * that focuses programmatically calls every primary button in the product
 * broken.
 */
test("a control styled with :focus-visible is not reported as invisible", async () => {
  const findings = await findingsFor(`
    <style>#fv:focus-visible { outline: 2px solid #0b5; outline-offset: 2px; }</style>
    <button id="fv" style="min-height:44px" aria-label="Только focus-visible">Нажать</button>
  `);
  const focus = findings.filter((finding) => finding.kind === "focus-invisible");
  assert.equal(focus.length, 0, `:focus-visible styling must count as a visible focus indicator: ${JSON.stringify(focus)}`);
});

/**
 * Screen-reader-only labels are clipped deliberately. The first full run
 * reported three of them on one page as clipped text, which is the audit
 * reporting a working accessibility feature as a defect.
 */
test("screen-reader-only text is not reported as clipped", async () => {
  const findings = await findingsFor(`
    <style>
      .sr-only {
        position:absolute; width:1px; height:1px; padding:0; margin:-1px;
        overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0;
      }
    </style>
    <label class="sr-only">Исполнитель</label>
    <p style="color:#111">Видимый текст рядом.</p>
  `);
  const clipped = findings.filter((finding) => finding.kind === "text-clipped" || finding.kind === "clipped-horizontally");
  assert.equal(clipped.length, 0, `sr-only text must not be a finding: ${JSON.stringify(clipped)}`);
});

/**
 * A control that fills a bordered wrapper is as tappable as that wrapper. The
 * first run after the D-013 fix still reported 42px fields, because the missing
 * two pixels were the wrapper's own border.
 */
test("a control filling a 44px bordered wrapper is not an undersized target", async () => {
  const findings = await findingsFor(`
    <div style="display:flex;align-items:center;height:44px;border:1px solid #ccc;box-sizing:border-box;width:240px">
      <input style="height:100%;flex:1;border:0;outline:none" />
    </div>
  `);
  const targets = findings.filter((finding) => finding.kind === "touch-target");
  assert.equal(targets.length, 0, `a filled 44px field must not be a finding: ${JSON.stringify(targets)}`);
});

test("a small control inside a large wrapper it does not fill is still reported", async () => {
  const findings = await findingsFor(`
    <div style="height:80px;width:240px;display:flex;align-items:center">
      <button style="height:16px">x</button>
    </div>
  `);
  const target = findings.find((finding) => finding.kind === "touch-target");
  assert.ok(target, JSON.stringify(findings));
  assert.equal(target.height, 16);
});

/**
 * A checkbox wrapped in a label is toggled by the whole label; that is native
 * behaviour. Measuring the box alone reported the support form's 16px consent
 * checkbox as undersized while its padded row was the real target.
 */
test("a control wrapped in a padded label is measured by the label", async () => {
  const findings = await findingsFor(`
    <label style="display:flex;align-items:flex-start;gap:12px;padding:12px;border:1px solid #ccc">
      <input type="checkbox" style="width:16px;height:16px" />
      <span style="color:#111">Я ознакомился с условиями</span>
    </label>
  `);
  const targets = findings.filter((finding) => finding.kind === "touch-target");
  assert.equal(targets.length, 0, `a label-wrapped checkbox must not be a finding: ${JSON.stringify(targets)}`);
});

test("a bare checkbox with no label is still reported", async () => {
  const findings = await findingsFor(`<input type="checkbox" style="width:16px;height:16px" />`);
  const target = findings.find((finding) => finding.kind === "touch-target");
  assert.ok(target, JSON.stringify(findings));
});

/**
 * Both WCAG target-size criteria exempt a link inside a sentence: its height is
 * set by the line box of the surrounding text, and padding it to 44px would
 * break the paragraph. Measured on the live login and support pages, all three
 * reported links were of exactly this kind.
 *
 * The exception is worth only as much as its limit, so the second case is the
 * one that matters: a link alone in its container is a button in all but name,
 * gets no exemption, and must still be reported.
 */
test("a link inside a sentence is not an undersized target", async () => {
  const findings = await findingsFor(
    `<p style="font-size:12px">Нет аккаунта? <a href="/register" style="font-weight:600">Зарегистрироваться</a></p>`,
  );
  assert.equal(
    findings.find((finding) => finding.kind === "touch-target"),
    undefined,
    JSON.stringify(findings),
  );
});

test("a link standing alone is still held to the target size", async () => {
  const findings = await findingsFor(
    `<div><a href="/register" style="font-size:12px;font-weight:600">Зарегистрироваться</a></div>`,
  );
  assert.ok(
    findings.find((finding) => finding.kind === "touch-target"),
    `a link that is the whole of its container is a button, and must not be exempted: ${JSON.stringify(findings)}`,
  );
});

/**
 * The most expensive harness fault so far: a run where the stylesheet had not
 * loaded reported 549 findings across the staff area, all invented. Contrast
 * came out at exactly 1.00:1 and every element reported the default 16px,
 * because raw HTML was being measured. The guard must refuse that page.
 */
test("an unstyled page is refused rather than measured", async () => {
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.setContent("<body><h1>Без стилей</h1></body>", { waitUntil: "domcontentloaded" });
    await assert.rejects(() => assertStyled(page), /rendered unstyled/);
  } finally {
    await browser.close();
  }
});

test("a page carrying the design tokens is accepted", async () => {
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.setContent(
      "<style>:root{--kub-bg:#050B18}body{background:#050B18}</style><body><h1>Со стилями</h1></body>",
      { waitUntil: "domcontentloaded" },
    );
    const state = await assertStyled(page);
    assert.equal(state.token, "#050B18");
  } finally {
    await browser.close();
  }
});


/**
 * The three corrections from the 2026-09-05 sweep, each pinned in both
 * directions. Every one of them removed findings, which is the dangerous kind
 * of change: a filter that is slightly too eager makes the harness quiet
 * instead of wrong, and quiet is harder to notice.
 */

test("a parked, inert sub-view is not reported as clipped content", async () => {
  const findings = await findingsFor(`
    <div style="position:relative;width:300px;height:100px;overflow:hidden">
      <div style="position:absolute;inset:0">
        <button style="min-height:44px;min-width:120px">Видимая кнопка</button>
      </div>
      <div inert style="position:absolute;inset:0;opacity:0;transform:translateX(12%);pointer-events:none">
        <button style="min-height:44px;min-width:120px">Отложенная кнопка</button>
        <p>Медиа пока нет</p>
      </div>
    </div>
  `);
  assert.ok(
    !kinds(findings).has("clipped-horizontally"),
    `the parked sub-view was reported as clipped: ${JSON.stringify(findings, null, 1)}`,
  );
});

test("a visible layer pushed out of an overflow-hidden box is still reported", async () => {
  const findings = await findingsFor(`
    <div style="position:relative;width:300px;height:100px;overflow:hidden">
      <div style="position:absolute;inset:0;transform:translateX(12%)">
        <button style="min-height:44px;min-width:280px">Настоящая обрезанная кнопка</button>
      </div>
    </div>
  `);
  assert.ok(
    kinds(findings).has("clipped-horizontally"),
    `a layer that is on screen and cut off must still be reported: ${JSON.stringify(findings, null, 1)}`,
  );
});

test("a control covered by an opaque panel is not reported", async () => {
  const findings = await findingsFor(`
    <div style="position:relative;width:400px;height:200px">
      <button style="position:absolute;left:0;top:0;height:20px;width:20px">×</button>
      <div style="position:absolute;inset:0;background:#ffffff">
        <button style="min-height:44px;min-width:120px">Панель поверх</button>
      </div>
    </div>
  `);
  assert.ok(
    !findings.some((finding) => finding.kind === "touch-target" && (finding.text ?? "").includes("×")),
    `a control under an opaque panel was measured: ${JSON.stringify(findings, null, 1)}`,
  );
});

test("a control pushed past the viewport edge is not reported, one below the fold still is", async () => {
  const findings = await findingsFor(`
    <div style="position:absolute;left:900px;top:10px">
      <button style="height:20px;width:20px">вбок</button>
    </div>
    <div style="position:absolute;left:10px;top:2400px">
      <button style="height:20px;width:20px">вниз</button>
    </div>
  `);
  const targets = findings.filter((finding) => finding.kind === "touch-target");
  assert.ok(
    !targets.some((finding) => (finding.text ?? "").includes("вбок")),
    `a control off the side of a document that does not scroll sideways was measured: ${JSON.stringify(targets)}`,
  );
  assert.ok(
    targets.some((finding) => (finding.text ?? "").includes("вниз")),
    `a control below the fold must still be measured — a person scrolls to it: ${JSON.stringify(targets)}`,
  );
});

/**
 * The recorder that answers the D-032 / D-041 / D-043 question. It has to be
 * installed before the page's own script runs, so this drives it the way the
 * harness does rather than evaluating it after the fact.
 *
 * The growth is triggered from here rather than from a
 * `requestAnimationFrame(requestAnimationFrame(...))` chain inside the page,
 * and the waits are conditions rather than a 300 ms sleep. The earlier version
 * was a race between two things that have nothing to do with the contract: the
 * page's rAF chain is registered while the document is still parsing, and the
 * recorder attaches its ResizeObserver at `DOMContentLoaded`. On an idle
 * machine the parse finishes first and the row is observed at 40px. On a loaded
 * one the parser yields, two rendering opportunities fit before
 * `DOMContentLoaded`, and the recorder's first sight of the row is already
 * 80px — `first: 80, changes: 0`, an empty `changed`, and a red test that says
 * nothing except that the machine was busy. Measured: with the parser stalled
 * by a blocking script, and again at a 20x CPU throttle, the old fixture
 * produced exactly that; this one produces `first: 40, last: 80` under the same
 * throttle.
 *
 * What is still pinned is the whole contract: the recorder is installed before
 * the page renders (it must see the row at its authored 40px, which is asserted
 * before anything grows), it notices a height that changes afterwards, it keeps
 * both ends, and it leaves the untouched row alone.
 */
test("the late-shift recorder sees a row that grows after its first frame", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(LATE_SHIFT_RECORDER, "[data-message-id]");
    // `setContent` replaces the document the init script installed its
    // observers into, which silently loses them; the harness navigates, so this
    // navigates too.
    await gotoFixture(
      page,
      `${BASE_STYLE}
        <div data-message-id="a" style="height:40px;background:#eee">стабильная</div>
        <div data-message-id="b" style="height:40px;background:#ddd">растущая</div>`,
    );

    // Both rows recorded at the height the page itself rendered them. This is
    // the half of the contract that has to hold *before* anything moves, and
    // waiting for it is what the sleep used to be guessing at.
    await waitForShift(
      page,
      () =>
        window.__auditShift?.size === 2 &&
        Array.from(window.__auditShift.values()).every((record) => record.first === 40),
      "both rows should have been recorded at the 40px the page rendered them at",
    );

    await page.evaluate(() => {
      document.querySelector('[data-message-id="b"]').style.height = "80px";
    });
    await waitForShift(
      page,
      () => (window.__auditShift?.get("b")?.changes ?? 0) > 0,
      "the row grown to 80px should have been recorded as changed",
    );

    const rows = await shiftRows(page);
    const changed = rows.filter((row) => row.changes > 0);
    assert.deepEqual(changed.map((row) => row.id), ["b"], JSON.stringify(rows));
    assert.equal(changed[0].first, 40);
    assert.equal(changed[0].last, 80);
    assert.equal(changed[0].changes, 1);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("the late-shift recorder reports nothing when every row keeps its height", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(LATE_SHIFT_RECORDER, "[data-message-id]");
    await gotoFixture(
      page,
      `${BASE_STYLE}
        <div data-message-id="a" style="height:40px;background:#eee">одна</div>
        <div data-message-id="b" style="height:40px;background:#ddd">другая</div>`,
    );
    // Wait for the rows to be recorded rather than assuming 300 ms was enough
    // to record them; then hold still for a window in which a recorder that
    // invented a change would have recorded one. A negative assertion needs a
    // settle window — it just must not be the thing that decides whether the
    // positive half happened at all.
    await waitForShift(page, () => window.__auditShift?.size === 2, "both rows should have been recorded");
    await page.waitForTimeout(300);
    const observed = await page.evaluate(() => ({
      seen: (window.__auditShift ?? new Map()).size,
      changed: Array.from(window.__auditShift ?? [], ([, record]) => record).filter((r) => r.changes > 0).length,
    }));
    assert.equal(observed.seen, 2);
    assert.equal(observed.changed, 0);
    await context.close();
  } finally {
    await browser.close();
  }
});
