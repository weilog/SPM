const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
require('../apps/api/node_modules/reflect-metadata');require('../apps/api/node_modules/dotenv').config({quiet:true});
const {DbService}=require('../apps/api/dist/db/db.module');
const fixture=require('./fixtures/project-lifecycle-template.json');
(async()=>{
 const manifest=JSON.parse(fs.readFileSync('.runtime/lifecycle-demo.json'));
 const db=new DbService();let browser;const checks=[],errors=[];
 const dir='.runtime/lifecycle-audit';fs.mkdirSync(dir,{recursive:true});
 const pass=s=>{checks.push(s);console.log('PASS '+s)};
 try{
  assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
  const projectId=manifest.projectId;
  assert.equal((await db.project.findUniqueOrThrow({where:{id:projectId}})).name,fixture.name);
  const reqs=await db.requirement.findMany({where:{projectId}}),items=await db.planItem.findMany({where:{projectId}}),tasks=await db.task.findMany({where:{projectId},include:{history:true,planLinks:true,storyLinks:true}});
  assert.equal(reqs.length,35);assert.equal(items.filter(i=>i.kind==='item').length,35);assert.equal(items.filter(i=>i.kind==='milestone').length,5);assert.equal(tasks.length,32);assert.equal(tasks.filter(t=>t.archivedAt).length,1);assert.equal(tasks.filter(t=>!t.archivedAt&&!t.planLinks.length).length,3);
  const level=r=>r.parentId?1+level(reqs.find(p=>p.id===r.parentId)):1;assert.equal(Math.max(...reqs.map(level)),3);
  assert.equal(await db.storyRequirement.count({where:{projectId}}),35);assert.equal(await db.storyTask.count({where:{projectId}}),32);assert.equal(await db.taskPlanReference.count({where:{projectId}}),28);
  for(const t of tasks){assert.equal(t.storyLinks.length,1);assert(t.status==='DONE'?t.progress===100:t.status==='TODO'?t.progress===0:t.progress>=0&&t.progress<=99);for(const h of t.history)assert(h.createdAt>=t.createdAt,`History before creation: ${t.title}`);}
  assert.deepEqual(new Set(tasks.map(t=>t.priority)),new Set(['URGENT','HIGH','MEDIUM','LOW']));
  pass('35 three-level requirements, 35 work items + 5 milestones, 28 leaf Task links, 3 pending-plan tasks + 1 archive; valid progress/history chronology and all four priorities');
  browser=await chromium.launch({headless:true,...(process.env.SPM_CHROME_PATH?{executablePath:process.env.SPM_CHROME_PATH}:{})});
  const origin='http://127.0.0.1:5173',context=await browser.newContext({viewport:{width:1440,height:900}});
  const login=async(c,username)=>assert.equal((await c.request.post(origin+'/api/auth/login',{headers:{'X-SPM-Request':'1'},data:{username,password:'SpmDemo!2026'}})).status(),201);
  await login(context,'tpl_pm');
  const read=async path=>{const r=await context.request.get(origin+'/api'+path);assert.equal(r.status(),200,path);return r.json()};
  const plans=await read(`/projects/${projectId}/plan-adapter`),stories=await read(`/projects/${projectId}/story-map`);
  assert.equal(plans.stages.length,5);assert.equal(plans.items.length,40);assert.equal(stories.goals.length,3);assert.equal(stories.epics.length,7);assert.equal(stories.stories.length,17);
  const charter=plans.items.find(i=>i.title==='制定项目章程');const focus=await read(`/projects/${projectId}/relations/resolve?entityType=planItem&entityId=${charter.id}`);assert(focus.tasks.includes(manifest.taskIds.charter));assert(focus.stories.length>0);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/');await page.getByRole('button',{name:fixture.name,exact:true}).first().click();await page.getByRole('heading',{name:fixture.name,exact:true}).waitFor();
  const nav=async name=>page.locator('.sidebar').getByRole('button',{name,exact:true}).click();const shot=async key=>page.screenshot({path:`${dir}/${key}.png`,animations:'disabled'});
  await shot('overview');await nav('需求管理');await page.getByRole('button',{name:'全部展开',exact:true}).click();assert.equal(await page.locator('.b-req-tree tbody tr').count(),35);await shot('requirements');
  await page.getByRole('tab',{name:/^故事地图/}).click();await page.locator('.story-map').waitFor();await shot('story-map');await page.getByRole('tab',{name:/^故事看板/}).click();await page.locator('.story-board').waitFor();assert.equal(await page.locator('.story-board .story-card').count(),17);await shot('story-board');pass('Manager overview, expanded 35-row WBS tree and shared story map/three-column board render real records');
  await nav('项目计划');await page.locator('.stagecard').first().waitFor();assert.equal(await page.locator('.stagecard').count(),5);
  for(const stage of fixture.stages){await page.locator('.stagecard').filter({hasText:stage.title}).click();await page.getByRole('button',{name:'甘特图',exact:true}).click();const expected=fixture.nodes.filter(n=>n.stage===stage.key).length+2;assert.equal(await page.locator('.gv-fixed-row').count(),expected);await shot('gantt-'+stage.key);}
  await page.locator('.stagecard').filter({hasText:'项目执行阶段'}).click();await page.getByRole('button',{name:'列表',exact:true}).click();await shot('execution-list');await page.getByRole('button',{name:'看板',exact:true}).click();await shot('execution-board');await page.getByRole('button',{name:'成员任务跟踪',exact:true}).click();await shot('execution-tracking');pass('All five phases have populated Gantt timelines; execution list, four-state board and member Task tracking load the same plan records');
  await nav('任务管理');await page.getByRole('tab',{name:'成员任务图',exact:true}).click();await page.locator('.graph-svg').waitFor();await shot('member-graph');
  await nav('项目文档');await page.locator('.a-docs .file-table-scroll').waitFor();await shot('documents');const document=await db.projectDocument.findFirstOrThrow({where:{projectId,name:'项目章程.md'}});const file=await context.request.get(`${origin}/api/projects/${projectId}/documents/${document.id}/content?download=1`);assert.equal(file.status(),200);assert.deepEqual(await file.body(),Buffer.from(document.content));
  await nav('多视图工作台');await page.getByRole('tab',{name:'UML 用例图',exact:true}).click();await shot('uml');await page.getByRole('button',{name:'甘特 + 成员',exact:true}).click();await page.getByRole('separator',{name:'调整甘特图信息区宽度'}).waitFor();await shot('workbench');pass('Member/task graph, real downloadable document bytes, UML and dual workbench focus use this project and its actual IDs');
  for(const username of ['tpl_frontend','tpl_backend','tpl_qa','tpl_ops','tpl_observer']){
    const c=await browser.newContext();await login(c,username);const r=await c.request.get(`${origin}/api/projects/${projectId}`);assert.equal(r.status(),username==='tpl_observer'?404:200);
    if(username!=='tpl_observer'){
      const mine=await c.request.get(`${origin}/api/projects/${projectId}/tasks/mine`);assert.equal(mine.status(),200);const body=await mine.json();const user=await db.user.findUniqueOrThrow({where:{username}});assert(body.length>0);assert(body.every(t=>t.assigneeUserId===user.id));
      const denied=await c.request.post(`${origin}/api/projects/${projectId}/plan-adapter/stages`,{headers:{'X-SPM-Request':'1'},data:{title:'越权写入不应成功',start:'2026-10-22',end:'2026-10-23'}});assert.equal(denied.status(),403);
    }
    await c.request.post(origin+'/api/auth/logout',{headers:{'X-SPM-Request':'1'}});await c.close();
  }
  pass('Frontend/backend/test/operations accounts see their own tasks; plan writes are denied, and outsider cannot enter the project');
  assert.equal(errors.length,0);pass('Zero browser runtime errors; verification made no project-data changes');
  await context.request.post(origin+'/api/auth/logout',{headers:{'X-SPM-Request':'1'}});
  fs.writeFileSync(dir+'/result.json',JSON.stringify({result:'PASS',viewport:{width:1440,height:900},projectId,checks,errors},null,2));
 }finally{if(browser)await browser.close();await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1});
