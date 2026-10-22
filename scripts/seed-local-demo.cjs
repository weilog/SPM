// Explicit local-only, additive acceptance data. Never resets existing users/projects.
const fs = require('node:fs');
require('../apps/api/node_modules/reflect-metadata');
require('../apps/api/node_modules/dotenv').config({ quiet: true });
const { DbService } = require('../apps/api/dist/db/db.module');
const { hashPassword } = require('../apps/api/dist/auth/password');
const NAME = '爱管理 · AB统一验收项目';
const PASSWORD = 'SpmDemo!2026';
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function main() {
  if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname))
    throw new Error('Only a local PostgreSQL database is allowed');
  const db = new DbService();
  try {
    const manager = await db.user.findUniqueOrThrow({ where: { username: 'manager' } });
    const existing = await db.project.findFirst({ where: { name: NAME, managerId: manager.id } });
    if (existing) { console.log(JSON.stringify({ alreadyExists: true, projectId: existing.id, name: NAME })); return; }
    const names = ['demo_dev', 'demo_dev2', 'demo_tester', 'demo_pm', 'demo_outsider'];
    if (await db.user.count({ where: { username: { in: names } } }))
      throw new Error('Demo username exists; no existing password will be overwritten');
    const passwordHash = await hashPassword(PASSWORD);
    const result = await db.$transaction(async tx => {
      const people = [];
      for (const username of names) people.push(await tx.user.create({ data: { username, passwordHash, role: username === 'demo_pm' ? 'MANAGER' : 'MEMBER' } }));
      const [dev, dev2, tester, pm, outsider] = people;
      const project = await tx.project.create({ data: { name: NAME, description: '覆盖A/B全部页面的本地验收数据：需求树→故事→任务→项目计划→文档及UML。可自由编辑、拖拽、归档与恢复。', managerId: manager.id } });
      const projectId = project.id;
      for (const [u, role] of [[manager,'MANAGER'],[dev,'DEVELOPER'],[dev2,'DEVELOPER'],[tester,'TESTER']])
        await tx.projectMember.create({ data: { projectId, userId: u.id, role } });
      const reqs = [];
      const req = async (title, parentId, description) => {
        const r = await tx.requirement.create({ data: { projectId, title, parentId, description: description || `验收要求：${title}。验证项目隔离、角色权限和刷新后持久化。` } }); reqs.push(r); return r;
      };
      const root = await req('项目协同与权限管理');
      const account = await req('账户与成员管理', root.id);
      await req('登录状态与成员角色校验', account.id);
      const planReq = await req('项目计划与交付管理');
      const gantt = await req('阶段甘特图与任务联动', planReq.id);
      await req('日期拖拽及双向定位持久化', gantt.id);
      const docReq = await req('项目文档与知识沉淀');
      await req('文件夹管理与真实文件预览', docReq.id);
      const storyReq = await req('需求追踪与用户故事');
      await req('故事地图跨Epic排序与状态看板', storyReq.id);
      const goals = [], epics = [], stories = [];
      for (const [gi, title] of ['提升团队协作效率','保障迭代可视化交付','沉淀项目知识与质量'].entries()) {
        const goal = await tx.productGoal.create({ data: { projectId, title, sortOrder: gi } }); goals.push(goal);
        for (let ei=0; ei<2; ei++) {
          const titles = [['身份与项目空间','成员授权与协同'],['需求与故事管理','计划与任务交付'],['文档与知识库','质量验证与用例建模']];
          const epic = await tx.epic.create({ data: { projectId, goalId: goal.id, title: titles[gi][ei], sortOrder: ei } }); epics.push(epic);
          const labels = ['登录并进入授权项目','按项目角色过滤项目','邀请成员并调整角色','按成员查看任务负载','维护三级需求树','拖拽故事并同步看板','调整甘特日期并关联任务','报告进度并查看操作记录','管理文件夹与上传文档','在线预览并下载原文件','编辑用例图并关联故事','验证只读与跨项目隔离'];
          for (let j=0; j<2; j++) {
            const n=gi*4+ei*2+j;
            const story = await tx.userStory.create({ data: { projectId, epicId: epic.id, title: labels[n], description: `作为项目团队成员，我希望${labels[n]}，以便完成统一的项目协作流程。`, acceptanceCriteria: '1. 操作后显示正确结果\n2. 刷新后数据保留\n3. 未授权用户无法修改\n4. 相关视图保持同步', status: ['DONE','IN_PROGRESS','TODO'][n%3], sortOrder: j } }); stories.push(story);
            await tx.storyRequirement.create({ data: { projectId, storyId: story.id, requirementId: reqs[n%reqs.length].id } });
          }
        }
      }
      const tasks = [];
      const taskNames = ['登录会话回归验证','项目筛选与统计卡联调','成员角色调整接口联调','成员任务图节点交互','需求树三级展开与编辑','故事地图跨Epic拖拽','故事看板状态同步','甘特任务条拖动与缩放','计划与任务关联验证','任务实际进度上报','文件上传下载与预览','文件夹移动与重命名','UML包含与扩展关系','多视图双向定位回归','归档与恢复验收','等待分配的上线检查'];
      for (const [n,title] of taskNames.entries()) {
        const status = ['DONE','IN_PROGRESS','TODO'][n%3], progress = status === 'DONE' ? 100 : status === 'IN_PROGRESS' ? [25,50,75][n%3] : 0;
        const owner = [dev,dev2,tester,manager][n%4];
        const t = await tx.task.create({ data: { projectId, title, description: `验收步骤：进入对应页面执行“${title}”；检查真实API结果、刷新持久化和权限。\n预期结果：无错误，相关联视图同步更新。`, status, progress, priority: ['URGENT','HIGH','MEDIUM','LOW'][n%4], assigneeUserId: n===15 ? null : owner.id, archivedAt: n===14 ? new Date() : null } }); tasks.push(t);
        await tx.storyTask.create({ data: { projectId, storyId: stories[n%stories.length].id, taskId: t.id } });
        await tx.taskHistory.create({ data: { taskId: t.id, actorUserId: manager.id, actorName: manager.username, action: '创建任务', before: {}, after: { title, status: 'TODO', progress: 0, priority: t.priority, assigneeUserId: t.assigneeUserId } } });
        if (status !== 'TODO') await tx.taskHistory.create({ data: { taskId: t.id, actorUserId: owner.id, actorName: owner.username, action: '更新状态与进度', before: { status: 'TODO', progress: 0 }, after: { status, progress } } });
        if (t.archivedAt) await tx.taskHistory.create({ data: { taskId: t.id, actorUserId: manager.id, actorName: manager.username, action: '归档任务', before: { archivedAt: null }, after: { archivedAt: t.archivedAt.toISOString() } } });
      }
      const stages = [], items = [];
      for (const [n,title] of ['项目启动与范围确认','需求分析与原型确认','功能开发与集成','测试验收与交付'].entries()) {
        const stage = await tx.planStage.create({ data: { projectId, title, description: `第${n+1}阶段：统一需求、故事、任务与交付结果，负责人按真实项目成员分配。`, start: day(-21+n*14), end: day(-8+n*14), ownerUserId: manager.id, sortOrder: n } }); stages.push(stage);
        for(let g=0;g<3;g++) await tx.planGoal.create({ data: { projectId, stageId: stage.id, title: ['明确本阶段交付范围','完成关联任务及文档','阶段评审与质量检查'][g], done: n===0 || (n===1&&g===0), sortOrder:g } });
        for(let j=0;j<4;j++) {
          const index=n*4+j;
          const item=await tx.planItem.create({ data: { projectId, stageId:stage.id, title:taskNames[index], description:'该计划项关联真实Task；可以从甘特图与工作台定位同一条记录。', start:day(-21+n*14+j*2), end:day(-18+n*14+j*2), ownerUserId:[manager,dev,dev2,tester][j].id, status:n===0?'DONE':n===1?['DONE','IN_PROGRESS','PAUSED','TODO'][j]:'TODO', priority:['HIGH','MEDIUM','NORMAL','LOW'][j] } }); items.push(item);
          await tx.taskPlanReference.create({ data: { projectId, taskId:tasks[index].id, planId:item.id } });
        }
        await tx.planItem.create({ data: { projectId, stageId: stage.id, title:`${title}评审通过`, kind:'milestone', start:stage.end, end:stage.end, ownerUserId:manager.id, status:n===0?'DONE':'TODO', priority:'HIGH' } });
      }
      const folders=[];
      const docBase={projectId,ownerUserId:manager.id,ownerName:manager.username};
      for(const name of ['01 项目规划','02 需求与设计','03 测试与交付']) folders.push(await tx.projectDocument.create({data:{...docBase,kind:'FOLDER',name}}));
      const nested=await tx.projectDocument.create({data:{...docBase,kind:'FOLDER',name:'迭代验收记录',parentId:folders[2].id}});
      const file=async(name,mime,content,parentId)=>{const bytes=Buffer.isBuffer(content)?content:Buffer.from(content);await tx.projectDocument.create({data:{...docBase,kind:'FILE',name,mime,content:bytes,size:bytes.length,parentId}})};
      await file('验收入口与测试步骤.md','text/plain; charset=utf-8',`# AB统一验收\n\n项目：${NAME}\n\n1. 需求管理：展开三级需求，关联用户故事。\n2. 故事地图/看板：拖拽并刷新核对。\n3. 项目计划：切换五个Tab，拖动甘特条，查看关联任务。\n4. 任务：状态、进度、负责人、操作记录、归档恢复。\n5. 文档：目录、预览、下载、重命名和移动。\n6. UML及工作台：故事关联与双向定位。\n\n开发/测试账号只能修改本人允许的任务字段。`,undefined);
      await file('项目范围说明.md','text/plain; charset=utf-8','# 项目范围\n\nA：账户、我的项目、概览、计划、文档、成员。\nB：需求树、故事地图、看板、任务、成员图、UML及多视图工作台。\n\n不包含Sprint 3 AI功能。',folders[0].id);
      await file('用户故事验收标准.txt','text/plain; charset=utf-8',stories.map(s=>`${s.title}\n${s.acceptanceCriteria}`).join('\n\n'),folders[1].id);
      await file('回归检查清单.csv','text/csv; charset=utf-8','页面,检查内容,预期结果\n需求管理,三级展开收起,正确展示\n任务管理,更多菜单,在当前行弹出\n项目计划,拖动甘特任务条,保存日期\n文档,下载,字节一致\n权限,开发修改优先级,拒绝',nested.id);
      await file('多视图联动示例.png','image/png',fs.readFileSync('docs/evidence/a-integration/after-AB-dual-focus.png'),folders[1].id);
      const diagram=await tx.umlDiagram.create({data:{projectId,name:'爱管理核心协作用例',boundary:{x:250,y:40,width:510,height:430,name:'爱管理统一项目空间'}}});
      const nodes=[];
      for(const [kind,name,x,y] of [['ACTOR','项目经理',90,130],['ACTOR','项目成员',90,330],['USE_CASE','管理需求与故事',410,110],['USE_CASE','制定计划与分配任务',540,215],['USE_CASE','报告任务进度',410,330],['USE_CASE','检查项目权限',620,370]]) nodes.push(await tx.umlNode.create({data:{projectId,diagramId:diagram.id,kind,name,x,y}}));
      for(const [from,to,kind] of [[0,2,'association'],[0,3,'association'],[1,4,'association'],[2,5,'include'],[3,5,'include'],[4,3,'extend']]) await tx.umlEdge.create({data:{projectId,diagramId:diagram.id,fromId:nodes[from].id,toId:nodes[to].id,kind}});
      for(const [node,story] of [[2,4],[3,6],[4,7]]) await tx.umlStory.create({data:{projectId,nodeId:nodes[node].id,storyId:stories[story].id}});
      await tx.umlDiagram.create({data:{projectId,name:'文档与质量扩展用例'}});
      for(const [name,owner,role] of [['校园活动协作平台',manager,'MANAGER'],['课程资料管理系统',pm,'DEVELOPER']]) {
        const p=await tx.project.create({data:{name,managerId:owner.id,description:'用于项目卡片、角色筛选和切换验收'}});
        await tx.projectMember.create({data:{projectId:p.id,userId:owner.id,role:'MANAGER'}});
        if(owner.id!==manager.id) await tx.projectMember.create({data:{projectId:p.id,userId:manager.id,role}});
      }
      const privateProject=await tx.project.create({data:{name:'未授权访问检查项目',managerId:pm.id,description:'manager及开发测试账号均未加入，用于验证项目隔离'}});
      await tx.projectMember.create({data:{projectId:privateProject.id,userId:pm.id,role:'MANAGER'}});
      return {projectId,name:NAME,accounts:people.map(u=>({username:u.username,role:u.username==='demo_outsider'?'未加入任何项目':u.username==='demo_pm'?'其他项目经理':u.username==='demo_tester'?'测试':'开发'})),counts:{requirements:reqs.length,goals:goals.length,epics:epics.length,stories:stories.length,tasks:tasks.length,stages:stages.length,planItems:20,documents:9,diagrams:2}};
    },{timeout:30000});
    fs.mkdirSync('.runtime',{recursive:true});
    fs.writeFileSync('.runtime/local-demo-data.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } finally {await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
