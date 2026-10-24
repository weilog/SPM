// Optional additive scenarios for the explicitly labelled lifecycle demo only.
const assert = require('node:assert/strict');
require('../apps/api/node_modules/reflect-metadata');
require('../apps/api/node_modules/dotenv').config({quiet:true});
const {DbService} = require('../apps/api/dist/db/db.module');
const template = require('./fixtures/project-lifecycle-template.json');
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert(['localhost','127.0.0.1'].includes(url.hostname), 'Local demo database required');
  const db = new DbService();
  try {
    const project = await db.project.findFirst({where:{name:template.name}});
    assert(project?.description.includes(`[demo-template:${template.id}]`), 'Seed the lifecycle demo first; refusing to modify other projects');
    const definitions = [
      ['范围评审与确认', 'scope', '规划与确认项目范围', ['项目经理','需求视图','项目服务','数据库'], ['提交范围评审','校验项目权限','读取关联需求与故事','返回评审上下文','确认范围结论']],
      ['活动分解与任务分配', 'schedule', '分解活动并分配任务', ['项目经理','任务详情','任务服务','数据库'], ['选择任务与负责人','提交修订号和负责人','校验权限及版本','保存任务负责人','刷新成员图和任务详情']],
      ['交付验收结果反馈', 'acceptance', '报告进度与验收结果', ['项目成员','任务详情','任务服务','数据库'], ['打开本人任务','提交验收进度','校验授权与修订号','保存任务实际进度','返回最新任务记录']],
    ];
    let created = 0;
    for (const [name, storyKey, useCase, names, labels] of definitions) {
      const title = template.stories.find(s=>s.key===storyKey)?.title;
      const story = await db.userStory.findFirst({where:{projectId:project.id,title}});
      const node = await db.umlNode.findFirst({where:{projectId:project.id,name:useCase,kind:'USE_CASE'}});
      assert(story && node, 'Missing actual story/use-case relation');
      if (await db.umlSequence.findFirst({where:{projectId:project.id,name}})) continue;
      const participants = names.map((name,i)=>({id:`p${i}`,name}));
      const pairs = [[0,1],[1,2],[2,3],[3,2],[2,1]];
      await db.$transaction(async (tx) => {
      const scene = await tx.umlSequence.create({data:{
        projectId:project.id,name,description:'五阶段示例项目的交互设计场景；不代表实时运行轨迹，不自动修改任务、计划或故事。',
        participants,messages:labels.map((label,i)=>({fromId:`p${pairs[i][0]}`,toId:`p${pairs[i][1]}`,label,kind:i>=3?'return':'call'})),
      }});
      await tx.umlSequenceStory.create({data:{projectId:project.id,sequenceId:scene.id,storyId:story.id}});
      await tx.umlSequenceUseCase.create({data:{projectId:project.id,sequenceId:scene.id,nodeId:node.id}});
      });
      created++;
    }
    console.log(JSON.stringify({projectId:project.id,created,total:await db.umlSequence.count({where:{projectId:project.id}})}));
  } finally { await db.$disconnect(); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
