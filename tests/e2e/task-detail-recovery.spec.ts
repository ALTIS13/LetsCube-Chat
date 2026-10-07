import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { compileFixture, mountFixture } from "../helpers/task-detail-fixture.cjs";

test.use({screenshot:"off",trace:"off",video:"off",serviceWorkers:"block"});
let bundle: Awaited<ReturnType<typeof compileFixture>>;
test.beforeAll(async()=>{bundle=await compileFixture({styles:true});});

for(const theme of ["light","dark"] as const) test(`fictional detail recovery retains drafts and compact Retry (${theme})`,async({page},testInfo)=>{
  const f=await mountFixture(page,bundle,{mode:"modal",theme,
    initial:{errors:{tasks:{code:"57014",message:"FICTIONAL_BACKEND_SECRET"}}}});
  try {
    const evidence=resolve(".ops-private/20261007-task-detail-recovery");
    await mkdir(evidence,{recursive:true});
    await expect(page.getByTestId("task-read-error")).toBeInViewport();
    await expect(page.getByText("Не удалось загрузить задачу.",{exact:true})).toBeVisible();
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:resolve(evidence,`${testInfo.project.name}-${theme}-initial.png`),scale:"css",animations:"disabled"});
    await page.getByRole("button",{name:"Повторить"}).click();
    await expect(page.getByRole("dialog",{name:"Fictional task A",exact:true})).toBeVisible();
    await page.getByTestId("task-checklist-draft").fill("Fictional retained checklist draft");
    await page.getByPlaceholder("Оставьте комментарий…").fill("Fictional retained comment draft");
    const draft=page.getByTestId("task-checklist-draft");
    const before=await draft.boundingBox();
    await page.evaluate(()=>{window.fixture.enqueue({hold:true});window.fixture.deliver();});
    await page.waitForFunction(()=>window.fixture.batches.length===3);
    expect(await draft.boundingBox()).toEqual(before);
    await expect(draft).toHaveValue("Fictional retained checklist draft");
    await page.evaluate(()=>window.fixture.release(2));await f.idle();
    await page.evaluate(()=>{const f=window.fixture;f.enqueue({errors:{tasks:{code:'57014',message:'FICTIONAL_BACKEND_SECRET'}}});f.deliver();});
    const strip=page.getByTestId("task-read-error");
    await expect(strip).toBeVisible();
    await expect(page.getByTestId("task-checklist-draft")).toHaveValue("Fictional retained checklist draft");
    await expect(page.getByPlaceholder("Оставьте комментарий…")).toHaveValue("Fictional retained comment draft");
    await expect(page.getByText("Fictional retained history",{exact:true})).toBeVisible();
    await expect(page.locator("body")).not.toContainText("FICTIONAL_BACKEND_SECRET");
    const geometry=await strip.evaluate(element=>{
      const box=element.getBoundingClientRect();const button=element.querySelector('button').getBoundingClientRect();
      return {left:box.left,right:box.right,height:box.height,buttonLeft:button.left,buttonRight:button.right,
        overflow:element.scrollWidth>element.clientWidth};
    });
    expect(geometry.overflow).toBe(false);expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(geometry.buttonLeft).toBeGreaterThanOrEqual(geometry.left);
    expect(geometry.buttonRight).toBeLessThanOrEqual(geometry.right);expect(geometry.height).toBeLessThan(120);
    await page.evaluate(()=>document.fonts.ready);
    await strip.scrollIntoViewIfNeeded();
    await expect(strip).toBeInViewport();
    await page.screenshot({path:resolve(evidence,`${testInfo.project.name}-${theme}-loaded.png`),scale:"css",animations:"disabled"});
    await strip.getByRole("button",{name:"Повторить"}).click();
    await expect(strip).toHaveCount(0);
    await expect(page.getByTestId("task-checklist-draft")).toHaveValue("Fictional retained checklist draft");
  }finally{await f.close();}
});
