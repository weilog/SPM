// Uses a disposable schema in the configured local PostgreSQL database. No model calls.
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
require('../apps/api/node_modules/reflect-metadata');
require('../apps/api/node_modules/dotenv').config({quiet:true});
const {Pool} = require('../apps/api/node_modules/pg');
const root = path.resolve(__dirname,'..');
const schema = `demo_seed_test_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL);
assert(['localhost','127.0.0.1'].includes(url.hostname),'Local database required');
url.searchParams.set('schema',schema);
process.env.DATABASE_URL=url.href;
process.env.DEMO_MANIFEST_PATH=path.join(root,'.runtime',`${schema}.json`);
const {DbService}=require('../apps/api/dist/db/db.module');
const run=(args,cwd=root,expected=0)=>{
  const result=spawnSync(process.execPath,args,{cwd,env:process.env,encoding:'utf8'});
  assert.equal(result.status,expected,result.stderr||result.stdout);
  return result.stdout;
};
(async()=>{
  const pool=new Pool({connectionString:url.href});
  const db=new DbService();
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    run([path.join(root,'apps/api/node_modules/prisma/build/index.js'),'migrate','deploy','--config','prisma.config.ts'],path.join(root,'apps/api'));
    // Existing unrelated records must survive both initial import and subsequent runs.
    const sentinel=await db.user.create({data:{username:'existing_non_demo',passwordHash:'test-sentinel',role:'MEMBER'}});
    const sentinelProject=await db.project.create({data:{name:'Existing project',managerId:sentinel.id}});
    run(['scripts/seed-lifecycle-demo.cjs']);
    const project=await db.project.findFirstOrThrow({where:{name:'爱管理协同平台建设 · 五阶段示例'}});
    const projectId=project.id;
    assert.equal(await db.requirement.count({where:{projectId}}),35);
    assert.equal(await db.planStage.count({where:{projectId}}),5);
    assert.equal(await db.planItem.count({where:{projectId}}),40);
    assert.equal(await db.task.count({where:{projectId}}),32);
    assert.equal(await db.userStory.count({where:{projectId}}),17);
    assert.equal(await db.productGoal.count({where:{projectId}}),3);
    assert.equal(await db.epic.count({where:{projectId}}),7);
    assert.equal(await db.projectDocument.count({where:{projectId}}),16);
    assert.equal(await db.taskPlanReference.count({where:{projectId}}),28);
    assert.equal(await db.storyRequirement.count({where:{projectId}}),35);
    assert.equal(await db.storyTask.count({where:{projectId}}),32);
    const requirements=await db.requirement.findMany({where:{projectId}});
    const depth=r=>r.parentId?1+depth(requirements.find(p=>p.id===r.parentId)):1;
    assert.equal(Math.max(...requirements.map(depth)),3);
    const tasks=await db.task.findMany({where:{projectId},include:{history:true}});
    assert.equal(tasks.filter(t=>t.archivedAt).length,1);
    for(const t of tasks){
      assert(t.status==='DONE'?t.progress===100:t.status==='TODO'?t.progress===0:t.progress<100);
      assert(t.history.every(h=>h.createdAt>=t.createdAt));
    }
    const docs=await db.projectDocument.findMany({where:{projectId,kind:'FILE'}});
    assert(docs.every(d=>d.content&&d.content.length===d.size));
    const manager=await db.user.findUniqueOrThrow({where:{username:'tpl_pm'}});
    assert.equal(project.managerId,manager.id);
    assert.equal(await db.projectMember.count({where:{projectId}}),5);
    const outsider=await db.user.findUniqueOrThrow({where:{username:'tpl_observer'}});
    assert.equal(await db.projectMember.count({where:{userId:outsider.id}}),0);
    const {verifyPassword}=require('../apps/api/dist/auth/password');
    assert(await verifyPassword(process.env.DEMO_SEED_PASSWORD||'SpmDemo!2026',manager.passwordHash));
    console.log('PASS: real PostgreSQL import, relationships, hierarchy, task history, document bytes and demo accounts');
    // Re-running must preserve edits made after initial import.
    const task=tasks[0];
    await db.task.update({where:{id:task.id},data:{title:'User edit must survive'}});
    const counts=await db.task.count();
    assert(run(['scripts/seed-lifecycle-demo.cjs']).includes('alreadyExists'));
    assert.equal(await db.task.count(),counts);
    assert.equal((await db.task.findUniqueOrThrow({where:{id:task.id}})).title,'User edit must survive');
    assert.deepEqual(await db.user.findUniqueOrThrow({where:{id:sentinel.id}}),sentinel);
    assert.deepEqual(await db.project.findUniqueOrThrow({where:{id:sentinelProject.id}}),sentinelProject);
    console.log('PASS: idempotent import preserves user edits and unrelated existing records');
    // Simulate a project name collision: no rows or account credentials may change.
    await db.project.update({where:{id:projectId},data:{description:'An unrelated project with the same name'}});
    const userBefore=await db.user.findUniqueOrThrow({where:{id:manager.id}});
    run(['scripts/seed-lifecycle-demo.cjs'],root,1);
    assert.deepEqual(await db.user.findUniqueOrThrow({where:{id:manager.id}}),userBefore);
    assert.equal(await db.task.count(),counts);
    console.log('PASS: conflicting project import refuses safely without changing data');
  } finally {
    await db.$disconnect();
    assert(/^demo_seed_test_\d+$/.test(schema));
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
})().catch(e=>{console.error(e.message);process.exitCode=1});
