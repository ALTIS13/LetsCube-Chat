import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {compileTaskUiFixture,mountTaskUi} from "./task-ui-fixture.cjs";

test.use({screenshot:"off",trace:"off",video:"off",serviceWorkers:"block"});
let bundle: Awaited<ReturnType<typeof compileTaskUiFixture>>;
test.beforeAll(async()=>{test.setTimeout(120_000);bundle=await compileTaskUiFixture();});
const evidence=resolve(process.env.TEMP ?? "C:/Users/maksi/AppData/Local/Temp","letscube-task-ui-20261105");

for (const theme of ["light","dark"] as const) {
  test(`synthetic task audit captures list detail actions (${theme})`,async({page},testInfo)=>{
    const f=await mountTaskUi(page,bundle,theme);
    try {
      await expect(page.getByRole("dialog",{name:"Fictional task A",exact:true})).toBeVisible();
      await page.evaluate(()=>document.fonts.ready);
      await mkdir(evidence,{recursive:true});
      const prefix=`${process.env.TASK_UI_STAGE ?? 'before'}-${testInfo.project.name}-${theme}`;
      await page.screenshot({path:resolve(evidence,`${prefix}-detail.png`),scale:"css",animations:"disabled"});
      await page.getByRole("button",{name:"На подтверждение",exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:resolve(evidence,`${prefix}-actions.png`),scale:"css",animations:"disabled"});
      await page.evaluate(()=>{
        const f=window.fixture; const task=f.task;
        f.task=()=>({...task(),description:'FictionalLongToken'.repeat(35),
          assignee:{...f.profile('owner-a'),full_name:'FictionalLongName'.repeat(12)}});
        f.enqueue({});f.deliver();
      });
      await expect(page.getByText('FictionalLongToken'.repeat(35),{exact:true})).toBeVisible();
      await page.getByTestId("kub-modal-body").evaluate(element=>element.scrollTop=0);
      await page.screenshot({path:resolve(evidence,`${prefix}-long-detail.png`),scale:"css",animations:"disabled"});
      console.log('TASK_UI_GEOMETRY',await page.getByTestId("kub-modal-body").evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth})));
      await page.evaluate(()=>{window.fixture.surface='list';window.fixture.render();});
      await expect(page.getByTestId("row")).toBeVisible();
      await page.screenshot({path:resolve(evidence,`${prefix}-list.png`),scale:"css",animations:"disabled"});
    } finally {await f.close();}
  });

  test(`keyboard selection does not open row or card (${theme})`,async({page})=>{
    const f=await mountTaskUi(page,bundle,theme);
    try {
      await page.evaluate(()=>{window.fixture.surface='list';window.fixture.render();});
      for (const label of ['Select row','Select card']) {
        const checkbox=page.getByRole('checkbox',{name:label});
        await checkbox.focus();
        await page.keyboard.press('Space');
        await expect(checkbox).toBeChecked();
        expect(await page.evaluate(()=>window.fixture.opens)).toBe(0);
        await page.keyboard.press('Space');
        await expect(checkbox).not.toBeChecked();
        await page.keyboard.press('Enter');
        expect(await page.evaluate(()=>window.fixture.opens)).toBe(0);
      }
      for (const id of ['row','card']) {
        await page.getByTestId(id).locator('[role="button"]').focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Space');
      }
      expect(await page.evaluate(()=>window.fixture.opens)).toBe(4);
    } finally {await f.close();}
  });

  test(`long description history and names stay inside detail scroller (${theme})`,async({page})=>{
    const f=await mountTaskUi(page,bundle,theme);
    try {
      await page.evaluate(()=>{
        const f=window.fixture,task=f.task,rows=f.rows;
        f.task=()=>({...task(),description:'FictionalLongToken'.repeat(35),
          assignee:{...f.profile('owner-a'),full_name:'FictionalLongName'.repeat(12)},
          creator:{...f.profile('owner-a'),full_name:'FictionalCreator'.repeat(12)}});
        f.rows=(table,id)=>table === 'task_events' ? [{...rows(table,id)[0],payload:{text:'FictionalHistoryToken'.repeat(35)}}] : rows(table,id);
        f.enqueue({});f.deliver();
      });
      await expect(page.getByText('FictionalLongToken'.repeat(35),{exact:true})).toBeVisible();
      const body=page.getByTestId('kub-modal-body');
      expect(await body.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
      await page.getByRole('button',{name:'Отправить комментарий',exact:true}).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button',{name:'Отправить комментарий',exact:true})).toBeInViewport();
    } finally {await f.close();}
  });

  test(`denied action is announced without losing comment draft (${theme})`,async({page})=>{
    const f=await mountTaskUi(page,bundle,theme);
    try {
      await page.getByPlaceholder('Оставьте комментарий…').fill('Fictional retained draft');
      await page.getByRole('button',{name:'На подтверждение',exact:true}).click();
      await expect(page.getByRole('alert')).toContainText('Недостаточно прав');
      await expect(page.getByPlaceholder('Оставьте комментарий…')).toHaveValue('Fictional retained draft');
      await expect(page.getByRole('button',{name:'На подтверждение',exact:true})).toBeEnabled();
      expect(await page.evaluate(()=>window.fixture.rpcCalls)).toEqual(['task_send_for_confirmation']);
    } finally {await f.close();}
  });

  test(`comment transport rejection releases busy state and retains draft (${theme})`,async({page})=>{
    const f=await mountTaskUi(page,bundle,theme);
    try {
      await page.evaluate(()=>{
        window.fixture.rpc=async(name)=>{window.fixture.rpcCalls.push(name);throw new Error('Fictional offline failure');};
      });
      await page.getByPlaceholder('Оставьте комментарий…').fill('Fictional unsent comment');
      const send=page.getByRole('button',{name:'Отправить комментарий',exact:true});
      await send.click();
      await expect(send).toBeEnabled();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByPlaceholder('Оставьте комментарий…')).toHaveValue('Fictional unsent comment');
      expect(await page.evaluate(()=>window.fixture.rpcCalls)).toEqual(['task_comment']);
    } finally {await f.close();}
  });

  test(`server review access overrides local role mirror and fails closed during recheck (${theme})`,async({page})=>{
    const f=await mountTaskUi(page,bundle,theme);
    try {
      await page.evaluate(()=>{
        const f=window.fixture,task=f.task;
        f.reviewRead=async()=>{f.reviewCalls++;return {data:{can_review:true,can_review_own:true,is_participant:true,reason:'ready'},error:null};};
        f.task=()=>({...task(),status:'waiting_confirmation'});
        f.enqueue({});f.deliver();
      });
      const confirm=page.getByRole('button',{name:'Подтвердить',exact:true});
      await expect(confirm).toBeVisible();
      await expect(page.getByRole('button',{name:'Отклонить',exact:true})).toBeVisible();
      expect(await page.evaluate(()=>window.fixture.reviewCalls)).toBeGreaterThan(0);
      await page.evaluate(()=>{
        const f=window.fixture,task=f.task;
        f.reviewRead=()=>{f.reviewCalls++;return new Promise(resolve=>f.resolveReview=resolve);};
        f.task=()=>({...task(),updated_at:'2026-11-05T12:00:00Z'});
        f.enqueue({});f.deliver();
      });
      await page.waitForFunction(()=>Boolean(window.fixture.resolveReview));
      await expect(confirm).toHaveCount(0);
      await page.evaluate(()=>window.fixture.resolveReview({data:null,error:{code:'42501'}}));
      await expect(confirm).toHaveCount(0);
      await expect(page.getByRole('button',{name:'Повторить проверку',exact:true})).toBeVisible();
      expect(await page.evaluate(()=>window.fixture.rpcCalls)).toEqual([]);
    } finally {await f.close();}
  });

  test(`self-review history marker requires exact capability payload (${theme})`,async({page})=>{
    const f=await mountTaskUi(page,bundle,theme);
    try {
      await page.evaluate(()=>{
        const f=window.fixture,rows=f.rows;
        f.rows=(table,id)=>table!=='task_events'?rows(table,id):[
          {kind:'confirm',payload:{self_review:true,permission:'tasks.review_own',note:'Fictional approval note'}},
          {kind:'reject',payload:{self_review:true,permission:'tasks.manage',reason:'Fictional rejection reason'}},
          {kind:'confirm',payload:{self_review:'true',permission:'tasks.review_own',note:'Fictional ordinary note'}},
          {kind:'comment',payload:{self_review:true,permission:'tasks.review_own',text:'Fictional comment'}},
        ].map((event,index)=>({...rows(table,id)[0],...event,id:'audit-'+index}));
        f.enqueue({});f.deliver();
      });
      const note=page.getByText('Fictional approval note',{exact:false});
      await expect(note).toContainText('Проверено участником выполнения по специальному праву.');
      await expect(page.getByText('Проверено участником выполнения по специальному праву.',{exact:false})).toHaveCount(1);
      await expect(page.getByText('Причина: Fictional rejection reason',{exact:true})).toBeVisible();
    } finally {await f.close();}
  });

  test(`privilege change invalidates open detail review without granting locally (${theme})`,async({page})=>{
    const f=await mountTaskUi(page,bundle,theme);
    try {
      await page.evaluate(()=>{
        const f=window.fixture,task=f.task;
        f.reviewRead=async()=>({data:{can_review:true,can_review_own:false,is_participant:false,reason:'ready'},error:null});
        f.task=()=>({...task(),status:'waiting_confirmation'});f.enqueue({});f.deliver();
      });
      const confirm=page.getByRole('button',{name:'Подтвердить',exact:true});
      await expect(confirm).toBeVisible();
      await page.evaluate(()=>{
        const f=window.fixture;
        f.reviewRead=()=>new Promise(resolve=>f.resolveReview=resolve);
        f.reviewPermissions=['tasks.review_own'];f.render();
      });
      await expect(confirm).toHaveCount(0);
      await page.waitForFunction(()=>Boolean(window.fixture.resolveReview));
      await page.evaluate(()=>window.fixture.resolveReview({data:{can_review:false,can_review_own:true,is_participant:true,reason:'self_review'},error:null}));
      await expect(page.getByText('Задачу должен проверить другой пользователь с правом подтверждения.',{exact:true})).toBeVisible();
      await expect(confirm).toHaveCount(0);
    }finally{await f.close();}
  });
}
