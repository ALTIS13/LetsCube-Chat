import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import test from 'node:test';

const src=fileURLToPath(new URL('../../artifacts/kub/src/',import.meta.url));
const root=path.dirname(src);
const requireKub=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url));
const {chromium}=requireKub('@playwright/test');
const {build}=createRequire(requireKub.resolve('vite'))('esbuild');
let browser,server,origin,bundle;
const leaf='export const ';
const stubs=new Map([
  ['@/lib/supabase/client',`${leaf}createClient=()=>({from(){throw Error('Unexpected fixture DB access');}});`],
  ['@/hooks/useTheme',`${leaf}useTheme=()=>({theme:window.fixture.theme,resolvedTheme:window.fixture.theme,setTheme(){}});`],
  ['@/hooks/useMessageTextSize',`${leaf}useMessageTextSize=()=>({size:15,setSize(){}});`],
  ['@/hooks/usePrivacyPreferences',`${leaf}usePrivacyPreferences=()=>({preferences:{presenceVisible:true,forwardOriginVisible:true},loading:false});`],
  ['@/hooks/useSessionDevices',`${leaf}useSessionDevices=()=>({devices:[],loading:false,error:null});`],
  ['@/hooks/usePush',`${leaf}usePush=()=>({status:'inactive',preferences:{messages:true,tasks:true,invites:true},loadingPreferences:false,readyForPrompt:true});`],
  ['@/hooks/useNativeMessagePreview',`${leaf}useNativeMessagePreview=()=>({savedChoice:'none',available:false});`],
  ['@/hooks/useWebMessagePreview',`${leaf}useWebMessagePreview=()=>({savedChoice:'none',available:false});`],
  ['@/hooks/usePwaUpdate',`${leaf}usePwaUpdate=()=>null;`],
  ['@/hooks/useVoiceCall',`${leaf}useVoiceCall=()=>({phase:'idle',channelId:null});`],
  ['@/hooks/useAudioSettings',`${leaf}useAudioSettings=()=>({settings:{processingMode:'clean',selectedInputDeviceId:'default',micInputGain:1}});`],
  ['@/hooks/useRole',`${leaf}useIsAdmin=()=>false;export const useIsManagerOrAdmin=()=>false;`],
  ['@/hooks/usePersonalModeration',`${leaf}usePersonalBlocks=()=>({blocked:[],people:[],loading:false,error:null});`],
  ['@/components/ui/ChatAvatar',`${leaf}UserAvatar=()=>null;`],
  ['@/components/presence/StatusPicker',`${leaf}StatusPicker=()=>null;export const useChosenStatus=()=>({status:'online',untilLabel:null});`],
  ['@/components/sidebar/PhoneSection',`${leaf}PhoneSection=()=>null;`],
  ['@/components/sidebar/AudioSettingsSection',`${leaf}AudioSettingsSection=()=>null;`],
  ['@/components/layout/BottomNav',`${leaf}BottomNav=()=>null;`],
  ['@/lib/platform/capabilities',`${leaf}isNativeApp=()=>false;export const isNativeAndroid=()=>false;export const getCurrentDistributionTarget=()=> 'windows_download';`],
  ['@/lib/platform/desktop',`${leaf}isDesktopApp=()=>false;export const getDesktopRuntimeInfo=async()=>null;`],
  ['@/lib/monitoring',`${leaf}getBuildMetadata=()=>({version:'0.0.0-fixture'});export const reportError=()=>{};`],
  ['@/lib/media/mediaUrl',`${leaf}publicMediaObjectUrl=()=>null;`],
  ['@/lib/mediaUpload',`${leaf}avatarUploadPath=()=>'';export const prepareAvatarImage=async f=>f;export const validateAvatarImage=()=>null;export const validateAvatarUploadImage=()=>null;`],
  ['@/lib/appDialogs',`${leaf}requestAppConfirm=async()=>{window.fixture.commands.push('confirm');return false;};`],
  ['@/lib/actionFeedback',`${leaf}showActionFeedback=()=>{};`],
]);
for(const name of ['ReleaseDistributionSection','StorageSection','WindowsStartupSection','IosCallsSection','SessionDevicesSection','ProfileDecorationSection','PhoneSearchSetting']){
  stubs.set('@/components/settings/'+name,`${leaf}${name}=()=>null;`);
}

async function compile(change){
  let mutations=0;
  const result=await build({write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',target:'es2022',
    alias:{'@':src},define:{'process.env.NODE_ENV':'"development"','import.meta.env':JSON.stringify({BASE_URL:'/',DEV:false})},
    plugins:[{name:'synthetic-settings-leaves',setup(plugin){
      plugin.onResolve({filter:/^@\//},args=>stubs.has(args.path)?{path:args.path,namespace:'fixture'}:undefined);
      plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',contents:stubs.get(args.path)}));
      plugin.onLoad({filter:/components[\\/]kub[\\/]index\.ts$/},()=>({loader:'ts',contents:`
        export {KubButton} from './KubButton';export {KubIcon} from './KubIcon';export {KubSwitch} from './KubSwitch';export {KubModal} from './KubModal';`}));
      plugin.onLoad({filter:/store[\\/]app\.store\.ts$/},()=>({loader:'ts',contents:`
        import {create} from 'zustand';
        export const useAppStore=create(()=>({currentUser:{id:'fictional-owner',full_name:'Тестовый профиль',username:'fixture',bio:null,avatar_url:null},
          accountEpoch:1,settingsFocus:null,selectedChatId:'fictional-chat',drafts:{'fictional-chat':'unsent synthetic draft'},
          call:{id:'fictional-call',joined:true},setCurrentUser(){window.fixture.commands.push('setCurrentUser');}}));
        window.fixtureStore=useAppStore;`}));
      if(change)plugin.onLoad({filter:/SettingsScreen\.tsx$/},async args=>{
        const text=(await readFile(args.path,'utf8')).replaceAll('\r\n','\n');assert.equal(text.split(change.before).length-1,1);mutations++;
        return{loader:'tsx',contents:text.replace(change.before,change.after)};
      });
    }}],stdin:{resolveDir:src,sourcefile:'settings-changelog-fixture.tsx',loader:'tsx',contents:`
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {useSettingsScreen} from './components/settings/SettingsScreen';
      import {SettingsOverlay} from './components/settings/SettingsOverlay';
      window.fixture={theme:document.documentElement.classList.contains('dark')?'dark':'light',commands:[]};
      function Screen({close}){const screen=useSettingsScreen({onClose:close});return <SettingsOverlay screen={screen}
        isPhone={innerWidth<768} profileTab={innerWidth<768} onProfileTabSelect={()=>window.fixture.commands.push('tab')}/>;}
      function App(){const [open,setOpen]=useState(true);return <><main aria-label="Синтетический чат">
        <input aria-label="Черновик сообщения" defaultValue="unsent synthetic draft"/><button onClick={()=>setOpen(true)}>Настройки</button>
        </main>{open&&<Screen close={()=>{window.fixture.commands.push('close');setOpen(false);}}/>}</>;}
      const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<App/>));
      window.unmount=()=>flushSync(()=>root.unmount());
    `}});
  if(change)assert.equal(mutations,1);
  return result.outputFiles[0].text;
}

test.before(async()=>{
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS,'0');
  bundle=await compile();
  const {createServer}=await import(pathToFileURL(requireKub.resolve('vite')).href);
  const {default:tailwind}=await import(pathToFileURL(requireKub.resolve('@tailwindcss/vite')).href);
  server=await createServer({configFile:false,root,appType:'custom',envDir:path.join(root,'.fixture-no-env'),plugins:[tailwind()],
    cacheDir:fileURLToPath(new URL(`../../.ops-private/ui-motion-updates-20261019/changelog/vite-${randomUUID()}/`,import.meta.url)),
    optimizeDeps:{noDiscovery:true,include:[],entries:[]},
    server:{host:'127.0.0.1',port:5191,strictPort:true},logLevel:'error'});
  server.middlewares.use((req,res,next)=>{
    if(req.url?.startsWith('/__settings-changelog')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>LETSCUBE Synthetic Settings</title><link rel="stylesheet" href="/src/index.css?direct"><div id="root"></div>');}
    else next();
  });
  await server.listen();origin=server.resolvedUrls.local[0];
  browser=await chromium.launch({headless:true,env:{...process.env,KUB_QA_ALLOW_MUTATIONS:'0'}});
});
test.after(async()=>{await browser?.close();await server?.close();});

function manifest(platform,overrides={}){return{schemaVersion:1,platform,channel:'stable',available:true,version:platform==='android'?'0.3.0':'0.2.0',
  build:platform==='android'?3:2,publishedAt:platform==='android'?'2026-10-18T09:00:00Z':'2026-10-17T09:00:00Z',
  minimumSupportedVersion:null,mandatory:false,notes:'Синтетические сведения о выпуске.',
  highlights:['Открытие чатов без лишнего ожидания','Новые настройки звука','Точный поиск в переписке','Удобные подписи к файлам','Обновлённые уведомления','Чёткое отображение фотографий'],
  artifact:{url:`https://api.letscube.ru/releases/files/${platform}/${platform==='android'?'0.3.0':'0.2.0'}/fixture.${platform==='android'?'apk':'exe'}`,size:1234,sha256:'a'.repeat(64)},...overrides};}

async function fixture(t,{width=1440,theme='dark',mode='success',overrides={},code=bundle,cache=false,clock=false}={}){
  const context=await browser.newContext({viewport:{width,height:960},serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[];
  let policy=mode,held=[];page.setDefaultTimeout(3500);page.on('pageerror',e=>errors.push(e.message));
  if(cache)await page.addInitScript(values=>{
    for(const value of values)localStorage.setItem(`letscube:release-catalog:v1:${value.platform}:stable`,JSON.stringify({manifest:value,fetchedAt:Date.now()-7*60*60*1000}));
  },['android','windows'].map(platform=>manifest(platform,overrides)));
  if(mode==='body-hold')await page.addInitScript(()=>{
    const original=window.fetch.bind(window);window.holdCatalogBodies=true;window.catalogBodyReads=0;window.catalogBodyAborts=0;
    window.fetch=(input,init)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
      if(window.holdCatalogBodies&&/^https:\/\/api\.letscube\.ru\/releases\/v1\/(android|windows)\/stable\.json$/.test(url)){
        window.catalogBodyReads++;
        return Promise.resolve(new Response(new ReadableStream({start(controller){
          init.signal.addEventListener('abort',()=>{window.catalogBodyAborts++;controller.error(new DOMException('Synthetic abort','AbortError'));},{once:true});
        }}),{status:200,headers:{'content-type':'application/json'}}));
      }
      return original(input,init);
    };
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===new URL(origin).origin)return route.continue();
    const match=url.href.match(/^https:\/\/api\.letscube\.ru\/releases\/v1\/(android|windows)\/stable\.json$/);
    assert.ok(match,'only synthetic published manifest reads may leave the loopback origin');requests.push(match[1]);
    if(policy==='hold'){held.push(route);return;}
    if(policy==='failure')return route.fulfill({status:503,body:'Synthetic unavailable',headers:{'access-control-allow-origin':'*'}});
    return route.fulfill({json:manifest(match[1],overrides),headers:{'access-control-allow-origin':'*'}});
  });
  await page.goto(origin+'__settings-changelog');
  if(clock){const at=new Date('2026-10-19T00:00:00Z');await page.clock.install({time:at});await page.clock.pauseAt(at);}
  await page.evaluate(theme=>{
    document.documentElement.classList.toggle('dark',theme==='dark');
    document.documentElement.classList.toggle('light',theme==='light');
  },theme);
  await page.addScriptTag({content:code});
  assert.equal(await page.title(),'LETSCUBE Synthetic Settings');
  assert.equal(await page.getByRole('heading',{name:'Настройки',exact:true}).count(),1,'actual SettingsScreen/Overlay mounted');
  t.after(async()=>{await page.evaluate(()=>window.unmount()).catch(()=>{});for(const route of held)await route.abort().catch(()=>{});
    await context.close();assert.deepEqual(errors,[],'no application runtime error');});
  return{page,requests,async policy(value){policy=value;},async release(){const pending=held;held=[];
    for(const route of pending){const platform=new URL(route.request().url()).pathname.split('/')[3];await route.fulfill({json:manifest(platform,overrides),headers:{'access-control-allow-origin':'*'}});}}};
}

test('signed-in settings exposes a lazy in-place changelog without route or product-state changes',async t=>{
  const f=await fixture(t);assert.equal(f.requests.length,0,'closed changelog does not fetch a catalog');
  const row=f.page.getByTestId('settings-open-changelog');assert.equal(await row.count(),1,'reachable signed-in changelog row');
  const before=await f.page.evaluate(()=>({url:location.href,state:JSON.stringify(window.fixtureStore.getState()),history:history.length}));
  await f.page.getByPlaceholder('Ваше имя',{exact:true}).fill('Несохранённое имя');
  await row.click();await f.page.getByTestId('settings-changelog-entry').waitFor();
  assert.equal(await row.getAttribute('aria-expanded'),'true');assert.equal(f.requests.length,2);
  await row.click();assert.equal(await f.page.getByTestId('settings-changelog-entry').count(),0);
  const after=await f.page.evaluate(()=>({url:location.href,state:JSON.stringify(window.fixtureStore.getState()),commands:window.fixture.commands,history:history.length}));
  assert.equal(after.url,before.url);assert.equal(after.history,before.history);assert.equal(after.state,before.state);assert.deepEqual(after.commands,[]);
  assert.equal(await f.page.getByPlaceholder('Ваше имя',{exact:true}).inputValue(),'Несохранённое имя');
  assert.equal(await row.evaluate(node=>node===document.activeElement),true,'collapse returns to its own control');
});

test('settings search finds release notes alone under Application, keeps the query and returns without navigation',async t=>{
  const f=await fixture(t);const search=f.page.getByTestId('settings-search-input');await search.fill('история обновлений');
  const row=f.page.getByTestId('settings-open-changelog');await row.waitFor();
  assert.equal(await row.locator('xpath=ancestor::section[@data-settings-section="application"]').count(),1);
  assert.equal(await f.page.locator('[data-settings-section]').count(),1);
  await row.click();await f.page.getByTestId('settings-changelog-entry').waitFor();
  assert.equal(await search.inputValue(),'история обновлений');await row.click();assert.equal(await search.inputValue(),'история обновлений');
  await f.page.getByRole('button',{name:'Очистить',exact:true}).click();
  assert.equal(await search.inputValue(),'');assert.deepEqual(await f.page.evaluate(()=>window.fixture.commands),[]);
});

test('loading is explicit, complete catalog metadata and all highlights appear in place, no invented archive',async t=>{
  const f=await fixture(t,{mode:'hold'});await f.page.getByTestId('settings-open-changelog').click();
  await f.page.getByTestId('settings-changelog').getByText('Загружаем сведения о выпуске…').waitFor();
  assert.equal(await f.page.getByTestId('settings-changelog-refresh').isDisabled(),true);
  await f.release();const entry=f.page.getByTestId('settings-changelog-entry');await entry.waitFor();
  assert.equal(await entry.getAttribute('data-platform'),'android');assert.match(await entry.innerText(),/Android 0\.3\.0/);
  assert.equal(await entry.locator('time').getAttribute('datetime'),'2026-10-18T09:00:00Z');
  assert.equal(await entry.locator('li').count(),6);assert.equal(await entry.getByText('Чёткое отображение фотографий').count(),1);
  assert.match(await f.page.getByTestId('settings-changelog').innerText(),/Архив предыдущих выпусков пока недоступен/);
  assert.equal(await f.page.getByTestId('settings-changelog').locator('a').count(),0,'reader cannot navigate to a download/public page');
});

test('catalog failure is recoverable with explicit refresh, not a fabricated release',async t=>{
  const f=await fixture(t,{mode:'failure'});await f.page.getByTestId('settings-open-changelog').click();
  await f.page.getByTestId('settings-changelog').getByText('Не удалось загрузить сведения об обновлениях.').waitFor();
  assert.equal(await f.page.getByTestId('settings-changelog-entry').count(),0);
  await f.policy('success');await f.page.getByTestId('settings-changelog-refresh').click();
  await f.page.getByTestId('settings-changelog-entry').waitFor();assert.equal(f.requests.length,4);
});

test('actual mounted catalog hooks recover after HTTP200 headers with a stalled body',async t=>{
  const f=await fixture(t,{mode:'body-hold',clock:true});
  await f.page.getByTestId('settings-open-changelog').click();
  await f.page.getByTestId('settings-changelog').getByText('Загружаем сведения о выпуске…').waitFor();
  assert.equal(await f.page.evaluate(()=>window.catalogBodyReads),2);
  await f.page.clock.runFor(4_999);assert.equal(await f.page.getByTestId('settings-changelog-refresh').isDisabled(),true);
  await f.page.clock.runFor(1);
  await f.page.getByTestId('settings-changelog').getByText('Не удалось загрузить сведения об обновлениях.').waitFor();
  assert.equal(await f.page.evaluate(()=>window.catalogBodyAborts),2);
  assert.equal(await f.page.getByTestId('settings-changelog-refresh').isEnabled(),true);
  await f.page.evaluate(()=>{window.holdCatalogBodies=false;});
  await f.page.getByTestId('settings-changelog-refresh').click();
  await f.page.getByTestId('settings-changelog-entry').waitFor();assert.equal(f.requests.length,2);
  assert.deepEqual(await f.page.evaluate(()=>window.fixture.commands),[]);
});

test('stale catalog keeps actual cached notes with a visible saved-state label',async t=>{
  const f=await fixture(t,{mode:'failure',cache:true});await f.page.getByTestId('settings-open-changelog').click();
  await f.page.getByTestId('settings-changelog-entry').waitFor();
  assert.match(await f.page.getByTestId('settings-changelog').innerText(),/Сохранённые сведения/);
  assert.equal(await f.page.getByTestId('settings-changelog-entry').locator('li').count(),6);
});

test('legacy notes-only manifest remains readable and unpublished catalogs never become history',async t=>{
  const notes=await fixture(t,{overrides:{highlights:undefined,notes:'Проверяемая заметка из синтетического manifest.'}});
  await notes.page.getByTestId('settings-open-changelog').click();await notes.page.getByTestId('settings-changelog-entry').waitFor();
  assert.match(await notes.page.getByTestId('settings-changelog-entry').innerText(),/Проверяемая заметка/);
  const empty=await fixture(t,{overrides:{available:false,artifact:null}});await empty.page.getByTestId('settings-open-changelog').click();
  await empty.page.getByTestId('settings-changelog').getByText('Сведения о выпусках пока не опубликованы.').waitFor();
  assert.equal(await empty.page.getByTestId('settings-changelog-entry').count(),0);
});

for(const width of [390,1440])for(const theme of ['dark','light'])test(`synthetic ${width} ${theme}: compact reader fits, renders real controls and remains collapsible`,async t=>{
  const f=await fixture(t,{width,theme});
  if(width===1440)await f.page.getByTestId('settings-rail-application').click();
  const row=f.page.getByTestId('settings-open-changelog');await row.click();const entry=f.page.getByTestId('settings-changelog-entry');await entry.waitFor();
  await entry.scrollIntoViewIfNeeded();await f.page.evaluate(()=>document.fonts.ready);
  assert.equal(await f.page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--kub-text').trim()),theme==='dark'?'#F5F7FB':'#07111F');
  assert.equal(await entry.locator('li').count(),6);assert.equal(await entry.evaluate(node=>node.scrollWidth<=node.clientWidth),true);
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const geometry=await entry.evaluate(node=>{const r=node.getBoundingClientRect(),parent=node.closest('[data-settings-section]').getBoundingClientRect();
    return{left:r.left,right:r.right,parentLeft:parent.left,parentRight:parent.right,font:getComputedStyle(node.querySelector('h4')).fontSize};});
  assert.ok(geometry.left>=geometry.parentLeft);assert.ok(geometry.right<=geometry.parentRight+1);assert.equal(geometry.font,'14px');
  if(process.env.KUB_CHANGELOG_CAPTURE){await mkdir(process.env.KUB_CHANGELOG_CAPTURE,{recursive:true});
    await f.page.screenshot({path:path.join(process.env.KUB_CHANGELOG_CAPTURE,`changelog-${width}-${theme}.png`)});}
  await row.click();assert.equal(await entry.count(),0);assert.deepEqual(await f.page.evaluate(()=>window.fixture.commands),[]);
});

test('literal omission of Application row admission is caught by the actual filtered consumer',async t=>{
  const code=await compile({before:'"audio", "updates", "changelog"].some',after:'"audio", "updates"].some'});
  const f=await fixture(t,{code});await f.page.getByTestId('settings-search-input').fill('что нового');
  assert.equal(await f.page.getByTestId('settings-open-changelog').count(),0,'omission must make the positive search oracle fail');
});
