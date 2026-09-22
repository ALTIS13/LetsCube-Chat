import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = new URL('../../../', import.meta.url);
const output = new URL('output/native-boot-android/', root);
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function extract(html) {
  const controllers = [...html.matchAll(/<script\b[^>]*id="kub-boot-controller"[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(controllers.length, 1, 'Exactly one current-source boot controller is required');
  const fragments = [...html.matchAll(/<style id="kub-boot-style">[\s\S]*?<\/style>\s*<section id="kub-boot-recovery"[\s\S]*?<\/section>\s*<script id="kub-boot-controller">[\s\S]*?<\/script>/g)];
  assert.equal(fragments.length, 1, 'Fail closed when the source boot fragment changes shape');
  return { fragment: fragments[0][0], controller: controllers[0][1] };
}

export function prepare() {
  const html = readFileSync(new URL('artifacts/kub/index.html', root), 'utf8');
  const { fragment, controller } = extract(html);
  const observer = `<script>
window.__qa = { failures: 0, rejections: 0, failedAt: null, entryStarted: false, createdAt: performance.now() };
window.addEventListener('unhandledrejection', function () { window.__qa.rejections++; });
window.addEventListener('letscube:boot-failed', function () {
  window.__qa.failures++; window.__qa.failedAt = performance.now();
});
</script>`;
  const document = (part) => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
</head><body><div id="root"></div>${observer}${part}<script type="module" src="/entry.js"></script></body></html>`;
  const assets = new URL('assets/', output);
  mkdirSync(assets, { recursive: true });
  writeFileSync(new URL('boot.html', assets), document(fragment));
  const mutations = {
    'no-deadline': ['window.setTimeout(failed, 12000)', 'window.setTimeout(function () {}, 12000)'],
    'no-ready-guard': ['if (!app || app.dataset.kubAppReady !== "true" || !app.childElementCount) return;', 'if (!app) return;'],
    'no-reload': ['window.location.reload();', 'void 0;'],
  };
  for (const [name, [before, after]] of Object.entries(mutations)) {
    assert.equal(fragment.split(before).length, 2, `Mutation ${name} must have exactly one target`);
    writeFileSync(new URL(`${name}.html`, assets), document(fragment.replace(before, after)));
  }
  const logo = readFileSync(new URL('artifacts/kub/public/icons/icon-192.png', root));
  writeFileSync(new URL('icon.png', assets), logo);
  const receipt = {
    source: 'artifacts/kub/index.html', sourceSha256: sha256(html),
    controllerSha256: sha256(controller), fragmentSha256: sha256(fragment),
    fixtureSha256: sha256(document(fragment)), iconSha256: sha256(logo),
    extraction: 'Exact contiguous source bytes; controller, CSS and recovery markup unchanged',
    mutations: Object.keys(mutations),
  };
  writeFileSync(new URL('source-receipt.json', output), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(prepare()));
