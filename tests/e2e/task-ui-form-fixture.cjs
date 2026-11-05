const {readFileSync}=require("node:fs");
const {createRequire}=require("node:module");
const {resolve}=require("node:path");
const {requireKub,mountFixture}=require("../helpers/task-detail-fixture.cjs");
const root=resolve(__dirname,"../../artifacts/kub");
const sourceRoot=resolve(root,"src");

async function compileFormFixture({mode="form"}={}) {
  const boundaries=new Map([
    ["lib/supabase/client.ts",`const client={from:table=>window.fixture.formQuery(table),rpc:(...args)=>window.fixture.formRpc(...args)};
      export const createClient=()=>client; export const isSupabaseConfigured=()=>false;`],
    ["lib/outbox/appOutbox.ts","export const appOutbox={stop(){}};"],
    ["hooks/useRole.ts",`export function clearRoleAccessCache() {} export const usePermissionAccess=()=>({
      checking:false,hasPermission:()=>true,hasAnyPermission:()=>true});
      export const useAnyLocationPermissionAccess=usePermissionAccess;
      export const useMatchesIsManagerOrAdmin=()=>({allowed:true,checking:false});`],
    ["hooks/useLocationAdmin.ts",`export const useIsLocationAdmin=()=>({isLocationAdmin:false});`],
    ["hooks/useTaskRouting.ts",`export const useTaskRouting=()=>window.fixture.routing;`],
    ["hooks/useRecurringTasks.ts",`export const useRecurringTasksAvailability=()=>({available:true});
      export const createTaskRecurrence=()=>{throw Error('unexpected recurrence');};
      export const useTaskRecurrence=()=>({recurrence:null,status:'ready',message:null,refetch:async()=>{}});
      export const pauseTaskRecurrence=()=>{throw Error('unexpected write');};
      export const resumeTaskRecurrence=pauseTaskRecurrence;export const stopTaskRecurrence=pauseTaskRecurrence;`],
    ["hooks/useMediaVariants.ts",`export const useAvatarVariant=()=>({settled:true});export const useChatAvatarVariant=useAvatarVariant;`],
    ["hooks/useMediaObjectUrl.ts",`export const useAvatarMediaUrl=url=>url;`],
    ...(mode==="page"?[
      ["hooks/useTasks.ts",`export const useTasks=()=>({tasks:window.fixture.tasks,loading:false,error:null,view:'ready',refetch:async()=>{}});`],
      ["hooks/useTask.ts",`export const useTask=id=>({task:window.fixture.tasks.find(task=>task.id===id),events:[],checklist:[],reminders:[],
        loading:false,refreshing:false,error:null,refetch:async()=>window.fixture.render()});`],
      ["hooks/useTaskSoftDelete.ts",`export const useTaskSoftDelete=()=>({bulkSoftDeleteTasks:()=>{throw Error('unexpected write');}});`],
      ["pages/tasks/TaskFormModal.tsx",`export const TaskFormModal=()=>null;`],
    ]:[]),
  ]);
  const {build}=createRequire(requireKub.resolve("vite"))("esbuild");
  const result=await build({write:false,bundle:true,platform:"browser",format:"iife",jsx:"automatic",metafile:true,
    alias:{"@":sourceRoot},define:{"process.env.NODE_ENV":'"development"',"import.meta.env":'{"DEV":false}'},
    plugins:[{name:"fictional-form-boundaries",setup(plugin){plugin.onLoad({filter:/\.[tj]sx?$/},args=>{
      const key=args.path.slice(sourceRoot.length+1).replaceAll("\\","/");
      if(boundaries.has(key)) return {contents:boundaries.get(key),loader:"tsx"};
    });}}],stdin:{resolveDir:root,loader:"tsx",contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {${mode==="page"?"TasksPage":"TaskFormModal"}} from './src/pages/tasks/${mode==="page"?"TasksPage":"TaskFormModal"}';
      import {useAppStore} from './src/store/app.store'; import {applyResolvedTheme} from './src/lib/themeRuntime';
      const f=window.fixture; applyResolvedTheme(f.theme);
      f.routing={available:true,loading:false,error:null,locations:[{id:'location-a',name:'Fictional location',is_active:true}],
        members:[{location_id:'location-a',user_id:'admin-a',role:'admin',profile:f.profile('admin-a')}]};
      f.formCalls=[];f.done=[];
      f.tasks=Array.from({length:18},(_,i)=>({...f.task('task-'+i,'Fictional task '+i),
        assignee_id:i===17?null:i===0?'owner-a':'person-'+i,
        assignee:i===17?null:{...f.profile(i===0?'owner-a':'person-'+i),full_name:'Fictional person '+i,username:'fixture'+i},
        coassignees:i===1?[{user_id:'owner-a',profile:f.profile('owner-a')}]:i===4?[
          {user_id:'co-only',profile:{...f.profile('co-only'),full_name:'Fictional only coexecutor',username:'cofixture'}}]:[]}));
      f.formRpc=(name,params)=>{f.formCalls.push({name,params});
        if(name==='task_review_access')return {abortSignal:()=>Promise.resolve({data:{can_review:true,can_review_own:true,is_participant:true,reason:'ready'},error:null})};
        if(name==='task_confirm') f.tasks=f.tasks.map(task=>task.id===params.p_task_id?{...task,status:'confirmed',updated_at:'2026-11-05T12:00:00Z'}:task);
        return Promise.resolve({data:'created-task',error:null});};
      f.formQuery=table=>{if(!['chats','profiles'].includes(table)) throw Error('unexpected form table');
        const q={select(){return q;},order(){return q;},limit(){return q;},or(){return q;},then(done,fail){
          return Promise.resolve({data:table==='profiles'?[
            {...f.profile('assignee-a'),full_name:'Fictional assignee'},
            {...f.profile('co-a'),full_name:'Fictional coassignee'},
          ]:[{id:'chat-a',type:'group',name:'Fictional linked chat',avatar_url:null,members:[]}],error:null}).then(done,fail);}};return q;};
      const root=createRoot(document.getElementById('root'));
      useAppStore.getState().setAuthSessionIdentity({userId:'owner-a',sessionId:'fictional-form'});
      useAppStore.getState().setCurrentUser(f.profile('owner-a'));
      f.unmount=()=>flushSync(()=>root.unmount());f.batches.push({release(){}});
      f.render=()=>flushSync(()=>root.render(${mode==="page"?'<TasksPage/>':'<TaskFormModal onClose={()=>{}} onDone={id=>f.done.push(id)}/>'}));
      f.render();
    `}});
  const {compile}=createRequire(requireKub.resolve("@tailwindcss/vite"))("@tailwindcss/node");
  const compiler=await compile(readFileSync(resolve(sourceRoot,"index.css"),"utf8"),{base:sourceRoot,onDependency(){}});
  const candidates=new Set();
  for(const file of Object.keys(result.metafile.inputs)) {
    const path=resolve(file);if(!path.startsWith(sourceRoot)) continue;
    for(const token of readFileSync(path,"utf8").match(/[^\s"'`]+/g)??[]) candidates.add(token);
  }
  return {js:result.outputFiles[0].text,css:compiler.build([...candidates])};
}

exports.compileFormFixture=compileFormFixture;
exports.mountFormFixture=(page,bundle,theme)=>mountFixture(page,bundle,{mode:"form",theme});
