import assert from "node:assert/strict";
import test from "node:test";
import { compileFixture, mountFixture, requireKub } from "../helpers/task-detail-fixture.cjs";

const {chromium} = requireKub("@playwright/test");
let browser: any, bundle: any;
test.before(async()=>{bundle=await compileFixture();browser=await chromium.launch({headless:true});});
test.after(async()=>{await browser?.close();});

async function fixture(options: any = {}, code=bundle) {
  const context=await browser.newContext({serviceWorkers:"block"});
  const page=await context.newPage();
  const f=await mountFixture(page,code,options);
  await f.idle();
  return {...f, async close(){try{await f.close();}finally{await context.close();}}};
}
const timeout = {code:"57014",message:"FICTIONAL_BACKEND_SECRET"};
const denied = {code:"42501",message:"FICTIONAL_BACKEND_SECRET"};

async function promptTerminal(f:any,plan:any) {
  await f.page.evaluate(plan=>{window.fixture.enqueue({...plan,holdTables:['task_events']});window.fixture.deliver();},plan);
  await f.page.waitForFunction(()=>{const batch=window.fixture.batches[1];
    return batch?.completed.includes('tasks') && !batch.completed.includes('task_events');});
  await f.idle();
  assert.equal(await f.page.getByRole("dialog",{name:"Fictional task A",exact:true}).count(),0,
    "terminal task result must retire the actual detail before its history settles");
  assert.equal(await f.page.getByText("Fictional retained history",{exact:true}).count(),0);
  assert.equal(await f.page.getByTestId("task-checklist-draft").count(),0);
  await f.release(1);await f.idle();
  assert.equal(await f.page.getByRole("dialog",{name:"Fictional task A",exact:true}).count(),0,
    "late ancillary completion cannot resurrect the retired detail");
}

for(const [name,plan] of [
  ["42501",{errors:{tasks:denied}}],
  ["successful absence",{absent:true}],
] as const) test("prompt terminal "+name+" retires actual Modal/Checklist while only history is held",async()=>{
  const f=await fixture({mode:"modal"});
  try {await promptTerminal(f,plan);}finally{await f.close();}
});

test("prompt terminal snapshot retirement finishes flags and clears all collections before history",async()=>{
  const f=await fixture();
  try {
    await f.refresh({errors:{tasks:denied},holdTables:["task_events"]});
    await f.idle();const state=await f.state();
    assert.equal(state.task,null);assert.equal(state.loading,false);assert.equal(state.refreshing,false);
    assert.equal(state.error,"denied");assert.deepEqual(state.events,[]);
    assert.deepEqual(state.checklist,[]);assert.deepEqual(state.reminders,[]);
    await f.release(1);await f.idle();assert.deepEqual(await f.state(),state);
  }finally{await f.close();}
});

test("pending ancillary denial retires the loaded parent without waiting for the task",async()=>{
  const f=await fixture();
  try {
    await f.refresh({errors:{task_reminders:{code:"PGRST301",message:"FICTIONAL_BACKEND_SECRET"}},
      holdTables:["tasks"]});await f.idle();
    const state=await f.state();assert.equal(state.task,null);assert.equal(state.error,"denied");
    assert.equal(state.refreshing,false);assert.deepEqual(state.events,[]);
    assert.deepEqual(state.checklist,[]);assert.deepEqual(state.reminders,[]);
    await f.release(1);await f.idle();assert.deepEqual(await f.state(),state);
  }finally{await f.close();}
});

test("pending transient 57014 control preserves actual mounted draft/history until history settles",async()=>{
  const f=await fixture({mode:"modal"});
  try {
    const draft=f.page.getByTestId("task-checklist-draft");await draft.fill("Fictional retained pending draft");
    await f.page.evaluate(()=>{window.fixture.draftNode=document.querySelector('[data-testid="task-checklist-draft"]');
      window.fixture.enqueue({errors:{tasks:{code:'57014',message:'FICTIONAL_BACKEND_SECRET'}},holdTables:['task_events']});
      window.fixture.deliver();});
    await f.page.waitForFunction(()=>window.fixture.batches[1]?.completed.includes('tasks'));
    await f.idle();assert.equal(await draft.inputValue(),"Fictional retained pending draft");
    assert.equal(await f.page.getByText("Fictional retained history",{exact:true}).count(),1);
    assert.equal(await f.page.evaluate(()=>document.querySelector('[data-testid="task-checklist-draft"]')===window.fixture.draftNode),true);
    await f.release(1);await f.idle();assert.equal(await draft.inputValue(),"Fictional retained pending draft");
    assert.equal(await f.page.getByTestId("task-read-error").count(),1);
  }finally{await f.close();}
});

for(const kind of ["request","task","session"] as const) test("late prompt terminal callback cannot retire a newer "+kind,async()=>{
  const f=await fixture();
  try {
    await f.refresh({errors:{tasks:denied},holdTables:["tasks"]});
    if(kind==="request")await f.refresh();
    else await f.page.evaluate(kind=>{if(kind==='task')window.fixture.render('task-b');
      else window.fixture.owner('owner-a','session-2');},kind);
    await f.idle();const state=await f.state();assert.equal(state.task?.id,kind==='task'?"task-b":"task-a");
    await f.release(1);await f.idle();assert.deepEqual(await f.state(),state);
  }finally{await f.close();}
});

test("terminal request late ancillary completion cannot erase a successful newer retry",async()=>{
  const f=await fixture();
  try {
    await f.refresh({errors:{task_reminders:denied},holdTables:["task_events"]});await f.idle();
    assert.equal((await f.state()).task,null);
    await f.refresh();await f.idle();const recovered=await f.state();assert.equal(recovered.task.id,"task-a");
    await f.release(1);await f.idle();assert.deepEqual(await f.state(),recovered);
  }finally{await f.close();}
});

test("compiled terminal-retirement omission is detected by actual mounted pending history",async()=>{
  const change={file:"hooks/useTask.ts",
    before:'setState((previous) => isCurrent()\n          ? { ...emptyDetail(owner), error: terminal === "denied" ? "denied" : null }\n          : previous);',
    after:""};
  const f=await fixture({mode:"modal"},await compileFixture({change}));
  try {await assert.rejects(()=>promptTerminal(f,{errors:{tasks:denied}}),{code:"ERR_ASSERTION"});}
  finally{await f.close();}
});

test("initial success renders the literal task and its three scoped collections",async()=>{
  const f=await fixture();
  try {
    const state=await f.state();
    assert.equal(state.loading,false);assert.equal(state.task.title,"Fictional task A");
    assert.equal(state.events[0].task_id,"task-a");assert.equal(state.checklist[0].task_id,"task-a");
    assert.equal(state.reminders[0].task_id,"task-a");
    assert.deepEqual(await f.page.evaluate(()=>window.fixture.reads),[
      {table:"tasks",id:"task-a"},{table:"task_events",id:"task-a"},
      {table:"task_checklist_items",id:"task-a"},{table:"task_reminders",id:"task-a"},
    ]);
  }finally{await f.close();}
});

test("actual checklist/comment drafts remain local and never write on input",async()=>{
  const f=await fixture({mode:"modal"});
  try {
    await f.page.getByTestId("task-checklist-draft").fill("Fictional draft control");
    await f.page.getByPlaceholder("Оставьте комментарий…").fill("Fictional comment control");
    assert.equal(await f.page.getByTestId("task-checklist-draft").inputValue(),"Fictional draft control");
    assert.equal(await f.page.getByPlaceholder("Оставьте комментарий…").inputValue(),"Fictional comment control");
  }finally{await f.close();}
});

test("loaded refresh never becomes initial loading or loses the snapshot",async()=>{
  const f=await fixture();
  try {
    await f.refresh({hold:true}); await f.idle();
    const state=await f.state();
    assert.equal(state.loading,false); assert.equal(state.refreshing,true);
    assert.equal(state.task.id,"task-a");
    await f.release(1); await f.idle();
    assert.equal((await f.state()).refreshing,false);
  }finally{await f.close();}
});

test("57014 preserves all loaded rows and a successful retry recovers",async()=>{
  const f=await fixture();
  try {
    await f.refresh({errors:{tasks:timeout}}); await f.idle();
    const state=await f.state();
    assert.equal(state.task?.id,"task-a"); assert.equal(state.error,"transient");
    assert.equal(state.events.length,1); assert.equal(state.checklist.length,1); assert.equal(state.reminders.length,1);
    assert.ok(!JSON.stringify(state).includes("FICTIONAL_BACKEND_SECRET"));
    await f.refresh(); await f.idle();
    assert.equal((await f.state()).error,null);
  }finally{await f.close();}
});

test("initial transient failure is retryable without an invented absence",async()=>{
  const f=await fixture({initial:{errors:{tasks:timeout}}});
  try {
    assert.equal((await f.state()).loading,false);
    assert.equal((await f.state()).error,"transient");
    await f.refresh();await f.idle();assert.equal((await f.state()).task.id,"task-a");
  }finally{await f.close();}
});

for(const [name,plan] of [
  ["successful absence",{absent:true}],
  ["explicit task access refusal",{errors:{tasks:denied}}],
  ["explicit dependent-row access refusal",{errors:{task_events:denied}}],
] as const) test(name+" clears the task and every dependent row",async()=>{
  const f=await fixture();
  try {
    await f.refresh(plan); await f.idle();const state=await f.state();
    assert.equal(state.task,null); assert.deepEqual(state.events,[]);
    assert.deepEqual(state.checklist,[]); assert.deepEqual(state.reminders,[]);
  }finally{await f.close();}
});

test("ancillary timeouts retain adjacent lists while fresh task data may advance",async()=>{
  const f=await fixture();
  try {
    const before=await f.state();
    await f.refresh({errors:{task_events:timeout,task_checklist_items:timeout,task_reminders:timeout}});
    await f.idle();const after=await f.state();
    assert.deepEqual(after.events,before.events);assert.deepEqual(after.checklist,before.checklist);
    assert.deepEqual(after.reminders,before.reminders);assert.equal(after.error,"transient");
  }finally{await f.close();}
});

test("explicit ancillary JWT refusal must not retain the old private list",async()=>{
  const f=await fixture();
  try {
    await f.refresh({errors:{task_checklist_items:{code:"PGRST301",message:"FICTIONAL_BACKEND_SECRET"}}});
    await f.idle();const state=await f.state();
    assert.deepEqual(state.checklist,[]);assert.equal(state.task,null);assert.equal(state.error,"denied");
  }finally{await f.close();}
});

test("ancillary HTTP 401 and 403 are explicit denial even without a usable error body",async()=>{
  const f=await fixture();
  try {
    for(const status of [401,403]) {
      await f.refresh();await f.idle();
      await f.refresh({status:{task_reminders:status},errors:{task_reminders:{message:"FICTIONAL_BACKEND_SECRET"}}});
      await f.idle();const state=await f.state();
      assert.equal(state.task,null);assert.deepEqual(state.reminders,[]);assert.equal(state.error,"denied");
    }
  }finally{await f.close();}
});

test("PGRST300 configuration failure remains transient, never an invented auth denial",async()=>{
  const f=await fixture();
  try {
    await f.refresh({errors:{tasks:{code:"PGRST300",message:"FICTIONAL_BACKEND_SECRET"}}});
    await f.idle();const state=await f.state();
    assert.equal(state.task?.id,"task-a");assert.equal(state.checklist.length,1);assert.equal(state.error,"transient");
  }finally{await f.close();}
});

test("a query rejecting without a reason is a failure, not successful task absence",async()=>{
  const f=await fixture();
  try {
    await f.refresh({rejectEmpty:["tasks","task_events"]});await f.idle();const state=await f.state();
    assert.equal(state.task?.id,"task-a");assert.equal(state.events.length,1);assert.equal(state.error,"transient");
  }finally{await f.close();}
});

test("rejected query promises finish loading and retain the same-owner snapshot",async()=>{
  const f=await fixture();
  try {
    await f.refresh({reject:["tasks","task_events"]}); await f.idle();
    assert.equal((await f.state()).task?.id,"task-a");
    assert.equal((await f.state()).loading,false);assert.equal((await f.state()).error,"transient");
  }finally{await f.close();}
});

test("newest refetch wins when the older request resolves last",async()=>{
  const f=await fixture();
  try {
    await f.refresh({hold:true,absent:true});
    await f.refresh();await f.idle();await f.release(1);await f.idle();
    assert.equal((await f.state()).task?.id,"task-a");
  }finally{await f.close();}
});

test("task replacement invalidates late results and retained refetch handles",async()=>{
  const f=await fixture();
  try {
    await f.refresh({hold:true});
    await f.page.evaluate(()=>{window.fixture.oldRefetch=window.fixture.state.refetch;
      window.fixture.render('task-b');});
    await f.idle();await f.release(1);await f.idle();
    assert.equal((await f.state()).task?.id,"task-b");
    const reads=await f.page.evaluate(()=>window.fixture.reads.length);
    await f.page.evaluate(async()=>{await window.fixture.oldRefetch();});await f.idle();
    assert.equal(await f.page.evaluate(()=>window.fixture.reads.length),reads);
    assert.equal((await f.state()).task?.id,"task-b");
  }finally{await f.close();}
});

for(const kind of ["account","session","logout-ABA"] as const) test(kind+" replacement rejects the old request before render",async()=>{
  const f=await fixture();
  try {
    await f.refresh({hold:true});
    await f.page.evaluate(kind=>{
      const f=window.fixture; f.enqueue({hold:true}); f.oldRefetch=f.state.refetch;
      if(kind==='account') f.owner('owner-b','session-b');
      else if(kind==='session') f.owner('owner-a','session-2');
      else f.sameOwnerRoundTrip();
      f.release(1);
    },kind);
    await f.idle();const state=await f.state();
    assert.equal(state.task,null); assert.deepEqual(state.events,[]);assert.equal(state.loading,true);
    const reads=await f.page.evaluate(()=>window.fixture.reads.length);
    await f.page.evaluate(async()=>{await window.fixture.oldRefetch();});await f.idle();
    assert.equal(await f.page.evaluate(()=>window.fixture.reads.length),reads);
    await f.release(2);await f.idle();assert.equal((await f.state()).task.id,"task-a");
  }finally{await f.close();}
});

test("same legitimate session refresh preserves the epoch, snapshot and read count",async()=>{
  const f=await fixture();
  try {
    const before=await f.page.evaluate(()=>({epoch:window.fixture.store.getState().accountEpoch,reads:window.fixture.reads.length}));
    await f.page.evaluate(()=>window.fixture.owner());await f.idle();
    assert.deepEqual(await f.page.evaluate(()=>({epoch:window.fixture.store.getState().accountEpoch,reads:window.fixture.reads.length})),before);
    assert.equal((await f.state()).task.id,"task-a");
  }finally{await f.close();}
});

test("same-user session identity rejects an old refetch synchronously before React commits",async()=>{
  const f=await fixture();
  try {
    const extra=await f.page.evaluate(()=>{
      const f=window.fixture,old=f.state.refetch;
      f.store.getState().setAuthSessionIdentity({userId:'owner-a',sessionId:'session-2'});
      f.store.getState().setCurrentUser(f.profile('owner-a'));
      const before=f.batches.length;void old();return f.batches.length-before;
    });
    assert.equal(extra,0,"retired handle must not start a new read in the old epoch");
  }finally{await f.close();}
});

test("unmount retires retained refetch handles without new reads",async()=>{
  const f=await fixture();
  try {
    await f.refresh({hold:true});
    const before=await f.page.evaluate(()=>{const f=window.fixture;f.oldRefetch=f.state.refetch;
      f.detach();return f.reads.length;});
    await f.release(1);await f.idle();
    await f.page.evaluate(async()=>{await window.fixture.oldRefetch();});
    assert.equal(await f.page.evaluate(()=>window.fixture.reads.length),before);
  }finally{await f.close();}
});

test("actual Modal and Checklist retain the same DOM draft across realtime refresh",async()=>{
  const f=await fixture({mode:"modal"});
  try {
    const draft=f.page.getByTestId("task-checklist-draft");
    await draft.fill("Fictional unsent checklist draft");
    await f.page.getByPlaceholder("Оставьте комментарий…").fill("Fictional unsent comment");
    await f.page.evaluate(()=>{window.fixture.draftNode=document.querySelector('[data-testid="task-checklist-draft"]');
      window.fixture.enqueue({hold:true});window.fixture.deliver();});
    await f.page.waitForFunction(()=>window.fixture.batches.length===2);
    assert.equal(await draft.count(),1,"background refresh must keep the actual checklist mounted");
    assert.equal(await f.page.evaluate(()=>document.querySelector('[data-testid="task-checklist-draft"]')===window.fixture.draftNode),true);
    await f.release(1);await f.idle();
    assert.equal(await draft.inputValue(),"Fictional unsent checklist draft");
    assert.equal(await f.page.getByPlaceholder("Оставьте комментарий…").inputValue(),"Fictional unsent comment");
  }finally{await f.close();}
});

test("actual Modal exposes initial Retry, then retains drafts during failed loaded refresh",async()=>{
  const f=await fixture({mode:"modal",initial:{errors:{tasks:timeout}}});
  try {
    const retry=f.page.getByRole("button",{name:"Повторить"});
    assert.equal(await retry.count(),1);
    await retry.click();await f.idle();
    await f.page.getByTestId("task-checklist-draft").fill("Fictional retained draft");
    await f.page.evaluate(()=>{window.fixture.enqueue({errors:{tasks:{code:'57014',message:'FICTIONAL_BACKEND_SECRET'}}});window.fixture.deliver();});
    await f.page.waitForFunction(()=>window.fixture.batches.length===3);await f.idle();
    assert.equal(await f.page.getByTestId("task-checklist-draft").inputValue(),"Fictional retained draft");
    assert.equal(await retry.count(),1);assert.ok(!(await f.page.locator("body").innerText()).includes("FICTIONAL_BACKEND_SECRET"));
  }finally{await f.close();}
});

for(const kind of ["task","session","account","logout-ABA"] as const) test("actual Modal resets comment, checklist and subdialog on "+kind+" replacement",async()=>{
  const f=await fixture({mode:"modal"});
  try {
    await f.page.getByTestId("task-checklist-draft").fill("Fictional old draft");
    await f.page.getByPlaceholder("Оставьте комментарий…").fill("Fictional old comment");
    await f.page.getByRole("button",{name:"Удалить задачу",exact:true}).click();
    await f.page.getByPlaceholder("Например: тестовая задача больше не нужна").fill("Fictional subdialog draft");
    await f.page.evaluate(kind=>{const f=window.fixture;
      if(kind==='task')f.render('task-b');else if(kind==='account')f.owner('owner-b','session-b');
      else if(kind==='logout-ABA')f.sameOwnerRoundTrip();else f.owner('owner-a','session-2');},kind);
    await f.idle();
    assert.equal(await f.page.getByRole("dialog",{name:"Удалить задачу?",exact:true}).count(),0);
    assert.equal(await f.page.getByTestId("task-checklist-draft").inputValue(),"");
    assert.equal(await f.page.getByPlaceholder("Оставьте комментарий…").inputValue(),"");
  }finally{await f.close();}
});

test("same-task background read leaves the actual open subdialog and its draft mounted",async()=>{
  const f=await fixture({mode:"modal"});
  try {
    await f.page.getByRole("button",{name:"Удалить задачу",exact:true}).click();
    const reason=f.page.getByPlaceholder("Например: тестовая задача больше не нужна");
    await reason.fill("Fictional retained subdialog");
    await f.page.evaluate(()=>{window.fixture.enqueue({hold:true});window.fixture.deliver();});
    await f.page.waitForFunction(()=>window.fixture.batches.length===2);
    assert.equal(await reason.inputValue(),"Fictional retained subdialog");
    await f.release(1);await f.idle();
    assert.equal(await reason.inputValue(),"Fictional retained subdialog");
  }finally{await f.close();}
});

const mutants = [
  {name:"empty-rejection",file:"hooks/useTask.ts",before:"error: error || true",after:"error",
    async check(f:any){await f.refresh({rejectEmpty:["tasks"]});await f.idle();assert.equal((await f.state()).task?.id,"task-a");}},
  {name:"background-loading",file:"hooks/useTask.ts",before:"loading: !held.task",after:"loading: true",
    async check(f:any){await f.refresh({hold:true});await f.idle();assert.equal((await f.state()).loading,false);}},
  {name:"transient-snapshot",file:"hooks/useTask.ts",
    before:'if (taskRes.error) return { ...held, loading: false, refreshing: false, error: "transient" };',
    after:'if (taskRes.error) return { ...emptyDetail(owner), error: "transient" };',
    async check(f:any){await f.refresh({errors:{tasks:timeout}});await f.idle();assert.equal((await f.state()).task?.id,"task-a");}},
  {name:"denial-code",file:"hooks/useTask.ts",before:'error.code === "42501"',after:'error.code === "42502"',
    async check(f:any){await f.refresh({errors:{tasks:denied}});await f.idle();assert.equal((await f.state()).task,null);}},
  {name:"jwt-denial",file:"hooks/useTask.ts",before:'error.code === "PGRST301"',after:'error.code === "PGRST399"',
    async check(f:any){await f.refresh({errors:{task_checklist_items:{code:"PGRST301"}}});await f.idle();
      assert.deepEqual((await f.state()).checklist,[]);}},
  {name:"http-denial",file:"hooks/useTask.ts",before:'response.status === 401 || response.status === 403',after:'false',
    async check(f:any){await f.refresh({status:{task_events:401},errors:{task_events:{message:"FICTIONAL_BACKEND_SECRET"}}});
      await f.idle();assert.deepEqual((await f.state()).events,[]);}},
  {name:"event-retention",file:"hooks/useTask.ts",before:"eventsRes.error ? held.events :",after:"eventsRes.error ? [] :",
    async check(f:any){await f.refresh({errors:{task_events:timeout}});await f.idle();assert.equal((await f.state()).events.length,1);}},
  {name:"latest-request",file:"hooks/useTask.ts",before:"request === owner.request",after:"true",
    async check(f:any){await f.refresh({hold:true,absent:true});await f.refresh();await f.idle();
      await f.release(1);await f.idle();assert.equal((await f.state()).task?.id,"task-a");}},
  {name:"epoch-fence",file:"hooks/useTask.ts",before:"useAppStore.getState().accountEpoch === accountEpoch",after:"true",
    async check(f:any){const extra=await f.page.evaluate(()=>{const f=window.fixture,old=f.state.refetch;
      f.store.getState().setAuthSessionIdentity({userId:'owner-a',sessionId:'session-2'});
      f.store.getState().setCurrentUser(f.profile('owner-a'));const before=f.batches.length;
      void old();return f.batches.length-before;});assert.equal(extra,0);}},
  {name:"lifetime-fence",file:"hooks/useTask.ts",before:"owner.active && ownerRef.current === owner",after:"ownerRef.current === owner",
    async check(f:any){const before=await f.page.evaluate(()=>{const f=window.fixture;f.old=f.state.refetch;f.detach();return f.batches.length;});
      await f.page.evaluate(async()=>{await window.fixture.old();});
      assert.equal(await f.page.evaluate(()=>window.fixture.batches.length),before);}},
  {name:"draft-owner-key",file:"pages/tasks/TaskDetailModal.tsx",
    before:"key={JSON.stringify([props.taskId, userId, accountEpoch])}",after:'key="shared-modal"',mode:"modal",
    async check(f:any){await f.page.getByPlaceholder("Оставьте комментарий…").fill("Fictional old draft");
      await f.page.evaluate(()=>window.fixture.render('task-b'));await f.idle();
      assert.equal(await f.page.getByPlaceholder("Оставьте комментарий…").inputValue(),"");}},
];

for(const change of mutants) test("compiled omission is detected: "+change.name,async()=>{
  const f=await fixture({mode:change.mode??"hook"},await compileFixture({change}));
  try {await assert.rejects(()=>change.check(f),{code:"ERR_ASSERTION"});}finally{await f.close();}
});
