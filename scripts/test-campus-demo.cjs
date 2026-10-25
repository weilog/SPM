const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
require('../apps/api/node_modules/dotenv').config({quiet:true});
require('../apps/api/test/disable-paid-ai.cjs');
process.env.AI_ENABLED='false';
const {Pool}=require('../apps/api/node_modules/pg');
const root=path.resolve(__dirname,'..'),schema=`campus_seed_test_${Date.now()}`;
const url=new URL(process.env.DATABASE_URL);assert(['localhost','127.0.0.1'].includes(url.hostname));
url.searchParams.set('schema',schema);process.env.DATABASE_URL=url.href;
const {seed}=require('./seed-campus-demo.cjs');
const {makeFixture}=require('./fixtures/campus-demo.cjs');
const {DbService}=require('../apps/api/dist/db/db.module');
const {NestFactory}=require('../apps/api/node_modules/@nestjs/core');
const {AppModule}=require('../apps/api/dist/app.module');
const {configure}=require('../apps/api/dist/bootstrap');
const request=require('../apps/api/node_modules/supertest');
(async()=>{
  const pool=new Pool({connectionString:url.href});const db=new DbService();let app;
  try{
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const migration=spawnSync(process.execPath,[path.join(root,'apps/api/node_modules/prisma/build/index.js'),'migrate','deploy','--config','prisma.config.ts'],{cwd:path.join(root,'apps/api'),env:process.env,encoding:'utf8'});
    assert.equal(migration.status,0,migration.stderr);
    const sentinel=await db.user.create({data:{username:'unrelated_account',passwordHash:'test-sentinel'}});
    const manifest=await seed(db,'2026-10-25'),projectId=manifest.projects[0].id;
    const count=async table=>db[table].count({where:{projectId}});
    for(const [table,expected] of Object.entries({requirement:24,productGoal:3,epic:6,userStory:14,planStage:5,planItem:25,task:34,projectMember:7,projectDocument:18,umlDiagram:2,taskPlanReference:24,storyRequirement:23,storyTask:33}))assert.equal(await count(table),expected,table);
    const reqs=await db.requirement.findMany({where:{projectId},include:{storyLinks:true}});
    const depth=r=>r.parentId?depth(reqs.find(p=>p.id===r.parentId))+1:1;
    assert.deepEqual([1,2,3].map(d=>reqs.filter(r=>depth(r)===d).length),[4,8,12]);
    assert.equal(reqs.filter(r=>!r.storyLinks.length)[0].title,'报名取消规则');
    assert.equal(reqs.filter(r=>!r.acceptanceCriteria)[0].title,'统计结果导出');
    const tasks=await db.task.findMany({where:{projectId},include:{history:true,planLinks:true}});
    const active=tasks.filter(t=>!t.archivedAt);
    assert.deepEqual(['DONE','IN_PROGRESS','TODO'].map(status=>active.filter(t=>t.status===status).length),[10,12,10]);
    assert.equal(active.filter(t=>!t.planLinks.length).length,8);
    assert.equal(active.filter(t=>!t.assigneeUserId).length,1);
    for(const t of tasks){assert(t.status==='DONE'?t.progress===100:t.status==='TODO'?t.progress===0:t.progress>0&&t.progress<100);assert(t.history.every(h=>h.createdAt>=t.createdAt));}
    const files=await db.projectDocument.findMany({where:{projectId,kind:'FILE'}});assert.equal(files.length,12);assert(files.every(f=>f.content.length===f.size));
    const before=await db.task.findFirstOrThrow({where:{projectId}});await db.task.update({where:{id:before.id},data:{title:'保留手工修改'}});
    assert((await seed(db,'2027-01-01')).alreadyExists);
    assert.equal((await db.task.findUniqueOrThrow({where:{id:before.id}})).title,'保留手工修改');
    assert.equal(await count('task'),34);
    assert.deepEqual(await db.user.findUniqueOrThrow({where:{id:sentinel.id}}),sentinel);
    assert.equal((await db.planStage.findFirstOrThrow({where:{projectId},orderBy:{sortOrder:'asc'}})).start,makeFixture('2026-10-25').day(-35));
    console.log('PASS real DB: counts, hierarchy, relationships, task histories, document bytes, fixed first-import dates and idempotency');
    app=configure(await NestFactory.create(AppModule,{logger:false}));await app.init();
    const cookies={};
    for(const username of ['campus_pm','campus_pm2','campus_frontend_1','campus_backend','campus_qa','campus_admin','campus_guest']){
      const response=await request(app.getHttpServer()).post('/api/auth/login').set('X-SPM-Request','1').send({username,password:process.env.DEMO_SEED_PASSWORD||'SpmDemo!2026'});assert.equal(response.status,201);cookies[username]=response.headers['set-cookie'].map(c=>c.split(';')[0]).join(';');
    }
    const call=(who,method,route,body)=>{const r=request(app.getHttpServer())[method]('/api'+route).set('X-SPM-Request','1').set('Cookie',cookies[who]);return body?r.send(body):r;};
    for(const who of ['campus_pm','campus_frontend_1','campus_backend','campus_qa']){
      assert.equal((await call(who,'get',`/projects/${projectId}`)).status,200);
      assert.equal((await call(who,'get',`/projects/${manifest.projects[3].id}`)).status,404);
    }
    for(const who of ['campus_admin','campus_guest'])assert.equal((await call(who,'get',`/projects/${projectId}`)).status,404);
    assert.equal((await request(app.getHttpServer()).get(`/api/projects/${projectId}`)).status,401);
    assert.equal((await call('campus_pm2','get',`/projects/${manifest.projects[3].id}`)).status,200);
    for(const who of ['campus_frontend_1','campus_qa']){
      assert.equal((await call(who,'post',`/projects/${projectId}/plan-adapter/stages`,{title:'越权写入',start:'2026-10-25',end:'2026-10-26'})).status,403);
      const mine=await call(who,'get',`/projects/${projectId}/tasks/mine`);assert.equal(mine.status,200);const user=await db.user.findUniqueOrThrow({where:{username:who}});assert(mine.body.length&&mine.body.every(t=>t.assigneeUserId===user.id));
    }
    const empty=manifest.projects[2].id;assert.equal(await db.task.count({where:{projectId:empty}}),0);assert.equal(await db.requirement.count({where:{projectId:empty}}),0);
    const complete=await db.task.findMany({where:{projectId:manifest.projects[1].id}});assert.equal(complete.length,3);assert(complete.every(t=>t.status==='DONE'));
    const download=await call('campus_pm','get',`/projects/${projectId}/documents/${files[0].id}/content?download=1`);assert.equal(download.status,200);
    const {AiContextService}=require('../apps/api/dist/ai/context.service');const {detectRisks}=require('../apps/api/dist/ai/rules');
    const pm=await db.user.findUniqueOrThrow({where:{username:'campus_pm'}}),dev=await db.user.findUniqueOrThrow({where:{username:'campus_backend'}});
    const context=app.get(AiContextService),snapshot=await context.build(pm,projectId,'CROSS_VIEW',{}),findings=detectRisks(snapshot,'CROSS_VIEW').findings;
    assert(findings.length>0);assert(findings.every(f=>f.evidence.length));
    for(const rule of ['LEAF_REQUIREMENT_WITHOUT_STORY','PLAN_OVERDUE','SAME_OWNER_PLAN_OVERLAP','TASK_PRIORITY_CONCENTRATION','TASK_UNASSIGNED','TASK_WITHOUT_PLAN'])assert(findings.some(f=>f.ruleId===rule),rule);
    const own=await context.build(dev,projectId,'HEALTH',{});assert(own.tasks.every(t=>t.assigneeUserId===dev.id));
    console.log('PASS backend API: manager/member access, anonymous 401, outsider/admin isolation, write denial, own tasks, document download and completed/empty projects');
    console.log('PASS deterministic AI rules (external model disabled): '+[...new Set(findings.map(f=>f.ruleId))].join(', '));
    await db.project.update({where:{id:projectId},data:{description:'Unrelated same-name project'}});
    await assert.rejects(seed(db),/collision/);assert.equal(await count('task'),34);
    console.log('PASS same-name collision: import refused without overwriting');
  }finally{if(app)await app.close();await db.$disconnect();assert(/^campus_seed_test_\d+$/.test(schema));await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
