const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {makeFixture}=require('./fixtures/campus-demo.cjs');
require('../apps/api/node_modules/reflect-metadata');
require('../apps/api/node_modules/dotenv').config({quiet:true});
const {hashPassword}=require('../apps/api/dist/auth/password');
const {DbService}=require('../apps/api/dist/db/db.module');
async function seed(db,baseDate=process.env.DEMO_BASE_DATE) {
  const f=makeFixture(baseDate),marker='校园秋季示例数据 V1';
  const password=process.env.DEMO_SEED_PASSWORD||'SpmDemo!2026';
  assert(password.length>=12,'Demo password needs at least 12 characters');
  const passwordHash=await hashPassword(password);
  return db.$transaction(async tx=>{
    const existing=await tx.project.findMany({where:{name:{in:f.names}}});
    if(existing.length){
      assert(existing.length===4&&existing.every(p=>p.description.includes(marker)),'Project name collision; no changes made');
      return {alreadyExists:true,projects:existing.map(p=>({id:p.id,name:p.name})),message:'Existing data and original dates preserved'};
    }
    assert.equal(await tx.user.count({where:{OR:[{username:{in:f.accounts.map(a=>a[1])}},{email:{in:f.accounts.map(a=>`${a[1]}@example.test`)}}]}}),0,'Campus accounts already exist; refusing to change credentials');
    const users={};
    for(const [key,username,displayName,role] of f.accounts)users[key]=await tx.user.create({data:{username,displayName,email:`${username}@example.test`,passwordHash,role:key==='admin'?'ADMIN':role==='MANAGER'?'MANAGER':'MEMBER'}});
    const projects=[];
    for(const [i,name] of f.names.entries())projects.push(await tx.project.create({data:{name,managerId:users[i===0?'pm':'pm2'].id,description:`${marker}\n模拟数据，首次导入基准日：${f.baseDate}。${['活动发布、报名、签到与统计的秋季上线项目。','已完成的小规模交付，供项目切换与完成状态验证。','仅建立项目与成员，业务记录为空。','仅授权项目经理访问，供跨项目隔离验证。'][i]}`}}));
    const projectId=projects[0].id;
    for(const [key,,,role] of f.accounts.filter(a=>a[3]))await tx.projectMember.create({data:{projectId,userId:users[key].id,role}});
    for(const [index,key,role] of [[1,'pm2','MANAGER'],[1,'pm','DEVELOPER'],[1,'qa','TESTER'],[2,'pm2','MANAGER'],[2,'pm','MANAGER'],[3,'pm2','MANAGER']])await tx.projectMember.create({data:{projectId:projects[index].id,userId:users[key].id,role}});
    const reqs={},stories=[],stages=[],plans=[],tasks=[];
    for(const [key,parent,title,criteria] of f.requirements)reqs[key]=await tx.requirement.create({data:{projectId,parentId:parent?reqs[parent].id:null,title,description:key==='export'?'评审尚未确定字段、文件格式和权限范围；等待业务负责人确认。':`业务目标：${criteria}`,acceptanceCriteria:key==='export'?'':criteria}});
    const goals=[];for(const [sortOrder,title] of f.goals.entries())goals.push(await tx.productGoal.create({data:{projectId,title,sortOrder}}));
    const epics=[];for(const [sortOrder,[title,goal]] of f.epics.entries())epics.push(await tx.epic.create({data:{projectId,goalId:goals[goal].id,title,sortOrder}}));
    for(const [sortOrder,[key,epic,title,actor,want,status,requirements]] of f.stories.entries()){
      const story=await tx.userStory.create({data:{projectId,epicId:epics[epic].id,title,description:`作为${actor}，我希望${want}。`,status,sortOrder,acceptanceCriteria:key==='export'?'':requirements.map(k=>f.requirements.find(r=>r[0]===k)[3]).join('\n')||'操作结果可复核；异常时显示原因；不能访问其他人的业务记录。'}});
      stories.push({...story,key});
      for(const r of requirements)await tx.storyRequirement.create({data:{projectId,storyId:story.id,requirementId:reqs[r].id}});
    }
    for(const [sortOrder,[title,start,end,milestone]] of f.stages.entries()){
      const s=await tx.planStage.create({data:{projectId,title,start:f.day(start),end:f.day(end),ownerUserId:users.pm.id,sortOrder,description:`交付检查点：${milestone}`}});stages.push(s);
      await tx.planGoal.create({data:{projectId,stageId:s.id,title:milestone,done:sortOrder===0,sortOrder:0}});
      await tx.planItem.create({data:{projectId,stageId:s.id,kind:'milestone',title:milestone,start:s.end,end:s.end,status:sortOrder===0?'DONE':'TODO',priority:'HIGH',ownerUserId:users.pm.id}});
    }
    for(const [index,[title,owner,start,end,status]] of f.plans.entries())plans.push(await tx.planItem.create({data:{projectId,stageId:stages[Math.floor(index/4)].id,title,ownerUserId:users[owner].id,start:f.day(start),end:f.day(end),status,priority:index===8?'URGENT':index<12?'HIGH':'MEDIUM',description:index===7?'暂缓原因：导出字段与权限口径未完成评审，会议记录见文档。':index===10?'计划曾标为完成，但关联任务尚未全部完成；需要项目经理核对验收结论。':'交付物由负责人提交，按关联任务和阶段检查点复核。'}}));
    const createdAt=new Date(`${f.day(-36)}T09:00:00+08:00`);
    for(const [index,[title,owner,storyKey,plan]] of f.tasks.entries()){
      const archived=index>=32,status=index<10||archived?'DONE':index<22?'IN_PROGRESS':'TODO',progress=status==='DONE'?100:status==='IN_PROGRESS'?20+(index%5)*15:0;
      const t=await tx.task.create({data:{projectId,title,description:index===24?'待规划：取消截止时间、已签到限制和名额释放需先评审；当前尚未关联故事与计划。':index===25?'待规划：明确导出字段、格式及个人信息访问范围后再拆分实现。':`交付目标：${title}。保存实现或验证记录，异常须记录原因；由项目负责人复核。`,assigneeUserId:owner?users[owner].id:null,status,progress,priority:index===11?'URGENT':index<22?'HIGH':index===30?'LOW':'MEDIUM',createdAt,archivedAt:archived?new Date(`${f.day(-3)}T18:00:00+08:00`):null}});tasks.push(t);
      if(storyKey)await tx.storyTask.create({data:{projectId,storyId:stories.find(s=>s.key===storyKey).id,taskId:t.id}});
      if(plan!==null)await tx.taskPlanReference.create({data:{projectId,taskId:t.id,planId:plans[plan].id}});
      await tx.taskHistory.create({data:{taskId:t.id,actorUserId:users.pm.id,actorName:users.pm.username,action:'创建任务',before:{},after:{title,status:'TODO',progress:0,assigneeUserId:t.assigneeUserId},createdAt}});
      if(progress)await tx.taskHistory.create({data:{taskId:t.id,actorUserId:owner?users[owner].id:users.pm.id,actorName:owner?users[owner].username:users.pm.username,action:'设置任务状态与进度',before:{status:'TODO',progress:0},after:{status,progress},createdAt:new Date(`${f.day(status==='DONE'?-5:-1)}T17:00:00+08:00`)}});
      if(archived)await tx.taskHistory.create({data:{taskId:t.id,actorUserId:users.pm.id,actorName:users.pm.username,action:'归档任务',before:{archivedAt:null},after:{archivedAt:t.archivedAt.toISOString()},createdAt:t.archivedAt}});
    }
    const docBase={projectId,ownerUserId:users.pm.id,ownerName:users.pm.username};
    const folders=[];for(const name of ['01 需求与范围','02 交互原型','03 接口契约','04 测试验收','05 发布运维','06 会议记录'])folders.push(await tx.projectDocument.create({data:{...docBase,kind:'FOLDER',name}}));
    const documents=[
      ['项目章程.md',0,`# 校园活动协作平台\n目标：发布活动、接受报名、现场签到和复盘统计。\n首批上线不包含支付、校外人员报名。\n基准日：${f.baseDate}。`],
      ['报名规则与待确认事项.md',0,'# 报名规则\n同一学生不得重复占用名额；不符合院系限制时显示原因。\n待评审：取消报名后的名额释放时点、已签到限制。取消规则尚未进入故事。'],
      ['发布页面评审.md',1,'# 发布页面评审\n必填字段、时间边界、审核拒绝原因已检查，相关任务已完成。'],
      ['报名结果交互说明.md',1,'# 报名结果\n分别显示待审核、已通过、未通过。未通过显示原因。窄屏提示仍在补充。'],
      ['报名接口契约.md',2,'# 报名接口\n输入：活动与学生身份。输出：报名结果与资格校验原因。重复请求返回已有结果。名额校验与持久化保持一致。'],
      ['权限边界.md',2,'# 权限\n组织者只管理获授权活动，学生仅访问本人报名。系统管理员身份不自动获得项目访问权限。'],
      ['报名回归用例.csv',3,'场景,预期结果,执行状态\n重复报名,返回已有报名,执行中\n院系不符,拒绝并说明原因,执行中\n报名取消,待业务评审,未执行'],
      ['签到验收清单.md',3,'# 签到验收\n有效报名且处于签到时段方可签到；错误码、过期码和重复签到需验证。当前关联任务未全部完成，不能认定通过验收。'],
      ['发布与回退清单.md',4,'# 发布与回退\n核对配置、备份位置和版本。\n记录发布人、验证人、回退步骤及回退后的报名数据校验。待演练，不代表发布已经完成。'],
      ['上线巡检表.csv',4,'检查项,检查结果,责任人\n报名接口健康,待执行,吴承安\n签到接口健康,待执行,吴承安\n异常日志检查,待执行,吴承安'],
      ['统计导出评审纪要.md',5,`# 统计导出评审\n日期：${f.day(-2)}\n争议：按报名还是按签到生成明细；是否包含学生联系方式。\n结论：尚未达成一致，暂停实现，许安宁整理样例后再次评审。`],
      ['风险与问题登记.md',5,`# 当前可复核问题\n基准日：${f.baseDate}\n报名联调计划结束日已过但未完成。\n签到计划显示完成，关联执行任务仍在进行。\n后端多项进行中任务的计划日期重叠；无工时容量数据，不能断言资源利用率或延期概率。`],
    ];
    for(const [name,folder,body] of documents){const content=Buffer.from(body);await tx.projectDocument.create({data:{...docBase,parentId:folders[folder].id,kind:'FILE',name,content,size:content.length,mime:name.endsWith('.csv')?'text/csv; charset=utf-8':'text/plain; charset=utf-8'}});}
    for(const [name,actor,keys] of [['学生报名与签到','学生',['eligible','result','checkin']],['活动发布与运营','活动组织者',['publish','review','counts']]]){
      const diagram=await tx.umlDiagram.create({data:{projectId,name,boundary:{x:230,y:35,width:600,height:440,name:'校园活动协作平台'}}});
      const a=await tx.umlNode.create({data:{projectId,diagramId:diagram.id,kind:'ACTOR',name:actor,x:90,y:210}});
      for(const [index,key] of keys.entries()){
        const story=stories.find(s=>s.key===key),node=await tx.umlNode.create({data:{projectId,diagramId:diagram.id,kind:'USE_CASE',name:story.title,x:490,y:110+index*130}});
        await tx.umlEdge.create({data:{projectId,diagramId:diagram.id,fromId:a.id,toId:node.id,kind:'association'}});
        await tx.umlStory.create({data:{projectId,nodeId:node.id,storyId:story.id}});
      }
    }
    // Small completed project, independent from the main project's requirements and tasks.
    const completedId=projects[1].id;
    const completedStage=await tx.planStage.create({data:{projectId:completedId,title:'交付验收',start:f.day(-20),end:f.day(-8),ownerUserId:users.pm2.id}});
    const goal=await tx.productGoal.create({data:{projectId:completedId,title:'完成座位预约试点'}});
    const epic=await tx.epic.create({data:{projectId:completedId,goalId:goal.id,title:'预约与取消'}});
    for(const title of ['预约空闲座位','取消本人预约','查看预约结果']){
      const requirement=await tx.requirement.create({data:{projectId:completedId,title,acceptanceCriteria:'本人预约结果正确保存，其他学生无法修改。'}});
      const story=await tx.userStory.create({data:{projectId:completedId,epicId:epic.id,title,status:'DONE',description:`作为学生，我希望${title}，以便安排自习时间。`,acceptanceCriteria:'预约结果正确保存，重复操作不产生重复记录；其他学生无法修改本人预约。'}});
      const task=await tx.task.create({data:{projectId:completedId,title:`完成${title}验收`,description:'预约试点验收记录齐全，已由负责人确认交付。',status:'DONE',progress:100,assigneeUserId:users.qa.id,createdAt:new Date(`${f.day(-22)}T09:00:00+08:00`)}});
      await tx.taskHistory.create({data:{taskId:task.id,actorUserId:users.pm2.id,actorName:users.pm2.username,action:'创建任务',before:{},after:{status:'TODO',progress:0},createdAt:task.createdAt}});
      await tx.taskHistory.create({data:{taskId:task.id,actorUserId:users.qa.id,actorName:users.qa.username,action:'设置任务状态与进度',before:{status:'TODO',progress:0},after:{status:'DONE',progress:100},createdAt:new Date(`${f.day(-8)}T17:00:00+08:00`)}});
      const plan=await tx.planItem.create({data:{projectId:completedId,stageId:completedStage.id,title:`${title}交付`,start:f.day(-20),end:f.day(-8),status:'DONE',ownerUserId:users.pm2.id}});
      await tx.storyRequirement.create({data:{projectId:completedId,storyId:story.id,requirementId:requirement.id}});
      await tx.storyTask.create({data:{projectId:completedId,storyId:story.id,taskId:task.id}});
      await tx.taskPlanReference.create({data:{projectId:completedId,taskId:task.id,planId:plan.id}});
    }
    await tx.requirement.create({data:{projectId:projects[3].id,title:'内部审批资料仅授权人员可见',acceptanceCriteria:'未授权用户请求项目详情时无法取得内容。'}});
    return {templateId:f.id,baseDate:f.baseDate,projects:projects.map(p=>({id:p.id,name:p.name})),accounts:f.accounts.map(([key,username,displayName,role])=>({username,displayName,role:key==='admin'?'SYSTEM_ADMIN_NO_MEMBERSHIP':role||'NO_MEMBERSHIP'})),main:{stages:stages.map(s=>({id:s.id,title:s.title})),counts:{requirements:24,goals:3,epics:6,stories:14,activeTasks:32,archivedTasks:2,workItems:20,milestones:5,folders:6,files:12,diagrams:2,members:7}}};
  },{timeout:60000,isolationLevel:'Serializable'});
}
async function main(){
  assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname),'Local database only');
  const db=new DbService();
  try{const result=await seed(db);const target=process.env.CAMPUS_MANIFEST_PATH||'.runtime/campus-demo.json';fs.mkdirSync(path.dirname(path.resolve(target)),{recursive:true});fs.writeFileSync(target,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}finally{await db.$disconnect();}
}
module.exports={seed};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
