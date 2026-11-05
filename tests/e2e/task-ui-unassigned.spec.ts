import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {compileFormFixture,mountFormFixture} from "./task-ui-form-fixture.cjs";

test.use({screenshot:"off",trace:"off",video:"off",serviceWorkers:"block"});
let bundle: Awaited<ReturnType<typeof compileFormFixture>>;
test.beforeAll(async()=>{test.setTimeout(120_000);bundle=await compileFormFixture();});
const evidence=resolve(process.env.TEMP ?? "C:/Users/maksi/AppData/Local/Temp","letscube-task-ui-20261105");

for(const theme of ['light','dark'] as const) {
  for(const route of ['person','staff_pool']) test(`unavailable routing refuses ${route} draft (${theme})`,async({page},testInfo)=>{
    const f=await mountFormFixture(page,bundle,theme);
    try {
      await page.getByPlaceholder('Что нужно сделать?').fill('Fictional guarded task');
      if(route==='staff_pool') {
        await page.getByTestId('task-route').selectOption('staff_pool');
        await page.getByRole('combobox',{name:/^Локация/}).selectOption('location-a');
      }else{
        await page.locator('summary',{hasText:'Маршрутизация и видимость'}).click();
        await page.getByRole('combobox',{name:/^Видимость/}).selectOption('private');
      }
      await page.evaluate(()=>{window.fixture.routing.available=false;window.fixture.render();});
      await page.getByRole('button',{name:'Создать',exact:true}).click();
      expect(await page.evaluate(()=>window.fixture.formCalls)).toEqual([]);
      await expect(page.getByRole('alert')).toContainText('Не удалось проверить параметры задачи.');
      await expect(page.getByTestId('task-route')).toBeDisabled();
      const directory=resolve(process.env.TEMP ?? 'C:/Users/maksi/AppData/Local/Temp','letscube-task-form-p2-20261105');
      await mkdir(directory,{recursive:true});
      await page.getByRole('alert').scrollIntoViewIfNeeded();
      await page.screenshot({path:resolve(directory,`${testInfo.project.name}-${theme}-${route}-routing-unavailable.png`),scale:'css',animations:'disabled'});
      await page.evaluate(()=>{window.fixture.routing.available=true;window.fixture.render();});
      await expect(page.getByTestId('task-route')).toHaveValue(route);
      if(route==='person') await expect(page.getByRole('combobox',{name:/^Видимость/})).toHaveValue('private');
    }finally{await f.close();}
  });

  test(`unassigned visibility excludes chat until explicit scope (${theme})`,async({page},testInfo)=>{
    const f=await mountFormFixture(page,bundle,theme);
    try {
      await page.getByPlaceholder('Что нужно сделать?').fill('Fictional explicit chat task');
      await page.getByTestId('task-route').selectOption('unassigned');
      await page.locator('summary',{hasText:'Маршрутизация и видимость'}).click();
      const visibility=page.getByRole('combobox',{name:/^Видимость/});
      await expect(visibility.locator('option[value="chat"]')).toHaveJSProperty('disabled',true);
      await visibility.focus();await page.keyboard.press('End');
      await expect(visibility).toHaveValue('private');
      await expect(page.getByRole('button',{name:/Fictional linked chat/})).toHaveCount(0);
      const directory=resolve(process.env.TEMP ?? 'C:/Users/maksi/AppData/Local/Temp','letscube-task-form-p2-20261105');
      await mkdir(directory,{recursive:true});await visibility.scrollIntoViewIfNeeded();
      await page.screenshot({path:resolve(directory,`${testInfo.project.name}-${theme}-unassigned-visibility.png`),scale:'css',animations:'disabled'});
      await page.getByTestId('task-route').selectOption('person');
      await expect(visibility).toHaveValue('private');
      await expect(visibility.locator('option[value="chat"]')).toHaveJSProperty('disabled',false);
      await visibility.selectOption('chat');
      await page.getByRole('button',{name:/Fictional linked chat/}).click();
      await page.getByRole('button',{name:'Создать',exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>window.fixture.done)).toEqual(['created-task']);
      expect(await page.evaluate(()=>window.fixture.formCalls)).toEqual([{name:'task_create_v4',params:{
        p_title:'Fictional explicit chat task',p_description:null,p_assignee_id:null,p_priority:'normal',p_due_at:null,
        p_chat_id:'chat-a',p_visibility:'chat',p_assignment_scope:'user',p_location_id:null,p_target_role:null,
        p_route_admin_id:null,p_created_for_admin:false,p_starts_at:null,
      }}]);
    }finally{await f.close();}
  });

  test(`legacy person draft stays available without routing (${theme})`,async({page})=>{
    const f=await mountFormFixture(page,bundle,theme);
    try {
      await page.getByPlaceholder('Что нужно сделать?').fill('Fictional legacy task');
      await page.evaluate(()=>{window.fixture.routing.available=false;window.fixture.render();});
      await page.getByRole('button',{name:'Создать',exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>window.fixture.done)).toEqual(['created-task']);
      expect(await page.evaluate(()=>window.fixture.formCalls)).toEqual([{name:'task_create',params:{
        p_title:'Fictional legacy task',p_description:null,p_assignee_id:null,p_priority:'normal',p_due_at:null,p_chat_id:null,
      }}]);
    }finally{await f.close();}
  });

  test(`explicit unassigned task clears routing and preserves private visibility (${theme})`,async({page},testInfo)=>{
    const f=await mountFormFixture(page,bundle,theme);
    try {
      await expect(page.getByRole('dialog',{name:'Новая задача',exact:true})).toBeVisible();
      await page.getByPlaceholder('Что нужно сделать?').fill('Fictional unassigned task');
      await page.locator('summary',{hasText:'Маршрутизация и видимость'}).click();
      await page.getByRole('combobox',{name:/^Локация/}).selectOption('location-a');
      await page.getByRole('combobox',{name:/^Администратор локации/}).selectOption('admin-a');
      await page.getByRole('combobox',{name:/^Видимость/}).selectOption('private');
      await page.getByPlaceholder('Поиск по имени или @никнейму…').fill('Fictional');
      await page.getByRole('button',{name:/Fictional assignee/}).click();
      await page.getByPlaceholder('Добавить соисполнителя…').fill('Fictional');
      await page.getByRole('button',{name:/Fictional coassignee/}).click();
      await page.getByRole('button',{name:/Fictional linked chat/}).click();
      await page.getByTestId('task-route').selectOption('admin');
      await page.getByRole('checkbox',{name:/^Задача для администратора/}).check();
      await page.getByTestId('task-route').scrollIntoViewIfNeeded();
      await mkdir(evidence,{recursive:true});
      await page.evaluate(()=>document.fonts.ready);
      const prefix=`${process.env.TASK_UI_STAGE ?? 'before'}-${testInfo.project.name}-${theme}`;
      await page.screenshot({path:resolve(evidence,`${prefix}-form.png`),scale:'css',animations:'disabled'});
      const route=page.getByTestId('task-route');
      await expect(route.locator('option',{hasText:'Без назначения'})).toHaveCount(1);
      await route.selectOption({label:'Без назначения'});
      await expect(page.locator('summary',{hasText:'Маршрутизация и видимость'})).toContainText('Приватная');
      await expect(page.getByRole('button',{name:/Fictional assignee/})).toHaveCount(0);
      await expect(page.getByTestId('task-coassignees-field')).toHaveCount(0);
      await expect(page.getByRole('button',{name:'Без привязки к чату',exact:true})).toHaveCount(0);
      expect(await page.getByTestId('kub-modal-body').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
      await page.getByTestId('kub-modal-body').evaluate(e=>e.scrollTop=0);
      await page.screenshot({path:resolve(evidence,`${prefix}-unassigned.png`),scale:'css',animations:'disabled'});
      await page.getByRole('button',{name:'Создать',exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>window.fixture.done)).toEqual(['created-task']);
      expect(await page.evaluate(()=>window.fixture.formCalls)).toEqual([{name:'task_create_v4',params:{
        p_title:'Fictional unassigned task',p_description:null,p_assignee_id:null,p_priority:'normal',p_due_at:null,
        p_chat_id:null,p_visibility:'private',p_assignment_scope:'user',p_location_id:null,p_target_role:null,
        p_route_admin_id:null,p_created_for_admin:false,p_starts_at:null,
      }}]);
    }finally{await f.close();}
  });
}
