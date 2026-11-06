import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {compileFormFixture,mountFormFixture} from './task-ui-form-fixture.cjs';

test.use({screenshot:'off',trace:'off',video:'off',serviceWorkers:'block'});
let bundle:Awaited<ReturnType<typeof compileFormFixture>>;
test.beforeAll(async()=>{test.setTimeout(120_000);bundle=await compileFormFixture({mode:'page'});});
const evidence=resolve(process.env.TEMP??'C:/Users/maksi/AppData/Local/Temp','letscube-task-ui-20261105');

test('task search keeps a stable accessible name after typing and clearing',async({page})=>{
  const f=await mountFormFixture(page,bundle,'dark');
  try {
    const search=page.getByRole('textbox',{name:'Поиск по задачам',exact:true});
    await expect(search).toBeVisible();
    await search.fill('Fictional task 1');
    await expect(search).toHaveValue('Fictional task 1');
    await expect(page.getByRole('heading',{name:'Fictional task 1',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Очистить поиск задач',exact:true}).click();
    await expect(search).toHaveValue('');
  }finally{await f.close();}
});

for(const theme of ['light','dark'] as const) {
  test(`confirming own and coexecuted tasks moves Mine to History without reload (${theme})`,async({page},info)=>{
    const f=await mountFormFixture(page,bundle,theme);
    try {
      await page.evaluate(()=>{
        const f=window.fixture;
        f.tasks=f.tasks.map((task,index)=>index<2?{...task,status:'waiting_confirmation'}:
          index===2?{...task,status:'rejected',coassignees:[{user_id:'owner-a',profile:f.profile('owner-a')}]}:
          index===3?{...task,status:'cancelled',coassignees:[{user_id:'owner-a',profile:f.profile('owner-a')}]}:task);
        f.render();
      });
      await expect(page.getByRole('heading',{name:'Fictional task 2',exact:true})).toBeVisible();
      for(const index of [0,1]) {
        await page.getByRole('heading',{name:'Fictional task '+index,exact:true}).click();
        const detail=page.getByRole('dialog',{name:'Fictional task '+index,exact:true});
        await detail.getByRole('button',{name:'Подтвердить',exact:true}).click();
        await page.getByRole('dialog',{name:'Подтвердить выполнение',exact:true}).getByRole('button',{name:'Подтвердить',exact:true}).click();
        await expect(page.getByRole('dialog',{name:'Подтвердить выполнение',exact:true})).toHaveCount(0);
        await detail.getByRole('button',{name:'Закрыть',exact:true}).click();
        await expect(page.getByRole('heading',{name:'Fictional task '+index,exact:true})).toHaveCount(0);
      }
      await expect(page.getByRole('heading',{name:'Fictional task 3',exact:true})).toHaveCount(0);
      await page.getByRole('button',{name:/^История/}).click();
      for(const index of [0,1,3]) await expect(page.getByRole('heading',{name:'Fictional task '+index,exact:true})).toBeVisible();
      await expect(page.getByRole('heading',{name:'Fictional task 2',exact:true})).toHaveCount(0);
      await page.getByPlaceholder('Поиск по задачам…').fill('Fictional task 1');
      await expect(page.getByRole('heading',{name:'Fictional task 1',exact:true})).toBeVisible();
      await expect(page.getByRole('heading',{name:'Fictional task 0',exact:true})).toHaveCount(0);
      await mkdir(evidence,{recursive:true});await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:resolve(evidence,`${process.env.TASK_UI_STAGE??'before'}-${info.project.name}-${theme}-history.png`),scale:'css',animations:'disabled'});
      expect(await page.evaluate(()=>performance.getEntriesByType('navigation').length)).toBe(1);
      expect(await page.evaluate(()=>window.fixture.formCalls.filter(call=>call.name==='task_confirm').map(call=>call.params.p_task_id))).toEqual(['task-0','task-1']);
    }finally{await f.close();}
  });

  test(`named people picker includes sole coexecutor and matches Me participant semantics (${theme})`,async({page})=>{
    const f=await mountFormFixture(page,bundle,theme);
    try {
      await page.getByRole('button',{name:/^Все/}).first().click();
      await page.getByRole('button',{name:/^Фильтры/}).click();
      await page.locator('#task-assignee-filter').click();
      const search=page.getByPlaceholder('Найти исполнителя…');
      await search.fill('cofixture');
      await page.getByRole('option',{name:/Fictional only coexecutor/}).click();
      await expect(page.getByRole('heading',{name:'Fictional task 4',exact:true})).toBeVisible();
      await expect(page.getByRole('heading',{name:'Fictional task 3',exact:true})).toHaveCount(0);
      await page.getByRole('button',{name:'Сбросить выбор',exact:true}).click();
      await search.fill('fixture0');
      await page.getByRole('option',{name:/Fictional person 0/}).click();
      await expect(page.getByRole('heading',{name:'Fictional task 0',exact:true})).toBeVisible();
      await expect(page.getByRole('heading',{name:'Fictional task 1',exact:true})).toBeVisible();
      await expect(page.getByRole('heading',{name:'Fictional task 4',exact:true})).toHaveCount(0);
    }finally{await f.close();}
  });
}
