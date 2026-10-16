import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {chromium} from '@playwright/test';

const source=readFileSync(new URL('../../android/app/src/androidTest/java/com/kub/messenger/NativeMessagePreviewUserChoiceTest.java',import.meta.url),'utf8');
function javaString(name) {
  const expression=source.match(new RegExp(`static final String ${name} =\\s*([\\s\\S]*?);\\r?\\n`))?.[1];
  assert.ok(expression);
  const parts=expression.match(/"(?:[^"\\]|\\.)*"/g)??[];
  assert.equal(expression.replace(/"(?:[^"\\]|\\.)*"/g,'').replace(/[+\s]/g,''),'');
  return parts.map(p=>JSON.parse(p)).join('');
}
const helpers=javaString('DOM_HELPERS'),probe=javaString('TARGET_PROBE');
const script=body=>`(()=>{const mode='menu',choice='none';${helpers}${body}})()`;
let browser;
test.before(async()=>{assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS,'0');browser=await chromium.launch({headless:true});});
test.after(async()=>{await browser?.close();});

for(const width of [1440,390])for(const theme of ['dark','light'])test(`real hit-test on rounded controls ${width}/${theme}`,async()=>{
  const context=await browser.newContext({viewport:{width,height:240},serviceWorkers:'block'});
  const page=await context.newPage();let requests=0;
  await page.route('**/*',route=>{requests++;return route.abort();});
  try {
    await page.setContent(`<html><head><title>LETSCUBE pointer fixture</title><style>
      body{margin:0;background:${theme==='dark'?'#10151b':'#f3f6fa'}}
      button{position:absolute;left:20px;top:40px;width:44px;height:44px;border:0;padding:0;background:#4285c9;color:white}
      #cover{display:none;position:absolute;left:40px;top:60px;width:4px;height:4px;background:#e43c78;z-index:2}
    </style></head><body><button aria-label="Меню"><span>QA</span></button><div id="cover"></div></body></html>`);
    assert.equal(await page.title(),'LETSCUBE pointer fixture');
    const rectangle=await page.evaluate(script(probe));
    assert.deepEqual(rectangle,[42,62,20,40,64,84,width,240],'rectangular calibration is measurable');
    await page.locator('button').evaluate(e=>{e.style.borderRadius='8px';});
    assert.deepEqual(await page.evaluate(script(probe)),rectangle,'rounded rectangle keeps the real center tappable');
    await page.locator('button').evaluate(e=>{e.style.borderRadius='50%';});
    assert.deepEqual(await page.evaluate(script(probe)),rectangle,'circular avatar keeps the real center tappable');
    await page.locator('#cover').evaluate(e=>{e.style.display='block';});
    assert.equal(await page.evaluate(script(probe)),null,'actual intended tap point is occluded');
    const mutant=probe.replace('if(!points.every(p=>hit(p[0],p[1])))return null;','');
    assert.notEqual(mutant,probe,'actual hit-test mutation applied');
    assert.notEqual(await page.evaluate(script(mutant)),null,'removing the hit test kills the overlay regression');
    assert.equal(requests,0,'fixture has no backend or Auth request');
  }finally{await context.close();}
});
