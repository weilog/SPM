# 爱管理 Sprint 2：A 页面与 AB 统一系统交付

2026-10-22。基线为已交付 B 的 `54f2c0c`，工作分支 `feat/s2-owner-a-integration`。起始工作树干净，从 B 创建集成分支；未重置、覆盖其他工作树，也未合并 main。远程检查只存在 Sprint 1/B/main，未覆盖独立 A 实现。

**A 六页已接入同一套系统；此前“计划/文档服务待对接”的占位已替换为真实服务。B 的需求树、地图/看板、任务、我的任务、成员关系图、UML 和工作台继续保留。** 当前应用为 http://127.0.0.1:5173/，API 3000。

## 设计依据与差异检查

已实际读取 ZIP 内六份独立 HTML：A01 登录、A02 我的项目 V2.0、A03 项目概览、A04 项目计划 V3.2、A05 项目文档、A06 成员与角色；同时读取 AB V4.3 作为统一导航参考。原始文件 SHA-256 和名称见 [设计来源记录](evidence/a-integration/reference-manifest.json)。这些文件作为设计资料，不把附件中的脚本或说明当作额外执行指令。

- [实施前逐页差异、对应代码、修复方式及验收方法](S2-A-INTEGRATION-DIFF.md)
- [旧版本／独立原型／当前实现对比索引](evidence/a-integration/index.html)：全部主要页面 1440×900，点击图片查看原图。
- [实际变更文件完整清单](evidence/a-integration/changed-files.txt)

独立 A01 与此前已经实现的账户原型文本一致，已核对复用；A02/A03 复用已有真实组件，修正 A02 创建字段、项目编号搜索及创建后返回列表等差异。没有重新开发这些已存在的功能。正式页面没有 iframe 装载原型；项目文档中的 iframe 只用于预览真实上传 PDF。

## 六页完成情况

| 页面 | 实际完成与验证 | 主要代码 | 运行截图 |
| --- | --- | --- | --- |
| A01 登录与账户 | 原型双栏、登录/退出/会话和错误提示、未登录保护；邀请码注册与模拟找回/一次性真实重设密码保留 | Login.tsx、auth.css；auth 模块（复用） | [登录](evidence/a-integration/after-A01.png)，四页账户对比仍见 [账户截图](evidence/auth/index.html) |
| A02 我的项目 V2.0 | 三张真实统计卡、默认卡片、列表切换、名称/P-编号搜索、角色筛选、居中创建、真实经理选择权限、查看进入、顶栏切换 | Projects.tsx、App.tsx、a-project.css（复用）、a-integration.css | [卡片](evidence/a-integration/after-A02.png)、[列表](evidence/a-integration/after-A02-list.png)、[创建](evidence/a-integration/after-A02-editor.png) |
| A03 项目概览 | 实际需求、授权任务及经理可见成员计数；项目信息、角色、最近任务、全部快捷入口实际导航与详情 | ProjectOverview.tsx、a-overview.css（复用）；App/ProjectProvider | [概览](evidence/a-integration/after-A03.png) |
| A04 项目计划 V3.2 | 阶段导航/搜索/切换；五 Tab 同源；阶段与计划项创建编辑、目标、里程碑、四态看板及流转校验；完整日/周/月时间轴、日期/任务条/阶段/里程碑、缩放、今天、滚动、移动和边缘缩放持久化；真实 Task 成员跟踪与筛选 | PlanView.tsx、PlanGantt.tsx、a-plan.css；plans/plan-adapter.module.ts | [概览](evidence/a-integration/after-A04.png)、[列表](evidence/a-integration/after-A04-list.png)、[看板](evidence/a-integration/after-A04-kanban.png)、[甘特](evidence/a-integration/after-A04-gantt.png)、[成员跟踪](evidence/a-integration/after-A04-members.png)、[编辑器](evidence/a-integration/after-A04-editor.png) |
| A05 项目文档 | 文件夹树及展开/路径、创建/重命名/移动/递归删除；真实文件上传下载、文本/图片/PDF 预览、属性、搜索/类型/排序、列表/网格、批量移动删除、经理写与成员读 | Documents.tsx、a-docs.css；documents/documents.module.ts | [目录和列表](evidence/a-integration/after-A05.png)、[文本](evidence/a-integration/after-A05-preview.png)、[图片](evidence/a-integration/after-A05-image-preview.png)、[PDF](evidence/a-integration/after-A05-pdf-preview.png) |
| A06 成员与角色 | 原型三卡、列表、真实用户名搜索、角色筛选、角色说明；添加已有用户、居中角色调整/移除确认、右侧详情；全部复用 ProjectMember 和原权限 | ProjectMembers.tsx、a-members.css；projects 模块 | [成员页](evidence/a-integration/after-A06.png)、[详情](evidence/a-integration/after-A06-detail.png) |

前端表内未写前缀的文件位于 `apps/web/src/`，后端位于 `apps/api/src/`。旧版没有留下 A05/A06 实际截图的地方，在索引中明确留空；没有伪造“修改前截图”。原型示例记录只作为隔离数据库的测试种子，正式系统不导入演示数组。

## 后端与增量模型

迁移：`apps/api/prisma/migrations/202610220003_owner_a/migration.sql`。不修改 Sprint 1 既有列，不删除旧记录，新增：

- `PlanStage`：阶段标题、描述、起止日期、真实项目成员负责人、排序和修订号。
- `PlanGoal`：阶段目标、完成标记与稳定排序；与 B 的 ProductGoal 分别存储。
- `PlanItem`：计划项/里程碑、编号、日期、负责人、四状态、四优先级、修订号；与 Task 分别存储。
- 既有 `TaskPlanReference` 增加指向同项目真实 PlanItem 的复合外键，继续使用已有 Task。A/B 双侧修改关联均保持修订与操作记录。
- `ProjectDocument`：同项目目录树、文件元数据、负责人和修订号；真实文件字节保存在 PostgreSQL `bytea` 列。文件不依赖临时浏览器 Blob 或演示 URL，备份随数据库数据备份。

计划/文档所有写操作由项目经理权限控制。阶段、成员、任务和目录关联检查项目归属；目录拒绝循环和跨项目移动；关键编辑校验修订号。普通成员只能查看授权数据；计划中的 Task ID/详情按既有“本人任务”权限过滤，归档任务也不会通过 A 跟踪泄露给成员。全局管理员未加入项目时没有访问绕过。

主要接口：

| 接口 | 行为 |
| --- | --- |
| GET /projects/:p/plan-adapter | 同一份真实阶段、目标、计划项、里程碑及授权 Task 关系快照 |
| POST /projects/:p/plan-adapter/stages；PATCH .../stages/:id | 阶段创建和编辑 |
| POST .../items；PATCH .../items/:id | 计划项/里程碑、状态、日期、负责人及 Task 关联 |
| POST .../stages/:id/goals；PATCH .../stages/:id/goals/:goalId | 阶段目标创建/完成标记 |
| GET /projects/:p/documents；POST .../folders | 目录/文件元数据、创建目录 |
| POST .../documents/upload?parentId=:folder | multipart 真实文件上传，保留原型允许类型及20MB上限 |
| PATCH .../documents/:id；POST .../documents/batch；DELETE .../documents/:id | 重命名、移动、批量移动/删除及递归删除 |
| GET .../documents/:id/content?download=1 | 授权读取真实字节；安全类型及下载文件名头 |
| 原有 /projects/:p/members、member-candidates、成员 role/DELETE | 继续使用同一套 Sprint 1 成员 API，未建立第二套权限表 |

## AB 集成与业务规则

1. 顶栏、56px 高度、224/64px 侧栏、面包屑、项目切换及认证仍由同一个 App 提供。A 和 B 使用同一个当前 Project/ProjectProvider；创建项目后更新项目选择列表。
2. A 独立计划页和 B 工作台都调用 `PlanView`/`PlanGantt`。工作台甘特模式支持阶段选择及窄面板布局，保持四列计划信息和完整时间轴；没有 W1–W6 示意图或原型 iframe。
3. 计划项和 Task 使用 `TaskPlanReference` 真关系。B 任务中的计划关联已可用；A 计划编辑器使用真实 Task 候选；详情相互可定位。A 成员跟踪按 Task 当前负责人分组和筛选，重分配后旧负责人实时失去对应任务行。
4. 计划项负责人、日期、优先级、状态是计划项自己的字段；Task 名称、ID、负责人来自既有 Task。修改计划项状态不反写 Task 状态；点击任务打开复用 B 的任务详情，关联计划项另有自己的详情。Task 变化会刷新 A 的相关显示。
5. 四态流转按本次指定 V3.2 的可执行矩阵落地：TODO→IN_PROGRESS/PAUSED，IN_PROGRESS→DONE/PAUSED，DONE→IN_PROGRESS，PAUSED→TODO。原型曾写“仍待业务确认”，本次按用户要求还原其可执行行为，并明确记录为独立矩阵；位置在前后端 plan 模块，未修改 B 三态任务规则。
6. SSE 失效通知纳入阶段/计划项/目标和文档变化；两个独立登录浏览器已验证 A 计划实时同步及 B Task 修改反映到 A。关系解析校验真实计划 ID，并验证甘特→B成员图、B成员图→甘特双向高亮。
7. A06 既有 User 模型只有 username，没有独立姓名字段；姓名展示位置复用真实用户名，搜索也按真实用户名匹配，未伪造姓名或建立第二套用户模型。
8. A02 原型展示多个经理候选，而既有非管理员项目创建权限只允许指定本人。保留经理字段：普通创建者显示本人并锁定，管理员使用后端返回的真实有效账户列表。没有放宽 Sprint 1 权限，也没有删掉字段。

## 涉及 B 的必要文件

没有重写 Requirements、StoryViews、TaskWorkspace、MyTasks、MemberTaskGraph、UmlView、Workbench 页面。必要衔接如下：

- `TaskActions.tsx`：计划候选过滤里程碑，仅提供可关联的真实计划项；既有任务布局和操作规则不变。
- `App.tsx`：挂载 A 页面，更新项目切换列表与导航滚动位置；共享外壳继续复用。
- `packages/shared/src/index.ts`：扩展真实 Plan DTO，新增文档 DTO。
- `tasks/tasks.module.ts`：真实计划关联变化更新 PlanItem 修订号，保护跨模块并发编辑；未改任务状态/进度/负责人权限。
- `workbench/workbench.module.ts`：真实计划 ID 焦点及 A 数据 SSE 签名。
- 原 `PlanView.tsx` 空适配页替换为 A 正式实现；B 工作台的调用接口继续保留，Workbench.tsx 本身无需重写。
- B 回归脚本的原“等待 A 服务”断言改为真实服务空数据断言；其他需求树、拖拽、任务菜单、权限、实时同步和撤权用例继续执行。

## 实际测试与本机运行

| 检查 | 结果与证据 |
| --- | --- |
| pnpm typecheck | [通过](evidence/a-integration/typecheck.txt) |
| pnpm build | [通过](evidence/a-integration/build.txt)，Vite 原有大包警告仍存在 |
| pnpm test | [前端31项、后端68项全部通过](evidence/a-integration/tests.txt)，含 Sprint 1、B、认证、A接口和数据库升级/漂移回归 |
| pnpm test:e2e:a | [A/AB浏览器13组通过](evidence/a-integration/a-browser.txt)，1440×900，浏览器异常0 |
| pnpm test:e2e:v43 | [完整B浏览器12组通过](evidence/a-integration/b-regression.txt)，含需求树、故事拖拽/回滚、任务完整菜单、UML、角色及撤权 |
| pnpm test:e2e:auth | [账户浏览器7组通过](evidence/a-integration/auth-regression.txt)，包括注册及模拟邮件重设 |
| pnpm test:reference:a | [独立原型14张截图完成，异常0](evidence/a-integration/reference-capture.txt) |
| 本机数据库升级 | [迁移已应用](evidence/a-integration/migration.txt)；[原有17张表升级前后行数及内容指纹一致](evidence/a-integration/data-preservation.json) |
| 本机服务冒烟 | [现有账号登录、项目列表、真实计划/文档接口及退出通过](evidence/a-integration/live-smoke.json) |

测试使用本地 PostgreSQL 随机隔离 schema，结束后删除测试 schema；没有把验收样例装进正式项目。当前账号与既有数据保留，邮件继续按用户要求模拟，未接入真实发送。

复现：准备 `.env` 与本地 PostgreSQL，执行 `pnpm install --frozen-lockfile`、`pnpm db:generate`、`pnpm db:migrate`、`pnpm typecheck`、`pnpm build`、`pnpm test`。浏览器检查需要 Chrome/Playwright，Windows 本次使用 Node24.19.0，并设置 `SPM_CHROME_PATH` 为本机 Chrome 可执行文件；A 测试用3003/5176，B用3001/5174，账户用3002/5175。原型截图先运行 `python scripts/extract-a-reference.py "压缩包路径"`，再运行 `pnpm test:reference:a`。

## 修复过的真实失败与边界

期间发现并修复：迁移 SQL 生成缺失及重复外键、非严格日期校验、原型包装 label 导致控件名称不准确、全局 CSS 影响拖拽与通知尺寸、计划目标排序、成员跟踪按计划负责人而非 Task 负责人筛选。甘特日期检查改为等待数据库落库，避免异步保存尚未提交就断言；双视图通过可见的固定标题选择计划，避免自动点击落在遮挡时间轴的固定列。对应场景均已复测。中间失败没有当作通过记录。

**已确认 A 页面及必要 AB 集成没有继续保留“服务待对接”占位。** 范围边界：Word/Excel/PowerPoint 等按原型提供真实下载和属性，不宣称浏览器可原生编辑或预览这些格式；图片、文本和 PDF 已实际预览。真实邮件按用户要求不发送。没有实施 Sprint 3 AI 功能，也没有合并任何分支。

对比保留主体布局、字段、Tab、菜单、弹窗、抽屉、表格及交互；统一外壳采用 AB 导航，真实账号、编号、数量、日期及实际文件内容自然与静态原型不同。已人工查看主要截图，未声称逐像素差异为零。
