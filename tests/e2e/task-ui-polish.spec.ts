import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {compileFormFixture,mountFormFixture} from './task-ui-form-fixture.cjs';

test.use({screenshot:'off',trace:'off',video:'off',serviceWorkers:'block'});
let form:Awaited<ReturnType<typeof compileFormFixture>>,list:typeof form;
test.beforeAll(async()=>{test.setTimeout(120_000);form=await compileFormFixture();list=await compileFormFixture({mode:'page'});});
const evidence=resolve(process.env.TEMP ?? 'C:/Users/maksi/AppData/Local/Temp','letscube-task-ui-20261105');

for(const theme of ['light','dark'] as const) {
  test(`basic task fields precede collapsed advanced settings (${theme})`,async({page},info)=>{
    const f=await mountFormFixture(page,form,theme);
    try {
      await mkdir(evidence,{recursive:true});await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:resolve(evidence,`${process.env.TASK_UI_STAGE??'before'}-${info.project.name}-${theme}-form-basic.png`),scale:'css',animations:'disabled'});
      await expect(page.getByPlaceholder('Поиск по имени или @никнейму…')).toBeInViewport();
      const repeat=page.locator('details').filter({has:page.locator('summary',{hasText:'Повторение'})});
      const routing=page.locator('details').filter({has:page.locator('summary',{hasText:'Маршрутизация и видимость'})});
      await expect(repeat).not.toHaveAttribute('open','');
      await expect(routing).not.toHaveAttribute('open','');
      await expect(page.getByText(/scheduler|Supabase|Экземпляр будет создан/)).toHaveCount(0);
      await page.getByRole('combobox',{name:'Приоритет',exact:true}).selectOption('high');
      await page.locator('summary',{hasText:'Повторение'}).click();
      await expect(page.getByRole('checkbox',{name:'Повторять задачу',exact:true})).toBeVisible();
      await page.locator('summary',{hasText:'Маршрутизация и видимость'}).click();
      await expect(page.getByRole('combobox',{name:/^Локация/})).toBeVisible();
      await page.getByRole('combobox',{name:/^Локация/}).selectOption('location-a');
      await page.locator('summary',{hasText:'Маршрутизация и видимость'}).click();
      await page.locator('summary',{hasText:'Маршрутизация и видимость'}).click();
      await expect(page.getByRole('combobox',{name:/^Локация/})).toHaveValue('location-a');
      expect(await page.getByTestId('kub-modal-body').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
    }finally{await f.close();}
  });

  test(`people filter searches avatars and combines selected people with OR (${theme})`,async({page},info)=>{
    const f=await mountFormFixture(page,list,theme);
    try {
      await page.getByRole('button',{name:/^Все/}).first().click();
      await page.getByRole('button',{name:/^Фильтры/}).click();
      await mkdir(evidence,{recursive:true});await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:resolve(evidence,`${process.env.TASK_UI_STAGE??'before'}-${info.project.name}-${theme}-page-filter.png`),scale:'css',animations:'disabled'});
      const trigger=page.locator('#task-assignee-filter');
      await expect(trigger).toHaveAttribute('aria-haspopup','dialog');
      await trigger.click();
      const search=page.getByPlaceholder('Найти исполнителя…');
      await expect(search).toBeFocused();
      await expect(page.getByRole('option',{name:/Все исполнители/})).toBeVisible();
      await expect(page.getByRole('option',{name:/Без исполнителя/})).toBeVisible();
      await search.fill('fixture12');
      const option=page.getByRole('option',{name:/Fictional person 12/});
      await expect(option).toBeVisible();
      await expect(option).toHaveAttribute('data-selected','true');
      await expect(option.locator('[data-testid="task-filter-avatar"]')).toBeVisible();
      const contrast=await option.evaluate(element=>{
        const text=element.querySelector('span.min-w-0')!;
        const foreground=getComputedStyle(text).color,background=getComputedStyle(element).backgroundColor;
        const channels=(color:string)=>color.match(/[\d.]+/g)!.map(Number);
        const luminance=(color:number[])=>color.slice(0,3).map(channel=>channel/255)
          .map(channel=>channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4)
          .reduce((sum,channel,index)=>sum+channel*[0.2126,0.7152,0.0722][index],0);
        const fg=channels(foreground),bg=channels(background),a=luminance(fg),b=luminance(bg);
        return {foreground,background,alpha:bg[3]??1,ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
      });
      expect(contrast.alpha).toBe(1);
      expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
      if(theme==='light') expect(contrast.foreground).toBe('rgb(7, 17, 31)');
      console.log('TASK_UI_HIGHLIGHT_CONTRAST',theme,contrast);
      await page.screenshot({path:resolve(evidence,`${process.env.TASK_UI_STAGE??'before'}-${info.project.name}-${theme}-people-search.png`),scale:'css',animations:'disabled'});
      await page.keyboard.press('Enter');
      await expect(search).toBeVisible();
      await expect(page.getByRole('heading',{name:'Fictional task 12',exact:true})).toBeVisible();
      await expect(page.getByRole('heading',{name:'Fictional task 11',exact:true})).toHaveCount(0);
      await search.fill('fixture11');await page.getByRole('option',{name:/Fictional person 11/}).click();
      await expect(page.getByRole('heading',{name:'Fictional task 11',exact:true})).toBeVisible();
      await expect(page.getByRole('heading',{name:'Fictional task 12',exact:true})).toBeVisible();
      await search.fill('');await page.getByRole('option',{name:'Без исполнителя',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Fictional task 17',exact:true})).toBeVisible();
      await expect(trigger).toContainText('3');
      await page.screenshot({path:resolve(evidence,`${process.env.TASK_UI_STAGE??'before'}-${info.project.name}-${theme}-people-multi.png`),scale:'css',animations:'disabled'});
      await page.getByRole('button',{name:'Сбросить выбор',exact:true}).click();
      await expect(page.getByRole('heading',{name:/^Fictional task \d+$/})).toHaveCount(18);
      await page.getByRole('option',{name:'Я',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Fictional task 0',exact:true})).toBeVisible();
      await expect(page.getByRole('heading',{name:'Fictional task 1',exact:true})).toBeVisible();
      await expect(page.getByRole('heading',{name:'Fictional task 12',exact:true})).toHaveCount(0);
      await page.getByRole('option',{name:/Все исполнители/}).click();
      await expect(page.getByRole('heading',{name:/^Fictional task \d+$/})).toHaveCount(18);
      await search.fill('not-a-fictional-person');
      await expect(page.getByText('Исполнители не найдены', {exact:true})).toBeVisible();
      await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
      await trigger.click();
      await page.getByPlaceholder('Поиск по задачам…').click();
      await expect(search).toHaveCount(0);
    }finally{await f.close();}
  });
}
