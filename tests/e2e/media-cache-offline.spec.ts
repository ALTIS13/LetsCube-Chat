import { expect, test } from "@playwright/test";
import { chat, membership, message, openFixture, person, requireFixtureServer, FIXTURE_HOST } from "./helpers/messageActionsFixture";
import { openSettingsScreen } from "./helpers/settingsColumnFixture";

const ME = person("75000000-0000-4000-8000-000000000001", "Media cache QA");
const PEER = person("75000000-0000-4000-8000-000000000002", "Media peer");
const CHAT = "75000000-0000-4000-8000-000000000010";
const ID = "75000000-0000-4000-8000-000000000011";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4l8AAAAASUVORK5CYII=", "base64");
test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });
test.beforeEach(async ({ request }) => requireFixtureServer(request));

test("actual offline media: durable bytes, cold history without URLs and clear retirement", async ({ page }) => {
  let offline = false, objectReads = 0;
  const row = message(ID, CHAT, PEER, "Synthetic cached photo", new Date(Date.now() - 60000).toISOString(), {
    type: "image", media_bucket: "media", media_path: "synthetic/cache.png",
    media_url: `${FIXTURE_HOST}/storage/v1/object/public/media/synthetic/cache.png`,
    media_metadata: { width: 1, height: 1, size_bytes: PNG.length, mime_type: "image/png" },
  });
  const file = message("75000000-0000-4000-8000-000000000012", CHAT, PEER, "synthetic-note.txt", new Date(Date.now() - 30000).toISOString(), {
    type: "file", media_bucket: "media", media_path: "synthetic/note.txt",
    media_url: `${FIXTURE_HOST}/storage/v1/object/public/media/synthetic/note.txt`,
    media_metadata: { file_name: "synthetic-note.txt", size_bytes: 14, mime_type: "text/plain" },
  });
  await openFixture(page, { me: ME, chats: [chat(CHAT, "private", null, new Date().toISOString())],
    memberships: [membership(CHAT, ME, "owner", null), membership(CHAT, PEER, "member", null)], messages: [row, file],
    rest() { if (offline) return {status: 503, body: {code: "SYNTHETIC_OFFLINE"}}; },
  });
  await page.route(`${FIXTURE_HOST}/storage/v1/object/**`, async route => {
    objectReads++; if (offline) return route.abort("internetdisconnected");
    if (route.request().url().endsWith("note.txt")) return route.fulfill({status:200,contentType:"text/plain",body:"Synthetic note"});
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-list-item").filter({hasText: PEER.full_name}).click();
  const photo = page.locator(`[data-message-id="${ID}"] img`).last();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect.poll(() => page.evaluate(async () => {
    const { managedMedia } = await import("/src/lib/mediaCache/appMediaCache.ts");
    return (await managedMedia.stats())?.bytes ?? 0;
  })).toBe(PNG.length);
  await page.locator('[data-message-id="75000000-0000-4000-8000-000000000012"]').getByRole("button", {name:/synthetic-note/}).click();
  await expect(page.getByTestId("document-viewer-text")).toContainText("Synthetic note");
  await page.getByRole("button", {name:"Закрыть",exact:true}).last().click();
  await expect.poll(() => page.evaluate(async () => {
    const { managedMedia } = await import("/src/lib/mediaCache/appMediaCache.ts"); return (await managedMedia.stats())?.count ?? 0;
  })).toBe(2);
  await photo.click();
  await expect(page.getByTestId("media-viewer-stage")).toBeVisible();
  await expect(page.getByTestId("media-viewer-loading")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", {name:"Закрыть",exact:true}).click();
  await expect.poll(() => page.evaluate(async () => {
    const { managedMedia } = await import("/src/lib/mediaCache/appMediaCache.ts"); return (await managedMedia.stats())?.count ?? 0;
  })).toBe(3);
  // The text cache deliberately strips remote/signed URLs. It must still draw a photo.
  const durableHistory = () => page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("kub-history-cache"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise<boolean>(resolve => { const tx = db.transaction("records"); const r = tx.objectStore("records").getAll(); r.onsuccess = () => resolve(r.result.some(row => row.scope?.startsWith("messages:") && JSON.parse(row.payload).value.messages.some((m: {id:string;media_url:null}) => m.id === id && m.media_url === null))); }); } finally { db.close(); }
  }, ID);
  try { await expect.poll(durableHistory).toBe(true); } catch (error) {
    console.log("synthetic durable boundary", await page.evaluate(async () => {
      const { offlineHistory } = await import("/src/lib/historyCache/appOfflineHistory.ts");
      const { useAppStore } = await import("/src/store/app.store.ts");
      const owner = offlineHistory.capture();
      const state = useAppStore.getState();
      const saved = await owner?.readMessages({chatId:"75000000-0000-4000-8000-000000000010",topicId:undefined,generalTopicIds:[]});
      return { owner:!!owner, persisted:saved?.messages.length ?? null, source:state.authSessionSource,
        rows:state.messages["75000000-0000-4000-8000-000000000010"]?.length ?? null };
    }));
    throw error;
  }
  offline = true;
  const before = objectReads;
  await page.reload({waitUntil:"domcontentloaded"});
  await expect(page.getByTestId("offline-history-status")).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(photo).toHaveAttribute("src", /^blob:/);
  await page.getByTestId("file-message").click();
  await expect(page.getByTestId("document-viewer-text")).toContainText("Synthetic note");
  await page.getByTestId("document-viewer-close").click();
  await photo.click();
  await expect(page.getByTestId("media-viewer-stage")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", {name:"Закрыть",exact:true}).click();
  expect(objectReads).toBe(before);
  await page.evaluate(async () => {
    const { offlineHistory } = await import("/src/lib/historyCache/appOfflineHistory.ts");
    await offlineHistory.capture()?.invalidateChat("75000000-0000-4000-8000-000000000010");
  });
  await expect.poll(() => page.evaluate(async () => {
    const { managedMedia } = await import("/src/lib/mediaCache/appMediaCache.ts"); return (await managedMedia.stats())?.count ?? -1;
  })).toBe(0);
});

test("cached voice plays offline, survives leaving its bubble and stops on privacy retirement", async ({page,browserName}) => {
  test.skip(browserName === "webkit" && process.platform === "win32",
    "Windows Playwright WebKit cannot decode the unchanged WAV positive control; real Apple audio remains a separate device check.");
  let offline = false;
  if (process.env.MEDIA_CACHE_PLAYER_MUTANT === "omit-retirement") {
    await page.route("**/src/components/chat/ChatMediaPlayback.tsx*", async route => {
      const response = await route.fetch(), body = await response.text();
      const anchor = "managedMedia.subscribeRetirement(";
      expect(body.split(anchor).length - 1, "unique actual compiled player retirement").toBe(1);
      await route.fulfill({response,body:body.replace(anchor,"((callback) => () => {})(")});
    });
  }
  // A synthetic ten-second silent WAV: enough to leave the chat before it ends.
  const wav = Buffer.alloc(44 + 160000); wav.write("RIFF"); wav.writeUInt32LE(wav.length-8,4); wav.write("WAVEfmt ",8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24);
  wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write("data",36); wav.writeUInt32LE(160000,40);
  const voice = message(ID,CHAT,PEER,"Голосовое сообщение",new Date(Date.now()-60000).toISOString(), {
    type:"audio",media_bucket:"media",media_path:"synthetic/voice.wav",
    media_url:`${FIXTURE_HOST}/storage/v1/object/public/media/synthetic/voice.wav`,
    media_metadata:{duration_ms:10000,size_bytes:wav.length,mime_type:"audio/wav"},
  });
  await openFixture(page,{me:ME,chats:[chat(CHAT,"private",null,new Date().toISOString())],
    memberships:[membership(CHAT,ME,"owner",null),membership(CHAT,PEER,"member",null)],messages:[voice],
    rest(){if(offline)return {status:503,body:{code:"SYNTHETIC_OFFLINE"}};},
  });
  await page.route(`${FIXTURE_HOST}/storage/v1/object/**`,route=>offline?route.abort("internetdisconnected"):route.fulfill({status:200,contentType:"audio/wav",body:wav}));
  await page.goto("/",{waitUntil:"domcontentloaded"});
  const control=await page.evaluate(async base64=>await new Promise(resolve=>{
    const audio=new Audio(); audio.preload="auto"; document.body.append(audio);
    const finish=(value:unknown)=>{clearTimeout(timer);audio.pause();audio.remove();resolve(value);};
    const timer=setTimeout(()=>finish({decoded:false,error:audio.error?.code}),3000);
    audio.onloadedmetadata=()=>finish({decoded:true,duration:audio.duration});
    audio.onerror=()=>finish({decoded:false,error:audio.error?.code});
    audio.src="data:audio/wav;base64,"+base64; audio.load(); void audio.play().catch(()=>{});
  }),wav.toString("base64"));
  expect(control,"same WAV decoder positive control").toEqual({decoded:true,duration:10});
  await page.getByTestId("chat-list-item").filter({hasText:PEER.full_name}).click();
  await expect.poll(()=>page.evaluate(async()=>{
    const {managedMedia}=await import("/src/lib/mediaCache/appMediaCache.ts");return (await managedMedia.stats())?.count??0;
  })).toBe(1);
  offline = true;
  await page.reload({waitUntil:"domcontentloaded"});
  await expect(page.getByTestId("offline-history-status")).toBeVisible();
  const play = page.locator(`[data-message-id="${ID}"]`).getByRole("button",{name:"Воспроизвести",exact:true});
  try { await expect(play).toBeEnabled(); } catch(error) {
    console.log("synthetic voice decode",await page.evaluate(async()=>{
      const live=[...document.querySelectorAll("audio")].map(audio=>({src:audio.src.startsWith("blob:")?"blob":audio.src?"network":"none",error:audio.error?.code,ready:audio.readyState,type:audio.canPlayType("audio/wav")}));
      const audio=document.querySelector('audio[src^="blob:"]');
      let size=null,mime=null;
      if(audio){const blob=await(await fetch(audio.getAttribute("src")!)).blob();size=blob.size;mime=blob.type;}
      return {live,size,mime};
    })); throw error;
  }
  await play.click();
  await expect(page.getByTestId("chat-media-playback-bar")).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll("audio")].some(audio=>!audio.paused&&audio.currentTime>0))).toBe(true);
  if((page.viewportSize()?.width??1440)<768) await page.getByTestId("chat-header-shell").getByRole("button",{name:"Назад",exact:true}).click();
  else await page.evaluate(async()=>{const {useAppStore}=await import("/src/store/app.store.ts");useAppStore.getState().setSelectedChatId(null);});
  await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll("audio")].some(audio=>!audio.paused&&audio.currentTime>0))).toBe(true);
  await page.evaluate(async()=>{const {offlineHistory}=await import("/src/lib/historyCache/appOfflineHistory.ts");await offlineHistory.capture()?.invalidateChat("75000000-0000-4000-8000-000000000010");});
  await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll("audio")].every(audio=>audio.paused))).toBe(true);
  await expect(page.getByTestId("chat-media-playback-bar")).toHaveCount(0);
});

test("the mounted searchable storage controls change and clear the actual account cache", async ({page}) => {
  await openSettingsScreen(page);
  await page.evaluate(async () => {
    const {managedMedia,mediaCache}=await import("/src/lib/mediaCache/appMediaCache.ts");
    const scope=managedMedia.scope({chat_id:"75000000-0000-4000-8000-000000000010",media_bucket:"media",media_path:"synthetic/settings.txt"},"original");
    if(!scope || !await mediaCache.put(scope,new Blob(["synthetic"],{type:"text/plain"}))) throw Error("SYNTHETIC_CACHE_SEED_FAILED");
  });
  const search = page.getByTestId("settings-search-input");
  if(await search.isVisible()) await search.fill("кэш");
  const open=page.getByTestId("settings-open-media-cache");
  await open.scrollIntoViewIfNeeded(); await open.click();
  await expect(page.getByTestId("media-cache-count")).toContainText("1");
  await page.getByRole("radio",{name:"64 МБ",exact:true}).click();
  await expect(page.getByRole("radio",{name:"64 МБ",exact:true})).toHaveAttribute("aria-checked","true");
  await page.getByRole("button",{name:"Очистить медиакэш",exact:true}).click();
  await expect(page.getByTestId("media-cache-count")).toContainText("0");
  await expect(page.getByTestId("media-cache-section").getByRole("status")).toHaveText("Медиакэш очищен");
  expect(await page.evaluate(async()=>{const {managedMedia}=await import("/src/lib/mediaCache/appMediaCache.ts");return await managedMedia.stats();})).toEqual({bytes:0,count:0,limitBytes:67108864});
});
