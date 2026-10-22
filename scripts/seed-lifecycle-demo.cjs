// Additive local seed derived from the user's lifecycle screenshots. No UI/schema changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const template = require('./fixtures/project-lifecycle-template.json');
const roles = { pm:'MANAGER', frontend:'DEVELOPER', backend:'DEVELOPER', qa:'TESTER', ops:'DEVELOPER' };
const accountNames = {pm:'tpl_pm',frontend:'tpl_frontend',backend:'tpl_backend',qa:'tpl_qa',ops:'tpl_ops'};
const displayNames = {pm:'林知远',frontend:'陈思雨',backend:'周启明',qa:'赵可欣',ops:'吴承安'};
const password = 'SpmDemo!2026';
const manifestPath = '.runtime/lifecycle-demo.json';
function validate() {
  const byKey = new Map(template.nodes.map(n=>[n.key,n]));
  assert.equal(byKey.size,35); assert.equal(template.stages.length,5);
  const depths = n => n.parent ? 1+depths(byKey.get(n.parent)) : 1;
  for(const n of template.nodes) {
    const stage = template.stages.find(s=>s.key===n.stage);
    assert(stage && roles[n.owner] && n.deliverable && template.stories.some(s=>s.key===n.story));
    assert(n.start>=stage.start && n.end<=stage.end && n.start<=n.end,`Invalid dates: ${n.key}`);
    for(const d of [n.start,n.end]) assert.equal(new Date(d).toISOString().slice(0,10),d);
    assert(n.progress>=0&&n.progress<=100);
    if(n.parent) assert(byKey.get(n.parent)?.stage===n.stage);
    let p=n;const seen=new Set();while(p){assert(!seen.has(p.key),'Cycle');seen.add(p.key);p=byKey.get(p.parent);}
    assert(depths(n)<=3);
  }
  assert.deepEqual(template.stages.map(s=>template.nodes.filter(n=>n.stage===s.key).length),[2,15,13,3,2]);
  assert(template.nodes.find(n=>n.key==='early').end < template.nodes.find(n=>n.key==='middle').start);
  assert(template.nodes.find(n=>n.key==='middle').end < template.nodes.find(n=>n.key==='late').start);
  return byKey;
}
const byKey=validate();
if(process.argv.includes('--check')) {console.log('PASS: 35 WBS records, five stage counts, acyclic max-three-level tree, owners, deliverables, inclusive date boundaries and chronological development sequence');process.exit(0);}
require('../apps/api/node_modules/reflect-metadata');
require('../apps/api/node_modules/dotenv').config({quiet:true});
const {DbService}=require('../apps/api/dist/db/db.module');
const {hashPassword}=require('../apps/api/dist/auth/password');
const {Pool}=require('../apps/api/node_modules/pg');
async function businessSnapshot(pool) {
  const result={};
  for(const {tablename} of (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('Session','_prisma_migrations')")).rows) {
    const rows=(await pool.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t`)).rows;
    result[tablename]=rows.map(r=>createHash('sha256').update(JSON.stringify(r.row)).digest('hex')).sort();
  }
  return result;
}
async function main(){
 const url=new URL(process.env.DATABASE_URL);
 assert(['localhost','127.0.0.1'].includes(url.hostname),'Local PostgreSQL only');
 assert(!url.searchParams.get('schema')||url.searchParams.get('schema')==='public','This seed targets the local application public schema');
 const db=new DbService(),pool=new Pool({connectionString:process.env.DATABASE_URL});
 try{
  const manager=await db.user.findUniqueOrThrow({where:{username:'manager'}});
  const existing=await db.project.findFirst({where:{name:template.name,managerId:manager.id}});
  if(existing){
    const saved=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)):null;
    assert(saved?.projectId===existing.id && saved?.templateId===template.id,'Project name already exists; refusing to overwrite data');
    console.log(JSON.stringify({alreadyExists:true,projectId:existing.id,name:template.name},null,2));return;
  }
  const usernames=[...Object.values(accountNames),'tpl_observer'];
  assert.equal(await db.user.count({where:{username:{in:usernames}}}),0,'Reserved template accounts exist; refusing to change their passwords or privileges');
  const before=await businessSnapshot(pool),passwordHash=await hashPassword(password);
  const result=await db.$transaction(async tx=>{
    const users={};
    for(const [key,username] of Object.entries(accountNames))users[key]=await tx.user.create({data:{username,displayName:displayNames[key],email:`${username}@example.test`,role:key==='pm'?'MANAGER':'MEMBER',passwordHash}});
    const observer=await tx.user.create({data:{username:'tpl_observer',displayName:'未授权访客',email:'tpl_observer@example.test',passwordHash}});
    const project=await tx.project.create({data:{name:template.name,description:template.description,managerId:manager.id}}),projectId=project.id;
    await tx.projectMember.create({data:{projectId,userId:manager.id,role:'MANAGER'}});
    for(const [key,user] of Object.entries(users))await tx.projectMember.create({data:{projectId,userId:user.id,role:roles[key]}});
    const requirements={},stages={},items={},stories={},tasks={},goals={},epics={};
    const pathFor=n=>n.parent?pathFor(byKey.get(n.parent))+' / '+n.title:n.title;
    for(const s of template.stages){
      stages[s.key]=await tx.planStage.create({data:{projectId,title:s.title,description:s.goal,start:s.start,end:s.end,ownerUserId:users.pm.id,sortOrder:template.stages.indexOf(s)}});
      for(const [i,title] of [s.goal,'本阶段交付资料已归档','阶段评审结论已确认'].entries())await tx.planGoal.create({data:{projectId,stageId:stages[s.key].id,title,done:s.key==='init'||(s.key==='planning'&&i!==2),sortOrder:i}});
    }
    for(const s of template.stories){
      if(!goals[s.goal])goals[s.goal]=await tx.productGoal.create({data:{projectId,title:s.goal,sortOrder:Object.keys(goals).length}});
      if(!epics[s.epic])epics[s.epic]=await tx.epic.create({data:{projectId,goalId:goals[s.goal].id,title:s.epic,sortOrder:Object.keys(epics).length}});
      stories[s.key]=await tx.userStory.create({data:{projectId,epicId:epics[s.epic].id,title:s.title,description:`作为项目团队成员，我希望${s.title}，使工作目标、执行过程和交付结果能够被团队共同确认。`,acceptanceCriteria:`1. ${s.title}所需资料与责任人明确。\n2. 关联工作包具有可检查的交付物。\n3. 阶段评审可以通过需求、任务和计划追溯执行结果。`,status:s.status,sortOrder:template.stories.indexOf(s)}});
    }
    const isParent=n=>template.nodes.some(child=>child.parent===n.key);
    for(const n of template.nodes){
      const stage=stages[n.stage],owner=users[n.owner];
      const description=`工作路径：${pathFor(n)}\n目标：${n.deliverable}\n验收方式：由${displayNames[n.owner]}提交对应交付物，项目负责人按阶段清单复核并记录结论。${n.paused?'\n暂缓原因：共享测试资源窗口尚未确认；该资源为可选扩容，不阻断当前设计与开发。':''}`;
      requirements[n.key]=await tx.requirement.create({data:{projectId,parentId:n.parent?requirements[n.parent].id:undefined,title:n.title,description}});
      await tx.storyRequirement.create({data:{projectId,storyId:stories[n.story].id,requirementId:requirements[n.key].id}});
      const status=n.paused?'PAUSED':n.progress===100?'DONE':n.progress>0?'IN_PROGRESS':'TODO';
      items[n.key]=await tx.planItem.create({data:{projectId,stageId:stage.id,title:n.title,description,start:n.start,end:n.end,ownerUserId:owner.id,status,priority:n.priority}});
      if(!isParent(n)){
        const taskStatus=n.progress===100?'DONE':n.progress>0?'IN_PROGRESS':'TODO';
        const t=await tx.task.create({data:{projectId,title:n.title,description,assigneeUserId:owner.id,status:taskStatus,progress:n.progress,priority:n.priority,createdAt:new Date(`${n.start<'2026-10-08'?n.start:'2026-10-08'}T09:00:00+08:00`)}});tasks[n.key]=t;
        await tx.storyTask.create({data:{projectId,storyId:stories[n.story].id,taskId:t.id}});
        await tx.taskPlanReference.create({data:{projectId,taskId:t.id,planId:items[n.key].id}});
        await tx.taskHistory.create({data:{taskId:t.id,actorUserId:manager.id,actorName:manager.username,action:'创建任务',before:{},after:{title:t.title,status:'TODO',progress:0,priority:t.priority,assigneeUserId:owner.id},createdAt:new Date(`${n.start<'2026-10-08'?n.start:'2026-10-08'}T09:00:00+08:00`)}});
        if(n.progress)await tx.taskHistory.create({data:{taskId:t.id,actorUserId:owner.id,actorName:owner.username,action:'设置任务状态与进度',before:{status:'TODO',progress:0},after:{status:t.status,progress:t.progress},createdAt:new Date(`${n.end<'2026-10-22'?n.end:'2026-10-22'}T17:00:00+08:00`)}});
      }
    }
    for(const s of template.stages)await tx.planItem.create({data:{projectId,stageId:stages[s.key].id,title:s.milestone,description:`确认依据：${s.goal}；评审资料在对应阶段文件夹归档。`,kind:'milestone',start:s.end,end:s.end,status:s.key==='init'?'DONE':'TODO',priority:'HIGH',ownerUserId:users.pm.id}});
    for(const extra of [
      {key:'environment',title:'恢复联调环境访问',owner:'ops',progress:50,priority:'URGENT',story:'integration',reason:'10月22日模拟联调环境访问异常：先核对网络入口及服务健康，再验证前后端可用性。完成标准：团队账号可以正常访问联调环境。'},
      {key:'mobile',title:'补充移动端布局验收标准',owner:null,progress:0,priority:'LOW',story:'ui',reason:'待规划工作：补充窄屏操作范围和验收尺寸，由项目经理评审后决定是否纳入本期。'},
      {key:'guide',title:'编写账号与权限操作指南',owner:'qa',progress:0,priority:'MEDIUM',story:'handover',reason:'待规划工作：整理经理、开发、测试的操作边界，并给出可复现的登录与权限验证步骤。'},
      {key:'archive',title:'整理旧版界面评审资料',owner:'frontend',progress:100,priority:'LOW',story:'ui',reason:'已归档历史工作：旧版界面评审资料已整理完毕，当前版本以后续评审记录为准。',archived:true}
    ]){
      const t=await tx.task.create({data:{projectId,title:extra.title,description:extra.reason,assigneeUserId:extra.owner?users[extra.owner].id:null,status:extra.progress===100?'DONE':extra.progress?'IN_PROGRESS':'TODO',progress:extra.progress,priority:extra.priority,createdAt:new Date(`${extra.archived?'2026-10-16':'2026-10-22'}T09:00:00+08:00`),archivedAt:extra.archived?new Date('2026-10-20T17:00:00+08:00'):null}});tasks[extra.key]=t;
      await tx.storyTask.create({data:{projectId,storyId:stories[extra.story].id,taskId:t.id}});
      await tx.taskHistory.create({data:{taskId:t.id,actorUserId:manager.id,actorName:manager.username,action:extra.archived?'归档任务':'创建任务',before:{},after:{title:t.title,status:t.status,progress:t.progress,archivedAt:t.archivedAt?.toISOString()||null},createdAt:new Date(`${extra.archived?'2026-10-20':'2026-10-22'}T17:00:00+08:00`)}});
    }
    const docBase={projectId,ownerUserId:users.pm.id,ownerName:users.pm.username},folders={};
    const folder=async(name,parentId)=>tx.projectDocument.create({data:{...docBase,name,kind:'FOLDER',parentId}});
    const file=async(name,body,parentId)=>{const content=Buffer.from(body);return tx.projectDocument.create({data:{...docBase,name,kind:'FILE',parentId,content,size:content.length,mime:name.endsWith('.csv')?'text/csv; charset=utf-8':'text/plain; charset=utf-8'}})};
    const root=await folder('项目生命周期资料');
    for(const s of template.stages){folders[s.key]=await folder(s.title,root.id);await file(`${s.title}交付清单.md`,`# ${s.title}\n\n阶段目标：${s.goal}\n\n起止日期：${s.start} 至 ${s.end}\n\n| 工作项 | 交付物 | 负责人 |\n|---|---|---|\n`+template.nodes.filter(n=>n.stage===s.key&&!isParent(n)).map(n=>`| ${n.title} | ${n.deliverable} | ${displayNames[n.owner]} |`).join('\n'),folders[s.key].id);}
    await file('项目章程.md',`# 爱管理协同平台建设项目章程\n\n目标：以统一项目空间管理需求、计划、任务、团队和交付资料。\n\n范围：既有Sprint 2 A/B页面与数据协作；不扩展AI、缺陷平台、采购系统或财务系统。\n\n五阶段：${template.stages.map(s=>s.title).join(' → ')}。\n\n验收：业务数据可持久化，角色权限正确，需求/故事/任务/计划能够追溯。`,folders.init.id);
    await file('风险登记册.csv','风险,影响,责任人,状态,应对措施\n共享测试资源窗口未确认,可选资源扩容延迟,吴承安,暂缓,保持现有环境并等待资源确认\n联调环境访问异常,联调准备受阻,吴承安,处理中,核对网络与服务健康\n交互评审意见未闭环,界面确认延迟,陈思雨,处理中,10月24日前完成评审确认',folders.planning.id);
    await file('接口契约与权限边界.md','# 接口与权限约定\n\n所有业务数据按Project隔离。项目经理管理项目内工作；开发与测试只读需求/故事/计划并操作本人授权任务；系统管理员不自动获得项目资格。\n\nPlanItem与Task独立，通过TaskPlanReference关联。计划暂缓不等于Task具有第四种状态。\n\n所有关联必须指向同一项目；保存使用现有修订号与后端校验。',folders.execution.id);
    await file('验收操作指南.md','# 验收操作指南\n\n1. 我的项目：进入本示例项目。\n2. 需求管理：展开范围与设计的三级工作分解，查看对应故事。\n3. 地图/看板：查看三目标、七Epic、十七故事，拖拽后刷新。\n4. 项目计划：切换五阶段及五个Tab，查看里程碑、真实Task、日期条。\n5. 任务：选择本人任务报告实际进度；经理调整优先级与负责人。\n6. 文档：预览并下载交付清单。\n7. UML与工作台：按同一故事、任务与计划双向定位。\n\n数据快照为2026-10-22，所有人名与进度均为初始化示例。',root.id);
    await file('模板提取与优化说明.md','# 模板提取与优化\n\n保留提供截图中的五阶段与35个工作项。\n补齐负责人、日期、交付物；把外观/内部设计改成明确的交互设计/架构接口设计；把泛化生产工作改成开发、联调、回归；修正前中后期日期顺序。\n\n汇总工作包只保留需求与计划记录，叶子工作包生成Task，避免重复统计执行负载。需求保留最多三级；PlanItem当前为平面模型，完整WBS路径记录在描述中，不伪造计划父子能力。\n\n模板之外的3条待规划任务、1条归档任务及故事/UML/文档为适配当前系统补充的数据。',root.id);
    const diagram=await tx.umlDiagram.create({data:{projectId,name:'项目协同核心用例',boundary:{x:250,y:35,width:560,height:465,name:'爱管理协同平台'}}});
    const uml=[];
    for(const [kind,name,x,y] of [['ACTOR','项目经理',90,130],['ACTOR','开发与测试',90,350],['USE_CASE','规划与确认项目范围',430,100],['USE_CASE','分解活动并分配任务',620,205],['USE_CASE','报告进度与验收结果',440,340],['USE_CASE','校验项目成员权限',660,420]])uml.push(await tx.umlNode.create({data:{projectId,diagramId:diagram.id,kind,name,x,y}}));
    for(const [from,to,kind] of [[0,2,'association'],[0,3,'association'],[1,4,'association'],[2,5,'include'],[3,5,'include'],[4,3,'extend']])await tx.umlEdge.create({data:{projectId,diagramId:diagram.id,fromId:uml[from].id,toId:uml[to].id,kind}});
    for(const [index,key] of [[2,'scope'],[3,'schedule'],[4,'acceptance']])await tx.umlStory.create({data:{projectId,nodeId:uml[index].id,storyId:stories[key].id}});
    return {templateId:template.id,projectId,name:project.name,snapshotDate:template.snapshotDate,accounts:Object.entries(users).map(([key,u])=>({username:u.username,name:displayNames[key],role:roles[key]})).concat([{username:observer.username,name:observer.displayName,role:'NO_MEMBERSHIP'}]),stageIds:Object.fromEntries(Object.entries(stages).map(([k,s])=>[k,s.id])),taskIds:Object.fromEntries(Object.entries(tasks).map(([k,t])=>[k,t.id])),counts:{requirements:Object.keys(requirements).length,goals:Object.keys(goals).length,epics:Object.keys(epics).length,stories:Object.keys(stories).length,stages:Object.keys(stages).length,planItems:40,tasks:Object.keys(tasks).length,documents:await tx.projectDocument.count({where:{projectId}}),diagrams:1}};
  },{timeout:45000});
  const after=await businessSnapshot(pool);
  const preserved=Object.fromEntries(Object.entries(before).map(([table,hashes])=>[table,hashes.every(h=>after[table].includes(h))]));
  assert(Object.values(preserved).every(Boolean),'An original business row changed');
  fs.mkdirSync('.runtime',{recursive:true});fs.writeFileSync(manifestPath,JSON.stringify(result,null,2));
  fs.writeFileSync('.runtime/lifecycle-preservation.json',JSON.stringify({result:'PASS',excluded:['Session','_prisma_migrations'],checks:preserved},null,2));
  console.log(JSON.stringify(result,null,2));
 }finally{await db.$disconnect();await pool.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
