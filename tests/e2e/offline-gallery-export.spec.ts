import {expect,test} from "@playwright/test";
import {createHash} from "node:crypto";
import {chat,membership,message,openFixture,person,requireFixtureServer,FIXTURE_HOST} from "./helpers/messageActionsFixture";

const ME=person("76000000-0000-4000-8000-000000000001","Gallery QA");
const PEER=person("76000000-0000-4000-8000-000000000002","Gallery peer");
const CHAT="76000000-0000-4000-8000-000000000010", ID="76000000-0000-4000-8000-000000000011";
const PNG=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==","base64");
test.use({screenshot:"off",trace:"off",video:"off",serviceWorkers:"block"});

for(const theme of ["dark","light"] as const) test(`cold cached gallery save from viewer and message menu ${theme}`,async({page,request})=>{
  await requireFixtureServer(request);
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  let offline=false,reads=0;
  await page.addInitScript(()=>{
    const wire=window as unknown as Record<string,unknown>;
    const calls:{method:string;input:Record<string,unknown>}[]=[];
    wire.__galleryCalls=calls;
    wire.androidBridge={postMessage(){}};
    wire.Capacitor={
      PluginHeaders:[{name:"MediaExport",methods:["save","localCapabilities","beginLocal","appendLocal","finishLocal","abortLocal"].map(name=>({name,rtype:"promise"}))}],
      nativePromise:async(plugin:string,method:string,input:Record<string,unknown>={})=>{
        if(plugin!=="MediaExport")throw Error("unexpected synthetic native plugin");
        calls.push({method,input});
        if(method==="localCapabilities")return {version:1,maxBytes:33554432,chunkBytes:262144};
        if(method==="beginLocal")return {id:"11111111-1111-4111-8111-111111111111"};
        if(method==="appendLocal")return {written:Number(input.offset)+atob(String(input.data)).length};
        if(method==="finishLocal")return {saved:true,location:"Pictures/LETSCUBE"};
        if(method==="abortLocal")return {};
        throw Error("cached export attempted an unexpected network source");
      },
    };
  });
  if(process.env.LOCAL_GALLERY_OMIT_WIRING==="viewer")await page.route("**/src/components/chat/MediaViewer.tsx*",async route=>{
    const response=await route.fetch(),body=await response.text();
    const anchor="localUrl: media.url";expect(body.split(anchor).length-1).toBe(1);
    await route.fulfill({response,body:body.replace(anchor,"localUrl: media.sourceUrl")});
  });
  const now=new Date(Date.now()-60000).toISOString();
  const row=message(ID,CHAT,PEER,"Synthetic original",now,{type:"image",media_bucket:"chat-media",media_path:"synthetic/gallery-original.png",
    media_url:`${FIXTURE_HOST}/storage/v1/object/public/chat-media/synthetic/gallery-original.png`,
    media_metadata:{width:1,height:1,size_bytes:PNG.length,mime_type:"image/png"}});
  await openFixture(page,{me:ME,theme,chats:[chat(CHAT,"private",null,now)],memberships:[membership(CHAT,ME,"owner",null),membership(CHAT,PEER,"member",null)],messages:[row],
    rest(){if(offline)return {status:503,body:{code:"SYNTHETIC_OFFLINE"}};}});
  await page.route(`${FIXTURE_HOST}/storage/v1/object/**`,route=>{
    reads++;return offline?route.abort("internetdisconnected"):route.fulfill({status:200,contentType:"image/png",body:PNG});
  });
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.getByTestId("chat-list-item").filter({hasText:PEER.full_name}).click();
  const photo=page.locator(`[data-message-id="${ID}"] img`).last();
  await expect.poll(()=>photo.evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(1);
  await photo.click();
  await expect(page.getByTestId("media-viewer-loading")).toHaveCount(0);
  await expect.poll(()=>page.evaluate(async()=>{
    const {managedMedia}=await import("/src/lib/mediaCache/appMediaCache.ts");return (await managedMedia.stats())?.count??0;
  })).toBe(2);
  await page.getByRole("dialog").getByRole("button",{name:"Закрыть",exact:true}).click();
  offline=true;const warmReads=reads;
  await page.reload({waitUntil:"domcontentloaded"});
  await expect(page.getByTestId("offline-history-status")).toBeVisible();
  await expect(photo).toHaveAttribute("src",/^blob:/);
  await page.evaluate(()=>Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>false}));
  await photo.click();
  await expect(page.getByTestId("media-viewer-loading")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button",{name:/Сохранить/}).click();
  await expect.poll(()=>page.evaluate(()=>((window as unknown as Record<string,unknown>).__galleryCalls as {method:string}[]).filter(c=>c.method==="finishLocal").length)).toBe(1);
  await page.getByRole("dialog").getByRole("button",{name:"Закрыть",exact:true}).click();
  await page.locator(`[data-message-id="${ID}"] [data-message-bubble]`).click({button:"right"});
  const save=page.locator('[data-message-action="saveAs"]');
  await expect(save).toBeVisible();await save.click();
  await expect.poll(()=>page.evaluate(()=>((window as unknown as Record<string,unknown>).__galleryCalls as {method:string}[]).filter(c=>c.method==="finishLocal").length)).toBe(2);
  const calls=await page.evaluate(()=>(window as unknown as Record<string,unknown>).__galleryCalls) as {method:string;input:Record<string,unknown>}[];
  expect(calls.some(c=>c.method==="save"||c.method==="abortLocal")).toBe(false);
  const begun=calls.filter(c=>c.method==="beginLocal");expect(begun).toHaveLength(2);
  for(const item of begun){expect(item.input.mimeType).toBe("image/png");expect(item.input.size).toBe(70);expect(item.input.sha256).toBe(createHash("sha256").update(PNG).digest("hex"));expect(item.input.fileName).toMatch(/\.png$/);}
  const chunks=calls.filter(c=>c.method==="appendLocal");expect(chunks).toHaveLength(2);
  for(const c of chunks){expect(c.input.offset).toBe(0);expect(Buffer.from(String(c.input.data),"base64")).toEqual(PNG);}
  expect(reads).toBe(warmReads);
});
