// Opt-in live integration check against the isolated, labelled local demo preview.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.WORKBENCH_PREVIEW_URL || 'http://127.0.0.1:5175';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Local preview only');
const password = process.env.DEMO_SEED_PASSWORD || 'SpmDemo!2026';
async function login(username) {
  const r = await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-SPM-Request':'1',Origin:base},body:JSON.stringify({username,password})});
  assert.equal(r.status,201); return r.headers.get('set-cookie').split(';')[0];
}
async function call(cookie,path,method='GET',body,expected=200) {
  const r = await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'X-SPM-Request':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data = await r.json(); assert.equal(r.status,expected,JSON.stringify(data)); return data;
}
(async()=>{
  const pm = await login('tpl_pm'), member = await login('tpl_frontend'), outsider = await login('tpl_observer');
  const projects = await call(pm,'/projects');
  const project = projects.find(p=>p.name==='爱管理协同平台建设 · 五阶段示例');
  assert(project?.description.includes('[demo-template:spm-lifecycle-v1]'),'Refusing to modify non-demo project');
  const root='/projects/'+project.id;
  const tasks=await call(pm,root+'/tasks');
  const task=tasks.find(t=>t.title==='定义活动');
  assert(task && task.assigneeUserId, 'Browser assignment flow must be complete');
  await call(member,root+`/tasks/mine/${task.id}`);
  const plans=await call(pm,root+'/plan-adapter'), stories=await call(pm,root+'/story-map');
  const planRecords = snapshot => ({...snapshot,items:snapshot.items.map(({tasks,...record})=>record)});
  const controller = new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  const stream=await fetch(base+'/api'+root+'/events',{headers:{Cookie:pm},signal:controller.signal});
  assert.equal(stream.status,200);
  const reader=stream.body.getReader(); let pending='';
  async function changed(){
    while(true){
      const split=pending.indexOf('\n\n');
      if(split>=0){const msg=pending.slice(0,split);pending=pending.slice(split+2);if(msg.includes('event: changed'))return msg;continue;}
      const next=await reader.read();assert(!next.done,'SSE ended');pending+=new TextDecoder().decode(next.value).replace(/\r\n/g,'\n');
    }
  }
  try{
    const initial=await changed();
    const opened=await call(pm,root+`/tasks/${task.id}/status`,'PATCH',{status:'IN_PROGRESS',revision:task.revision});
    const updated=await call(member,root+`/tasks/${task.id}/progress`,'PATCH',{progress:37,revision:opened.revision});
    await call(member,root+`/tasks/${task.id}/progress`,'PATCH',{progress:40,revision:opened.revision},409);
    const second=await changed();assert.notEqual(second,initial);
    // Embedded task projections must update; the plan records themselves must not.
    assert.deepEqual(planRecords(await call(pm,root+'/plan-adapter')),planRecords(plans));
    assert.deepEqual(await call(pm,root+'/story-map'),stories);
    await call(outsider,root+'/tasks','GET',undefined,404);
    await call(member,root+`/tasks/${task.id}/assignee`,'PATCH',{assigneeUserId:task.assigneeUserId,revision:updated.revision},403);
    const emptyName='工作台隔离验收 · 空项目';
    const empty=projects.find(p=>p.name===emptyName)||await call(pm,'/projects','POST',{name:emptyName,description:'仅用于当前隔离预览 schema 的项目切换验收。'},201);
    await call(member,`/projects/${empty.id}/tasks`,'GET',undefined,404);
    const result={result:'PASS',checks:['two authenticated users','member writes own progress','manager receives SSE change','stale revision returns 409','plans unchanged','stories unchanged','outsider denied','member cannot reassign'],taskId:task.id,progress:updated.progress,status:updated.status};
    fs.mkdirSync('docs/evidence/workbench-v2-delivery',{recursive:true});fs.writeFileSync('docs/evidence/workbench-v2-delivery/live-api.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally { clearTimeout(timer);await reader.cancel();controller.abort(); }
})().catch(e=>{console.error(e.message);process.exitCode=1});
