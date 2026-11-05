const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { compileFixture, mountFixture } = require("../helpers/task-detail-fixture.cjs");

// Reuse the isolated backend and real modal. Add real list/card consumers without
// changing the shared fixture or compiling any production Auth boundary.
async function compileTaskUiFixture() {
  const file = "pages/tasks/TaskDetailModal.tsx";
  const before = readFileSync(resolve(__dirname, "../../artifacts/kub/src", file), "utf8").replaceAll("\r\n", "\n");
  const after = before.replace("useMatchesIsManagerOrAdmin, usePermissionAccess", "useMatchesIsManagerOrAdmin, usePermissionAccess as useFixturePermissionAccess")
    .replace("export function TaskDetailModal(props: Props) {", `
function usePermissionAccess(keys,options) {
  const base=useFixturePermissionAccess(keys,options);
  return keys.includes('tasks.review_own') ? {...base,
    checking:window.fixture.reviewPermissionChecking ?? false,
    hasPermission:key=>window.fixture.reviewPermissions?.includes(key) ?? base.hasPermission(key)} : base;
}
import {TaskListRow} from './TaskListRow';
import {TaskCard} from './TaskCard';
import {BulkSelectControl} from '@/components/ui/BulkSelectControl';
function FictionalTaskList() {
  const f=window.fixture;
  const [selected,setSelected]=useState(false);
  return <main style={{padding:16}}>
    {[TaskListRow,TaskCard].map((Component,index)=><section style={{minWidth:0,marginBottom:16}} key={index} data-testid={index ? 'card' : 'row'}>
      <Component task={f.task()} nowMs={Date.parse('2026-10-07T12:00:00Z')}
        selected={selected} onClick={()=>{f.opens++;}}
        selectionControl={<BulkSelectControl checked={selected} label={index ? 'Select card' : 'Select row'} onChange={setSelected}/>}/>
    </section>)}
  </main>;
}
export function TaskDetailModal(props: Props) {
  createClient().rpc=(name,...args)=>name === 'task_review_access'
    ? {abortSignal:signal=>window.fixture.reviewRead(signal)} : window.fixture.rpc(name,...args);
  return window.fixture.surface === 'list' ? <FictionalTaskList/> : <FictionalTaskDetail {...props}/>;
}
function FictionalTaskDetail(props: Props) {`);
  if (after === before) throw Error("detail entry anchor missing");
  return compileFixture({styles:true,change:{file,before,after}});
}

async function mountTaskUi(page, bundle, theme) {
  const f = await mountFixture(page,bundle,{mode:"modal",theme,autoSubscribe:false});
  await page.evaluate(()=>{
    const f=window.fixture;
    f.opens=0; f.rpcCalls=[];
    f.reviewCalls=0;
    f.reviewPermissions=[];
    f.reviewRead=async()=>{f.reviewCalls++;return {data:{can_review:false,can_review_own:false,is_participant:true,reason:'self_review'},error:null};};
    f.rpc=async(name)=>{f.rpcCalls.push(name);return {error:{message:'insufficient_privilege',code:'42501'}};};
  });
  return f;
}

exports.compileTaskUiFixture=compileTaskUiFixture;
exports.mountTaskUi=mountTaskUi;
