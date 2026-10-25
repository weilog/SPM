// Human-authored business examples. Offsets are relative to the FIRST import date.
const id='campus-autumn-v1';
const accounts=[
  ['pm','campus_pm','林知远','MANAGER'],['pm2','campus_pm2','许安宁','MANAGER'],
  ['fe1','campus_frontend_1','陈思雨','DEVELOPER'],['fe2','campus_frontend_2','苏以南','DEVELOPER'],
  ['be','campus_backend','周启明','DEVELOPER'],['qa','campus_qa','赵可欣','TESTER'],
  ['ops','campus_ops','吴承安','DEVELOPER'],['admin','campus_admin','系统管理测试员',null],
  ['guest','campus_guest','未授权访客',null],
];
const stages=[
  ['启动与范围确认',-35,-29,'项目章程与范围通过评审'],
  ['需求与交互设计',-28,-15,'交互原型与接口契约确认'],
  ['开发与联调',-14,7,'报名与签到流程联调通过'],
  ['测试与业务验收',8,16,'验收用例通过并签署结论'],
  ['上线与维护',17,24,'上线观察与资料移交完成'],
];
// Four roots, eight second-level requirements, twelve leaves.
const requirements=[
  ['organize',null,'活动组织','活动负责人能够创建、发布和维护活动。'],
  ['publish','organize','活动发布','提交活动信息并经过审核后对学生可见。'],
  ['fields','publish','活动信息必填校验','标题、地点、报名起止时间为空时禁止提交；结束时间不得早于开始时间。'],
  ['review','publish','发布前审核','未审核活动仅组织者可见；审核拒绝必须记录原因。'],
  ['manage','organize','活动维护','组织者能够修改尚未开始的活动并追踪变更。'],
  ['notice','manage','活动变更通知','已报名学生可在活动详情看到时间及地点变更记录。'],
  ['join',null,'学生参与','学生能够查找活动、报名并确认参与结果。'],
  ['enroll','join','活动报名','校验报名资格和剩余名额后保存报名。'],
  ['eligibility','enroll','报名资格校验','非在校学生不能报名；不符合限定院系时显示具体原因。'],
  ['duplicate','enroll','防止重复报名','同一学生对同一活动只能保留一条有效报名；重复提交返回已有结果。'],
  ['result','join','报名结果','报名后明确显示审核状态和后续操作。'],
  ['status','result','查看报名结果','显示待审核、已通过、未通过；未通过时可查看原因。'],
  ['cancel','result','报名取消规则','允许在报名结束前取消；已签到后不能取消；释放名额应与取消操作保持一致。'],
  ['operate',null,'现场与运营','组织者能够签到并核对活动参与情况。'],
  ['checkin','operate','活动签到','仅有效报名者可以在规定时段签到。'],
  ['code','checkin','签到码校验','错误、过期签到码拒绝签到；重复签到不产生重复记录。'],
  ['stats','operate','活动统计','组织者按活动查看报名与到场情况。'],
  ['export','stats','统计结果导出','支持导出统计结果。'],
  ['counts','stats','报名与到场口径','报名数不含已取消记录；到场数只统计有效签到，页面展示统计时间。'],
  ['assure',null,'权限与交付保障','确保数据隔离、上线可回退、交付资料可查。'],
  ['access','assure','角色访问控制','学生只能查看本人报名；组织者只能管理授权活动。'],
  ['scope','access','组织者数据隔离','请求其他组织者活动的管理接口时拒绝访问，不返回其学生信息。'],
  ['delivery','assure','上线与运维交付','具备部署、验证和回退步骤。'],
  ['rollback','delivery','发布失败回退','回退清单包含版本、配置、备份位置及验证人，演练记录可追溯。'],
];
const goals=['高效组织校园活动','让学生顺利参与活动','保障运营与安全交付'];
const epics=[['发布与审核',0],['活动维护',0],['报名与资格',1],['参与结果',1],['现场与统计',2],['安全与交付',2]];
const stories=[
  ['publish',0,'填写并提交活动','活动组织者','提交完整活动信息，让审核人能够确认是否发布','DONE',['organize','publish','fields']],
  ['review',0,'审核活动发布','活动审核员','批准或退回活动，避免未经确认的信息被公开','DONE',['review']],
  ['edit',1,'修改活动并显示变更','活动组织者','维护活动安排，让参与学生看到最新变更','DONE',['manage','notice']],
  ['browse',2,'查看可报名活动','学生','按时间查看可报名活动，选择适合自己的活动','DONE',['join']],
  ['eligible',2,'校验报名资格','学生','在报名时获知资格限制，避免无效提交','IN_PROGRESS',['enroll','eligibility']],
  ['duplicate',2,'防止重复占用名额','学生','重复提交时返回已有报名，避免重复占用名额','IN_PROGRESS',['duplicate']],
  ['result',3,'查看报名处理结果','学生','看到报名结果和原因，确认是否需要重新提交','IN_PROGRESS',['result','status']],
  ['reviewJoin',3,'审核学生报名','活动组织者','审核报名材料，让符合要求的学生参加活动','TODO',[]],
  ['checkin',4,'使用签到码签到','学生','在活动现场完成签到，保留参与记录','IN_PROGRESS',['operate','checkin','code']],
  ['counts',4,'核对报名与到场统计','活动组织者','对照报名和到场数据，发现遗漏记录','TODO',['stats','counts']],
  ['export',4,'导出活动统计','活动组织者','下载统计结果，用于活动复盘','TODO',['export']],
  ['access',5,'限制跨活动管理访问','活动组织者','只访问获授权活动的数据，保护学生信息','IN_PROGRESS',['assure','access','scope']],
  ['release',5,'验证发布与回退步骤','运维人员','演练发布失败后的回退，减少上线影响','TODO',['delivery','rollback']],
  ['monitor',5,'检查上线运行情况','运维人员','按巡检清单观察报名与签到服务，及时报告异常','TODO',[]],
];
// Four work items per stage. Each is a delivery package, not a duplicate Task.
const plans=[
  ['确认项目目标与范围','pm',-35,-32,'DONE'],['确认学生与组织者流程','pm2',-34,-31,'DONE'],['建立协作环境','ops',-33,-30,'DONE'],['评审项目章程','pm',-31,-29,'DONE'],
  ['完成发布页面与评审','fe1',-28,-23,'DONE'],['确认报名接口契约','be',-26,-20,'DONE'],['完成报名结果交互','fe2',-24,-18,'DONE'],['确认统计导出口径','pm2',-20,-15,'PAUSED'],
  ['完成报名资格与名额联调','be',-14,-2,'IN_PROGRESS'],['完成报名结果与取消方案评审','be',-10,3,'IN_PROGRESS'],['完成签到接口与页面联调','be',-8,5,'DONE'],['完成权限隔离与安全校验','be',-7,7,'IN_PROGRESS'],
  ['执行报名场景回归','qa',8,11,'TODO'],['执行签到统计回归','qa',9,13,'TODO'],['完成师生试用反馈','pm2',12,15,'TODO'],['签署验收结论','pm',15,16,'TODO'],
  ['准备正式发布配置','ops',17,18,'TODO'],['演练回退与数据校验','ops',18,20,'TODO'],['上线观察与问题响应','ops',20,23,'TODO'],['移交操作资料','pm2',23,24,'TODO'],
];
// 10 done, 12 in progress, 10 todo, plus 2 archived. First 24 link to plans.
const tasks=[
  ['整理活动参与角色','pm','publish',0],['整理项目范围清单','pm2','publish',0],['绘制组织者发布流程','fe1','publish',1],['配置联调项目与测试账号','ops','access',2],['记录章程评审结论','pm','publish',3],
  ['实现活动信息必填校验','fe1','publish',4],['实现活动审核状态展示','fe2','review',4],['实现活动变更记录','fe1','edit',5],['整理报名接口字段契约','be','eligible',5],['完成活动列表筛选组件','fe2','browse',6],
  ['补充导出字段评审样例','pm2','export',7],['实现报名资格校验接口','be','eligible',8],['实现重复报名幂等处理','be','duplicate',8],['实现名额并发校验','be','duplicate',9],['实现报名结果查询接口','be','result',9],['完成报名结果页面','fe2','result',10],['实现签到码有效期校验','be','checkin',10],['补充重复签到测试用例','qa','checkin',11],['校验组织者活动权限','be','access',11],['完成报名拒绝原因展示','fe1','result',9],['补充学生报名审核接口','be','reviewJoin',9],['补充签到异常提示','fe2','checkin',10],
  ['编写发布配置核对脚本','ops','release',16],['编写数据回退验证用例','qa','release',17],
  ['梳理报名取消边界条件',null,null,null],['补充统计导出验收标准','pm2','export',null],['准备师生试用邀请','pm2','reviewJoin',null],['整理统计核对样例','qa','counts',null],['准备上线巡检清单','ops','monitor',null],['补充弱网报名测试','qa','duplicate',null],['整理学生操作手册','fe1','result',null],['准备活动负责人培训材料','pm2','edit',null],
  ['归档旧版发布页面样稿','fe1','publish',null],['归档旧接口字段讨论','be','eligible',null],
];
function makeFixture(baseDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)||new Date(`${baseDate}T00:00:00Z`).toISOString().slice(0,10)!==baseDate)throw new Error('Invalid DEMO_BASE_DATE');
  const day=offset=>new Date(Date.parse(`${baseDate}T00:00:00Z`)+offset*86400000).toISOString().slice(0,10);
  return {id,baseDate,day,accounts,stages,requirements,goals,epics,stories,plans,tasks,names:['校园活动协作平台 · 秋季上线','图书馆预约系统 · 完成交付示例','社团资料归档平台 · 初始空项目','教务内部审批平台 · 隔离示例']};
}
module.exports={makeFixture};
