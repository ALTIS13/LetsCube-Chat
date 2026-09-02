import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";

import { PAGE_CHECKS, checkFocusVisibility } from "../../scripts/interface-audit.mjs";

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
